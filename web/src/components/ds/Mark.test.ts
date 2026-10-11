import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MarginNote from './MarginNote.vue'
import Mark from './Mark.vue'

describe('Mark', () => {
  it('links the reference number to the margin note of the same number', () => {
    const wrapper = mount(Mark, { props: { note: 3 }, slots: { default: 'a passage' } })

    expect(wrapper.find('.nt-mark').text()).toBe('a passage')
    expect(wrapper.find('.nt-mark-ref').text()).toBe('3')
    expect(wrapper.find('.nt-mark-ref').attributes('href')).toBe('#note-3')
    expect(wrapper.find('.nt-mark-ref').attributes('aria-label')).toBe('Annotation 3')
  })

  it('points at the id the margin note renders for the same number', () => {
    const note = mount(MarginNote, { props: { n: 7 }, slots: { default: 'Note' } })
    const mark = mount(Mark, { props: { note: 7 }, slots: { default: 'a passage' } })

    expect(mark.find('.nt-mark-ref').attributes('href')).toBe(`#${note.attributes('id')}`)
  })

  it('is a bare highlight without a note', () => {
    const wrapper = mount(Mark, { slots: { default: 'a passage' } })

    expect(wrapper.find('.nt-mark-ref').exists()).toBe(false)
  })
})
