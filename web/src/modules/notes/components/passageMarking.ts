/**
 * Finding a highlighted passage in the rendered article, and wrapping it.
 *
 * The rule for deciding where a passage sits is the server's
 * (`server/internal/notes/anchor.go`), restated over the DOM: the whitespace of
 * the article and of the stored passage is collapsed, every occurrence of the
 * passage is found, and an occurrence counts only when the stored context is
 * what surrounds it. Exactly one such occurrence is the passage; none or
 * several mean nothing is marked, because marking the nearer of two identical
 * sentences would move the person's mark to words they never read.
 */

interface CollapsedText {
  /** One entry per code point of the article's whitespace-collapsed text. */
  chars: string[]
  /** Where each of those code points lives in the DOM. */
  origins: Array<{ node: Text; offset: number }>
}

export interface PassageQuery {
  exact: string
  prefix: string
  suffix: string
  position_hint: number
}

const WHITESPACE = /\s/u

/** Every run of whitespace becomes one space, and the ends are trimmed. */
function collapse(value: string): string {
  return value.split(/\s+/u).filter((word) => word !== '').join(' ')
}

/**
 * The article's text as the server sees it, with a map back into the DOM.
 * Text nodes are concatenated with no separator of their own: the whitespace
 * between two blocks is already in the markup, and an inline element such as
 * `<em>` must not split the word it sits inside.
 */
function collapsedTextOf(root: HTMLElement): CollapsedText {
  const chars: string[] = []
  const origins: CollapsedText['origins'] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text
    let offset = 0
    for (const char of text.data) {
      const isSpace = WHITESPACE.test(char)
      const previousIsSpace = chars.length === 0 || chars[chars.length - 1] === ' '
      if (!(isSpace && previousIsSpace)) {
        chars.push(isSpace ? ' ' : char)
        origins.push({ node: text, offset })
      }
      offset += char.length
    }
  }
  if (chars[chars.length - 1] === ' ') {
    chars.pop()
    origins.pop()
  }
  return { chars, origins }
}

function occurrencesOf(haystack: string[], needle: string[]): number[] {
  const found: number[] = []
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((char, index) => haystack[start + index] === char)) found.push(start)
  }
  return found
}

/** Whether `want` is what comes just before `start`, over the overlap only. */
function tailMatches(chars: string[], start: number, want: string[]): boolean {
  let end = start
  while (end > 0 && chars[end - 1] === ' ') end--
  const overlap = Math.min(end, want.length)
  for (let back = 1; back <= overlap; back++) {
    if (chars[end - back] !== want[want.length - back]) return false
  }
  return true
}

/** Whether `want` is what comes just after `from`, over the overlap only. */
function headMatches(chars: string[], from: number, want: string[]): boolean {
  let begin = from
  while (begin < chars.length && chars[begin] === ' ') begin++
  const overlap = Math.min(chars.length - begin, want.length)
  for (let index = 0; index < overlap; index++) {
    if (chars[begin + index] !== want[index]) return false
  }
  return true
}

/**
 * The code-point range [start, end) of the one occurrence the stored context
 * singles out, or null when there is none or more than one.
 */
function locate(text: CollapsedText, query: PassageQuery): [number, number] | null {
  const needle = [...collapse(query.exact)]
  if (needle.length === 0) return null
  const wantPrefix = [...collapse(query.prefix)]
  const wantSuffix = [...collapse(query.suffix)]
  // The hint orders the search and never decides it, as on the server; with a
  // unique-match rule the order cannot change the answer.
  const occurrences = occurrencesOf(text.chars, needle).sort(
    (a, b) => Math.abs(a - query.position_hint) - Math.abs(b - query.position_hint)
  )
  const matches = occurrences.filter(
    (start) =>
      tailMatches(text.chars, start, wantPrefix) && headMatches(text.chars, start + needle.length, wantSuffix)
  )
  return matches.length === 1 ? [matches[0], matches[0] + needle.length] : null
}

interface Slice {
  node: Text
  from: number
  to: number
}

/** The stretch of each text node the range covers, in document order. */
function slicesOf(text: CollapsedText, start: number, end: number): Slice[] {
  const slices: Slice[] = []
  for (let index = start; index < end; index++) {
    const { node, offset } = text.origins[index]
    const to = offset + text.chars[index].length
    const last = slices[slices.length - 1]
    if (last && last.node === node) last.to = Math.max(last.to, to)
    else slices.push({ node, from: offset, to })
  }
  return slices
}

/**
 * Wrap the passage where it sits in `root`, one `<mark>` per text node it
 * touches, so a passage crossing `<em>` or `<a>` is marked without rewriting
 * the article's own structure. Returns whether anything was marked.
 */
export function markPassage(root: HTMLElement, query: PassageQuery): boolean {
  const text = collapsedTextOf(root)
  const range = locate(text, query)
  if (!range) return false
  let marked = false
  for (const slice of slicesOf(text, range[0], range[1])) {
    // A whitespace-only slice is the gap between two elements; wrapping it
    // would put a mark where the markup (a list, a table row) may not allow one.
    if (slice.node.data.slice(slice.from, slice.to).trim() === '') continue
    const around = document.createRange()
    around.setStart(slice.node, slice.from)
    around.setEnd(slice.node, slice.to)
    const mark = document.createElement('mark')
    mark.className = 'notes-passage'
    mark.dataset.notesPassage = query.exact
    around.surroundContents(mark)
    marked = true
  }
  return marked
}
