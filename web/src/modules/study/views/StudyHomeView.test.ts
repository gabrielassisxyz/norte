import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { formatLongWeekdayDate, setClockTimeZone, todayIsoDate } from '@/lib/clock'
import { createMockStore, type MockStore } from '@/mock/store'
import router from '@/router'
import type { AppSources } from '@/sources'
import { fakeCoreSource, subjectRecord } from '@/shell/data/testing'
import { createMockSources } from '@/sources/mock'
import { clearPaletteRequest, paletteRequest } from '@/shell/paletteRequest'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { StudyHomePage, StudySource } from '../data/source'
import StudyHomeView from './StudyHomeView.vue'
import { completedThisMonth, currentStreak, hoursInWindow } from './studyDays'

const TODAY = '2026-10-03'

let store: MockStore

/**
 * The subjects the Estudo home shows are the core's, not the study mock's, so
 * the test seeds them where the screen reads them from. The counts are per
 * item type, which is what the table's columns are derived from.
 */
function coreSubjects() {
  return [
    subjectRecord({
      name: 'Kubernetes',
      counts: { total: 3, by_type: [{ module: 'library', type: 'article', count: 3 }] }
    }),
    subjectRecord({
      name: 'Escrita',
      counts: {
        total: 2,
        by_type: [
          { module: 'library', type: 'course', count: 1 },
          { module: 'library', type: 'article', count: 1 }
        ]
      }
    })
  ]
}

async function mountStudy(sources?: Partial<AppSources>) {
  await router.push('/estudo')
  await router.isReady()
  const wrapper = mount(StudyHomeView, {
    global: {
      plugins: [
        router,
        sourcesPlugin(sources ?? { ...createMockSources(store), core: fakeCoreSource({ subjects: coreSubjects() }) })
      ]
    }
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
    review: { summary: async () => ({ cards: 0, due: 0, decks: 0 }) } as unknown as AppSources['review'],
    // The core is always on, so an empty one is the right stand-in: a screen
    // reaching for subjects must get an answer, not a refusal.
    core: fakeCoreSource()
  }
}

/**
 * The title the screen should print, read from the helper that prints it.
 *
 * It used to re-implement the format with its own locale literal, which meant
 * two places decided what a long date looks like and this one silently went
 * stale whenever `formatLongWeekdayDate` moved. The format itself is pinned by
 * `web/src/lib/clock.test.ts`; what this file is about is that the screen's h1
 * is that date at all.
 */
function expectedTitle(): string {
  return formatLongWeekdayDate(todayIsoDate())
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
    clearPaletteRequest()
    setClockTimeZone('UTC')
  })

  it('hands its search box over to the command palette instead of losing what was typed', async () => {
    const wrapper = await mountStudy()
    const search = wrapper.get('#study-search')

    await search.setValue('memória')

    // The box was an input bound to nothing at all before this: it took what
    // was typed and dropped it. There is one search in Norte, and it is the
    // palette's.
    expect(paletteRequest().value?.query).toBe('memória')
    expect((search.element as HTMLInputElement).value).toBe('')
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
    expect(wrapper.findAll('.study-grid .nt-cover-card')).toHaveLength(coreSubjects().length)

    const stats = wrapper.findAll('.nt-stat')
    expect(stats[0].text()).toContain(String(currentStreak(store.studyDays)))
    expect(stats[0].text()).toContain('Streak atual')
    // The hours are rendered through a locale, and the locale decides the
    // separator: 1.5 in English, 1,5 in Portuguese. A number is not copy, so
    // this is a value assertion and not a label one -- and it is what catches
    // a locale literal left behind in a file the model owns.
    expect(stats[1].text()).toMatch(/\d\.\d\s*h/)
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

  it('switches subjects between Capas and Tabela with the same subjects', async () => {
    const wrapper = await mountStudy()
    // The list comes back ordered by slug, which is the order the server
    // answers in and so the order the rows are in.
    const names = ['Escrita', 'Kubernetes']

    expect(wrapper.find('[role="table"]').exists()).toBe(false)
    const coverNames = wrapper.findAll('.study-grid .nt-cover-card').map((card) => card.text())
    for (const name of names) {
      expect(coverNames.some((text) => text.includes(name))).toBe(true)
    }

    await wrapper.get('[role="tab"][aria-selected="false"]').trigger('click')
    const rows = wrapper.findAll('[role="table"] [role="row"]')
    expect(rows).toHaveLength(names.length + 1)
    const rowNames = wrapper.findAll('.study-row-link').map((link) => link.text())
    expect(rowNames).toEqual(names)
    expect(wrapper.find('.study-grid').exists()).toBe(false)

    // The columns are the item types the subjects actually have something of,
    // because the core does not enumerate any module's types.
    const headers = wrapper.findAll('[role="columnheader"]').map((cell) => cell.text())
    expect(headers).toEqual(['Assunto', 'article', 'course', 'Itens'])
    expect(rows[1]!.text()).toContain('Escrita')

    await wrapper.get('[role="tablist"] [role="tab"]:first-child').trigger('click')
    expect(wrapper.findAll('.study-grid .nt-cover-card')).toHaveLength(names.length)
  })

  it('routes subjects, review, and the Adicionar menu to the promised routes', async () => {
    const wrapper = await mountStudy()

    expect(wrapper.get('.study-review').attributes('href')).toBe('/revisao')
    // A subject opens its own page, not the whole library.
    expect(wrapper.get('.study-grid .nt-cover-card').attributes('href')).toBe('/subjects/escrita')
    expect(wrapper.get('#study-search').attributes('placeholder')).toBe('Buscar cursos, notas, perguntas…')

    await wrapper.get('.study-add button').trigger('click')
    const items = wrapper.findAll('[role="menuitem"]')
    // Writing a question is not offered: the notes module reads the API and
    // this screen still reads the mock, so the id a question would be stored
    // against is one neither side could resolve. The entry comes back when
    // study moves to the API.
    expect(items.map((item) => item.attributes('href'))).toEqual(['/curriculos/nova', '/?save=1'])

    await wrapper.get('[role="tablist"] [role="tab"]:last-child').trigger('click')
    expect(wrapper.get('.study-row-link').attributes('href')).toBe('/subjects/escrita')
  })

  it('creates a subject from the grid and opens its page', async () => {
    // The route this ends on loads its screen through a dynamic import, which
    // settles on the event loop rather than on the microtask queue a flush
    // drains -- and the clock is faked for the rest of this file, so nothing
    // would ever move that loop on. Nothing in this case reads the frozen day.
    vi.useRealTimers()
    const core = fakeCoreSource({ subjects: coreSubjects() })
    const wrapper = await mountStudy({ ...createMockSources(store), core })

    await wrapper.get('.study-section-titles button').trigger('click')
    const dialog = wrapper.get('[role="dialog"]')
    expect(dialog.text()).toContain('Novo assunto')

    await dialog.get('input').setValue('Observabilidade')
    // jsdom does not turn a click on a submit button into a submit event, so
    // the event is raised where the dialog handles it.
    await dialog.trigger('submit')
    await flushReads()

    expect(core.calls.createSubject).toEqual(['Observabilidade'])
    await vi.waitUntil(() => router.currentRoute.value.name === 'subject')
    expect(router.currentRoute.value.fullPath).toBe('/subjects/observabilidade')
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
