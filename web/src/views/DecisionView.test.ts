import { mount } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { beforeEach, describe, expect, it } from 'vitest'

import { routes } from '@/router'
import { createMockStore, store } from '@/mock/store'
import DecisionView from '@/views/DecisionView.vue'

async function mountDecision(id: string, preselect = false) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push({ name: 'decisao', params: { id }, query: preselect ? { preselect: '1' } : undefined })
  await router.isReady()
  const wrapper = mount(DecisionView, {
    props: { id, preselect },
    global: { plugins: [router] }
  })
  return { wrapper, router }
}

function resetStore(): void {
  Object.assign(store, createMockStore())
}

function addDays(value: string, amount: number): string {
  const date = new Date(`${value}T00:00:00Z`)
  date.setUTCDate(date.getUTCDate() + amount)
  return date.toISOString().slice(0, 10)
}

describe('decision view', () => {
  beforeEach(resetStore)

  it('renders the decision title and its main regions', async () => {
    const { wrapper, router } = await mountDecision('decision-backup-media')

    expect(wrapper.find('h1').text()).toBe('Escolher mídia para a cópia externa')
    for (const heading of ['Contexto', 'Opções', 'O que li para decidir', 'Bloqueia']) {
      expect(wrapper.text()).toContain(heading)
    }
    expect(wrapper.findAll('.decision-blocked-task')).not.toHaveLength(0)
    for (const link of wrapper.findAll('.decision-blocked-task')) {
      expect(router.resolve(link.attributes('href')!).name).toBe('tarefa')
    }
    expect(wrapper.findAll('.decision-reference')).not.toHaveLength(0)
  })

  it('keeps Decidir disabled until a choice is complete and persists it', async () => {
    const { wrapper } = await mountDecision('decision-backup-media')
    const decideButton = wrapper.find('.decision-action-primary')

    expect(decideButton.attributes('disabled')).toBeDefined()
    await wrapper.find('[role="radio"]').trigger('click')
    expect(decideButton.attributes('disabled')).toBeUndefined()
    await decideButton.trigger('click')

    expect(wrapper.text()).toContain('Decidida hoje: Disco portátil')
    expect(store.decisions.find((decision) => decision.id === 'decision-backup-media')).toMatchObject({
      status: 'decided',
      selectedOptionId: 'option-drive'
    })
  })

  it('requires reasoning when Outra is selected', async () => {
    const { wrapper } = await mountDecision('decision-budget-period')
    const decideButton = wrapper.find('.decision-action-primary')
    const other = wrapper.findAll('[role="radio"]').at(-1)!

    await other.trigger('click')
    expect(decideButton.attributes('disabled')).toBeDefined()
    await wrapper.find('#decision-reasoning-input').setValue('Acompanhar cada entrada em um ciclo próprio.')
    expect(decideButton.attributes('disabled')).toBeUndefined()
    await decideButton.trigger('click')

    expect(wrapper.text()).toContain('Decidida hoje: Outra')
    expect(store.decisions.find((decision) => decision.id === 'decision-budget-period')).toMatchObject({
      status: 'decided',
      selectedOptionId: 'other',
      reasoning: 'Acompanhar cada entrada em um ciclo próprio.'
    })
  })

  it('adds exactly seven days when postponing', async () => {
    const { wrapper } = await mountDecision('decision-backup-media')
    const decision = store.decisions.find((candidate) => candidate.id === 'decision-backup-media')!
    const currentDue = decision.postponedUntil ?? '2026-10-10'
    const postponeButton = wrapper.findAll('button').find((button) => button.text() === 'Adiar uma semana')!

    await postponeButton.trigger('click')

    expect(decision.postponedUntil).toBe(addDays(currentDue, 7))
  })

  it('preselects the preferred option when requested and supports editing', async () => {
    const { wrapper } = await mountDecision('decision-backup-media', true)

    expect(wrapper.findAll('[role="radio"]')[0].attributes('aria-checked')).toBe('true')
    const editButton = wrapper.findAll('button').find((button) => button.text() === 'Editar')!
    await editButton.trigger('click')
    await wrapper.find('#decision-title').setValue('Escolher mídia de cópia')
    await wrapper.findAll('button').find((button) => button.text() === 'Salvar')!.trigger('click')

    expect(wrapper.find('h1').text()).toBe('Escolher mídia de cópia')
  })
})
