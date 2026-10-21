import { permissionLabel } from './permissions'

export function PermissionDetails({ codes }: { codes: string[] }) {
  if (!codes.length) return <span className="field-hint">Nincs kiosztott jog</span>
  return <details className="permission-details"><summary>{codes.length} jogosultság</summary><ul>{codes.map(code => <li key={code}>{permissionLabel(code)}</li>)}</ul></details>
}
