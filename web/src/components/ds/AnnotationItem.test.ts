import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import AnnotationItem from './AnnotationItem.vue'

describe('AnnotationItem', () => {
  it('reads a passage with a note as linked', () => {
    const wrapper = mount(AnnotationItem, {
      props: { quote: 'a passage', note: 'a note', n: 1, location: 'Ch. 2 · p. 48', time: '09:12' }
    })

    expect(wrapper.find('.nt-ann-badge').exists()).toBe(false)
    expect(wrapper.find('.nt-ann-n').text()).toBe('1')
    expect(wrapper.find('.nt-ann-add').exists()).toBe(false)
    expect(wrapper.find('.nt-ann-meta').text()).toContain('Ch. 2 · p. 48')
  })

  it('offers to annotate a passage that has no note yet', async () => {
    const wrapper = mount(AnnotationItem, { props: { quote: 'a passage' } })

    expect(wrapper.find('.nt-ann-meta').text()).toContain('Highlight only')

    await wrapper.find('.nt-ann-add').trigger('click')

    expect(wrapper.emitted('addNote')).toHaveLength(1)
  })

  it('badges a note with no passage behind it', () => {
    const wrapper = mount(AnnotationItem, { props: { note: 'Review the module order.' } })

    expect(wrapper.find('.nt-ann-badge').text()).toBe('No passage')
  })

  it('badges an annotation that became a question', () => {
    const wrapper = mount(AnnotationItem, { props: { kind: 'question', note: 'Can calibration be measured?' } })

    expect(wrapper.find('.nt-ann-badge').text()).toBe('No passage · became a question')
  })
})
