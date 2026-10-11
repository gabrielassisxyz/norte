import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import { overrideModuleBacking, resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { createRouteTable } from '@/router'
import { fakeCoreSource, subjectRecord, type FakeCoreSource } from '@/shell/data/testing'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import { libraryRecord } from '../data/testing'
import LibraryView from './LibraryView.vue'

const mounted: Array<{ unmount: () => void }> = []
let store: MockStore
let core: FakeCoreSource

beforeEach(() => {
  store = createMockStore()
  core = fakeCoreSource({ subjects: [subjectRecord({ id: 'subject-k8s', name: 'Kubernetes', focus: true })] })
  setEnabledModules(['library'])
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

async function mountLibrary() {
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/library?v=all')
  await router.isReady()
  const wrapper = mount(LibraryView, {
    global: {
      plugins: [
        router,
        sourcesPlugin(
          appSourcesWithLibrary({
            store,
            core,
            records: [libraryRecord({ id: 'post-um', title: 'Um texto guardado', location: 'inbox' })]
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

describe('the subject link picker on an item', () => {
  it('is offered whatever the other modules are, because the core is always on', async () => {
    // The task action is withheld here: projects is mock-backed while the
    // library reads the server. The subject picker is not that kind of
    // crossing, and the gate must not take it with it.
    const wrapper = await mountLibrary()

    expect(wrapper.find('button[aria-label="Criar tarefa"]').exists()).toBe(false)
    expect(wrapper.find('button[aria-label="Ligar a um assunto"]').exists()).toBe(true)
  })

  it('links the item to the subject chosen from the picker', async () => {
    const wrapper = await mountLibrary()
    const item = wrapper.get('.item')

    await item.get('button[aria-label="Ligar a um assunto"]').trigger('click')
    await flushReads()
    await item.get('[role="option"]').trigger('click')
    await flushReads()

    // The item is the source and the subject the target, which is the
    // direction `about` is read in.
    expect(core.calls.createLink).toEqual([{ srcId: 'post-um', dstId: 'subject-k8s', kind: 'about' }])
    expect(core.links).toHaveLength(1)
    expect(item.find('.act-menu').exists()).toBe(false)
  })

  it('keeps the picker open when the link could not be written', async () => {
    core = fakeCoreSource(
      { subjects: [subjectRecord({ id: 'subject-k8s', name: 'Kubernetes', focus: true })] },
      {
        createLink: async () => {
          throw new Error('rede indisponível')
        }
      }
    )
    const wrapper = await mountLibrary()
    const item = wrapper.get('.item')

    await item.get('button[aria-label="Ligar a um assunto"]').trigger('click')
    await flushReads()
    await item.get('[role="option"]').trigger('click')
    await flushReads()

    expect(core.links).toHaveLength(0)
    expect(item.find('.act-menu').exists()).toBe(true)
  })
})
