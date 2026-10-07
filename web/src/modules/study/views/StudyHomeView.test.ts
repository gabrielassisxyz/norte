import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import { todayIsoDate } from '@/lib/clock'
import router from '@/router'
import { store } from '@/mock/store'
import { completedThisMonth, currentStreak, hoursInWindow } from '@/modules/study/mock/study'

import StudyHomeView from './StudyHomeView.vue'

async function mountStudy() {
  await router.push('/estudo')
  await router.isReady()
  return mount(StudyHomeView, { global: { plugins: [router] } })
}

function expectedTitle(): string {
  const text = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())
  return text.replace(/^./, (letter) => letter.toLocaleUpperCase('pt-BR'))
}

describe('StudyHomeView', () => {
  beforeEach(async () => {
    await router.push('/estudo')
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
      String(store.reviewCards.filter((card) => card.dueAt <= todayIsoDate()).length)
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
    expect(items.map((item) => item.attributes('href'))).toEqual([
      '/curriculos/nova',
      '/?save=1',
      '/notas?tab=perguntas'
    ])

    await wrapper.get('[role="tablist"] [role="tab"]:last-child').trigger('click')
    expect(wrapper.get('.study-row-link').attributes('href')).toBe('/biblioteca?v=tudo')
  })
})
