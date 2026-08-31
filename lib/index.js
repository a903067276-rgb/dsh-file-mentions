/**
 * dsh-file-mentions — Host 半
 *
 * 提供路径路由（全部按会话 cwd 解析，~/ 展开、相对路径）：
 *   1. POST /api/file-mentions/check —— 路径存在性验证（{ sessionId, paths } → { valid }）
 *   2. POST /api/file-mentions/open  —— 系统打开路径（{ sessionId, path, mode } → { ok }）
 *      mode: "open"（默认）= 默认应用打开文件 / 打开目录窗口（正文点击）
 *      mode: "reveal"             = Finder 定位选中文件 / 打开目录窗口（列表 📂 按钮）
 *   3. GET/POST /api/file-mentions/config —— 外置盘白名单读写（设置页用）
 *
 * 所有路由均通过 isSameOrigin 防护本地 CSRF。
 *
 * 探测面（P1）：绝对/~ 路径在**本会话 cwd 内 / 本机主目录内**可探测（本机文件
 * 无需配置——2026-08-26 用户拍板）；其余只有用户显式声明的白名单根
 * （设置页 extraProbeRoots，外置盘/网络盘用）可探测——用户声明 = 授权
 * （同 perm-guard trustedDirs 哲学）。白名单根带系统盘保护（根下有
 * /System 或 /etc 等系统特征目录 → 拒绝）与 symlink 防逃逸（realpath 后
 * 仍须在根内）。
 * 纯 Node 实现，跨平台（macOS 实测；Win/Linux 命令已按平台分流）。
 */
import { existsSync, realpathSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve, isAbsolute } from 'node:path'
import { execFile } from 'node:child_process'

import z from '@deepseek-ai/schemastery'

/** 请求体上限（防本地无鉴权端点被超大 body 打爆内存；正常请求远小于此） */
const MAX_BODY_BYTES = 100 * 1024

/** 设置命名空间（官方 settings 服务，持久化 + 运行时生效） */
const NS = 'file-mentions'

export const name = 'dsh-file-mentions'
export const inject = ['webServer', 'sessions']

