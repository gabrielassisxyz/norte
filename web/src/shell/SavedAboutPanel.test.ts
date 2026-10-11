import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { createRouteTable } from '@/router'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import { coreLink, fakeCoreSource, registryItem, subjectRecord } from './data/testing'
import SavedAboutPanel from './SavedAboutPanel.vue'

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

/**
 * The three decisions a link can be in, all pointing at the same subject. The
 * panel claims to list the confirmed ones, so a suggestion and a rejection
 * have to be there for that claim to mean anything.
 */
function linksAboutTheSubject() {
  return [
    coreLink({
      id: 'link-confirmado',
      status: 'confirmed',
      src: registryItem({ id: 'item-confirmado', title: 'Um texto confirmado', type: 'article' }),
      dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject', title: 'Kubernetes' })
    }),
    coreLink({
      id: 'link-sugerido',
      status: 'suggested',
      source: 'llm',
      src: registryItem({ id: 'item-sugerido', title: 'Um texto sugerido' }),
      dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject', title: 'Kubernetes' })
    }),
    coreLink({
      id: 'link-rejeitado',
      status: 'rejected',
      src: registryItem({ id: 'item-rejeitado', title: 'Um texto rejeitado' }),
      dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject', title: 'Kubernetes' })
    }),
    // A confirmed link into something else entirely.
    coreLink({
      id: 'link-outro',
      status: 'confirmed',
      src: registryItem({ id: 'item-outro', title: 'Sobre outro assunto' }),
      dst: registryItem({ id: 'subject-2', module: 'core', type: 'subject', title: 'Escrita' })
    })
  ]
}

async function mountPanel(targetId = 'subject-1') {
  setEnabledModules(['library'])
  const core = fakeCoreSource({
    subjects: [subjectRecord({ id: 'subject-1', name: 'Kubernetes' })],
    links: linksAboutTheSubject()
  })
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push('/')
  await router.isReady()
  const wrapper = mount(SavedAboutPanel, {
    props: { targetId },
    global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core }))] }
  })
  mounted.push(wrapper)
  await flushReads()
  return { wrapper, core }
}

describe('the "Salvos sobre isso" panel', () => {
  it('lists exactly the confirmed about links into the target', async () => {
    const { wrapper, core } = await mountPanel()

    // The narrowing is the server's: the panel asks for it rather than
    // filtering a page it was handed.
    expect(core.calls.listLinks).toEqual([
      { dst_id: 'subject-1', kind: 'about', status: 'confirmed', cursor: undefined }
    ])

    const titles = wrapper.findAll('.saved-about-row').map((row) => row.text())
    expect(titles).toHaveLength(1)
    expect(titles[0]).toContain('Um texto confirmado')
    expect(wrapper.text()).not.toContain('Um texto sugerido')
    expect(wrapper.text()).not.toContain('Um texto rejeitado')
    expect(wrapper.text()).not.toContain('Sobre outro assunto')
  })

  it('opens each listed item at the address the registry holds', async () => {
    const { wrapper } = await mountPanel()

    expect(wrapper.get('.saved-about-link').attributes('href')).toBe('/library/item-confirmado')
  })

  it('says so when nothing is linked to the target', async () => {
    const { wrapper } = await mountPanel('subject-sem-nada')

    expect(wrapper.text()).toContain('Nada salvo sobre isso ainda.')
    expect(wrapper.find('.saved-about-row').exists()).toBe(false)
  })

  it('says why it could not read, and reads again when asked', async () => {
    setEnabledModules(['library'])
    let attempts = 0
    const core = fakeCoreSource(
      {},
      {
        listLinks: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rede indisponível')
          return { items: [], next_cursor: null }
        }
      }
    )
    const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(SavedAboutPanel, {
      props: { targetId: 'subject-1' },
      global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core }))] }
    })
    mounted.push(wrapper)
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível carregar: rede indisponível')

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushReads()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Nada salvo sobre isso ainda.')
  })
})

