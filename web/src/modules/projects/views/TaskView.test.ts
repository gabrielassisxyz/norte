import { mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { createMockStore, type MockStore } from '@/mock/store'
import { routes } from '@/router'
import type { AppSources } from '@/sources'
import { createMockSources } from '@/sources/mock'
import { flushReads, sourcesPlugin } from '@/sources/testing'

import type { TaskDetail } from '../data/source'
import ProjectView from './ProjectView.vue'
import TaskView from './TaskView.vue'

/** The day the mock data is built against, so a date on screen is a known date. */
const TODAY = '2026-10-03'

let store: MockStore

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date(`${TODAY}T12:00:00Z`))
  store = createMockStore()
})

async function mountTask(id: string, sources: Partial<AppSources>): Promise<{ wrapper: VueWrapper; router: Router }> {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(`/tarefas/${id}`)
  await router.isReady()
  const wrapper = mount(TaskView, { props: { id }, global: { plugins: [router, sourcesPlugin(sources)] } })
  await flushReads()
  return { wrapper, router }
}

function resolveName(router: Router, href: string | undefined): string | undefined {
  if (!href) return undefined
  const resolved = router.resolve(href)
  return typeof resolved.name === 'string' ? resolved.name : undefined
}

/** The task detail the mock source would answer with, for one id. */
async function detailOf(id: string): Promise<TaskDetail> {
  const detail = await createMockSources(store).projects.getTask(id, new AbortController().signal)
  if (!detail) throw new Error(`The mock store holds no task ${id}`)
  return detail
}

function projectsWith(detail: TaskDetail | null, overrides: Partial<AppSources['projects']> = {}): Partial<AppSources> {
  return {
    projects: {
      getTask: async () => detail,
      ...overrides
    } as unknown as AppSources['projects']
  }
}

describe('task view over the mock source', () => {
  it('renders the task title and every main region', async () => {
    const { wrapper } = await mountTask('task-backup', createMockSources(store))

    expect(wrapper.find('h1').text()).toBe('Definir destinos de cópia')
    for (const heading of ['O que fazer', 'Contexto', 'Sessões nesta tarefa']) {
      expect(wrapper.text()).toContain(heading)
    }
    expect(wrapper.find('.task-strip').text()).toContain('Em andamento')
    expect(wrapper.findAll('.step')).toHaveLength(2)
    expect(wrapper.text()).toContain('Mover para')
    expect(wrapper.find('nav.crumb').text()).toContain('Servidor caseiro')
  })

  it('ticks steps through its source', async () => {
    const { wrapper } = await mountTask('task-backup', createMockSources(store))
    const step = () => store.tasks.find((task) => task.id === 'task-backup')!.steps[1]

    expect(step().completed).toBe(false)
    await wrapper.findAll('.step')[1].trigger('click')
    await flushReads()
    expect(step().completed).toBe(true)
    expect(wrapper.findAll('.step')[1].classes()).toContain('is-done')

    await wrapper.findAll('.step')[1].trigger('click')
    await flushReads()
    expect(step().completed).toBe(false)
  })

  it('flips Marcar como feita to Reabrir and back through its source', async () => {
    const { wrapper } = await mountTask('task-dns', createMockSources(store))
    const done = () => store.tasks.find((task) => task.id === 'task-dns')!.completed
    const doneButton = () =>
      wrapper
        .findAll('.task-actions button')
        .find((button) => button.text().includes('feita') || button.text().includes('Reabrir'))!

    expect(done()).toBe(false)
    expect(doneButton().text()).toBe('Marcar como feita')
    await doneButton().trigger('click')
    await flushReads()
    expect(done()).toBe(true)
    expect(doneButton().text()).toBe('Reabrir tarefa')
    expect(wrapper.find('.task-strip').text()).toContain('Concluída')

    await doneButton().trigger('click')
    await flushReads()
    expect(done()).toBe(false)
    expect(doneButton().text()).toBe('Marcar como feita')
  })

  it('persists bucket changes and the project list shows the new bucket', async () => {
    const sources = createMockSources(store)
    const { wrapper } = await mountTask('task-sementes', sources)
    const bucket = () => store.tasks.find((task) => task.id === 'task-sementes')!.bucket
    const bucketTag = (label: string) =>
      wrapper.findAll('.bucket-row .nt-tag').find((tag) => tag.text().includes(label))!

    expect(bucket()).toBe('today')
    await bucketTag('Esta semana').trigger('click')
    await flushReads()
    expect(bucket()).toBe('next')

    const router = createRouter({ history: createMemoryHistory(), routes })
    await router.push('/projetos/project-horta')
    await router.isReady()
    const project = mount(ProjectView, {
      props: { id: 'project-horta', tasksExpanded: true },
      global: { plugins: [router, sourcesPlugin(sources)] }
    })
    await flushReads()
    const row = project.findAll('.task').find((task) => task.text().includes('Separar sementes de folhas'))!
    expect(row.text()).toContain('A seguir')

    await bucketTag('Hoje').trigger('click')
    await flushReads()
    expect(bucket()).toBe('today')
  })

  it('edits the title and description through its source', async () => {
    const { wrapper } = await mountTask('task-vasos', createMockSources(store))
    const edited = 'Reutilizar vasos disponíveis (revisto)'

    await wrapper.find('.ghost').trigger('click')
    await wrapper.findAll('.task-edit .nt-input')[0].setValue(edited)
    await wrapper.findAll('.task-edit .nt-input')[1].setValue('Limpar e etiquetar os vasos.')
    await wrapper.findAll('.task-edit-actions button').find((button) => button.text() === 'Salvar')!.trigger('click')
    await flushReads()

    expect(store.tasks.find((task) => task.id === 'task-vasos')!.title).toBe(edited)
    expect(wrapper.find('h1').text()).toBe(edited)
  })

  it('registers a session only after the required fields are filled', async () => {
    const { wrapper } = await mountTask('task-backup', createMockSources(store))
    const before = store.sessions.filter((session) => session.taskId === 'task-backup').length

    await wrapper
      .findAll('.task-actions button')
      .find((button) => button.text() === 'Registrar sessão')!
      .trigger('click')
    const dialog = wrapper.find('[role="dialog"]')
    expect(dialog.text()).toContain('Registrar sessão')
    const save = dialog.findAll('button').find((button) => button.text() === 'Registrar')!
    expect(save.attributes('disabled')).toBeDefined()

    await dialog.find('input[placeholder="Uma linha"]').setValue('Liste os arquivos por tamanho')
    expect(save.attributes('disabled')).toBeDefined()
    await dialog.find('input[placeholder="A primeira coisa da próxima sessão"]').setValue('Escolher o segundo destino')
    expect(save.attributes('disabled')).toBeUndefined()
    await save.trigger('click')
    await flushReads()

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(store.sessions.filter((session) => session.taskId === 'task-backup')).toHaveLength(before + 1)
    expect(store.sessions[0]).toMatchObject({ projectId: 'project-servidor-caseiro', taskId: 'task-backup' })
    expect(store.sessions[0].summary).toContain('Escolher o segundo destino')
    expect(wrapper.text()).toContain('Liste os arquivos por tamanho')
  })

  it('routes the project, the blocking decision and the sibling tasks to their screens', async () => {
    const { wrapper, router } = await mountTask('task-backup', createMockSources(store))

    const projectLink = wrapper.find('.meta .meta-link')
    expect(resolveName(router, projectLink.attributes('href'))).toBe('projeto')
    expect(router.resolve(projectLink.attributes('href')!).params.id).toBe('project-servidor-caseiro')

    const decisionLinks = wrapper.findAll('.meta-blocker')
    expect(decisionLinks).not.toHaveLength(0)
    for (const link of decisionLinks) {
      expect(resolveName(router, link.attributes('href'))).toBe('decisao')
    }
    expect(router.resolve(decisionLinks[0].attributes('href')!).params.id).toBe('decision-backup-media')

    expect(resolveName(router, wrapper.findAll('.refs .ref')[1].attributes('href'))).toBe('decisao')

    const siblings = wrapper.findAll('.sibling')
    expect(siblings).not.toHaveLength(0)
    for (const sibling of siblings) {
      expect(resolveName(router, sibling.attributes('href'))).toBe('tarefa')
    }
  })
})

