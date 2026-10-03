import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import CourseRow from './CourseRow.vue'

describe('CourseRow', () => {
  it('lays out title, topic, source and the numeric columns', () => {
    const wrapper = mount(CourseRow, {
      props: {
        title: 'Teoria de filas',
        topic: 'Sistemas',
        source: 'Livro',
        progress: 0.5,
        lessons: '6/12',
        lastStudied: 'há 2d',
        href: '/curriculos/filas'
      }
    })

    expect(wrapper.find('.nt-course-title').text()).toBe('Teoria de filas')
    expect(wrapper.find('.nt-course-sub').text()).toContain('Sistemas')
    expect(wrapper.attributes('href')).toBe('/curriculos/filas')
    expect(wrapper.findAll('.nt-course-num').map((node) => node.text())).toEqual(['6/12', 'há 2d'])
    expect(wrapper.find('.nt-progress-fill').attributes('style')).toContain('width: 50%')
  })

  it('falls back to a percentage and an em dash without lessons or a last study', () => {
    const wrapper = mount(CourseRow, { props: { title: 'Escrita', progress: 0.25 } })

    expect(wrapper.findAll('.nt-course-num').map((node) => node.text())).toEqual(['25%', '—'])
  })
})
