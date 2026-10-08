import { spawn, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:net'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * A real `norte serve`, on a port of its own and a data directory of its own.
 *
 * The suites here drive the app the binary serves — the built frontend under
 * the server's content security policy — because that is the only place the
 * policy, the drawer's media query and a touch selection all exist at once. A
 * component test can prove none of the three.
 *
 * Every run gets a temporary `NORTE_DATA`: nothing here may go near whatever is
 * installed on the machine running the gate.
 */
export interface NorteServer {
  baseURL: string
  dataDir: string
  stop(): Promise<void>
}

const REPO_ROOT = fileURLToPath(new URL('../../../', import.meta.url))
const BINARY = join(REPO_ROOT, 'server', 'norte')

/** A port nothing is listening on, by letting the kernel pick one and letting it go. */
async function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = createServer()
    probe.on('error', reject)
    probe.listen(0, '127.0.0.1', () => {
      const address = probe.address()
      if (address === null || typeof address === 'string') {
        probe.close(() => reject(new Error('the probe listener reported no port')))
        return
      }
      probe.close(() => resolve(address.port))
    })
  })
}

async function waitForHealth(baseURL: string, child: ChildProcess, log: () => string): Promise<void> {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`norte serve exited with ${child.exitCode} before answering:\n${log()}`)
    }
    try {
      const answer = await fetch(`${baseURL}/api/health`)
      if (answer.ok) return
    } catch {
      // Not listening yet; the deadline is the only thing that gives up.
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`norte serve did not answer /api/health in 30s:\n${log()}`)
}

export async function startNorte(): Promise<NorteServer> {
  const dataDir = await mkdtemp(join(tmpdir(), 'norte-e2e-'))
  const port = await freePort()
  const baseURL = `http://127.0.0.1:${port}`
  const child = spawn(BINARY, ['serve'], {
    env: {
      ...process.env,
      NORTE_DATA: dataDir,
      NORTE_LISTEN: `127.0.0.1:${port}`,
      NORTE_LOG_LEVEL: 'warn'
    },
    stdio: ['ignore', 'pipe', 'pipe']
  })
  let output = ''
  const collect = (chunk: Buffer): void => {
    output += chunk.toString()
  }
  child.stdout?.on('data', collect)
  child.stderr?.on('data', collect)
  child.on('error', (cause) => {
    output += `\nspawning ${BINARY} failed: ${cause.message}\nbin/generate && (cd server && go build -o norte ./cmd/norte) builds it`
  })

  try {
    await waitForHealth(baseURL, child, () => output)
  } catch (cause) {
    child.kill('SIGKILL')
    await rm(dataDir, { recursive: true, force: true })
    throw cause
  }

  return {
    baseURL,
    dataDir,
    async stop() {
      if (child.exitCode === null) {
        const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()))
        child.kill('SIGTERM')
        await Promise.race([exited, new Promise((resolve) => setTimeout(resolve, 5_000))])
        if (child.exitCode === null) child.kill('SIGKILL')
      }
      await rm(dataDir, { recursive: true, force: true })
    }
  }
}

/** The API, as the app itself calls it, which is how a step's effect is checked. */
export async function api<T>(baseURL: string, path: string, init?: RequestInit): Promise<T> {
  const answer = await fetch(`${baseURL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) }
  })
  const body = await answer.text()
  if (!answer.ok) throw new Error(`${init?.method ?? 'GET'} ${path} answered ${answer.status}: ${body}`)
  return (body ? JSON.parse(body) : null) as T
}

export interface SeededArticle {
  id: string
  title: string
}

/**
 * One extracted article in the library, from an HTML snapshot the save carries.
 *
 * The snapshot is what keeps this off the network: extraction reads the stored
 * bytes and only fetches when there are none, so a seeded item reaches
 * `extract_status: done` without the server resolving a single name.
 */
export async function seedArticle(
  baseURL: string,
  article: { url: string; title: string; html: string }
): Promise<SeededArticle> {
  const saved = await api<{ id: string }>(baseURL, '/api/library/items', {
    method: 'POST',
    body: JSON.stringify({ url: article.url, title: article.title, html: article.html })
  })
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const item = await api<{ extract_status: string; extract_error?: string; title: string }>(
      baseURL,
      `/api/library/items/${saved.id}`
    )
    if (item.extract_status === 'done') return { id: saved.id, title: item.title }
    if (item.extract_status === 'failed') {
      throw new Error(`extraction of the seeded article failed: ${item.extract_error ?? 'no reason given'}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('the seeded article was still being extracted after 30s')
}
