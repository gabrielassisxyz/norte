import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ModuleItem from './ModuleItem.vue'

const props = { label: '02', title: 'Modelos de memória', meta: '3 semanas', status: 'current' as const }

describe('ModuleItem', () => {
  it('stays closed until its head is clicked and reports the new state', async () => {
    const wrapper = mount(ModuleItem, { props, slots: { default: 'Corpo do módulo' } })

    expect(wrapper.find('.nt-mod-body').exists()).toBe(false)
    expect(wrapper.find('.nt-mod-head').attributes('aria-expanded')).toBe('false')

    await wrapper.find('.nt-mod-head').trigger('click')

    expect(wrapper.find('.nt-mod-body').text()).toBe('Corpo do módulo')
    expect(wrapper.emitted('toggle')).toEqual([[true]])
  })

  it('opens by default when asked to', () => {
    const wrapper = mount(ModuleItem, { props: { ...props, defaultOpen: true }, slots: { default: 'Corpo' } })

    expect(wrapper.find('.nt-mod-body').exists()).toBe(true)
  })

  it('lets a parent own the open state', async () => {
    const wrapper = mount(ModuleItem, { props: { ...props, open: false }, slots: { default: 'Corpo' } })

    await wrapper.find('.nt-mod-head').trigger('click')

    expect(wrapper.emitted('toggle')).toEqual([[true]])
    expect(wrapper.find('.nt-mod-body').exists()).toBe(false)
  })

  it('shows Concluído for a finished module with no status text', () => {
    const wrapper = mount(ModuleItem, { props: { label: '01', title: 'Fundamentos', status: 'done' } })

    expect(wrapper.find('.nt-mod-status').text()).toBe('Concluído')
  })
})
