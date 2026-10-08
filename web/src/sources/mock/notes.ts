import type { MockStore } from '@/mock/store'
import type { Annotation, Highlight, LibraryItem, Question } from '@/mock/types'
import type {
  NoteRecord,
  NoteSourceRef,
  NoteTab,
  NotesCounts,
  NotesList,
  NotesSource
} from '@/modules/notes/data/source'

import { answer, searchMatches } from './respond'

export function createMockNotesSource(store: MockStore): NotesSource {
  function sourceRef(materialId: string | undefined): NoteSourceRef | undefined {
    if (!materialId) return undefined
    const item: LibraryItem | undefined = store.libraryItems.find((candidate) => candidate.id === materialId)
    if (!item) return undefined
    return { id: item.id, kind: item.kind, title: item.title, author: item.author }
  }

  function fromHighlight(highlight: Highlight): NoteRecord {
    return {
      id: highlight.id,
      tab: 'highlights',
      text: highlight.text,
      createdAt: highlight.createdAt,
      source: sourceRef(highlight.materialId)
    }
  }

  function fromAnnotation(annotation: Annotation): NoteRecord {
    const quote = annotation.highlightId
      ? store.highlights.find((highlight) => highlight.id === annotation.highlightId)?.text
      : undefined
    return {
      id: annotation.id,
      tab: 'anotacoes',
      text: annotation.text,
      createdAt: annotation.createdAt,
      ...(quote ? { quote } : {}),
      source: sourceRef(annotation.materialId)
    }
  }

  function fromQuestion(question: Question): NoteRecord {
    return {
      id: question.id,
      tab: 'perguntas',
      text: question.text,
      createdAt: question.createdAt,
      questionKind: question.kind,
      answer: question.answer,
      source: sourceRef(question.materialId)
    }
  }

  function counts(): NotesCounts {
    return {
      highlights: store.highlights.length,
      anotacoes: store.annotations.length,
      perguntas: store.questions.length
    }
  }

  function rowsFor(tab: NoteTab): NoteRecord[] {
    if (tab === 'highlights') return store.highlights.map(fromHighlight)
    if (tab === 'anotacoes') return store.annotations.map(fromAnnotation)
    return store.questions.map(fromQuestion)
  }

  return {
    listNotes(query: { tab: NoteTab; search?: string }, signal: AbortSignal): Promise<NotesList> {
      return answer(() => {
        const items = rowsFor(query.tab).filter((note) =>
          searchMatches(query.search ?? '', note.text, note.source?.title, note.source?.author)
        )
        return { items, next_cursor: null, counts: counts() }
      }, signal)
    },

    materialNotes(materialId: string, signal: AbortSignal) {
      return answer(
        () => ({
          highlights: store.highlights.filter((highlight) => highlight.materialId === materialId),
          annotations: store.annotations.filter((annotation) => annotation.materialId === materialId)
        }),
        signal
      )
    },

    summary(signal: AbortSignal) {
      return answer(counts, signal)
    },

    addQuestion(question) {
      return answer(() => fromQuestion(store.addQuestion(question)))
    },

    addHighlight(highlight) {
      return answer(() => store.addHighlight(highlight))
    },

    addAnnotation(annotation) {
      return answer(() => store.addAnnotation(annotation))
    }
  }
}
