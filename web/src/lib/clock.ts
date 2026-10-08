import { reactive } from 'vue'

/**
 * The app's calendar.
 *
 * Every "today", age and due date in the UI is read from here, and never from a
 * literal written into a screen: the calendar the user lives in is the server's
 * one, which `GET /api/config` reports as an IANA zone. A browser in another
 * zone — or a phone that crossed midnight before the server did — has to render
 * the day the server is on, so the zone is configuration and only the instant
 * comes from the machine's clock.
 */
const state = reactive<{ timeZone: string }>({ timeZone: 'UTC' })

const DAY_IN_MILLISECONDS = 24 * 60 * 60 * 1000
const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})/

const MONTH_ABBREVIATIONS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** Point the calendar at the zone `/api/config` reported. */
export function setClockTimeZone(timeZone: string): void {
  state.timeZone = timeZone || 'UTC'
}

export function clockTimeZone(): string {
  return state.timeZone
}

/** The calendar date the configured zone is on at `instant`, as `YYYY-MM-DD`. */
export function todayIsoDate(instant: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: state.timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(instant)
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]))
  return `${fields.year}-${fields.month}-${fields.day}`
}

/**
 * The instant, as the timestamp a record carries. An instant is the same
 * everywhere, so this one is deliberately zone-free.
 */
export function nowTimestamp(instant: Date = new Date()): string {
  return instant.toISOString()
}

/** Midnight UTC of an ISO date, which is how dates compare and shift here. */
function isoDateValue(isoDate: string): number | null {
  const match = ISO_DATE.exec(isoDate)
  if (!match) return null
  const [, year, month, day] = match
  const value = Date.UTC(Number(year), Number(month) - 1, Number(day))
  const parsed = new Date(value)
  if (parsed.getUTCMonth() !== Number(month) - 1 || parsed.getUTCDate() !== Number(day)) return null
  return value
}

export function shiftIsoDate(isoDate: string, days: number): string {
  const value = isoDateValue(isoDate)
  if (value === null) return isoDate
  return new Date(value + days * DAY_IN_MILLISECONDS).toISOString().slice(0, 10)
}

/** Whole days from `from` to `to`; negative when `to` is the earlier date. */
export function daysBetweenIsoDates(from: string, to: string): number {
  const start = isoDateValue(from)
  const end = isoDateValue(to)
  if (start === null || end === null) return 0
  return Math.round((end - start) / DAY_IN_MILLISECONDS)
}

/** "Sábado, 3 de outubro" — the home screen's own title. */
export function formatLongWeekdayDate(isoDate: string): string {
  const value = isoDateValue(isoDate)
  if (value === null) return isoDate
  const text = new Intl.DateTimeFormat('pt-BR', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC'
  }).format(new Date(value))
  return text.replace(/^./, (letter) => letter.toLocaleUpperCase('pt-BR'))
}

/** "outubro", for a band labelled by the month it covers. */
export function formatMonthName(isoDate: string): string {
  const value = isoDateValue(isoDate)
  if (value === null) return isoDate
  return new Intl.DateTimeFormat('pt-BR', { month: 'long', timeZone: 'UTC' }).format(new Date(value))
}

/** "3 out" — a date short enough for a list row. */
export function formatShortDate(isoDate: string): string {
  const match = ISO_DATE.exec(isoDate)
  if (!match) return isoDate
  const [, , month, day] = match
  return `${Number(day)} ${MONTH_ABBREVIATIONS[Number(month) - 1] ?? month}`
}

/** "hoje", "ontem", or the short date once a record stops being recent. */
export function formatRelativeDay(isoDate: string, today: string): string {
  if (isoDateValue(isoDate) === null) return isoDate
  const days = daysBetweenIsoDates(isoDate, today)
  if (days <= 0) return 'hoje'
  if (days === 1) return 'ontem'
  return formatShortDate(isoDate)
}

/** "14 d" — how old a note is, in whole days. */
export function formatDayAge(isoDate: string, today: string): string {
  return `${Math.max(0, daysBetweenIsoDates(isoDate, today))} d`
}

/** The wall-clock time of an instant in the configured zone, as `HH:MM`. */
export function formatTimeOfDay(timestamp: string): string {
  const parsed = new Date(timestamp)
  if (Number.isNaN(parsed.getTime())) return timestamp
  return new Intl.DateTimeFormat('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: state.timeZone
  }).format(parsed)
}

/** `YYYYMMDD`, for a seed or a key that wants a date without separators. */
export function compactIsoDate(isoDate: string): string {
  return isoDate.replace(/-/g, '')
}
