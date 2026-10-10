// The decider's HTTP layer, with the model stubbed: npm test here never
// downloads the 1.7 GB of weights. The last test only imports the package,
// which proves the dependency and its native bindings are installed, and the
// review's manual /decide call against the loaded model is where the model
// itself gets exercised.
import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_LISTEN, createDeciderServer, parseListen } from './server.mjs'

const usage = { input_tokens: 267, output_tokens: 0 }
const answers = {
    where: { choice: 'stash', probabilities: { stash: 0.9415, inbox: 0.031 } },
}

// A state and a questions object that pass validation, used as the base for
// the request each case builds from.
const validRequest = {
    state: {
        url: 'https://example.org/a-decision',
        host: 'example.org',
        title: 'A decision',
        why: 'deciding where it goes',
        text: 'The beginning of the article.',
    },
    questions: {
        where: {
            type: 'choice',
            instructions: 'Where does this link go?',
            criteria: { inbox: 'to read soon', stash: 'keep for later' },
        },
    },
}

// A handle that answers what it is told and records its calls, the way the
// Laya handle does.
function stubHandle() {
    return {
        calls: [],
        systemOne(state, questions) {
            this.calls.push({ state, questions })
            return Promise.resolve({ answers, usage })
        },
    }
}

// Servers a test started are closed when the suite ends: keep-alive sockets
// must never hold the test file open.
const closers = []
test.after(async () => {
    while (closers.length > 0) {
        await closers.pop()()
    }
})

async function startServer({ loadLaya }) {
    let loadCalls = 0
    const server = createDeciderServer({
        loadLaya: async () => {
            loadCalls += 1
            return loadLaya()
        },
    })
    await new Promise((resolve, reject) => {
        server.on('error', reject)
        server.listen(0, '127.0.0.1', resolve)
    })
    const url = `http://127.0.0.1:${server.address().port}`
    let closed = false
    closers.push(async () => {
        if (closed) return
        closed = true
        server.closeIdleConnections()
        await new Promise((resolve) => server.close(resolve))
    })
    return { url, loadCalls: () => loadCalls }
}

async function post(url, path, body, { raw = false } = {}) {
    const response = await fetch(url + path, { method: 'POST', body: raw ? body : JSON.stringify(body) })
    return { status: response.status, json: await response.json().catch(() => null) }
}

test('the default listen address is the loopback sidecar port', () => {
    assert.equal(DEFAULT_LISTEN, '127.0.0.1:8091')
})

test('parseListen reads the address forms DECIDER_LISTEN may use', () => {
    assert.deepEqual(parseListen('127.0.0.1:8091'), { host: '127.0.0.1', port: 8091 })
    assert.deepEqual(parseListen('0.0.0.0:9091'), { host: '0.0.0.0', port: 9091 })
    assert.deepEqual(parseListen('[::1]:8091'), { host: '::1', port: 8091 })
    assert.deepEqual(parseListen(':8091'), { host: '', port: 8091 })
    assert.deepEqual(parseListen('8091'), { host: '127.0.0.1', port: 8091 })
    assert.equal(parseListen('nope'), null)
    assert.equal(parseListen('127.0.0.1:'), null)
    assert.equal(parseListen('127.0.0.1:70000'), null)
    assert.equal(parseListen(''), null)
})

test('a decide answers the Laya result unchanged', async () => {
    const handle = stubHandle()
    const { url, loadCalls } = await startServer({ loadLaya: async () => handle })

    const { status, json } = await post(url, '/decide', validRequest)
    assert.equal(status, 200)
    assert.deepEqual(json, { answers, usage })
    assert.deepEqual(handle.calls, [{ state: validRequest.state, questions: validRequest.questions }])
    assert.equal(loadCalls(), 1, 'the model must load once, not per request')
})

test('health reports the load in progress and the finished load', async () => {
    let release
    const { url } = await startServer({
        loadLaya: () => new Promise((resolve) => {
            release = resolve
        }),
    })

    const first = await fetch(`${url}/health`)
    assert.equal(first.status, 503)
    assert.deepEqual(await first.json(), { ready: false })

    const deciding = post(url, '/decide', validRequest)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const before = await fetch(`${url}/health`)
    assert.equal(before.status, 503, 'the model is still loading')
    assert.deepEqual(await before.json(), { ready: false })

    release(stubHandle())
    const decided = await deciding
    assert.equal(decided.status, 200, 'a decide waits for the model instead of failing')
    const after = await fetch(`${url}/health`)
    assert.equal(after.status, 200)
    assert.deepEqual(await after.json(), { ready: true })
})

