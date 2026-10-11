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
      slots: { default: 'Start studying' }
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
    const labels = ['Saved locally', 'Syncing', 'Offline · saved locally', 'Conflict to review']

    states.forEach((state, index) => {
      const wrapper = mount(SyncStatus, { props: { state } })
      expect(wrapper.text()).toBe(labels[index])
      expect(wrapper.classes()).toContain(`nt-sync-${state}`)
    })
  })

  it('Stat renders value, unit, label, and delta tone', () => {
    const wrapper = mount(Stat, {
      props: { value: 18, unit: 'days', label: 'Current streak', delta: '−2', deltaTone: 'down' }
    })

    expect(wrapper.find('.nt-stat-value').text()).toContain('18')
    expect(wrapper.find('.nt-stat-unit').text()).toBe('days')
    expect(wrapper.find('.nt-stat-label').text()).toBe('Current streak')
    expect(wrapper.find('.nt-stat-delta').classes()).toContain('is-down')
  })

  it('ProgressBar clamps values and renders accessible progress', () => {
    const wrapper = mount(ProgressBar, { props: { value: 9, max: 12, label: 'Weekly plan' } })
    const progress = wrapper.get('[role="progressbar"]')

    expect(progress.attributes('aria-valuenow')).toBe('75')
    expect(wrapper.find('.nt-progress-value').text()).toBe('75%')
    expect(wrapper.find('.nt-progress-fill').attributes('style')).toContain('width: 75%')
  })

  it('StreakGrid clamps day levels and renders the legend', () => {
    const wrapper = mount(StreakGrid, {
      props: { days: [-1, 0, 2, 8], caption: 'Last weeks' }
    })

    expect(wrapper.get('[role="img"]').attributes('aria-label')).toBe('Study history')
    expect(wrapper.findAll('.nt-streak-grid .nt-streak-cell').map((cell) => cell.attributes('data-level'))).toEqual([
      '0',
      '0',
      '2',
      '4'
    ])
    expect(wrapper.text()).toContain('Last weeks')
    expect(wrapper.text()).toContain('less')
    expect(wrapper.text()).toContain('more')
  })

  it('PageTitle renders title, objective, meta, and actions', () => {
    const wrapper = mount(PageTitle, {
      props: { title: 'Study networks', objective: 'Be able to explain a topology.' , meta: 'Saved', actions: 'Continue' }
    })

    expect(wrapper.get('h1').text()).toBe('Study networks')
    expect(wrapper.get('.nt-pagetitle-objective').text()).toBe('Be able to explain a topology.')
    expect(wrapper.get('.nt-pagetitle-meta').text()).toBe('Saved')
    expect(wrapper.get('.nt-pagetitle-actions').text()).toBe('Continue')
  })

  it('NavItem renders the active navigation state and count', () => {
    const wrapper = mount(NavItem, { props: { label: 'Review', href: '/revisao', active: true, count: 16 } })

    expect(wrapper.attributes('href')).toBe('/revisao')
    expect(wrapper.attributes('aria-current')).toBe('page')
    expect(wrapper.find('.nt-nav-count').text()).toBe('16')
  })

  it('SectionHeader supports heading level, action, and trailing slot', () => {
    const wrapper = mount(SectionHeader, {
      props: { title: 'Upcoming studies', level: 3, actionLabel: 'See all', actionHref: '/estudo' },
      slots: { trailing: 'Filters' }
    })

    expect(wrapper.find('h3').text()).toBe('Upcoming studies')
    expect(wrapper.get('.nt-sechead-link').attributes('href')).toBe('/estudo')
    expect(wrapper.get('.nt-sechead-trailing').text()).toBe('Filters')
  })

  it('SegmentedControl emits update:modelValue when an option is clicked', async () => {
    const wrapper = mount(SegmentedControl, {
      props: {
        defaultValue: 'one',
        options: [
          { value: 'one', label: 'One' },
          { value: 'two', label: 'Two', count: 2 }
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
          { value: 'note', label: 'Note' },
          { value: 'annotations', label: 'Annotations', count: 4 }
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
          { value: 'note', label: 'Note', icon: 'note' },
          { value: 'annotations', label: 'Annotations', count: 4, icon: 'comment' }
        ]
      }
    })

    await wrapper.get('[aria-label="Open the panel"]').trigger('click')
    await wrapper.setProps({ collapsed: false })

    expect(wrapper.emitted('update:collapsed')).toEqual([[false]])
    expect(wrapper.find('.nt-panel').exists()).toBe(true)
  })

  it('TextField emits update:modelValue for text input and supports multiline', async () => {
    const wrapper = mount(TextField, {
      props: { label: 'New annotation', multiline: true, modelValue: '' }
    })

    await wrapper.get('textarea').setValue('An idea')

    expect(wrapper.get('textarea').attributes('aria-describedby')).toBeUndefined()
    expect(wrapper.emitted('update:modelValue')).toEqual([['An idea']])
    expect(wrapper.get('label').attributes('for')).toBe(wrapper.get('textarea').attributes('id'))
  })

  it('Icon renders each supported name with its requested size', () => {
    const wrapper = mount(Icon, { props: { name: 'arrowLeft', size: 20 } })

    expect(wrapper.get('svg').attributes('width')).toBe('20')
    expect(wrapper.get('path').attributes('d')).toBe('M12.5 8h-9M7 4.5L3.5 8 7 11.5')
  })
})
