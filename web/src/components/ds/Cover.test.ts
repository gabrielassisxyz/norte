import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Cover from './Cover.vue'

describe('Cover', () => {
  it('names the product and keeps the art out of the accessibility tree', () => {
    const wrapper = mount(Cover)

    expect(wrapper.find('.nt-brand-name').text()).toBe('Norte')
    expect(wrapper.find('.nt-brand-tagline').text()).toBe(
      'A personal course platform, driven by goals.'
    )
    expect(wrapper.find('.nt-brand-art').attributes('aria-hidden')).toBe('true')
    expect(wrapper.findAll('rect').length).toBeGreaterThan(0)
  })

  it('accepts another title and tagline', () => {
    const wrapper = mount(Cover, { props: { title: 'Study', tagline: 'A short line.' } })

    expect(wrapper.find('.nt-brand-name').text()).toBe('Study')
    expect(wrapper.find('.nt-brand-tagline').text()).toBe('A short line.')
  })
})
