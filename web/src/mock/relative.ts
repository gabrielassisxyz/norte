import { shiftIsoDate } from '@/lib/clock'

/**
 * Mock records are dated relative to the clock, never against a day written
 * into the file: a fixed seed date makes the whole app read as abandoned
 * ("salvo em 3 out") the week after it is written, and makes "hoje" a lie on
 * every screen that compares against it. Each slice says how long ago its
 * record happened, and the clock turns that into a date.
 */
export function daysAgo(today: string, days: number): string {
  return shiftIsoDate(today, -days)
}

export function daysAhead(today: string, days: number): string {
  return shiftIsoDate(today, days)
}

/** A record's timestamp, that many days ago at a fixed hour of the day. */
export function timestampDaysAgo(today: string, days: number, hour = 10): string {
  return `${daysAgo(today, days)}T${String(hour).padStart(2, '0')}:00:00Z`
}
