import { createStandInLibraryItem } from '@/mock/standins'
import { timestampDaysAgo } from '@/mock/relative'
import type { Annotation, Highlight, LibraryItem, Question } from '@/mock/types'

const NOTE_MATERIAL_IDS = ['post-compilation', 'book-interpreters', 'post-typography', 'paper-reading', 'book-garden']
const NOTE_COUNT = 10
/** The oldest note; the rest march forward one day at a time towards today. */
const OLDEST_NOTE_DAYS_AGO = 23

const questionKinds: Question['kind'][] = ['what', 'why', 'who', 'when', 'where', 'how']

function noteDate(today: string, index: number, hour: number): string {
  return timestampDaysAgo(today, OLDEST_NOTE_DAYS_AGO - index, hour)
}

export function buildHighlights(today: string): Highlight[] {
  return Array.from({ length: NOTE_COUNT }, (_, index) => ({
    id: `highlight-${index + 1}`,
    materialId: NOTE_MATERIAL_IDS[index % NOTE_MATERIAL_IDS.length],
    text: `Ideia marcada ${index + 1}: observe o exemplo antes de tirar uma conclusão.`,
    createdAt: noteDate(today, index, 10)
  }))
}

export function buildAnnotations(today: string): Annotation[] {
  return Array.from({ length: NOTE_COUNT }, (_, index) => ({
    id: `annotation-${index + 1}`,
    materialId: NOTE_MATERIAL_IDS[index % NOTE_MATERIAL_IDS.length],
    highlightId: index % 2 === 0 ? `highlight-${index + 1}` : undefined,
    text: `Anotação ${index + 1}: testar esta ideia em uma atividade pequena.`,
    createdAt: noteDate(today, index, 11)
  }))
}

export function buildQuestions(today: string): Question[] {
  return Array.from({ length: NOTE_COUNT }, (_, index) => ({
    id: `question-${index + 1}`,
    materialId: NOTE_MATERIAL_IDS[index % NOTE_MATERIAL_IDS.length],
    kind: questionKinds[index % questionKinds.length],
    text: `Como aplicar o conceito ${index + 1} em uma situação cotidiana?`,
    answer: index % 3 === 0 ? `Uma resposta inicial para a pergunta ${index + 1}.` : undefined,
    createdAt: noteDate(today, index, 12)
  }))
}

/** Stand-ins for the library items the highlights, annotations and questions sit on. */
export function buildNotesReferencedItems(today: string): LibraryItem[] {
  return NOTE_MATERIAL_IDS.map((id) => createStandInLibraryItem(id, today))
}
