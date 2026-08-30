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
  // v1.0.13 空值语义：会话不存在/空参数 = "没有有效路径"，200 + valid:[]（非错误），
  // 探测面安全语义不变（仍不响应任何路径探测）。
  assert.equal(res.status, 200)
  assert.deepEqual(res.body, { valid: [] })
})

test('returns 200 with empty valid for null session or empty paths', async () => {
  // 空 sessionId：不应视为请求错误（400），而是无结果（200）
  const res1 = response()
  await routes().get('/api/file-mentions/check').handler(
    request('http://127.0.0.1:3080', '{"sessionId":null,"paths":["README.md"]}'),
    res1,
  )
  assert.equal(res1.status, 200)
  assert.deepEqual(res1.body, { valid: [] })
  // 空 paths：同样无结果
  const res2 = response()
  await routes().get('/api/file-mentions/check').handler(
    request('http://127.0.0.1:3080', '{"sessionId":"s1","paths":[]}'),
    res2,
  )
  assert.equal(res2.status, 200)
  assert.deepEqual(res2.body, { valid: [] })
})
