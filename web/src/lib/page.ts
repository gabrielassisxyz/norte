/**
 * The shape every list read answers with, which is the shape the API will
 * answer with: the rows asked for, the cursor that continues them, and the
 * counts the screen puts on its own tabs.
 *
 * `next_cursor` is snake_case because it is a field of the response rather than
 * a name this code chose, and renaming it here would hide where it comes from.
 * It is null while a list has no further page, which is every mock read today.
 */
export interface Page<TItem, TCounts> {
  items: TItem[]
  next_cursor: string | null
  counts: TCounts
}

/** A page with nothing in it, for a filter that matches no record. */
export function emptyPage<TItem, TCounts>(counts: TCounts): Page<TItem, TCounts> {
  return { items: [], next_cursor: null, counts }
}
