import type {
  CoreFocus,
  CoreLink,
  CoreLinkKind,
  CoreLinkPage,
  CoreLinkQuery,
  CoreSource,
  RegistryItem,
  Subject,
  SubjectListQuery,
  SubjectPage,
  SubjectPatch
} from './source'

/**
 * A core source a test drives, holding its subjects and links in memory.
 *
 * It is here rather than in a test file because several suites need it — the
 * subject screen, the panel, the picker, the sidebar, the Estudo home — and
 * because the search ranking, the ordering and the cursor have to behave the
 * way the server does for a pagination or a search test to mean anything. The
 * application never constructs it: `main.ts` installs the API source, and this
 * module is named by test files only.
 */
const DEFAULT_LIMIT = 50

/** One subject, with everything the contract requires already filled in. */
export function subjectRecord(overrides: Partial<Subject> = {}): Subject {
  const name = overrides.name ?? 'Um assunto'
  const slug = overrides.slug ?? slugify(name)
  return {
    id: overrides.id ?? `subject-${slug}`,
    name,
    slug,
    focus: false,
    created_at: '2026-10-07T12:00:00.000Z',
    counts: { total: 0, by_type: [] },
    link_count: 0,
    ...overrides
  }
}

/** One registry item, which is one end of a link. */
export function registryItem(overrides: Partial<RegistryItem> = {}): RegistryItem {
  const id = overrides.id ?? 'item-1'
  return {
    id,
    module: 'library',
    type: 'post',
    title: `Texto ${id}`,
    url: `/biblioteca/${id}`,
    ...overrides
  }
}

/** One link between two registry items. */
export function coreLink(overrides: Partial<CoreLink> = {}): CoreLink {
  return {
    id: overrides.id ?? 'link-1',
    kind: 'about',
    source: 'manual',
    status: 'confirmed',
    created_at: '2026-10-07T12:00:00.000Z',
    src: registryItem(),
    dst: registryItem({ id: 'subject-1', module: 'core', type: 'subject', title: 'Um assunto' }),
    ...overrides
  }
}

/**
 * The same derivation the server does, so a fake answering a search behaves
 * the way the real one does: lowercase, accents stripped, anything else a
 * separator.
 */
function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/\p{Mn}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
}

/** Every call a test may want to assert on, in the order they were made. */
export interface FakeCoreCalls {
  listSubjects: SubjectListQuery[]
  getSubjectBySlug: string[]
  getSubject: string[]
  createSubject: string[]
  patchSubject: Array<{ id: string; patch: SubjectPatch }>
  deleteSubject: string[]
  focus: number
  listLinks: CoreLinkQuery[]
  createLink: Array<{ srcId: string; dstId: string; kind: CoreLinkKind }>
  decideLink: Array<{ id: string; decision: 'accept' | 'reject' }>
}

export interface FakeCoreSource extends CoreSource {
  subjects: Subject[]
  links: CoreLink[]
  calls: FakeCoreCalls
}

/** 0 exact, 1 prefix, 2 substring, null no match — the server's ranking. */
function rankOf(subject: Subject, needle: string): number | null {
  if (subject.slug === needle) return 0
  if (subject.slug.startsWith(needle)) return 1
  if (subject.slug.includes(needle)) return 2
  return null
}