test('the model loads once even when several decides arrive', async () => {
    const handle = stubHandle()
    const { url, loadCalls } = await startServer({ loadLaya: async () => handle })

    const both = await Promise.all([
        post(url, '/decide', validRequest),
        post(url, '/decide', validRequest),
    ])
    assert.deepEqual(both.map(({ status }) => status), [200, 200])
    assert.equal(loadCalls(), 1)
})

test('a failed load answers 500 and health stays 503', async () => {
    const { url } = await startServer({
        loadLaya: () => Promise.reject(new Error('the weights are missing')),
    })

    const decided = await post(url, '/decide', validRequest)
    assert.equal(decided.status, 500)
    assert.match(decided.json.error, /the model failed to load: the weights are missing/)

    const health = await fetch(`${url}/health`)
    assert.equal(health.status, 503)
    assert.deepEqual(await health.json(), { ready: false })
})

test('a Laya failure answers 500 with the model message', async () => {
    const handle = {
        systemOne() {
            throw new Error('the options do not fit in the 192-token question header')
        },
    }
    const { url, loadCalls } = await startServer({ loadLaya: async () => handle })

    const decided = await post(url, '/decide', validRequest)
    assert.equal(decided.status, 500)
    assert.match(decided.json.error, /do not fit in the 192-token question header/)
    assert.equal(loadCalls(), 1)
})

// One malformed request after another, against a service whose model never
// finishes loading: validation answers 400 without waiting for anything.
const badRequests = [
    { name: 'a body that is not JSON', body: '{', raw: true, want: 'the body is not valid JSON' },
    { name: 'an empty body', body: '', raw: true, want: 'the body must be a JSON object' },
    { name: 'a JSON array body', body: [1, 2], want: 'the body must be a JSON object' },
    { name: 'a JSON string body', body: 'decide please', want: 'the body must be a JSON object' },
    { name: 'a missing state', body: { questions: validRequest.questions }, want: 'the body needs "state"' },
    { name: 'a null state', body: { state: null, questions: validRequest.questions }, want: 'state must be a non-empty string or a JSON object' },
    { name: 'a numeric state', body: { state: 3, questions: validRequest.questions }, want: 'state must be a non-empty string or a JSON object' },
    { name: 'an empty state string', body: { state: '', questions: validRequest.questions }, want: 'state must be a non-empty string or a JSON object' },
    { name: 'a missing questions', body: { state: validRequest.state }, want: 'the body needs "questions"' },
    { name: 'an empty questions object', body: { ...validRequest, questions: {} }, want: 'questions must be a JSON object with at least one question' },
    { name: 'a question that is not an object', body: { ...validRequest, questions: { where: 'nowhere' } }, want: 'questions.where: a question must be a JSON object' },
    { name: 'a question without a type', body: { ...validRequest, questions: { where: {} } }, want: 'questions.where: "type" must be one of choice, score or noul' },
    { name: 'a question of an unknown type', body: { ...validRequest, questions: { where: { type: 'rank' } } }, want: 'questions.where: "type" must be one of choice, score or noul' },
    { name: 'a choice without criteria', body: { ...validRequest, questions: { where: { type: 'choice' } } }, want: 'questions.where: a choice question needs "criteria"' },
    { name: 'a choice with empty criteria', body: { ...validRequest, questions: { where: { type: 'choice', criteria: {} } } }, want: 'questions.where: a choice question needs "criteria"' },
    { name: 'a choice with a non-string option description', body: { ...validRequest, questions: { where: { type: 'choice', criteria: { inbox: 5 } } } }, want: 'questions.where: the description of the option "inbox" must be a string' },
    { name: 'a score without criteria', body: { ...validRequest, questions: { how: { type: 'score' } } }, want: 'questions.how: a score question needs "criteria"' },
    { name: 'a score with one rubric level', body: { ...validRequest, questions: { how: { type: 'score', criteria: ['low'] } } }, want: 'a score question needs "criteria", at least two ordered rubric levels' },
    { name: 'a score with a non-string level', body: { ...validRequest, questions: { how: { type: 'score', criteria: ['low', 2] } } }, want: 'a score question needs "criteria", at least two ordered rubric levels' },
    { name: 'a question with numeric instructions', body: { ...validRequest, questions: { where: { type: 'noul', instructions: 7 } } }, want: 'questions.where: "instructions" must be a string' },
]

