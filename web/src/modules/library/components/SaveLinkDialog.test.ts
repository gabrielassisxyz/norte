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
  it('submits a URL and shows the saved item', async () => {
    const library = fakeLibrarySource([])
    const wrapper = await mountDialog(library)

    await wrapper.get('#save-url').setValue('https://example.org/reading-list')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(library.calls.save).toEqual([{ url: 'https://example.org/reading-list' }])
    expect(wrapper.get('.save-done').text()).toContain('Salvo na inbox')
    expect(wrapper.get('.save-done').text()).toContain('https://example.org/reading-list')
  })

  it('sends the note as reason, which is the field the contract names', async () => {
    const library = fakeLibrarySource([])
    const wrapper = await mountDialog(library)

    await wrapper.get('#save-url').setValue('https://example.org/reading-list')
    await wrapper.get('#save-reason').setValue('  Para comparar em janeiro  ')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    // Asserted whole rather than with toMatchObject: the contract pins
    // additionalProperties: false, so a body that still carried `why` beside
    // `reason` would be refused by the server and pass a partial match here.
    expect(library.calls.save).toEqual([
      { url: 'https://example.org/reading-list', reason: 'Para comparar em janeiro' }
    ])
  })

  it('names the shelf when the URL was already saved', async () => {
    const library = fakeLibrarySource([
      libraryRecord({
        id: 'saved-elsewhere',
        title: 'Guardada no arquivo',
        url: 'https://example.org/duplicada',
        canonical_url: 'https://example.org/duplicada',
        location: 'archive'
      })
    ])
    const wrapper = await mountDialog(library)

    await wrapper.get('#save-url').setValue('https://example.org/duplicada')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('.save-done').text()).toContain('Já estava salvo no arquivo')
    expect(wrapper.get('.save-done').text()).toContain('Guardada no arquivo')
    expect(library.records).toHaveLength(1)
  })

  it('keeps the dialog open and reports a failed save', async () => {
    const library = fakeLibrarySource([], {
      saveLink: async () => {
        throw new Error('rede indisponível')
      }
    })
    const wrapper = await mountDialog(library)

    await wrapper.get('#save-url').setValue('https://example.org/reading-list')
    await wrapper.get('form').trigger('submit')
    await flushReads()

    expect(wrapper.get('[role="alert"]').text()).toBe('Não foi possível salvar: rede indisponível')
    expect(wrapper.get('#save-url').element).toHaveProperty('value', 'https://example.org/reading-list')
  })
})
