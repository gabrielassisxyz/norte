import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import type { CardRating } from '@/mock/types'
import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { ReviewQueuePage, ReviewSource } from '../data/source'
import ReviewView from './ReviewView.vue'

/** Every seeded card is due the day the store is built for, which this fixes. */
const TODAY = '2026-10-03'

let store: MockStore

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  store = createMockStore()
})

afterEach(() => {
  vi.useRealTimers()
})

async function mountReview(path = '/revisao', sources?: Partial<AppSources>) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ReviewView, {
    global: { plugins: [router, sourcesPlugin(sources ?? createMockSources(store))] }
  })
  await flushReads()
  return { wrapper, router }
}

function reviewWith(overrides: Partial<ReviewSource>): Partial<AppSources> {
  const empty: ReviewQueuePage = {
    items: [],
    next_cursor: null,
    counts: { cards: 0, due: 0, decks: 0 },
    decks: []
  }
  return {
    review: {
      listCards: async () => empty,
      summary: async () => empty.counts,
      rateCard: async () => {
        throw new Error('not faked')
      },
      ...overrides
    } as unknown as AppSources['review'],
    library: { getItem: async () => null } as unknown as AppSources['library']
  }
}

function resolveName(router: Router, href: string | undefined): string | undefined {
  if (!href) return undefined
  const resolved = router.resolve(href)
  return typeof resolved.name === 'string' ? resolved.name : undefined
}

function press(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }))
}

type Wrapper = VueWrapper<any>

function deckButton(wrapper: Wrapper, label: string) {
  const button = wrapper.findAll('button.deck').find((candidate) => candidate.text().includes(label))
  if (button === undefined) throw new Error(`Deck button "${label}" was not found`)
  return button
}

function statValues(wrapper: Wrapper): string[] {
  return wrapper.findAll('.nt-stat-value').map((node) => node.text())
}

async function reveal(wrapper: Wrapper): Promise<void> {
  await wrapper.find('.nt-card-reveal button').trigger('click')
}

async function rateVisible(wrapper: Wrapper, index: number): Promise<void> {
  await wrapper.findAll('.nt-rate')[index].trigger('click')
  await flushReads()
}

