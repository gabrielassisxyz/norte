import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { fakeLibrarySource, libraryRecord } from '@/modules/library/data/testing'
import ReaderView from '@/modules/library/views/ReaderView.vue'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { routes } from '@/router'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import '../index'
import { fakeNotesSource } from '../data/testing'

/**
 * A search hit for an item's note lands on the reader with the note asked
 * for (`?notas=nota`): the panel opens on its Nota tab rather than on the
 * margin. Importing the module registers its reader slots, which is what puts
 * the panel under test inside the library's reader.
 */
const mounted: Array<{ unmount: () => void }> = []

beforeEach(() => {
  setEnabledModules(['library', 'notes'])
})

afterEach(() => {
  while (mounted.length > 0) mounted.pop()?.unmount()
  resetModuleMounting()
})

async function mountReader(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ReaderView, {
    global: {
      plugins: [
        router,
        sourcesPlugin({
          library: fakeLibrarySource([
            libraryRecord({ id: 'item-1', title: 'Um texto guardado', content_html: '<p>O texto.</p>' })
          ]),
          notes: fakeNotesSource({ itemNotes: { 'item-1': 'Uma nota sobre o texto inteiro.' } })
        })
      ]
    }
  })
  mounted.push(wrapper)
  await flushReads()
  return wrapper
}

describe("the reader opened from an item-note search hit", () => {
  it('shows the note tab when the hit asks for it', async () => {
    const wrapper = await mountReader('/biblioteca/item-1?notas=nota')

    expect(wrapper.find('.notes-reader').exists()).toBe(true)
    expect(wrapper.find('#notes-reader-note').exists()).toBe(true)
    expect(wrapper.find('#notes-reader-annotation').exists()).toBe(false)
  })

  it('shows the margin tab when no section is asked for', async () => {
    const wrapper = await mountReader('/biblioteca/item-1')

    expect(wrapper.find('#notes-reader-annotation').exists()).toBe(true)
    expect(wrapper.find('#notes-reader-note').exists()).toBe(false)
  })
})
