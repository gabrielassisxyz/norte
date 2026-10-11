import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CourseRow from './CourseRow.vue'

describe('CourseRow', () => {
  it('lays out title, topic, source and the numeric columns', () => {
    const wrapper = mount(CourseRow, {
      props: {
        title: 'Queueing theory',
        topic: 'Systems',
        source: 'Book',
        progress: 0.5,
        lessons: '6/12',
        lastStudied: '2d ago',
        href: '/curriculos/filas'
      }
    })

    expect(wrapper.find('.nt-course-title').text()).toBe('Queueing theory')
    expect(wrapper.find('.nt-course-sub').text()).toContain('Systems')
    expect(wrapper.attributes('href')).toBe('/curriculos/filas')
    expect(wrapper.findAll('.nt-course-num').map((node) => node.text())).toEqual(['6/12', '2d ago'])
    expect(wrapper.find('.nt-progress-fill').attributes('style')).toContain('width: 50%')
  })

  it('falls back to a percentage and an em dash without lessons or a last study', () => {
    const wrapper = mount(CourseRow, { props: { title: 'Writing', progress: 0.25 } })

    expect(wrapper.findAll('.nt-course-num').map((node) => node.text())).toEqual(['25%', '—'])
  })
})
