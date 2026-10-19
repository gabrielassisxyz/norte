import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { createRouteTable } from '@/router'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import { fakeCoreSource, subjectRecord, type FakeCoreSource } from './data/testing'
import SubjectsView from './SubjectsView.vue'

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

function vocabulary() {
  return [
    subjectRecord({ id: 'subject-writing', name: 'Writing', slug: 'writing', link_count: 4 }),
    subjectRecord({ id: 'subject-career', name: 'Career', slug: 'career', focus: true, link_count: 1 }),
    subjectRecord({ id: 'subject-kubernetes', name: 'Kubernetes', slug: 'kubernetes' })
  ]
}

async function mountSubjects(core?: FakeCoreSource) {
  setEnabledModules(['library'])
  const source = core ?? fakeCoreSource({ subjects: vocabulary() })
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/subjects')
  await router.isReady()
  const wrapper = mount(SubjectsView, {
    global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core: source }))] }
  })
  mounted.push(wrapper)
  await flushReads()
  return { wrapper, core: source, router }
}

function names(wrapper: Awaited<ReturnType<typeof mountSubjects>>['wrapper']): string[] {
  return wrapper.findAll('.subjects-name').map((row) => row.text())
}

describe('the subjects screen', () => {
  it('lists every subject by name, each at its own page', async () => {
    const { wrapper } = await mountSubjects()

    expect(names(wrapper)).toEqual(['Career', 'Kubernetes', 'Writing'])
    expect(wrapper.findAll('.subjects-name').map((row) => row.attributes('href'))).toEqual([
      '/subjects/career',
      '/subjects/kubernetes',
      '/subjects/writing'
    ])
    expect(wrapper.findAll('.subjects-row')[0]!.text()).toContain('1 link')
    expect(wrapper.findAll('.subjects-row')[2]!.text()).toContain('4 links')
  })

  it('follows the cursor to the end rather than listing the first page', async () => {
    // Three pages of the fake's own paging, which is the server's: the view
    // asks again with every cursor it is handed and stops when there is none.
    const many = Array.from({ length: 120 }, (_, index) =>
      subjectRecord({ name: `Subject ${String(index).padStart(3, '0')}` })
    )
    const { wrapper, core } = await mountSubjects(fakeCoreSource({ subjects: many }))

    expect(names(wrapper)).toHaveLength(120)
    expect(core.calls.listSubjects.map((query) => query.cursor)).toEqual([undefined, '50', '100'])
  })

  it('creates a subject and shows it in place, without leaving the list', async () => {
    const { wrapper, core, router } = await mountSubjects()

    await wrapper.get('.nt-pagetitle-actions button').trigger('click')
    await wrapper.get('.new-subject-dialog input').setValue('Rust')
    // jsdom does not submit a form from a click on its submit button, and the
    // dialog creates on submit: the event the browser would raise is raised here.
    await wrapper.get('.new-subject-dialog').trigger('submit')
    await flushReads()

    expect(core.calls.createSubject).toEqual(['Rust'])
    expect(names(wrapper)).toEqual(['Career', 'Kubernetes', 'Rust', 'Writing'])
    expect(router.currentRoute.value.name).toBe('subjects')
  })

  it('toggles the focus and renders what came back', async () => {
    const { wrapper, core } = await mountSubjects()
    const career = () => wrapper.get('[aria-label="Career in focus"]')

    expect(career().attributes('aria-checked')).toBe('true')

    await career().trigger('click')
    await flushReads()

    expect(core.calls.patchSubject).toEqual([{ id: 'subject-career', patch: { focus: false } }])
    expect(career().attributes('aria-checked')).toBe('false')
  })

  it('leaves the toggle where it was when the write failed, and says why', async () => {
    const core = fakeCoreSource(
      { subjects: vocabulary() },
      {
        patchSubject: async () => {
          throw new Error('network down')
        }
      }
    )
    const { wrapper } = await mountSubjects(core)

    await wrapper.get('[aria-label="Career in focus"]').trigger('click')
    await flushReads()

    expect(wrapper.get('[aria-label="Career in focus"]').attributes('aria-checked')).toBe('true')
    expect(wrapper.get('[role="alert"]').text()).toContain('The focus could not be changed: network down')
  })

  it('names the subject and its links before deleting, and sends nothing when cancelled', async () => {
    const { wrapper, core } = await mountSubjects()

    await wrapper.get('[aria-label="Delete Writing"]').trigger('click')
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('Delete Writing and its 4 links?')
    expect(dialog.text()).toContain('cannot be undone')

    await dialog.get('button').trigger('click')
    await flushReads()

    expect(core.calls.deleteSubject).toEqual([])
    expect(names(wrapper)).toContain('Writing')
  })

  it('deletes only once the dialog is confirmed, and drops the row', async () => {
    const { wrapper, core } = await mountSubjects()

    await wrapper.get('[aria-label="Delete Writing"]').trigger('click')
    const buttons = wrapper.get('[role="dialog"]').findAll('button')
    await buttons[buttons.length - 1]!.trigger('click')
    await flushReads()

    expect(core.calls.deleteSubject).toEqual(['subject-writing'])
    expect(names(wrapper)).toEqual(['Career', 'Kubernetes'])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
  })

  it('offers the create button with a sentence when there is no subject at all', async () => {
    const { wrapper } = await mountSubjects(fakeCoreSource({ subjects: [] }))

    expect(wrapper.findAll('.subjects-row')).toHaveLength(0)
    expect(wrapper.get('.subjects-empty').text()).toContain('No subject yet')
    expect(wrapper.get('.subjects-empty button').text()).toContain('New subject')
  })
})
