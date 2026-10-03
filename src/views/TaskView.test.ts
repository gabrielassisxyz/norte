import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'

import { routes } from '@/router'
import { store } from '@/mock/store'
import ProjectView from '@/views/ProjectView.vue'
import TaskView from '@/views/TaskView.vue'

async function mountTask(id: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/tarefas/${id}`)
  await router.isReady()
  const wrapper = mount(TaskView, {
    props: { id },
    global: { plugins: [router] }
  })
  return { wrapper, router }
}

function resolveName(router: Router, href: string | undefined): string | undefined {
  if (!href) return undefined
  const resolved = router.resolve(href)
  return typeof resolved.name === 'string' ? resolved.name : undefined
}

describe('task view', () => {
  it('renders the task title and every main region', async () => {
    const { wrapper } = await mountTask('task-backup')

    expect(wrapper.find('h1').text()).toBe('Definir destinos de cópia')
    for (const heading of ['O que fazer', 'Contexto', 'Sessões nesta tarefa']) {
      expect(wrapper.text()).toContain(heading)
    }
    expect(wrapper.find('.task-strip').text()).toContain('Em andamento')
    expect(wrapper.findAll('.step')).toHaveLength(2)
    expect(wrapper.text()).toContain('Mover para')
    expect(wrapper.find('nav.crumb').text()).toContain('Servidor caseiro')
  })

  it('shows a not-found message for an unknown id', async () => {
    const { wrapper, router } = await mountTask('task-that-does-not-exist')

    expect(wrapper.text()).toContain('Tarefa não encontrada')
    const back = wrapper.find('.missing-link')
    expect(resolveName(router, back.attributes('href'))).toBe('projetos')
  })

  it('ticks steps through the mock store', async () => {
    const { wrapper } = await mountTask('task-backup')
    const step = () => store.tasks.find((task) => task.id === 'task-backup')!.steps[1]

    expect(step().completed).toBe(false)
    await wrapper.findAll('.step')[1].trigger('click')
    expect(step().completed).toBe(true)
    expect(wrapper.findAll('.step')[1].classes()).toContain('is-done')
    await wrapper.findAll('.step')[1].trigger('click')
    expect(step().completed).toBe(false)
  })

  it('flips Marcar como feita to Reabrir and back through the mock store', async () => {
    const { wrapper } = await mountTask('task-dns')
    const done = () => store.tasks.find((task) => task.id === 'task-dns')!.completed
    const doneButton = () =>
      wrapper.findAll('.task-actions button').find((button) => button.text().includes('feita') || button.text().includes('Reabrir'))!

    expect(done()).toBe(false)
    expect(doneButton().text()).toBe('Marcar como feita')
    await doneButton().trigger('click')
    expect(done()).toBe(true)
    expect(doneButton().text()).toBe('Reabrir tarefa')
    expect(wrapper.find('.task-strip').text()).toContain('Concluída')
    await doneButton().trigger('click')
    expect(done()).toBe(false)
    expect(doneButton().text()).toBe('Marcar como feita')
  })

  it('persists bucket changes and the project list shows the new bucket', async () => {
    const { wrapper } = await mountTask('task-sementes')
    const bucket = () => store.tasks.find((task) => task.id === 'task-sementes')!.bucket

    expect(bucket()).toBe('today')
    const bucketTag = (label: string) =>
      wrapper.findAll('.bucket-row .nt-tag').find((tag) => tag.text().includes(label))!
    await bucketTag('Esta semana').trigger('click')
    expect(bucket()).toBe('next')

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/projetos/project-horta')
    await router.isReady()
    const project = mount(ProjectView, {
      props: { id: 'project-horta', tasksExpanded: true },
      global: { plugins: [router] }
    })
    const row = project.findAll('.task').find((task) => task.text().includes('Separar sementes de folhas'))!
    expect(row.text()).toContain('A seguir')

    await bucketTag('Hoje').trigger('click')
    expect(bucket()).toBe('today')
  })

  it('edits the title and description through the mock store', async () => {
    const { wrapper } = await mountTask('task-vasos')
    const edited = 'Reutilizar vasos disponíveis (revisto)'
    const original = store.tasks.find((task) => task.id === 'task-vasos')!

    await wrapper.find('.ghost').trigger('click')
    await wrapper.findAll('.task-edit .nt-input')[0].setValue(edited)
    await wrapper.findAll('.task-edit .nt-input')[1].setValue('Limpar e etiquetar os vasos.')
    await wrapper.findAll('.task-edit-actions button').find((button) => button.text() === 'Salvar')!.trigger('click')

    expect(original.title).toBe(edited)
    expect(wrapper.find('h1').text()).toBe(edited)

    store.updateTask('task-vasos', { title: 'Reutilizar vasos disponíveis', description: original.description })
  })

  it('registers a session only after the required fields are filled', async () => {
    const { wrapper } = await mountTask('task-backup')
    const before = store.sessions.filter((session) => session.taskId === 'task-backup').length

    await wrapper.findAll('.task-actions button').find((button) => button.text() === 'Registrar sessão')!.trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.text()).toContain('Registrar sessão')
    const save = dialog.findAll('button').find((button) => button.text() === 'Registrar')!
    expect(save.attributes('disabled')).toBeDefined()

    await dialog.find('input[placeholder="Uma linha"]').setValue('Liste os arquivos por tamanho')
    expect(save.attributes('disabled')).toBeDefined()
    await dialog.find('input[placeholder="A primeira coisa da próxima sessão"]').setValue('Escolher o segundo destino')
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(store.sessions.filter((session) => session.taskId === 'task-backup')).toHaveLength(before + 1)
    expect(store.sessions[0]).toMatchObject({ projectId: 'project-servidor-caseiro', taskId: 'task-backup' })
    expect(store.sessions[0].summary).toContain('Escolher o segundo destino')
    expect(wrapper.text()).toContain('Liste os arquivos por tamanho')
  })

  it('routes the project, the blocking decision and the sibling tasks to their screens', async () => {
    const { wrapper, router } = await mountTask('task-backup')

    const projectLink = wrapper.find('.meta .meta-link')
    expect(resolveName(router, projectLink.attributes('href'))).toBe('projeto')
    expect(router.resolve(projectLink.attributes('href')!).params.id).toBe('project-servidor-caseiro')

    const decisionLinks = wrapper.findAll('.meta-blocker')
    expect(decisionLinks).not.toHaveLength(0)
    for (const link of decisionLinks) {
      expect(resolveName(router, link.attributes('href'))).toBe('decisao')
    }
    expect(router.resolve(decisionLinks[0].attributes('href')!).params.id).toBe('decision-backup-media')

    const contextDecision = wrapper.findAll('.refs .ref')[1]
    expect(resolveName(router, contextDecision.attributes('href'))).toBe('decisao')

    const siblings = wrapper.findAll('.sibling')
    expect(siblings).not.toHaveLength(0)
    for (const sibling of siblings) {
      expect(resolveName(router, sibling.attributes('href'))).toBe('tarefa')
    }
  })
})
