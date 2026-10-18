import { mount, type VueWrapper } from '@vue/test-utils'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { readerSlotProps } from '@/modules/library/readerSlotsTesting'
import type { ReaderSlotProps } from '@/modules/library/readerSlots'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import ReaderNotesPanel from './ReaderNotesPanel.vue'
import {
  annotationRecord,
  fakeNotesSource,
  highlightRecord,
  questionRecord,
  type FakeNotesRecords
} from '../data/testing'

const mounted: VueWrapper[] = []

// jsdom has no scrollIntoView, and "Turn into question" uses it to bring the
// question box into view.
HTMLElement.prototype.scrollIntoView = () => {}

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
  resetModuleMounting()
  vi.restoreAllMocks()
})

/** The panel on its own, as the reader's notes slot renders it. */
async function mountPanel(records: FakeNotesRecords = {}, props: Partial<ReaderSlotProps> = {}) {
  setEnabledModules(['library', 'notes'])
  const notes = fakeNotesSource(records)
  const wrapper = mount(ReaderNotesPanel, {
    props: readerSlotProps(props),
    global: { plugins: [sourcesPlugin({ notes })] },
    attachTo: document.body
  })
  mounted.push(wrapper)
  await flushReads()
  return { wrapper, notes }
}

/** The margin's rows, each named by the record it shows. */
function entryKeys(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.notes-reader-entry').map((row) => row.attributes('data-key') ?? '')
}

function entry(wrapper: VueWrapper, key: string) {
  return wrapper.get(`.notes-reader-entry[data-key="${key}"]`)
}

/**
 * Two passages stored out of reading order, a note on each, a question turned
 * from the first note, and one note and one question that hang on nothing.
 */
const READING: FakeNotesRecords = {
  highlights: [
    highlightRecord({ id: 'h-late', exact: 'A passage near the end.', position_hint: 900, created_at: '2026-10-08T12:00:00Z' }),
    highlightRecord({ id: 'h-early', exact: 'A passage near the start.', position_hint: 40, created_at: '2026-10-08T12:01:00Z' })
  ],
  annotations: [
    annotationRecord({ id: 'a-loose', text: 'A thought about the whole text.', created_at: '2026-10-08T12:05:00Z' }),
    annotationRecord({ id: 'a-late', highlight_id: 'h-late', text: 'On the ending.', created_at: '2026-10-08T12:02:00Z' }),
    annotationRecord({ id: 'a-early', highlight_id: 'h-early', text: 'On the opening.', created_at: '2026-10-08T12:03:00Z' })
  ],
  questions: [
    questionRecord({ id: 'q-loose', item_id: 'item-1', text: 'What is the argument?', created_at: '2026-10-08T12:04:00Z' }),
    questionRecord({
      id: 'q-early',
      item_id: 'item-1',
      annotation_id: 'a-early',
      text: 'Why open this way?',
      created_at: '2026-10-08T12:06:00Z'
    })
  ]
}

