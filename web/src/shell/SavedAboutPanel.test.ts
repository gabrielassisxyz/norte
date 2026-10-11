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
      id: 'link-confirmed',
      status: 'confirmed',
      src: registryItem({ id: 'item-confirmed', title: 'A confirmed article', type: 'article' }),
      dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject', title: 'Kubernetes' })
    }),
    coreLink({
      id: 'link-suggested',
      status: 'suggested',
      source: 'llm',
      src: registryItem({ id: 'item-suggested', title: 'A suggested article' }),
      dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject', title: 'Kubernetes' })
    }),
    coreLink({
      id: 'link-rejected',
      status: 'rejected',
      src: registryItem({ id: 'item-rejected', title: 'A rejected article' }),
      dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject', title: 'Kubernetes' })
    }),
    // A confirmed link into something else entirely.
    coreLink({
      id: 'link-other',
      status: 'confirmed',
      src: registryItem({ id: 'item-other', title: 'About another subject' }),
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

describe('the "Saved about this" panel', () => {
  it('lists exactly the confirmed about links into the target', async () => {
    const { wrapper, core } = await mountPanel()

    // The narrowing is the server's: the panel asks for it rather than
    // filtering a page it was handed.
    expect(core.calls.listLinks).toEqual([
      { dst_id: 'subject-1', kind: 'about', status: 'confirmed', cursor: undefined }
    ])

    const titles = wrapper.findAll('.saved-about-row').map((row) => row.text())
    expect(titles).toHaveLength(1)
    expect(titles[0]).toContain('A confirmed article')
    expect(wrapper.text()).not.toContain('A suggested article')
    expect(wrapper.text()).not.toContain('A rejected article')
    expect(wrapper.text()).not.toContain('About another subject')
  })

  it('opens each listed item at the address the registry holds', async () => {
    const { wrapper } = await mountPanel()

    expect(wrapper.get('.saved-about-link').attributes('href')).toBe('/library/item-confirmed')
  })

  it('says so when nothing is linked to the target', async () => {
    const { wrapper } = await mountPanel('subject-with-nothing')

    expect(wrapper.text()).toContain('Nothing saved about this yet.')
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
          if (attempts === 1) throw new Error('network down')
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

    expect(wrapper.get('[role="alert"]').text()).toContain('Could not load: network down')

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushReads()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Nothing saved about this yet.')
  })
})

describe('the "Saved about this" panel: more than one page', () => {
  function manyLinks(count: number) {
    return Array.from({ length: count }, (_, index) =>
      coreLink({
        id: `link-${index}`,
        created_at: `2026-10-07T12:${String(Math.floor(index / 60)).padStart(2, '0')}:${String(index % 60).padStart(2, '0')}.000Z`,
        src: registryItem({ id: `item-${index}`, title: `Text ${index}` }),
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
    wrapper.findAll('button').find((button) => button.text() === 'Load more')

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

  it('offers no "Load more" for a single page', async () => {
    const { wrapper } = await mountWith(manyLinks(3))
    expect(moreButton(wrapper)).toBeUndefined()
  })

  it('does not list items of a module the server has switched off', async () => {
    const links = [
      coreLink({
        id: 'link-alive',
        src: registryItem({ id: 'item-alive', title: 'From a module that is on' }),
        dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject' })
      }),
      coreLink({
        id: 'link-dead',
        created_at: '2026-10-06T12:00:00.000Z',
        src: registryItem({ id: 'item-dead', module: 'notes', title: 'From a module that is off' }),
        dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject' })
      })
    ]
    const { wrapper } = await mountWith(links as ReturnType<typeof manyLinks>)

    expect(wrapper.text()).toContain('From a module that is on')
    expect(wrapper.text()).not.toContain('From a module that is off')
  })
})

describe('the "Saved about this" panel: ids', () => {
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
