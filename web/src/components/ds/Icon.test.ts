import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Icon from './Icon.vue'
import type { IconName } from './types'

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

  it('draws every glyph the phone reader uses with the thin 1.5 stroke', () => {
    const names: IconName[] = ['list', 'info', 'notebook', 'tray', 'chevronUpDown', 'more', 'question', 'close', 'skipForward', 'clock', 'archive', 'cube', 'pencil', 'trash', 'marker']

    for (const name of names) {
      const wrapper = mount(Icon, { props: { name } })

      expect(wrapper.attributes('stroke-width'), name).toBe('1.5')
      expect(wrapper.find('path').attributes('d'), name).toMatch(/^M/)
    }
  })
})
