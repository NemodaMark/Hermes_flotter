import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { FuelSettlementPanel } from './FuelSettlementPanel'
import { FuelSettlementImport } from './FuelSettlementImport'
import { settlementApi } from './settlementApi'
import type { SettlementOptions, SettlementReport } from './settlementApi'
import { chooseOption } from './selectTestUtils'
const user = { id: 'anna', displayName: 'Anna', email: 'anna@example.test' }
const tenant = { id: 'demo', name: 'Demo', permissions: ['vehicles.settlements.read', 'vehicles.settlements.record'] }
const options: SettlementOptions = { people: [{ id: 'anna', name: 'Anna' }], vehicles: [{ id: 'car', registration: 'AAA-001', odometerKm: 126265 }], policy: { month: '2026-10-01', version: 0, rules: { freeKm: 350, firstBandKm: 500, firstRate: 30, secondRate: 50 } } }
const report: SettlementReport = { userId: 'anna', month: '2026-10-01', version: 0, status: 'Draft', data: {
  version: 0, rules: options.policy.rules, lines: [{ vehicleId: 'car', startKm: 123312, endKm: 126265, liters: 170.46, privateKm: null, unitPrice: 595 }], agreedAmount: null, agreementReason: null, reason: null,
}, calculation: { lines: [], amount: null, standardAmount: null, issues: ['Hiányzik a magánkilométer.'] }, sources: [], vehicles: options.vehicles, updatedBy: null, updatedAt: null, approvedBy: null, approvedAt: null }
function mount(element: React.ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })
  render(<QueryClientProvider client={client}>{element}</QueryClientProvider>)
}
beforeEach(() => {
  vi.spyOn(settlementApi, 'read').mockResolvedValue(report)
  vi.spyOn(settlementApi, 'options').mockResolvedValue(options)
})
afterEach(() => vi.restoreAllMocks())
it('preserves blank private mileage and sends explicit zero through the authorized server preview', async () => {
  const preview = vi.spyOn(settlementApi, 'preview').mockResolvedValue({ lines: [], amount: 0, standardAmount: 0, issues: [] })
  mount(<FuelSettlementPanel tenant={tenant} user={user} initialMonth="2026-10-01" />)
  const input = await screen.findByLabelText('Ebből magánhasználat (km)')
  expect(input).toHaveValue(null)
  fireEvent.change(input, { target: { value: '0' } })
  await userEvent.click(screen.getByRole('button', { name: 'Számítás ellenőrzése' }))
  await waitFor(() => expect(preview).toHaveBeenCalledWith('demo', 'anna', '2026-10-01', expect.objectContaining({ lines: [expect.objectContaining({ privateKm: 0 })] })))
  expect(await screen.findByRole('region', { name: 'Elszámolás levezetése' })).toHaveTextContent('0,00')
  expect(screen.queryByText('Egyedi megállapodás')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Elszámolás jóváhagyása' })).not.toBeInTheDocument()
})
it('keeps incomplete saved reports unsubmitted and never confuses the private allowance with the full mileage limit', async () => {
  vi.mocked(settlementApi.read).mockResolvedValue({ ...report, version: 1, data: { ...report.data, version: 1 } })
  mount(<FuelSettlementPanel tenant={tenant} user={user} initialMonth="2026-10-01" />)
  expect(await screen.findByRole('button', { name: 'Beküldés jóváhagyásra' })).toBeDisabled()
  await userEvent.click(screen.getByText('Keret és díjsávok'))
  expect(screen.getByLabelText('Ingyenes magánkeret (km/hó)')).toBeDisabled()
  expect(screen.getByText(/teljes havi futásteljesítmény-keret/)).toBeInTheDocument()
  expect(screen.getByRole('region', { name: 'Elszámolás levezetése' })).toHaveTextContent('Hiányzik a magánkilométer.')
})
it('exposes approval only for submitted reports with the approval permission and sends the current revision', async () => {
  const submitted = { ...report, status: 'Submitted' as const, version: 2, data: { ...report.data, version: 2 } }
  vi.mocked(settlementApi.read).mockResolvedValue(submitted)
  const action = vi.spyOn(settlementApi, 'action').mockResolvedValue({ ...submitted, version: 3, status: 'Approved' })
  mount(<FuelSettlementPanel tenant={{ ...tenant, permissions: ['vehicles.settlements.approve'] }} user={user} initialMonth="2026-10-01" />)
  await userEvent.click(await screen.findByRole('button', { name: 'Elszámolás jóváhagyása' }))
  await waitFor(() => expect(action).toHaveBeenCalledWith('demo', submitted, 'approve'))
  expect(screen.queryByRole('button', { name: 'Piszkozat mentése' })).not.toBeInTheDocument()
  expect(screen.getByLabelText('Nyitó kilométerállás')).toBeDisabled()
})
it('previews the file without writing and requires explicit canonical user and vehicle mapping before importing', async () => {
  const source = { id: 'source', fileName: 'archive/AAA-001.xlsx', sheet: 'Október', month: '2026-10-01', registration: 'AAA-001', employee: 'Régi név', startKm: 123312, endKm: 126265, liters: 170.46, privateKm: null, unitPrice: 595, rules: options.policy.rules, originalAmount: 0, formula: null, warnings: ['Hiányzik a magánkilométer.'] }
  vi.spyOn(settlementApi, 'importPreview').mockResolvedValue([source])
  const save = vi.spyOn(settlementApi, 'importDraft').mockResolvedValue({ ...report, version: 1 })
  const imported = vi.fn()
  mount(<FuelSettlementImport tenant={tenant} onImported={imported} />)
  await userEvent.upload(screen.getByLabelText('Régi XLSX vagy ZIP'), new File(['data'], 'legacy.xlsx', { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }))
  await userEvent.click(screen.getByRole('button', { name: 'Fájl ellenőrzése' }))
  await chooseOption(await screen.findByRole('combobox', { name: /Átveendő havi sor/ }), 'source')
  const button = await screen.findByRole('button', { name: 'Kiválasztott hónap átvétele piszkozatként' })
  expect(button).toBeDisabled(); expect(save).not.toHaveBeenCalled()
  await chooseOption(screen.getByRole('combobox', { name: 'HERMES-felhasználó' }), 'anna')
  await chooseOption(screen.getByRole('combobox', { name: 'HERMES-jármű' }), 'car')
  await userEvent.type(screen.getByLabelText('Átvétel indoka / egyeztetés'), 'Ellenőrzött régi forrás')
  await userEvent.click(button)
  await waitFor(() => expect(imported).toHaveBeenCalled())
  const sent = save.mock.calls[0][1]
  expect(sent.get('userId')).toBe('anna'); expect(sent.get('vehicleId')).toBe('car'); expect(sent.get('rowId')).toBe('source')
})