describe('review view', () => {
  it('renders its title, stats and the deck list before a session starts', async () => {
    const { wrapper } = await mountReview()

    expect(wrapper.get('h1').text()).toBe('Revisão')
    expect(wrapper.text()).toContain('Restam hoje')
    expect(wrapper.text()).toContain('Revisados nesta sessão')
    expect(wrapper.text()).toContain('Lembrados')
    expect(wrapper.text()).toContain('Baralhos')
    for (const name of ['Tudo de hoje', 'Construção de linguagens', 'Letras e leitura', 'Aprendizagem']) {
      expect(wrapper.text()).toContain(name)
    }
    expect(wrapper.findAll('button.deck')).toHaveLength(4)
    expect(deckButton(wrapper, 'Tudo de hoje').text()).toContain('24 / 24')
    expect(deckButton(wrapper, 'Construção de linguagens').text()).toContain('8 / 8')
    expect(wrapper.text()).toContain('Escolha um baralho')
    expect(wrapper.find('.nt-card').exists()).toBe(false)
  })

  it('starts a session with exactly the picked deck due cards and drops the counts per rating', async () => {
    const { wrapper } = await mountReview()

    await deckButton(wrapper, 'Construção de linguagens').trigger('click')
    await flushReads()

    expect(wrapper.get('.nt-card-front').text()).toBe('Para que serve uma tabela de símbolos?')
    expect(wrapper.get('.nt-card-pos').text()).toBe('1/8')
    expect(statValues(wrapper)[0]).toContain('24')

    await reveal(wrapper)
    expect(wrapper.get('.nt-card-back').text()).toContain('Ela associa nomes')
    await rateVisible(wrapper, 2)

    expect(wrapper.get('.nt-card-front').text()).toBe('O que é um token?')
    expect(wrapper.get('.nt-card-pos').text()).toBe('2/8')
    expect(statValues(wrapper)[0]).toContain('23')
    expect(statValues(wrapper)[1]).toContain('1')
    expect(store.reviewCards.find((card) => card.id === 'card-comp-1')).toMatchObject({
      lastRating: 'good'
    })
    expect(deckButton(wrapper, 'Construção de linguagens').text()).toContain('7 / 8')
  })

  it('drives the whole session from the keyboard without the mouse', async () => {
    const { wrapper } = await mountReview()

    await deckButton(wrapper, 'Tudo de hoje').trigger('click')
    await flushReads()
    const first = wrapper.get('.nt-card-front').text()

    press(' ')
    await flushReads()
    expect(wrapper.find('.nt-card-back').exists()).toBe(true)

    // Rating keys do nothing while the back is hidden on the next card.
    press('4')
    await flushReads()
    expect(wrapper.get('.nt-card-front').text()).not.toBe(first)
    expect(statValues(wrapper)[1]).toContain('1')

    press('2')
    await flushReads()
    expect(statValues(wrapper)[1]).toContain('1')

    press(' ')
    await flushReads()
    press('2')
    await flushReads()
    expect(statValues(wrapper)[1]).toContain('2')
    expect(store.reviewCards.find((card) => card.id === 'card-comp-2')).toMatchObject({
      lastRating: 'hard'
    })
  })

  it('shows recall as (good + easy) / rated and restarts back to the deck list', async () => {
    const { wrapper, router } = await mountReview()
    const pattern: CardRating[] = ['good', 'easy', 'hard', 'again', 'good', 'easy', 'good', 'easy']

    await deckButton(wrapper, 'Letras e leitura').trigger('click')
    await flushReads()
    for (const rating of pattern) {
      press(' ')
      await flushReads()
      press(String(['again', 'hard', 'good', 'easy'].indexOf(rating) + 1))
      await flushReads()
    }

    expect(wrapper.text()).toContain('Sessão concluída')
    // Six of eight ratings count as recalled: 75%.
    expect(wrapper.text()).toContain('75%')
    expect(wrapper.find('.nt-card').exists()).toBe(false)
    const home = wrapper.find('.review-home')
    expect(home.attributes('href')).toBe('/')
    expect(resolveName(router, home.attributes('href'))).toBe('inicio')

    await wrapper.find('.review-panel .nt-btn-primary').trigger('click')
    expect(wrapper.text()).toContain('Escolha um baralho')
    expect(wrapper.find('.nt-card').exists()).toBe(false)
    expect(wrapper.find('.review-home').exists()).toBe(false)
  })

  it('links the breadcrumb to its route and names the source without linking it', async () => {
    const { wrapper, router } = await mountReview()

    expect(resolveName(router, wrapper.get('.crumb a').attributes('href'))).toBe('estudo')

    await deckButton(wrapper, 'Tudo de hoje').trigger('click')
    await flushReads()

    // The source of a card is a library item, and the library reads the server
    // while this module reads the mock. The hint still says where the card came
    // from; it just does not offer a link that would resolve to nothing.
    const hint = wrapper.get('.review-hint')
    expect(hint.text()).toContain('origem:')
    expect(hint.find('a').exists()).toBe(false)
  })

  it('says it is loading before the queue answers', async () => {
    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/revisao')
    await router.isReady()
    const wrapper = mount(ReviewView, {
      global: {
        plugins: [router, sourcesPlugin(reviewWith({ listCards: () => new Promise<ReviewQueuePage>(() => {}) }))]
      }
    })

    expect(wrapper.get('[role="status"]').text()).toBe('Carregando os cartões…')
    expect(wrapper.find('button.deck').exists()).toBe(false)
  })

  it('says there are no cards once the queue answers empty', async () => {
    const { wrapper } = await mountReview('/revisao', reviewWith({}))

    expect(wrapper.get('.review-state').text()).toContain('Nenhum cartão ainda')
    expect(wrapper.find('button.deck').exists()).toBe(false)
  })

  it('says why the queue could not be read, and reads again when asked', async () => {
    let attempts = 0
    const { wrapper } = await mountReview(
      '/revisao',
      reviewWith({
        listCards: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rede indisponível')
          return { items: [], next_cursor: null, counts: { cards: 0, due: 0, decks: 0 }, decks: [] }
        }
      })
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível carregar os cartões: rede indisponível')

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushReads()

    expect(wrapper.get('.review-state').text()).toContain('Nenhum cartão ainda')
  })

  it('keeps the card in front of the reader when the rating cannot be recorded', async () => {
    const { wrapper } = await mountReview('/revisao', {
      ...createMockSources(store),
      review: {
        ...createMockSources(store).review,
        rateCard: async () => {
          throw new Error('conflito no servidor')
        }
      }
    })

    await deckButton(wrapper, 'Construção de linguagens').trigger('click')
    await flushReads()
    const front = wrapper.get('.nt-card-front').text()

    await reveal(wrapper)
    await rateVisible(wrapper, 2)

    expect(wrapper.get('.review-write-error').text()).toContain('Não foi possível registrar a resposta: conflito no servidor')
    expect(wrapper.get('.nt-card-front').text()).toBe(front)
    expect(wrapper.get('.nt-card-pos').text()).toBe('1/8')
    expect(statValues(wrapper)[0]).toContain('24')
  })

  it('shows the due date the source came back with, by dropping the card from the deck', async () => {
    const { wrapper } = await mountReview()

    await deckButton(wrapper, 'Construção de linguagens').trigger('click')
    await flushReads()
    await reveal(wrapper)
    await rateVisible(wrapper, 0)

    // "De novo" is the first interval, so the card stays due today and the deck
    // count does not drop — which only a page reading the response can tell.
    expect(deckButton(wrapper, 'Construção de linguagens').text()).toContain('8 / 8')
    expect(statValues(wrapper)[0]).toContain('24')
  })
})

/**
 * The due list is the clock's, not the seed's: a card becomes due because the
 * day moved, and a fixed queue read on two days has to answer differently.
 */
describe('review view against the calendar', () => {
  const DECK = { id: 'deck-linguagens', title: 'Construção de linguagens', curriculumSlug: 'c', description: 'd' }

  function queueDueOn(dates: string[]): Partial<AppSources> {
    const items = dates.map((dueAt, position) => ({
      id: `card-${position}`,
      deckId: DECK.id,
      front: `Frente ${position}`,
      back: `Verso ${position}`,
      sourceLibraryItemId: 'post-compilation',
      dueAt
    }))
    const page: ReviewQueuePage = {
      items,
      next_cursor: null,
      counts: { cards: items.length, due: 0, decks: 1 },
      decks: [DECK]
    }
    return reviewWith({ listCards: async () => page })
  }

  it('moves a card into the due list when the day it is due arrives', async () => {
    const sources = queueDueOn(['2026-10-03', '2026-10-04', '2026-10-05'])

    const { wrapper: onThird } = await mountReview('/revisao', sources)
    expect(deckButton(onThird, 'Tudo de hoje').text()).toContain('1 / 3')

    vi.setSystemTime(new Date('2026-10-04T12:00:00Z'))
    const { wrapper: onFourth } = await mountReview('/revisao', sources)
    expect(deckButton(onFourth, 'Tudo de hoje').text()).toContain('2 / 3')
  })
})
