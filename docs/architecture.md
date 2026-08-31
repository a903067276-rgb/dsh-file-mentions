# 架构说明（dsh-file-mentions）

零依赖、无构建。两个文件：`lib/index.js`（Host 半）+ `lib/client.js`（Client 半，
`window.__ModuleLoader__` bundle 格式）。

```
┌────────────────────────── 浏览器（Client）──────────────────────────┐
│  lib/client.js                                                        │
│  ① 收集器 conversationEvents.register(kind: "mentionedPaths")        │
│     · turn/start 建 context，assistant/message 提取路径（去重）       │
│     · buildLocationData 把 state 发布到 turn.data（唯一通道）        │
│  ② turnTail 链 slots.inject("conversation.chat.turnTail")            │
│     · select 读 turn.data.get("mentionedPaths")，空则让位（官方产物   │
│       列表先到先得，互不打架）                                        │
│     · 渲染前 POST /check 过滤不存在的路径，只显示真实文件             │
│  ③ 正文点击委托 document click（Codex 式）                           │
│     · 命中裸 <code>（跳过官方 button/a/pre）且文本像路径 → POST /open │
│     · 官方渲染层入口（chatFileMentions 单例）被官方 deliverables 占  │
│       死，无法扩展，故走 DOM 委托（唯一可行路径）                    │
│  ④ 正文 📂 按钮 MutationObserver 动态补插                            │
│     · 每个"像路径的裸 code"后面插小按钮 → POST /open mode=reveal     │
│     · React 重渲染会清掉按钮，观察器自动补插（dataset.fmBtn 防重复）│
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ fetch (同源 /api/...)
┌──────────────────────────────────▼───────────────────────────────────┐
│  Node（Host）lib/index.js                                             │
│  POST /api/file-mentions/check  存在性验证                            │
│     { sessionId, paths[] } → { valid[] }                              │
│     按会话 cwd 解析：~/ 展开 homedir、相对路径 resolve(cwd, p)、       │
│     绝对路径 isAbsolute（兼容 Windows 盘符）                          │
│     探测面（P1）：绝对/~ 路径只在本会话 cwd 内或白名单根内 existsSync │
│  POST /api/file-mentions/open   系统打开（execFile，不经 shell）      │
│     { sessionId, path, mode } → { ok }                                │
│     mode "open"（默认）：文件默认应用打开 / 目录打开窗口               │
│     mode "reveal"：Finder 定位选中 / 目录打开窗口                     │
│     平台分流：macOS open / Windows explorer / Linux xdg-open          │
│     绝对/~ 路径与 /check 同口径（cwd 内或白名单根内，越界拒绝）        │
│  GET/POST /api/file-mentions/config  外置盘白名单读写（设置页用）      │
│     isSameOrigin 校验（Origin/Host 必须本机，防本地 CSRF）            │
└───────────────────────────────────────────────────────────────────────┘
```

## 外置盘白名单（extraProbeRoots，v1.0.4）

背景：外置盘（/Volumes/USB 等）内绝对路径在 fm 里"不显示不可点"——/check 只认会话
cwd。"盲放 /Volumes"方案被否：系统装外接盘时 /Volumes 下就是完整系统盘 = oracle 洞。

设计（用户声明 = 授权，同 perm-guard trustedDirs 哲学）：

- 配置入口是**设置页**（settings.section + settings.plugin.item 双注册，共用
  SettingsCard），值存官方 settings 服务（命名空间字符串 `'file-mentions'` +
  `z.object({ extraProbeRoots: z.array(z.string()) })`），**每次请求现读** →
  保存即生效，无需重启，默认空 = 现状安全行为。不碰 patch.yml。
- `isProbeable(abs, cwd, roots)`：cwd 内 → 可探测；白名单根内 → 再过两道闸：
  ① 系统盘保护（根下存在 `/System` 或 `/etc`，win32 为 `\Windows` → 拒绝该根，
  一次性 warn 日志；配 `/` 也会自动被拒）；② symlink 防逃逸（`realpathSync` 后
  仍须在根内）。单根失败不影响其他根。
- /open 的 resolveFirst 绝对分支与 /check 同口径（v1.0.4 新增收紧：此前绝对路径
  无越界检查，任何存在路径可开）。副作用：`~/` 指向 cwd 外的路径不再可开，
  加白名单即恢复。多会话兜底不受影响（client 遍历所有 sessionId，各会话按自己
  cwd 判定）。
- client 端零改动即可让白名单路径可点：/Volumes/... 不被 client isAbs 正则识别，
  但 robustOpen 把原始路径原样发 host，host 的 isAbsolute 识别 + 白名单放行。

## 关键决策与坑（源码级查证）

1. **assistant 内容在 `event.data.message.content`**，不是 `event.data.content`
   （对照官方 assistant-step definition）。
2. **`buildLocationData` 是 Definition state → turn.data 的唯一发布通道**
   （client-runtime `replaceLocationData`），返回的 `key` 必须等于
   `definition.kind`、`kind` 必须等于 scope（"turn"）。缺它收集器白干。
3. **`chatFileMentions` 单例被官方 deliverables 占死**：cordis `ctx.provide`
   重复注册直接抛错，`ctx.set()` 只能改本 fiber 的服务 → 渲染层无法扩展，
   正文可点只能走 DOM 点击委托。
4. **官方 `openFile` 不是系统打开**：= `workspaces.openPath`（DSH 内部预览/
   状态切换），`~/` 解析不了，错误被 `.catch(() => {})` 静默吞掉 → 系统打开
   必须自己写 host 路由。
5. 官方产物按钮 DOM = `<code><button>`、URL = `<a>`、代码块 = `<pre><code>`
   → 点击委托按 `closest` 精确跳过，只处理裸 `<code>`。
6. 静态 bundle 宿主环境**可用完整 Node API**：readBody 用 `Buffer.concat`
   （带 maxBytes 上限）、平台判断走 `process.platform`、系统打开用 `execFile`
   直传参数不经 shell（路径安全）。

## 事件流（一轮回复）

```
turn/start ──► context 创建 { turn, paths: [] }
assistant/message ──► 提取路径合并进 paths ──► buildLocationData 发布
turn/end ──► turnTail 链评估：官方 deliverables 优先，无产物则本插件
             select 返回 paths ──► 组件 POST /check 过滤 ──► 渲染小圆钮
同时：正文渲染完成后 MutationObserver 补插 📂；用户点击裸 code / 📂 ──► POST /open
```