describe('task view while it waits, is missing, or fails', () => {
  it('says it is loading before the task answers', async () => {
    const { wrapper } = await mountTask('task-backup', projectsWith(null, { getTask: () => new Promise(() => {}) }))

    expect(wrapper.get('[role="status"]').text()).toBe('Carregando a tarefa…')
    expect(wrapper.find('.step').exists()).toBe(false)
  })

  it('shows a not-found message for an unknown id', async () => {
    const { wrapper, router } = await mountTask('task-that-does-not-exist', createMockSources(store))

    expect(wrapper.text()).toContain('Tarefa não encontrada')
    expect(resolveName(router, wrapper.find('.missing-link').attributes('href'))).toBe('projetos')
  })

  it('says why the task could not be read, and reads again when asked', async () => {
    const detail = await detailOf('task-backup')
    let attempts = 0
    const { wrapper } = await mountTask(
      'task-backup',
      projectsWith(detail, {
        getTask: async () => {
          attempts += 1
          if (attempts === 1) throw new Error('rede fora do ar')
          return detail
        }
      })
    )

    expect(wrapper.get('[role="alert"]').text()).toContain('Não foi possível carregar a tarefa: rede fora do ar')

    await wrapper.findAll('button').find((button) => button.text() === 'Tentar de novo')!.trigger('click')
    await flushReads()

    expect(wrapper.find('h1').text()).toBe('Definir destinos de cópia')
  })
})

describe('task view writing to its source', () => {
  it('leaves the step as it was and says so when the tick fails', async () => {
    const detail = await detailOf('task-backup')
    const { wrapper } = await mountTask(
      'task-backup',
      projectsWith(detail, {
        toggleTaskStep: async () => {
          throw new Error('tarefa removida')
        }
      })
    )

    await wrapper.findAll('.step')[1].trigger('click')
    await flushReads()

    expect(wrapper.get('.task-write-error').text()).toContain('Não foi possível salvar: tarefa removida')
    expect(wrapper.findAll('.step')[1].classes()).not.toContain('is-done')
  })

  it('shows the task the source answered with, not the one it was sent', async () => {
    const detail = await detailOf('task-vasos')
    const { wrapper } = await mountTask(
      'task-vasos',
      projectsWith(detail, {
        updateTask: async () => ({ ...detail.task, title: 'Vasos, como a fonte os nomeou' })
      })
    )

    await wrapper.find('.ghost').trigger('click')
    await wrapper.findAll('.task-edit .nt-input')[0].setValue('O título que eu digitei')
    await wrapper.findAll('.task-edit .nt-input')[1].setValue('Limpar e etiquetar os vasos.')
    await wrapper.findAll('.task-edit-actions button').find((button) => button.text() === 'Salvar')!.trigger('click')
    await flushReads()

    expect(wrapper.find('h1').text()).toBe('Vasos, como a fonte os nomeou')
  })
})
