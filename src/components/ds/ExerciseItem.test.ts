import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import ExerciseItem from './ExerciseItem.vue'

describe('ExerciseItem', () => {
  it('pads the number and shows the work area while it is open', () => {
    const wrapper = mount(ExerciseItem, {
      props: { n: 1, kind: 'Explicar sem consultar', prompt: 'Por quê?' },
      slots: { default: '<textarea></textarea>' }
    })

    expect(wrapper.find('.nt-ex-n').text()).toBe('01')
    expect(wrapper.find('.nt-ex-kind').text()).toBe('Explicar sem consultar')
    expect(wrapper.find('.nt-ex-work').exists()).toBe(true)
    expect(wrapper.find('.nt-ex-meta').exists()).toBe(false)
  })

  it('replaces the work area with the answer once done', () => {
    const wrapper = mount(ExerciseItem, {
      props: { n: 2, kind: 'Aplicar', prompt: 'Monte um cronograma.', done: true, answer: 'Quatro blocos.', time: '12:40' },
      slots: { default: '<textarea></textarea>' }
    })

    expect(wrapper.find('.nt-ex-work').exists()).toBe(false)
    expect(wrapper.find('.nt-ex-answer').text()).toBe('Quatro blocos.')
    expect(wrapper.find('.nt-ex-meta').text()).toContain('12:40')
    expect(wrapper.find('.nt-ex-n svg').exists()).toBe(true)
  })
})
