import type {
  ExtractAck,
  LibraryCounts,
  LibraryDrawQuery,
  LibraryItemList,
  LibraryItemRecord,
  LibraryItemSummary,
  LibraryKind,
  LibraryListQuery,
  LibraryPatch,
  LibrarySaveOutcome,
  LibrarySource,
  NewSavedLink
} from './source'

/**
 * A library source a test drives, holding its records in memory.
 *
 * It is here rather than in a test file because several suites need it — the
 * library's own screens, the shell's sidebar, the command palette — and because
 * the filtering, the ordering and the cursor have to behave the way the server
 * does for a pagination or a filter test to mean anything. The application
 * never constructs it: `main.ts` installs the API source, and this module is
 * named by test files only.
 */
const KINDS: LibraryKind[] = ['article', 'book', 'paper', 'video', 'podcast', 'newsletter', 'course']

const DEFAULT_LIMIT = 50

/** One record, with everything the contract requires already filled in. */
export function libraryRecord(overrides: Partial<LibraryItemRecord> = {}): LibraryItemRecord {
  const id = overrides.id ?? 'item-1'
  return {
    id,
    kind: 'article',
    url: `https://example.com/${id}`,
    canonical_url: `https://example.com/${id}`,
    title: `Texto ${id}`,
    title_edited: false,
    location: 'inbox',
    unread: true,
    saved_at: '2026-10-03T12:00:00Z',
    source: 'app',
    extract_status: 'done',
    extract_generation: 1,
    created_at: '2026-10-03T12:00:00Z',
    updated_at: '2026-10-03T12:00:00Z',
    ...overrides
  }
}

/** A summary of a record, which is a list row: the text never travels in one. */
export function librarySummaryOf(record: LibraryItemRecord): LibraryItemSummary {
  const summary: LibraryItemRecord = { ...record }
  delete summary.content_html
  delete summary.content_text
  return summary
}

/** Every call a test may want to assert on, in the order they were made. */
export interface FakeLibraryCalls {
  list: LibraryListQuery[]
  get: string[]
  counts: number
  save: NewSavedLink[]
  patch: Array<{ id: string; patch: LibraryPatch }>
  open: string[]
  extract: string[]
  draw: LibraryDrawQuery[]
}

export interface FakeLibrarySource extends LibrarySource {
  records: LibraryItemRecord[]
  calls: FakeLibraryCalls
}

function matchesQuery(record: LibraryItemRecord, query: LibraryListQuery): boolean {
  if (query.kind && record.kind !== query.kind) return false
  if (query.unread !== null && query.unread !== undefined && record.unread !== query.unread) return false
  const needle = query.q?.trim().toLocaleLowerCase('en')
  if (needle && !record.title.toLocaleLowerCase('en').includes(needle)) return false
  // view=suggestions is not a location: it reads every one of them, so only
  // the filters above narrow it.
  if (query.view === 'suggestions') return true
  if (query.view && query.view !== 'all' && record.location !== query.view) return false
  return true
}

/**
 * The focus score a test gave a record, or none.
 *
 * The fake holds no links, so the score cannot be derived here the way the
 * server derives it. A test that cares about the ranking states the score it
 * means on the record's `reason` as `focus:<number>`, which keeps the shape of
 * the record the contract's and the fixture readable in one line.
 */
function fakeFocusScore(record: LibraryItemRecord): number {
  const marked = /(?:^|\s)focus:(\d+(?:\.\d+)?)/.exec(record.reason ?? '')
  return marked ? Number(marked[1]) : 0
}

function ordered(records: LibraryItemRecord[], sort: LibraryListQuery['sort']): LibraryItemRecord[] {
  const rows = [...records]
  if (sort === 'title') return rows.sort((left, right) => left.title.localeCompare(right.title, 'en'))
  if (sort === 'saved_asc') return rows.sort((left, right) => left.saved_at.localeCompare(right.saved_at))
  if (sort === 'last_opened_desc') {
    return rows
      .filter((row) => row.last_opened_at)
      .sort((left, right) => (right.last_opened_at ?? '').localeCompare(left.last_opened_at ?? ''))
  }
  return rows.sort((left, right) => right.saved_at.localeCompare(left.saved_at))
}

