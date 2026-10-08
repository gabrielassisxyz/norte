import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { createRouteTable } from '@/router'
import SavedAboutPanel from '@/shell/SavedAboutPanel.vue'
import { coreLink, fakeCoreSource, registryItem, subjectRecord } from '@/shell/data/testing'
import type { CoreLink } from '@/shell/data/source'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import LibrarySuggestions from './LibrarySuggestions.vue'

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

/**
 * One suggestion from a saved item to a subject, plus the decided rows that
 * must not be in the queue. The queue claims to list what nobody has decided,
 * so a confirmed and a rejected row have to be present for that claim to mean
 * anything.
 */
function queueLinks(): CoreLink[] {
  return [
    coreLink({
      id: 'link-sugerido',
      status: 'suggested',
      source: 'llm',
      confidence: 0.88,
      created_at: '2026-10-07T12:03:00.000Z',
      src: registryItem({ id: 'item-consenso', title: 'Notas sobre consenso' }),
      dst: registryItem({ id: 'subject-sd', module: 'core', type: 'subject', title: 'Sistemas distribuídos' })
    }),
    coreLink({
      id: 'link-confirmado',
      status: 'confirmed',
      created_at: '2026-10-07T12:02:00.000Z',
      src: registryItem({ id: 'item-ja-ligado', title: 'Um texto já ligado' }),
      dst: registryItem({ id: 'subject-sd', module: 'core', type: 'subject', title: 'Sistemas distribuídos' })
    }),
    coreLink({
      id: 'link-rejeitado',
      status: 'rejected',
      source: 'llm',
      created_at: '2026-10-07T12:01:00.000Z',
      src: registryItem({ id: 'item-recusado', title: 'Um texto recusado' }),
      dst: registryItem({ id: 'subject-sd', module: 'core', type: 'subject', title: 'Sistemas distribuídos' })
    })
  ]
}

function newCoreSource(links: CoreLink[] = queueLinks()) {
  return fakeCoreSource({
    subjects: [subjectRecord({ id: 'subject-sd', name: 'Sistemas distribuídos', slug: 'sistemas-distribuidos' })],
    links
  })
}

async function mountQueue(core = newCoreSource()) {
  setEnabledModules(['library'])
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/biblioteca?v=sugestoes')
  await router.isReady()
  const wrapper = mount(LibrarySuggestions, {
    global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core }))] }
  })
  mounted.push(wrapper)
  await flushReads()
  return { wrapper, core, router }
}

function rows(wrapper: VueWrapper): string[] {
  return wrapper.findAll('.suggestion').map((row) => row.text())
}

/** The button of one row, found by what it says it does. */
function action(wrapper: VueWrapper, label: string) {
  const found = wrapper.findAll('button').find((button) => button.attributes('aria-label') === label)
  if (!found) throw new Error(`no button labelled "${label}"`)
  return found
}

