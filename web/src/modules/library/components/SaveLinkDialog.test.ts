import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import { fakeCoreSource } from '@/shell/data/testing'

import { fakeLibrarySource, libraryRecord } from '../data/testing'
import SaveLinkDialog from './SaveLinkDialog.vue'

async function mountDialog(library: Partial<AppSources['library']>): Promise<VueWrapper> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/library')
  await router.isReady()
  const wrapper = mount(SaveLinkDialog, {
    props: { open: true },
    global: {
      plugins: [
        router,
        sourcesPlugin({
          core: fakeCoreSource(),
          library: library as AppSources['library']
        })
      ]
    }
  })
  await flushReads()
  return wrapper
}

describe('SaveLinkDialog', () => {
  it('asks the glossary question for the note', async () => {
    const wrapper = await mountDialog(fakeLibrarySource([]))

    expect(wrapper.get('label[for="save-reason"]').text()).toBe('Why am I saving this?')
  })

  it('submits a URL and shows the saved item', async () => {
    const library = fakeLibrarySource([])
    const wrapper = await mountDialog(library)

    await wrapper.get('#save-url').setValue('https://example.org/reading-list')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(library.calls.save).toEqual([{ url: 'https://example.org/reading-list' }])
    expect(wrapper.get('.save-done').text()).toContain('Saved to the inbox')
    expect(wrapper.get('.save-done').text()).toContain('https://example.org/reading-list')
  })

  it('sends the note as reason, which is the field the contract names', async () => {
    const library = fakeLibrarySource([])
    const wrapper = await mountDialog(library)

    await wrapper.get('#save-url').setValue('https://example.org/reading-list')
    await wrapper.get('#save-reason').setValue('  To compare in January  ')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    // Asserted whole rather than with toMatchObject: the contract pins
    // additionalProperties: false, so a body that still carried `why` beside
    // `reason` would be refused by the server and pass a partial match here.
    expect(library.calls.save).toEqual([
      { url: 'https://example.org/reading-list', reason: 'To compare in January' }
    ])
  })

  it('names the shelf when the URL was already saved', async () => {
    const library = fakeLibrarySource([
      libraryRecord({
        id: 'saved-elsewhere',
        title: 'Kept in the archive',
        url: 'https://example.org/duplicate',
        canonical_url: 'https://example.org/duplicate',
        location: 'archive'
      })
    ])
    const wrapper = await mountDialog(library)

    await wrapper.get('#save-url').setValue('https://example.org/duplicate')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('.save-done').text()).toContain('Already saved in the Archive')
    expect(wrapper.get('.save-done').text()).toContain('Kept in the archive')
    expect(library.records).toHaveLength(1)
  })

  it('keeps the dialog open and reports a failed save', async () => {
    const library = fakeLibrarySource([], {
      saveLink: async () => {
        throw new Error('network unavailable')
      }
    })
    const wrapper = await mountDialog(library)

    await wrapper.get('#save-url').setValue('https://example.org/reading-list')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toBe('Could not save: network unavailable')
    expect(wrapper.get('#save-url').element).toHaveProperty('value', 'https://example.org/reading-list')
  })
})
