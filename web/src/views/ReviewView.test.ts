import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { routes } from '@/router'
import { store } from '@/mock/store'
import type { CardRating } from '@/mock/types'
import ReviewView from '@/views/ReviewView.vue'

const TODAY = '2026-10-03'

function resetReviewCards(): void {
  for (const card of store.reviewCards) {
    card.dueAt = TODAY
    delete card.lastRating
  }
}

async function mountReview(path = '/revisao') {
  resetReviewCards()
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(ReviewView, { global: { plugins: [router] } })
  return { wrapper, router }
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
    const first = wrapper.get('.nt-card-front').text()

    press(' ')
    await wrapper.vm.$nextTick()
    expect(wrapper.find('.nt-card-back').exists()).toBe(true)

    // Rating keys do nothing while the back is hidden on the next card.
    press('4')
    await wrapper.vm.$nextTick()
    expect(wrapper.get('.nt-card-front').text()).not.toBe(first)
    expect(statValues(wrapper)[1]).toContain('1')

    press('2')
    await wrapper.vm.$nextTick()
    expect(statValues(wrapper)[1]).toContain('1')

    press(' ')
    await wrapper.vm.$nextTick()
    press('2')
    await wrapper.vm.$nextTick()
    expect(statValues(wrapper)[1]).toContain('2')
    expect(store.reviewCards.find((card) => card.id === 'card-comp-2')).toMatchObject({
      lastRating: 'hard'
    })
  })

  it('shows recall as (good + easy) / rated and restarts back to the deck list', async () => {
    const { wrapper, router } = await mountReview()
    const pattern: CardRating[] = ['good', 'easy', 'hard', 'again', 'good', 'easy', 'good', 'easy']

    await deckButton(wrapper, 'Letras e leitura').trigger('click')
    for (const rating of pattern) {
      press(' ')
      await wrapper.vm.$nextTick()
      press(String(['again', 'hard', 'good', 'easy'].indexOf(rating) + 1))
      await wrapper.vm.$nextTick()
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

  it('links the card source and the breadcrumb to their routes', async () => {
    const { wrapper, router } = await mountReview()

    expect(resolveName(router, wrapper.get('.crumb a').attributes('href'))).toBe('estudo')

    await deckButton(wrapper, 'Tudo de hoje').trigger('click')
    const source = wrapper.get('.review-hint a')
    expect(source.attributes('href')).toBe('/material/post/post-compilation')
    expect(resolveName(router, source.attributes('href'))).toBe('material')

    // The sixth card of the all-deck queue is backed by a course, which has no
    // reading screen and falls back to the library like the home screen does.
    for (let done = 0; done < 5; done += 1) {
      press(' ')
      await wrapper.vm.$nextTick()
      press('3')
      await wrapper.vm.$nextTick()
    }
    const fallback = wrapper.get('.review-hint a')
    expect(resolveName(router, fallback.attributes('href'))).toBe('biblioteca')
  })
})
