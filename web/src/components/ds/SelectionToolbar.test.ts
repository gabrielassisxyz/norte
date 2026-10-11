import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import SelectionToolbar from './SelectionToolbar.vue'

describe('SelectionToolbar', () => {
  it('offers the four reader actions and emits the one clicked', async () => {
    const wrapper = mount(SelectionToolbar)
    const buttons = wrapper.findAll('.nt-seltool-btn')

    expect(wrapper.find('.nt-seltool').attributes('aria-label')).toBe('Actions for the selected passage')
    expect(buttons.map((node) => node.text())).toEqual(['Highlight', 'Annotate', 'Turn into a question', 'Create a card'])
    expect(buttons[0].find('.nt-swatch').exists()).toBe(true)

    await buttons[2].trigger('click')

    expect(wrapper.emitted('action')).toEqual([['Turn into a question']])
  })

  it('takes a custom action list', () => {
    const wrapper = mount(SelectionToolbar, { props: { actions: ['Highlight', 'Create a card'] } })

    expect(wrapper.findAll('.nt-seltool-btn')).toHaveLength(2)
  })
})
