import { mount } from '@vue/test-utils'
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
      src: registryItem({ id: 'item-confirmado', title: 'Um texto confirmado', type: 'post' }),
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

    expect(wrapper.get('.saved-about-link').attributes('href')).toBe('/biblioteca/item-confirmado')
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
