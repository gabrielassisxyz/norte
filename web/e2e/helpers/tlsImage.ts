import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { createServer, type Server } from 'node:https'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'

const run = promisify(execFile)

/**
 * A local HTTPS listener serving one image, under a certificate nothing signed.
 *
 * The content security policy allows images from `https:` and from nothing
 * else, and the only honest way to exercise that allowance is an https origin
 * the policy has to match. Reaching the real internet from the gate is not an
 * option — it would make the check fail on a train — so the origin is local and
 * the browser is launched with `ignoreHTTPSErrors`, which skips the certificate
 * and changes nothing about how the policy is applied.
 */
export interface TlsImageServer {
  /** The absolute https URL of the image, for an <img src>. */
  imageURL: string
  stop(): Promise<void>
}

/** An 8x8 opaque PNG, small enough to carry here and real enough to decode. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIAQMAAAD+wSzIAAAABlBMVEX///+/v7+jQ3Y5AAAADklEQVQI12P4AIX8EAgALgAD/aNpbtEAAAAASUVORK5CYII=',
  'base64'
)

async function selfSignedPair(): Promise<{ dir: string; key: Buffer; cert: Buffer }> {
  const dir = await mkdtemp(join(tmpdir(), 'norte-e2e-tls-'))
  await run('openssl', [
    'req',
    '-x509',
    '-newkey',
    'rsa:2048',
    '-nodes',
    '-keyout',
    join(dir, 'key.pem'),
    '-out',
    join(dir, 'cert.pem'),
    '-days',
    '1',
    '-subj',
    '/CN=127.0.0.1'
  ])
  return {
    dir,
    key: await readFile(join(dir, 'key.pem')),
    cert: await readFile(join(dir, 'cert.pem'))
  }
}

export async function startTlsImage(): Promise<TlsImageServer> {
  const { dir, key, cert } = await selfSignedPair()
  const server: Server = createServer({ key, cert }, (request, response) => {
    if (request.url !== '/pixel.png') {
      response.writeHead(404).end()
      return
    }
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': String(PNG.length) })
    response.end(PNG)
  })
  await new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') {
    throw new Error('the TLS image listener reported no port')
  }
  return {
    imageURL: `https://127.0.0.1:${address.port}/pixel.png`,
    async stop() {
      await new Promise<void>((resolve) => server.close(() => resolve()))
      await rm(dir, { recursive: true, force: true })
    }
  }
}
