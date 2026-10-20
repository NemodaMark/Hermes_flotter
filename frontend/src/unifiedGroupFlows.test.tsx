import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api, ApiError } from './api'
import type { PermissionGroup, GroupCompanyOption, GroupUser } from './api'
import { PermissionGroups, GroupAssignmentDialog } from './PermissionGroups'
import { permissionNames } from './permissions'
import { MembersPage } from './MembersPage'

const user = { id: 'anna', displayName: 'Anna', email: 'anna@example.test' }
const codes = Object.keys(permissionNames)
const companies: GroupCompanyOption[] = [
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
const group: PermissionGroup = {
  id: 'group',
  name: 'Közös olvasók',
  createdBy: 'anna',
  version: 4,
  allPermissions: false,
  isAdmin: false,
  permissions: ['vehicles.read'],
  companies: companies.slice(0, 2),
  memberCount: 2,
  canEdit: true,
  canAssign: true,
}
const access: GroupUser = {
  userId: 'bela',
  version: 8,
  groupIds: [group.id],
  hasOtherGroups: true,
  adminCompanyIds: [],
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
  vi.spyOn(api, 'groupCompanies').mockResolvedValue(companies)
  vi.spyOn(api, 'groups').mockResolvedValue([group])
  vi.spyOn(api, 'permissions').mockResolvedValue(
    codes.map((code) => ({ code, name: permissionNames[code] })),
  )
  vi.spyOn(api, 'groupUser').mockResolvedValue(access)
})

it('selects multiple managed companies and restricts permissions to their intersection', async () => {
  const create = vi.spyOn(api, 'createGroup').mockResolvedValue(group)
  mount(<PermissionGroups user={user} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Új jogosultságcsoport' }))
  const dialog = within(screen.getByRole('dialog'))
  await userEvent.type(dialog.getByLabelText('Csoport neve'), 'Közös sofőrök')
  expect(dialog.queryByLabelText('Csak megtekinthető')).not.toBeInTheDocument()
  expect(dialog.getByRole('button', { name: 'Jogosultságcsoport mentése' })).toBeDisabled()
  await userEvent.click(dialog.getByLabelText('Duna'))
  await userEvent.click(dialog.getByLabelText('Járműadatok szerkesztése'))
  await userEvent.click(dialog.getByLabelText('Pannon'))
  expect(dialog.getByLabelText(/Járműadatok szerkesztése/)).toBeDisabled()
  expect(dialog.getByLabelText(/Járműadatok szerkesztése/)).not.toBeChecked()
  expect(dialog.getByLabelText(/Minden jelenlegi és későbbi/)).toBeDisabled()
  await userEvent.click(dialog.getByLabelText('Járművek megtekintése'))
  await userEvent.click(dialog.getByRole('button', { name: 'Jogosultságcsoport mentése' }))
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
  const create = vi.spyOn(api, 'createGroup').mockResolvedValue(group)
  mount(<PermissionGroups user={user} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Új jogosultságcsoport' }))
  const dialog = within(screen.getByRole('dialog'))
  await userEvent.type(dialog.getByLabelText('Csoport neve'), 'Duna adminok')
  await userEvent.click(dialog.getByLabelText('Duna'))
  await userEvent.click(dialog.getByLabelText(/Minden jelenlegi és későbbi/))
  expect(dialog.queryByLabelText('Járművek megtekintése')).not.toBeInTheDocument()
  await userEvent.click(dialog.getByRole('button', { name: 'Jogosultságcsoport mentése' }))
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ allPermissions: true, permissions: [], companyIds: ['a'] }),
    ),
  )
})

it('updates a group using its version and sends the changed company list', async () => {
  const update = vi.spyOn(api, 'updateGroup').mockResolvedValue({ ...group, version: 5 })
  mount(<PermissionGroups user={user} />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Jogosultságcsoport szerkesztése: Közös olvasók' }),
  )
  const dialog = within(screen.getByRole('dialog'))
  await userEvent.click(dialog.getByLabelText('Pannon'))
  await userEvent.click(dialog.getByRole('button', { name: 'Jogosultságcsoport mentése' }))
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
    .spyOn(api, 'deleteGroup')
    .mockRejectedValue(
      new ApiError(409, 'Az utolsó jogkezelő hozzáférése megmarad.', 'last_permission_manager'),
    )
  mount(<PermissionGroups user={user} />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Jogosultságcsoport törlése: Közös olvasók' }),
  )
  const dialog = within(screen.getByRole('dialog'))
  expect(dialog.getByText(/2 felhasználó.*Duna, Pannon/)).toBeVisible()
  await userEvent.click(dialog.getByRole('button', { name: 'Jogosultságcsoport törlése' }))
  expect(await dialog.findByRole('alert')).toHaveTextContent('utolsó jogkezelő')
  expect(remove).toHaveBeenCalledWith(group.id, 4)
})

