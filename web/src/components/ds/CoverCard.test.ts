import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CoverCard from './CoverCard.vue'

describe('CoverCard', () => {
  it('shows the placeholder when there is no cover photo', () => {
    const wrapper = mount(CoverCard, { props: { title: 'Sistemas', description: 'Entender consenso.' } })

    expect(wrapper.find('.nt-cover').text()).toBe('Foto de capa')
    expect(wrapper.find('.nt-cover-img').exists()).toBe(false)
    expect(wrapper.find('.nt-cover').attributes('style')).toContain('height: 168px')
    expect(wrapper.find('.nt-cover-desc').text()).toBe('Entender consenso.')
  })

  it('shows the photo and honours coverHeight and meta', () => {
    const wrapper = mount(CoverCard, {
      props: { title: 'Escrita', cover: '/capa.jpg', coverHeight: 200, meta: '169 itens · ativo hoje', href: '/curriculos/escrita' }
    })

    expect(wrapper.find('.nt-cover-img').attributes('src')).toBe('/capa.jpg')
    expect(wrapper.find('.nt-cover').attributes('style')).toContain('height: 200px')
    expect(wrapper.find('.nt-cover-meta').text()).toBe('169 itens · ativo hoje')
    expect(wrapper.attributes('href')).toBe('/curriculos/escrita')
  })
})
