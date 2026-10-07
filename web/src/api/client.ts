import createClient from 'openapi-fetch'
import type { paths as CorePaths } from './core'

/**
 * Every request the frontend makes to Norte goes out from here.
 *
 * The client is typed from `core.d.ts`, which `bin/generate` writes from
 * `api/openapi/core.yaml`: the same file the Go handlers are generated from.
 * A path the contract does not declare, a body field it does not name, or a
 * response field that was removed is a type error at build time rather than a
 * blank screen at run time.
 *
 * One client per module, each typed from that module's own contract, so a
 * module that is switched off is a client nobody constructs.
 */

/**
 * The base URL is relative on purpose, and this is the only place that decides
 * it. In production the server hands out the frontend and answers the API on
 * the same origin; in development the Vite proxy forwards `/api` to the local
 * `norte serve`. Neither case needs a host, and hard-coding one would break the
 * other.
 *
 * It is the origin root rather than `/api` because the contract's own paths
 * already carry the `/api` prefix — that prefix is what the gate checks each
 * module's file against, so it belongs in the contract and not here.
 */
export const apiBaseUrl = '/'

export const coreClient = createClient<CorePaths>({ baseUrl: apiBaseUrl })
