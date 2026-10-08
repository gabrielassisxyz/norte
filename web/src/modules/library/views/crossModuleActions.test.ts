import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import { overrideModuleBacking, resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { createRouteTable } from '@/router'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import { libraryRecord } from '../data/testing'
import LibraryView from './LibraryView.vue'

const mounted: Array<{ unmount: () => void }> = []
let store: MockStore

beforeEach(() => {
  store = createMockStore()
  setEnabledModules(['library'])
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
    global: {
      plugins: [
        router,
        sourcesPlugin(
          appSourcesWithLibrary({
            store,
            records: [libraryRecord({ id: 'post-um', title: 'Um texto guardado', status: 'inbox' })]
          })
        )
      ]
    }
  })
  mounted.push(wrapper)
  await flushReads()
  return wrapper
}

describe('the actions an item offers into another module', () => {
  it('withholds them while the library reads the server and projects reads the mock', async () => {
    const wrapper = await mountLibrary()

    // The library itself is mounted: its rows are there to carry the actions.
    expect(wrapper.findAll('.item').length).toBeGreaterThan(0)
    expect(wrapper.find('button[aria-label="Criar tarefa"]').exists()).toBe(false)
  })

  it('offers them once the other module reads from the same place', async () => {
    overrideModuleBacking('projects', 'api')
    setEnabledModules(['library', 'projects'])
    const wrapper = await mountLibrary()

    expect(wrapper.find('button[aria-label="Criar tarefa"]').exists()).toBe(true)
  })

  it('withholds them again when the other module is served from nowhere', async () => {
    overrideModuleBacking('projects', 'api')
    // Same backing, but the server does not serve it: there is nothing to
    // reach into.
    setEnabledModules(['library'])
    const wrapper = await mountLibrary()

    expect(wrapper.find('button[aria-label="Criar tarefa"]').exists()).toBe(false)
  })

  it('makes a task on the project chosen from the menu', async () => {
    overrideModuleBacking('projects', 'api')
    setEnabledModules(['library', 'projects'])
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
    expect(item.find('.act-menu').exists()).toBe(false)
  })
})
