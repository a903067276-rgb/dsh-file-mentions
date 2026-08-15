/**
 * dsh-file-mentions — Host 半
 *
 * 提供路径路由（全部按会话 cwd 解析，~/ 展开、相对路径）：
 *   1. POST /api/file-mentions/check —— 路径存在性验证（{ sessionId, paths } → { valid }）
 *   2. POST /api/file-mentions/open  —— 系统打开路径（{ sessionId, path, mode } → { ok }）
 *      mode: "open"（默认）= 默认应用打开文件 / 打开目录窗口（正文点击）
 *      mode: "reveal"             = Finder 定位选中文件 / 打开目录窗口（列表 📂 按钮）
 * 纯 Node 实现，跨平台（macOS 实测；Win/Linux 命令已按平台分流）。
 */
import { existsSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { resolve, isAbsolute } from 'node:path'
import { execFile } from 'node:child_process'

export const name = 'dsh-file-mentions'
export const inject = ['webServer', 'sessions']

export function apply(ctx) {
  const webServer = ctx.webServer
  const sessions = ctx.sessions
  if (webServer === undefined || sessions === undefined) return
  // 可选持久来源：相对路径解析兜底用。重启后未打开的会话不在活会话列表里，
  // 只靠 sessions.list() 会解析失败（"点了没反应"）。
  const workspaceRegistry = ctx.get('workspaceRegistry')
  const sessionPersistence = ctx.get('sessionPersistence')

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: '/api/file-mentions/check',
    handler: async (req, res) => {
      try {
        const body = await readBody(req)
        const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : null
        const paths = body && Array.isArray(body.paths)
          ? body.paths.filter((p) => typeof p === 'string' && p !== '')
          : []
        if (sessionId === null || paths.length === 0) {
          writeJson(res, 400, { valid: [] })
          return
        }
        const session = sessions.get(sessionId)
        const cwd = session && session.header && typeof session.header.cwd === 'string' ? session.header.cwd : null
        const extras = await durableCwds(workspaceRegistry, sessionPersistence)
        const valid = []
        for (const p of paths) {
          try {
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
        const body = await readBody(req)
        const sessionId = body && typeof body.sessionId === 'string' ? body.sessionId : null
        const path = body && typeof body.path === 'string' && body.path !== '' ? body.path : null
        const mode = body && typeof body.mode === 'string' && body.mode === 'reveal' ? 'reveal' : 'open'
        if (sessionId === null || path === null) {
          writeJson(res, 400, { ok: false })
          return
        }
        const session = sessions.get(sessionId)
        const cwd = session && session.header && typeof session.header.cwd === 'string' ? session.header.cwd : null
        const extras = await durableCwds(workspaceRegistry, sessionPersistence)
        const abs = await resolveFirst(path, cwd, sessions, extras)
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
 * 解析到第一个真实存在的绝对路径；找不到返回 null。
 * 相对路径：先按指定会话 cwd，再遍历活会话 cwd，最后是持久化兜底基数。
 * 绝对/~ 路径不依赖会话，直接验证。
 */
async function resolveFirst(p, cwd, sessions, extras) {
  if (isAbsolute(p) || p.startsWith('~/')) {
    const abs = resolvePath(p, cwd)
    return existsSync(abs) ? abs : null
  }
  const tried = new Set()
  const attempt = (base) => {
    if (typeof base !== 'string' || base === '' || tried.has(base)) return null
    tried.add(base)
    const abs = resolve(base, p)
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

/** 收集请求体（JSON）。 */
function readBody(req) {
  return new Promise((resolveBody, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
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
