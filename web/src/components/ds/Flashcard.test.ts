import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'

import Flashcard from './Flashcard.vue'

const props = {
  deck: 'Systems',
  position: '3/10',
  front: 'Front question',
  back: 'Back answer'
}

function press(key: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { key, cancelable: true }))
}

describe('Flashcard', () => {
  it('hides the back until it is revealed', () => {
    const wrapper = mount(Flashcard, { props })

    expect(wrapper.find('.nt-card-back').exists()).toBe(false)
    expect(wrapper.find('.nt-card-reveal').exists()).toBe(true)
  })

  it('reveals the back on the button and emits reveal once', async () => {
    const wrapper = mount(Flashcard, { props })

    await wrapper.find('.nt-card-reveal button').trigger('click')

    expect(wrapper.find('.nt-card-back').text()).toBe('Back answer')
    expect(wrapper.emitted('reveal')).toHaveLength(1)
  })

  it('reveals the back on the space key', async () => {
    const wrapper = mount(Flashcard, { props, attachTo: document.body })

    press(' ')
    await wrapper.vm.$nextTick()

    expect(wrapper.find('.nt-card-back').exists()).toBe(true)
    wrapper.unmount()
  })

  it('labels the four ratings in English', () => {
    const wrapper = mount(Flashcard, { props: { ...props, revealed: true } })

    expect(wrapper.findAll('.nt-rate-label').map((node) => node.text())).toEqual([
      'Again',
      'Hard',
      'Good',
      'Easy'
    ])
  })

  it('emits every rating from its buttons', async () => {
    const wrapper = mount(Flashcard, { props: { ...props, revealed: true } })
    const buttons = wrapper.findAll('.nt-rate')

    expect(buttons).toHaveLength(4)
    for (const button of buttons) await button.trigger('click')

    expect(wrapper.emitted('rate')).toEqual([['again'], ['hard'], ['good'], ['easy']])
  })

  it('emits every rating from the keys 1-4', async () => {
    const wrapper = mount(Flashcard, { props: { ...props, revealed: true }, attachTo: document.body })

    for (const key of ['1', '2', '3', '4']) press(key)
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('rate')).toEqual([['again'], ['hard'], ['good'], ['easy']])
    wrapper.unmount()
  })

  it('ignores rating keys while the back is hidden', async () => {
    const wrapper = mount(Flashcard, { props, attachTo: document.body })

    press('3')
    await wrapper.vm.$nextTick()

    expect(wrapper.emitted('rate')).toBeUndefined()
    wrapper.unmount()
  })

  it('stops listening once unmounted', async () => {
    const wrapper = mount(Flashcard, { props: { ...props, revealed: true }, attachTo: document.body })
    wrapper.unmount()

    press('1')

    expect(wrapper.emitted('rate')).toBeUndefined()
  })

  it('shows the four next intervals beside the ratings', () => {
    const wrapper = mount(Flashcard, {
      props: { ...props, revealed: true, intervals: ['1m', '8m', '2d', '6d'] as [string, string, string, string] }
    })

    expect(wrapper.findAll('.nt-rate-iv').map((node) => node.text())).toEqual(['1m', '8m', '2d', '6d'])
  })
})