it('assigns only editable user groups and preserves the unmanaged-assignment notice', async () => {
  const save = vi.spyOn(api, 'assignGroups').mockResolvedValue(access)
  vi.mocked(api.groups).mockResolvedValue([
    group,
    { ...group, id: 'other', name: 'Nem kiosztható', canAssign: false },
  ])
  mount(<GroupAssignmentDialog user={user} userId="bela" onClose={close} />)
  expect(
    await screen.findByText('Más, általad nem kezelhető csoporttagságok megmaradnak.'),
  ).toBeVisible()
  expect(screen.queryByLabelText(/Nem kiosztható/)).not.toBeInTheDocument()
  await userEvent.click(screen.getByLabelText(/Közös olvasók/))
  await userEvent.click(screen.getByRole('button', { name: 'Tagság mentése' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('bela', [], 8, []))
})

it('reloads the current user version after an assignment conflict', async () => {
  const save = vi
    .spyOn(api, 'assignGroups')
    .mockRejectedValueOnce(new ApiError(409, 'Időközben megváltozott.', 'stale_group'))
    .mockResolvedValue(access)
  mount(<GroupAssignmentDialog user={user} userId="bela" onClose={close} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Tagság mentése' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('megváltozott')
  vi.mocked(api.groupUser).mockResolvedValue({ ...access, version: 9 })
  await userEvent.click(screen.getByRole('button', { name: 'Csoporttagságok újratöltése' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: 'Tagság mentése' }))
  await waitFor(() => expect(save).toHaveBeenLastCalledWith('bela', [group.id], 9, []))
})

it('offers one group tab for groups with either one or multiple companies', async () => {
  vi.spyOn(api, 'members').mockResolvedValue({ items: [], total: 0, page: 1, pageSize: 25 })
  vi.mocked(api.groups).mockResolvedValue([
    group,
    { ...group, id: 'single', name: 'Egy céges csomag', companies: [companies[0]] },
  ])
  mount(<MembersPage user={user} tenant={companies[0]} />)
  await userEvent.click(screen.getByRole('tab', { name: 'Jogosultságcsoportok' }))
  expect(await screen.findByText('Közös olvasók')).toBeVisible()
  expect(screen.getByText('Egy céges csomag')).toBeVisible()
  expect(screen.getAllByRole('tab')).toHaveLength(3)
  expect(screen.queryByRole('tab', { name: /Többcéges/ })).not.toBeInTheDocument()
})

it('shows one protected admin definition and selects its companies when assigning a user', async () => {
  const admin = {
    ...group,
    id: 'admin',
    name: 'admin',
    isAdmin: true,
    allPermissions: true,
    permissions: codes,
    canEdit: false,
    companies: [companies[0], { ...companies[1], canGrantAll: true }],
  }
  vi.mocked(api.groups).mockResolvedValue([admin])
  const first = mount(<PermissionGroups user={user} />)
  expect(await screen.findByText('Felhasználónként kijelölhető cégek')).toBeVisible()
  expect(screen.queryByRole('button', { name: /szerkesztése: admin/ })).not.toBeInTheDocument()
  expect(screen.queryByRole('button', { name: /törlése: admin/ })).not.toBeInTheDocument()
  first.unmount()
  vi.mocked(api.groupUser).mockResolvedValue({
    ...access,
    groupIds: ['admin'],
    adminCompanyIds: ['a'],
  })
  const save = vi.spyOn(api, 'assignGroups').mockResolvedValue(access)
  mount(<GroupAssignmentDialog user={user} userId="bela" onClose={close} />)
  const field = within(await screen.findByRole('group', { name: 'Adminjog ezeknél a cégeknél' }))
  expect(field.getByLabelText('Duna')).toBeChecked()
  expect(field.getByLabelText('Pannon')).not.toBeChecked()
  await userEvent.click(field.getByLabelText('Duna'))
  expect(screen.getByRole('button', { name: 'Tagság mentése' })).toBeDisabled()
  await userEvent.click(field.getByLabelText('Pannon'))
  await userEvent.click(screen.getByRole('button', { name: 'Tagság mentése' }))
  await waitFor(() => expect(save).toHaveBeenCalledWith('bela', ['admin'], 8, ['b']))
})

it('keeps the admin scope when reloading an assignment conflict', async () => {
  const admin = {
    ...group,
    id: 'admin',
    name: 'admin',
    isAdmin: true,
    allPermissions: true,
    canEdit: false,
  }
  vi.mocked(api.groups).mockResolvedValue([admin])
  vi.mocked(api.groupUser).mockResolvedValue({
    ...access,
    groupIds: ['admin'],
    adminCompanyIds: ['a'],
  })
  const save = vi
    .spyOn(api, 'assignGroups')
    .mockRejectedValueOnce(new ApiError(409, 'Frissítsd az adatokat.', 'stale_group'))
    .mockResolvedValue(access)
  mount(<GroupAssignmentDialog user={user} userId="bela" onClose={close} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Tagság mentése' }))
  expect(await screen.findByRole('alert')).toBeVisible()
  vi.mocked(api.groupUser).mockResolvedValue({
    ...access,
    version: 9,
    groupIds: ['admin'],
    adminCompanyIds: ['b'],
  })
  await userEvent.click(screen.getByRole('button', { name: 'Csoporttagságok újratöltése' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  expect(screen.getByLabelText('Pannon')).toBeChecked()
  expect(screen.getByLabelText('Duna')).not.toBeChecked()
  expect(save).toHaveBeenCalledTimes(1)
})