describe('the "Salvos sobre isso" panel: more than one page', () => {
  function manyLinks(count: number) {
    return Array.from({ length: count }, (_, index) =>
      coreLink({
        id: `link-${index}`,
        created_at: `2026-10-07T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        src: registryItem({ id: `item-${index}`, title: `Texto ${index}` }),
        dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject', title: 'Kubernetes' })
      })
    )
  }

  async function mountWith(links: ReturnType<typeof manyLinks>) {
    setEnabledModules(['library'])
    const core = fakeCoreSource({ subjects: [subjectRecord({ id: 'subject-1' })], links })
    const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
    await router.push('/')
    await router.isReady()
    const wrapper = mount(SavedAboutPanel, {
      props: { targetId: 'subject-1' },
      global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core }))] }
    })
    mounted.push(wrapper)
    await flushReads()
    return { wrapper, core }
  }

  const moreButton = (wrapper: Awaited<ReturnType<typeof mountWith>>['wrapper']) =>
    wrapper.findAll('button').find((button) => button.text() === 'Carregar mais')

  it('shows the first page and appends the next ones under the same filters', async () => {
    const { wrapper, core } = await mountWith(manyLinks(120))

    expect(wrapper.findAll('.saved-about-row')).toHaveLength(50)
    await moreButton(wrapper)!.trigger('click')
    await flushReads()
    expect(wrapper.findAll('.saved-about-row')).toHaveLength(100)
    await moreButton(wrapper)!.trigger('click')
    await flushReads()
    expect(wrapper.findAll('.saved-about-row')).toHaveLength(120)
    expect(moreButton(wrapper)).toBeUndefined()

    expect(core.calls.listLinks.map((call) => call.cursor)).toEqual([undefined, '50', '100'])
    for (const call of core.calls.listLinks) {
      expect(call).toMatchObject({ dst_id: 'subject-1', kind: 'about', status: 'confirmed' })
    }
  })

  it('offers no "carregar mais" for a single page', async () => {
    const { wrapper } = await mountWith(manyLinks(3))
    expect(moreButton(wrapper)).toBeUndefined()
  })

  it('does not list items of a module the server has switched off', async () => {
    const links = [
      coreLink({
        id: 'link-vivo',
        src: registryItem({ id: 'item-vivo', title: 'De um módulo ligado' }),
        dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject' })
      }),
      coreLink({
        id: 'link-morto',
        created_at: '2026-10-06T12:00:00.000Z',
        src: registryItem({ id: 'item-morto', module: 'notes', title: 'De um módulo desligado' }),
        dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject' })
      })
    ]
    const { wrapper } = await mountWith(links as ReturnType<typeof manyLinks>)

    expect(wrapper.text()).toContain('De um módulo ligado')
    expect(wrapper.text()).not.toContain('De um módulo desligado')
  })
})

describe('the "Salvos sobre isso" panel: ids', () => {
  it('gives every instance its own heading id, so two panels on one page do not share one', async () => {
    setEnabledModules(['library'])
    const core = fakeCoreSource({})
    const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
    await router.push('/')
    await router.isReady()
    const Two = defineComponent({
      render: () => h('div', [h(SavedAboutPanel, { targetId: 'a' }), h(SavedAboutPanel, { targetId: 'b' })])
    })
    const wrapper = mount(Two, { global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core }))] } })
    mounted.push(wrapper)
    await flushReads()

    const headings = wrapper.findAll('.saved-about h2')
    expect(headings).toHaveLength(2)
    const ids = headings.map((heading) => heading.attributes('id'))
    expect(ids[0]).toBeTruthy()
    expect(new Set(ids).size).toBe(2)
    const labelled = wrapper.findAll('.saved-about').map((section) => section.attributes('aria-labelledby'))
    expect(labelled).toEqual(ids)
  })
})