export function apply(ctx) {
  const webServer = ctx.webServer
  const sessions = ctx.sessions
  if (webServer === undefined || sessions === undefined) return

  // 注册持久化设置（settings 可用时；不可用时白名单为空 = 现状安全行为）
  ctx.inject(['settings'], (settingsCtx) => {
    settingsCtx.settings.register(
      NS,
      z.object({ extraProbeRoots: z.array(z.string()).required(false) }),
    )
  })

  // 可选持久来源：相对路径解析兜底用。重启后未打开的会话不在活会话列表里，
  // 只靠 sessions.list() 会解析失败（"点了没反应"）。
  const workspaceRegistry = ctx.get('workspaceRegistry')
  const sessionPersistence = ctx.get('sessionPersistence')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/file-mentions/check',
    handler: async (req, res) => {
      try {
        if (!isSameOrigin(req)) {
          writeJson(res, 403, { valid: [], error: 'forbidden: cross-origin request' })
          return
        }
        const body = await readBody(req, MAX_BODY_BYTES)
        const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : null
        const paths = body && Array.isArray(body.paths)
          ? body.paths.filter((p) => typeof p === 'string' && p !== '')
          : []
        if (sessionId === null || paths.length === 0) {
          writeJson(res, 200, { valid: [] })
          return
        }
        // P1：会话必须真实存在才响应存在性查询，杜绝无鉴权探测
        const session = sessions.get(sessionId)
        if (session === undefined || session === null) {
          writeJson(res, 200, { valid: [] })
          return
        }
        const cwd = session && session.header && typeof session.header.cwd === 'string' ? session.header.cwd : null
        const extras = await durableCwds(workspaceRegistry, sessionPersistence)
        const roots = probeRoots(ctx)
        const valid = []
        for (const p of paths) {
          try {
            // P1：绝对/~ 路径的存在性探测面收窄——只在本会话 cwd 内或用户声明的
            // 白名单根内做 existsSync，越界一律按"未知"处理（不做探测）；
            // 相对路径保持多会话解析原功能。
            if (isAbsolute(p) || p.startsWith('~/')) {
              const abs = resolvePath(p, cwd)
              if (isProbeable(abs, cwd, roots) && existsSync(abs)) {
                valid.push(p)
              }
              continue
            }
            // 相对路径先按指定会话 cwd 解析，再遍历活会话 cwd、工作区根目录、
            // 以及全部持久化会话（含冷会话）的 cwd 兜底
            const hit = await resolveFirst(p, cwd, sessions, extras)
            if (hit !== null) valid.push(p)
          } catch (error) {
            // 单条失败不影响其他
          }
        }
        writeJson(res, 200, { valid })
      } catch (error) {
        writeJson(res, 500, { valid: [], error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'file-mentions: check route')

  // ── open 路由：系统文件管理器定位/打开路径（macOS Finder，实测）──
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/file-mentions/open',
    handler: async (req, res) => {
      try {
        if (!isSameOrigin(req)) {
          writeJson(res, 403, { ok: false, error: 'forbidden: cross-origin request' })
          return
        }
        const body = await readBody(req, MAX_BODY_BYTES)
        const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : null
        const path = body && typeof body.path === 'string' && body.path !== '' ? body.path : null
        const mode = body && typeof body.mode === 'string' && body.mode === 'reveal' ? 'reveal' : 'open'
        if (sessionId === null || path === null) {
          writeJson(res, 400, { ok: false })
          return
        }
        // P1：会话必须真实存在才允许系统打开（sessionId 不再只是 cwd 基数，无会话不可打开任意路径）
        const session = sessions.get(sessionId)
        if (session === undefined || session === null) {
          writeJson(res, 400, { ok: false, error: '会话不存在' })
          return
        }
        const cwd = session && session.header && typeof session.header.cwd === 'string' ? session.header.cwd : null
        const extras = await durableCwds(workspaceRegistry, sessionPersistence)
        const abs = await resolveFirst(path, cwd, sessions, extras, probeRoots(ctx))
        if (abs === null) {
          writeJson(res, 404, { ok: false, error: '路径不存在: ' + path })
          return
        }
        const isDir = statSync(abs).isDirectory()
        const result = await systemOpen(abs, isDir, mode === 'reveal')
        if (result !== null) {
          writeJson(res, 200, { ok: true })
        } else {
          writeJson(res, 500, { ok: false, error: '系统打开命令执行失败（平台: ' + process.platform + '）' })
        }
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'file-mentions: open route')

  // ── config 路由：外置盘白名单读写（设置页用）──
  // P1 修复（本地 CSRF）：校验 Origin/Host 必须为本机（同 perm-guard 先例），
  // 恶意网页无法改白名单。
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/file-mentions/config',
    handler: async (req, res) => {
      try {
        if (!isSameOrigin(req)) {
          writeJson(res, 403, { ok: false, error: 'forbidden: cross-origin request' })
          return
        }
        const settings = ctx.get('settings')
        if (!settings) {
          writeJson(res, 500, { ok: false, error: 'settings 服务不可用' })
          return
        }
        if (req.method === 'GET' || req.method === 'HEAD') {
          writeJson(res, 200, { ok: true, extraProbeRoots: probeRoots(ctx) })
          return
        }
        if (req.method === 'POST' || req.method === 'PUT') {
          const body = await readBody(req, MAX_BODY_BYTES)
          const list = body && Array.isArray(body.extraProbeRoots)
            ? body.extraProbeRoots.filter((p) => typeof p === 'string' && p.trim() !== '')
            : []
          const next = normalizeRoots(list)
          await settings.update(NS, { extraProbeRoots: next })
          writeJson(res, 200, { ok: true, extraProbeRoots: next })
          return
        }
        writeJson(res, 405, { ok: false, error: 'method not allowed' })
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) })
      }
    },
  }), 'file-mentions: config route')
}

/** 绝对路径原样（含 Windows 盘符，isAbsolute 判断）；~/ 展开用户目录；相对路径按会话 cwd 解析。 */
function resolvePath(p, cwd) {
  if (isAbsolute(p)) return p
  if (p.startsWith('~/')) return homedir() + p.slice(1)
  if (typeof cwd === 'string' && cwd !== '') return resolve(cwd, p)
  return p
}

/**
 * 收集持久化的相对路径解析基数：
 * 1. 工作区注册表里的所有工作区根目录；
 * 2. 全部持久化会话（含重启后未打开的冷会话）的 cwd。
 * 任一来源不可用或抛错时静默降级，不影响主流程。
 */
