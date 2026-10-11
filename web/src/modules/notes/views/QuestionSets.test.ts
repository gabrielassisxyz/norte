import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { routes } from '@/router'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import { fakeNotesSource, questionRecord, questionSetRecord, type FakeNotesSource } from '../data/testing'
import QuestionSetsView from './QuestionSetsView.vue'
import QuestionSetView from './QuestionSetView.vue'

const mounted: Array<{ unmount: () => void }> = []

beforeEach(() => {
  setEnabledModules(['library', 'notes'])
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

async function mountSets(notes: FakeNotesSource = fakeNotesSource()) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/notes/sets')
  await router.isReady()
  const wrapper = mount(QuestionSetsView, {
    global: { plugins: [router, sourcesPlugin({ notes })] }
  })
  mounted.push(wrapper)
  await flushReads()
  return { wrapper, notes, router }
}

async function mountOneSet(notes: FakeNotesSource, id: string) {
  const router: Router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/notes/sets/${id}`)
  await router.isReady()
  const wrapper = mount(QuestionSetView, {
    global: { plugins: [router, sourcesPlugin({ notes })] }
  })
  mounted.push(wrapper)
  await flushReads()
  return wrapper
}

describe('the question-set screen', () => {
  it('offers the six prompts of a topic', async () => {
    const { wrapper } = await mountSets()

    expect(wrapper.find('#set-topic').exists()).toBe(true)
    for (const kind of ['what', 'why', 'who', 'when', 'where', 'how']) {
      expect(wrapper.find(`#set-prompt-${kind}`).exists()).toBe(true)
    }
    expect(wrapper.get('.sets-counter').text()).toBe('0 of 6 filled in')
  })

  it('stores only the prompts the person wrote into', async () => {
    const { wrapper, notes, router } = await mountSets()

    await wrapper.get('#set-topic').setValue('Kubernetes')
    await wrapper.get('#set-prompt-why').setValue('Why is a pod the scheduling unit?')
    await wrapper.get('#set-prompt-how').setValue('How does a service find its pods?')
    // A prompt with nothing but spaces in it is a prompt nobody filled.
    await wrapper.get('#set-prompt-what').setValue('   ')
    expect(wrapper.get('.sets-counter').text()).toBe('2 of 6 filled in')

    await wrapper.get('.sets-form').trigger('submit')
    await flushReads()

    expect(notes.calls.addedSets).toEqual([
      {
        topic: 'Kubernetes',
        questions: [
          { kind: 'why', text: 'Why is a pod the scheduling unit?' },
          { kind: 'how', text: 'How does a service find its pods?' }
        ]
      }
    ])
    const created = notes.held.sets[0]
    expect(created.question_count).toBe(2)
    expect(created.questions.map((question) => question.kind)).toEqual(['why', 'how'])
    // The screen opens the set it just created, which is where its questions
    // are. The route's component is loaded lazily, so the navigation settles a
    // few microtasks after the write it followed.
    for (let attempt = 0; attempt < 20 && router.currentRoute.value.name !== 'notes-question-set'; attempt += 1) {
      await flushReads()
    }
    expect(router.currentRoute.value.fullPath).toBe(`/notes/sets/${created.id}`)
  })

  it('refuses a set with no topic', async () => {
    const { wrapper, notes } = await mountSets()

    await wrapper.get('#set-prompt-why').setValue('Why does this exist?')
    await wrapper.get('.sets-form').trigger('submit')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toBe('A set needs a topic.')
    expect(notes.calls.addedSets).toHaveLength(0)
  })

  it('lists the sets already opened, with how many questions each holds', async () => {
    const notes = fakeNotesSource({
      sets: [questionSetRecord({ id: 'set-k8s', topic: 'Kubernetes', question_count: 2 })]
    })
    const { wrapper } = await mountSets(notes)

    expect(wrapper.get('.sets-row').text()).toContain('Kubernetes')
    expect(wrapper.get('.sets-row').text()).toContain('2 questions')
  })

  it('reads one question with the singular', async () => {
    const notes = fakeNotesSource({
      sets: [questionSetRecord({ id: 'set-one', topic: 'A topic', question_count: 1 })]
    })
    const { wrapper } = await mountSets(notes)

    expect(wrapper.get('.sets-row').text()).toContain('1 question')
    expect(wrapper.get('.sets-row').text()).not.toContain('1 questions')
  })

  it('loads a further page of sets when asked, keeping the rows already shown', async () => {
    const notes = fakeNotesSource({
      sets: Array.from({ length: 60 }, (_, index) =>
        questionSetRecord({ id: `set-${index}`, topic: `Topic ${index}` })
      )
    })
    const { wrapper } = await mountSets(notes)

    expect(wrapper.findAll('.sets-row')).toHaveLength(50)

    await wrapper.get('[data-action="load-more"]').trigger('click')
    await flushReads()

    expect(wrapper.findAll('.sets-row')).toHaveLength(60)
    expect(wrapper.find('[data-action="load-more"]').exists()).toBe(false)
  })

  it('shows one set with the questions it holds, each under its prompt', async () => {
    const notes = fakeNotesSource({
      sets: [
        questionSetRecord({
          id: 'set-k8s',
          topic: 'Kubernetes',
          question_count: 2,
          questions: [
            questionRecord({ id: 'q-why', kind: 'why', text: 'Why a pod?', set_id: 'set-k8s' }),
            questionRecord({ id: 'q-how', kind: 'how', text: 'How does a service find it?', set_id: 'set-k8s' })
          ]
        })
      ]
    })
    const wrapper = await mountOneSet(notes, 'set-k8s')

    expect(wrapper.get('h1').text()).toBe('Kubernetes')
    expect(wrapper.findAll('.set-question')).toHaveLength(2)
    expect(wrapper.findAll('.set-kind').map((kind) => kind.text())).toEqual(['Why', 'How'])
  })

  it('reads one question on the set with the singular', async () => {
    const notes = fakeNotesSource({
      sets: [
        questionSetRecord({
          id: 'set-one',
          topic: 'A topic',
          question_count: 1,
          questions: [questionRecord({ id: 'q-why', kind: 'why', text: 'Why?', set_id: 'set-one' })]
        })
      ]
    })
    const wrapper = await mountOneSet(notes, 'set-one')

    expect(wrapper.get('.set-meta').text()).toContain('1 question')
    expect(wrapper.get('.set-meta').text()).not.toContain('1 questions')
  })

  it('says a set is not there rather than showing an empty one', async () => {
    const wrapper = await mountOneSet(fakeNotesSource(), 'set-that-does-not-exist')

    expect(wrapper.get('.set-state').text()).toContain('This set does not exist.')
  })
})
