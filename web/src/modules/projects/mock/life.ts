import { daysAhead, timestampDaysAgo } from '@/mock/relative'
import type { Area, Decision, Project, Session, Task } from '@/mock/types'

export const areas: Area[] = [
  { id: 'a-casa', title: 'Home', intention: 'Keep the living space functional and welcoming.', archived: false },
  { id: 'a-aprendizagem', title: 'Learning', intention: 'Turn curiosity into practice.', archived: false },
  { id: 'a-tecnologia', title: 'Technology', intention: 'Look after local tools.', archived: false },
  { id: 'a-saude', title: 'Wellbeing', intention: 'Keep energy up through the week.', archived: false },
  { id: 'a-financas', title: 'Resources', intention: 'Make simple decisions with clarity.', archived: false },
  { id: 'a-criacao', title: 'Making', intention: 'Keep room for making things.', archived: true }
]

export const projects: Project[] = [
  { id: 'project-servidor-caseiro', areaId: 'a-tecnologia', title: 'Home server', purpose: 'Host useful services on the local network.', status: 'active', priority: 'P1', features: [{ id: 'feature-backup', title: 'Set up backups', complete: false }], bugs: [{ id: 'bug-dns', title: 'Fix local DNS failure', resolved: false }] },
  { id: 'project-horta', areaId: 'a-casa', title: 'Balcony garden', purpose: 'Grow greens and herbs for weekly use.', status: 'active', priority: 'P2', features: [{ id: 'feature-irrigation', title: 'Set up simple irrigation', complete: false }], bugs: [] },
  { id: 'project-estudo-compiladores', areaId: 'a-aprendizagem', title: 'Expression interpreter', purpose: 'Apply compiler fundamentals.', status: 'active', priority: 'P1', features: [{ id: 'feature-parser', title: 'Parse expressions with precedence', complete: true }], bugs: [{ id: 'bug-errors', title: 'Show errors without ending the session', resolved: false }] },
  { id: 'project-orcamento', areaId: 'a-financas', title: 'Monthly budget', purpose: 'Track recurring expenses.', status: 'planning', priority: 'P2', features: [{ id: 'feature-categories', title: 'Set essential categories', complete: false }], bugs: [] },
  { id: 'project-caminhadas', areaId: 'a-saude', title: 'Walking route', purpose: 'Build a short loop for weekdays.', status: 'planning', priority: 'P3', features: [], bugs: [] },
  { id: 'project-atelier', areaId: 'a-criacao', title: 'Drawing desk', purpose: 'Set up a corner for observation sketches.', status: 'paused', priority: 'P3', features: [{ id: 'feature-light', title: 'Pick a lamp', complete: false }], bugs: [] },
  { id: 'project-despensa', areaId: 'a-casa', title: 'Pantry inventory', purpose: 'Avoid duplicate purchases.', status: 'completed', priority: 'P3', features: [{ id: 'feature-list', title: 'Make a restock list', complete: true }], bugs: [] },
  { id: 'project-notas-estudo', areaId: 'a-aprendizagem', title: 'Study notebook', purpose: 'Keep questions and reviews in one place.', status: 'active', priority: 'P2', features: [{ id: 'feature-questions', title: 'Sort questions by topic', complete: false }], bugs: [] }
]

