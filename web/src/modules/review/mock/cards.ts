import { createStandInLibraryItem } from '@/mock/standins'
import type { LibraryItem, ReviewCard, ReviewDeck } from '@/mock/types'

export const reviewDecks: ReviewDeck[] = [
  { id: 'deck-compiladores', title: 'Building languages', curriculumSlug: 'compiler-fundamentals', description: 'Parsing and execution concepts.' },
  { id: 'deck-tipografia', title: 'Letters and reading', curriculumSlug: 'practical-typography', description: 'Rhythm, scale and reading.' },
  { id: 'deck-aprendizagem', title: 'Learning', curriculumSlug: 'self-directed-learning', description: 'Practice, memory and review.' }
]

/** Every seeded card is due the day the app is opened, so the deck is never empty. */
export function buildReviewCards(today: string): ReviewCard[] {
  const card = (id: string, deckId: string, sourceLibraryItemId: string, front: string, back: string): ReviewCard => ({ id, deckId, sourceLibraryItemId, front, back, dueAt: today })

  return [
    card('card-comp-1', 'deck-compiladores', 'post-compilation', 'What is a symbol table for?', 'It maps names to what the compiler knows about them.'),
    card('card-comp-2', 'deck-compiladores', 'post-compilation', 'What is a token?', 'A classified unit of input text.'),
    card('card-comp-3', 'deck-compiladores', 'book-interpreters', 'When does parsing happen?', 'After reading the tokens and before evaluation.'),
    card('card-comp-4', 'deck-compiladores', 'book-interpreters', 'What does a syntax tree represent?', 'The structure of an expression or program.'),
    card('card-comp-5', 'deck-compiladores', 'paper-parsing', 'Why recover after an error?', 'So one tool keeps finding further problems.'),
    card('card-comp-6', 'deck-compiladores', 'course-git', 'What makes a history useful?', 'Each change explains one verifiable intent.'),
    card('card-comp-7', 'deck-compiladores', 'post-compilation', 'What is scope?', 'The region where a name can be looked up.'),
    card('card-comp-8', 'deck-compiladores', 'book-interpreters', 'What does an interpreter do?', 'It runs a representation of the program.'),
    card('card-type-1', 'deck-tipografia', 'post-typography', 'What builds visual hierarchy?', 'Deliberate differences of scale, weight and space.'),
    card('card-type-2', 'deck-tipografia', 'post-typography', 'What is leading?', 'The vertical distance between lines of text.'),
    card('card-type-3', 'deck-tipografia', 'book-type', 'When should spacing grow?', 'When size or weight reduce clarity.'),
    card('card-type-4', 'deck-tipografia', 'book-type', 'What is a type scale?', 'A small set of related sizes.'),
    card('card-type-5', 'deck-tipografia', 'post-typography', 'Why limit type families?', 'To keep contrast predictable and steady.'),
    card('card-type-6', 'deck-tipografia', 'book-type', 'What helps long blocks read well?', 'Moderate line width and a steady rhythm.'),
    card('card-type-7', 'deck-tipografia', 'post-typography', 'What is white space for?', 'Separating groups and showing structure.'),
    card('card-type-8', 'deck-tipografia', 'book-type', 'What is typographic contrast?', 'A visible difference that organizes information.'),
    card('card-learn-1', 'deck-aprendizagem', 'paper-reading', 'What is active recall?', 'Trying to remember before checking the answer.'),
    card('card-learn-2', 'deck-aprendizagem', 'paper-reading', 'Why space reviews?', 'Because the effort of remembering strengthens memory.'),
    card('card-learn-3', 'deck-aprendizagem', 'podcast-habits', 'What makes a habit fit the day?', 'A clear trigger and a small first step.'),
    card('card-learn-4', 'deck-aprendizagem', 'course-writing', 'What makes an instruction testable?', 'It names an action and an observable result.'),
    card('card-learn-5', 'deck-aprendizagem', 'paper-reading', 'What separates familiarity from mastery?', 'Mastery lets you use an idea without support.'),
    card('card-learn-6', 'deck-aprendizagem', 'podcast-habits', 'What should you record after studying?', 'The next step and the question that stayed open.'),
    card('card-learn-7', 'deck-aprendizagem', 'course-writing', 'Why review questions?', 'Because they reveal gaps in understanding.'),
    card('card-learn-8', 'deck-aprendizagem', 'paper-reading', 'When is a review too early?', 'When the answer still comes with no effort.')
  ]
}

/** Stand-ins for the library items the cards cite as their source. */
export function buildReviewReferencedItems(today: string): LibraryItem[] {
  return [...new Set(buildReviewCards(today).map((card) => card.sourceLibraryItemId))].map((id) =>
    createStandInLibraryItem(id, today)
  )
}
