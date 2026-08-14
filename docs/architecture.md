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
│     · React 重渲染会清掉按钮，观察器自动补插（dataset.fmDone 防重复）│
└──────────────────────────────────┬───────────────────────────────────┘
                                   │ fetch (同源 /api/...)
┌──────────────────────────────────▼───────────────────────────────────┐
│  Node（Host）lib/index.js                                             │
│  POST /api/file-mentions/check  存在性验证                            │
│     { sessionId, paths[] } → { valid[] }                              │
│     按会话 cwd 解析：~/ 展开 homedir、相对路径 resolve(cwd, p)、       │
│     绝对路径 isAbsolute（兼容 Windows 盘符）                          │
│  POST /api/file-mentions/open   系统打开（execFile，不经 shell）      │
│     { sessionId, path, mode } → { ok }                                │
│     mode "open"（默认）：文件默认应用打开 / 目录打开窗口               │
│     mode "reveal"：Finder 定位选中 / 目录打开窗口                     │
│     平台分流：macOS open / Windows explorer / Linux xdg-open          │
└───────────────────────────────────────────────────────────────────────┘
```

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
6. 动态插件宿主环境（cordis_define）**无 Buffer / 无 process**：readBody 用
   TextDecoder、`~/` 展开交给 bash `$HOME`、系统命令走 `shell` 服务。

## 事件流（一轮回复）

```
turn/start ──► context 创建 { turn, paths: [] }
assistant/message ──► 提取路径合并进 paths ──► buildLocationData 发布
turn/end ──► turnTail 链评估：官方 deliverables 优先，无产物则本插件
             select 返回 paths ──► 组件 POST /check 过滤 ──► 渲染小圆钮
同时：正文渲染完成后 MutationObserver 补插 📂；用户点击裸 code / 📂 ──► POST /open
```