export const tasks: Task[] = [
  { id: 'task-backup', projectId: 'project-servidor-caseiro', title: 'Decide backup destinations', description: 'Choose where each copy will live.', priority: 'P1', bucket: 'today', completed: false, steps: [{ id: 'step-backup-1', title: 'List important data', completed: true }, { id: 'step-backup-2', title: 'Pick a second destination', completed: false }] },
  { id: 'task-dns', projectId: 'project-servidor-caseiro', title: 'Test local names', description: 'Check resolution on two devices.', priority: 'P1', bucket: 'next', completed: false, steps: [{ id: 'step-dns-1', title: 'Note expected names', completed: false }] },
  { id: 'task-sementes', projectId: 'project-horta', title: 'Sort leaf seeds', description: 'Pick varieties that fit the space.', priority: 'P2', bucket: 'today', completed: false, steps: [{ id: 'step-seeds-1', title: 'Measure the balcony', completed: false }] },
  { id: 'task-vasos', projectId: 'project-horta', title: 'Reuse spare pots', description: 'Clean the pots before planting.', priority: 'P3', bucket: 'later', completed: false, steps: [{ id: 'step-pots-1', title: 'Wash the pots', completed: false }] },
  { id: 'task-parser', projectId: 'project-estudo-compiladores', title: 'Write precedence cases', description: 'Cover addition, multiplication and parentheses.', priority: 'P1', bucket: 'today', completed: false, steps: [{ id: 'step-parser-1', title: 'List expressions', completed: true }, { id: 'step-parser-2', title: 'Add expectations', completed: false }] },
  { id: 'task-errors', projectId: 'project-estudo-compiladores', title: 'Describe input errors', description: 'Keep feedback useful for study.', priority: 'P2', bucket: 'next', completed: false, steps: [{ id: 'step-errors-1', title: 'Write a message for invalid tokens', completed: false }] },
  { id: 'task-categories', projectId: 'project-orcamento', title: 'Group recent expenses', description: 'Use categories that help decide.', priority: 'P2', bucket: 'next', completed: false, steps: [{ id: 'step-categories-1', title: 'Read the weekly statement', completed: false }] },
  { id: 'task-route', projectId: 'project-caminhadas', title: 'Measure a twenty-minute route', description: 'Find a loop with quiet sidewalks.', priority: 'P3', bucket: 'later', completed: false, steps: [{ id: 'step-route-1', title: 'Mark turnaround points', completed: false }] },
  { id: 'task-light', projectId: 'project-atelier', title: 'Measure the desk area', description: 'Confirm space before picking a light.', priority: 'P3', bucket: 'someday', completed: false, steps: [{ id: 'step-light-1', title: 'Measure width', completed: false }] },
  { id: 'task-list', projectId: 'project-despensa', title: 'Review the restock list', description: 'Remove items no longer used.', priority: 'P3', bucket: 'later', completed: true, steps: [{ id: 'step-list-1', title: 'Compare against the pantry', completed: true }] },
  { id: 'task-question-tags', projectId: 'project-notas-estudo', title: 'Define question topics', description: 'Make a short list of recurring topics.', priority: 'P2', bucket: 'today', completed: false, steps: [{ id: 'step-tags-1', title: 'Read open questions', completed: false }] },
  { id: 'task-review-format', projectId: 'project-notas-estudo', title: 'Test a review format', description: 'Try a short card sequence.', priority: 'P2', bucket: 'next', completed: false, steps: [{ id: 'step-format-1', title: 'Set aside five cards', completed: false }] }
]

/** The dated records are relative to the clock; the rest of this slice is not dated at all. */
export function buildDecisions(today: string): Decision[] {
  return [
    { id: 'decision-backup-media', projectId: 'project-servidor-caseiro', title: 'Choose media for the off-site copy', context: 'The copy should be able to leave the house from time to time.', createdAt: timestampDaysAgo(today, 6, 9), status: 'open', options: [{ id: 'option-drive', title: 'Portable drive', rationale: 'Easy to carry and review.' }, { id: 'option-cloud', title: 'Remote storage', rationale: 'Available without travel.' }], blockedTaskIds: ['task-backup'] },
    { id: 'decision-garden-layout', projectId: 'project-horta', title: 'Decide the pot layout', context: 'Light shifts along the balcony.', createdAt: timestampDaysAgo(today, 9, 9), status: 'postponed', options: [{ id: 'option-row', title: 'Single row', rationale: 'Makes watering easy.' }, { id: 'option-groups', title: 'Groups by need', rationale: 'Keeps similar plants together.' }], blockedTaskIds: ['task-sementes'], postponedUntil: daysAhead(today, 9) },
    { id: 'decision-parser-shape', projectId: 'project-estudo-compiladores', title: 'Choose the syntax tree shape', context: 'The exercises need an explicit structure.', createdAt: timestampDaysAgo(today, 12, 9), status: 'decided', options: [{ id: 'option-objects', title: 'Tagged objects', rationale: 'Keeps each node simple.' }, { id: 'option-classes', title: 'Classes per node', rationale: 'Keeps future behavior with the data.' }], selectedOptionId: 'option-objects', blockedTaskIds: ['task-parser', 'task-errors'] },
    { id: 'decision-budget-period', projectId: 'project-orcamento', title: 'Choose the tracking period', context: 'Tracking should stay light enough to keep up.', createdAt: timestampDaysAgo(today, 4, 9), status: 'open', options: [{ id: 'option-month', title: 'Calendar month', rationale: 'Matches recurring bills.' }, { id: 'option-payday', title: 'Paycheck to paycheck', rationale: 'Follows money as it arrives.' }], blockedTaskIds: ['task-categories'] }
  ]
}

export function buildSessions(today: string): Session[] {
  return [
    { id: 'session-1', projectId: 'project-estudo-compiladores', taskId: 'task-parser', startedAt: timestampDaysAgo(today, 2, 19), durationMinutes: 45, summary: 'Listed expressions that need parentheses.' },
    { id: 'session-2', projectId: 'project-horta', taskId: 'task-sementes', startedAt: timestampDaysAgo(today, 2, 16), durationMinutes: 20, summary: 'Measured the available area.' }
  ]
}
