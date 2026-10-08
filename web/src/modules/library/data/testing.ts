import type {
  ExtractAck,
  LibraryCounts,
  LibraryItemList,
  LibraryItemRecord,
  LibraryItemSummary,
  LibraryKind,
  LibraryListQuery,
  LibraryPatch,
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
const KINDS: LibraryKind[] = ['post', 'livro', 'paper', 'video', 'podcast', 'newsletter', 'curso']

const DEFAULT_LIMIT = 50

/** One record, with everything the contract requires already filled in. */
export function libraryRecord(overrides: Partial<LibraryItemRecord> = {}): LibraryItemRecord {
  const id = overrides.id ?? 'item-1'
  return {
    id,
    kind: 'post',
    url: `https://example.com/${id}`,
    canonical_url: `https://example.com/${id}`,
    title: `Texto ${id}`,
    title_edited: false,
    status: 'inbox',
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
}

export interface FakeLibrarySource extends LibrarySource {
  records: LibraryItemRecord[]
  calls: FakeLibraryCalls
}

function matchesQuery(record: LibraryItemRecord, query: LibraryListQuery): boolean {
  if (query.view && query.view !== 'tudo' && record.status !== query.view) return false
  if (query.tipo && record.kind !== query.tipo) return false
  if (query.unread !== null && query.unread !== undefined && record.unread !== query.unread) return false
  const needle = query.q?.trim().toLocaleLowerCase('pt-BR')
  if (needle && !record.title.toLocaleLowerCase('pt-BR').includes(needle)) return false
  return true
}

function ordered(records: LibraryItemRecord[], sort: LibraryListQuery['sort']): LibraryItemRecord[] {
  const rows = [...records]
  if (sort === 'title') return rows.sort((left, right) => left.title.localeCompare(right.title, 'pt-BR'))
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
  const calls: FakeLibraryCalls = { list: [], get: [], counts: 0, save: [], patch: [], open: [], extract: [] }

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
      const selected = ordered(
        held.filter((record) => matchesQuery(record, query)),
        query.sort
      )
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
      const byStatus = (status: string): number => held.filter((record) => record.status === status).length
      return {
        views: {
          inbox: byStatus('inbox'),
          depois: byStatus('depois'),
          arquivo: byStatus('arquivo'),
          tudo: held.length
        },
        kinds: Object.fromEntries(
          KINDS.map((kind) => [kind, held.filter((record) => record.kind === kind).length])
        ) as LibraryCounts['kinds'],
        unread: held.filter((record) => record.unread).length
      }
    },

    async saveLink(link: NewSavedLink): Promise<LibraryItemRecord> {
      calls.save.push(link)
      const created = libraryRecord({
        id: `item-${held.length + 1}`,
        url: link.url,
        canonical_url: link.url,
        title: link.url,
        ...(link.why ? { why: link.why } : {}),
        extract_status: 'pending'
      })
      held.unshift(created)
      return created
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

    ...overrides
  }

  return source
}
