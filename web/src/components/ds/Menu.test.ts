import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import Menu from './Menu.vue'

/**
 * The menu's behaviour, which is the whole reason it is a component.
 *
 * Every case mounts into the document: the Escape key and the outside click are
 * listened for on `document`, and focus is a property of the real document and
 * of nothing else, so a detached wrapper would prove none of it.
 */
const mounted: Array<{ unmount: () => void }> = []

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
})

function mountMenu(props: Record<string, unknown> = {}) {
  const wrapper = mount(Menu, {
    attachTo: document.body,
    props: { label: 'Sort: Newest', menuLabel: 'Sort', ...props },
    slots: {
      trigger: '<span>open</span>',
      default: `
        <button type="button" role="menuitemradio" aria-checked="true" class="row-recentes">Newest</button>
        <button type="button" role="menuitemradio" aria-checked="false" class="row-antigos">Oldest</button>
        <button type="button" role="menuitemradio" aria-checked="false" class="row-titulo">Title</button>
      `
    }
  })
  mounted.push(wrapper)
  return wrapper
}

describe('the design system menu', () => {
  it('names itself to a screen reader on the trigger and on the panel', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.get('button.nt-menu-trigger')

    expect(trigger.attributes('aria-haspopup')).toBe('menu')
    expect(trigger.attributes('aria-expanded')).toBe('false')
    expect(trigger.attributes('aria-label')).toBe('Sort: Newest')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)

    await trigger.trigger('click')

    expect(trigger.attributes('aria-expanded')).toBe('true')
    const panel = wrapper.get('[role="menu"]')
    expect(panel.attributes('aria-label')).toBe('Sort')
    expect(panel.findAll('[role="menuitemradio"]')).toHaveLength(3)
  })

  it('opens on a click and closes on a second one', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.get('button.nt-menu-trigger')

    await trigger.trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(true)

    await trigger.trigger('click')
    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('lands on the chosen item, so the current choice is where the keyboard starts', async () => {
    const wrapper = mountMenu()

    await wrapper.get('button.nt-menu-trigger').trigger('click')
    await wrapper.vm.$nextTick()

    expect(document.activeElement).toBe(wrapper.get('.row-recentes').element)
  })

  it('moves between items with the arrow keys, wrapping at both ends', async () => {
    const wrapper = mountMenu()
    await wrapper.get('button.nt-menu-trigger').trigger('click')
    await wrapper.vm.$nextTick()
    const panel = wrapper.get('[role="menu"]')

    await panel.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(wrapper.get('.row-antigos').element)

    await panel.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(wrapper.get('.row-titulo').element)

    // Past the last item is the first one, not nothing.
    await panel.trigger('keydown', { key: 'ArrowDown' })
    expect(document.activeElement).toBe(wrapper.get('.row-recentes').element)

    await panel.trigger('keydown', { key: 'ArrowUp' })
    expect(document.activeElement).toBe(wrapper.get('.row-titulo').element)
  })

  it('closes on Escape and hands focus back to the trigger', async () => {
    const wrapper = mountMenu()
    const trigger = wrapper.get('button.nt-menu-trigger')
    await trigger.trigger('click')
    await wrapper.vm.$nextTick()

    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'Escape' })

    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger.element)
  })

  it('closes on a click outside itself, leaving focus where the click put it', async () => {
    const wrapper = mountMenu()
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    await wrapper.get('button.nt-menu-trigger').trigger('click')
    await wrapper.vm.$nextTick()

    outside.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).not.toBe(wrapper.get('button.nt-menu-trigger').element)
    outside.remove()
  })

  it('stays open for a click on its own panel that is not a choice', async () => {
    const wrapper = mountMenu()
    await wrapper.get('button.nt-menu-trigger').trigger('click')
    const panel = wrapper.get('[role="menu"]')

    panel.element.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
  })

  it('closes after a choice', async () => {
    const wrapper = mountMenu()
    await wrapper.get('button.nt-menu-trigger').trigger('click')

    await wrapper.get('.row-antigos').trigger('click')

    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('opens on the down arrow, for a trigger reached with the keyboard', async () => {
    const wrapper = mountMenu()

    await wrapper.get('button.nt-menu-trigger').trigger('keydown', { key: 'ArrowDown' })

    expect(wrapper.find('[role="menu"]').exists()).toBe(true)
  })

  it('does not open while it is disabled', async () => {
    const wrapper = mountMenu({ disabled: true })
    const trigger = wrapper.get('button.nt-menu-trigger')

    expect(trigger.attributes('disabled')).toBeDefined()
    await trigger.trigger('click')

    expect(wrapper.find('[role="menu"]').exists()).toBe(false)
  })

  it('carries the accent on its trigger while a choice is set', () => {
    expect(mountMenu({ active: true }).get('button.nt-menu-trigger').classes()).toContain('is-active')
    expect(mountMenu().get('button.nt-menu-trigger').classes()).not.toContain('is-active')
  })

  it('skips an item nothing can choose when the arrows move', async () => {
    const wrapper = mount(Menu, {
      attachTo: document.body,
      props: { label: 'Filter' },
      slots: {
        trigger: '<span>open</span>',
        default: `
          <button type="button" role="menuitemcheckbox" aria-checked="false" class="row-um">One</button>
          <button type="button" role="menuitemcheckbox" aria-checked="false" class="row-dois" disabled>Two</button>
          <button type="button" role="menuitemcheckbox" aria-checked="false" class="row-tres">Three</button>
        `
      }
    })
    mounted.push(wrapper)

    await wrapper.get('button.nt-menu-trigger').trigger('click')
    await wrapper.vm.$nextTick()
    await wrapper.get('[role="menu"]').trigger('keydown', { key: 'ArrowDown' })

    expect(document.activeElement).toBe(wrapper.get('.row-tres').element)
  })
})
