import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { routes } from '@/router'
import { store } from '@/mock/store'
import MaterialView from './MaterialView.vue'

async function mountAt(path: string, previousPath?: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  if (previousPath) await router.push(previousPath)
  await router.push(path)
  await router.isReady()
  const wrapper = mount(MaterialView, { global: { plugins: [router] } })
  return { wrapper, router }
}

function tab(wrapper: VueWrapper, label: string) {
  return wrapper.findAll('[role="tab"]').find((candidate) => candidate.text().includes(label))!
}

describe('MaterialView', () => {
  afterEach(() => {
    vi.restoreAllMocks()
  })

  it.each([
    ['/material/post/post-compilation', '.reader-post', 'Leitura', '[aria-label="Nota e anotações"]'],
    ['/material/livro/book-interpreters', '.reader-book', 'Leitura', '.nt-rail']
  ])('renders the %s reading variant with its open or collapsed panel', async (path, readerClass, mode, panelSelector) => {
    const { wrapper } = await mountAt(path)

    expect(wrapper.find(readerClass).exists()).toBe(true)
    expect(wrapper.find('h1').exists()).toBe(true)
    expect(tab(wrapper, mode).attributes('aria-selected')).toBe('true')
    expect(wrapper.find(panelSelector).exists()).toBe(true)
  })

  it('renders the book controls and starts its panel collapsed', async () => {
    const { wrapper } = await mountAt('/material/livro/book-interpreters')

    expect(wrapper.text()).toContain('Sumário')
    expect(wrapper.find('button[aria-label="Tipografia"]').exists()).toBe(true)
    expect(wrapper.find('.nt-rail').exists()).toBe(true)
    expect(wrapper.find('.nt-panel').exists()).toBe(false)
    expect(wrapper.find('[aria-label="Abrir painel"]').exists()).toBe(true)
  })

  it('renders the paper in exercises mode and reveals its reading extras after switching', async () => {
    const { wrapper } = await mountAt('/material/paper/paper-parsing')

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
    const { wrapper } = await mountAt('/material/post/post-compilation')

    await wrapper.find('button[aria-label="Recolher painel"]').trigger('click')
    expect(wrapper.find('.nt-rail').exists()).toBe(true)

    await wrapper.find('button[aria-label^="Abrir Anotações"]').trigger('click')
    expect(wrapper.find('.nt-panel').exists()).toBe(true)
    expect(wrapper.find('.nt-panel .nt-tab.is-active').text()).toContain('Anotações')
  })

  it('shows the selection toolbar and persists highlight and annotation actions', async () => {
    const initialAnnotations = store.annotations.filter((annotation) => annotation.materialId === 'post-compilation').length
    const selection = {
      toString: () => 'observe o padrão antes de tentar explicá-lo',
      removeAllRanges: vi.fn()
    }
    vi.spyOn(window, 'getSelection').mockReturnValue(selection as unknown as Selection)
    const { wrapper } = await mountAt('/material/post/post-compilation')

    await wrapper.find('[data-selection-target]').trigger('mouseup')
    expect(wrapper.findComponent({ name: 'SelectionToolbar' }).exists()).toBe(true)

    await wrapper.find('.nt-seltool-btn').trigger('click')
    expect(wrapper.find('[data-selection-target] .nt-mark').text()).toBe('observe o padrão antes de tentar explicá-lo')

    await wrapper.find('[data-selection-target]').trigger('mouseup')
    const toolbar = wrapper.findComponent({ name: 'SelectionToolbar' })
    await toolbar.findAll('.nt-seltool-btn')[1].trigger('click')

    expect(store.annotations.filter((annotation) => annotation.materialId === 'post-compilation')).toHaveLength(initialAnnotations + 1)
    expect(wrapper.find('.nt-panel .nt-tab.is-active').text()).toContain('Anotações')
  })

  it('refuses short exercise answers and accepts a response with ten characters', async () => {
    const { wrapper } = await mountAt('/material/livro/book-interpreters')
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
    const item = store.libraryItems.find((candidate) => candidate.id === 'book-interpreters')!
    const previousStatus = item.status
    const previousUnread = item.unread
    const { wrapper, router } = await mountAt('/material/livro/book-interpreters', '/biblioteca')

    await wrapper.find('[data-action="complete"]').trigger('click')
    expect(item.status).toBe('read')
    expect(item.unread).toBe(false)
    expect(wrapper.find('[data-action="complete"]').text()).toContain('Concluído')

    await wrapper.find('.material-back').trigger('click')
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(router.currentRoute.value.fullPath).toBe('/biblioteca')

    item.status = previousStatus
    item.unread = previousUnread
  })

  it('keeps outbound links on named application routes', async () => {
    const { wrapper, router } = await mountAt('/material/post/post-compilation')
    const next = wrapper.find('.material-next')
    const nextHref = next.attributes('href')

    expect(nextHref).toBeDefined()
    expect(router.resolve(nextHref!).name).toBe('material')

    await tab(wrapper, 'Exercícios').trigger('click')
    const noteLink = wrapper.find('a[href="/notas?tab=anotacoes"]')
    const noteHref = noteLink.attributes('href')
    expect(noteHref).toBeDefined()
    expect(router.resolve(noteHref!).name).toBe('notas')
  })
})
