import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CoverCard from './CoverCard.vue'

describe('CoverCard', () => {
  it('shows the placeholder when there is no cover photo', () => {
    const wrapper = mount(CoverCard, { props: { title: 'Systems', description: 'Understand consensus.' } })

    expect(wrapper.find('.nt-cover').text()).toBe('Cover photo')
    expect(wrapper.find('.nt-cover-img').exists()).toBe(false)
    expect(wrapper.find('.nt-cover').attributes('style')).toContain('height: 168px')
    expect(wrapper.find('.nt-cover-desc').text()).toBe('Understand consensus.')
  })

  it('shows the photo and honours coverHeight and meta', () => {
    const wrapper = mount(CoverCard, {
      props: { title: 'Writing', cover: '/cover.jpg', coverHeight: 200, meta: '169 items · active today', href: '/curricula/escrita' }
    })

    expect(wrapper.find('.nt-cover-img').attributes('src')).toBe('/cover.jpg')
    expect(wrapper.find('.nt-cover').attributes('style')).toContain('height: 200px')
    expect(wrapper.find('.nt-cover-meta').text()).toBe('169 items · active today')
    expect(wrapper.attributes('href')).toBe('/curricula/escrita')
  })
})
