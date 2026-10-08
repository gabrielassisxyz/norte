import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { shiftIsoDate, todayIsoDate } from '@/lib/clock'
import { createMockStore, type MockStore } from '@/mock/store'
import { resetModuleMounting } from '@/modules/mounting'
import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { DecisionDetail } from '../data/source'
import DecisionView from './DecisionView.vue'

/** The day the mock data is built against, so a date on screen is a known date. */
const TODAY = '2026-10-03'

let store: MockStore

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  store = createMockStore()
})

afterEach(() => {
  vi.useRealTimers()
  resetModuleMounting()
})

async function mountDecision(
  id: string,
  sources: Partial<AppSources>,
  preselect = false
): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push({ name: 'decisao', params: { id }, query: preselect ? { preselect: '1' } : undefined })
  await router.isReady()
  const wrapper = mount(DecisionView, {
    props: { id, preselect },
    global: { plugins: [router, sourcesPlugin(sources)] }
  })
  await flushReads()
  return { wrapper, router }
}

/** The decision detail the mock source would answer with, for one id. */
async function detailOf(id: string): Promise<DecisionDetail> {
  const detail = await createMockSources(store).projects.getDecision(id, new AbortController().signal)
  if (!detail) throw new Error(`The mock store holds no decision ${id}`)
  return detail
}

/**
 * A projects source answering with that detail. The library is faked alongside
 * it because the screen lists the reading behind a decision.
 */
