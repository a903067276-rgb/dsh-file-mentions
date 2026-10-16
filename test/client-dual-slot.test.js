import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

test('lib/client.js provides dual-compatible slot registration options (id and select)', () => {
  const code = readFileSync(join(import.meta.dirname, '../lib/client.js'), 'utf8')

  // 模拟 slots 注入与注册环境
  let registeredOptions = null
  let registeredComponent = null

  const mockSlots = {
    inject: (name, cb) => cb(),
    register: (options, component) => {
      if (options.name === 'conversation.chat.turnTail') {
        registeredOptions = options
        registeredComponent = component
      }
      return () => {}
    },
  }

  let loadedFactory = null
  const mockWindow = {
    __ModuleLoader__: {
      load: ({ factory }) => {
        loadedFactory = factory
      },
    },
  }

  const mockDocument = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const fn = new Function('window', 'document', code)
  fn(mockWindow, mockDocument)

  assert.ok(loadedFactory, 'ModuleLoader.load factory must be registered')

  const mockExports = {}
  const mockModule = { exports: mockExports }
  const mockRequire = (spec) => {
    if (spec === 'react') {
      return {
        useState: (init) => [init, () => {}],
        useRef: (init) => ({ current: init }),
        useEffect: () => {},
        useMemo: (fn) => fn(),
        createElement: () => null,
      }
    }
    throw new Error(`unknown require ${spec}`)
  }

  const moduleResult = loadedFactory(mockRequire)
  const applyFn = moduleResult.apply || mockModule.exports.apply
  assert.ok(typeof applyFn === 'function', 'apply should be exported as function')

  // 调用 apply
  applyFn({
    get: (name) => (name === 'slots' ? mockSlots : undefined),
    slots: mockSlots,
    effect: () => {},
  })

  assert.ok(registeredOptions, 'conversation.chat.turnTail slot must be registered')

  // 1. 验证 options.id 存在（满足 DSH >= 0.1.7 的 list 槽）
  assert.equal(registeredOptions.name, 'conversation.chat.turnTail')
  assert.equal(typeof registeredOptions.id, 'string', 'must provide options.id for list slot')

  // 2. 验证 options.select 存在且为函数（满足 DSH < 0.1.7 的 chain 槽）
  assert.equal(typeof registeredOptions.select, 'function', 'must provide options.select for chain slot')

  // 3. 验证 select 函数的返回值
  const mockTurnDataEmpty = { turn: { data: { get: () => ({ paths: [] }) } } }
  assert.equal(registeredOptions.select(mockTurnDataEmpty), null, 'select should return null when paths is empty')

  const mockTurnDataWithPaths = { turn: { data: { get: () => ({ paths: ['/path/to/file.txt'] }) } } }
  assert.deepEqual(registeredOptions.select(mockTurnDataWithPaths), ['/path/to/file.txt'])
})
