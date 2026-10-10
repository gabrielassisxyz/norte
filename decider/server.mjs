// The decider sidecar: a small HTTP facade in front of the Laya decision
// model, the @receptron/laya package running its ONNX bundle. Norte is one
// static Go binary, so the model runs here, next to the server, and the
// server calls it over HTTP the same way it calls its LLM.
//
//   GET /health    200 {"ready": true} once the model is loaded, 503 with
//                  {"ready": false} while the weights are still loading
//   POST /decide   {"state": <object|string>, "questions": <Laya questions>}
//              →   {"answers": <Laya's answers>, "usage": <Laya's usage>}
//
// A malformed body answers 400 with an error naming the problem, and a
// failure inside Laya (an option that does not fit the 192-token question
// header, for instance) answers 500 with the model's own message.
//
// The model loads once at startup, in the background: the listener opens
// first, so /health can report a load in progress, and /decide waits for
// the load instead of failing fast, because the request would only have to
// be retried once the model is up anyway. Every systemOne call runs under
// one lock: a call is one batched forward pass over an in-memory session of
// about 2 GB, so overlapping calls only multiply the memory and buy no
// accuracy over the batching the package already does.

import http from 'node:http'
import { pathToFileURL } from 'node:url'

export const DEFAULT_LISTEN = '127.0.0.1:8091'

// A runaway client only ever needs an answer, never a buffer. The state is
// truncated to 512 tokens by the model, so anything past this cap could not
// survive the forward pass even if it arrived in full.
const BODY_CAP_BYTES = 1024 * 1024

const QUESTION_TYPES = new Set(['choice', 'score', 'noul'])

function isPlainObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// checkDecideRequest returns the request body ready for systemOne, or the
// message the 400 should carry. Only the shape the service depends on is
// verified; state and questions go to Laya unchanged, which throws on what
// the model cannot answer -- that failure is a 500, not a 400.
export function checkDecideRequest(body) {
    if (!isPlainObject(body)) {
        return { error: 'the body must be a JSON object' }
    }
    if (!('state' in body)) {
        return { error: 'the body needs "state", a non-empty string or a JSON object' }
    }
    const { state } = body
    if (!(typeof state === 'string' && state.length > 0) && !isPlainObject(state)) {
        return { error: 'state must be a non-empty string or a JSON object' }
    }
    if (!('questions' in body)) {
        return { error: 'the body needs "questions"' }
    }
    const { questions } = body
    if (!isPlainObject(questions) || Object.keys(questions).length === 0) {
        return { error: 'questions must be a JSON object with at least one question' }
    }
    for (const [name, question] of Object.entries(questions)) {
        const problem = checkQuestion(name, question)
        if (problem) return { error: problem }
    }
    return { state, questions }
}

function checkQuestion(name, question) {
    const at = (detail) => `questions.${name}: ${detail}`
    if (!isPlainObject(question)) {
        return at('a question must be a JSON object')
    }
    if (!QUESTION_TYPES.has(question.type)) {
        return at('"type" must be one of choice, score or noul')
    }
    if (question.instructions !== undefined && typeof question.instructions !== 'string') {
        return at('"instructions" must be a string')
    }
    if (question.type === 'choice') {
        if (!isPlainObject(question.criteria) || Object.keys(question.criteria).length === 0) {
            return at('a choice question needs "criteria", one option per key with a string description')
        }
        for (const [option, description] of Object.entries(question.criteria)) {
            if (typeof description !== 'string') {
                return at(`the description of the option ${JSON.stringify(option)} must be a string`)
            }
        }
    }
    if (question.type === 'score') {
        const { criteria } = question
        if (!Array.isArray(criteria) || criteria.length < 2 || criteria.some((level) => typeof level !== 'string')) {
            return at('a score question needs "criteria", at least two ordered rubric levels as strings')
        }
    }
    return null
}

// readBody collects the request body up to the cap. An oversized body
// resolves {tooLarge} as soon as it is over, so nothing past the cap is
// ever buffered.
function readBody(req, cap) {
    return new Promise((resolve, reject) => {
        let size = 0
        let settled = false
        const chunks = []
        const finish = (value) => {
            if (settled) return
            settled = true
            resolve(value)
        }
        req.on('data', (chunk) => {
            size += chunk.length
            if (size > cap) {
                chunks.length = 0
                finish({ tooLarge: true })
                return
            }
            chunks.push(chunk)
        })
        req.on('end', () => finish({ buffer: Buffer.concat(chunks) }))
        req.on('error', (err) => {
            if (!settled) reject(err)
        })
    })
}

function sendJson(res, status, payload) {
    if (res.writableEnded || res.destroyed) return status
    const body = JSON.stringify(payload)
    res.writeHead(status, {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
    })
    res.end(body)
    return status
}

