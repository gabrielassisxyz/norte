import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Highlight from './Highlight.vue'

describe('Highlight', () => {
  it('marks the quote and links the timestamp', () => {
    const wrapper = mount(Highlight, {
      props: {
        quote: 'Um sistema que não mede o próprio atraso descobre a fila pelo suporte.',
        source: 'Operação sob carga, cap. 4',
        timestamp: '12:47',
        href: '/material/book/4#t=12:47',
        note: 'Vale para revisão também.'
      }
    })

    expect(wrapper.find('.nt-hl-quote mark').text()).toContain('descobre a fila')
    expect(wrapper.find('.nt-hl-time').attributes('href')).toBe('/material/book/4#t=12:47')
    expect(wrapper.find('.nt-hl-time').text()).toBe('12:47')
    expect(wrapper.find('.nt-hl-note').text()).toBe('Vale para revisão também.')
  })

  it('drops the timestamp and the note when there are none', () => {
    const wrapper = mount(Highlight, { props: { quote: 'Trecho.', source: 'Fonte' } })

    expect(wrapper.find('.nt-hl-time').exists()).toBe(false)
    expect(wrapper.find('.nt-hl-note').exists()).toBe(false)
    expect(wrapper.find('.nt-hl-source').text()).toBe('Fonte')
  })
})
