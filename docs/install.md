# 安装指南（dsh-file-mentions）

## 安装（推荐：官方 bundle 一行安装）

本仓库是官方 **bundle 插件**格式（根 `package.json` 的 `dsh.bundle` + `dsh.client`），
经官方 profile 管理：

```sh
dsh plugin --profile web add "github:a903067276-rgb/dsh-file-mentions#main"
```

装完**重启 `dsh web`**（bundle 层在启动时合成）。更新时
`dsh plugin --profile web update dsh-file-mentions`（或换 git 源 ref），重启生效。

> **需要 pnpm**：`dsh plugin` 是 pnpm 转发器，PATH 里没有 pnpm 会直接失败。
> 未安装可用 `npm i -g pnpm`（或 corepack 启用）；pnpm 主版本需与 profile
> 现有 store 一致（本机为 v11，装 pnpm@10 会报 `ERR_PNPM_UNEXPECTED_STORE`）。

## 安装（兜底：手动挂载，macOS 实测路径）

> 手动方式**无需** `dsh plugin add`，与 bundle 安装**二选一**，不要同时用。

### 安装步骤

1. **把仓库放到本地**，例如 `~/dsh-plugins/dsh-file-mentions`（克隆或直接拷贝均可）。

2. **让 web profile 能按包名解析到它**（host 的 apply 与 client 半的发现机制都按
   包名解析，必须可 `require.resolve('dsh-file-mentions/package.json')`）：

   ```bash
   ln -s ~/dsh-plugins/dsh-file-mentions ~/.dsh/profiles/web/node_modules/dsh-file-mentions
   ```

3. **在 `~/.dsh/cordis.patch.yml` 追加单 entry**（示例见
   [`examples/cordis.patch.example.yml`](../examples/cordis.patch.example.yml)）：

   ```yaml
   - insert:
       - id: file-mentions
         name: 'dsh-file-mentions'
   ```

   > 本插件**单 entry 包名挂载即可**（host apply 与 clientModules 都走包加载）——
   > 与 dsh-hud 的"双 entry"不同，双 entry 会让本插件 apply 两次，导致
   > `/api/file-mentions/*` 路由重复注册崩溃。

4. **重启 `dsh web`**。宿主组合（patch 层）变化必须重启才生效，热更新无效。

## 验证是否装好

- 浏览器访问 `/plugins/dsh-file-mentions/client.js` 返回 200；
- `curl -X POST http://127.0.0.1:3080/api/file-mentions/check -H 'content-type: application/json' -d '{"sessionId":"<任意>","paths":["<存在的路径>"]}'`
  返回 `{"valid":[...]}`；
- 某条回复里提到带反引号的路径（如 `` `~/foo/bar.md` ``）时：
  - 点路径文字 → 默认应用打开；
  - 点路径后面的 📂 → 在文件管理器中定位（macOS Finder）；
  - 回复尾部出现"📎 提到的文件"小圆钮（存在性校验通过后）。

## 卸载

- bundle 安装：`dsh plugin --profile web remove dsh-file-mentions`，重启 `dsh web`。
- 手动挂载：删除 `~/.dsh/cordis.patch.yml` 里的 entry、删除软链
  `~/.dsh/profiles/web/node_modules/dsh-file-mentions`，重启 `dsh web`。
- 从手动挂载**迁移**到 bundle 安装：先卸载手动方式（上一条），再执行 bundle 安装命令，
  重启。两种方式不要同时存在。

## 平台支持

| 平台 | 状态 |
|---|---|
| macOS | ✅ 开发环境，全功能实测（含中文路径、`~/`、相对路径） |
| Linux | ⚠️ 未实测；架构上预期可用（`xdg-open` 分流已实现，需桌面环境） |
| Windows | ⚠️ 未实测；架构上预期可用（`explorer` 分流、盘符路径解析已实现） |

**为什么预期可用**：host 半全部使用 Node 标准库（`fs`/`os`/`path`/`child_process`），
绝对路径判断用 `node:path` 的 `isAbsolute`（兼容 Windows 盘符）；系统打开命令按
`process.platform` 分流（macOS `open` / Windows `explorer` / Linux `xdg-open`）；
client 半的路径提取正则在 macOS、Linux（`/home` `/opt` 等）、Windows（`C:\`、`C:/`）
三种形态下均已做单元断言（见仓库测试脚本）。

已知边界：

- Linux 无桌面环境时 `xdg-open` 无效果；
- Windows 路径含中文时 `explorer` 行为未实测；
- 正文可点依赖"反引号包裹的路径"（与 Codex 一致的惯例），裸路径正文不支持（防误点）。

欢迎在 Windows / Linux 上验证后提交 issue 或 PR 补充实测结果。

## 已知注意事项（全部实测）

1. **单 entry 包名挂载**：host 的 apply 与 clientModules 都按包名解析，双 entry 会
   重复注册路由崩溃（与 dsh-hud 的双 entry 结论不同，两插件挂载方式互不通用）。
2. **文件路径挂载的插件必须 `export const inject = [...]` 声明依赖**，否则
   `ctx.get()` 拿到的服务全是 `undefined`。
3. **旧副本遮蔽**：`~/.dsh/profiles/web/node_modules` 里如果残留旧拷贝（而非软链），
   会遮蔽源码改动。插件更新后请检查此处，确保指向源码的软链。
4. **client 改动刷新页面即可**（bundle 动态读文件）；host 改动必须重启 `dsh web`
   （看进程 PID 变了才算）。
