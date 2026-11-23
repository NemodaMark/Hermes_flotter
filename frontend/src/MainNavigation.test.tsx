import { afterEach, expect, it, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MainNavigation } from './MainNavigation'
import { FileInput } from './ui/FileInput'

afterEach(() => vi.restoreAllMocks())
it('uses one modal offcanvas navigation on mobile and prevents closing during a pending operation', async () => {
  vi.spyOn(window, 'matchMedia').mockImplementation(media => ({ matches: true, media, onchange: null, addEventListener() {}, removeEventListener() {}, dispatchEvent: () => true, addListener() {}, removeListener() {} }))
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute('open', '') }
  HTMLDialogElement.prototype.close = function () { this.removeAttribute('open') }
  const close = vi.fn()
  const { rerender, unmount } = render(<MainNavigation open busy={false} onClose={close}><button>Járművek</button></MainNavigation>)
  expect(screen.getByRole('dialog', { name: 'Menü' })).toBeInTheDocument()
  expect(screen.getAllByRole('navigation')).toHaveLength(1)
  expect(document.body.style.overflow).toBe('hidden')
  await userEvent.click(screen.getByRole('button', { name: 'Bezárás' }))
  expect(close).toHaveBeenCalledOnce()
  rerender(<MainNavigation open busy onClose={close}><button>Járművek</button></MainNavigation>)
  expect(screen.getByRole('button', { name: 'Bezárás' })).toBeDisabled()
  unmount()
  expect(document.body.style.overflow).not.toBe('hidden')
})

it('keeps native receipt selection accessible while displaying the selected filename', async () => {
  render(<FileInput label="Nyugtafotó (JPG, PNG)" name="file" accept="image/jpeg,image/png" />)
  const file = new File(['receipt'], 'tankolas.png', { type: 'image/png' })
  const input = screen.getByLabelText('Nyugtafotó (JPG, PNG)') as HTMLInputElement
  await userEvent.upload(input, file)
  expect(screen.getByText('tankolas.png')).toBeVisible()
  expect(input.files?.[0]).toBe(file)
  expect(input).toHaveAttribute('name', 'file')
  expect(input).toHaveAttribute('accept', 'image/jpeg,image/png')
})
