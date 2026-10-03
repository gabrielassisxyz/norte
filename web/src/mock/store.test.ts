import { isReactive } from 'vue'
import { describe, expect, it } from 'vitest'

import { createMockStore } from './store'

describe('mock data integrity', () => {
  it('provides the promised amount of data', () => {
    const store = createMockStore()

    expect(store.libraryItems).toHaveLength(18)
    expect(new Set(store.libraryItems.map((item) => item.kind))).toEqual(new Set(['post', 'livro', 'paper', 'video', 'podcast', 'curso']))
    expect(store.curricula).toHaveLength(9)
    expect(store.curricula.filter((curriculum) => curriculum.status === 'active')).toHaveLength(2)
    expect(store.reviewDecks).toHaveLength(3)
    expect(store.reviewCards.filter((card) => card.dueAt === '2026-10-03')).toHaveLength(24)
    expect(store.areas).toHaveLength(6)
    expect(store.projects).toHaveLength(8)
    expect(store.decisions).toHaveLength(4)
    expect(store.tasks).toHaveLength(12)
    expect(store.highlights).toHaveLength(10)
    expect(store.annotations).toHaveLength(10)
    expect(store.questions).toHaveLength(10)
  })

  it('resolves every cross-reference', () => {
    const store = createMockStore()
    const libraryIds = new Set(store.libraryItems.map((item) => item.id))
    const curriculumSlugs = new Set(store.curricula.map((curriculum) => curriculum.slug))
    const deckIds = new Set(store.reviewDecks.map((deck) => deck.id))
    const areaIds = new Set(store.areas.map((area) => area.id))
    const projectIds = new Set(store.projects.map((project) => project.id))
    const taskIds = new Set(store.tasks.map((task) => task.id))
    const highlightIds = new Set(store.highlights.map((highlight) => highlight.id))

    for (const item of store.libraryItems) {
      if (item.curriculumSlug) expect(curriculumSlugs).toContain(item.curriculumSlug)
    }
    for (const curriculum of store.curricula) {
      for (const module of curriculum.modules) {
        for (const material of module.materials) expect(libraryIds).toContain(material.libraryItemId)
      }
    }
    for (const deck of store.reviewDecks) expect(curriculumSlugs).toContain(deck.curriculumSlug)
    for (const card of store.reviewCards) {
      expect(deckIds).toContain(card.deckId)
      expect(libraryIds).toContain(card.sourceLibraryItemId)
    }
    for (const note of [...store.highlights, ...store.annotations, ...store.questions]) {
      if (note.materialId) expect(libraryIds).toContain(note.materialId)
    }
    for (const annotation of store.annotations) {
      if (annotation.highlightId) expect(highlightIds).toContain(annotation.highlightId)
    }
    for (const project of store.projects) expect(areaIds).toContain(project.areaId)
    for (const task of store.tasks) expect(projectIds).toContain(task.projectId)
    for (const decision of store.decisions) {
      expect(projectIds).toContain(decision.projectId)
      for (const taskId of decision.blockedTaskIds) expect(taskIds).toContain(taskId)
      if (decision.selectedOptionId) expect(decision.options.map((option) => option.id)).toContain(decision.selectedOptionId)
    }
    for (const session of store.sessions) {
      expect(projectIds).toContain(session.projectId)
      if (session.taskId) {
        expect(taskIds).toContain(session.taskId)
        expect(store.tasks.find((task) => task.id === session.taskId)?.projectId).toBe(session.projectId)
      }
    }
  })
})

