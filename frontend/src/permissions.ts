export const permissionNames: Record<string, string> = {
  'vehicles.read': 'Járművek megtekintése',
  'vehicles.create': 'Jármű felvétele',
  'vehicles.update': 'Járműadatok szerkesztése',
  'vehicles.odometer.create': 'Kilométerállás rögzítése',
  'permission-groups.manage': 'Jogosultságcsoportok kezelése',
  'members.read': 'Felhasználók megtekintése',
  'members.invite': 'Meghívások kezelése',
  'members.update': 'Céges hozzáférések kezelése',
  'permissions.manage': 'Jogosultságok kiosztása',
  'audit.read': 'Változásnapló megtekintése',
}

export function permissionLabel(code: string) {
  return permissionNames[code] ?? code
}
