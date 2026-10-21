import { createRef } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Button } from './Button'

describe('Sera Button integration', () => {
  it('keeps native form submission and explicit cancel button behavior', async () => {
    const submit = vi.fn((event: React.SubmitEvent<HTMLFormElement>) => event.preventDefault())
    render(<form onSubmit={submit}><Button type="button">Mégse</Button><Button>Mentés</Button></form>)
    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Mégse' }))
    expect(submit).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Mentés' }))
    expect(submit).toHaveBeenCalledTimes(1)
  })

  it('blocks repeated operations while loading even with disabled=false', () => {
    const click = vi.fn()
    render(<Button loading disabled={false} onClick={click}>Mentés</Button>)
    const button = screen.getByRole('button', { name: 'Mentés' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    fireEvent.click(button)
    expect(click).not.toHaveBeenCalled()
  })

  it('preserves refs and native tab ARIA without applying primary action styling', () => {
    const ref = createRef<HTMLButtonElement>()
    render(<Button ref={ref} role="tab" aria-selected={false} tabIndex={-1} aria-controls="address">Székhely</Button>)
    const tab = screen.getByRole('tab', { name: 'Székhely' })
    expect(ref.current).toBe(tab)
    expect(tab).toHaveAttribute('aria-controls', 'address')
    expect(tab).not.toHaveAttribute('data-variant')
    expect(tab).toHaveAttribute('tabindex', '-1')
  })
})