describe('mock store mutations', () => {
  it('is reactive and changes only the library item selected', () => {
    const store = createMockStore()
    const untouched = store.libraryItems.find((item) => item.id === 'post-typography')?.status

    expect(isReactive(store)).toBe(true)
    store.setLibraryItemStatus('post-compilation', 'arquivo')
    expect(store.libraryItems.find((item) => item.id === 'post-compilation')?.status).toBe('arquivo')
    expect(store.libraryItems.find((item) => item.id === 'post-typography')?.status).toBe(untouched)

    const saved = store.addSavedLink({ kind: 'post', title: 'Uma referência nova', author: 'Equipe Norte', url: 'https://example.com/new-reference' })
    expect(store.libraryItems[0]).toEqual(saved)
    expect(saved.status).toBe('inbox')
  })

  it('adds questions and rates the chosen card', () => {
    const store = createMockStore()
    const initialQuestions = store.questions.length
    const originalDueDate = store.reviewCards.find((card) => card.id === 'card-comp-1')?.dueAt

    const question = store.addQuestion({ kind: 'why', text: 'Por que este exemplo é útil?', materialId: 'post-compilation' })
    store.rateCard('card-comp-1', 'good')

    expect(store.questions).toHaveLength(initialQuestions + 1)
    expect(store.questions[0]).toEqual(question)
    expect(store.reviewCards.find((card) => card.id === 'card-comp-1')).toMatchObject({ lastRating: 'good', dueAt: '2026-10-17' })
    expect(store.reviewCards.find((card) => card.id === 'card-comp-2')?.dueAt).toBe(originalDueDate)
  })

  it('decides and postpones only the selected decisions', () => {
    const store = createMockStore()

    store.decideDecision('decision-backup-media', 'option-drive')
    store.postponeDecision('decision-budget-period', '2026-11-01')

    expect(store.decisions.find((decision) => decision.id === 'decision-backup-media')).toMatchObject({ status: 'decided', selectedOptionId: 'option-drive' })
    expect(store.decisions.find((decision) => decision.id === 'decision-budget-period')).toMatchObject({ status: 'postponed', postponedUntil: '2026-11-01' })
    expect(store.decisions.find((decision) => decision.id === 'decision-parser-shape')?.selectedOptionId).toBe('option-objects')
  })

  it('toggles a task step and completion independently', () => {
    const store = createMockStore()
    const task = store.tasks.find((candidate) => candidate.id === 'task-backup')!
    const otherTaskDone = store.tasks.find((candidate) => candidate.id === 'task-dns')?.completed

    store.toggleTaskStep(task.id, 'step-backup-2')
    store.toggleTaskDone(task.id)

    expect(task.steps.find((step) => step.id === 'step-backup-2')?.completed).toBe(true)
    expect(task.completed).toBe(true)
    expect(store.tasks.find((candidate) => candidate.id === 'task-dns')?.completed).toBe(otherTaskDone)
  })

  it('adds projects, tasks and sessions with their references intact', () => {
    const store = createMockStore()
    const project = store.addProject({ areaId: 'a-casa', title: 'Prateleira de ferramentas', purpose: 'Guardar ferramentas de uso frequente.', status: 'planning', priority: 'P3' })
    const task = store.addTask({ projectId: project.id, title: 'Medir a parede', description: 'Registrar altura e largura disponíveis.', priority: 'P3', bucket: 'next' })
    const session = store.addSession({ projectId: project.id, taskId: task.id, startedAt: '2026-10-03T18:00:00Z', durationMinutes: 25, summary: 'Medi a parede.' })

    expect(store.projects[0]).toEqual(project)
    expect(store.tasks[0]).toEqual(task)
    expect(store.sessions[0]).toEqual(session)
  })

  it('adds, edits and archives areas and edits curricula', () => {
    const store = createMockStore()
    const area = store.addArea({ title: 'Leitura pública', intention: 'Compartilhar leituras úteis.' })

    store.updateArea(area.id, { title: 'Leitura compartilhada', intention: 'Compartilhar leituras curtas.' })
    store.archiveArea(area.id)
    store.updateCurriculum('horta-caseira', { title: 'Horta doméstica', goal: 'Cultivar alimentos em vasos.', status: 'active' })

    expect(store.areas[0]).toMatchObject({ id: 'a-leitura-publica', title: 'Leitura compartilhada', archived: true })
    expect(store.curricula.find((curriculum) => curriculum.slug === 'horta-caseira')).toMatchObject({ title: 'Horta doméstica', status: 'active' })
  })

  it('adds highlights and annotations to existing material', () => {
    const store = createMockStore()
    const highlight = store.addHighlight({ materialId: 'post-compilation', text: 'Uma observação nova.' })
    const annotation = store.addAnnotation({ materialId: 'post-compilation', highlightId: highlight.id, text: 'Uma anotação nova.' })

    expect(store.highlights[0]).toEqual(highlight)
    expect(store.annotations[0]).toEqual(annotation)
  })
})
