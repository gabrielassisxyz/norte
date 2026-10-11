import { flushPromises, mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import ShellOverlay from '@/shell/ShellOverlay.vue'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { routes } from '@/router'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'
import { setTheme } from '@/theme'

import { coreSearchHit, fakeCoreSource, subjectRecord } from './data/testing'
import type { CoreSearchHit, CoreSource } from './data/source'

afterEach(() => {
  resetModuleMounting()
})

/** What the server would answer for the fixtures the palette tests search. */
const SAVED_ITEM = coreSearchHit({
  id: 'lib-livro',
  module: 'library',
  type: 'book',
  title: 'Um livro guardado',
  subtitle: 'Uma autora',
  path: '/library/lib-livro',
  score: 1
})

const SAVED_NOTE = coreSearchHit({
  id: 'ann-1',
  module: 'notes',
  type: 'annotation',
  title: 'uma anotação sobre o livro guardado',
  path: '/notas?tab=anotacoes',
  score: 0.5
})

async function mountOverlay(open: 'busca' | 'prefs', core?: CoreSource) {
  // The palette offers the library's screens, and the library is `api`-backed.
  setEnabledModules(['library'])
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(ShellOverlay, {
    props: { open },
    global: {
      plugins: [
        router,
        sourcesPlugin(
          appSourcesWithLibrary({
            core: core ?? fakeCoreSource({ hits: [SAVED_ITEM, SAVED_NOTE] })
          })
        )
      ]
    }
  })
  // The palette offers what each mounted module answered with.
  await flushReads()
  return { wrapper, router }
}

describe('shell overlay', () => {
  it('renders the search dialog and its primary regions', async () => {
    const { wrapper } = await mountOverlay('busca')

    expect(wrapper.get('[role="dialog"]').attributes('aria-label')).toBe('Buscar')
    expect(wrapper.get('input[aria-label="Buscar"]').attributes('placeholder')).toBe(
      'Buscar telas, artigos, notas, assuntos…'
    )
    expect(wrapper.text()).toContain('Ir para')
    expect(wrapper.text()).toContain('Ações')
  })

  it('finds a saved item by a word of its content, which only the server knows', async () => {
    const { wrapper } = await mountOverlay('busca')
    const search = wrapper.get('input[aria-label="Buscar"]')

    // "guardado" is in no screen's title: the only way this row can appear is
    // the server's answer, which is the point of the whole endpoint.
    await search.setValue('guardado')
    await flushReads()

    const rows = wrapper.findAll('.shell-palette-row')
    expect(rows.map((row) => row.get('.shell-palette-title').text())).toEqual([
      'Um livro guardado',
      'uma anotação sobre o livro guardado'
    ])
    // Each source's hits sit under their own heading, in the order the server
    // sent them.
    expect(wrapper.findAll('[role="group"]').map((group) => group.attributes('aria-label'))).toEqual([
      'Biblioteca',
      'Notas'
    ])
  })

  it('shows the screens it owns above the hits it had to ask for', async () => {
    const { wrapper } = await mountOverlay('busca')

    await wrapper.get('input[aria-label="Buscar"]').setValue('biblioteca')
    await flushReads()

    const groups = wrapper.findAll('[role="group"]').map((group) => group.attributes('aria-label'))
    expect(groups[0]).toBe('Telas')
  })

  it('is a combobox: the roles, the ids and the active option are all named', async () => {
    const { wrapper } = await mountOverlay('busca')
    const search = wrapper.get('input[aria-label="Buscar"]')

    expect(search.attributes('role')).toBe('combobox')
    expect(search.attributes('aria-autocomplete')).toBe('list')
    expect(search.attributes('aria-expanded')).toBe('true')
    expect(search.attributes('aria-controls')).toBe('shell-palette-listbox')
    expect(wrapper.get('#shell-palette-listbox').attributes('role')).toBe('listbox')

    await search.setValue('guardado')
    await flushReads()

    const rows = wrapper.findAll('.shell-palette-row')
    expect(rows[0].attributes('role')).toBe('option')
    expect(rows[0].attributes('id')).toBe('shell-palette-option-0')
    expect(rows[0].attributes('aria-selected')).toBe('true')
    expect(rows[1].attributes('aria-selected')).toBe('false')
    // The focus never leaves the input, so the current option is named on it.
    expect(search.attributes('aria-activedescendant')).toBe('shell-palette-option-0')
  })

  it('moves the active option with the arrow keys and reports it on the input', async () => {
    const { wrapper } = await mountOverlay('busca')
    const search = wrapper.get('input[aria-label="Buscar"]')

    await search.setValue('guardado')
    await flushReads()

    await search.trigger('keydown', { key: 'ArrowDown' })
    expect(search.attributes('aria-activedescendant')).toBe('shell-palette-option-1')
    expect(wrapper.findAll('.shell-palette-row')[1].attributes('aria-selected')).toBe('true')

    await search.trigger('keydown', { key: 'ArrowUp' })
    expect(search.attributes('aria-activedescendant')).toBe('shell-palette-option-0')
  })

  it('opens the highlighted hit with Enter, at the path the server gave it', async () => {
    const { wrapper, router } = await mountOverlay('busca')
    const search = wrapper.get('input[aria-label="Buscar"]')

    await search.setValue('guardado')
    await flushReads()
    expect(wrapper.get('.shell-palette-row').classes()).toContain('is-highlighted')
    // Module routes are lazy, so the push also waits on a dynamic import. The
    // router reports its own arrival, which is a fact rather than a deadline:
    // polling for a fixed number of milliseconds fails on a busy machine for
    // reasons that have nothing to do with the screen under test.
    const navigated = new Promise<void>((resolve) => {
      const stop = router.afterEach((to) => {
        if (to.name !== 'reader') return
        stop()
        resolve()
      })
    })
    await search.trigger('keydown', { key: 'Enter' })
    await navigated
    // The overlay closes itself once its own push resolves, one turn later.
    await flushPromises()

    expect(router.currentRoute.value.name).toBe('reader')
    expect(router.currentRoute.value.params).toMatchObject({ id: 'lib-livro' })
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('finds a subject by its name', async () => {
    const core = fakeCoreSource({
      subjects: [subjectRecord({ id: 'subject-memoria', name: 'Memória', slug: 'memoria' })]
    })
    const { wrapper } = await mountOverlay('busca', core)

    await wrapper.get('input[aria-label="Buscar"]').setValue('memoria')
    await flushReads()

    const titles = wrapper.findAll('.shell-palette-row').map((row) => row.get('.shell-palette-title').text())
    expect(titles).toContain('Memória')
    expect(wrapper.findAll('[role="group"]').map((group) => group.attributes('aria-label'))).toContain(
      'Assuntos'
    )
  })

  it('says so when the server found nothing, and shows the server sentence when it refused', async () => {
    const { wrapper } = await mountOverlay('busca')
    const search = wrapper.get('input[aria-label="Buscar"]')

    await search.setValue('zarabatana')
    await flushReads()
    expect(wrapper.get('.shell-palette-empty').text()).toContain('Nada encontrado')

    const refusing = fakeCoreSource({}, {
      async search(): Promise<CoreSearchHit[]> {
        throw new Error('a busca não tem palavra nenhuma')
      }
    })
    const refused = await mountOverlay('busca', refusing)
    await refused.wrapper.get('input[aria-label="Buscar"]').setValue('...')
    await flushReads()
    expect(refused.wrapper.get('.shell-palette-empty').text()).toBe('a busca não tem palavra nenhuma')
  })

  it('aborts a query the next keystroke supersedes, and never renders its answer', async () => {
    const signals: AbortSignal[] = []
    const releases: Array<(hits: CoreSearchHit[]) => void> = []
    const core = fakeCoreSource({}, {
      search(_query: string, signal: AbortSignal): Promise<CoreSearchHit[]> {
        signals.push(signal)
        return new Promise<CoreSearchHit[]>((resolve, reject) => {
          releases.push(resolve)
          signal.addEventListener('abort', () => reject(new Error('aborted')))
        })
      }
    })
    const { wrapper } = await mountOverlay('busca', core)
    const search = wrapper.get('input[aria-label="Buscar"]')

    await search.setValue('mem')
    await search.setValue('memória')
    expect(signals).toHaveLength(2)

    // The first request is cancelled by the second, which is the whole point:
    // its answer would be for a word no longer in the box.
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)

    // Releasing it anyway must change nothing on screen. A promise already
    // resolved before the abort fired would still arrive here, so the state
    // is guarded by identity and not only by the signal.
    const stale = coreSearchHit({ id: 'stale', title: 'Resultado velho' })
    releases[0]([stale])
    await flushReads()
    expect(wrapper.text()).not.toContain('Resultado velho')

    releases[1]([coreSearchHit({ id: 'fresh', title: 'Resultado novo' })])
    await flushReads()
    expect(wrapper.text()).toContain('Resultado novo')
  })

  it('drops a superseded answer that arrives anyway, signal or no signal', async () => {
    // A source that ignores the abort is the case the signal cannot cover:
    // the request completes, and what stops its rows from landing is the
    // palette noticing that another query has taken over since.
    const releases: Array<(hits: CoreSearchHit[]) => void> = []
    const core = fakeCoreSource({}, {
      search(): Promise<CoreSearchHit[]> {
        return new Promise<CoreSearchHit[]>((resolve) => {
          releases.push(resolve)
        })
      }
    })
    const { wrapper } = await mountOverlay('busca', core)
    const search = wrapper.get('input[aria-label="Buscar"]')

    await search.setValue('mem')
    await search.setValue('memória')
    expect(releases).toHaveLength(2)

    releases[0]([coreSearchHit({ id: 'stale', title: 'Resultado velho' })])
    await flushReads()
    expect(wrapper.text()).not.toContain('Resultado velho')

    releases[1]([coreSearchHit({ id: 'fresh', title: 'Resultado novo' })])
    await flushReads()
    expect(wrapper.text()).toContain('Resultado novo')
  })

  it('opens with the text a screen handed over and searches for it at once', async () => {
    const core = fakeCoreSource({ hits: [SAVED_ITEM] })
    const searched = vi.spyOn(core, 'search')
    setEnabledModules(['library'])
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(ShellOverlay, {
      props: { open: null, initialQuery: 'guardado' },
      global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core }))] }
    })
    await flushReads()

    await wrapper.setProps({ open: 'busca' })
    await flushReads()

    expect(searched).toHaveBeenCalledWith('guardado', expect.anything())
    expect(wrapper.get('input[aria-label="Buscar"]').element).toHaveProperty('value', 'guardado')
    expect(wrapper.text()).toContain('Um livro guardado')
  })

  it('closes on Escape', async () => {
    const { wrapper } = await mountOverlay('busca')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('switches the theme from the action and opens preferences from the other action', async () => {
    setTheme('light')
    const { wrapper } = await mountOverlay('busca')
    const buttons = wrapper.findAll('.shell-palette-row')
    const toggle = buttons.find((button) => button.text().includes('Alternar tema'))
    const preferences = buttons.find((button) => button.text().includes('Preferências'))

    await toggle!.trigger('click')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('norte-theme')).toBe('dark')

    await preferences!.trigger('click')
    expect(wrapper.emitted('open-preferences')).toHaveLength(1)
  })

  it('shows the preference controls and persists the selected theme', async () => {
    setTheme('light')
    const { wrapper } = await mountOverlay('prefs')

    expect(wrapper.get('#shell-preferences-title').text()).toBe('Preferências')
    await wrapper.get('button[role="radio"][aria-checked="false"]').trigger('click')

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('norte-theme')).toBe('dark')
    expect(wrapper.text()).toContain('dados')
    expect(wrapper.text()).toContain('servidor')
    expect(wrapper.text()).toContain('atalho')
  })
})
