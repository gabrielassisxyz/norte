import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  clockTimeZone,
  compactIsoDate,
  daysBetweenIsoDates,
  formatDayAge,
  formatLongWeekdayDate,
  formatMonthName,
  formatRelativeDay,
  formatShortDate,
  formatTimeOfDay,
  nowTimestamp,
  setClockTimeZone,
  shiftIsoDate,
  todayIsoDate
} from './clock'

afterEach(() => {
  setClockTimeZone('UTC')
  vi.useRealTimers()
})

describe('the configured zone decides which day it is', () => {
  // 23:30 in São Paulo is already the next day in UTC, which is the case a
  // browser in the wrong zone gets wrong.
  const instant = new Date('2026-10-04T02:30:00Z')

  it('reads the date in the configured zone, not the browser\'s', () => {
    setClockTimeZone('America/Sao_Paulo')
    expect(todayIsoDate(instant)).toBe('2026-10-03')

    setClockTimeZone('UTC')
    expect(todayIsoDate(instant)).toBe('2026-10-04')
  })

  it('defaults to UTC and reports the zone it was given', () => {
    expect(clockTimeZone()).toBe('UTC')
    setClockTimeZone('Asia/Tokyo')
    expect(clockTimeZone()).toBe('Asia/Tokyo')
    expect(todayIsoDate(instant)).toBe('2026-10-04')
  })

  it('falls back to UTC when the config reports no zone', () => {
    setClockTimeZone('')
    expect(clockTimeZone()).toBe('UTC')
  })

  it('takes today from the system clock when given no instant', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2027-02-01T12:00:00Z'))
    expect(todayIsoDate()).toBe('2027-02-01')
    vi.setSystemTime(new Date('2027-02-02T12:00:00Z'))
    expect(todayIsoDate()).toBe('2027-02-02')
  })

  it('timestamps an instant without a zone', () => {
    setClockTimeZone('America/Sao_Paulo')
    expect(nowTimestamp(instant)).toBe('2026-10-04T02:30:00.000Z')
  })
})

describe('date arithmetic', () => {
  it('shifts a date forwards and backwards across month ends', () => {
    expect(shiftIsoDate('2026-10-03', -4)).toBe('2026-09-29')
    expect(shiftIsoDate('2026-10-03', 7)).toBe('2026-10-10')
    expect(shiftIsoDate('2026-02-28', 1)).toBe('2026-03-01')
  })

  it('counts whole days between two dates, signed', () => {
    expect(daysBetweenIsoDates('2026-09-29', '2026-10-03')).toBe(4)
    expect(daysBetweenIsoDates('2026-10-03', '2026-09-29')).toBe(-4)
    expect(daysBetweenIsoDates('2026-10-03', '2026-10-03')).toBe(0)
  })

  it('leaves text that is not a date alone', () => {
    expect(shiftIsoDate('nunca', 3)).toBe('nunca')
    expect(daysBetweenIsoDates('nunca', '2026-10-03')).toBe(0)
    expect(formatShortDate('nunca')).toBe('nunca')
  })
})

describe('Portuguese formatting', () => {
  it('writes the home title the way the screen shows it', () => {
    expect(formatLongWeekdayDate('2026-10-03')).toBe('Sábado, 3 de outubro')
    expect(formatLongWeekdayDate('2026-10-04')).toBe('Domingo, 4 de outubro')
  })

  it('names a month and a short date', () => {
    expect(formatMonthName('2026-10-03')).toBe('outubro')
    expect(formatShortDate('2026-09-09')).toBe('9 set')
  })

  it('says hoje and ontem before falling back to a date', () => {
    expect(formatRelativeDay('2026-10-03', '2026-10-03')).toBe('hoje')
    expect(formatRelativeDay('2026-10-02', '2026-10-03')).toBe('ontem')
    expect(formatRelativeDay('2026-09-20', '2026-10-03')).toBe('20 set')
  })

  it('ages a record in whole days, never negative', () => {
    expect(formatDayAge('2026-09-19', '2026-10-03')).toBe('14 d')
    expect(formatDayAge('2026-10-09', '2026-10-03')).toBe('0 d')
  })

  it('reads the wall-clock time of an instant in the configured zone', () => {
    setClockTimeZone('America/Sao_Paulo')
    expect(formatTimeOfDay('2026-10-03T12:00:00Z')).toBe('09:00')
    setClockTimeZone('UTC')
    expect(formatTimeOfDay('2026-10-03T12:00:00Z')).toBe('12:00')
    expect(formatTimeOfDay('agora')).toBe('agora')
  })

  it('strips the separators for a key or a seed', () => {
    expect(compactIsoDate('2026-10-03')).toBe('20261003')
  })
})
