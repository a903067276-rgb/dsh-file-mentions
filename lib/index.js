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
        const valid = []
        for (const p of paths) {
          try {
            // 相对路径先按指定会话 cwd 解析，找不到再遍历所有会话 cwd 兜底
            // （跨会话点历史回复里的相对路径时，前端传的 sessionId 可能不是目标会话）
            const hit = resolveFirst(p, cwd, sessions)
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
        // 相对路径多会话 cwd 兜底（同上）
        const abs = resolveFirst(path, cwd, sessions)
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
 * 解析到第一个真实存在的绝对路径；找不到返回 null。
 * 相对路径：先按指定会话 cwd，再遍历所有会话 cwd 兜底（跨会话点历史回复）。
 * 绝对/~ 路径不依赖会话，直接验证。
 */
function resolveFirst(p, cwd, sessions) {
  if (isAbsolute(p) || p.startsWith('~/')) {
    const abs = resolvePath(p, cwd)
    return existsSync(abs) ? abs : null
  }
  const tried = new Set()
  if (typeof cwd === 'string' && cwd !== '') {
    const abs = resolve(cwd, p)
    if (existsSync(abs)) return abs
    tried.add(cwd)
  }
  if (sessions !== undefined && typeof sessions.list === 'function') {
    for (const s of sessions.list()) {
      const scwd = s && s.header && typeof s.header.cwd === 'string' ? s.header.cwd : null
      if (scwd === null || scwd === '' || tried.has(scwd)) continue
      tried.add(scwd)
      const abs = resolve(scwd, p)
      if (existsSync(abs)) return abs
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
  const args = []
  if (platform === 'darwin') args.push(!reveal || isDir ? '' : '-R', abs)
  else if (platform === 'win32') args.push(!reveal || isDir ? '' : '/select,', abs)
  else args.push(abs)
  const command = platform === 'darwin' ? 'open' : platform === 'win32' ? 'explorer' : 'xdg-open'
  const cleanArgs = args.filter((a) => a !== '')
  return new Promise((resolveOpen) => {
    execFile(command, cleanArgs, { timeout: 10000 }, (error) => {
      resolveOpen(error === null || error === undefined)
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
