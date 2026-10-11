import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MarginNote from './MarginNote.vue'

describe('MarginNote', () => {
  it('anchors itself on the number its Mark points at', () => {
    const wrapper = mount(MarginNote, { props: { n: 3 }, slots: { default: 'The question matters more than the summary.' } })

    expect(wrapper.attributes('id')).toBe('note-3')
    expect(wrapper.find('.nt-mnote-n').text()).toBe('3')
    expect(wrapper.text()).toContain('The question matters more than the summary.')
  })

  it('accepts an explicit id', () => {
    const wrapper = mount(MarginNote, { props: { n: 1, id: 'note-intro' }, slots: { default: 'Note' } })

    expect(wrapper.attributes('id')).toBe('note-intro')
  })
})
