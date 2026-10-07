import { createStandInLibraryItem } from '@/mock/standins'
import type { Annotation, Highlight, LibraryItem, Question } from '@/mock/types'

export const highlights: Highlight[] = Array.from({ length: 10 }, (_, index) => ({
  id: `highlight-${index + 1}`,
  materialId: ['post-compilation', 'book-interpreters', 'post-typography', 'paper-reading', 'book-garden'][index % 5],
  text: `Ideia marcada ${index + 1}: observe o exemplo antes de tirar uma conclusão.`,
  createdAt: `2026-09-${String(10 + index).padStart(2, '0')}T10:00:00Z`
}))

export const annotations: Annotation[] = Array.from({ length: 10 }, (_, index) => ({
  id: `annotation-${index + 1}`,
  materialId: ['post-compilation', 'book-interpreters', 'post-typography', 'paper-reading', 'book-garden'][index % 5],
  highlightId: index % 2 === 0 ? `highlight-${index + 1}` : undefined,
  text: `Anotação ${index + 1}: testar esta ideia em uma atividade pequena.`,
  createdAt: `2026-09-${String(10 + index).padStart(2, '0')}T11:00:00Z`
}))

const questionKinds: Question['kind'][] = ['what', 'why', 'who', 'when', 'where', 'how']

export const questions: Question[] = Array.from({ length: 10 }, (_, index) => ({
  id: `question-${index + 1}`,
  materialId: ['post-compilation', 'book-interpreters', 'post-typography', 'paper-reading', 'book-garden'][index % 5],
  kind: questionKinds[index % questionKinds.length],
  text: `Como aplicar o conceito ${index + 1} em uma situação cotidiana?`,
  answer: index % 3 === 0 ? `Uma resposta inicial para a pergunta ${index + 1}.` : undefined,
  createdAt: `2026-09-${String(10 + index).padStart(2, '0')}T12:00:00Z`
}))

/** Stand-ins for the library items the highlights, annotations and questions sit on. */
export const notesReferencedItems: LibraryItem[] = [
  ...new Set(
    [...highlights, ...annotations, ...questions]
      .map((note) => note.materialId)
      .filter((id): id is string => Boolean(id))
  )
].map(createStandInLibraryItem)
