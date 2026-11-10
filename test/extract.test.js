// 路径抽取测试（2026-11-10 工单 1.1~1.6）
// 直接加载 lib/client.js 的模块工厂，复用生产代码里的 extractPaths（不手抄正则，避免漂移）。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

function loadClientExports() {
  const code = readFileSync(join(import.meta.dirname, '../lib/client.js'), 'utf8')
  let factory = null
  const mockWindow = {
    __ModuleLoader__: {
      load: ({ factory: registered }) => { factory = registered },
    },
  }
  const mockDocument = {
    getElementById: () => null,
    createElement: () => ({ id: '', textContent: '' }),
    head: { appendChild: () => {} },
  }
  const fn = new Function('window', 'document', code)
  fn(mockWindow, mockDocument)
  assert.ok(factory !== null, 'ModuleLoader.load factory must be registered')
  return factory(() => ({}))
}

const client = loadClientExports()
assert.ok(client.__test && typeof client.__test.extractPaths === 'function', 'client.js 应导出测试钩子 __test.extractPaths')
const extract = client.__test.extractPaths
const extractText = (s) => extract([{ type: 'text', text: s }])

// ── 工单 1.1：.ets 相对路径（EXT 表缺 ets 会被 ABS 吃掉前缀，变绝对路径）──
test('1.1 .ets 相对路径完整抽出，且不额外吐 ABS 碎片', () => {
  assert.deepEqual(
    extractText('改 app/entry/src/main/ets/pages/AppShell.ets 这个文件'),
    ['app/entry/src/main/ets/pages/AppShell.ets'],
  )
  assert.deepEqual(extractText('models/AppShell.ets'), ['models/AppShell.ets'])
})

test('1.1 EXT 表补充的常用扩展名可用', () => {
  assert.deepEqual(extractText('conf/a.xml conf/b.json5'), ['conf/a.xml', 'conf/b.json5'])
  assert.deepEqual(extractText('src/App.kt'), ['src/App.kt'])
  assert.deepEqual(extractText('src/App.swift'), ['src/App.swift'])
  assert.deepEqual(extractText('src/main.mjs src/main.cjs'), ['src/main.mjs', 'src/main.cjs'])
})

// ── 工单 1.2：中文/冒号紧贴路径 ──
test('1.2 中文紧贴（行首）不从中文处开始吞前缀', () => {
  assert.deepEqual(extractText('详见docs/agc-data/数据快照.md'), ['docs/agc-data/数据快照.md'])
})

test('1.2 中文冒号紧贴仍能抽出完整相对路径', () => {
  assert.deepEqual(extractText('见：docs/agc-data/数据快照.md'), ['docs/agc-data/数据快照.md'])
})

// ── 工单 1.3：句末无标点的路径 ──
test('1.3 文本末尾的路径不再漏', () => {
  assert.deepEqual(
    extractText('lib/index.js lib/a.ts lib/b.py'),
    ['lib/index.js', 'lib/a.ts', 'lib/b.py'],
  )
})

// ── 工单 1.4：无扩展名文件白名单 ──
test('1.4 Makefile / 点文件 / LICENSE 可识别', () => {
  assert.deepEqual(extractText('Makefile'), ['Makefile'])
  assert.deepEqual(extractText('.gitignore'), ['.gitignore'])
  assert.deepEqual(extractText('LICENSE'), ['LICENSE'])
  assert.deepEqual(extractText('Dockerfile'), ['Dockerfile'])
})

test('1.4 有扩展名的同名文件不会额外吐无扩展名项（README.md ≠ README）', () => {
  assert.deepEqual(extractText('README.md 和 LICENSE 都是文件'), ['README.md', 'LICENSE'])
  assert.deepEqual(extractText('README.md'), ['README.md'])
})

test('1.4 白名单之外的无扩展名路径仍不识别（scripts/deploy）', () => {
  assert.deepEqual(extractText('scripts/deploy'), [])
})

// ── 工单 1.5：ABS 碎片去重 ──
test('1.5 不再多吐从第一个 / 开始的 ABS 碎片', () => {
  assert.deepEqual(
    extractText('在 node_modules/dsh-hud/lib/client.js 里'),
    ['node_modules/dsh-hud/lib/client.js'],
  )
})

// ── 工单 1.6：反引号分支过滤 ──
test('1.6 含空格的命令不再当路径', () => {
  assert.deepEqual(extractText('`pnpm update`'), [])
  assert.deepEqual(extractText('`pnpm install --frozen-lockfile`'), [])
})

test('1.6 CLI 旗标不再当路径', () => {
  assert.deepEqual(extractText('`--flag`'), [])
})

test('1.6 超长反引号内容直接丢弃（>60 字符）', () => {
  assert.deepEqual(extractText('`' + 'x'.repeat(61) + '`'), [])
})

test('1.6 正常反引号路径照常识别', () => {
  assert.deepEqual(extractText('`lib/a.ts`'), ['lib/a.ts'])
})

// ── 回归：审计里原本认对的用例不能退化 ──
test('回归：绝对路径 / ~ 路径 / 中文名 / 全角括号 / 行号', () => {
  assert.deepEqual(
    extractText('~/Documents/DSH/analysis/总览.md'),
    ['~/Documents/DSH/analysis/总览.md'],
  )
  assert.deepEqual(
    extractText('/Users/xinbanzhuan/Documents/DSH/analysis/reports/2026-10-27-漏损分析.md'),
    ['/Users/xinbanzhuan/Documents/DSH/analysis/reports/2026-10-27-漏损分析.md'],
  )
  assert.deepEqual(
    extractText('reports/2026-10-27-漏损分析.md'),
    ['reports/2026-10-27-漏损分析.md'],
  )
  assert.deepEqual(extractText('lib/index.js:469'), ['lib/index.js'])
  assert.deepEqual(extractText('C:\\Users\\me\\a.md'), ['C:\\Users\\me\\a.md'])
  assert.deepEqual(extractText('见（docs/x.md）'), ['docs/x.md'])
  assert.deepEqual(extractText('在 reports/xxx.md。'), ['reports/xxx.md'])
  assert.deepEqual(extractText('docs/*.md'), ['docs/*.md'])
})

// ── 其他既有行为 ──
test('围栏代码块内的内容不抽取，非围栏文本照常', () => {
  const content = [
    { type: 'text', text: '说明见 docs/a.md\n```ts\nlib/hidden.ts\n```' },
    { type: 'text', text: '另外 lib/b.ts' },
  ]
  assert.deepEqual(extract(content), ['docs/a.md', 'lib/b.ts'])
})

test('非 text 块与非法入参安全返回', () => {
  assert.deepEqual(extract(null), [])
  assert.deepEqual(extract([{ type: 'tool', text: 'lib/a.ts' }]), [])
  assert.deepEqual(extract([null, { type: 'text', text: '' }]), [])
})
