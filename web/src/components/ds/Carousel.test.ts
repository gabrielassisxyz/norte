import { mount } from '@vue/test-utils'
import { describe, expect, it } from 'vitest'
import { h } from 'vue'

import Carousel from './Carousel.vue'

function makeItems(count: number) {
  return Array.from({ length: count }, (_, i) => h('div', { class: 'item' }, `Item ${i + 1}`))
}

function mountCarousel(count: number, props: Record<string, unknown> = {}) {
  return mount(Carousel, {
    props: { itemWidth: 100, gap: 20, visible: 4, step: 2, ...props },
    slots: { default: () => makeItems(count) }
  })
}

function offsetOf(wrapper: ReturnType<typeof mountCarousel>): string {
  return wrapper.find('.nt-carousel-track').attributes('style') ?? ''
}

describe('Carousel', () => {
  it('renders one slot child per item', () => {
    const wrapper = mountCarousel(6)

    expect(wrapper.findAll('.nt-carousel-item')).toHaveLength(6)
    expect(wrapper.findAll('.item')).toHaveLength(6)
  })

  it('names the frame and both arrows in English', () => {
    const wrapper = mountCarousel(6)

    expect(wrapper.find('.nt-carousel').attributes('aria-label')).toBe('Carousel')
    expect(wrapper.find('.is-prev').attributes('aria-label')).toBe('Previous')
    expect(wrapper.find('.is-next').attributes('aria-label')).toBe('Next')
  })

  it('starts with the previous arrow disabled and the next one live', () => {
    const wrapper = mountCarousel(6)

    expect(wrapper.find('.is-prev').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.is-next').attributes('disabled')).toBeUndefined()
  })

  it('steps by `step` items per click', async () => {
    const wrapper = mountCarousel(8)

    await wrapper.find('.is-next').trigger('click')

    expect(offsetOf(wrapper)).toContain('translateX(-240px)')
  })

  it('stops at the last full page and disables the next arrow', async () => {
    const wrapper = mountCarousel(6)

    await wrapper.find('.is-next').trigger('click')
    expect(offsetOf(wrapper)).toContain('translateX(-240px)')
    expect(wrapper.find('.is-next').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.is-prev').attributes('disabled')).toBeUndefined()

    await wrapper.find('.is-next').trigger('click')
    expect(offsetOf(wrapper)).toContain('translateX(-240px)')
  })

  it('walks back to the start and disables the previous arrow again', async () => {
    const wrapper = mountCarousel(8)

    await wrapper.find('.is-next').trigger('click')
    await wrapper.find('.is-prev').trigger('click')

    expect(offsetOf(wrapper)).toContain('translateX(-0px)')
    expect(wrapper.find('.is-prev').attributes('disabled')).toBeDefined()
  })

  it('disables both arrows when everything already fits', () => {
    const wrapper = mountCarousel(3)

    expect(wrapper.find('.is-prev').attributes('disabled')).toBeDefined()
    expect(wrapper.find('.is-next').attributes('disabled')).toBeDefined()
  })
})
