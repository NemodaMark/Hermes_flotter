export const bodyNames: Record<string, string> = { Unknown: 'Nincs megadva', Sedan: 'Szedán', Hatchback: 'Ferdehátú', Estate: 'Kombi', Suv: 'SUV / terepjáró', Coupe: 'Kupé', Convertible: 'Kabrió', Minivan: 'Egyterű', Van: 'Furgon', Pickup: 'Pickup', ChassisCab: 'Alvázas', Box: 'Dobozos', Tipper: 'Billencs', Other: 'Egyéb' }
const colors: Record<string, string> = {
  feher: '#edf0ef', white: '#edf0ef', fekete: '#171d24', black: '#171d24', szurke: '#646f78', gray: '#646f78', grey: '#646f78',
  ezust: '#aab3bb', silver: '#aab3bb', kek: '#214d81', blue: '#214d81', sotetkek: '#183451', sotetszurke: '#39434b', sotetzold: '#254437', piros: '#a9272c', red: '#a9272c',
  bordó: '#622b37', bordo: '#622b37', zold: '#365f4b', green: '#365f4b', sarga: '#d5ae31', yellow: '#d5ae31',
  narancs: '#c16c2c', orange: '#c16c2c', barna: '#675040', brown: '#675040', bezs: '#b9aa8d', beige: '#b9aa8d', lila: '#645477', purple: '#645477',
}
export function vehiclePaint(value: string | null): { hex: string; matched: boolean } {
  const text = (value ?? '').trim()
  const normalized = text.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f\s()-]/g, '').replace(/metalikus|metalfenyu|metal|gyongyhaz/g,'')
  if (/^#[\da-f]{6}$/i.test(text)) return { hex: text, matched: true }
  return { hex: colors[normalized] ?? '#8d9da4', matched: !!colors[normalized] }
}
