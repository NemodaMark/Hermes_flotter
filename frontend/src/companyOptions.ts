const preferredTimeZones = ['Europe/Budapest', 'UTC', 'Europe/Vienna', 'Europe/London']
const preferredCurrencies = ['HUF', 'EUR', 'USD', 'GBP', 'CHF']

export const timeZones = [...new Set([...preferredTimeZones, ...Intl.supportedValuesOf('timeZone')])]
export const currencies = [...new Set([...preferredCurrencies, ...Intl.supportedValuesOf('currency')])]

const currencyNames = new Intl.DisplayNames('hu', { type: 'currency' })
export const currencyLabel = (code: string) => `${code} – ${currencyNames.of(code) ?? code}`
export const timeZoneLabel = (zone: string) =>
  zone === 'UTC'
    ? 'Egyezményes világidő (UTC)'
    : zone.includes('/')
      ? `${zone.split('/').at(-1)!.replaceAll('_', ' ')} (${zone})`
      : zone

// Keep a previously saved value selectable, including Windows time zone names.
export const withCurrentValue = (values: string[], current: string) =>
  values.includes(current) ? values : [current, ...values]
