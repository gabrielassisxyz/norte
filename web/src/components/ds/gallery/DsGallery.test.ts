import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import DsGallery from './DsGallery.vue'

describe('DsGallery', () => {
  it('renders the English page heading and subtitle', () => {
    const wrapper = mount(DsGallery)

    expect(wrapper.get('h1').text()).toBe('Component gallery')
    expect(wrapper.get('.ds-gallery-header > p:not(.ds-eyebrow)').text()).toBe(
      'Documented variants of the shared controls, in both themes.'
    )
  })

  it('renders the English reading-and-study section heading and subtitle', () => {
    const wrapper = mount(DsGallery)

    expect(wrapper.get('#gallery-legacy-title').text()).toBe('Reading and study components')
    expect(wrapper.get('.gallery-legacy-head > p').text()).toBe(
      'Composed blocks used by the curriculum, reading and review screens.'
    )
  })
})