async function durableCwds(workspaceRegistry, sessionPersistence) {
  const out = []
  const seen = new Set()
  const push = (value) => {
    if (typeof value === 'string' && value !== '' && !seen.has(value)) {
      seen.add(value)
      out.push(value)
    }
  }
  try {
    if (workspaceRegistry !== undefined && typeof workspaceRegistry.list === 'function') {
      for (const w of workspaceRegistry.list()) push(w && w.path)
    }
  } catch (error) {
  }
  try {
    if (sessionPersistence !== undefined && typeof sessionPersistence.list === 'function') {
      const headers = await sessionPersistence.list()
      for (const h of headers) push(h && h.cwd)
    }
  } catch (error) {
  }
  return out
}

/**
 * 规范化后 target 是否仍位于 base 之内（防 ../ 逃逸会话目录）：
 * resolve 归一化后做"同路径或 base 前缀 + 分隔符"校验，避免 /a/b 误配 /a/bc。
 */
function isWithin(base, target) {
  if (typeof base !== 'string' || base === '' || typeof target !== 'string' || target === '') return false
  const b = resolve(base)
  const t = resolve(target)
  const sep = process.platform === 'win32' ? '\\' : '/'
  return t === b || t.startsWith(b === '/' ? b : b + sep)
}

/**
 * 解析到第一个真实存在的绝对路径；找不到返回 null。
 * 相对路径：先按指定会话 cwd，再遍历活会话 cwd，最后是持久化兜底基数。
 * 绝对/~ 路径不依赖会话，直接验证。
 */
async function resolveFirst(p, cwd, sessions, extras, roots) {
  if (isAbsolute(p) || p.startsWith('~/')) {
    const abs = resolvePath(p, cwd)
    // P1：绝对/~ 路径与 /check 同口径——cwd 内或白名单根内才可打开，越界拒绝
    if (!isProbeable(abs, cwd, roots)) return null
    return existsSync(abs) ? abs : null
  }
  const tried = new Set()
  const attempt = (base) => {
    if (typeof base !== 'string' || base === '' || tried.has(base)) return null
    tried.add(base)
    const abs = resolve(base, p)
    // P2：../ 不得逃逸解析基数目录（规范化 + 前缀校验），越界拒绝，
    // 防止命中别的会话同名文件
    if (!isWithin(base, abs)) return null
    return existsSync(abs) ? abs : null
  }
  const hit = attempt(cwd)
  if (hit !== null) return hit
  if (sessions !== undefined && typeof sessions.list === 'function') {
    for (const s of sessions.list()) {
      const hit2 = attempt(s && s.header && s.header.cwd)
      if (hit2 !== null) return hit2
    }
  }
  if (Array.isArray(extras)) {
    for (const base of extras) {
      const hit3 = attempt(base)
      if (hit3 !== null) return hit3
    }
  }
  return null
}

/**
 * 当前白名单根（官方 settings 服务，每次现读 → 设置页保存即生效，无需重启）。
 * settings 不可用/未配置时返回 []（= 现状安全行为）。
 * 注意：ctx 必须由调用方传入——本函数是模块级，拿不到 apply 的闭包 ctx。
 */
function probeRoots(ctx) {
  try {
    const settings = ctx.get('settings')
    if (!settings) return []
    const v = settings.get(NS)
    const list = v && Array.isArray(v.extraProbeRoots) ? v.extraProbeRoots : []
    return normalizeRoots(list)
  } catch (error) {
    return []
  }
}

/** 白名单根归一化：trim、~/ 展开、去重、滤空串。 */
function normalizeRoots(list) {
  const out = []
  const seen = new Set()
  for (const item of list) {
    if (typeof item !== 'string') continue
    const r = item.trim()
    const root = r.startsWith('~/') ? homedir() + r.slice(1) : r
    if (root === '' || seen.has(root)) continue
    seen.add(root)
    out.push(root)
  }
  return out
}

/** 系统盘特征目录（根下存在即视为系统盘，拒绝白名单）：macOS/Linux /System、/etc；Windows \Windows */
const SYSTEM_MARKERS = process.platform === 'win32' ? ['Windows'] : ['System', 'etc']
const warnedRoots = new Set()

