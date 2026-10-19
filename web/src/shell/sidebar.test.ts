import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { enabledModuleNames, overrideModuleBacking, resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import type { ModuleName } from '@/modules/types'
import { createRouteTable } from '@/router'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import AppSidebar from './AppSidebar.vue'
import { fakeCoreSource, subjectRecord } from './data/testing'

const mounted: Array<{ unmount: () => void }> = []
/** The router the last mount was given, for the cases that assert a navigation. */
let lastRouter: Router | null = null

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
      name: 'Writing',
      slug: 'writing',
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
  lastRouter = router
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
  return wrapper.findAll('nav[aria-label="Main"] > .app-line > .app-line-link').map((link) => link.text().replace(/\d+$/, '').trim())
}

async function expand(wrapper: Awaited<ReturnType<typeof mountSidebar>>, label: string) {
  await wrapper.get(`button[aria-label="Expand ${label}"]`).trigger('click')
}

describe('the sidebar as the phone drawer\'s panel', () => {
  it('offers no collapse button, because a rail holds no navigation', async () => {
    const wide = await mountSidebar()
    // The control exists where it means something, so its absence below is the
    // drawer's doing rather than the button having been dropped altogether.
    expect(wide.find('button.app-collapse').exists()).toBe(true)

    const drawer = await mountSidebar(sidebarSubjects(), { drawer: true })

    expect(drawer.find('button.app-collapse').exists()).toBe(false)
    expect(drawer.get('nav[aria-label="Main"]').text()).toContain('Library')
  })
})

describe('Review in the sidebar', () => {
  it('nests under Study when both are mounted', async () => {
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).not.toContain('Review')
    await expand(wrapper, 'Study')
    const nested = wrapper.findAll('nav[aria-label="Main"] .app-children .app-sub').map((row) => row.text().replace(/\d+$/, '').trim())
    expect(nested).toContain('Review')
  })

  it('stands on its own when Review is mounted without Study', async () => {
    switchOff('study')
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Review')
    expect(topLevelLabels(wrapper)).not.toContain('Study')
    // Nothing to expand: it has no rows of its own.
    expect(wrapper.find('button[aria-label="Expand Review"]').exists()).toBe(false)
  })

  it('leaves Study without a Review row when only Study is mounted', async () => {
    switchOff('review')
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Study')
    expect(topLevelLabels(wrapper)).not.toContain('Review')
    await expand(wrapper, 'Study')
    const nested = wrapper.findAll('nav[aria-label="Main"] .app-children .app-sub').map((row) => row.text().replace(/\d+$/, '').trim())
    expect(nested).toContain('Curricula')
    expect(nested).not.toContain('Review')
  })

  it('mentions neither when neither is mounted', async () => {
    switchOff('study', 'review')
    const wrapper = await mountSidebar()
    const labels = topLevelLabels(wrapper)

    expect(labels).not.toContain('Study')
    expect(labels).not.toContain('Review')
    // The sidebar is still a sidebar: the other products are untouched.
    expect(labels).toContain('Library')
    expect(labels).toContain('Projects')
    expect(labels).toContain('Notes')
    // And the Study shortcut group goes with its module.
    expect(wrapper.get('nav[aria-label="Shortcuts"]').text()).not.toContain('Curricula')
  })
})

