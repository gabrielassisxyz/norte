import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { enabledModuleNames, overrideModuleBacking, resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import type { ModuleName } from '@/modules/types'
import { createRouteTable } from '@/router'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import AppSidebar from './AppSidebar.vue'
import { fakeCoreSource, subjectRecord } from './data/testing'

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

/**
 * Switch the named modules to `api` and tell the app the server lists none of
 * them. The library and the notes stay listed: both are `api`-backed in their
 * own manifests, and a sidebar without them is not the sidebar these cases are
 * about.
 */
function switchOff(...names: ModuleName[]): void {
  for (const name of names) overrideModuleBacking(name, 'api')
  setEnabledModules(['library', 'notes'])
}

/** The subjects the core answers with, which the shell lists on its own. */
function sidebarSubjects() {
  return [
    subjectRecord({
      name: 'Escrita',
      slug: 'escrita',
      counts: { total: 2, by_type: [{ module: 'library', type: 'article', count: 2 }] }
    }),
    subjectRecord({ name: 'Kubernetes', slug: 'kubernetes' })
  ]
}

async function mountSidebar(subjects = sidebarSubjects(), props: { collapsed?: boolean; drawer?: boolean } = {}) {
  // The library and the notes are `api`-backed in their own manifests, so a
  // sidebar with their lines is one mounted against a server that lists them.
  for (const name of ['library', 'notes'] as ModuleName[]) {
    if (!enabledModuleNames().includes(name)) setEnabledModules([...enabledModuleNames(), name])
  }
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(AppSidebar, {
    props,
    global: {
      plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core: fakeCoreSource({ subjects }) }))]
    }
  })
  mounted.push(wrapper)
  // Every row and every count is a module's own read, so there is no sidebar to
  // assert on until those reads have answered.
  await flushReads()
  return wrapper
}

function topLevelLabels(wrapper: { findAll: (selector: string) => Array<{ text: () => string }> }): string[] {
  return wrapper.findAll('nav[aria-label="Principal"] > .app-line > .app-line-link').map((link) => link.text().replace(/\d+$/, '').trim())
}

async function expand(wrapper: Awaited<ReturnType<typeof mountSidebar>>, label: string) {
  await wrapper.get(`button[aria-label="Expandir ${label}"]`).trigger('click')
}

describe('the sidebar as the phone drawer\'s panel', () => {
  it('offers no collapse button, because a rail holds no navigation', async () => {
    const wide = await mountSidebar()
    // The control exists where it means something, so its absence below is the
    // drawer's doing rather than the button having been dropped altogether.
    expect(wide.find('button.app-collapse').exists()).toBe(true)

    const drawer = await mountSidebar(sidebarSubjects(), { drawer: true })

    expect(drawer.find('button.app-collapse').exists()).toBe(false)
    expect(drawer.get('nav[aria-label="Principal"]').text()).toContain('Library')
  })
})

describe('Revisão in the sidebar', () => {
  it('nests under Estudo when both are mounted', async () => {
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).not.toContain('Revisão')
    await expand(wrapper, 'Estudo')
    const nested = wrapper.findAll('nav[aria-label="Principal"] .app-children .app-sub').map((row) => row.text().replace(/\d+$/, '').trim())
    expect(nested).toContain('Revisão')
  })

  it('stands on its own when Revisão is mounted without Estudo', async () => {
    switchOff('study')
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Revisão')
    expect(topLevelLabels(wrapper)).not.toContain('Estudo')
    // Nothing to expand: it has no rows of its own.
    expect(wrapper.find('button[aria-label="Expandir Revisão"]').exists()).toBe(false)
  })

  it('leaves Estudo without a Revisão row when only Estudo is mounted', async () => {
    switchOff('review')
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Estudo')
    expect(topLevelLabels(wrapper)).not.toContain('Revisão')
    await expand(wrapper, 'Estudo')
    const nested = wrapper.findAll('nav[aria-label="Principal"] .app-children .app-sub').map((row) => row.text().replace(/\d+$/, '').trim())
    expect(nested).toContain('Currículos')
    expect(nested).not.toContain('Revisão')
  })

  it('mentions neither when neither is mounted', async () => {
    switchOff('study', 'review')
    const wrapper = await mountSidebar()
    const labels = topLevelLabels(wrapper)

    expect(labels).not.toContain('Estudo')
    expect(labels).not.toContain('Revisão')
    // The sidebar is still a sidebar: the other products are untouched.
    expect(labels).toContain('Library')
    expect(labels).toContain('Projetos')
    expect(labels).toContain('Notas')
    // And the Estudo shortcut group goes with its module.
    expect(wrapper.get('nav[aria-label="Atalhos"]').text()).not.toContain('Currículos')
  })
})

