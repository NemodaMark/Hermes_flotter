import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api, ApiError } from './api'
import type { Member, MemberAccess, PermissionGroup, Tenant } from './api'
import { permissionNames } from './permissions'
import { PermissionGroups, GroupAssignmentDialog } from './PermissionGroups'
import { PermissionsDialog } from './MemberDialogs'
import { VehicleActions } from './VehicleActions'

const user = { id: 'anna', displayName: 'Anna', email: 'anna@example.test' }
const tenant: Tenant = { id: 'company-a', name: 'Duna', permissions: Object.keys(permissionNames) }
const catalog = Object.entries(permissionNames).map(([code, name]) => ({ code, name }))
const admin: PermissionGroup = {
  id: 'admin',
  name: 'admin',
  isAdmin: true,
  version: 1,
  permissions: tenant.permissions,
  memberCount: 1,
}
const custom: PermissionGroup = {
  id: 'km',
  name: 'Km rögzítő',
  isAdmin: false,
  version: 3,
  permissions: ['vehicles.read', 'vehicles.odometer.create'],
  memberCount: 2,
}
const member: MemberAccess = {
  tenantId: tenant.id,
  userId: 'bela',
  isActive: true,
  version: 9,
  permissions: custom.permissions,
  directPermissions: [],
  groups: [{ id: custom.id, name: custom.name, isAdmin: false }],
}
const changed = vi.fn().mockResolvedValue(undefined)
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
  changed.mockClear()
  close.mockClear()
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open')
  }
  vi.spyOn(api, 'groups').mockResolvedValue([admin, custom])
  vi.spyOn(api, 'memberAccess').mockResolvedValue(member)
})

it('creates a custom bundle with independently selected odometer rights and protects admin controls', async () => {
  const create = vi.spyOn(api, 'createGroup').mockResolvedValue({ ...custom, id: 'new' })
  mount(<PermissionGroups user={user} tenant={tenant} catalog={catalog} onChanged={changed} />)
  expect(await screen.findByText('admin', { exact: true })).toBeVisible()
  expect(
    screen.queryByRole('button', { name: 'Csoport szerkesztése: admin' }),
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Új csoport' }))
  const dialog = screen.getByRole('dialog')
  await userEvent.type(within(dialog).getByLabelText('Csoport neve'), 'Sofőrök')
  await userEvent.click(within(dialog).getByLabelText('Járművek megtekintése'))
  await userEvent.click(within(dialog).getByLabelText('Kilométerállás rögzítése'))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Csoport mentése' }))
  await waitFor(() =>
    expect(create).toHaveBeenCalledWith(tenant.id, 'Sofőrök', [
      'vehicles.read',
      'vehicles.odometer.create',
    ]),
  )
  expect(changed).toHaveBeenCalled()
})

it('edits a versioned bundle and explains that all assigned users are affected', async () => {
  const update = vi.spyOn(api, 'updateGroup').mockResolvedValue({ ...custom, version: 4 })
  mount(<PermissionGroups user={user} tenant={tenant} catalog={catalog} onChanged={changed} />)
  await userEvent.click(
    await screen.findByRole('button', { name: 'Csoport szerkesztése: Km rögzítő' }),
  )
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(/minden csoporttag/)).toBeVisible()
  await userEvent.click(within(dialog).getByLabelText('Kilométerállás rögzítése'))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Csoport mentése' }))
  await waitFor(() =>
    expect(update).toHaveBeenCalledWith(tenant.id, custom.id, custom.name, ['vehicles.read'], 3),
  )
})

it('shows assignment impact before deletion and preserves the dialog on a last-manager conflict', async () => {
  const remove = vi
    .spyOn(api, 'deleteGroup')
    .mockRejectedValue(
      new ApiError(409, 'Az utolsó jogosultságkezelő nem törölhető.', 'last_permission_manager'),
    )
  mount(<PermissionGroups user={user} tenant={tenant} catalog={catalog} onChanged={changed} />)
  await userEvent.click(await screen.findByRole('button', { name: 'Csoport törlése: Km rögzítő' }))
  const dialog = screen.getByRole('dialog')
  expect(within(dialog).getByText(/2 felhasználótól/)).toBeVisible()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Csoport törlése' }))
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('utolsó jogosultságkezelő')
  expect(remove).toHaveBeenCalledWith(tenant.id, custom.id, 3)
})