// createDeciderServer builds the HTTP server around a loader that returns
// Laya's handle, once. The loader is injectable so the unit tests can stub
// the model: they never download the 1.7 GB of weights.
export function createDeciderServer({ loadLaya, log = () => {} }) {
    let status = 'loading' // loading | ready | failed
    let modelHandle = null
    let loadFailure = null
    let loadPromise

    function startLoad() {
        loadPromise = Promise.resolve()
            .then(loadLaya)
            .then(
                (handle) => {
                    status = 'ready'
                    modelHandle = handle
                    log('the model is loaded')
                },
                (err) => {
                    status = 'failed'
                    loadFailure = err
                    log(`the model failed to load: ${err?.message || err}`)
                },
            )
    }
    startLoad()

    // modelHandleReady resolves with the handle once the load has finished
    // and rejects with the load error once the load has failed, so a decide
    // that arrives while the weights are still loading waits for them.
    function modelHandleReady() {
        return loadPromise.then(() => {
            if (status !== 'ready') {
                throw new Error(`the model failed to load: ${loadFailure?.message || loadFailure}`)
            }
            return modelHandle
        })
    }

    // One forward pass at a time: a second call overlapping the first only
    // doubles the memory, and the package already batches the questions of
    // one call into a single run. The lock rejects nothing of its own; a
    // failed call just does not block the next one.
    let lock = Promise.resolve()
    function systemOne(state, questions) {
        const call = lock.then(() => modelHandleReady().then((handle) => handle.systemOne(state, questions)))
        lock = call.then(() => {}, () => {})
        return call
    }

    async function handleDecide(req, res) {
        const body = await readBody(req, BODY_CAP_BYTES)
        if (body.tooLarge) {
            return sendJson(res, 413, { error: `the body is longer than ${BODY_CAP_BYTES} bytes` })
        }
        let parsed
        try {
            parsed = JSON.parse(body.buffer.toString('utf8') || 'null')
        } catch (err) {
            return sendJson(res, 400, { error: `the body is not valid JSON: ${err.message}` })
        }
        const checked = checkDecideRequest(parsed)
        if (checked.error) {
            return sendJson(res, 400, { error: checked.error })
        }
        let answers
        let usage
        try {
            const result = await systemOne(checked.state, checked.questions)
            answers = result.answers
            usage = result.usage
        } catch (err) {
            return sendJson(res, 500, { error: err?.message || String(err) })
        }
        return sendJson(res, 200, { answers, usage })
    }

    async function respond(req, res) {
        const { pathname } = new URL(req.url, 'http://localhost')
        if (pathname === '/health') {
            if (req.method !== 'GET') {
                return sendJson(res, 405, { error: 'GET /health only' })
            }
            return sendJson(res, status === 'ready' ? 200 : 503, { ready: status === 'ready' })
        }
        if (pathname === '/decide') {
            if (req.method !== 'POST') {
                return sendJson(res, 405, { error: 'POST /decide only' })
            }
            return handleDecide(req, res)
        }
        return sendJson(res, 404, { error: `no route ${pathname}` })
    }

    const server = http.createServer((req, res) => {
        const startedAt = Date.now()
        req.on('error', () => {})
        respond(req, res)
            .catch((err) => {
                // Nothing above throws in normal flow; this is the safety net
                // for a bug answering JSON once instead of killing the process.
                sendJson(res, 500, { error: err?.message || String(err) })
                log(`unhandled failure on ${req.method} ${req.url}: ${err?.message || err}`)
            })
            .finally(() => {
                log(`${req.method} ${req.url} ${res.statusCode} in ${Date.now() - startedAt}ms`)
            })
    })
    return server
}

// parseListen reads DECIDER_LISTEN: "host:port", a bare port on the loopback,
// or ":port" on every interface. It returns what server.listen takes.
export function parseListen(value) {
    let host = '127.0.0.1'
    let portText = value.trim()
    const colon = portText.lastIndexOf(':')
    if (colon >= 0) {
        host = portText.slice(0, colon)
        portText = portText.slice(colon + 1)
    }
    if (host.startsWith('[') && host.endsWith(']')) {
        host = host.slice(1, -1)
    }
    const port = Number(portText)
    if (!Number.isInteger(port) || port < 1 || port > 65535) return null
    return { host, port }
}

// loadModel is dynamic on purpose: importing @receptron/laya pulls in the
// onnxruntime-node native bindings, and the unit tests stub the loader
// instead of loading any of that. The package reads LAYA_CACHE itself for
// the directory the weights land in.
async function loadModel() {
    const { Laya } = await import('@receptron/laya')
    return Laya.load()
}

const SHUTDOWN_GRACE_MS = 10_000

async function main() {
    const raw = process.env.DECIDER_LISTEN || DEFAULT_LISTEN
    const listen = parseListen(raw)
    if (!listen) {
        console.error(`decider: DECIDER_LISTEN is not a "host:port" or a port: ${JSON.stringify(raw)}`)
        process.exitCode = 1
        return
    }
    const log = (message) => console.log(`decider: ${message}`)
    const server = createDeciderServer({ loadLaya: loadModel, log })
    server.on('error', (err) => {
        console.error(`decider: ${err.message}`)
        process.exit(1)
    })
    server.listen(listen.port, listen.host, () => {
        log(`listening on ${listen.host}:${listen.port}, loading the model`)
    })
    const shutdown = () => {
        server.closeIdleConnections()
        server.close(() => process.exit(0))
        setTimeout(() => process.exit(0), SHUTDOWN_GRACE_MS).unref()
    }
    process.on('SIGTERM', shutdown)
    process.on('SIGINT', shutdown)
}

// Entry detection: only the file node was started with runs the service, so
// the tests import this module without starting anything.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
    main().catch((err) => {
        console.error(`decider: ${err?.stack || err}`)
        process.exit(1)
    })
}