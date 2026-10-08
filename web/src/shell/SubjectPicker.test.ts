import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { resetModuleMounting } from '@/modules/mounting'
import { appSourcesWithLibrary, flushReads, sourcesPlugin } from '@/sources/testing'

import { fakeCoreSource, subjectRecord } from './data/testing'
import SubjectPicker from './SubjectPicker.vue'

const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

function vocabulary() {
  return [
    subjectRecord({ id: 'subject-k8s', name: 'Kubernetes', slug: 'kubernetes', focus: true }),
    subjectRecord({ id: 'subject-escrita', name: 'Escrita', slug: 'escrita' }),
    subjectRecord({ id: 'subject-prog', name: 'Programação', slug: 'programacao' })
  ]
}

async function mountPicker(props: { chosen?: string[] } = {}) {
  const core = fakeCoreSource({ subjects: vocabulary() })
  const wrapper = mount(SubjectPicker, {
    props,
    global: { plugins: [sourcesPlugin(appSourcesWithLibrary({ core }))] }
  })
  mounted.push(wrapper)
  await flushReads()
  return { wrapper, core }
}

describe('the subject picker', () => {
  it('offers the focus before anything was typed, and asks for no search', async () => {
    const { wrapper, core } = await mountPicker()

    expect(core.calls.focus).toBe(1)
    // The full vocabulary is one field away; reading its first page before
    // anyone asked would be a request whose answer nothing renders.
    expect(core.calls.listSubjects).toEqual([])
    expect(wrapper.findAll('[role="option"]').map((option) => option.text())).toEqual(['Kubernetesem foco'])
  })

  it('searches the whole vocabulary once something is typed', async () => {
    const { wrapper, core } = await mountPicker()

    await wrapper.get('input').setValue('programacao')
    await flushReads()

    expect(core.calls.listSubjects.map((query) => query.q)).toEqual(['programacao'])
    expect(wrapper.findAll('[role="option"]').map((option) => option.text())).toEqual(['Programação'])
  })

  it('reports the chosen subject and clears the search', async () => {
    const { wrapper } = await mountPicker()

    await wrapper.get('input').setValue('escrita')
    await flushReads()
    await wrapper.get('[role="option"]').trigger('click')

    expect(wrapper.emitted('select')).toEqual([[expect.objectContaining({ id: 'subject-escrita' })]])
    expect((wrapper.get('input').element as HTMLInputElement).value).toBe('')
  })

  it('leaves out what has already been chosen', async () => {
    const { wrapper } = await mountPicker({ chosen: ['subject-k8s'] })

    expect(wrapper.findAll('[role="option"]')).toHaveLength(0)
    expect(wrapper.text()).toContain('Nenhum assunto em foco')
  })

  it('says so when a search matches nothing', async () => {
    const { wrapper } = await mountPicker()

    await wrapper.get('input').setValue('nada-com-esse-nome')
    await flushReads()

    expect(wrapper.text()).toContain('Nenhum assunto com esse nome.')
  })
})
