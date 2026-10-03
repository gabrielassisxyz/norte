import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Icon from './Icon.vue'

describe('Icon', () => {
  it('draws the requested glyph at the requested size', () => {
    const wrapper = mount(Icon, { props: { name: 'check', size: 12 } })

    expect(wrapper.attributes('width')).toBe('12')
    expect(wrapper.attributes('aria-hidden')).toBe('true')
    expect(wrapper.find('path').attributes('d')).toBe('M4 8.5l2.5 2.5L12 5.5')
  })

  it('defaults to 16px', () => {
    const wrapper = mount(Icon, { props: { name: 'arrow' } })

    expect(wrapper.attributes('width')).toBe('16')
  })
})
