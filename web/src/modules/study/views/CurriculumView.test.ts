import { flushPromises, mount, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it } from 'vitest'

import App from '@/App.vue'
import { store } from '@/mock/store'
import { routes } from '@/router'

async function mountAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [router] } })
  await wrapper.vm.$nextTick()
  return { wrapper, router }
}

function moduleHeads(wrapper: VueWrapper) {
  return wrapper.findAll('.nt-mod-head')
}

function fieldByLabel(wrapper: VueWrapper, label: string) {
  const field = wrapper.findAll('.nt-field').find((candidate) => candidate.find('.nt-field-label').text() === label)
  expect(field, `no field labelled "${label}"`).toBeDefined()
  return field!.find('input, textarea')
}

describe('curriculum screen', () => {
  it('renders every mock curriculum with its own title and modules', async () => {
    for (const curriculum of store.curricula) {
      const { wrapper } = await mountAt(`/curriculos/${curriculum.slug}`)

      expect(wrapper.find('.app-content h1').text()).toBe(curriculum.title)
      expect(wrapper.text()).toContain(curriculum.goal)
      expect(moduleHeads(wrapper)).toHaveLength(curriculum.modules.length)
      for (const module of curriculum.modules) {
        expect(wrapper.text()).toContain(module.title)
      }
    }
  })

  it('shows the objective, the ruler and every module region of the open module', async () => {
    const { wrapper } = await mountAt('/curriculos/fundamentos-de-compiladores')

    expect(wrapper.find('.nt-pagetitle-objective').text()).toBe('Construir um interpretador pequeno e legível.')
    expect(wrapper.findAll('.ruler-step')).toHaveLength(4)
    expect(wrapper.text()).toContain('Percurso')
    expect(wrapper.text()).toContain('Materiais')
    expect(wrapper.text()).toContain('Instrumento: registro de tokens')
    expect(wrapper.text()).toContain('Exercícios')
    expect(wrapper.text()).toContain('Avaliação')
    expect(wrapper.find('.instrument-table').text()).toContain('Classe')
  })

  it('marks each material status and the O/P of required and optional materials', async () => {
    const { wrapper } = await mountAt('/curriculos/horta-caseira')

    const rows = wrapper.findAll('.nt-mat')
    expect(rows.length).toBeGreaterThan(2)
    // post-garden is read, paper-compost archived, book-garden the first required one still waiting.
    expect(rows[0].classes()).toContain('is-done')
    expect(rows[1].classes()).toContain('is-current')
    expect(rows[2].classes()).toContain('is-skipped')
    expect(rows[0].find('.nt-mat-type').text()).toBe('O · Post')
    expect(rows[2].find('.nt-mat-type').text()).toBe('P · Paper · opcional')
  })

  it('collapses and expands a module', async () => {
    const { wrapper } = await mountAt('/curriculos/fundamentos-de-compiladores')
    const heads = moduleHeads(wrapper)

    expect(heads[0].attributes('aria-expanded')).toBe('true')
    await heads[0].trigger('click')
    expect(moduleHeads(wrapper)[0].attributes('aria-expanded')).toBe('false')
    expect(wrapper.find('.nt-mod-body').exists()).toBe(false)

    await moduleHeads(wrapper)[1].trigger('click')
    expect(moduleHeads(wrapper)[1].attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('Tabela de precedência')
  })

  it('opens a module from the ruler', async () => {
    const { wrapper } = await mountAt('/curriculos/fundamentos-de-compiladores')

    await moduleHeads(wrapper)[0].trigger('click')
    await wrapper.findAll('.ruler-step')[2].trigger('click')

    expect(moduleHeads(wrapper)[2].attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('Instrumento: tabela de símbolos')
  })

  it('routes every material row and the continue button to a known target', async () => {
    const { wrapper, router } = await mountAt('/curriculos/fundamentos-de-compiladores')

    const titles = wrapper.findAll('.nt-mat-title')
    expect(titles.length).toBeGreaterThan(0)
    for (const title of titles) {
      const href = title.attributes('href')!
      expect(href).toMatch(/^\/material\/(post|livro|paper)\//)
      expect(router.resolve(href).name).toBe('material')
    }

    const continueLink = wrapper.find('.curriculum-continue')
    expect(continueLink.attributes('href')).toBe('/material/post/post-compilation')
  })

  it('links the breadcrumb to the study home and offers a new curriculum', async () => {
    const { wrapper, router } = await mountAt('/curriculos/tipografia-pratica')

    expect(router.resolve(wrapper.find('.curriculum-crumb').attributes('href')!).name).toBe('estudo')
    expect(wrapper.find('.curriculum-new').attributes('href')).toBe('/curriculos/nova')
  })

  it('edits the title, the objective and a module title, and saves them to the page', async () => {
    const { wrapper } = await mountAt('/curriculos/casa-conectada')

    await wrapper.find('.curriculum-actions .nt-btn').trigger('click')
    expect(wrapper.find('.editor-heading').text()).toBe('Editar currículo')

    await fieldByLabel(wrapper, 'Título').setValue('Casa em rede')
    await fieldByLabel(wrapper, 'Objetivo').setValue('Manter serviços simples de pé sem vigiá-los.')
    await fieldByLabel(wrapper, 'Módulo 1').setValue('A rede da casa')
    await wrapper.find('.editor-actions .nt-btn-primary').trigger('click')

    expect(wrapper.find('.editor').exists()).toBe(false)
    expect(wrapper.find('.app-content h1').text()).toBe('Casa em rede')
    expect(wrapper.find('.nt-pagetitle-objective').text()).toBe('Manter serviços simples de pé sem vigiá-los.')
    expect(wrapper.findAll('.nt-mod-title')[0].text()).toBe('A rede da casa')
  })

  it('opens an empty form on nova and saves a new curriculum', async () => {
    const { wrapper, router } = await mountAt('/curriculos/nova')

    expect(wrapper.find('.editor-heading').text()).toBe('Novo currículo')
    expect((fieldByLabel(wrapper, 'Título').element as HTMLInputElement).value).toBe('')
    const save = wrapper.find('.editor-actions .nt-btn-primary')
    expect(save.attributes('disabled')).toBeDefined()

    await fieldByLabel(wrapper, 'Título').setValue('Marcenaria de fim de semana')
    await fieldByLabel(wrapper, 'Objetivo').setValue('Construir móveis simples com ferramentas manuais.')
    await wrapper.find('.editor-actions .nt-btn-primary').trigger('click')
    await flushPromises()

    expect(store.curricula[0]).toMatchObject({ slug: 'marcenaria-de-fim-de-semana', title: 'Marcenaria de fim de semana' })
    expect(router.currentRoute.value.fullPath).toBe('/curriculos/marcenaria-de-fim-de-semana')
    expect(wrapper.find('.app-content h1').text()).toBe('Marcenaria de fim de semana')
  })

  it('shows a not-found state for an unknown slug', async () => {
    const { wrapper, router } = await mountAt('/curriculos/nao-existe')

    expect(wrapper.find('.app-content h1').text()).toBe('Currículo não encontrado')
    expect(wrapper.findAll('.nt-mod-head')).toHaveLength(0)
    expect(router.resolve(wrapper.find('.curriculum-back').attributes('href')!).name).toBe('estudo')
  })
})
