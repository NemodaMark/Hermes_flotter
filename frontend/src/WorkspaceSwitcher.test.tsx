import { useState } from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it } from 'vitest'
import { WorkspaceSwitcher } from './WorkspaceSwitcher'
import { Select } from './ui/Select'

function Fixture() {
  const [company, setCompany] = useState('D-Fuvar')
  return <><WorkspaceSwitcher company={company} disabled={false}>
    <Select aria-label="Cég" value={company} onChange={event => setCompany(event.target.value)}>
      <option>D-Fuvar</option><option>Pannon</option>
    </Select>
  </WorkspaceSwitcher><button>Másik művelet</button></>
}

it('keeps the company selector open, updates the company name and restores focus after Escape', async () => {
  render(<Fixture />)
  const trigger = screen.getByRole('button', { name: 'Munkaterület váltása: D-Fuvar' })
  expect(trigger).toHaveAttribute('aria-expanded', 'false')
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  await userEvent.click(trigger)
  const company = screen.getByRole('combobox', { name: 'Cég' })
  expect(company).toHaveFocus()
  await userEvent.click(company)
  await userEvent.click(screen.getByRole('option', { name: 'Pannon' }))
  expect(screen.getByRole('dialog', { name: 'Munkaterület váltása' })).toBeInTheDocument()
  expect(trigger).toHaveAccessibleName('Munkaterület váltása: Pannon')
  await userEvent.click(company)
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

it('disables company switching while busy', async () => {
  render(<WorkspaceSwitcher company="D-Fuvar" disabled><span>Választó</span></WorkspaceSwitcher>)
  const trigger = screen.getByRole('button', { name: 'Munkaterület váltása: D-Fuvar' })
  expect(trigger).toBeDisabled()
  await userEvent.click(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
})
