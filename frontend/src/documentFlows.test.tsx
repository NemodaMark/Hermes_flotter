import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { VehicleDocuments } from './VehicleDocuments'
import { documentApi, saveDownload } from './documentApi'
import type { DocumentCollection, VehicleDocument } from './documentApi'

vi.mock('./documentApi', async importOriginal => ({ ...await importOriginal<typeof import('./documentApi')>(), saveDownload: vi.fn() }))
const doc: VehicleDocument = { id: 'doc', fileName: 'szerzodes.pdf', contentType: 'application/pdf', byteLength: 128, sha256: 'hash', uploadedBy: 'operator', uploadedAt: '2026-10-20T10:00:00Z', version: 1, isWithdrawn: false, statusReason: null, statusChangedBy: null, statusChangedAt: null }
const collection = (items = [doc], parentVersion = 7): DocumentCollection => ({ items, parentVersion, vehicleVersion: 9, totalBytes: 128 })
function mount(canRead = true, canManage = true, isVoided = false) {
  const changed = vi.fn(async () => {})
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}>
    <VehicleDocuments tenantId="company" vehicleId="car" registration="ABC-123" kind="leases" target={{ id: 'lease', name: 'LEASE-01', version: 7, isVoided }} canRead={canRead} canManage={canManage} onChanged={changed} onClose={vi.fn()} />
  </QueryClientProvider>)
  return changed
}
beforeEach(() => {
  vi.restoreAllMocks()
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  vi.spyOn(documentApi, 'list').mockResolvedValue(collection())
})
it('uploads to the selected record with its current version and refreshes the list', async () => {
  const upload = vi.spyOn(documentApi, 'upload').mockResolvedValue({ document: doc, parentVersion: 8, vehicleVersion: 10 })
  const changed = mount()
  await screen.findByText(doc.fileName)
  const file = new File(['%PDF-1.7'], 'szerzodes.pdf', { type: 'application/pdf' })
  await userEvent.upload(screen.getByLabelText('Fájl kiválasztása'), file)
  await userEvent.click(screen.getByRole('button', { name: 'Feltöltés' }))
  await waitFor(() => expect(changed).toHaveBeenCalled())
  expect(upload).toHaveBeenCalledWith('company', 'car', 'leases', 'lease', file, 7)
  expect(screen.getByLabelText('Fájl kiválasztása')).toHaveValue('')
  expect(documentApi.list).toHaveBeenCalledTimes(2)
  expect(await screen.findByRole('status')).toHaveTextContent('szerzodes.pdf feltöltve.')
})
it('keeps a failed upload selected and retries using the refreshed parent version', async () => {
  const upload = vi.spyOn(documentApi, 'upload').mockRejectedValueOnce(new Error('Elavult verzió.')).mockResolvedValue({ document: doc, parentVersion: 9, vehicleVersion: 11 })
  mount()
  await screen.findByText(doc.fileName)
  const file = new File(['%PDF-1.7'], 'uj.pdf')
  await userEvent.upload(screen.getByLabelText('Fájl kiválasztása'), file)
  await userEvent.click(screen.getByRole('button', { name: 'Feltöltés' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('Elavult verzió.')
  vi.mocked(documentApi.list).mockResolvedValue(collection([doc], 8))
  await userEvent.click(screen.getByRole('button', { name: 'Dokumentumlista frissítése' }))
  await waitFor(() => expect(documentApi.list).toHaveBeenCalledTimes(2))
  expect((screen.getByLabelText('Fájl kiválasztása') as HTMLInputElement).files?.[0]).toBe(file)
  await userEvent.click(screen.getByRole('button', { name: 'Feltöltés' }))
  await waitFor(() => expect(upload).toHaveBeenLastCalledWith('company', 'car', 'leases', 'lease', file, 8))
})
it('downloads with read permission while hiding all modifying controls', async () => {
  const blob = new Blob(['%PDF-1.7'], { type: 'application/pdf' })
  const download = vi.spyOn(documentApi, 'content').mockResolvedValue(blob)
  mount(true, false)
  await userEvent.click(await screen.findByRole('button', { name: `Letöltés: ${doc.fileName}` }))
  await waitFor(() => expect(saveDownload).toHaveBeenCalledWith(blob, doc.fileName))
  expect(download).toHaveBeenCalledWith('company', 'car', 'leases', 'lease', 'doc')
  expect(screen.queryByLabelText('Fájl kiválasztása')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Visszavonás' })).not.toBeInTheDocument()
})
it('does not fetch the private list for a manage-only user', async () => {
  vi.spyOn(documentApi, 'upload').mockResolvedValue({ document: doc, parentVersion: 8, vehicleVersion: 10 })
  mount(false, true)
  await userEvent.upload(screen.getByLabelText('Fájl kiválasztása'), new File(['%PDF-1.7'], 'uj.pdf'))
  await userEvent.click(screen.getByRole('button', { name: 'Feltöltés' }))
  await screen.findByRole('status')
  expect(documentApi.list).not.toHaveBeenCalled()
  expect(screen.queryByRole('button', { name: /Letöltés/ })).not.toBeInTheDocument()
})
it('requires a reason and sends both document and parent versions when withdrawing', async () => {
  const status = vi.spyOn(documentApi, 'status').mockResolvedValue({ document: { ...doc, isWithdrawn: true }, parentVersion: 8, vehicleVersion: 10 })
  mount()
  await userEvent.click(await screen.findByRole('button', { name: 'Visszavonás' }))
  expect(screen.getByLabelText('Indoklás')).toBeRequired()
  await userEvent.type(screen.getByLabelText('Indoklás'), 'Téves csatolmány')
  await userEvent.click(screen.getByRole('button', { name: 'Állapot mentése' }))
  await waitFor(() => expect(status).toHaveBeenCalledWith('company', 'car', 'leases', 'lease', doc, true, 'Téves csatolmány', 7))
})
it('shows withdrawn files only on request and never offers their download', async () => {
  vi.mocked(documentApi.list).mockResolvedValue(collection([{ ...doc, isWithdrawn: true, statusReason: 'Téves' }]))
  mount()
  await screen.findByText('Még nincs megjeleníthető dokumentum.')
  await userEvent.click(screen.getByLabelText('Visszavontak is'))
  expect(screen.getByText(doc.fileName)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Visszaállítás' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /Letöltés/ })).not.toBeInTheDocument()
})
it('blocks empty, oversized and unsupported selections before sending a request', async () => {
  const upload = vi.spyOn(documentApi, 'upload')
  mount()
  await screen.findByText(doc.fileName)
  for (const file of [new File([], 'ures.pdf'), new File([new Uint8Array(10 * 1024 * 1024 + 1)], 'nagy.pdf'), new File(['html'], 'nem.html')]) {
    fireEvent.change(screen.getByLabelText('Fájl kiválasztása'), { target: { files: [file] } })
    expect(screen.getByRole('alert')).toHaveTextContent('legfeljebb 10 MB-os')
    expect(screen.getByRole('button', { name: 'Feltöltés' })).toBeDisabled()
  }
  expect(upload).not.toHaveBeenCalled()
})
it('keeps historical documents readable when the record cannot be modified', async () => {
  mount(true, true, true)
  expect(await screen.findByRole('button', { name: /Letöltés/ })).toBeInTheDocument()
  expect(screen.queryByLabelText('Fájl kiválasztása')).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: 'Visszavonás' })).not.toBeInTheDocument()
})