export function fakeLibrarySource(
  records: LibraryItemRecord[] = [],
  overrides: Partial<LibrarySource> = {}
): FakeLibrarySource {
  const held = [...records]
  const calls: FakeLibraryCalls = {
    list: [],
    get: [],
    counts: 0,
    save: [],
    patch: [],
    open: [],
    extract: [],
    draw: []
  }

  function requireRecord(id: string): LibraryItemRecord {
    const found = held.find((record) => record.id === id)
    if (!found) throw new Error(`no library item ${id}`)
    return found
  }

  const source: FakeLibrarySource = {
    records: held,
    calls,

    async listItems(query: LibraryListQuery): Promise<LibraryItemList> {
      calls.list.push({ ...query })
      const matching = held.filter((record) => matchesQuery(record, query))
      // Suggestions orders by the focus score, then by what is still unread
      // within one score, then by the saved order -- the same keys the server
      // uses, because a fake that ranked by the score alone would let a screen
      // test pass against an order the server does not produce.
      const selected =
        query.view === 'suggestions'
          ? ordered(matching, 'saved_desc').sort(
              (left, right) =>
                fakeFocusScore(right) - fakeFocusScore(left) ||
                Number(right.unread) - Number(left.unread)
            )
          : ordered(matching, query.sort)
      // The cursor is the offset it was issued at, which is the simplest thing
      // that still makes a second page a different page.
      const from = query.cursor ? Number(query.cursor) : 0
      const limit = query.limit ?? DEFAULT_LIMIT
      const page = selected.slice(from, from + limit)
      const next = from + limit < selected.length ? String(from + limit) : null
      return { items: page.map(librarySummaryOf), next_cursor: next }
    },

    async getItem(id: string): Promise<LibraryItemRecord | null> {
      calls.get.push(id)
      return held.find((record) => record.id === id) ?? null
    },

    async counts(): Promise<LibraryCounts> {
      calls.counts += 1
      const byLocation = (location: string): number =>
        held.filter((record) => record.location === location).length
      return {
        views: {
          inbox: byLocation('inbox'),
          up_next: byLocation('up_next'),
          later: byLocation('later'),
          archive: byLocation('archive'),
          stash: byLocation('stash'),
          all: held.length
        },
        kinds: Object.fromEntries(
          KINDS.map((kind) => [kind, held.filter((record) => record.kind === kind).length])
        ) as LibraryCounts['kinds'],
        unread: held.filter((record) => record.unread).length
      }
    },

    async saveLink(link: NewSavedLink): Promise<LibrarySaveOutcome> {
      calls.save.push(link)
      // Like the server, a save whose canonical URL is already held folds into
      // the existing item instead of creating a second copy.
      const existing = held.find((record) => record.canonical_url === link.url || record.url === link.url)
      if (existing) {
        if (link.reason?.trim()) existing.reason = link.reason.trim()
        return { record: { ...existing }, duplicate: true }
      }
      const created = libraryRecord({
        id: `item-${held.length + 1}`,
        url: link.url,
        canonical_url: link.url,
        title: link.url,
        ...(link.reason ? { reason: link.reason } : {}),
        extract_status: 'pending'
      })
      held.unshift(created)
      return { record: created, duplicate: false }
    },

    async patchItem(id: string, patch: LibraryPatch): Promise<LibraryItemRecord> {
      calls.patch.push({ id, patch: { ...patch } })
      const record = requireRecord(id)
      Object.assign(record, patch)
      if (patch.unread === false) record.read_at = '2026-10-03T13:00:00Z'
      if (patch.unread === true) delete record.read_at
      return { ...record }
    },

    async openItem(id: string): Promise<LibraryItemRecord> {
      calls.open.push(id)
      const record = requireRecord(id)
      record.last_opened_at = '2026-10-03T13:00:00Z'
      return { ...record }
    },

    async extractItem(id: string): Promise<ExtractAck> {
      calls.extract.push(id)
      const record = requireRecord(id)
      record.extract_status = 'pending'
      record.extract_generation += 1
      delete record.extract_error
      return { item_id: id, job_id: `job-${record.extract_generation}`, extract_generation: record.extract_generation }
    },

    /**
     * A draw over the unread records, taken from the front rather than at
     * random: a test asserting which item the button opened needs to know
     * which one came back, and randomness here would only be the server's
     * randomness badly imitated.
     */
    async drawItems(query: LibraryDrawQuery): Promise<LibraryItemSummary[]> {
      calls.draw.push({ ...query })
      const unread = held.filter((record) => record.unread)
      return unread.slice(0, query.n ?? 1).map(librarySummaryOf)
    },

    ...overrides
  }

  return source
}
