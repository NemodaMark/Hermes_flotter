import { fireEvent, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'

// Exercise the actual popup, resolving the old option value through the native
// form-validation select so API-focused tests don't depend on translated labels.
export async function chooseOption(control: HTMLElement, value: string | string[]) {
  const code = Array.isArray(value) ? value[0] : value
  const native = control.closest('.choice')?.querySelector('select')
  if (!native) throw new Error('Expected the shared Select control.')
  const option = await waitFor(() => {
    const item = Array.from(native.options).find(item => item.value === code)
    if (!item) throw new Error(`Missing option: ${code}`)
    return item
  })
  await userEvent.click(control)
  if (native.options.length > 30) fireEvent.change(control, { target: { value: option.textContent ?? '' } })
  await userEvent.click(screen.getByRole('option', { name: option.textContent ?? '' }))
}
