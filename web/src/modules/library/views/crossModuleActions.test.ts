import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import { overrideModuleBacking, resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { createRouteTable } from '@/router'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import LibraryView from './LibraryView.vue'

const mounted: Array<{ unmount: () => void }> = []
let store: MockStore

beforeEach(() => {
  store = createMockStore()
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

async function mountLibrary() {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/biblioteca?v=tudo')
  await router.isReady()
  const wrapper = mount(LibraryView, {
    global: { plugins: [router, sourcesPlugin(createMockSources(store))] }
  })
  mounted.push(wrapper)
  await flushReads()
  return wrapper
}

describe('the actions an item offers into another module', () => {
  it('offers them while the library, study and projects all read from the mock', async () => {
    const wrapper = await mountLibrary()

    expect(wrapper.find('button[aria-label="Vincular a currículo"]').exists()).toBe(true)
    expect(wrapper.find('button[aria-label="Criar tarefa"]').exists()).toBe(true)
  })

  it('withholds them from an api-backed item while study and projects are mock-backed', async () => {
    overrideModuleBacking('library', 'api')
    setEnabledModules(['library'])
    const wrapper = await mountLibrary()

    // The library itself is mounted: its rows are there to carry the actions.
    expect(wrapper.findAll('.item').length).toBeGreaterThan(0)
    expect(wrapper.find('button[aria-label="Vincular a currículo"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Criar tarefa"]').exists()).toBe(false)
  })

  it('offers them again once the other module reads from the same place', async () => {
    overrideModuleBacking('library', 'api')
    overrideModuleBacking('study', 'api')
    setEnabledModules(['library', 'study'])
    const wrapper = await mountLibrary()

    expect(wrapper.find('button[aria-label="Vincular a currículo"]').exists()).toBe(true)
    // Projects is still mock-backed, so making a task stays withheld.
    expect(wrapper.find('button[aria-label="Criar tarefa"]').exists()).toBe(false)
  })

  it('links an item to the curriculum chosen from the menu', async () => {
    const wrapper = await mountLibrary()
    const item = wrapper.get('.item')
    const id = store.libraryItems.find((candidate) => candidate.title === item.get('.item-title').text())!.id
    const target = store.curricula.find((curriculum) => curriculum.slug !== store.libraryItems.find((c) => c.id === id)?.curriculumSlug)!

    await item.get('button[aria-label="Vincular a currículo"]').trigger('click')
    const row = item.findAll('.act-menu-row').find((candidate) => candidate.text() === target.title)!
    await row.trigger('click')
    await flushReads()

    expect(store.libraryItems.find((candidate) => candidate.id === id)?.curriculumSlug).toBe(target.slug)
    expect(item.find('.act-menu').exists()).toBe(false)
  })

  it('makes a task on the project chosen from the menu', async () => {
    const wrapper = await mountLibrary()
    const item = wrapper.get('.item')
    const title = item.get('.item-title').text()
    const project = store.projects[0]
    const before = store.tasks.length

    await item.get('button[aria-label="Criar tarefa"]').trigger('click')
    const row = item.findAll('.act-menu-row').find((candidate) => candidate.text() === project.title)!
    await row.trigger('click')
    await flushReads()

    expect(store.tasks).toHaveLength(before + 1)
    expect(store.tasks[0]).toMatchObject({ projectId: project.id, title: `Ler "${title}"`, bucket: 'next' })
  })
})
