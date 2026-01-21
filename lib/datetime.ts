const NEW_YORK_TZ = 'America/New_York'

const DEFAULT_DATE_TIME_OPTIONS: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  hour: 'numeric',
  minute: '2-digit',
  second: '2-digit',
}

const DEFAULT_DATE_OPTIONS: Intl.DateTimeFormatOptions = {
  year: 'numeric',
  month: 'short',
  day: 'numeric',
}

function ensureDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatNyDateTime(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_TIME_OPTIONS,
): string {
  const date = ensureDate(value)
  if (!date) return '—'
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK_TZ,
    hour12: true,
    ...options,
  })
  return `${formatter.format(date)} ET`
}

export function formatNyDate(
  value: string | number | Date | null | undefined,
  options: Intl.DateTimeFormatOptions = DEFAULT_DATE_OPTIONS,
): string {
  const date = ensureDate(value)
  if (!date) return '—'
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: NEW_YORK_TZ,
    ...options,
  })
  return formatter.format(date)
}

export function getNyDayKey(value: string | number | Date | null | undefined): string {
  const date = ensureDate(value)
  if (!date) return ''
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: NEW_YORK_TZ,
  }).format(date)
}

export function getCurrentNyTimestamp() {
  return formatNyDateTime(new Date())
}

export { NEW_YORK_TZ }
