import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import TrailPath, { type TrailStep } from './TrailPath.vue'

const steps: TrailStep[] = [
  { title: 'Fundamentals', meta: '4 materials', status: 'done' },
  { title: 'Models', status: 'current' },
  { title: 'Practice', status: 'next' },
  { title: 'Project', status: 'locked' }
]

describe('TrailPath', () => {
  it('marks each step with its status and names the current one', () => {
    const wrapper = mount(TrailPath, { props: { steps } })
    const items = wrapper.findAll('.nt-trail-step')

    expect(items.map((node) => node.classes()).map((classes) => classes[1])).toEqual([
      'is-done',
      'is-current',
      'is-next',
      'is-locked'
    ])
    expect(items[1].attributes('aria-current')).toBe('step')
    expect(items[0].find('.nt-trail-status').text()).toBe('Done')
    expect(items[1].find('.nt-trail-status').text()).toBe('Now')
    expect(items[3].find('.nt-trail-status').text()).toBe('Locked')
    expect(items[2].find('.nt-trail-status').exists()).toBe(false)
  })

  it('numbers the steps that have no icon of their own', () => {
    const wrapper = mount(TrailPath, { props: { steps } })

    expect(wrapper.findAll('.nt-trail-index').map((node) => node.text())).toEqual(['2', '3'])
    expect(wrapper.findAll('.nt-trail-step')[0].find('svg').exists()).toBe(true)
  })
})
