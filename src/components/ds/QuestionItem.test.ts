import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import QuestionItem from './QuestionItem.vue'

describe('QuestionItem', () => {
  it('shows the 5W1H label and the open state', () => {
    const wrapper = mount(QuestionItem, {
      props: { kind: 'why', question: 'Por que relógios lógicos bastam?', topic: 'Sistemas', age: 'há 3d' }
    })

    expect(wrapper.find('.nt-q-kind').text()).toBe('Por quê')
    expect(wrapper.find('.nt-q-meta').text()).toContain('Aberta')
    expect(wrapper.find('.nt-q-answer').exists()).toBe(false)
    expect(wrapper.find('.nt-q-age').text()).toBe('há 3d')
  })

  it('shows the answer and the answered state', () => {
    const wrapper = mount(QuestionItem, {
      props: { kind: 'how', question: 'Como medir calibração?', status: 'answered', answer: 'Pela taxa de acerto.' }
    })

    expect(wrapper.classes()).toContain('is-answered')
    expect(wrapper.find('.nt-q-answer').text()).toBe('Pela taxa de acerto.')
    expect(wrapper.find('.nt-q-state').text()).toBe('Respondida')
  })
})
