import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SelectionToolbar from './SelectionToolbar.vue'

describe('SelectionToolbar', () => {
  it('offers the four reader actions and emits the one clicked', async () => {
    const wrapper = mount(SelectionToolbar)
    const buttons = wrapper.findAll('.nt-seltool-btn')

    expect(buttons.map((node) => node.text())).toEqual(['Destacar', 'Anotar', 'Virar pergunta', 'Criar cartão'])
    expect(buttons[0].find('.nt-swatch').exists()).toBe(true)

    await buttons[2].trigger('click')

    expect(wrapper.emitted('action')).toEqual([['Virar pergunta']])
  })

  it('takes a custom action list', () => {
    const wrapper = mount(SelectionToolbar, { props: { actions: ['Destacar', 'Criar cartão'] } })

    expect(wrapper.findAll('.nt-seltool-btn')).toHaveLength(2)
  })
})