function sourcesWith(
  detail: DecisionDetail | null,
  overrides: Partial<AppSources['projects']> = {}
): Partial<AppSources> {
  return {
    library: {
      listItems: async () => ({
        items: [],
        next_cursor: null,
        counts: { inbox: 0, depois: 0, arquivo: 0, tudo: 0, unread: 0 }
      })
    } as unknown as AppSources['library'],
    projects: {
      getDecision: async () => detail,
      ...overrides
    } as unknown as AppSources['projects']
  }
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

describe('decision view over the mock source', () => {
  it('renders the decision title and its main regions', async () => {
    const { wrapper, router } = await mountDecision('decision-backup-media', createMockSources(store))

    expect(wrapper.find('h1').text()).toBe('Escolher mídia para a cópia externa')
    for (const heading of ['Contexto', 'Opções', 'O que li para decidir', 'Bloqueia']) {
      expect(wrapper.text()).toContain(heading)
    }
    expect(wrapper.findAll('.decision-blocked-task')).not.toHaveLength(0)
    for (const link of wrapper.findAll('.decision-blocked-task')) {
      expect(router.resolve(link.attributes('href')!).name).toBe('tarefa')
    }
    // The reading behind a decision lives in the library, which reads the
    // server while this module reads the mock: the section is there and names
    // nothing, because a mock id cannot be looked up against the API.
    expect(wrapper.findAll('.decision-reference')).toHaveLength(0)
  })

  it('keeps Decidir disabled until a choice is complete and persists it', async () => {
    const { wrapper } = await mountDecision('decision-backup-media', createMockSources(store))
    const decideButton = wrapper.find('.decision-action-primary')

    expect(decideButton.attributes('disabled')).toBeDefined()
    await wrapper.find('[role="radio"]').trigger('click')
    expect(decideButton.attributes('disabled')).toBeUndefined()
    await decideButton.trigger('click')
    await flushReads()

    expect(wrapper.text()).toContain('Decidida hoje: Disco portátil')
    expect(store.decisions.find((decision) => decision.id === 'decision-backup-media')).toMatchObject({
      status: 'decided',
      selectedOptionId: 'option-drive'
    })
  })

  it('requires reasoning when Outra is selected', async () => {
    const { wrapper } = await mountDecision('decision-budget-period', createMockSources(store))
    const decideButton = wrapper.find('.decision-action-primary')
    const other = wrapper.findAll('[role="radio"]').at(-1)!

    await other.trigger('click')
    expect(decideButton.attributes('disabled')).toBeDefined()
    await wrapper.find('#decision-reasoning-input').setValue('Acompanhar cada entrada em um ciclo próprio.')
    expect(decideButton.attributes('disabled')).toBeUndefined()
    await decideButton.trigger('click')
    await flushReads()

    expect(wrapper.text()).toContain('Decidida hoje: Outra')
    expect(store.decisions.find((decision) => decision.id === 'decision-budget-period')).toMatchObject({
      status: 'decided',
      selectedOptionId: 'other',
      reasoning: 'Acompanhar cada entrada em um ciclo próprio.'
    })
  })

  it('adds exactly seven days when postponing', async () => {
    const { wrapper } = await mountDecision('decision-backup-media', createMockSources(store))
    const stored = () => store.decisions.find((candidate) => candidate.id === 'decision-backup-media')!
    const currentDue = stored().postponedUntil ?? shiftIsoDate(todayIsoDate(), 7)

    await wrapper.findAll('button').find((button) => button.text() === 'Adiar uma semana')!.trigger('click')
    await flushReads()

    expect(stored().postponedUntil).toBe(addDays(currentDue, 7))
  })

  it('preselects the preferred option when requested and supports editing', async () => {
    const { wrapper } = await mountDecision('decision-backup-media', createMockSources(store), true)

    expect(wrapper.findAll('[role="radio"]')[0].attributes('aria-checked')).toBe('true')
    await wrapper.findAll('button').find((button) => button.text() === 'Editar')!.trigger('click')
    await wrapper.find('#decision-title').setValue('Escolher mídia de cópia')
    await wrapper.findAll('button').find((button) => button.text() === 'Salvar')!.trigger('click')
    await flushReads()

    expect(wrapper.find('h1').text()).toBe('Escolher mídia de cópia')
  })
})

describe('decision view while it waits, is missing, or fails', () => {
  it('says it is loading before the decision answers', async () => {
    const { wrapper } = await mountDecision(
      'decision-backup-media',
      sourcesWith(null, { getDecision: () => new Promise(() => {}) })
    )

    expect(wrapper.get('[role="status"]').text()).toBe('Carregando a decisão…')
    expect(wrapper.find('[role="radio"]').exists()).toBe(false)
  })

  it('shows a not-found message for an unknown id', async () => {
    const { wrapper } = await mountDecision('decision-that-does-not-exist', createMockSources(store))

    expect(wrapper.text()).toContain('Decisão não encontrada')
  })

  it('says why the decision could not be read, and reads again when asked', async () => {
    const detail = await detailOf('decision-backup-media')
    let attempts = 0
    const { wrapper } = await mountDecision(
      'decision-backup-media',
      sourcesWith(detail, {
        getDecision: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rede fora do ar')
          return detail
        }
      })
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível carregar a decisão: rede fora do ar')

    await wrapper.findAll('button').find((button) => button.text() === 'Tentar de novo')!.trigger('click')
    await flushReads()

    expect(wrapper.find('h1').text()).toBe('Escolher mídia para a cópia externa')
  })
})

describe('decision view writing to its source', () => {
  it('leaves the decision pending and says so when deciding fails', async () => {
    const detail = await detailOf('decision-backup-media')
    const { wrapper } = await mountDecision(
      'decision-backup-media',
      sourcesWith(detail, {
        decideDecision: async () => {
          throw new Error('decisão já fechada')
        }
      })
    )

    await wrapper.find('[role="radio"]').trigger('click')
    await wrapper.find('.decision-action-primary').trigger('click')
    await flushReads()

    expect(wrapper.get('.decision-write-error').text()).toContain('Não foi possível salvar: decisão já fechada')
    expect(wrapper.find('.decision-status').text()).toBe('Pendente')
  })

  it('shows the decision the source answered with, not the one it was sent', async () => {
    const detail = await detailOf('decision-backup-media')
    const answered = {
      ...detail.decision,
      status: 'decided' as const,
      selectedOptionId: detail.decision.options[1].id
    }
    const { wrapper } = await mountDecision(
      'decision-backup-media',
      sourcesWith(detail, { decideDecision: async () => answered })
    )

    // The first option is picked on screen; the source answers with the second.
    await wrapper.find('[role="radio"]').trigger('click')
    await wrapper.find('.decision-action-primary').trigger('click')
    await flushReads()

    expect(wrapper.text()).toContain(`Decidida hoje: ${detail.decision.options[1].title}`)
  })
})
