import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import QuestionItem from './QuestionItem.vue'

describe('QuestionItem', () => {
  it('shows the 5W1H label and the open state', () => {
    const wrapper = mount(QuestionItem, {
      props: { kind: 'why', question: 'Why do logical clocks suffice?', topic: 'Systems', age: '3d ago' }
    })

    expect(wrapper.find('.nt-q-kind').text()).toBe('Why')
    expect(wrapper.find('.nt-q-meta').text()).toContain('Open')
    expect(wrapper.find('.nt-q-answer').exists()).toBe(false)
    expect(wrapper.find('.nt-q-age').text()).toBe('3d ago')
  })

  it('labels each of the six question kinds in English', () => {
    const kinds = ['what', 'why', 'who', 'when', 'where', 'how'] as const
    const labels = ['What', 'Why', 'Who', 'When', 'Where', 'How']

    kinds.forEach((kind, index) => {
      const wrapper = mount(QuestionItem, { props: { kind, question: 'A question' } })
      expect(wrapper.find('.nt-q-kind').text()).toBe(labels[index])
    })
  })

  it('shows the answer and the answered state', () => {
    const wrapper = mount(QuestionItem, {
      props: { kind: 'how', question: 'How to measure calibration?', status: 'answered', answer: 'By the hit rate.' }
    })

    expect(wrapper.classes()).toContain('is-answered')
    expect(wrapper.find('.nt-q-answer').text()).toBe('By the hit rate.')
    expect(wrapper.find('.nt-q-state').text()).toBe('Answered')
  })
})
