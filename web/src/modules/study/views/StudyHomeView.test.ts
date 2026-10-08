import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { setClockTimeZone } from '@/lib/clock'
import { createMockStore, type MockStore } from '@/mock/store'
import router from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { StudyHomePage, StudySource } from '../data/source'
import StudyHomeView from './StudyHomeView.vue'
import { completedThisMonth, currentStreak, hoursInWindow } from './studyDays'

const TODAY = '2026-10-03'

let store: MockStore

async function mountStudy(sources?: Partial<AppSources>) {
  await router.push('/estudo')
  await router.isReady()
  const wrapper = mount(StudyHomeView, {
    global: { plugins: [router, sourcesPlugin(sources ?? createMockSources(store))] }
  })
  await flushReads()
  return wrapper
}

function studyWith(overrides: Partial<StudySource>): Partial<AppSources> {
  const empty: StudyHomePage = {
    items: [],
    next_cursor: null,
    counts: { curricula: 0, modules: 0, subjects: 0 },
    subjects: [],
    studyDays: [],
    focus: 'Foco da semana.'
  }
  return {
    study: {
      studyHome: async () => empty,
      getCurriculum: async () => null,
      materialContext: async () => null,
      summary: async () => ({ counts: empty.counts, curricula: [] }),
      ...overrides
    } as unknown as AppSources['study'],
    review: { summary: async () => ({ cards: 0, due: 0, decks: 0 }) } as unknown as AppSources['review']
  }
}

function expectedTitle(): string {
  const text = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  return text.replace(/^./, (letter) => letter.toLocaleUpperCase('pt-BR'))
}

