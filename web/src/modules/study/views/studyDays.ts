import type { StudyDay } from '@/mock/types'

/**
 * The arithmetic the study home does over its own days: streaks, hours and the
 * level each square of the grid is drawn at.
 *
 * It lives beside the screen rather than beside the seed data it was written
 * against, because none of it is invented data: every function here reads the
 * days the source answered with, and it survives the mock being replaced.
 */
export function isActiveDay(day: StudyDay): boolean {
  return day.minutes > 0
}

/** Streak-grid level (0-4) for a day's study volume. */
export function levelForMinutes(minutes: number): number {
  if (!Number.isFinite(minutes) || minutes <= 0) return 0
  if (minutes < 20) return 1
  if (minutes < 45) return 2
  if (minutes < 90) return 3
  return 4
}

/**
 * Length of the trailing run of active days. Trailing inactive days are
 * skipped, so a today that is still open does not break the streak; a gap
 * before that ends it.
 */
export function currentStreak(days: StudyDay[]): number {
  let index = days.length - 1
  while (index >= 0 && !isActiveDay(days[index])) index -= 1
  let streak = 0
  while (index >= 0 && isActiveDay(days[index])) {
    streak += 1
    index -= 1
  }
  return streak
}

/** Length of the longest run of active days. */
export function recordStreak(days: StudyDay[]): number {
  let record = 0
  let run = 0
  for (const day of days) {
    if (isActiveDay(day)) {
      run += 1
      record = Math.max(record, run)
    } else {
      run = 0
    }
  }
  return record
}

/** Hours studied over the trailing `window` days (default 7). */
export function hoursInWindow(days: StudyDay[], window = 7): number {
  const slice = days.slice(Math.max(0, days.length - window))
  return slice.reduce((total, day) => total + day.minutes, 0) / 60
}

/** Items completed in the calendar month of the last day. */
export function completedThisMonth(days: StudyDay[]): { month: string; total: number } {
  const last = days[days.length - 1]
  const month = last === undefined ? '' : last.date.slice(0, 7)
  const total = days
    .filter((day) => day.date.startsWith(month))
    .reduce((sum, day) => sum + day.completed, 0)
  return { month, total }
}