describe('the "Sugestões" tab', () => {
  it('lists exactly the suggested about links, narrowed by the server', async () => {
    const { wrapper, core } = await mountQueue()

    // The narrowing is asked for rather than applied to a page the screen was
    // handed: a filter computed here would narrow the first fifty rows and
    // present the result as the whole queue.
    expect(core.calls.listLinks).toEqual([{ kind: 'about', status: 'suggested', cursor: undefined }])

    expect(rows(wrapper)).toHaveLength(1)
    expect(rows(wrapper)[0]).toContain('Notas sobre consenso')
    expect(rows(wrapper)[0]).toContain('Sistemas distribuídos')
    expect(wrapper.text()).not.toContain('Um texto já ligado')
    expect(wrapper.text()).not.toContain('Um texto recusado')
  })

  it('shows the model’s confidence as a percentage', async () => {
    const { wrapper } = await mountQueue()

    expect(wrapper.get('.suggestion-confidence').text()).toBe('88%')
  })

  it('opens both ends at the addresses the registry holds', async () => {
    const { wrapper } = await mountQueue()

    expect(wrapper.get('.suggestion-item').attributes('href')).toBe('/biblioteca/item-consenso')
    expect(wrapper.get('.suggestion-dst').attributes('href')).toBe('/biblioteca/subject-sd')
  })

  it('accepting takes the row out of the queue and puts the item on the subject’s panel', async () => {
    const core = newCoreSource()
    setEnabledModules(['library'])
    const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
    await router.push('/biblioteca?v=sugestoes')
    await router.isReady()
    const plugins = [router, sourcesPlugin(appSourcesWithLibrary({ core }))]

    const queue = mount(LibrarySuggestions, { global: { plugins } })
    mounted.push(queue)
    // The subject's own panel, mounted over the same source, is where the
    // criterion is actually visible: accepting is what finally links the item.
    const panel = mount(SavedAboutPanel, { props: { targetId: 'subject-sd' }, global: { plugins } })
    mounted.push(panel)
    await flushReads()

    expect(panel.text()).not.toContain('Notas sobre consenso')

    await action(queue, 'Aceitar Sistemas distribuídos').trigger('click')
    await flushReads()

    // The panel first: it is the criterion, and an assertion behind three
    // others is one that has never been seen to fail.
    expect(panel.text()).toContain('Notas sobre consenso')
    expect(core.calls.decideLink).toEqual([{ id: 'link-sugerido', decision: 'accept' }])
    expect(rows(queue)).toHaveLength(0)
    expect(queue.text()).toContain('Nenhuma sugestão pendente.')
  })

  it('rejecting removes it from the tab', async () => {
    const { wrapper, core } = await mountQueue()

    await action(wrapper, 'Rejeitar Sistemas distribuídos').trigger('click')
    await flushReads()

    expect(core.calls.decideLink).toEqual([{ id: 'link-sugerido', decision: 'reject' }])
    expect(rows(wrapper)).toHaveLength(0)
    expect(wrapper.text()).toContain('Nenhuma sugestão pendente.')
  })

  it('leaves the row where it is and says so when the decision fails', async () => {
    const core = fakeCoreSource(
      { links: queueLinks() },
      { decideLink: async () => { throw new Error('rede indisponível') } }
    )
    const { wrapper } = await mountQueue(core)

    await action(wrapper, 'Aceitar Sistemas distribuídos').trigger('click')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível decidir: rede indisponível')
    expect(rows(wrapper)).toHaveLength(1)
  })

  it('grows the queue a page at a time rather than showing the first page as the whole of it', async () => {
    const many: CoreLink[] = []
    for (let index = 0; index < 60; index += 1) {
      const number = String(index).padStart(3, '0')
      many.push(
        coreLink({
          id: `link-${number}`,
          status: 'suggested',
          source: 'llm',
          confidence: 0.5,
          // Descending, so the fake's newest-first order is the order below.
          created_at: `2026-10-07T12:00:${String(59 - index).padStart(2, '0')}.000Z`,
          src: registryItem({ id: `item-${number}`, title: `Texto ${number}` }),
          dst: registryItem({ id: 'subject-sd', module: 'core', type: 'subject', title: 'Sistemas distribuídos' })
        })
      )
    }
    const { wrapper } = await mountQueue(newCoreSource(many))

    expect(rows(wrapper)).toHaveLength(50)
    await wrapper.findAll('button').filter((button) => button.text() === 'Carregar mais')[0]!.trigger('click')
    await flushReads()

    expect(rows(wrapper)).toHaveLength(60)
  })

  it('says why it could not read, and reads again when asked', async () => {
    let attempts = 0
    const core = fakeCoreSource(
      {},
      {
        listLinks: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rede indisponível')
          return { items: queueLinks().filter((link) => link.status === 'suggested'), next_cursor: null }
        }
      }
    )
    const { wrapper } = await mountQueue(core)

    expect(wrapper.get('[role="alert"]').text()).toContain(
      'Não foi possível carregar as sugestões: rede indisponível'
    )

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushReads()

    expect(rows(wrapper)).toHaveLength(1)
  })

  it('leaves out a suggestion whose module is switched off', async () => {
    // The registry keeps the rows of a module that has since been switched
    // off, and accepting a suggestion about one of them would link to a page
    // that is not there.
    setEnabledModules([])
    const core = newCoreSource()
    const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
    await router.push('/biblioteca?v=sugestoes')
    await router.isReady()
    const wrapper = mount(LibrarySuggestions, {
      global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core }))] }
    })
    mounted.push(wrapper)
    await flushReads()

    expect(rows(wrapper)).toHaveLength(0)
  })
})
