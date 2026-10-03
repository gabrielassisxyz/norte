import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import MarginNote from './MarginNote.vue'

describe('MarginNote', () => {
  it('anchors itself on the number its Mark points at', () => {
    const wrapper = mount(MarginNote, { props: { n: 3 }, slots: { default: 'A pergunta vale mais que o resumo.' } })

    expect(wrapper.attributes('id')).toBe('nota-3')
    expect(wrapper.find('.nt-mnote-n').text()).toBe('3')
    expect(wrapper.text()).toContain('A pergunta vale mais que o resumo.')
  })

  it('accepts an explicit id', () => {
    const wrapper = mount(MarginNote, { props: { n: 1, id: 'nota-intro' }, slots: { default: 'Nota' } })

    expect(wrapper.attributes('id')).toBe('nota-intro')
  })
})
