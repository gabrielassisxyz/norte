import type { LibraryHeading } from './data/source'

/**
 * How far an element sits below the top of the scroller's content.
 *
 * Measured from the rects rather than from `offsetTop`, which counts from the
 * nearest positioned ancestor and so depends on how the article is wrapped.
 */
export function offsetWithin(container: HTMLElement, element: HTMLElement): number {
  return container.scrollTop + element.getBoundingClientRect().top - container.getBoundingClientRect().top
}

/** The rendered element a heading's anchor names, or null when the sanitizer left it out. */
export function headingElement(container: HTMLElement, anchor: string): HTMLElement | null {
  const found = container.querySelector(`[id="${CSS.escape(anchor)}"]`)
  return found instanceof HTMLElement ? found : null
}

/**
 * The heading nearest above the top of the viewport.
 *
 * The saved reading position and the contents drawer both ask this, so the
 * section the drawer marks is the one the position would be saved under.
 *
 * `slack` is how far below the top a heading may still sit and count as the
 * one above it. The drawer lands a heading 16 px under the top edge, so it
 * widens this to keep the heading it just scrolled to as the current one.
 */
export function currentHeadingAnchor(
  container: HTMLElement,
  headings: LibraryHeading[],
  slack = 1
): string | undefined {
  let found: string | undefined
  for (const heading of headings) {
    const element = headingElement(container, heading.anchor)
    if (!element) continue
    if (offsetWithin(container, element) > container.scrollTop + slack) break
    found = heading.anchor
  }
  return found
}