describe('Assuntos in the sidebar', () => {
  it('is a top-level section listing every subject, each at its own page', async () => {
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Assuntos')
    // It starts expanded: it is a grouping with no index page behind it, so
    // collapsed it says nothing at all.
    const rows = wrapper.findAll('nav[aria-label="Principal"] .app-children .app-sub')
    const subjects = rows.filter((row) => row.attributes('href')?.startsWith('/subjects/'))
    expect(subjects.map((row) => row.attributes('href'))).toEqual(['/subjects/escrita', '/subjects/kubernetes'])
    expect(subjects[0]!.text()).toContain('Escrita')
    // The count is what the subject has linked to it, straight from the read.
    expect(subjects[0]!.text()).toContain('2')
  })

  it('is there whatever the server lists, because the core is not a module', async () => {
    switchOff('study', 'review', 'notes', 'projects')
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Assuntos')
    expect(wrapper.findAll('nav[aria-label="Principal"] .app-children .app-sub')
      .some((row) => row.attributes('href') === '/subjects/escrita')).toBe(true)
  })

  it('says the vocabulary is empty rather than showing an empty block', async () => {
    const wrapper = await mountSidebar([])

    expect(topLevelLabels(wrapper)).toContain('Assuntos')
    expect(wrapper.get('nav[aria-label="Principal"]').text()).toContain('Nenhum assunto ainda')
  })

  it('replaces the Assuntos row that used to sit under Estudo', async () => {
    const wrapper = await mountSidebar()

    await expand(wrapper, 'Estudo')
    const estudoRows = wrapper
      .findAll('nav[aria-label="Principal"] .app-children .app-sub')
      .filter((row) => row.attributes('href')?.startsWith('/estudo'))
      .map((row) => row.text().replace(/\d+$/, '').trim())
    expect(estudoRows).toEqual(['Currículos'])
  })
})

describe('Assuntos in the sidebar: more than one page', () => {
  function manySubjects(count: number) {
    return Array.from({ length: count }, (_, index) =>
      subjectRecord({ name: `Assunto ${String(index).padStart(3, '0')}` })
    )
  }

  function subjectRows(wrapper: Awaited<ReturnType<typeof mountSidebar>>) {
    return wrapper
      .findAll('nav[aria-label="Principal"] .app-children .app-sub')
      .filter((row) => row.attributes('href')?.startsWith('/subjects/'))
  }

  function assuntosCount(wrapper: Awaited<ReturnType<typeof mountSidebar>>): string {
    return wrapper.get('nav[aria-label="Principal"] .app-group .app-count').text()
  }

  function moreButton(wrapper: Awaited<ReturnType<typeof mountSidebar>>) {
    return wrapper.findAll('nav[aria-label="Principal"] button').find((button) => button.text() === 'Carregar mais')
  }

  it('lists the first page, marks the count as partial, and loads the rest on request', async () => {
    const wrapper = await mountSidebar(manySubjects(120))

    expect(subjectRows(wrapper)).toHaveLength(50)
    // The API gives no total, so a bare 50 would read as the whole vocabulary.
    expect(assuntosCount(wrapper)).toBe('50+')

    await moreButton(wrapper)!.trigger('click')
    await flushReads()
    expect(subjectRows(wrapper)).toHaveLength(100)
    expect(assuntosCount(wrapper)).toBe('100+')

    await moreButton(wrapper)!.trigger('click')
    await flushReads()
    expect(subjectRows(wrapper)).toHaveLength(120)
    expect(assuntosCount(wrapper)).toBe('120')
    expect(moreButton(wrapper)).toBeUndefined()
  })

  it('offers no "carregar mais" when everything fits on the first page', async () => {
    const wrapper = await mountSidebar(manySubjects(3))

    expect(subjectRows(wrapper)).toHaveLength(3)
    expect(assuntosCount(wrapper)).toBe('3')
    expect(moreButton(wrapper)).toBeUndefined()
  })
})

describe('the Listas group', () => {
  it('is not rendered while Estudo is mock-backed', async () => {
    const wrapper = await mountSidebar()

    await expand(wrapper, 'Library')
    // An `api`-backed library item cannot point at a mock curriculum, so there
    // is nothing a Listas group could list; it returns with the study delivery,
    // fed by `material_of` links.
    const heads = wrapper.findAll('nav[aria-label="Principal"] .app-head').map((head) => head.text())
    expect(heads).toContain('Kinds')
    expect(heads).not.toContain('Listas')
    expect(wrapper.get('nav[aria-label="Principal"]').text()).not.toContain('Listas')
  })
})