export function fakeCoreSource(
  seed: { subjects?: Subject[]; links?: CoreLink[] } = {},
  overrides: Partial<CoreSource> = {}
): FakeCoreSource {
  const subjects = [...(seed.subjects ?? [])]
  const links = [...(seed.links ?? [])]
  const calls: FakeCoreCalls = {
    listSubjects: [],
    getSubjectBySlug: [],
    getSubject: [],
    createSubject: [],
    patchSubject: [],
    deleteSubject: [],
    focus: 0,
    listLinks: [],
    createLink: [],
    decideLink: []
  }

  function requireSubject(id: string): Subject {
    const found = subjects.find((subject) => subject.id === id)
    if (!found) throw new Error(`no subject ${id}`)
    return found
  }

  const source: FakeCoreSource = {
    subjects,
    links,
    calls,

    async listSubjects(query: SubjectListQuery): Promise<SubjectPage> {
      calls.listSubjects.push({ ...query })
      const needle = query.q?.trim() ? slugify(query.q) : ''
      const ranked = subjects
        .map((subject) => ({ subject, rank: needle ? rankOf(subject, needle) : 0 }))
        .filter((entry): entry is { subject: Subject; rank: number } => entry.rank !== null)
        .sort((left, right) => left.rank - right.rank || left.subject.slug.localeCompare(right.subject.slug))
        .map((entry) => entry.subject)
      // The cursor is the offset it was issued at, which is the simplest thing
      // that still makes a second page a different page.
      const from = query.cursor ? Number(query.cursor) : 0
      const limit = query.limit ?? DEFAULT_LIMIT
      const page = ranked.slice(from, from + limit)
      return { items: page, next_cursor: from + limit < ranked.length ? String(from + limit) : null }
    },

    async getSubjectBySlug(slug: string): Promise<Subject | null> {
      calls.getSubjectBySlug.push(slug)
      return subjects.find((subject) => subject.slug === slug) ?? null
    },

    async getSubject(id: string): Promise<Subject | null> {
      calls.getSubject.push(id)
      return subjects.find((subject) => subject.id === id) ?? null
    },

    async createSubject(name: string): Promise<Subject> {
      calls.createSubject.push(name)
      const slug = slugify(name)
      if (subjects.some((subject) => subject.slug === slug)) {
        throw new Error(`the slug "${slug}" is already taken`)
      }
      const created = subjectRecord({ id: `subject-${slug}`, name, slug })
      subjects.push(created)
      return created
    },

    async patchSubject(id: string, patch: SubjectPatch): Promise<Subject> {
      calls.patchSubject.push({ id, patch: { ...patch } })
      const subject = requireSubject(id)
      if (patch.name !== undefined) {
        subject.name = patch.name
        subject.slug = slugify(patch.name)
      }
      if (patch.focus !== undefined) subject.focus = patch.focus
      return { ...subject }
    },

    async deleteSubject(id: string): Promise<void> {
      calls.deleteSubject.push(id)
      const subject = requireSubject(id)
      subjects.splice(subjects.indexOf(subject), 1)
      // The real delete cascades through the registry row, so the fake has to
      // drop the links too or a panel would keep rendering them.
      for (let index = links.length - 1; index >= 0; index -= 1) {
        const link = links[index]
        if (link !== undefined && (link.src.id === id || link.dst.id === id)) links.splice(index, 1)
      }
    },

    async focus(): Promise<CoreFocus> {
      calls.focus += 1
      return { subjects: subjects.filter((subject) => subject.focus), targets: [] }
    },

    async listLinks(query: CoreLinkQuery): Promise<CoreLinkPage> {
      calls.listLinks.push({ ...query })
      const selected = links
        .filter((link) => !query.src_id || link.src.id === query.src_id)
        .filter((link) => !query.dst_id || link.dst.id === query.dst_id)
        .filter((link) => !query.kind || link.kind === query.kind)
        .filter((link) => !query.status || link.status === query.status)
        .sort((left, right) => right.created_at.localeCompare(left.created_at))
      const from = query.cursor ? Number(query.cursor) : 0
      const limit = query.limit ?? DEFAULT_LIMIT
      const page = selected.slice(from, from + limit)
      return { items: page, next_cursor: from + limit < selected.length ? String(from + limit) : null }
    },

    async createLink(srcId: string, dstId: string, kind: CoreLinkKind = 'about'): Promise<CoreLink> {
      calls.createLink.push({ srcId, dstId, kind })
      const existing = links.find(
        (link) => link.src.id === srcId && link.dst.id === dstId && link.kind === kind
      )
      if (existing) {
        existing.status = 'confirmed'
        existing.source = 'manual'
        existing.decided_at = '2026-10-07T13:00:00.000Z'
        return { ...existing }
      }
      const subject = subjects.find((candidate) => candidate.id === dstId)
      const created = coreLink({
        id: `link-${links.length + 1}`,
        kind,
        src: registryItem({ id: srcId }),
        dst: subject
          ? registryItem({ id: subject.id, module: 'core', type: 'subject', title: subject.name })
          : registryItem({ id: dstId }),
        decided_at: '2026-10-07T13:00:00.000Z'
      })
      links.push(created)
      return created
    },

    async decideLink(id: string, decision: 'accept' | 'reject'): Promise<CoreLink> {
      calls.decideLink.push({ id, decision })
      const link = links.find((candidate) => candidate.id === id)
      if (!link) throw new Error(`no link ${id}`)
      link.status = decision === 'accept' ? 'confirmed' : 'rejected'
      link.decided_at = '2026-10-07T13:00:00.000Z'
      return { ...link }
    },

    ...overrides
  }

  return source
}