function isSystemRoot(root) {
  try {
    for (const marker of SYSTEM_MARKERS) {
      if (existsSync(join(root, marker))) {
        if (!warnedRoots.has(root)) {
          warnedRoots.add(root)
          console.warn('[dsh-file-mentions] 白名单根被拒绝（检测到系统盘特征 ' + marker + '）: ' + root)
        }
        return true
      }
    }
  } catch (error) {
    // 根不可探测等异常按"非系统盘"处理，交由后续探测兜底
  }
  return false
}

/**
 * 绝对路径是否可探测/可打开：本会话 cwd 内，或位于用户声明的白名单根内。
 * 白名单根额外两道闸：系统盘特征目录 → 拒绝；realpath 后逃出根（symlink）
 * → 拒绝。单根校验失败不影响其他根。
 */
function isProbeable(abs, cwd, roots) {
  if (typeof cwd === 'string' && cwd !== '' && isWithin(cwd, abs)) return true
  // 本机目录（用户主目录内）默认放行——2026-08-26 用户拍板：本机文件无需白名单，
  // 白名单只管外置盘/网络盘（用户声明 = 授权）。极端部署（HOME=/ 根）不放行，
  // 与 isSystemRoot 的"绝不盲放系统根"哲学一致。
  const home = homedir()
  if (home !== '' && home !== '/' && isWithin(home, abs)) return true
  if (!Array.isArray(roots)) return false
  for (const root of roots) {
    if (typeof root !== 'string' || root === '') continue
    if (!isWithin(root, abs)) continue
    if (isSystemRoot(root)) continue
    try {
      // 根与目标都经 realpath 后比较：root 自身含 symlink（如 macOS /var→/private/var、
      // 用户填的 ~ 别名）时不再误判为"根外"；abs 的 symlink 外逃仍被拦（物理位置
      // 不在根内即拒绝）——防逃逸语义不变，只是消灭对称性死角。
      const base = realpathSync(root)
      if (isSystemRoot(base)) continue
      if (!isWithin(base, realpathSync(abs))) continue
    } catch (error) {
      continue
    }
    return true
  }
  return false
}

/** 本地 CSRF 防护：请求 Origin/Host 必须为本机（同 perm-guard 先例）。 */
function isSameOrigin(req) {
  const origin = req.headers.origin || ''
  if (origin !== '') return /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin)
  const host = req.headers.host || ''
  return /^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host)
}

/**
 * 系统打开路径（execFile 直接传参，不经 shell，路径安全）：
 *   reveal=false（正文点击）：
 *     macOS 文件/目录 → open（默认应用打开文件 / 打开目录窗口）
 *     Windows → explorer；Linux → xdg-open
 *   reveal=true（列表 📂 按钮）：
 *     macOS 文件 → open -R（Finder 定位选中）；目录 → open（打开目录窗口）
 *     Windows 文件 → explorer /select,；目录 → explorer
 *     Linux → xdg-open
 * 成功返回 true，失败返回 null。
 */
function systemOpen(abs, isDir, reveal) {
  const platform = process.platform
  // explorer.exe 会把 D:/… 里的 / 当开关前缀，必须用原生反斜杠路径。
  const native = platform === 'win32' ? abs.replace(/\//g, '\\') : abs
  const args = []
  if (platform === 'darwin') args.push(!reveal || isDir ? '' : '-R', native)
  else if (platform === 'win32') args.push(!reveal || isDir ? '' : '/select,', native)
  else args.push(native)
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer' : 'xdg-open'
  const cleanArgs = args.filter((a) => a !== '')
  return new Promise((resolveOpen) => {
    execFile(command, cleanArgs, { timeout: 10000 }, (error) => {
      // explorer.exe 成功打开后常以退出码 1 返回（复用已有窗口），按启动成功处理；
      // spawn 失败（ENOENT 等字符串 code）仍视为失败。
      const ok = error === null || error === undefined
        || (platform === 'win32' && typeof error.code === 'number')
      resolveOpen(ok)
    })
  })
}

/** 收集请求体（JSON）。maxBytes 超出即中断并拒绝。 */
function readBody(req, maxBytes) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    let total = 0
    let aborted = false
    req.on('data', (chunk) => {
      total += chunk.length
      if (typeof maxBytes === 'number' && total > maxBytes) {
        aborted = true
        req.destroy()
        reject(new Error('request body too large'))
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (aborted) return
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveBody(text === '' ? {} : JSON.parse(text))
      } catch (error) {
        reject(error)
      }
    })
    req.on('error', reject)
  })
}

function writeJson(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  res.end(JSON.stringify(body))
}
