import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { LibraryItemRecord } from '../data/source'
import { fakeLibrarySource, libraryRecord, type FakeLibrarySource } from '../data/testing'
import MaterialView from './MaterialView.vue'

/**
 * The study material screen, now that the library reads the server.
 *
 * Notes, study and review still read the mock, so every crossing this screen
 * used to offer — the annotations panel's content, the next material, the
 * selection actions — is withheld by the gating rule. What is left is the
 * reading surface itself, and that is what these cases hold.
 */
const ARTICLE_HTML = '<p>Abertura do artigo.</p><h2 id="uma-secao">Uma seção</h2><p>Corpo.</p>'

function record(overrides: Partial<LibraryItemRecord> = {}): LibraryItemRecord {
  return libraryRecord({
    id: 'post-um',
    kind: 'article',
    title: 'Um texto guardado',
    author: 'Equipe Norte',
    content_html: ARTICLE_HTML,
    ...overrides
  })
}

const SHELF: LibraryItemRecord[] = [
  record(),
  record({ id: 'livro-um', kind: 'book', title: 'Um livro guardado', author: 'Marina Costa' }),
  record({ id: 'paper-um', kind: 'paper', title: 'Um paper guardado', site: 'papers.example' })
]

beforeEach(() => {
  setEnabledModules(['library'])
})

afterEach(() => {
  resetModuleMounting()
  vi.restoreAllMocks()
})

async function mountAt(path: string, previousPath?: string, library?: Partial<AppSources['library']>) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  if (previousPath) await router.push(previousPath)
  await router.push(path)
  await router.isReady()
  const wrapper = mount(MaterialView, {
    global: {
      plugins: [router, sourcesPlugin({ library: (library ?? fakeLibrarySource(SHELF)) as AppSources['library'] })]
    }
  })
  await flushReads()
  return { wrapper, router }
}

function tab(wrapper: VueWrapper, label: string) {
  return wrapper.findAll('[role="tab"]').find((candidate) => candidate.text().includes(label))!
}

