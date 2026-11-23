export function personalKey(userId: string, section: string, tenantId = '') {
  return 'hermes:' + JSON.stringify([userId, section, tenantId])
}

export function readPersonal<T>(key: string, isValid: (value: unknown) => value is T): T | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(key) ?? 'null')
    return isValid(value) ? value : undefined
  } catch {
    return undefined
  }
}

export function writePersonal(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch {
    return false
  }
}

export const isText = (value: unknown): value is string => typeof value === 'string'
