import { mount } from '@vue/test-utils'
import { defineComponent, h, nextTick, ref } from 'vue'
import { describe, expect, it } from 'vitest'

import { useReaderChromeVisibility } from './readerChromeVisibility'

const VIEWPORT = 800

function scrollerAt(top = 0): HTMLElement {
  const element = document.createElement('div')
  let scrollTop = top
  Object.defineProperty(element, 'scrollTop', { get: () => scrollTop, set: (value: number) => (scrollTop = value) })
  Object.defineProperty(element, 'clientHeight', { get: () => VIEWPORT })
  return element
}

async function harness(top = 0) {
  const element = scrollerAt(top)
  const frozen = ref(false)
  let exposed!: ReturnType<typeof useReaderChromeVisibility>
  const scroller = ref<HTMLElement>()
  const wrapper = mount(
    defineComponent({
      setup() {
        scroller.value = element
        exposed = useReaderChromeVisibility(scroller, { frozen: () => frozen.value })
        return () => h('div')
      }
    })
  )
  await nextTick()
  await nextTick()
  const scrollTo = (value: number): void => {
    element.scrollTop = value
    element.dispatchEvent(new Event('scroll'))
  }
  return { ...exposed, frozen, scrollTo, wrapper }
}

describe('the phone reader chrome visibility', () => {
  it('never hides inside the first viewport, however far it moves', async () => {
    const { hidden, scrollTo } = await harness()

    scrollTo(200)
    scrollTo(500)
    scrollTo(VIEWPORT - 1)

    expect(hidden.value).toBe(false)
  })

  it('keeps showing for 39 px down and hides at 40', async () => {
    const { hidden, scrollTo } = await harness(VIEWPORT * 2)

    scrollTo(VIEWPORT * 2 + 39)
    expect(hidden.value).toBe(false)
    scrollTo(VIEWPORT * 2 + 40)
    expect(hidden.value).toBe(true)
  })

  it('shows again on 1 px of upward scroll', async () => {
    const { hidden, scrollTo } = await harness(VIEWPORT * 2)
    scrollTo(VIEWPORT * 2 + 60)
    expect(hidden.value).toBe(true)

    scrollTo(VIEWPORT * 2 + 59)

    expect(hidden.value).toBe(false)
  })

  it('forgets the distance travelled down once the scroll turns upward', async () => {
    const { hidden, scrollTo } = await harness(VIEWPORT * 2)

    scrollTo(VIEWPORT * 2 + 30)
    scrollTo(VIEWPORT * 2 + 20)
    scrollTo(VIEWPORT * 2 + 49)

    // 30 down, 10 up, 29 down: 59 in total but never 40 in one run.
    expect(hidden.value).toBe(false)
  })

  it('changes nothing in either direction while frozen', async () => {
    const { hidden, frozen, scrollTo } = await harness(VIEWPORT * 2)

    frozen.value = true
    scrollTo(VIEWPORT * 2 + 200)
    expect(hidden.value).toBe(false)

    frozen.value = false
    scrollTo(VIEWPORT * 2 + 300)
    expect(hidden.value).toBe(true)

    frozen.value = true
    scrollTo(VIEWPORT * 2 + 100)
    expect(hidden.value).toBe(true)
  })

  it('measures the first move after a freeze from where the text is', async () => {
    const { hidden, frozen, scrollTo } = await harness(VIEWPORT * 2)

    frozen.value = true
    scrollTo(VIEWPORT * 3)
    frozen.value = false
    scrollTo(VIEWPORT * 3 + 10)

    expect(hidden.value).toBe(false)
  })

  it('shows the controls again on reset', async () => {
    const { hidden, reset, scrollTo } = await harness(VIEWPORT * 2)
    scrollTo(VIEWPORT * 2 + 80)

    reset()

    expect(hidden.value).toBe(false)
  })
})
