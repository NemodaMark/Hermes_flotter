import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, it, vi } from 'vitest'
import { ClickableRow } from './Table'

it('opens a complete row by click or keyboard while preserving independent actions', async () => {
  const open = vi.fn(), action = vi.fn()
  render(<table><tbody><ClickableRow onOpen={open} aria-label="Jármű: ABC-123"><td>ABC-123</td><td>Ford</td><td><button onClick={action}>Km rögzítése</button></td></ClickableRow></tbody></table>)
  await userEvent.click(screen.getByText('Ford'))
  expect(open).toHaveBeenCalledTimes(1)
  await userEvent.click(screen.getByRole('button', { name: 'Km rögzítése' }))
  expect(action).toHaveBeenCalledTimes(1)
  expect(open).toHaveBeenCalledTimes(1)
  screen.getByRole('row', { name: 'Jármű: ABC-123' }).focus()
  await userEvent.keyboard('{Enter}')
  expect(open).toHaveBeenCalledTimes(2)
})
