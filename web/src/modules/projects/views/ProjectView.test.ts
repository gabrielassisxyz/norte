import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { routes } from '@/router'
import { store } from '@/mock/store'
import ProjectView from './ProjectView.vue'

async function mountProject(id: string, props: Record<string, unknown> = {}) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/projetos/${id}`)
  await router.isReady()
  const wrapper = mount(ProjectView, {
    props: { id, ...props },
    global: { plugins: [router] }
  })
  return { wrapper, router }
}

function resolveName(router: Router, href: string | undefined): string | undefined {
  if (!href) return undefined
  const resolved = router.resolve(href)
  return typeof resolved.name === 'string' ? resolved.name : undefined
}

describe('project view', () => {
  it('renders the project title and every main region', async () => {
    const { wrapper } = await mountProject('project-horta')

    expect(wrapper.find('h1').text()).toBe('Horta da varanda')
    for (const heading of ['Por quê', 'Estado atual', 'Em aberto', 'Decisões', 'Prioridades', 'Bugs', 'Tarefas']) {
      expect(wrapper.text()).toContain(heading)
    }
    expect(wrapper.find('nav.crumb').text()).toContain('Casa')
    // This project's own feature renders with its own status label.
    expect(wrapper.find('.feature-row').text()).toContain('Parcial')
  })

  it('shows a not-found message for an unknown id', async () => {
    const { wrapper, router } = await mountProject('project-that-does-not-exist')

    expect(wrapper.text()).toContain('Projeto não encontrado')
    const back = wrapper.find('.missing-link')
    expect(resolveName(router, back.attributes('href'))).toBe('projetos')
  })

  it('filters tasks as labelled', async () => {
    const { wrapper } = await mountProject('project-horta')
    const visibleTitles = () => wrapper.findAll('.task-title').map((row) => row.text())

    // Horta has one P2 and one P3 task, both open.
    expect(visibleTitles()).toHaveLength(2)
    await wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes('P1'))!.trigger('click')
    expect(visibleTitles()).toHaveLength(0)
    expect(wrapper.text()).toContain('Nenhuma tarefa aqui.')
    await wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes('Todas'))!.trigger('click')
    expect(visibleTitles()).toHaveLength(2)
  })

  it('reveals completed tasks only under Todas', async () => {
    const { wrapper } = await mountProject('project-despensa')

    expect(wrapper.findAll('.task-title')).toHaveLength(0)
    await wrapper.findAll('.nt-seg-btn').find((button) => button.text().includes('Todas'))!.trigger('click')
    const titles = wrapper.findAll('.task-title').map((row) => row.text())
    expect(titles).toHaveLength(1)
    expect(titles[0]).toContain('Revisar lista de reposição')
  })

  it('collapses and expands individual tasks', async () => {
    const { wrapper } = await mountProject('project-horta')
    const first = wrapper.findAll('.task')[0]

    expect(first.attributes('aria-expanded')).toBe('false')
    expect(wrapper.findAll('.task-body')).toHaveLength(0)
    await first.trigger('click')
    expect(first.attributes('aria-expanded')).toBe('true')
    expect(wrapper.findAll('.task-body')).toHaveLength(1)
    expect(wrapper.find('.task-body').text()).toContain('passos')
    await first.trigger('click')
    expect(wrapper.findAll('.task-body')).toHaveLength(0)
  })

  it('expands every task when tasksExpanded is set', async () => {
    const { wrapper } = await mountProject('project-horta', { tasksExpanded: true })

    expect(wrapper.findAll('.task-body')).toHaveLength(2)
  })

  it('routes task rows, decisions and the area to their screens', async () => {
    const { wrapper, router } = await mountProject('project-servidor-caseiro')

    for (const link of wrapper.findAll('.task-open')) {
      expect(resolveName(router, link.attributes('href'))).toBe('tarefa')
    }
    expect(wrapper.findAll('.task-open')).not.toHaveLength(0)
    for (const link of wrapper.findAll('.decision-title')) {
      expect(resolveName(router, link.attributes('href'))).toBe('decisao')
    }
    expect(wrapper.findAll('.decision-title')).not.toHaveLength(0)
    const area = wrapper.find('nav.crumb').findAll('a')[1]
    expect(area.text()).toBe('Tecnologia')
    expect(router.resolve(area.attributes('href')!).params.id).toBe('a-tecnologia')
    expect(resolveName(router, area.attributes('href'))).toBe('area')
  })

  it('registers a session only after the required fields are filled', async () => {
    const { wrapper } = await mountProject('project-servidor-caseiro')
    const before = store.sessions.filter((session) => session.projectId === 'project-servidor-caseiro').length

    await wrapper.findAll('.project-actions button').find((button) => button.text() === 'Registrar sessão')!.trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.exists()).toBe(true)
    const save = dialog.findAll('button').find((button) => button.text() === 'Registrar')!
    expect(save.attributes('disabled')).toBeDefined()

    await dialog.find('input[placeholder="Uma linha"]').setValue('Verifiquei os cabos do armário')
    expect(save.attributes('disabled')).toBeDefined()
    await dialog.find('input[placeholder="A primeira coisa da próxima sessão"]').setValue('Trocar o cabo reserva')
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(store.sessions.filter((session) => session.projectId === 'project-servidor-caseiro')).toHaveLength(before + 1)
    expect(store.sessions[0].summary).toContain('Trocar o cabo reserva')
    expect(wrapper.find('.project-now').text()).toContain('Verifiquei os cabos do armário')
    expect(wrapper.find('.project-next').text()).toContain('Trocar o cabo reserva')
  })

  it('creates a task only after the required fields are filled', async () => {
    const { wrapper } = await mountProject('project-servidor-caseiro')
    const title = 'Calibrar a antena do sótão'
    const before = store.tasks.filter((task) => task.projectId === 'project-servidor-caseiro').length

    await wrapper.findAll('.project-actions button').find((button) => button.text() === 'Nova tarefa')!.trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    const save = dialog.findAll('button').find((button) => button.text() === 'Criar tarefa')!
    expect(save.attributes('disabled')).toBeDefined()

    await dialog.find('input[placeholder="Começa com verbo"]').setValue(title)
    await dialog.find('textarea[placeholder="O que esta tarefa resolve e por que agora"]').setValue('O sinal cai quando chove.')
    await dialog.find('input[placeholder="Um teste observável"]').setValue('O sinal fica estável numa tarde de chuva.')
    expect(save.attributes('disabled')).toBeUndefined()
    await dialog.findAll('.dlg-pick-btn').find((button) => button.text() === 'P1')!.trigger('click')
    await dialog.findAll('.dlg-pick-btn').find((button) => button.text() === 'Hoje')!.trigger('click')
    await save.trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    const created = store.tasks.find((task) => task.title === title)
    expect(created).toMatchObject({ projectId: 'project-servidor-caseiro', priority: 'P1', bucket: 'today' })
    expect(store.tasks.filter((task) => task.projectId === 'project-servidor-caseiro')).toHaveLength(before + 1)
    const rows = wrapper.findAll('.task-title').map((row) => row.text())
    expect(rows.some((row) => row.includes(title))).toBe(true)
  })
})
