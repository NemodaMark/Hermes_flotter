export const permissionNames: Record<string, string> = {
  'vehicles.read': 'Járművek megtekintése',
  'vehicles.create': 'Jármű felvétele',
  'members.read': 'Felhasználók megtekintése',
  'members.invite': 'Meghívások kezelése',
  'members.update': 'Céges hozzáférések kezelése',
  'permissions.manage': 'Jogosultságok kiosztása',
  'audit.read': 'Változásnapló megtekintése',
}

export function permissionLabel(code: string) {
  return permissionNames[code] ?? code
}
