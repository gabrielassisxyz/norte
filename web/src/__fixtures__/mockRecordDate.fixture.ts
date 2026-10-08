/**
 * A planted violation: a mock record whose timestamps are written into the
 * code, so the data stops ageing the moment it is committed. See `README.md`
 * in this folder.
 */
export const plantedItem = {
  id: 'post-planted',
  savedAt: '2026-10-03',
  readAt: '2026-10-01'
}