describe('the subjects section in the sidebar', () => {
  it('is a top-level section listing every subject, each at its own page', async () => {
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Subjects')
    // It starts expanded: it is a grouping with no index page behind it, so
    // collapsed it says nothing at all.
    const rows = wrapper.findAll('nav[aria-label="Main"] .app-children .app-sub')
    const subjects = rows.filter((row) => row.attributes('href')?.startsWith('/subjects/'))
    expect(subjects.map((row) => row.attributes('href'))).toEqual(['/subjects/kubernetes', '/subjects/writing'])
    expect(subjects[0]!.text()).toContain('Kubernetes')
    // The count is what the subject has linked to it, straight from the read.
    expect(subjects[1]!.text()).toContain('Writing')
    expect(subjects[1]!.text()).toContain('2')
  })

  it('is there whatever the server lists, because the core is not a module', async () => {
    switchOff('study', 'review', 'notes', 'projects')
    const wrapper = await mountSidebar()

    expect(topLevelLabels(wrapper)).toContain('Subjects')
    expect(wrapper.findAll('nav[aria-label="Main"] .app-children .app-sub')
      .some((row) => row.attributes('href') === '/subjects/writing')).toBe(true)
  })

  it('opens the subjects page from its line, in the sidebar and in the phone drawer', async () => {
    for (const props of [{}, { drawer: true }]) {
      const wrapper = await mountSidebar(sidebarSubjects(), props)
      const line = wrapper.get('nav[aria-label="Main"] > .app-line > a[href="/subjects"]')

      expect(line.text()).toContain('Subjects')

      // The screen is a dynamic import, so the router reports its own arrival
      // rather than the click being over by the next tick.
      const navigated = new Promise<void>((resolve) => {
        const stop = lastRouter!.afterEach((to) => {
          if (to.name !== 'subjects') return
          stop()
          resolve()
        })
      })
      await line.trigger('click')
      await navigated

      expect(lastRouter?.currentRoute.value.name).toBe('subjects')
    }
  })

  it('says the vocabulary is empty rather than showing an empty block', async () => {
    const wrapper = await mountSidebar([])

    expect(topLevelLabels(wrapper)).toContain('Subjects')
    expect(wrapper.get('nav[aria-label="Main"]').text()).toContain('No subject yet')
  })

  it('replaces the row that was the subjects row under Study', async () => {
    const wrapper = await mountSidebar()

    await expand(wrapper, 'Study')
    const studyRows = wrapper
      .findAll('nav[aria-label="Main"] .app-children .app-sub')
      .filter((row) => row.attributes('href')?.startsWith('/study'))
      .map((row) => row.text().replace(/\d+$/, '').trim())
    expect(studyRows).toEqual(['Curricula'])
  })
})

describe('the subjects section in the sidebar: more than one page', () => {
  function manySubjects(count: number) {
    return Array.from({ length: count }, (_, index) =>
      subjectRecord({ name: `Subject ${String(index).padStart(3, '0')}` })
    )
  }

  function subjectRows(wrapper: Awaited<ReturnType<typeof mountSidebar>>) {
    return wrapper
      .findAll('nav[aria-label="Main"] .app-children .app-sub')
      .filter((row) => row.attributes('href')?.startsWith('/subjects/'))
  }

  function assuntosCount(wrapper: Awaited<ReturnType<typeof mountSidebar>>): string {
    return wrapper.get('nav[aria-label="Main"] a[href="/subjects"] .app-count').text()
  }

  function moreButton(wrapper: Awaited<ReturnType<typeof mountSidebar>>) {
    return wrapper.findAll('nav[aria-label="Main"] button').find((button) => button.text() === 'Load more')
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

  it('offers no "Load more" when everything fits on the first page', async () => {
    const wrapper = await mountSidebar(manySubjects(3))

    expect(subjectRows(wrapper)).toHaveLength(3)
    expect(assuntosCount(wrapper)).toBe('3')
    expect(moreButton(wrapper)).toBeUndefined()
  })
})

describe('the Lists group', () => {
  it('is not rendered while Study is mock-backed', async () => {
    const wrapper = await mountSidebar()

    await expand(wrapper, 'Library')
    // An `api`-backed library item cannot point at a mock curriculum, so there
    // is nothing a Lists group could list; it returns with the study delivery,
    // fed by `material_of` links.
    const heads = wrapper.findAll('nav[aria-label="Main"] .app-head').map((head) => head.text())
    expect(heads).toContain('Kinds')
    expect(heads).not.toContain('Lists')
    expect(wrapper.get('nav[aria-label="Main"]').text()).not.toContain('Lists')
  })
})
