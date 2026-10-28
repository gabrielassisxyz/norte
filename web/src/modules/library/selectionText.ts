const BLOCK_ELEMENTS = 'p, div, li, blockquote, h1, h2, h3, h4, h5, h6, pre, td, th, figcaption'

/**
 * The text a range covers, with one space where it passes from one block into
 * the next.
 *
 * `Range.toString()` concatenates text nodes, and the sanitized article has no
 * whitespace between `</p>` and `<p>`, so a selection across two paragraphs
 * reads "character.I say". The space is there for people: it is what the notes
 * panel shows for the passage. Matching does not depend on it. A boundary is a
 * change of nearest block-level ancestor, so `<em>`, `<a>` and `<code>` inside
 * a paragraph add nothing, and a break that already has whitespace on either
 * side gets no second one.
 */
export function textWithBlockBreaks(range: Range): string {
  const container = range.commonAncestorContainer
  const nodes: Text[] = []
  if (container.nodeType === Node.TEXT_NODE) {
    nodes.push(container as Text)
  } else {
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT)
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (range.intersectsNode(node)) nodes.push(node as Text)
    }
  }
  let text = ''
  let previousBlock: Element | null | undefined
  for (const node of nodes) {
    const from = node === range.startContainer ? range.startOffset : 0
    const to = node === range.endContainer ? range.endOffset : node.data.length
    const slice = node.data.slice(from, to)
    if (slice === '') continue
    const block = node.parentElement?.closest(BLOCK_ELEMENTS) ?? null
    const crossesBlock = previousBlock !== undefined && block !== previousBlock
    if (crossesBlock && !/\s$/u.test(text) && !/^\s/u.test(slice)) text += ' '
    text += slice
    previousBlock = block
  }
  return text
}
