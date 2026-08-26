import assert from 'node:assert/strict'
import { Readable } from 'node:stream'
import test from 'node:test'
import { apply } from '../lib/index.js'

function routes() {
  const registered = new Map()
  apply({
    webServer: { register: (route) => (registered.set(route.path, route), () => undefined) },
    sessions: { get: () => undefined, list: () => [] },
    inject: () => undefined,
    get: () => undefined,
    effect: (mount) => { mount() },
  })
  return registered
}

function request(origin, body = '{}') {
  const req = Readable.from([Buffer.from(body)])
  req.headers = { origin, host: '127.0.0.1:3080' }
  req.method = 'POST'
  return req
}

function response() {
  return {
    status: undefined,
    body: undefined,
    writeHead(status) { this.status = status },
    end(body) { this.body = JSON.parse(body) },
  }
}

test('protects check and open from cross-origin requests', async () => {
  for (const path of ['/api/file-mentions/check', '/api/file-mentions/open']) {
    const res = response()
    await routes().get(path).handler(request('https://evil.example'), res)
    assert.equal(res.status, 403)
    assert.match(res.body.error, /cross-origin/u)
  }
})

test('keeps same-origin requests functional', async () => {
  const res = response()
  await routes().get('/api/file-mentions/check').handler(
    request('http://127.0.0.1:3080', '{"sessionId":"missing","paths":["README.md"]}'),
    res,
  )
  assert.equal(res.status, 400)
  assert.deepEqual(res.body, { valid: [] })
})
