import { describe, expect, it } from 'vitest'

import type { StudyDay } from '@/mock/types'
import {
  STUDY_DAY_COUNT,
  completedThisMonth,
  currentStreak,
  hoursInWindow,
  levelForMinutes,
  recordStreak,
  studyDays,
  subjects
} from './study'

const day = (date: string, minutes: number, completed = 0): StudyDay => ({ date, minutes, completed })

const FIXTURE: StudyDay[] = [
  day('2026-09-27', 0),
  day('2026-09-28', 30),
  day('2026-09-29', 60, 2),
  day('2026-09-30', 45, 1),
  day('2026-10-01', 20),
  day('2026-10-02', 50, 1),
  day('2026-10-03', 0)
]

describe('study streak helpers', () => {
  it('counts the trailing run and skips a today that is still open', () => {
    expect(currentStreak(FIXTURE)).toBe(5)
    expect(currentStreak([...FIXTURE.slice(0, -1), day('2026-10-03', 10)])).toBe(6)
    expect(currentStreak([day('2026-10-01', 0), day('2026-10-02', 0)])).toBe(0)
    expect(currentStreak([])).toBe(0)
  })

  it('stops the streak at a gap even with trailing rest days', () => {
    const days = [...FIXTURE.slice(0, 5), day('2026-10-02', 0), day('2026-10-03', 0)]
    expect(currentStreak(days)).toBe(4)
  })

  it('finds the longest run anywhere in the window', () => {
    expect(recordStreak(FIXTURE)).toBe(5)
    expect(recordStreak([day('2026-10-01', 10), day('2026-10-02', 0), day('2026-10-03', 10)])).toBe(1)
    expect(recordStreak([])).toBe(0)
  })
})

describe('study volume helpers', () => {
  it('sums the trailing window as hours', () => {
    expect(hoursInWindow(FIXTURE)).toBeCloseTo(205 / 60, 6)
    expect(hoursInWindow(FIXTURE, 3)).toBeCloseTo(70 / 60, 6)
    expect(hoursInWindow([])).toBe(0)
  })

  it('totals completions in the last day’s month', () => {
    expect(completedThisMonth(FIXTURE)).toEqual({ month: '2026-10', total: 1 })
    expect(completedThisMonth(FIXTURE.slice(0, 4))).toEqual({ month: '2026-09', total: 3 })
  })

  it('maps minutes to grid levels', () => {
    expect([0, 10, 19, 20, 44, 45, 89, 90, 200].map(levelForMinutes)).toEqual([0, 1, 1, 2, 2, 3, 3, 4, 4])
  })
})

describe('study mock data', () => {
  it('covers 182 days ending on the mock today with six subjects', () => {
    expect(studyDays).toHaveLength(STUDY_DAY_COUNT)
    expect(studyDays[0].date).toBe('2026-04-05')
    expect(studyDays[STUDY_DAY_COUNT - 1].date).toBe('2026-10-03')
    expect(subjects).toHaveLength(6)
    for (const subject of subjects) {
      expect(subject.name).toBeTruthy()
      expect(subject.activity).toBeTruthy()
    }
  })

  it('ends with a live streak below its record', () => {
    expect(currentStreak(studyDays)).toBe(42)
    expect(recordStreak(studyDays)).toBe(57)
  })
})
