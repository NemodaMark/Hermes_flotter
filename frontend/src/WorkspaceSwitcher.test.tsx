import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { Select } from './ui/Select'

function Fixture() {
  const [site, setSite] = useState('all')
  return <><WorkspaceSwitcher company="D-Fuvar" site={site === 'all' ? 'Összes telephely' : 'Budapest'} disabled={false}>
    <Select aria-label="Telephely" value={site} onChange={event => setSite(event.target.value)}>
      <option value="all">Összes telephely</option><option value="bp">Budapest</option>
    </Select>
  </WorkspaceSwitcher><button>Másik művelet</button></>
}

it('keeps nested choices open, updates the combined location and restores focus after Escape', async () => {
  render(<Fixture />)
  const trigger = screen.getByRole('button', { name: 'Munkaterület váltása: D-Fuvar / Összes telephely' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await userEvent.click(trigger)
  const site = screen.getByRole('combobox', { name: 'Telephely' })
  expect(site).toHaveFocus()
  await userEvent.click(site)
  await userEvent.click(screen.getByRole('option', { name: 'Budapest' }))
  expect(screen.getByRole('dialog', { name: 'Munkaterület váltása' })).toBeInTheDocument()
  expect(trigger).toHaveAccessibleName('Munkaterület váltása: D-Fuvar / Budapest')
  await userEvent.click(site)
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toHaveFocus()
})

it('dismisses on an outside action without stealing focus and needs no confirmation button', async () => {
  render(<Fixture />)
  const trigger = screen.getByRole('button', { name: /Munkaterület váltása:/ })
  await userEvent.click(trigger)
  const outside = screen.getByRole('button', { name: 'Másik művelet' })
  await userEvent.click(outside)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(outside).toHaveFocus()
  await userEvent.click(trigger)
  expect(screen.queryByRole('button', { name: 'Kész' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Munkaterület-választó bezárása' }))
  expect(trigger).toHaveFocus()
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
})

it('shows only the company when site selection is unavailable and disables switching while busy', async () => {
  render(<WorkspaceSwitcher company="D-Fuvar" disabled><span>Választó</span></WorkspaceSwitcher>)
  const trigger = screen.getByRole('button', { name: 'Munkaterület váltása: D-Fuvar' })
  expect(trigger).toBeDisabled()
  await userEvent.click(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
