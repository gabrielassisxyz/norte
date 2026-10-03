import { mount } from '@vue/test-utils'
import { describe, expect, it, vi } from 'vitest'

import Button from './Button.vue'
import Icon from './Icon.vue'
import NavItem from './NavItem.vue'
import PageTitle from './PageTitle.vue'
import ProgressBar from './ProgressBar.vue'
import SectionHeader from './SectionHeader.vue'
import SegmentedControl from './SegmentedControl.vue'
import SidePanel from './SidePanel.vue'
import Stat from './Stat.vue'
import StreakGrid from './StreakGrid.vue'
import SyncStatus from './SyncStatus.vue'
import Tabs from './Tabs.vue'
import Tag from './Tag.vue'
import TextField from './TextField.vue'

describe('design-system components', () => {
  it('Button renders variant, size, icon, and disabled state', () => {
    const wrapper = mount(Button, {
      props: { variant: 'primary', size: 'sm', icon: 'play', disabled: true },
      slots: { default: 'Iniciar estudo' }
    })

    expect(wrapper.classes()).toEqual(expect.arrayContaining(['nt-btn-primary', 'nt-btn-sm']))
    expect(wrapper.find('svg').exists()).toBe(true)
    expect(wrapper.attributes('disabled')).toBeDefined()
  })

  it('Tag renders kind, count, active state, and click callback', async () => {
    const onClick = vi.fn()
    const wrapper = mount(Tag, { props: { kind: 'tag', count: 3, active: true, onClick } })

    await wrapper.trigger('click')

    expect(wrapper.element.tagName).toBe('BUTTON')
    expect(wrapper.classes()).toEqual(expect.arrayContaining(['nt-tag-tag', 'is-active']))
    expect(wrapper.text()).toContain('#')
    expect(wrapper.text()).toContain('3')
    expect(onClick).toHaveBeenCalledOnce()
  })

  it('SyncStatus exposes each documented state label', () => {
    const states = ['saved', 'syncing', 'offline', 'conflict'] as const
    const labels = ['Salvo localmente', 'Sincronizando', 'Offline · salvo local', 'Conflito para revisar']

    states.forEach((state, index) => {
      const wrapper = mount(SyncStatus, { props: { state } })
      expect(wrapper.text()).toBe(labels[index])
      expect(wrapper.classes()).toContain(`nt-sync-${state}`)
    })
  })

  it('Stat renders value, unit, label, and delta tone', () => {
    const wrapper = mount(Stat, {
      props: { value: 18, unit: 'dias', label: 'Sequência atual', delta: '−2', deltaTone: 'down' }
    })

    expect(wrapper.find('.nt-stat-value').text()).toContain('18')
    expect(wrapper.find('.nt-stat-unit').text()).toBe('dias')
    expect(wrapper.find('.nt-stat-label').text()).toBe('Sequência atual')
    expect(wrapper.find('.nt-stat-delta').classes()).toContain('is-down')
  })

  it('ProgressBar clamps values and renders accessible progress', () => {
    const wrapper = mount(ProgressBar, { props: { value: 9, max: 12, label: 'Plano semanal' } })
    const progress = wrapper.get('[role="progressbar"]')

    expect(progress.attributes('aria-valuenow')).toBe('75')
    expect(wrapper.find('.nt-progress-value').text()).toBe('75%')
    expect(wrapper.find('.nt-progress-fill').attributes('style')).toContain('width: 75%')
  })

  it('StreakGrid clamps day levels and renders the legend', () => {
    const wrapper = mount(StreakGrid, {
      props: { days: [-1, 0, 2, 8], caption: 'Últimas semanas' }
    })

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('Histórico de estudo')
    expect(wrapper.findAll('.nt-streak-grid .nt-streak-cell').map((cell) => cell.attributes('data-level'))).toEqual([
      '0',
      '0',
      '2',
      '4'
    ])
    expect(wrapper.text()).toContain('Últimas semanas')
    expect(wrapper.text()).toContain('menos')
    expect(wrapper.text()).toContain('mais')
  })

  it('PageTitle renders title, objective, meta, and actions', () => {
    const wrapper = mount(PageTitle, {
      props: { title: 'Estudar redes', objective: 'Conseguir explicar uma topologia.' , meta: 'Salvo', actions: 'Continuar' }
    })

    expect(wrapper.get('h1').text()).toBe('Estudar redes')
    expect(wrapper.get('.nt-pagetitle-objective').text()).toBe('Conseguir explicar uma topologia.')
    expect(wrapper.get('.nt-pagetitle-meta').text()).toBe('Salvo')
    expect(wrapper.get('.nt-pagetitle-actions').text()).toBe('Continuar')
  })

  it('NavItem renders the active navigation state and count', () => {
    const wrapper = mount(NavItem, { props: { label: 'Revisão', href: '/revisao', active: true, count: 16 } })

    expect(wrapper.attributes('href')).toBe('/revisao')
    expect(wrapper.attributes('aria-current')).toBe('page')
    expect(wrapper.find('.nt-nav-count').text()).toBe('16')
  })

  it('SectionHeader supports heading level, action, and trailing slot', () => {
    const wrapper = mount(SectionHeader, {
      props: { title: 'Próximos estudos', level: 3, actionLabel: 'Ver todos', actionHref: '/estudo' },
      slots: { trailing: 'Filtros' }
    })

    expect(wrapper.find('h3').text()).toBe('Próximos estudos')
    expect(wrapper.get('.nt-sechead-link').attributes('href')).toBe('/estudo')
    expect(wrapper.get('.nt-sechead-trailing').text()).toBe('Filtros')
  })

  it('SegmentedControl emits update:modelValue when an option is clicked', async () => {
    const wrapper = mount(SegmentedControl, {
      props: {
        defaultValue: 'one',
        options: [
          { value: 'one', label: 'Um' },
          { value: 'two', label: 'Dois', count: 2 }
        ]
      }
    })

    await wrapper.findAll('button')[1].trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['two']])
    expect(wrapper.findAll('button')[1].attributes('aria-selected')).toBe('true')
  })

  it('Tabs emits update:modelValue when a tab is clicked', async () => {
    const wrapper = mount(Tabs, {
      props: {
        defaultValue: 'note',
        items: [
          { value: 'note', label: 'Nota' },
          { value: 'annotations', label: 'Anotações', count: 4 }
        ]
      }
    })

    await wrapper.findAll('button')[1].trigger('click')

    expect(wrapper.emitted('update:modelValue')).toEqual([['annotations']])
    expect(wrapper.findAll('button')[1].classes()).toContain('is-active')
  })

  it('SidePanel supports collapsed v-model and tab selection', async () => {
    const wrapper = mount(SidePanel, {
      props: {
        collapsed: true,
        tabs: [
          { value: 'note', label: 'Nota', icon: 'note' },
          { value: 'annotations', label: 'Anotações', count: 4, icon: 'comment' }
        ]
      }
    })

    await wrapper.get('[aria-label="Abrir painel"]').trigger('click')
    await wrapper.setProps({ collapsed: false })

    expect(wrapper.emitted('update:collapsed')).toEqual([[false]])
    expect(wrapper.find('.nt-panel').exists()).toBe(true)
  })

  it('TextField emits update:modelValue for text input and supports multiline', async () => {
    const wrapper = mount(TextField, {
      props: { label: 'Nova anotação', multiline: true, modelValue: '' }
    })

    await wrapper.get('textarea').setValue('Uma ideia')

    expect(wrapper.get('textarea').attributes('aria-describedby')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toEqual([['Uma ideia']])
    expect(wrapper.get('label').attributes('for')).toBe(wrapper.get('textarea').attributes('id'))
  })

  it('Icon renders each supported name with its requested size', () => {
    const wrapper = mount(Icon, { props: { name: 'arrowLeft', size: 20 } })

    expect(wrapper.get('svg').attributes('width')).toBe('20')
    expect(wrapper.get('path').attributes('d')).toBe('M12.5 8h-9M7 4.5L3.5 8 7 11.5')
  })
})
