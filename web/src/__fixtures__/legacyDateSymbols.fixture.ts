import { shiftIsoDate, todayIsoDate } from '@/lib/clock'

/**
 * A planted violation: the five constants through which the app used to decide
 * what day it was. See `README.md` in this folder.
 */
export const TODAY = todayIsoDate()
export const MOCK_TODAY = todayIsoDate()
export const STUDY_TODAY = todayIsoDate()
export const DEFAULT_DUE_DATE = shiftIsoDate(todayIsoDate(), 7)
export const AGE_BY_DATE: Record<string, number> = {}
