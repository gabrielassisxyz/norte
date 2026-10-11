import { flushPromises, mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import router from '@/router'
import type { AppSources } from '@/sources'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { NotesPage, NotesSource, QuestionRecord } from '../data/source'
import {
  annotationRecord,
  fakeNotesSource,
  highlightRecord,
  noteSource,
  questionRecord,
  type FakeNotesRecords
} from '../data/testing'
import NotesView from './NotesView.vue'

const compilation = noteSource({ id: 'item-compilation', title: 'How compilers read code' })
const garden = noteSource({ id: 'item-garden', title: 'The digital garden' })

/** A small set of each kind, enough for the tabs, the filter and the links. */
function records(): FakeNotesRecords {
  return {
    highlights: [
      highlightRecord({ id: 'h-1', item_id: compilation.id, exact: 'Watch the example before concluding.', source: compilation }),
      highlightRecord({ id: 'h-2', item_id: garden.id, exact: 'Plant ideas slowly.', source: garden })
    ],
    annotations: [
      annotationRecord({ id: 'a-1', item_id: compilation.id, text: 'Logging examples helps.', source: compilation }),
      annotationRecord({ id: 'a-2', item_id: garden.id, text: 'Try it in a small activity.', source: garden })
    ],
    questions: [
      questionRecord({ id: 'q-1', item_id: compilation.id, text: 'How to apply this tomorrow?', source: compilation })
    ]
  }
}

const mounted: Array<{ unmount: () => void }> = []

beforeEach(() => {
  setEnabledModules(['library', 'notes'])
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

async function mountNotes(path = '/notes', notes: AppSources['notes'] = fakeNotesSource(records())) {
  await router.push(path)
  await router.isReady()
  const wrapper = mount(NotesView, {
    global: { plugins: [router, sourcesPlugin({ notes })] }
  })
  mounted.push(wrapper)
  await flushReads()
  return wrapper
}

describe('NotesView', () => {
  it('renders the title, the segmented control, the filter and the active list', async () => {
    const wrapper = await mountNotes()

    expect(wrapper.get('h1').text()).toBe('Highlights')
    expect(wrapper.find('[role="tablist"]').exists()).toBe(true)
    expect(wrapper.get('#notes-filter').attributes('placeholder')).toBe('Filter by text or source…')
    expect(wrapper.find('[aria-label="Highlights list"]').exists()).toBe(true)
    expect(wrapper.findAll('.notes-highlight')).toHaveLength(2)
    expect(wrapper.get('.notes-count').text()).toContain('2 items')
  })

  it('shows each row with the title of where it came from', async () => {
    const wrapper = await mountNotes()

    expect(wrapper.text()).toContain('How compilers read code')
    expect(wrapper.text()).toContain('The digital garden')
  })

  it('opens the tab named in the query and keeps switching tabs in the query', async () => {
    const wrapper = await mountNotes('/notes?tab=questions')

    expect(wrapper.get('h1').text()).toBe('Questions')
    expect(wrapper.find('#new-question').exists()).toBe(true)

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    await flushPromises()
    await flushReads()

    expect(router.currentRoute.value.query.tab).toBe('annotations')
    expect(wrapper.get('h1').text()).toBe('Annotations')
    expect(wrapper.findAll('.notes-annotation')).toHaveLength(2)
  })

  it('filters the active list through the source rather than in the page', async () => {
    const notes = fakeNotesSource(records())
    const wrapper = await mountNotes('/notes?tab=annotations', notes)

    await wrapper.get('#notes-filter').setValue('logging examples')
    await flushReads()

    expect(wrapper.findAll('.notes-annotation')).toHaveLength(1)
    // The narrowing travelled: a page filtered in the browser would be one page
    // of fifty narrowed down, and would call that the answer.
    expect(notes.calls.annotations.map((call) => call.q)).toContain('logging examples')
  })

  it('filters by the source title as well as by the note text', async () => {
    const wrapper = await mountNotes('/notes?tab=annotations')

    await wrapper.get('#notes-filter').setValue('garden')
    await flushReads()

    expect(wrapper.findAll('.notes-annotation')).toHaveLength(1)
    expect(wrapper.text()).toContain('Try it in a small activity.')
  })

  it('writes a question with the item chosen rather than a hard-coded one', async () => {
    const notes = fakeNotesSource(records())
    const wrapper = await mountNotes('/notes?tab=questions', notes)

    await wrapper.get('#new-question').setValue('A question with no ending')
    await wrapper.get('form').trigger('submit')
    await flushReads()
    expect(wrapper.get('[role="alert"]').text()).toBe('A question has to end with “?”.')
    expect(notes.calls.addedQuestions).toHaveLength(0)

    await wrapper.get('#new-question-item').setValue(garden.id)
    await wrapper.get('#new-question').setValue('Why does logging examples help?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(notes.calls.addedQuestions).toEqual([
      { text: 'Why does logging examples help?', item_id: garden.id }
    ])
    expect(wrapper.get('.notes-question .nt-q-text').text()).toBe('Why does logging examples help?')
  })

  it('offers "no material" and sends no item when that is chosen', async () => {
    const notes = fakeNotesSource(records())
    const wrapper = await mountNotes('/notes?tab=questions', notes)

    await wrapper.get('#new-question').setValue('What do I still not understand?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(notes.calls.addedQuestions).toEqual([{ text: 'What do I still not understand?' }])
  })

  it('says a highlight is no longer in the text when the server calls it orphaned', async () => {
    const wrapper = await mountNotes(
      '/notes',
      fakeNotesSource({
        highlights: [
          highlightRecord({ id: 'h-lost', status: 'orphaned', exact: 'A passage that left the text.', source: compilation })
        ]
      })
    )

    expect(wrapper.get('.notes-orphaned').text()).toContain('no longer in the extracted text')
    // The passage itself is still the person's, so it is still on the page.
    expect(wrapper.text()).toContain('A passage that left the text.')
  })

  it('links to the reader only while the library is mounted', async () => {
    const withLibrary = await mountNotes()
    expect(withLibrary.get('.notes-highlight .notes-links a').attributes('href')).toBe(
      `/library/${compilation.id}`
    )

    // Notes alone: the registry still gives the title, and there is nowhere to
    // open the source, so the row carries no link.
    setEnabledModules(['notes'])
    const withoutLibrary = await mountNotes()
    expect(withoutLibrary.text()).toContain('How compilers read code')
    expect(withoutLibrary.find('.notes-highlight .notes-links a').exists()).toBe(false)
  })

  // Every tab is a paginated list, so every tab has to be able to grow. One
  // case per tab, because a shared composable proved on one of them is a
  // composable that could be wired into only one of them.
  it.each([
    ['highlights', '/notes', '.notes-highlight'],
    ['annotations', '/notes?tab=annotations', '.notes-annotation'],
    ['questions', '/notes?tab=questions', '.notes-question']
  ])('loads a further page of %s when asked, keeping the rows already shown', async (_tab, path, selector) => {
    const many = Array.from({ length: 60 }, (_, index) => index)
    const wrapper = await mountNotes(
      path,
      fakeNotesSource({
        highlights: many.map((index) => highlightRecord({ id: `h-${index}`, exact: `Passage ${index}`, source: compilation })),
        annotations: many.map((index) => annotationRecord({ id: `a-${index}`, text: `Annotation ${index}`, source: compilation })),
        questions: many.map((index) => questionRecord({ id: `q-${index}`, text: `Question ${index}?`, source: compilation }))
      })
    )

    expect(wrapper.findAll(selector)).toHaveLength(50)

    await wrapper.get('[data-action="load-more"]').trigger('click')
    await flushReads()

    expect(wrapper.findAll(selector)).toHaveLength(60)
    expect(wrapper.find('[data-action="load-more"]').exists()).toBe(false)
  })

  it('says it is loading before the list answers', async () => {
    await router.push('/notes')
    await router.isReady()
    const wrapper = mount(NotesView, {
      global: {
        plugins: [
          router,
          sourcesPlugin({
            notes: fakeNotesSource(
              {},
              { listHighlights: () => new Promise<NotesPage<never>>(() => {}) } as Partial<NotesSource>
            )
          })
        ]
      }
    })
    mounted.push(wrapper)

    expect(wrapper.get('[role="status"]').text()).toBe('Loading the notes…')
    expect(wrapper.find('.notes-highlight').exists()).toBe(false)
  })

  it('says the tab is empty once it has answered with nothing', async () => {
    const wrapper = await mountNotes('/notes', fakeNotesSource())

    expect(wrapper.get('.notes-state').text()).toContain('No highlights yet')
    expect(wrapper.get('.notes-count').text()).toContain('0 items')
  })

  it('says why the notes could not be read, and reads again when asked', async () => {
    let attempts = 0
    const wrapper = await mountNotes(
      '/notes',
      fakeNotesSource(
        {},
        {
          async listHighlights() {
            attempts += 1
            if (attempts === 1) throw new Error('network unavailable')
            return { items: [], next_cursor: null }
          }
        }
      )
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('The notes could not be loaded: network unavailable')

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushReads()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.get('.notes-state').text()).toContain('No highlights yet')
  })

  it('keeps the list and the typed question when the write fails', async () => {
    const wrapper = await mountNotes(
      '/notes?tab=questions',
      fakeNotesSource(
        {},
        {
          addQuestion() {
            return Promise.reject(new Error('server conflict'))
          }
        }
      )
    )

    await wrapper.get('#new-question').setValue('Why did this fail?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toContain('Could not save: server conflict')
    expect((wrapper.get('#new-question').element as HTMLTextAreaElement).value).toBe('Why did this fail?')
    expect(wrapper.findAll('.notes-question')).toHaveLength(0)
  })

  it('shows the question the source answered with, not the one it was sent', async () => {
    const answered: QuestionRecord = questionRecord({
      id: 'question-new',
      text: 'The question as the server kept it?'
    })
    const wrapper = await mountNotes(
      '/notes?tab=questions',
      fakeNotesSource({}, { addQuestion: async () => answered })
    )

    await wrapper.get('#new-question').setValue('The question as I wrote it?')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('.notes-question .nt-q-text').text()).toBe('The question as the server kept it?')
    expect(wrapper.get('.notes-count').text()).toContain('1 item')
  })

  it('shows no kind badge for a question written on its own, and the label for one with a kind', async () => {
    const wrapper = await mountNotes(
      '/notes?tab=questions',
      fakeNotesSource({
        questions: [
          questionRecord({ id: 'q-kindless', text: 'Why?', source: compilation }),
          questionRecord({ id: 'q-kind', kind: 'why', text: 'Why does logging examples help?', source: garden })
        ]
      })
    )

    const rows = wrapper.findAll('.notes-question')
    expect(rows).toHaveLength(2)
    // A question written on its own has none of the set's six kinds.
    expect(rows[0].find('.nt-q-kind').exists()).toBe(false)
    expect(rows[1].get('.nt-q-kind').text()).toBe('Why')
  })

  it('shows a dropped question as discarded rather than open', async () => {
    const wrapper = await mountNotes(
      '/notes?tab=questions',
      fakeNotesSource({
        questions: [
          questionRecord({ id: 'q-open', text: 'What became clear?', status: 'open', source: compilation }),
          questionRecord({ id: 'q-answered', text: 'What was answered?', status: 'answered', source: compilation }),
          questionRecord({ id: 'q-dropped', text: 'What was dropped?', status: 'dropped', source: compilation })
        ]
      })
    )

    const rows = wrapper.findAll('.notes-question')
    expect(rows).toHaveLength(3)
    expect(rows[0].text()).toContain('Open')
    expect(rows[1].text()).toContain('Answered')
    expect(rows[2].text()).toContain('Dropped')
    // Scoped to the state badge: the row also links to its source, whose
    // label starts with "Open".
    expect(rows[2].get('.nt-q-meta').text()).toContain('Dropped')
    expect(rows[2].get('.nt-q-meta').text()).not.toContain('Open')
  })

  it('aborts the list in flight when the filter changes again', async () => {
    const signals: AbortSignal[] = []
    const wrapper = await mountNotes(
      '/notes',
      fakeNotesSource(
        {},
        {
          listHighlights: (_query, signal) => {
            signals.push(signal)
            return new Promise<NotesPage<never>>(() => {})
          }
        } as Partial<NotesSource>
      )
    )

    await wrapper.get('#notes-filter').setValue('ide')
    await wrapper.get('#notes-filter').setValue('idea')

    expect(signals.length).toBeGreaterThanOrEqual(3)
    expect(signals[0].aborted).toBe(true)
    expect(signals[signals.length - 1].aborted).toBe(false)
  })
})
