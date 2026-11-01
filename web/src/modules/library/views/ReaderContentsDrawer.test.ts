import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import type { LibraryHeading } from '../data/source'
import ReaderContentsDrawer from './ReaderContentsDrawer.vue'

const HEADINGS: LibraryHeading[] = [
  { level: 2, text: 'First', anchor: 'first' },
  { level: 3, text: 'Nested one', anchor: 'nested-one' },
  { level: 3, text: 'Nested two', anchor: 'nested-two' },
  { level: 2, text: 'Second', anchor: 'second' },
  { level: 4, text: 'Deep', anchor: 'deep' }
]

afterEach(() => {
  document.body.innerHTML = ''
})

function mountDrawer(props: { current?: string; missing?: string[] } = {}) {
  return mount(ReaderContentsDrawer, {
    props: { headings: HEADINGS, current: props.current, missing: props.missing ?? [] },
    attachTo: document.body
  })
}

describe('the contents drawer', () => {
  it('is a left dialog named by its Contents title, with one row per heading', () => {
    const wrapper = mountDrawer()
    const dialog = wrapper.get('[data-reader-drawer="contents"]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('data-side')).toBe('left')
    const title = wrapper.get(`#${dialog.attributes('aria-labelledby')}`)
    expect(title.text()).toBe('Contents')
    expect(wrapper.findAll('.reader-contents-row').map((row) => row.text())).toEqual(HEADINGS.map((h) => h.text))
  })

  it('indents 16px per level below the shallowest one present', () => {
    const wrapper = mountDrawer()
    const pads = wrapper.findAll('.reader-contents-row').map((row) => (row.element as HTMLElement).style.paddingLeft)
    expect(pads).toEqual(['12px', '28px', '28px', '12px', '44px'])
  })

  it('marks only the current heading', () => {
    const wrapper = mountDrawer({ current: 'nested-two' })
    const current = wrapper.findAll('[aria-current="true"]')
    expect(current).toHaveLength(1)
    expect(current[0].text()).toBe('Nested two')
  })

  it('emits select with the anchor, and nothing for a row whose heading is missing', async () => {
    const wrapper = mountDrawer({ missing: ['second'] })
    await wrapper.get('[data-anchor="nested-one"]').trigger('click')
    expect(wrapper.emitted('select')).toEqual([['nested-one']])
    const missing = wrapper.get('[data-anchor="second"]')
    expect(missing.attributes('aria-disabled')).toBe('true')
    await missing.trigger('click')
    expect(wrapper.emitted('select')).toHaveLength(1)
    expect(wrapper.emitted('close')).toBeUndefined()
  })

  it('closes on Escape and on the scrim, and hands focus back to its opener', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = mountDrawer()
    expect(document.activeElement).toBe(wrapper.get('[data-reader-drawer="contents"]').element)

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.get('.reader-drawer-scrim').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)

    wrapper.unmount()
    expect(document.activeElement).toBe(opener)
  })
})
