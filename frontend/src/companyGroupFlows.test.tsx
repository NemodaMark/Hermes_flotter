import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api, ApiError } from './api'
import type { CompanyAccessGroup, CompanyAccessOption, CompanyAccessUser } from './api'
import { CompanyAccessGroups, CompanyGroupAssignment } from './CompanyAccessGroups'
import { GroupAssignmentDialog } from './PermissionGroups'
import { permissionNames } from './permissions'

const user = { id: 'anna', displayName: 'Anna', email: 'anna@example.test' }
const codes = Object.keys(permissionNames)
const companies: CompanyAccessOption[] = [
  { id: 'a', name: 'Duna', permissions: codes, canEdit: true, canAssign: true, canGrantAll: true },
  {
    id: 'b',
    name: 'Pannon',
    permissions: ['vehicles.read'],
    canEdit: true,
    canAssign: true,
    canGrantAll: false,
  },
  {
    id: 'c',
    name: 'Csak megtekinthető',
    permissions: ['members.read'],
    canEdit: false,
    canAssign: false,
    canGrantAll: false,
  },
]
const group: CompanyAccessGroup = {
  id: 'group',
  name: 'Közös olvasók',
  createdBy: 'anna',
  version: 4,
  allPermissions: false,
  permissions: ['vehicles.read'],
  companies: companies.slice(0, 2),
  memberCount: 2,
  canEdit: true,
  canAssign: true,
}
const access: CompanyAccessUser = {
  userId: 'bela',
  version: 8,
  groupIds: [group.id],
  hasOtherGroups: true,
}
const close = vi.fn()
function mount(element: React.ReactNode) {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
        })
      }
    >
      {element}
    </QueryClientProvider>,
  )
}
beforeEach(() => {
  vi.restoreAllMocks()
  close.mockClear()
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  vi.spyOn(api, 'companyAccessOptions').mockResolvedValue(companies)
  vi.spyOn(api, 'companyAccessGroups').mockResolvedValue([group])
  vi.spyOn(api, 'permissions').mockResolvedValue(
    codes.map((code) => ({ code, name: permissionNames[code] })),
  )
  vi.spyOn(api, 'companyAccessUser').mockResolvedValue(access)
})

it('selects multiple managed companies and restricts permissions to their intersection', async () => {
  const create = vi.spyOn(api, 'createCompanyAccessGroup').mockResolvedValue(group)
  mount(<CompanyAccessGroups user={user} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Új többcéges csoport' }))
  const dialog = within(screen.getByRole('dialog'))
  await userEvent.type(dialog.getByLabelText('Csoport neve'), 'Közös sofőrök')
  expect(dialog.queryByLabelText('Csak megtekinthető')).not.toBeInTheDocument()
  expect(dialog.getByRole('button', { name: 'Többcéges csoport mentése' })).toBeDisabled()
  await userEvent.click(dialog.getByLabelText('Duna'))
  await userEvent.click(dialog.getByLabelText('Járműadatok szerkesztése'))
  await userEvent.click(dialog.getByLabelText('Pannon'))
  expect(dialog.getByLabelText(/Járműadatok szerkesztése/)).toBeDisabled()
  expect(dialog.getByLabelText(/Járműadatok szerkesztése/)).not.toBeChecked()
  expect(dialog.getByLabelText(/Minden jelenlegi és későbbi/)).toBeDisabled()
  await userEvent.click(dialog.getByLabelText('Járművek megtekintése'))
  await userEvent.click(dialog.getByRole('button', { name: 'Többcéges csoport mentése' }))
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith({
      name: 'Közös sofőrök',
      permissions: ['vehicles.read'],
      companyIds: ['a', 'b'],
      allPermissions: false,
    }),
  )
})

it('supports future expanding administrator access only in companies where it may be granted', async () => {
  const create = vi.spyOn(api, 'createCompanyAccessGroup').mockResolvedValue(group)
  mount(<CompanyAccessGroups user={user} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Új többcéges csoport' }))
  const dialog = within(screen.getByRole('dialog'))
  await userEvent.type(dialog.getByLabelText('Csoport neve'), 'Duna adminok')
  await userEvent.click(dialog.getByLabelText('Duna'))
  await userEvent.click(dialog.getByLabelText(/Minden jelenlegi és későbbi/))
  expect(dialog.queryByLabelText('Járművek megtekintése')).not.toBeInTheDocument()
  await userEvent.click(dialog.getByRole('button', { name: 'Többcéges csoport mentése' }))
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ allPermissions: true, permissions: [], companyIds: ['a'] }),
    ),
  )
})

