import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Mark from './Mark.vue'

describe('Mark', () => {
  it('links the reference number to the margin note of the same number', () => {
    const wrapper = mount(Mark, { props: { note: 3 }, slots: { default: 'um trecho' } })

    expect(wrapper.find('.nt-mark').text()).toBe('um trecho')
    expect(wrapper.find('.nt-mark-ref').text()).toBe('3')
    expect(wrapper.find('.nt-mark-ref').attributes('href')).toBe('#nota-3')
    expect(wrapper.find('.nt-mark-ref').attributes('aria-label')).toBe('Anotação 3')
  })

  it('is a bare highlight without a note', () => {
    const wrapper = mount(Mark, { slots: { default: 'um trecho' } })

    expect(wrapper.find('.nt-mark-ref').exists()).toBe(false)
  })
})