it('assigns groups with the current membership version and reloads after concurrent changes', async () => {
  const assign = vi
    .spyOn(api, 'assignGroups')
    .mockRejectedValueOnce(new ApiError(409, 'Időközben megváltozott.', 'stale_group'))
    .mockResolvedValue(member)
  mount(
    <GroupAssignmentDialog
      user={user}
      tenant={tenant}
      userId={member.userId}
      onClose={close}
      onChanged={changed}
    />,
  )
  await userEvent.click(await screen.findByLabelText(/Km rögzítő/))
  await userEvent.click(screen.getByRole('button', { name: 'Csoporttagság mentése' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('megváltozott')
  expect(assign).toHaveBeenCalledWith(tenant.id, 'bela', [], 9)
  vi.mocked(api.memberAccess).mockResolvedValue({ ...member, version: 10 })
  await userEvent.click(screen.getByRole('button', { name: 'Friss adatok betöltése' }))
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument())
  await userEvent.click(screen.getByRole('button', { name: 'Csoporttagság mentése' }))
  await waitFor(() => expect(assign).toHaveBeenLastCalledWith(tenant.id, 'bela', [custom.id], 10))
})

it('does not turn inherited rights into direct grants when editing a user', async () => {
  const change = vi.spyOn(api, 'changePermissions').mockResolvedValue(member)
  const target: Member = {
    ...member,
    displayName: 'Béla',
    email: 'bela@example.test',
    joinedAt: null,
    disabledAt: null,
  }
  mount(
    <PermissionsDialog
      tenant={tenant}
      member={target}
      catalog={catalog}
      onClose={close}
      onChanged={changed}
    />,
  )
  expect(screen.getByLabelText('Kilométerállás rögzítése')).not.toBeChecked()
  await userEvent.click(screen.getByRole('button', { name: 'Jogosultságok mentése' }))
  await waitFor(() => expect(change).toHaveBeenCalledWith(tenant.id, 'bela', [], 9))
})

it('gates group creation and prevents selecting rights outside the actors scope', async () => {
  const limited = { ...tenant, permissions: ['members.read'] }
  const { unmount } = mount(
    <PermissionGroups user={user} tenant={limited} catalog={catalog} onChanged={changed} />,
  )
  await screen.findByText('admin', { exact: true })
  expect(screen.queryByRole('button', { name: 'Új csoport' })).not.toBeInTheDocument()
  unmount()
  mount(
    <PermissionGroups
      user={user}
      tenant={{ ...tenant, permissions: ['permission-groups.manage', 'vehicles.read'] }}
      catalog={catalog}
      onChanged={changed}
    />,
  )
  await screen.findByText('admin', { exact: true })
  await userEvent.click(screen.getByRole('button', { name: 'Új csoport' }))
  expect(screen.getByLabelText(/Járműadatok szerkesztése/)).toBeDisabled()
  expect(screen.getByLabelText('Járművek megtekintése')).toBeEnabled()
})

it('lets an odometer-only user record kilometers without offering vehicle editing', async () => {
  const record = vi
    .spyOn(api, 'recordOdometer')
    .mockResolvedValue({
      id: 'car',
      registration: 'ABC-123',
      make: 'Ford',
      model: 'Focus',
      status: 'Active',
      version: 5,
      odometerKm: 45000,
    })
  mount(
    <VehicleActions
      user={user}
      tenant={{ ...tenant, permissions: custom.permissions }}
      vehicle={{
        id: 'car',
        registration: 'ABC-123',
        make: 'Ford',
        model: 'Focus',
        status: 'Active',
        version: 4,
        odometerKm: 44000,
      }}
    />,
  )
  expect(screen.queryByRole('button', { name: /Jármű szerkesztése/ })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Kilométerállás: ABC-123' }))
  const field = screen.getByLabelText('Kilométerállás (km)')
  await userEvent.clear(field)
  await userEvent.type(field, '45000')
  await userEvent.click(screen.getByRole('button', { name: 'Mentés' }))
  await waitFor(() =>
    expect(record).toHaveBeenCalledWith(tenant.id, expect.objectContaining({ version: 4 }), 45000),
  )
})