test('malformed bodies answer 400 naming the problem', async (t) => {
    const { url, loadCalls } = await startServer({
        loadLaya: () => new Promise(() => {}),
    })

    for (const entry of badRequests) {
        await t.test(entry.name, async () => {
            const { status, json } = await post(url, '/decide', entry.body, { raw: entry.raw })
            assert.equal(status, 400)
            assert.ok(json.error.includes(entry.want), `the error must name the problem: ${json.error}`)
        })
    }

    // Every 400 was answered from validation alone: the loader ran once, at
    // startup, and the model it never produced answered no request.
    assert.equal(loadCalls(), 1)

    const health = await fetch(`${url}/health`)
    assert.equal(health.status, 503)
})

test('a body past the cap answers 413', async () => {
    const { url } = await startServer({ loadLaya: async () => stubHandle() })
    const oversized = `{"state":{"text":"${'x'.repeat(1024 * 1024)}"},"questions":{"where":{"type":"noul"}}}`
    const { status, json } = await post(url, '/decide', oversized, { raw: true })
    assert.equal(status, 413)
    assert.match(json.error, /longer than 1048576 bytes/)
})

test('unknown routes and wrong methods answer 404 and 405', async () => {
    const { url } = await startServer({ loadLaya: async () => stubHandle() })

    const missing = await fetch(`${url}/nothing`)
    assert.equal(missing.status, 404)

    const getDecide = await fetch(`${url}/decide`)
    assert.equal(getDecide.status, 405)

    const health = await fetch(`${url}/health`, { method: 'POST' })
    assert.equal(health.status, 405)
})

test('decides run one forward pass at a time', async () => {
    let releaseFirst
    const handle = {
        calls: [],
        systemOne(state, questions) {
            const name = Object.keys(questions)[0]
            this.calls.push(name)
            if (name === 'primary') {
                return new Promise((resolve) => {
                    releaseFirst = () => {
                        this.calls.push('primary done')
                        resolve({ answers: { primary: { noul: 0.5 } }, usage })
                    }
                })
            }
            return Promise.resolve({ answers: { secondary: { noul: 0.25 } }, usage })
        },
    }
    const { url } = await startServer({ loadLaya: async () => handle })

    const first = post(url, '/decide', {
        state: validRequest.state,
        questions: { primary: { type: 'noul', instructions: 'first?' } },
    })
    const second = post(url, '/decide', {
        state: validRequest.state,
        questions: { secondary: { type: 'noul', instructions: 'second?' } },
    })

    // While the first forward pass is in flight, the second must be waiting:
    // one batched run at a time, never two overlapping sessions.
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(handle.calls, ['primary'], 'the second decide must wait for the first forward pass')
    releaseFirst()

    const both = await Promise.all([first, second])
    assert.deepEqual(both.map(({ status }) => status), [200, 200])
    assert.deepEqual(handle.calls, ['primary', 'primary done', 'secondary'])
    assert.deepEqual(both[1].json.answers, { secondary: { noul: 0.25 } })
})

// The dependency must be resolvable with the bindings intact: the gate's
// npm ci runs with --ignore-scripts, and a package whose native bindings
// needed an install script would otherwise fail only at model load time,
// with no test there to say so.
test('the laya package imports with its bindings intact', async () => {
    const mod = await import('@receptron/laya')
    assert.equal(typeof mod.Laya, 'function')
})

// The dependency must also be declared: a node_modules left over from earlier
// work keeps the import above green even when package.json has dropped it,
// until the next npm ci, so the declaration itself is asserted here.
test('the service declares the laya dependency in package.json', async () => {
    const { readFile } = await import('node:fs/promises')
    const pkg = JSON.parse(await readFile(new URL('./package.json', import.meta.url), 'utf8'))
    assert.ok('@receptron/laya' in pkg.dependencies, 'package.json must depend on @receptron/laya')
})