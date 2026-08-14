# dsh-file-mentions 📎

[English](README.md) | [简体中文](README.zh-CN.md)

![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)

**回复里提到的文件/路径，点一下就打开** —— DeepSeek Harness（DSH）web 插件，Codex 式体验。

回复正文里反引号包着的路径（`~/...`、绝对路径、相对路径、中文路径）**直接点击就能打开**；
每个可点路径后面自动带一个 📂 小按钮，进文件管理器定位；回复尾部还有"📎 提到的文件"
小圆钮兜底。URL 链接由官方渲染器自动可点，无需本插件处理。

## 功能一览

| 位置 | 操作 | 效果 |
|---|---|---|
| 正文路径文字 | 点击 | 文件用系统默认应用打开 / 目录打开窗口 |
| 正文路径后的 📂 | 点击 | 文件管理器定位选中（macOS Finder） |
| 回复尾部"📎 提到的文件" | 点文件名 | DSH 内预览文件内容 |
| 回复尾部 📂 | 点击 | 文件管理器定位选中 |
| 正文 URL | 点击 | 浏览器打开（官方 autolink） |

支持 `~/` 展开、相对路径（按会话目录解析）、macOS/Linux/Windows 三种绝对路径形态；
不存在的路径点击后静默无反应（不报错、不弹窗）。

## 安装

### 官方 bundle 一行安装（推荐）

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-file-mentions#main"
```

重启 `dsh web` 生效。需要 pnpm（`dsh plugin` 是 pnpm 转发器）。

### 手动挂载（兜底）

详见 [docs/install.md](docs/install.md)：软链到
`~/.dsh/profiles/web/node_modules/` + `~/.dsh/cordis.patch.yml` 单 entry
（本插件单 entry 即可，双 entry 会重复注册路由崩溃），重启生效。

## 使用

agent 回复里用反引号包路径（如 `` `~/docs/计划.md` ``）即可触发正文点击。
尾部列表自动出现，无需配置。

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 全功能实测（含中文路径） |
| Linux / Windows | ⚠️ 未实测，架构上预期可用（命令分流与路径解析已实现） |

## 工作原理

- **Host**（`lib/index.js`）：两条路由 —— `/api/file-mentions/check`（存在性验证）、
  `/api/file-mentions/open`（系统打开，`mode: open/reveal`，平台命令分流）；
  全部 Node 标准库，`execFile` 不经 shell 防注入。
- **Client**（`lib/client.js`）：conversationEvents 收集器提取每轮回复里的路径 →
  发布到回合数据 → 尾部列表渲染前先过滤不存在的路径；正文可点用 **document 点击委托**
  （官方渲染入口被官方"产物"插件占用，无法扩展，这是唯一可行路径）；正文 📂 用
  MutationObserver 动态补插，React 重渲染自动恢复。

详见 [docs/architecture.md](docs/architecture.md)。

## 兼容性说明

- 正文可点依赖"反引号包裹的路径"（与 Codex 一致的 agent 输出惯例）；裸路径正文
  不支持（防误点普通文字）。
- 官方"产物"列表与本插件互不打架：官方有产出时优先，无产出时本插件显示。
- Windows / Linux 欢迎实测后提交 issue/PR 补充验证。

## License

MIT