describe('the reader margin as one list', () => {
  it('reads the questions of this item and lists every one not dropped, marked with its state', async () => {
    const { wrapper, notes } = await mountPanel({
      questions: [
        questionRecord({ id: 'q-open', item_id: 'item-1', text: 'Is this open?', created_at: '2026-10-08T12:00:00Z' }),
        questionRecord({
          id: 'q-answered',
          item_id: 'item-1',
          created_at: '2026-10-08T12:01:00Z',
          text: 'Is this answered?',
          status: 'answered',
          answer: 'Yes, in chapter two.'
        }),
        questionRecord({ id: 'q-dropped', item_id: 'item-1', text: 'Was this let go?', status: 'dropped' }),
        questionRecord({ id: 'q-elsewhere', item_id: 'item-2', text: 'From another text?' })
      ]
    })

    expect(notes.calls.questions).toContainEqual(expect.objectContaining({ item_id: 'item-1' }))
    expect(entryKeys(wrapper)).toEqual(['question-q-open', 'question-q-answered'])
    const open = entry(wrapper, 'question-q-open')
    expect(open.get('.notes-reader-question-mark').text()).toBe('?')
    expect(open.get('.notes-reader-question-state').text()).toBe('Open')
    const answered = entry(wrapper, 'question-q-answered')
    expect(answered.get('.notes-reader-question-state').text()).toBe('Answered')
    expect(answered.get('.notes-reader-answer').text()).toBe('Yes, in chapter two.')
    expect(wrapper.text()).not.toContain('Was this let go?')
  })

  it('orders by place in the text, a question after its note, then what hangs on nothing by age', async () => {
    const { wrapper } = await mountPanel(READING)

    expect(entryKeys(wrapper)).toEqual([
      'annotation-a-early',
      'question-q-early',
      'annotation-a-late',
      'question-q-loose',
      'annotation-a-loose'
    ])
  })

  it('renders every note on one passage, with the quote shown once', async () => {
    const { wrapper } = await mountPanel({
      highlights: [highlightRecord({ id: 'h-1', exact: 'One passage.' })],
      annotations: [
        annotationRecord({ id: 'a-1', highlight_id: 'h-1', text: 'First thought.', created_at: '2026-10-08T12:01:00Z' }),
        annotationRecord({ id: 'a-2', highlight_id: 'h-1', text: 'Second thought.', created_at: '2026-10-08T12:02:00Z' }),
        annotationRecord({ id: 'a-3', highlight_id: 'h-1', text: 'Third thought.', created_at: '2026-10-08T12:03:00Z' })
      ]
    })

    expect(entryKeys(wrapper)).toEqual(['annotation-a-1', 'annotation-a-2', 'annotation-a-3'])
    expect(wrapper.findAll('.nt-ann-note').map((note) => note.text())).toEqual([
      'First thought.',
      'Second thought.',
      'Third thought.'
    ])
    expect(wrapper.findAll('.nt-ann-quote')).toHaveLength(1)
  })

  it('shows a bare passage as its quote and the annotate action, with no "Highlight only" label', async () => {
    const { wrapper } = await mountPanel({ highlights: [highlightRecord({ id: 'h-1', exact: 'A bare passage.' })] })

    const row = entry(wrapper, 'passage-h-1')
    expect(row.get('.nt-ann-quote').text()).toBe('A bare passage.')
    expect(row.get('.nt-ann-add').text()).toContain('+ Annotate')
    expect(wrapper.text()).not.toContain('Highlight only')
  })
})

describe('jumping from the margin to the text', () => {
  it('puts an arrow on every row with a passage, and it scrolls to that passage', async () => {
    const scrollToPassage = vi.fn()
    const { wrapper } = await mountPanel(
      {
        ...READING,
        highlights: [...(READING.highlights ?? []), highlightRecord({ id: 'h-bare', exact: 'Unannotated.', position_hint: 500 })]
      },
      { scrollToPassage }
    )

    const withArrow = wrapper
      .findAll('.notes-reader-entry')
      .filter((row) => row.find('[data-action="jump"]').exists())
      .map((row) => row.attributes('data-key'))
    expect(withArrow).toEqual(['annotation-a-early', 'question-q-early', 'passage-h-bare', 'annotation-a-late'])

    await entry(wrapper, 'question-q-early').get('[data-action="jump"]').trigger('click')
    await entry(wrapper, 'passage-h-bare').get('[data-action="jump"]').trigger('click')
    expect(scrollToPassage.mock.calls).toEqual([['A passage near the start.'], ['Unannotated.']])
  })
})

