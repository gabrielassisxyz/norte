import type { LibraryItem } from '@/mock/types'

import type { LibraryCounts } from './source'

/**
 * The counts a library list carries.
 *
 * It lives beside the source interface rather than in the source itself because
 * both ends need it: whoever answers a list computes them, and a page that
 * applies a write's response recomputes them over the rows it is now holding,
 * instead of adding and subtracting one by hand.
 */
export function countLibraryItems(items: LibraryItem[]): LibraryCounts {
  return {
    inbox: items.filter((item) => item.status === 'inbox').length,
    depois: items.filter((item) => item.status === 'depois').length,
    arquivo: items.filter((item) => item.status === 'arquivo').length,
    tudo: items.length,
    unread: items.filter((item) => item.unread).length
  }
}