it('updates a group using its version and sends the changed company list', async () => {
  const update = vi
    .spyOn(api, 'updateCompanyAccessGroup')
    .mockResolvedValue({ ...group, version: 5 })
  mount(<CompanyAccessGroups user={user} />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Többcéges csoport szerkesztése: Közös olvasók' }),
  )
  const dialog = within(screen.getByRole('dialog'))
  await userEvent.click(dialog.getByLabelText('Pannon'))
  await userEvent.click(dialog.getByRole('button', { name: 'Többcéges csoport mentése' }))
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(group.id, {
      name: group.name,
      permissions: ['vehicles.read'],
      companyIds: ['a'],
      allPermissions: false,
      version: 4,
    }),
  )
})

it('shows every affected company before deleting a group and renders a last-manager refusal', async () => {
  const remove = vi
    .spyOn(api, 'deleteCompanyAccessGroup')
    .mockRejectedValue(
      new ApiError(409, 'Az utolsó jogkezelő hozzáférése megmarad.', 'last_permission_manager'),
    )
  mount(<CompanyAccessGroups user={user} />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Többcéges csoport törlése: Közös olvasók' }),
  )
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText(/2 felhasználó.*Duna, Pannon/)).toBeVisible()
  await userEvent.click(dialog.getByRole('button', { name: 'Többcéges csoport törlése' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent('utolsó jogkezelő')
  expect(remove).toHaveBeenCalledWith(group.id, 4)
})

it('assigns only editable user groups and preserves the unmanaged-assignment notice', async () => {
  const save = vi.spyOn(api, 'assignCompanyAccessGroups').mockResolvedValue(access)
  vi.mocked(api.companyAccessGroups).mockResolvedValue([
    group,
    { ...group, id: 'other', name: 'Nem kiosztható', canAssign: false },
  ])
  mount(<CompanyGroupAssignment user={user} userId="bela" onClose={close} />)
  expect(
    await screen.findByText('Más, általad nem kezelhető csoporttagságok megmaradnak.'),
  ).toBeVisible()
  expect(screen.queryByLabelText(/Nem kiosztható/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByLabelText(/Közös olvasók/))
  await userEvent.click(screen.getByRole('button', { name: 'Többcéges tagság mentése' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('bela', [], 8))
})

it('reloads the current user version after an assignment conflict', async () => {
  const save = vi
    .spyOn(api, 'assignCompanyAccessGroups')
    .mockRejectedValueOnce(new ApiError(409, 'Időközben megváltozott.', 'stale_company_group'))
    .mockResolvedValue(access)
  mount(<CompanyGroupAssignment user={user} userId="bela" onClose={close} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Többcéges tagság mentése' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('megváltozott')
  vi.mocked(api.companyAccessUser).mockResolvedValue({ ...access, version: 9 })
  await userEvent.click(screen.getByRole('button', { name: 'Csoporttagságok újratöltése' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: 'Többcéges tagság mentése' }))
  await waitFor(() => expect(save).toHaveBeenLastCalledWith('bela', [group.id], 9))
})

it('does not copy a cross-company assignment into the local group editor', async () => {
  const assign = vi
    .spyOn(api, 'assignGroups')
    .mockResolvedValue({
      tenantId: 'a',
      userId: 'bela',
      version: 2,
      isActive: true,
      permissions: [],
    })
  vi.spyOn(api, 'groups').mockResolvedValue([
    {
      id: 'local',
      name: 'Helyi csoport',
      isAdmin: false,
      version: 1,
      permissions: [],
      memberCount: 0,
    },
  ])
  vi.spyOn(api, 'memberAccess').mockResolvedValue({
    tenantId: 'a',
    userId: 'bela',
    version: 1,
    isActive: true,
    permissions: [],
    groups: [{ id: group.id, name: group.name, isAdmin: false, isMultiCompany: true }],
  })
  mount(
    <GroupAssignmentDialog
      user={user}
      tenant={companies[0]}
      userId="bela"
      onClose={close}
      onChanged={vi.fn().mockResolvedValue(undefined)}
    />,
  )
  await userEvent.click(await screen.findByRole('button', { name: 'Csoporttagság mentése' }))
  await waitFor(() => expect(assign).toHaveBeenCalledWith('a', 'bela', [], 1))
})
