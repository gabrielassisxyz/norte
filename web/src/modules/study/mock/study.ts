import { compactIsoDate } from '@/lib/clock'
import { daysAgo } from '@/mock/relative'
import type { StudyDay, Subject } from '@/mock/types'

export const STUDY_DAY_COUNT = 182

export const WEEKLY_FOCUS = 'Foco da semana: fechar Léxico e sintaxe e manter a revisão em dia.'

/** Subjects grouping library material across curricula (neutral invented data). */
export const subjects: Subject[] = [
  {
    id: 'computacao',
    name: 'Computação',
    curricula: 2,
    courses: 4,
    articles: 12,
    videos: 6,
    notes: 38,
    questions: 9,
    activity: 'hoje'
  },
  {
    id: 'tipografia',
    name: 'Tipografia',
    curricula: 1,
    courses: 2,
    articles: 8,
    videos: 3,
    notes: 21,
    questions: 4,
    activity: 'há 1d'
  },
  {
    id: 'culinaria',
    name: 'Culinária',
    curricula: 1,
    courses: 2,
    articles: 3,
    videos: 7,
    notes: 12,
    questions: 2,
    activity: 'há 2d'
  },
  {
    id: 'jardinagem',
    name: 'Jardinagem',
    curricula: 1,
    courses: 1,
    articles: 5,
    videos: 2,
    notes: 9,
    questions: 3,
    activity: 'há 4d'
  },
  {
    id: 'desenho',
    name: 'Desenho',
    curricula: 1,
    courses: 1,
    articles: 2,
    videos: 5,
    notes: 7,
    questions: 1,
    activity: 'há 1sem'
  },
  {
    id: 'organizacao',
    name: 'Organização',
    curricula: 2,
    courses: 2,
    articles: 4,
    videos: 1,
    notes: 11,
    questions: 2,
    activity: 'há 2sem'
  }
]

// Deterministic activity for the last 26 weeks, ending on the day the app is
// opened: an LCG picks a study volume, then two stretches are pinned so the
// band tells a streak story — a record run in the middle and the current run
// ending with today still open. The seed is the day itself, so the band is
// stable for as long as the day is.
export function buildStudyDays(today: string): StudyDay[] {
  let seed = Number(compactIsoDate(today))
  const random = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648
    return seed / 2147483648
  }

  const days: StudyDay[] = []
  for (let index = 0; index < STUDY_DAY_COUNT; index += 1) {
    const roll = random()
    const minutes = roll < 0.25 ? 0 : roll < 0.5 ? 15 : roll < 0.7 ? 40 : roll < 0.9 ? 75 : 130
    days.push({
      date: daysAgo(today, STUDY_DAY_COUNT - 1 - index),
      minutes,
      completed: minutes > 0 && index % 3 === 0 ? 1 : 0
    })
  }

  const pinActive = (from: number, to: number): void => {
    for (let index = from; index <= to; index += 1) {
      days[index].minutes = Math.max(days[index].minutes, 20)
    }
  }
  // A record run of 57 days, bounded by rest days on both sides.
  days[29].minutes = 0
  days[29].completed = 0
  pinActive(30, 86)
  days[87].minutes = 0
  days[87].completed = 0
  // The current run: active every day, with today still open.
  days[138].minutes = 0
  days[138].completed = 0
  pinActive(139, 180)
  days[181].minutes = 0
  days[181].completed = 0

  return days
}

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