describe('MaterialView', () => {
  it.each([
    ['/material/article/post-um', '.reader-post', 'Leitura', '[aria-label="Nota e anotações"]'],
    ['/material/book/livro-um', '.reader-book', 'Leitura', '.nt-rail']
  ])('renders the %s reading variant with its open or collapsed panel', async (path, readerClass, mode, panelSelector) => {
    const { wrapper } = await mountAt(path)

    expect(wrapper.find(readerClass).exists()).toBe(true)
    expect(wrapper.find('h1').exists()).toBe(true)
    expect(tab(wrapper, mode).attributes('aria-selected')).toBe('true')
    expect(wrapper.find(panelSelector).exists()).toBe(true)
  })

  it('renders the extracted article in the post variant', async () => {
    const { wrapper } = await mountAt('/material/article/post-um')

    expect(wrapper.get('.article-content').text()).toContain('Abertura do artigo')
    expect(wrapper.find('[id="uma-secao"]').exists()).toBe(true)
  })

  it('renders the book controls and starts its panel collapsed', async () => {
    const { wrapper } = await mountAt('/material/book/livro-um')

    expect(wrapper.text()).toContain('Sumário')
    expect(wrapper.find('button[aria-label="Tipografia"]').exists()).toBe(true)
    expect(wrapper.find('.nt-rail').exists()).toBe(true)
    expect(wrapper.find('.nt-panel').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Open the panel"]').exists()).toBe(true)
  })

  it('renders the paper in exercises mode and reveals its reading extras after switching', async () => {
    const { wrapper } = await mountAt('/material/paper/paper-um')

    expect(wrapper.find('.material-exercises').exists()).toBe(true)
    expect(tab(wrapper, 'Exercícios').attributes('aria-selected')).toBe('true')
    expect(wrapper.find('.nt-panel').exists()).toBe(false)

    await tab(wrapper, 'Leitura').trigger('click')

    expect(wrapper.find('.reader-paper').exists()).toBe(true)
    expect(wrapper.text()).toContain('Seções')
    expect(wrapper.text()).toContain('PDF original')
    expect(wrapper.find('.nt-panel').exists()).toBe(true)
  })

  it('collapses and reopens the reading panel and switches its tabs', async () => {
    const { wrapper } = await mountAt('/material/article/post-um')

    await wrapper.find('button[aria-label="Collapse the panel"]').trigger('click')
    expect(wrapper.find('.nt-rail').exists()).toBe(true)

    await wrapper.find('button[aria-label^="Open Anotações"]').trigger('click')
    expect(wrapper.find('.nt-panel').exists()).toBe(true)
    expect(wrapper.find('.nt-panel .nt-tab.is-active').text()).toContain('Anotações')
  })

  it('withholds the selection actions while the notes module reads elsewhere', async () => {
    const selection = {
      toString: () => 'o detalhe observável',
      removeAllRanges: vi.fn()
    }
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
    const { wrapper } = await mountAt('/material/article/post-um')

    await wrapper.find('[data-selection-target]').trigger('mouseup')

    // A highlight is a note, and a note cannot be hung off a real id while the
    // notes module answers from the mock.
    expect(wrapper.findComponent({ name: 'SelectionToolbar' }).exists()).toBe(false)
  })

  it('offers no next material while the study module reads elsewhere', async () => {
    const { wrapper } = await mountAt('/material/article/post-um')

    expect(wrapper.find('.material-next').exists()).toBe(false)
    expect(wrapper.get('.material-back').text()).toContain('Biblioteca')
  })

  it('refuses short exercise answers and accepts a response with ten characters', async () => {
    const { wrapper } = await mountAt('/material/book/livro-um')
    await tab(wrapper, 'Exercícios').trigger('click')

    const answer = wrapper.find('#material-answer')
    await answer.setValue('curto')
    expect(wrapper.find('.exercise-actions button').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.exercise-item:nth-child(2)').classes()).not.toContain('is-done')

    await answer.setValue('uma resposta longa')
    await wrapper.find('.exercise-actions button').trigger('click')
    expect(wrapper.find('.exercise-item:nth-child(2)').classes()).toContain('is-done')
    expect(wrapper.find('.exercise-item:nth-child(2) .exercise-meta').text()).toContain('Feito')
  })

  it('marks the material as read and returns to the previous route', async () => {
    const library: FakeLibrarySource = fakeLibrarySource(SHELF)
    const { wrapper, router } = await mountAt('/material/book/livro-um', '/library', library)

    await wrapper.find('[data-action="complete"]').trigger('click')
    await flushReads()

    // Reading it does not move it out of the shelf it was on.
    expect(library.calls.patch).toEqual([{ id: 'livro-um', patch: { unread: false } }])
    expect(library.records[1]).toMatchObject({ location: 'inbox', unread: false })
    expect(wrapper.find('[data-action="complete"]').text()).toContain('Concluído')

    await wrapper.find('.material-back').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(router.currentRoute.value.fullPath).toBe('/library')
  })

  it('says it is loading until the material answers', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/material/article/post-um')
    await router.isReady()
    const wrapper = mount(MaterialView, {
      global: {
        plugins: [
          router,
          sourcesPlugin({
            library: fakeLibrarySource([], {
              getItem: () => new Promise<LibraryItemRecord | null>(() => {})
            }) as AppSources['library']
          })
        ]
      }
    })

    expect(wrapper.get('[role="status"]').text()).toContain('Carregando o material')
    expect(wrapper.find('.material-body').exists()).toBe(false)
  })

  it('offers a way back instead of a reader for a material that does not exist', async () => {
    const { wrapper } = await mountAt('/material/article/nao-existe')

    expect(wrapper.get('h1').text()).toBe('Material não encontrado')
    expect(wrapper.get('a.material-state-action').attributes('href')).toBe('/library?v=all')
    expect(wrapper.find('.material-body').exists()).toBe(false)
  })

  it('says why the material could not be read, and tries again when asked', async () => {
    let attempts = 0
    const { wrapper } = await mountAt('/material/article/post-um', undefined, {
      ...fakeLibrarySource(SHELF),
      getItem: async () => {
        attempts += 1
        if (attempts === 1) throw new Error('rede indisponível')
        return record()
      }
    })

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível carregar o material: rede indisponível')

    await wrapper.get('.material-state-action').trigger('click')
    await flushReads()

    expect(wrapper.find('.reader-post').exists()).toBe(true)
  })

  it('keeps the material as it was when marking it read fails', async () => {
    const { wrapper } = await mountAt('/material/article/post-um', undefined, {
      ...fakeLibrarySource(SHELF),
      patchItem: async () => {
        throw new Error('conflito no servidor')
      }
    })

    await wrapper.get('[data-action="complete"]').trigger('click')
    await flushReads()

    expect(wrapper.get('.material-write-error').text()).toContain('Não foi possível salvar: conflito no servidor')
    expect(wrapper.get('[data-action="complete"]').text()).toContain('Marcar como concluído')
  })
})
