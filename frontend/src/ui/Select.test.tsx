import { useState } from 'react'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ComboBox, Select } from './Select'
import { FieldSections } from '../FieldSections'

function Fixture({ required = false }: { required?: boolean }) {
  const [value, setValue] = useState('')
  return <form onSubmit={event => event.preventDefault()}><label>Telephely<Select required={required} value={value} onChange={event => setValue(event.target.value)}>
    <option value="">Válassz telephelyet</option><option value="bp">Budapest</option><option value="gy">Győr</option><option value="locked" disabled>Letiltott</option>
  </Select></label><button>Mentés</button><button type="button">Másik művelet</button><output>{value}</output></form>
}

describe('shared searchable choices', () => {
  it('filters by typing, commits with Enter and retains the underlying form value', async () => {
    render(<Fixture />)
    const field = screen.getByRole('combobox', { name: 'Telephely' })
    await userEvent.click(field)
    await userEvent.type(field, 'Győ')
    expect(screen.queryByRole('option', { name: 'Budapest' })).not.toBeInTheDocument()
    await userEvent.keyboard('{Enter}')
    expect(field).toHaveValue('Győr')
    expect(screen.getByRole('status')).toHaveTextContent('gy')
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('supports arrows, skips disabled values and cancels without selecting typed text', async () => {
    render(<Fixture />)
    const field = screen.getByRole('combobox', { name: 'Telephely' })
    await userEvent.click(field)
    await userEvent.keyboard('{End}{Enter}')
    expect(field).toHaveValue('Győr')
    await userEvent.click(field)
    await userEvent.type(field, 'ismeretlen')
    await userEvent.keyboard('{Escape}')
    expect(field).toHaveValue('Győr')
    await userEvent.click(field)
    await userEvent.click(screen.getByRole('button', { name: 'Másik művelet' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('keeps required form validation and focuses the visible control', async () => {
    render(<Fixture required />)
    const field = screen.getByRole('combobox', { name: 'Telephely' })
    await userEvent.click(screen.getByRole('button', { name: 'Mentés' }))
    expect(field).toHaveFocus()
    expect(field).toBeRequired()
    expect(screen.getByRole('alert')).toHaveTextContent('Válassz egy értéket.')
    expect(field.closest('.choice')!.querySelector('select')!.validity.valid).toBe(false)
    await userEvent.click(field)
    await userEvent.click(screen.getByRole('option', { name: 'Budapest' }))
    expect(field.closest('.choice')!.querySelector('select')!.validity.valid).toBe(true)
  })

  it('uses Escape to close only the popup and honours a disabled fieldset', async () => {
    const key = vi.fn()
    const { rerender } = render(<div onKeyDown={key}><label>Állapot<Select value="a"><option value="a">Aktív</option></Select></label></div>)
    await userEvent.click(screen.getByRole('combobox', { name: 'Állapot' }))
    key.mockClear()
    await userEvent.keyboard('{Escape}')
    expect(key).not.toHaveBeenCalled()
    rerender(<fieldset disabled><label>Állapot<Select value="a"><option value="a">Aktív</option></Select></label></fieldset>)
    expect(screen.getByRole('combobox', { name: 'Állapot' })).toBeDisabled()
    fireEvent.click(screen.getByRole('combobox', { name: 'Állapot' }))
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument()
  })

  it('allows a new make and selecting a known suggestion with the same popup', async () => {
    function Makes() { const [make, setMake] = useState(''); return <ComboBox label="Gyártó" value={make} options={['Audi', 'BMW']} onChange={setMake} disabled={false} /> }
    render(<Makes />)
    const field = screen.getByRole('combobox', { name: 'Gyártó' })
    await userEvent.type(field, 'Új gyártó')
    await userEvent.keyboard('{Enter}')
    expect(field).toHaveValue('Új gyártó')
    await userEvent.click(screen.getByRole('button', { name: 'Gyártó lehetőségei' }))
    await userEvent.click(screen.getByRole('option', { name: 'BMW' }))
    expect(field).toHaveValue('BMW')
  })

  it('reveals a required selector in a hidden form section before focusing it', async () => {
    const submit = vi.fn((event: React.SubmitEvent<HTMLFormElement>) => event.preventDefault())
    function Form() {
      const [value, setValue] = useState('')
      return <form onSubmit={submit}><FieldSections label="Mezők" sections={[
        { id: 'basic', label: 'Alapadatok', content: <input aria-label="Név" defaultValue="Teszt" required /> },
        { id: 'site', label: 'Hozzáférés', content: <label>Telephely<Select value={value} onChange={event => setValue(event.target.value)} required><option value="">Válassz</option><option value="bp">Budapest</option></Select></label> },
      ]} /><button>Mentés</button></form>
    }
    render(<Form />)
    await userEvent.click(screen.getByRole('button', { name: 'Mentés' }))
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Telephely' })).toHaveFocus())
    expect(screen.getByRole('tab', { name: 'Hozzáférés' })).toHaveAttribute('aria-selected', 'true')
    expect(submit).not.toHaveBeenCalled()
    await userEvent.click(screen.getByRole('combobox', { name: 'Telephely' }))
    await userEvent.click(screen.getByRole('option', { name: 'Budapest' }))
    await userEvent.click(screen.getByRole('button', { name: 'Mentés' }))
    expect(submit).toHaveBeenCalledTimes(1)
  })
})
