import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Highlight from './Highlight.vue'

describe('Highlight', () => {
  it('marks the quote and links the timestamp', () => {
    const wrapper = mount(Highlight, {
      props: {
        quote: 'A system that never measures its own lag learns about the queue from support.',
        source: 'Operating under load, ch. 4',
        timestamp: '12:47',
        href: '/material/book/4#t=12:47',
        note: 'Applies to review too.'
      }
    })

    expect(wrapper.find('.nt-hl-quote mark').text()).toContain('learns about the queue')
    expect(wrapper.find('.nt-hl-time').attributes('href')).toBe('/material/book/4#t=12:47')
    expect(wrapper.find('.nt-hl-time').text()).toBe('12:47')
    expect(wrapper.find('.nt-hl-note').text()).toBe('Applies to review too.')
  })

  it('drops the timestamp and the note when there are none', () => {
    const wrapper = mount(Highlight, { props: { quote: 'Passage.', source: 'Source' } })

    expect(wrapper.find('.nt-hl-time').exists()).toBe(false)
    expect(wrapper.find('.nt-hl-note').exists()).toBe(false)
    expect(wrapper.find('.nt-hl-source').text()).toBe('Source')
  })
})
