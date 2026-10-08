import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

import { stubPhoneViewport } from '@/lib/phoneViewport.testing'
import { resetModuleMounting, setEnabledModules } from '@/modules/mounting'
import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { fakeCoreSource } from '@/shell/data/testing'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import { fakeLibrarySource, libraryRecord, type FakeLibrarySource } from '../data/testing'
import LibraryView from './LibraryView.vue'

/**
 * The Biblioteca's row actions on a viewport with no hover.
 *
 * On a wide screen the row's actions are revealed by the pointer being over the
 * row. A phone has no such pointer, so the actions are not on the page at all
 * until a tap on the row's "more" button puts them there — rendered rather than
 * merely made opaque, because a transparent control that still answers a tap is
 * the same defect wearing a disguise.
 */
let restoreViewport: () => void

beforeEach(() => {
  restoreViewport = stubPhoneViewport()
  setEnabledModules(['library'])
})

afterEach(() => {
  restoreViewport()
  resetModuleMounting()
})

async function mountLibrary(): Promise<{ wrapper: ReturnType<typeof mount>; library: FakeLibrarySource }> {
  const library = fakeLibrarySource([
    libraryRecord({ id: 'item-1', title: 'Primeiro texto', saved_at: '2026-10-03T09:00:00Z' }),
    libraryRecord({ id: 'item-2', title: 'Segundo texto', saved_at: '2026-10-02T09:00:00Z' })
  ])
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push('/biblioteca?v=inbox')
  await router.isReady()
  const wrapper = mount(LibraryView, {
    global: {
      plugins: [
        router,
        sourcesPlugin({ library: library as unknown as AppSources['library'], core: fakeCoreSource() })
      ]
    }
  })
  await flushReads()
  return { wrapper, library }
}

describe('the Biblioteca rows on a phone', () => {
  it('hides no action behind hover: the group is absent until it is tapped open', async () => {
    const { wrapper } = await mountLibrary()

    expect(wrapper.findAll('[role="group"][aria-label="Ações"]')).toHaveLength(0)
    const more = wrapper.findAll('[data-action="mais"]')
    expect(more).toHaveLength(2)
    expect(more[0].attributes('aria-expanded')).toBe('false')

    await more[0].trigger('click')

    expect(wrapper.findAll('[role="group"][aria-label="Ações"]')).toHaveLength(1)
    expect(wrapper.findAll('[data-action="mais"]')[0].attributes('aria-expanded')).toBe('true')
  })

  it('moves the item from the tapped-open group', async () => {
    const { wrapper, library } = await mountLibrary()

    await wrapper.findAll('[data-action="mais"]')[0].trigger('click')
    await wrapper.get('button[aria-label="Depois"]').trigger('click')
    await flushReads()

    expect(library.calls.patch).toEqual([{ id: 'item-1', patch: { status: 'depois' } }])
  })

  it('closes the group on a second tap, and opens one row at a time', async () => {
    const { wrapper } = await mountLibrary()
    const more = () => wrapper.findAll('[data-action="mais"]')

    await more()[0].trigger('click')
    await more()[1].trigger('click')
    expect(more()[0].attributes('aria-expanded')).toBe('false')
    expect(more()[1].attributes('aria-expanded')).toBe('true')

    await more()[1].trigger('click')
    expect(wrapper.findAll('[role="group"][aria-label="Ações"]')).toHaveLength(0)
  })

  it('does not navigate to the reader when the more button is tapped', async () => {
    const { wrapper } = await mountLibrary()

    await wrapper.findAll('[data-action="mais"]')[0].trigger('click')
    await flushReads()

    // The row itself opens the reader on a tap, and the button inside it must
    // not: `openItem` steps aside for a button or a link under the pointer.
    expect(wrapper.findAll('[role="group"][aria-label="Ações"]')).toHaveLength(1)
  })
})

describe('the Biblioteca rows on a wide screen', () => {
  it('keeps the hover reveal: the group is rendered and no more button is', async () => {
    restoreViewport()
    restoreViewport = stubPhoneViewport(false)
    const { wrapper } = await mountLibrary()

    expect(wrapper.findAll('[role="group"][aria-label="Ações"]')).toHaveLength(2)
    expect(wrapper.findAll('[data-action="mais"]')).toHaveLength(0)
  })
})
