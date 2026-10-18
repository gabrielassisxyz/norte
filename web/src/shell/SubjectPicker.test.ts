import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { resetModuleMounting } from '@/modules/mounting'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import type { CoreSource } from './data/source'
import { fakeCoreSource, subjectRecord } from './data/testing'
import SubjectPicker from './SubjectPicker.vue'

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

function vocabulary() {
  return [
    subjectRecord({ id: 'subject-k8s', name: 'Kubernetes', slug: 'kubernetes', focus: true }),
    subjectRecord({ id: 'subject-writing', name: 'Writing', slug: 'writing' }),
    subjectRecord({ id: 'subject-programming', name: 'Programming', slug: 'programming' })
  ]
}

async function mountPicker(
  props: { chosen?: string[] } = {},
  overrides: Partial<CoreSource> = {}
) {
  const core = fakeCoreSource({ subjects: vocabulary() }, overrides)
  const wrapper = mount(SubjectPicker, {
    props,
    global: { plugins: [sourcesPlugin(appSourcesWithLibrary({ core }))] }
  })
  mounted.push(wrapper)
  await flushReads()
  return { wrapper, core }
}

function optionsOf(wrapper: { findAll: (selector: string) => Array<{ text: () => string }> }) {
  return wrapper.findAll('[role="option"]').map((option) => option.text())
}

describe('the subject picker', () => {
  it('is one combobox field, with no search box of its own above a list', async () => {
    const { wrapper } = await mountPicker()

    const inputs = wrapper.findAll('input')
    expect(inputs).toHaveLength(1)
    expect(inputs[0]?.attributes('role')).toBe('combobox')
    expect(inputs[0]?.attributes('aria-controls')).toBe(
      wrapper.get('[role="listbox"]').attributes('id')
    )
  })

  it('offers the focus before anything was typed, and asks for no search', async () => {
    const { wrapper, core } = await mountPicker()

    expect(core.calls.focus).toBe(1)
    // The full vocabulary is one field away; reading its first page before
    // anyone asked would be a request whose answer nothing renders.
    expect(core.calls.listSubjects).toEqual([])
    expect(optionsOf(wrapper)).toEqual(['Kubernetesin focus'])
  })

  it('opens the listbox again when the field is focused after an Escape', async () => {
    const { wrapper } = await mountPicker()
    const input = wrapper.get('input')

    await input.trigger('keydown', { key: 'Escape' })
    expect(wrapper.find('[role="listbox"]').exists()).toBe(false)
    expect(input.attributes('aria-expanded')).toBe('false')

    await input.trigger('focus')

    expect(wrapper.find('[role="listbox"]').exists()).toBe(true)
    expect(input.attributes('aria-expanded')).toBe('true')
    expect(optionsOf(wrapper)).toEqual(['Kubernetesin focus'])
  })

  it('searches the whole vocabulary once something is typed', async () => {
    const { wrapper, core } = await mountPicker()

    await wrapper.get('input').setValue('programming')
    await flushReads()

    expect(core.calls.listSubjects.map((query) => query.q)).toEqual(['programming'])
    expect(optionsOf(wrapper)).toEqual(['Programming'])
  })

  it('moves the active option with the arrow keys and chooses it with Enter', async () => {
    const { wrapper } = await mountPicker()
    const input = wrapper.get('input')

    await input.setValue('ing')
    await flushReads()
    expect(optionsOf(wrapper)).toEqual(['Programming', 'Writing', 'Create “ing”'])
    const firstOption = wrapper.findAll('[role="option"]')[0]
    expect(input.attributes('aria-activedescendant')).toBe(firstOption?.attributes('id'))
    expect(firstOption?.attributes('aria-selected')).toBe('true')

    await input.trigger('keydown', { key: 'ArrowDown' })
    const second = wrapper.findAll('[role="option"]')[1]
    expect(input.attributes('aria-activedescendant')).toBe(second?.attributes('id'))
    expect(second?.attributes('aria-selected')).toBe('true')

    await input.trigger('keydown', { key: 'ArrowUp' })
    expect(input.attributes('aria-activedescendant')).toBe(
      wrapper.findAll('[role="option"]')[0]?.attributes('id')
    )

    await input.trigger('keydown', { key: 'ArrowDown' })
    await input.trigger('keydown', { key: 'Enter' })

    expect(wrapper.emitted('select')).toEqual([[expect.objectContaining({ id: 'subject-writing' })]])
  })

  it('reports the chosen subject and clears the search', async () => {
    const { wrapper } = await mountPicker()

    await wrapper.get('input').setValue('writing')
    await flushReads()
    await wrapper.get('[role="option"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[expect.objectContaining({ id: 'subject-writing' })]])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('leaves out what has already been chosen', async () => {
    const { wrapper } = await mountPicker({ chosen: ['subject-k8s'] })

    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('No subject in focus')
  })

  it('offers to create the typed name when no subject carries it', async () => {
    const { wrapper } = await mountPicker()

    await wrapper.get('input').setValue('  Distributed systems  ')
    await flushReads()

    const options = optionsOf(wrapper)
    expect(options[options.length - 1]).toBe('Create “Distributed systems”')
  })

  it('offers no creation of a name a listed subject already carries', async () => {
    const { wrapper } = await mountPicker()

    // Case is the server's business, not the picker's: the slug it derives is
    // the same one, so offering to create it would only ever be a 409.
    await wrapper.get('input').setValue('kubernetes')
    await flushReads()

    expect(optionsOf(wrapper)).toEqual(['Kubernetes'])
  })

  it('creates the subject once and reports the one the server answered with', async () => {
    const { wrapper, core } = await mountPicker()

    await wrapper.get('input').setValue('Distributed systems')
    await flushReads()
    await wrapper.findAll('[role="option"]').at(-1)?.trigger('click')
    await flushReads()

    expect(core.calls.createSubject).toEqual(['Distributed systems'])
    expect(wrapper.emitted('select')).toEqual([
      [expect.objectContaining({ id: 'subject-distributed-systems', slug: 'distributed-systems' })]
    ])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('shows what the server said about a refused name and chooses nothing', async () => {
    const refused: string[] = []
    const { wrapper } = await mountPicker(
      {},
      {
        createSubject: async (name: string) => {
          refused.push(name)
          // What a 409 from POST /api/core/subjects reaches the picker as.
          throw new Error('the slug "distributed-systems" is already taken')
        }
      }
    )

    await wrapper.get('input').setValue('Distributed systems')
    await flushReads()
    await wrapper.findAll('[role="option"]').at(-1)?.trigger('click')
    await flushReads()

    expect(refused).toEqual(['Distributed systems'])
    expect(wrapper.emitted('select')).toBeUndefined()
    expect(wrapper.get('[role="alert"]').text()).toBe('the slug "distributed-systems" is already taken')
  })

  it('says so when a search matches nothing and the name cannot be offered twice', async () => {
    const { wrapper } = await mountPicker()

    await wrapper.get('input').setValue('nothing-by-that-name')
    await flushReads()

    expect(optionsOf(wrapper)).toEqual(['Create “nothing-by-that-name”'])
  })

  it('says the focus is empty when there is nothing in it', async () => {
    const core = fakeCoreSource({ subjects: [subjectRecord({ id: 'subject-writing', name: 'Writing' })] })
    const wrapper = mount(SubjectPicker, {
      global: { plugins: [sourcesPlugin(appSourcesWithLibrary({ core }))] }
    })
    mounted.push(wrapper)
    await flushReads()

    expect(wrapper.text()).toContain('No subject in focus. Search by name.')
  })
})
