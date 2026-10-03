import { libraryItems } from './library'
import { curricula, reviewCards, reviewDecks } from './learning'
import { areas, decisions, projects, sessions, tasks } from './life'
import { annotations, highlights, questions } from './notes'
import { studyDays, subjects } from './study'
import type { MockData } from './types'

export const initialMockData: MockData = {
  libraryItems,
  curricula,
  reviewDecks,
  reviewCards,
  highlights,
  annotations,
  questions,
  areas,
  projects,
  decisions,
  tasks,
  sessions,
  subjects,
  studyDays
}
