import { mount } from '@vue/test-utils'
import { beforeEach, describe, expect, it } from 'vitest'

import router from '@/router'
import { store } from '@/mock/store'

import HomeView from './HomeView.vue'

async function mountHome(path = '/') {
  await router.push(path)
  await router.isReady()
  return mount(HomeView, { global: { plugins: [router] } })
}

describe('HomeView', () => {
  beforeEach(async () => {
    await router.push('/')
  })

  it('renders its title and the main home regions', async () => {
    const wrapper = await mountHome()

    expect(wrapper.get('h1').text()).toBe('Sábado, 3 de outubro')
    expect(wrapper.get('#continue-study').text()).toBe('Continuar estudando')
    expect(wrapper.get('#continue-reading').text()).toBe('Continuar lendo')
    expect(wrapper.get('#recent-saves').text()).toBe('Salvos recentemente')
    expect(wrapper.findAll('.nt-carousel-item')).toHaveLength(6)
  })

  it('uses the promised routes for review, curricula, and reading items', async () => {
    const wrapper = await mountHome()

    expect(wrapper.get('.home-review').attributes('href')).toBe('/revisao')
    expect(wrapper.get('.nt-course').attributes('href')).toBe('/curriculos/fundamentos-de-compiladores')
    expect(wrapper.get('.nt-cover-card').attributes('href')).toBe('/material/post/post-compilation')
  })

  it('opens the save dialog from the URL, rejects an empty URL, and saves to inbox first', async () => {
    const initialInboxCount = store.libraryItems.filter((item) => item.status === 'inbox').length
    const wrapper = await mountHome('/?save=1')

    expect(wrapper.get('[role="dialog"]').text()).toContain('Salvar link')
    await wrapper.get('form').trigger('submit')
    expect(wrapper.get('[role="alert"]').text()).toBe('Informe uma URL para salvar.')

    await wrapper.get('.nt-input').setValue('https://example.org/reading-list')
    await wrapper.get('form').trigger('submit')

    expect(wrapper.find('[role="dialog"]').exists()).toBe(false)
    expect(store.libraryItems).toHaveLength(19)
    expect(store.libraryItems[0]).toMatchObject({ status: 'inbox', url: 'https://example.org/reading-list' })
    expect(store.libraryItems.filter((item) => item.status === 'inbox')).toHaveLength(initialInboxCount + 1)
    expect(wrapper.get('.home-save-title').text()).toBe('Reading list')
  })

  it('opens the save dialog from its button', async () => {
    const wrapper = await mountHome()

    await wrapper.get('button.nt-btn-secondary').trigger('click')

    expect(wrapper.get('[role="dialog"]').text()).toContain('Salvar link')
  })
})