describe('changing a note from the margin', () => {
  it('rewrites an annotation in place with PATCH and shows the new text', async () => {
    const { wrapper, notes } = await mountPanel(READING)

    await entry(wrapper, 'annotation-a-late').get('[data-action="edit"]').trigger('click')
    await wrapper.get('#notes-reader-edit').setValue('On the ending, again.')
    await wrapper.get('[data-action="save-edit"]').trigger('click')
    await flushReads()

    expect(notes.calls.updatedAnnotations).toEqual([{ id: 'a-late', text: 'On the ending, again.' }])
    expect(wrapper.find('#notes-reader-edit').exists()).toBe(false)
    expect(entry(wrapper, 'annotation-a-late').get('.nt-ann-note').text()).toBe('On the ending, again.')
  })

  it('deletes an annotation only after the person confirms, and drops its row', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValueOnce(false).mockReturnValueOnce(true)
    const { wrapper, notes } = await mountPanel(READING)

    await entry(wrapper, 'annotation-a-late').get('[data-action="delete"]').trigger('click')
    await flushReads()
    expect(notes.calls.deletedAnnotations).toEqual([])
    expect(entryKeys(wrapper)).toContain('annotation-a-late')

    await entry(wrapper, 'annotation-a-late').get('[data-action="delete"]').trigger('click')
    await flushReads()
    expect(confirm).toHaveBeenCalledTimes(2)
    expect(notes.calls.deletedAnnotations).toEqual(['a-late'])
    expect(entryKeys(wrapper)).not.toContain('annotation-a-late')
    // Its passage is still marked, so it stays in the list as a bare passage.
    expect(entryKeys(wrapper)).toContain('passage-h-late')
  })

  it('deletes a bare passage only after the person confirms', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { wrapper, notes } = await mountPanel({ highlights: [highlightRecord({ id: 'h-1', exact: 'A bare passage.' })] })

    await entry(wrapper, 'passage-h-1').get('[data-action="delete"]').trigger('click')
    await flushReads()

    expect(confirm).toHaveBeenCalledTimes(1)
    expect(notes.calls.deletedHighlights).toEqual(['h-1'])
    expect(entryKeys(wrapper)).toEqual([])
  })

  it('rewrites a question with PATCH, holding it to the trailing question mark', async () => {
    const { wrapper, notes } = await mountPanel(READING)

    await entry(wrapper, 'question-q-loose').get('[data-action="edit"]').trigger('click')
    await wrapper.get('#notes-reader-edit').setValue('What is the argument, really')
    await wrapper.get('[data-action="save-edit"]').trigger('click')
    await flushReads()
    expect(notes.calls.updatedQuestions).toEqual([])
    expect(wrapper.get('.notes-reader-edit [role="alert"]').text()).toBe('A question has to end with “?”.')

    await wrapper.get('#notes-reader-edit').setValue('What is the argument, really?')
    await wrapper.get('[data-action="save-edit"]').trigger('click')
    await flushReads()
    expect(notes.calls.updatedQuestions).toEqual([{ id: 'q-loose', patch: { text: 'What is the argument, really?' } }])
    expect(entry(wrapper, 'question-q-loose').get('.notes-reader-question-text').text()).toBe(
      'What is the argument, really?'
    )
  })

  it('lets a question go by marking it dropped, without asking, and drops its row', async () => {
    const confirm = vi.spyOn(window, 'confirm')
    const { wrapper, notes } = await mountPanel(READING)

    await entry(wrapper, 'question-q-early').get('[data-action="delete"]').trigger('click')
    await flushReads()

    expect(notes.calls.updatedQuestions).toEqual([{ id: 'q-early', patch: { status: 'dropped' } }])
    expect(confirm).not.toHaveBeenCalled()
    expect(entryKeys(wrapper)).not.toContain('question-q-early')
  })
})

describe('questions written from the margin', () => {
  it('shows a question as soon as it is saved, with no reload', async () => {
    // Written the day before, so the new question is the youngest row that
    // hangs on nothing and has to come last.
    const { wrapper, notes } = await mountPanel({
      highlights: [highlightRecord({ id: 'h-1' })],
      annotations: [
        annotationRecord({ id: 'a-on', highlight_id: 'h-1', created_at: '2026-10-07T09:00:00Z' }),
        annotationRecord({ id: 'a-loose', created_at: '2026-10-07T09:01:00Z' })
      ]
    })
    const readsBefore = notes.calls.questions.length

    await wrapper.get('#notes-reader-question').setValue('Who is this written for?')
    await wrapper.get('[data-action="turn-into-question"]').trigger('click')
    await flushReads()

    const created = notes.held.questions[0]
    expect(created.text).toBe('Who is this written for?')
    // Placed from the write's own answer: the list was not read again to find it.
    expect(notes.calls.questions).toHaveLength(readsBefore)
    expect(entryKeys(wrapper).at(-1)).toBe(`question-${created.id}`)
    expect(entry(wrapper, `question-${created.id}`).text()).toContain('Who is this written for?')
  })

  it('turns one note into a question pointing at it, and lists it right after that note', async () => {
    const { wrapper, notes } = await mountPanel(READING)

    await entry(wrapper, 'annotation-a-late').get('[data-action="ask"]').trigger('click')
    expect((wrapper.get('[aria-label="Source annotation"]').element as HTMLSelectElement).value).toBe('a-late')
    expect((wrapper.get('#notes-reader-question').element as HTMLTextAreaElement).value).toBe('')

    await wrapper.get('#notes-reader-question').setValue('Why end there?')
    await wrapper.get('[data-action="turn-into-question"]').trigger('click')
    await flushReads()

    expect(notes.calls.addedQuestions).toEqual([{ item_id: 'item-1', text: 'Why end there?', annotation_id: 'a-late' }])
    const keys = entryKeys(wrapper)
    const created = notes.held.questions[0]
    expect(keys[keys.indexOf('annotation-a-late') + 1]).toBe(`question-${created.id}`)
  })
})
