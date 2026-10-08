import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, describe, expect, it } from 'vitest'

import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { createRouteTable } from '@/router'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import { coreLink, fakeCoreSource, registryItem, subjectRecord, type FakeCoreSource } from './data/testing'
import SubjectView from './SubjectView.vue'

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

function kubernetes() {
  return subjectRecord({
    id: 'subject-k8s',
    name: 'Kubernetes',
    slug: 'kubernetes',
    counts: {
      total: 3,
      by_type: [
        { module: 'library', type: 'curso', count: 1 },
        { module: 'library', type: 'post', count: 2 }
      ]
    },
    link_count: 4
  })
}

async function mountSubject(slug = 'kubernetes', core?: FakeCoreSource) {
  setEnabledModules(['library'])
  const source =
    core ??
    fakeCoreSource({
      subjects: [kubernetes()],
      links: [
        coreLink({
          id: 'link-1',
          src: registryItem({ id: 'item-1', title: 'Pods explicados' }),
          dst: registryItem({ id: 'subject-k8s', module: 'core', type: 'subject', title: 'Kubernetes' })
        })
      ]
    })
  const router = createRouter({ history: createMemoryHistory(), routes: createRouteTable() })
  await router.push(`/assuntos/${slug}`)
  await router.isReady()
  const wrapper = mount(SubjectView, {
    global: { plugins: [router, sourcesPlugin(appSourcesWithLibrary({ core: source }))] }
  })
  mounted.push(wrapper)
  await flushReads()
  return { wrapper, core: source, router }
}

describe('the subject screen', () => {
  it('reads the subject by the slug in the address', async () => {
    const { wrapper, core } = await mountSubject()

    expect(core.calls.getSubjectBySlug).toEqual(['kubernetes'])
    expect(wrapper.get('h1').text()).toBe('Kubernetes')
    expect(wrapper.text()).toContain('3 itens salvos')
  })

  it('shows one count per item type and the panel of what is linked', async () => {
    const { wrapper } = await mountSubject()

    const counts = wrapper.findAll('.subject-count').map((entry) => entry.text().replace(/\s+/g, ' '))
    expect(counts).toEqual(['1curso', '2post'])
    expect(wrapper.text()).toContain('Salvos sobre isso')
    expect(wrapper.text()).toContain('Pods explicados')
  })

  it('says so when no subject answers to that address', async () => {
    const { wrapper } = await mountSubject('nao-existe')

    expect(wrapper.text()).toContain('Nenhum assunto com o endereço')
    expect(wrapper.find('h1').exists()).toBe(false)
  })

  it('toggles the focus and renders what came back', async () => {
    const { wrapper, core } = await mountSubject()
    const toggle = wrapper.get('[role="switch"]')

    expect(toggle.attributes('aria-checked')).toBe('false')

    await toggle.trigger('click')
    await flushReads()

    expect(core.calls.patchSubject).toEqual([{ id: 'subject-k8s', patch: { focus: true } }])
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('true')

    await wrapper.get('[role="switch"]').trigger('click')
    await flushReads()

    expect(core.calls.patchSubject[1]).toEqual({ id: 'subject-k8s', patch: { focus: false } })
    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
  })

  it('keeps the switch where it was when the write failed, and says why', async () => {
    const core = fakeCoreSource(
      { subjects: [kubernetes()] },
      {
        patchSubject: async () => {
          throw new Error('rede indisponível')
        }
      }
    )
    const { wrapper } = await mountSubject('kubernetes', core)

    await wrapper.get('[role="switch"]').trigger('click')
    await flushReads()

    expect(wrapper.get('[role="switch"]').attributes('aria-checked')).toBe('false')
    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível mudar o foco: rede indisponível')
  })

  it('names the number of links before deleting, and sends nothing when cancelled', async () => {
    const { wrapper, core } = await mountSubject()

    await wrapper.get('.subject-actions button:last-child').trigger('click')
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('Apagar “Kubernetes”?')
    expect(dialog.text()).toContain('4 ligações')

    await dialog.get('button').trigger('click')
    await flushReads()

    expect(core.calls.deleteSubject).toEqual([])
    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(core.subjects).toHaveLength(1)
  })

  it('deletes only once the dialog is confirmed', async () => {
    const { wrapper, core } = await mountSubject()

    await wrapper.get('.subject-actions button:last-child').trigger('click')
    const buttons = wrapper.get('[role="dialog"]').findAll('button')
    await buttons[buttons.length - 1]!.trigger('click')
    await flushReads()

    expect(core.calls.deleteSubject).toEqual(['subject-k8s'])
    expect(core.subjects).toHaveLength(0)
  })
})
