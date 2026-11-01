import { mount } from '@vue/test-utils'
import { afterEach, describe, expect, it } from 'vitest'

import { libraryRecord } from '../data/testing'
import type { LibraryItemRecord } from '../data/source'
import ReaderInfoDrawer from './ReaderInfoDrawer.vue'

afterEach(() => {
  document.body.innerHTML = ''
})

const FULL: LibraryItemRecord = libraryRecord({
  id: 'item-1',
  title: 'A saved text',
  author: 'A. Writer',
  site: 'example.com',
  url: 'https://example.com/a?utm=1',
  canonical_url: 'https://example.com/a',
  published_at: '2026-10-20T08:00:00Z',
  minutes: 96,
  saved_at: '2026-10-25T09:00:00Z',
  source: 'app',
  tags: ['systems', 'reading']
})

function mountDrawer(props: { item?: LibraryItemRecord; tab?: 'info' | 'notebook'; notebookCount?: number; open?: boolean } = {}) {
  return mount(ReaderInfoDrawer, {
    props: {
      open: props.open ?? true,
      tab: props.tab ?? 'info',
      item: props.item ?? FULL,
      notebookCount: props.notebookCount ?? 0
    },
    slots: { default: '<p data-notebook-body>Notebook body</p>' },
    attachTo: document.body
  })
}

describe('the info drawer', () => {
  it('is a right dialog whose segmented control reads Info | Notebook with Info selected', () => {
    const wrapper = mountDrawer()
    const dialog = wrapper.get('[data-reader-drawer="info"]')
    expect(dialog.attributes('role')).toBe('dialog')
    expect(dialog.attributes('data-side')).toBe('right')
    expect(wrapper.get('[role="tablist"]').findAll('[role="tab"]').map((tab) => tab.text())).toEqual(['Info', 'Notebook'])
    expect(wrapper.get('[role="tab"][aria-selected="true"]').text()).toBe('Info')
  })

  it('lists seven rows in order for a full item, with the original as a safe link', () => {
    const wrapper = mountDrawer()
    const rows = wrapper.findAll('[data-info-row]')
    expect(rows.map((row) => row.get('dt').text())).toEqual([
      'Author',
      'Site',
      'URL',
      'Published',
      'Length',
      'Saved',
      'Tags'
    ])
    expect(rows.map((row) => row.get('dd').text())).toEqual([
      'A. Writer',
      'example.com',
      'example.com/a',
      '20 Oct 2026',
      '96 min',
      '25 Oct 2026 · app',
      'systemsreading'
    ])
    const link = wrapper.get('[data-info-row="url"] a')
    expect(link.attributes('href')).toBe('https://example.com/a?utm=1')
    expect(link.attributes('target')).toBe('_blank')
    expect(link.attributes('rel')).toBe('noopener noreferrer')
    expect(wrapper.findAll('[data-info-row="tags"] li').map((tag) => tag.text())).toEqual(['systems', 'reading'])
  })

  it('omits the author and the tags when the item has none', () => {
    const wrapper = mountDrawer({ item: { ...FULL, author: undefined, tags: [] } })
    expect(wrapper.findAll('[data-info-row]').map((row) => row.get('dt').text())).toEqual([
      'Site',
      'URL',
      'Published',
      'Length',
      'Saved'
    ])
  })

  it('emits the tab asked for and keeps the notebook mounted on the Info tab', async () => {
    const wrapper = mountDrawer()
    expect(wrapper.find('[data-notebook-body]').exists()).toBe(true)
    expect(wrapper.get('.reader-info-notebook').attributes('style')).toContain('display: none')

    await wrapper.findAll('[role="tab"]')[1].trigger('click')
    expect(wrapper.emitted('update:tab')).toEqual([['notebook']])

    await wrapper.setProps({ tab: 'notebook' })
    expect(wrapper.get('.reader-info-notebook').attributes('style') ?? '').not.toContain('display: none')
    expect(wrapper.get('[data-reader-info]').attributes('style')).toContain('display: none')
  })

  it('carries the highlight count on the Notebook tab only above zero', async () => {
    const wrapper = mountDrawer({ notebookCount: 0 })
    expect(wrapper.findAll('[role="tab"]')[1].text()).toBe('Notebook')
    await wrapper.setProps({ notebookCount: 3 })
    expect(wrapper.findAll('[role="tab"]')[1].text()).toBe('Notebook3')
  })

  it('is mounted but hidden while shut, closes on Escape and the scrim, and returns focus', async () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const wrapper = mountDrawer({ open: false })
    expect(wrapper.get('.reader-drawer-scrim').attributes('style')).toContain('display: none')
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.setProps({ open: true })
    await wrapper.vm.$nextTick()
    expect(document.activeElement).toBe(wrapper.get('[data-reader-drawer="info"]').element)
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
    expect(wrapper.emitted('close')).toHaveLength(1)
    await wrapper.get('.reader-drawer-scrim').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(2)

    await wrapper.setProps({ open: false })
    expect(document.activeElement).toBe(opener)
  })
})
