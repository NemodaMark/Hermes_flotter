export const initials = (name: string) => name.trim().split(/\s+/).map(x => x[0]).slice(0, 2).join('').toUpperCase()
