import { onBeforeUnmount, ref, watch, type Ref } from 'vue'

/** How far the text has to move down, in one run, before the controls get out of its way. */
export const HIDE_AFTER_PX = 40

/**
 * Whether the phone reader's floating controls are out of the way.
 *
 * They cover the first line of text when they are up and a thumb is always
 * near them, so they leave on the first sustained downward movement and come
 * back on any upward one -- the way a reader that is being read, not operated,
 * behaves. Three rules keep that from being jumpy:
 *
 * - Nothing hides inside the first screenful, where the person has not yet
 *   started reading and the controls are what they came for.
 * - Downward movement is accumulated, and an upward move forgets it, so a
 *   scroll that wobbles around a spot never adds up to a hide.
 * - While `frozen` says so, nothing changes in either direction: a selection,
 *   an open sheet or a programmatic jump is not the person reading, and moving
 *   the controls under a thumb that is holding a selection handle loses it.
 *
 * The position is still tracked while frozen, so the first movement after the
 * freeze is measured from where the text is and not from where it was.
 */
export function useReaderChromeVisibility(
  scroller: Ref<HTMLElement | undefined>,
  options: { frozen: () => boolean }
): { hidden: Ref<boolean>; reset: () => void } {
  const hidden = ref(false)
  let lastTop = 0
  let travelled = 0
  let element: HTMLElement | undefined

  function onScroll(): void {
    if (!element) return
    const top = element.scrollTop
    const delta = top - lastTop
    lastTop = top
    if (options.frozen()) {
      travelled = 0
      return
    }
    if (delta <= -1) {
      travelled = 0
      hidden.value = false
      return
    }
    if (delta <= 0) return
    if (top < element.clientHeight) {
      travelled = 0
      return
    }
    travelled += delta
    if (travelled >= HIDE_AFTER_PX) hidden.value = true
  }

  function reset(): void {
    hidden.value = false
    travelled = 0
    lastTop = element?.scrollTop ?? 0
  }

  watch(
    scroller,
    (next) => {
      element?.removeEventListener('scroll', onScroll)
      element = next
      lastTop = next?.scrollTop ?? 0
      travelled = 0
      next?.addEventListener('scroll', onScroll, { passive: true })
    },
    { immediate: true, flush: 'post' }
  )

  onBeforeUnmount(() => element?.removeEventListener('scroll', onScroll))

  return { hidden, reset }
}
