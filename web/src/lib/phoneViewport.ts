import { onBeforeUnmount, ref, type Ref } from 'vue'

/**
 * The width at or below which the shell and the reader take their phone shape.
 *
 * The stylesheets carry the same number in their media queries, and this copy
 * exists because a media query is not readable from script: the drawer, the
 * reader's bottom bar and the row menus are behaviour as well as layout, and
 * behaviour has to agree with the CSS about where the line is. Changing one
 * without the other is what leaves a control rendered where nothing shows it.
 */
export const PHONE_VIEWPORT_MAX_PX = 900

/**
 * Whether the viewport is phone-sized, as a flag that follows a resize.
 *
 * A missing `matchMedia` answers "not a phone" rather than failing: jsdom has
 * one that reports every query false, so a component test is on the wide shape
 * unless it stubs the API, and a test that wants the phone shape says so.
 */
export function usePhoneViewport(): Ref<boolean> {
  const query = `(max-width: ${PHONE_VIEWPORT_MAX_PX}px)`
  const list =
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia(query)
      : null
  const phone = ref(list?.matches === true)
  if (list?.addEventListener) {
    const update = (event: MediaQueryListEvent): void => {
      phone.value = event.matches
    }
    list.addEventListener('change', update)
    onBeforeUnmount(() => list.removeEventListener('change', update))
  }
  return phone
}
