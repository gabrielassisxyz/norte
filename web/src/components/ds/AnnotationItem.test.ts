import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AnnotationItem from './AnnotationItem.vue'

describe('AnnotationItem', () => {
  it('reads a trecho with a note as linked', () => {
    const wrapper = mount(AnnotationItem, {
      props: { quote: 'um trecho', note: 'uma nota', n: 1, location: 'Cap. 2 · p. 48', time: '09:12' }
    })

    expect(wrapper.find('.nt-ann-badge').exists()).toBe(false)
    expect(wrapper.find('.nt-ann-n').text()).toBe('1')
    expect(wrapper.find('.nt-ann-add').exists()).toBe(false)
    expect(wrapper.find('.nt-ann-meta').text()).toContain('Cap. 2 · p. 48')
  })

  it('offers to annotate a trecho that has no note yet', async () => {
    const wrapper = mount(AnnotationItem, { props: { quote: 'um trecho' } })

    expect(wrapper.find('.nt-ann-meta').text()).toContain('Só destaque')

    await wrapper.find('.nt-ann-add').trigger('click')

    expect(wrapper.emitted('addNote')).toHaveLength(1)
  })

  it('badges a note with no trecho behind it', () => {
    const wrapper = mount(AnnotationItem, { props: { note: 'Rever a ordem dos módulos.' } })

    expect(wrapper.find('.nt-ann-badge').text()).toBe('Sem trecho')
  })

  it('badges an annotation that became a question', () => {
    const wrapper = mount(AnnotationItem, { props: { kind: 'question', note: 'Dá para medir calibração?' } })

    expect(wrapper.find('.nt-ann-badge').text()).toBe('Sem trecho · virou pergunta')
  })
})