describe('StudyHomeView', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
    store = createMockStore()
    await router.push('/estudo')
  })

  afterEach(() => {
    vi.useRealTimers()
    setClockTimeZone('UTC')
  })

  it('renders its title and main regions from mock data', async () => {
    const wrapper = await mountStudy()

    expect(wrapper.get('h1').text()).toBe(expectedTitle())
    expect(wrapper.get('#study-curricula').text()).toBe('Currículos')
    expect(wrapper.get('#study-subjects').text()).toBe('Assuntos')
    expect(wrapper.find('section[aria-label="Streak e estatísticas"]').exists()).toBe(true)

    expect(wrapper.findAll('.nt-stat')).toHaveLength(4)
    expect(wrapper.findAll('.nt-streak-grid .nt-streak-cell')).toHaveLength(store.studyDays.length)
    expect(wrapper.findAll('.nt-carousel-item')).toHaveLength(store.curricula.length)
    expect(wrapper.findAll('.study-grid .nt-cover-card')).toHaveLength(store.subjects.length)

    const stats = wrapper.findAll('.nt-stat')
    expect(stats[0].text()).toContain(String(currentStreak(store.studyDays)))
    expect(stats[0].text()).toContain('Streak atual')
    expect(stats[2].text()).toContain('Para revisar hoje')
    expect(stats[3].text()).toContain(`Concluídos em`)
    expect(stats[3].text()).toContain(String(completedThisMonth(store.studyDays).total))
    expect(wrapper.find('.study-review').text()).toContain(
      String(store.reviewCards.filter((card) => card.dueAt <= TODAY).length)
    )
    expect(hoursInWindow(store.studyDays)).toBeGreaterThan(0)
  })

  it('steps the curriculum carousel by two and disables arrows at the ends', async () => {
    const wrapper = await mountStudy()

    const prev = wrapper.get('.nt-carousel-btn.is-prev')
    const next = wrapper.get('.nt-carousel-btn.is-next')
    expect(prev.attributes('disabled')).toBeDefined()
    expect(next.attributes('disabled')).toBeUndefined()
    expect(wrapper.find('.nt-carousel-item .nt-cover-card').attributes('href')).toBe(
      '/curriculos/fundamentos-de-compiladores'
    )

    await next.trigger('click')
    expect(wrapper.get('.nt-carousel-btn.is-prev').attributes('disabled')).toBeUndefined()

    await next.trigger('click')
    await next.trigger('click')
    expect(wrapper.get('.nt-carousel-btn.is-next').attributes('disabled')).toBeDefined()

    await wrapper.get('.nt-carousel-btn.is-prev').trigger('click')
    expect(wrapper.get('.nt-carousel-btn.is-next').attributes('disabled')).toBeUndefined()
  })

  it('switches subjects between Capas and Tabela with the same six subjects', async () => {
    const wrapper = await mountStudy()
    const names = store.subjects.map((subject) => subject.name)

    expect(wrapper.find('[role="table"]').exists()).toBe(false)
    const coverNames = wrapper.findAll('.study-grid .nt-cover-card').map((card) => card.text())
    for (const name of names) {
      expect(coverNames.some((text) => text.includes(name))).toBe(true)
    }

    await wrapper.get('[role="tab"][aria-selected="false"]').trigger('click')
    const rows = wrapper.findAll('[role="table"] [role="row"]')
    expect(rows).toHaveLength(store.subjects.length + 1)
    const rowNames = wrapper.findAll('.study-row-link').map((link) => link.text())
    expect(rowNames).toEqual(names)
    expect(wrapper.find('.study-grid').exists()).toBe(false)

    await wrapper.get('[role="tablist"] [role="tab"]:first-child').trigger('click')
    expect(wrapper.findAll('.study-grid .nt-cover-card')).toHaveLength(store.subjects.length)
  })

  it('routes subjects, review, and the Adicionar menu to the promised routes', async () => {
    const wrapper = await mountStudy()

    expect(wrapper.get('.study-review').attributes('href')).toBe('/revisao')
    expect(wrapper.get('.study-grid .nt-cover-card').attributes('href')).toBe('/biblioteca?v=tudo')
    expect(wrapper.get('#study-search').attributes('placeholder')).toBe('Buscar cursos, notas, perguntas…')

    await wrapper.get('.study-add button').trigger('click')
    const items = wrapper.findAll('[role="menuitem"]')
    // Writing a question is not offered: the notes module reads the API and
    // this screen still reads the mock, so the id a question would be stored
    // against is one neither side could resolve. The entry comes back when
    // study moves to the API.
    expect(items.map((item) => item.attributes('href'))).toEqual(['/curriculos/nova', '/?save=1'])

    await wrapper.get('[role="tablist"] [role="tab"]:last-child').trigger('click')
    expect(wrapper.get('.study-row-link').attributes('href')).toBe('/biblioteca?v=tudo')
  })

  it('says it is loading before the study home answers', async () => {
    await router.push('/estudo')
    await router.isReady()
    const wrapper = mount(StudyHomeView, {
      global: {
        plugins: [router, sourcesPlugin(studyWith({ studyHome: () => new Promise<StudyHomePage>(() => {}) }))]
      }
    })

    expect(wrapper.get('[role="status"]').text()).toBe('Carregando o estudo…')
    expect(wrapper.find('.nt-stat').exists()).toBe(false)
  })

  it('says each band is empty once the read answers with nothing', async () => {
    const wrapper = await mountStudy(studyWith({}))

    expect(wrapper.text()).toContain('Nenhum currículo ainda')
    expect(wrapper.text()).toContain('Nenhum assunto ainda')
    expect(wrapper.find('.nt-carousel-item').exists()).toBe(false)
  })

  it('says why the study home could not be read, and reads again when asked', async () => {
    let attempts = 0
    const wrapper = await mountStudy(
      studyWith({
        studyHome: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rede indisponível')
          return {
            items: [],
            next_cursor: null,
            counts: { curricula: 0, modules: 0, subjects: 0 },
            subjects: [],
            studyDays: [],
            focus: 'Foco da semana.'
          }
        }
      })
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível carregar o estudo: rede indisponível')

    await wrapper.get('[role="alert"] button').trigger('click')
    await flushReads()

    expect(wrapper.find('[role="alert"]').exists()).toBe(false)
    expect(wrapper.text()).toContain('Nenhum currículo ainda')
  })

  it('titles the day in the configured zone, not the browser\'s', async () => {
    // 23:30 in São Paulo is already the next day in UTC.
    vi.setSystemTime(new Date('2026-10-04T02:30:00Z'))

    setClockTimeZone('America/Sao_Paulo')
    expect((await mountStudy()).get('h1').text()).toBe('Sábado, 3 de outubro')

    setClockTimeZone('UTC')
    expect((await mountStudy()).get('h1').text()).toBe('Domingo, 4 de outubro')
  })
})
