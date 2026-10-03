import { mount, type DOMWrapper, type VueWrapper } from '@vue/test-utils'
import { createMemoryHistory, createRouter, type Router } from 'vue-router'
import { describe, expect, it } from 'vitest'

import App from '@/App.vue'
import AppSidebar from '@/components/AppSidebar.vue'
import { routes } from '@/router'

async function mountAt(path: string) {
  const router = createRouter({ history: createMemoryHistory(), routes })
  await router.push(path)
  await router.isReady()
  const wrapper = mount(App, { global: { plugins: [router] } })
  return { wrapper, router }
}

async function expandAll(wrapper: VueWrapper) {
  for (const label of ['Biblioteca', 'Estudo', 'Projetos', 'Notas']) {
    await wrapper.find(`button[aria-label="Expandir ${label}"]`).trigger('click')
  }
}

function sidebarLinks(wrapper: VueWrapper) {
  return wrapper.findAll('.app-sidebar a.app-item')
}

async function clickAndSettle(link: DOMWrapper<Element>, router: Router, expected: string) {
  await link.trigger('click')
  for (let i = 0; i < 100 && router.currentRoute.value.fullPath !== expected; i++) {
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

describe('app shell', () => {
  it('renders the screen title inside the shell with its main regions', async () => {
    const { wrapper } = await mountAt('/')

    expect(wrapper.find('.app-sidebar').exists()).toBe(true)
    expect(wrapper.find('.app-content main').exists()).toBe(true)
    expect(wrapper.find('.app-content h1').text()).toBe('Sábado, 3 de outubro')
  })

  it('names every screen on its own route', async () => {
    const cases: Array<[string, string]> = [
      ['/biblioteca', 'Biblioteca'],
      ['/revisao', 'Revisão'],
      ['/estudo', 'Estudo'],
      ['/projetos', 'Projetos'],
      ['/areas/a-casa', 'Casa'],
      ['/projetos/project-horta', 'Horta da varanda'],
      ['/decisoes/decision-backup-media', 'Escolher mídia para a cópia externa'],
      ['/tarefas/task-backup', 'Definir destinos de cópia']
    ]
    for (const [path, title] of cases) {
      const { wrapper } = await mountAt(path)
      expect(wrapper.find('.app-content h1').text()).toBe(title)
    }
  })

  it('routes every sidebar entry to its named target with the right query', async () => {
    const { wrapper, router } = await mountAt('/')
    await expandAll(wrapper)

    const targets: Record<string, { name: string; query?: Record<string, string> }> = {}
    for (const link of sidebarLinks(wrapper)) {
      const href = link.attributes('href')
      if (!href) continue
      const resolved = router.resolve(href)
      targets[link.text().replace(/\d+$/, '').trim()] = {
        name: String(resolved.name),
        ...(Object.keys(resolved.query).length > 0
          ? { query: resolved.query as Record<string, string> }
          : {})
      }
    }

    expect(targets['Inbox']).toMatchObject({ name: 'biblioteca', query: { v: 'inbox' } })
    expect(targets['Tudo']).toMatchObject({ name: 'biblioteca', query: { v: 'tudo' } })
    expect(targets['Depois']).toMatchObject({ name: 'biblioteca', query: { v: 'depois' } })
    expect(targets['Livros']).toMatchObject({ name: 'biblioteca', query: { tipo: 'livro' } })
    expect(targets['Revisão']).toMatchObject({ name: 'revisao' })
    expect(targets['Currículos']).toMatchObject({ name: 'estudo' })
    expect(targets['Anotações']).toMatchObject({ name: 'notas', query: { tab: 'anotacoes' } })
    expect(targets['Highlights']).toMatchObject({ name: 'notas', query: { tab: 'highlights' } })
    expect(targets['Casa']).toMatchObject({ name: 'area' })
    expect(targets['Projetos'].name).toBe('projetos')

    for (const [label, target] of Object.entries(targets)) {
      expect(
        ['inicio', 'biblioteca', 'notas', 'revisao', 'estudo', 'area', 'projetos'],
        `sidebar entry "${label}" points at an unknown route`
      ).toContain(target.name)
    }
  })

  it('lands on the right route when a sidebar entry is clicked', async () => {
    const { wrapper, router } = await mountAt('/')
    await expandAll(wrapper)

    const inbox = sidebarLinks(wrapper).find((link) => link.text().includes('Inbox'))
    expect(inbox).toBeDefined()
    await clickAndSettle(inbox!, router, '/biblioteca?v=inbox')

    expect(router.currentRoute.value.fullPath).toBe('/biblioteca?v=inbox')
    expect(wrapper.find('.app-content h1').text()).toBe('Biblioteca')
  })

  it('marks the entry for the current route as active', async () => {
    const { wrapper } = await mountAt('/revisao')
    await expandAll(wrapper)

    const revisao = sidebarLinks(wrapper).find((link) => link.text().includes('Revisão'))
    expect(revisao?.classes()).toContain('is-active')
  })

  it('collapses and expands sidebar sections', async () => {
    const { wrapper } = await mountAt('/')
    const toggle = wrapper.find('button[aria-label="Expandir Biblioteca"]')

    expect(wrapper.text()).not.toContain('Arquivo')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    expect(wrapper.text()).toContain('Arquivo')
    await toggle.trigger('click')
    expect(toggle.attributes('aria-expanded')).toBe('false')
    expect(wrapper.text()).not.toContain('Arquivo')
  })

  it('toggles pinning from the favourites star, kept in memory', async () => {
    const { wrapper } = await mountAt('/')
    const fixados = () => wrapper.find('nav[aria-label="Fixados"]')

    expect(fixados().text()).toContain('Inbox')
    await expandAll(wrapper)

    const star = wrapper.find('button[aria-label="Remover dos favoritos: Inbox"]')
    await star.trigger('click')
    expect(wrapper.find('button[aria-label="Favoritar: Inbox"]').exists()).toBe(true)
    expect(fixados().text()).not.toContain('Inbox')

    await wrapper.find('button[aria-label="Favoritar: Inbox"]').trigger('click')
    expect(fixados().text()).toContain('Inbox')
  })

  it('opens the matching overlay from the sidebar controls', async () => {
    const { wrapper } = await mountAt('/')

    await wrapper.find('.app-foot .app-button').trigger('click')
    expect(wrapper.findComponent(AppSidebar).emitted('search')).toHaveLength(1)
    expect(wrapper.find('input[aria-label="Buscar"]').exists()).toBe(true)

    await wrapper.findAll('.app-foot .app-button')[1].trigger('click')
    expect(wrapper.findComponent(AppSidebar).emitted('preferences')).toHaveLength(1)
    expect(wrapper.find('#shell-preferences-title').text()).toBe('Preferências')
  })

  it.each([
    ['Ctrl+K', { ctrlKey: true }],
    ['⌘+K', { metaKey: true }]
  ])('opens the search overlay from %s on every route', async (_shortcut, modifier) => {
    const { wrapper } = await mountAt('/projetos')

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ...modifier }))
    await wrapper.vm.$nextTick()

    expect(wrapper.find('input[aria-label="Buscar"]').exists()).toBe(true)
  })

  it('renders bare material routes without the sidebar', async () => {
    const { wrapper } = await mountAt('/material/post/post-compilation')

    expect(wrapper.find('.app-sidebar').exists()).toBe(false)
    expect(wrapper.find('.app-content h1').text()).toBe('Mapas de símbolos em compiladores pequenos')
  })
})
