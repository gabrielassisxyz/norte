import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import type { LibraryLocation } from '../data/source'
import ReaderLocationSheet from './ReaderLocationSheet.vue'
import ReaderMoreSheet from './ReaderMoreSheet.vue'

const LOCATIONS: Array<{ location: LibraryLocation; label: string }> = [
  { location: 'inbox', label: 'Inbox' },
  { location: 'up_next', label: 'Up Next' },
  { location: 'later', label: 'Later' },
  { location: 'archive', label: 'Archive' },
  { location: 'stash', label: 'Stash' }
]

describe('the location sheet', () => {
  function mountSheet(location: LibraryLocation = 'later') {
    return mount(ReaderLocationSheet, { props: { location, locations: LOCATIONS, busy: false } })
  }

  it('lists the five locations in order with only the current one pressed', () => {
    const rows = mountSheet('archive').findAll('button')

    expect(rows.map((row) => row.text())).toEqual(['Inbox', 'Up Next', 'Later', 'Archive', 'Stash'])
    expect(rows.map((row) => row.attributes('aria-pressed'))).toEqual(['false', 'false', 'false', 'true', 'false'])
  })

  it('asks for the move and the close once each on a single tap', async () => {
    const wrapper = mountSheet()

    await wrapper.get('[data-action="location-stash"]').trigger('click')

    expect(wrapper.emitted('move')).toEqual([['stash']])
    expect(wrapper.emitted('close')).toHaveLength(1)
  })

  it('closes on a tap of the scrim and not on a tap inside the sheet', async () => {
    const wrapper = mountSheet()

    await wrapper.get('[role="dialog"]').trigger('click')
    expect(wrapper.emitted('close')).toBeUndefined()

    await wrapper.get('.reader-action-scrim').trigger('click')
    expect(wrapper.emitted('close')).toHaveLength(1)
  })
})

describe('the more sheet', () => {
  function mountSheet() {
    return mount(ReaderMoreSheet, {
      props: { url: 'https://example.invalid/a', title: 'A saved text', busy: false }
    })
  }

  it('holds exactly the original and delete', () => {
    const wrapper = mountSheet()
    const sheet = wrapper.get('[data-reader-sheet="more"]')

    expect(sheet.findAll('a, button').map((row) => row.text())).toEqual(['Open the original', 'Delete'])
  })

  it('emits nothing until the delete is confirmed, and nothing at all when it is cancelled', async () => {
    const wrapper = mountSheet()

    await wrapper.get('[data-action="delete"]').trigger('click')
    expect(wrapper.text()).toContain('Delete “A saved text”?')
    expect(wrapper.emitted('delete')).toBeUndefined()

    await wrapper.get('[data-action="cancel-delete"]').trigger('click')
    expect(wrapper.emitted('delete')).toBeUndefined()
    expect(wrapper.emitted('close')).toBeUndefined()
    expect(wrapper.find('#reader-delete-title').exists()).toBe(false)

    await wrapper.get('[data-action="delete"]').trigger('click')
    await wrapper.get('[data-action="confirm-delete"]').trigger('click')
    expect(wrapper.emitted('delete')).toHaveLength(1)
  })
})
