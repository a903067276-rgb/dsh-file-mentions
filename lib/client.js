window.__ModuleLoader__.load({
  id: "dsh-file-mentions",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
    let react = require("react");

    // 模块级：最近渲染的会话 id（正文点击委托用，组件渲染时更新）
    let currentSessionId = null;

    const inject = ["slots", "conversationEvents"];

    // ── 官方 dsw 风格（2026-08-18，对齐样板）：正文/列表的"打开定位"小按钮 ──
    const FOLDER_SVG = "<svg width='12' height='12' viewBox='0 0 16 16' fill='none' stroke='currentColor' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'><path d='M2 5.5V4.5A1.5 1.5 0 0 1 3.5 3h3l1.5 2h4.5A1.5 1.5 0 0 1 14 6.5v5A1.5 1.5 0 0 1 12.5 13h-9A1.5 1.5 0 0 1 2 11.5v-6z'/></svg>";

    // ── 设置卡片：外置盘白名单（extraProbeRoots，保存即生效、无需重启）──
    // 保存反馈统一口径（2026-08-21）：成功 = 按钮短暂变绿"✓ 已保存" + 按钮旁绿字；
    // 失败 = 按钮复原 + 按钮旁红字。样式全走 dsw token。
    function SettingsCard() {
      const [text, setText] = react.useState("");
      const [saving, setSaving] = react.useState(false);
      const [msg, setMsg] = react.useState(null); // { kind: "ok" | "err", text }
      const [saved, setSaved] = react.useState(false);
      const savedTimer = react.useRef(null);
      react.useEffect(() => {
        let alive = true;
        fetch("/api/file-mentions/config", { method: "GET", cache: "no-store" })
          .then((r) => r.json())
          .then((d) => {
            if (alive && d && Array.isArray(d.extraProbeRoots)) setText(d.extraProbeRoots.join("\n"));
          })
          .catch(() => {});
        return () => { alive = false; };
      }, []);
      react.useEffect(() => () => {
        if (savedTimer.current !== null) clearTimeout(savedTimer.current);
      }, []);
      function save() {
        const list = text.split("\n").map((s) => s.trim()).filter((s) => s !== "");
        setSaving(true);
        setMsg(null);
        fetch("/api/file-mentions/config", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ extraProbeRoots: list }),
        })
          .then((r) => r.json())
          .then((d) => {
            if (d && d.ok) {
              setText(list.join("\n"));
              setMsg({ kind: "ok", text: "已保存，立即生效" });
              setSaved(true);
              if (savedTimer.current !== null) clearTimeout(savedTimer.current);
              savedTimer.current = setTimeout(() => { setSaved(false); savedTimer.current = null; }, 2000);
            } else {
              setMsg({ kind: "err", text: "保存失败：" + ((d && d.error) || "未知错误") });
            }
          })
          .catch(() => setMsg({ kind: "err", text: "保存失败：网络错误" }))
          .finally(() => setSaving(false));
      }
      return react.createElement("div", { style: { padding: "8px 0", fontSize: 13 } },
        // 分区内容统一头部标题（2026-08-21，标题 = 分区名，样式对齐 memory/backup 的 h3）
        react.createElement("h3", { style: { margin: "0 0 8px", fontSize: 14, fontWeight: 600, color: "var(--dsw-alias-label-primary)" } }, "文件提及"),
        react.createElement("div", { style: { color: "var(--dsw-alias-label-tertiary)", fontSize: 12, marginBottom: 8, lineHeight: "18px" } },
          "外置盘白名单：会话工作目录之外的路径（外置盘、~/Desktop 等）加进来后可显示并点击打开；每行一个目录。系统盘特征目录（/System、/etc）会被自动拒绝。"),
        react.createElement("textarea", {
          value: text,
          onChange: (e) => setText(e.target.value),
          rows: 4,
          spellCheck: false,
          placeholder: "/Volumes/U盘名\n~/Desktop",
          style: {
            width: "100%", boxSizing: "border-box", padding: "6px 8px", fontSize: 12,
            fontFamily: "monospace", color: "var(--dsw-alias-label-secondary, #666)",
            background: "transparent",
            border: "1px solid var(--dsw-alias-border-l1, #e5e5e5)",
            borderRadius: 6, resize: "vertical",
          },
        }),
        react.createElement("div", { style: { display: "flex", alignItems: "center", gap: 10, marginTop: 8 } },
          react.createElement("button", {
            type: "button",
            onClick: save,
            disabled: saving,
            className: "dsh-fm-save" + (saved ? " is-saved" : ""),
          }, saving ? "保存中…" : (saved ? "✓ 已保存" : "保存")),
          msg !== null && react.createElement("span", {
            style: { fontSize: 12, color: msg.kind === "ok" ? "var(--dsw-alias-state-success-primary)" : "var(--dsw-alias-state-error-primary)" },
          }, msg.text)),
      );
    }

    function apply(ctx) {
      const slots = ctx.get("slots");
      const convEvents = ctx.get("conversationEvents");
      const sessionsSvc = ctx.get("sessions");
      if (slots === undefined) return;

      if (typeof document !== "undefined" && !document.getElementById("dsh-fm-style")) {
        const tag = document.createElement("style");
        tag.id = "dsh-fm-style";
        tag.textContent = [
          ".dsh-fm-reveal{display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:none;background:transparent;color:var(--dsw-alias-label-tertiary,#999);border-radius:4px;cursor:pointer;padding:0;margin-left:2px;vertical-align:baseline;}",
          ".dsh-fm-reveal:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
          ".dsh-fm-reveal svg{display:block;}",
          "code[data-fm-path]{cursor:pointer;color:var(--dsw-alias-state-business-primary,#2f6fed);text-decoration:underline;text-decoration-style:dotted;}",
          "code[data-fm-path]:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.08));border-radius:4px;}",
          // 设置卡保存按钮（统一按钮样板：透明底 + l2 边框 + hover 灰底 + 成功变绿）
          ".dsh-fm-save{display:inline-flex;align-items:center;gap:4px;border:1px solid var(--dsw-alias-border-l2,#d0d0d0);background:transparent;color:var(--dsw-alias-label-primary,#333);border-radius:8px;padding:5px 12px;font-size:12px;cursor:pointer;}",
          ".dsh-fm-save:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,0.06));}",
          ".dsh-fm-save:disabled{opacity:.5;cursor:default;}",
          ".dsh-fm-save.is-saved{color:var(--dsw-alias-state-success-primary);border-color:var(--dsw-alias-state-success-primary);}",
        ].join("\n");
        document.head.appendChild(tag);
      }

      // ── 打开路径（多会话 × 多路径组合兜底）──
      // 会话：先用最近渲染的会话，404 再试其它所有会话（跨对话看历史时目录可能对不上）
      // 路径：纯文件名（无目录）在会话根目录找不到时，再试 docs/ 前缀（DSH 项目文档惯例）
      function allSessionIds() {
        try {
          const snap = sessionsSvc && sessionsSvc.list ? sessionsSvc.list.getSnapshot() : null;
          return snap && snap.byId ? Object.keys(snap.byId) : [];
        } catch (error) {
          return [];
        }
      }
      async function robustOpen(path, mode) {
        const ids = [];
        if (currentSessionId !== null) ids.push(currentSessionId);
        for (const id of allSessionIds()) if (!ids.includes(id)) ids.push(id);
        // Windows: explorer.exe 会把 D:/… 中的 / 当作开关前缀导致打开错误位置，
        // 发送前统一转成原生反斜杠路径。
        let target = path;
        if (/^[A-Za-z]:\//.test(path)) target = path.replace(/\//g, "\\");
        const bare = !target.includes("/") && !target.includes("\\");
        const isAbs = /^[A-Za-z]:[\\/]/.test(target) || target.startsWith("\\\\") || target.startsWith("~/");
        // 客户端已知的各会话 cwd（含重启后还没打开过的冷会话——host 的活会话列表里没有它们，
        // 相对路径只靠 host 解析会失败，表现为"点了没反应"）。
        const cwdSet = new Set();
        try {
          const snap = sessionsSvc && sessionsSvc.list ? sessionsSvc.list.getSnapshot() : null;
          if (snap && snap.byId) {
            for (const id of ids) {
              const cwd = snap.byId[id] && snap.byId[id].cwd;
              if (typeof cwd === "string" && cwd !== "") cwdSet.add(cwd);
            }
          }
        } catch (error) {
        }
        // 拼绝对候选的分隔符按本机平台取（浏览器端无 node:path，用 navigator.platform 判断）：
        // Windows 用反斜杠（explorer 语义），macOS/Linux 用正斜杠——硬编码反斜杠在 macOS 上是
        // 合法文件名字符，拼出来是无效候选（白费一次请求）；极端跨平台场景由 host 相对路径兜底。
        const sep = (typeof navigator !== "undefined" && /win/i.test(navigator.platform || "")) ? "\\" : "/";
        const joinPath = (base, rel) => base.replace(/[\\/]+$/, "") + sep + rel.replace(/^[\\/]+/, "");
        for (const id of ids) {
          const tries = [];
          // 相对路径：先发客户端拼好的绝对候选（host 直接命中，不依赖活会话），再发原始相对路径兜底
          if (!isAbs) {
            for (const cwd of cwdSet) {
              tries.push(joinPath(cwd, target));
              if (bare) tries.push(joinPath(cwd, "docs" + sep + target));
            }
          }
          tries.push(target);
          if (bare) tries.push("docs/" + target);
          for (const candidate of tries) {
            try {
              const res = await fetch("/api/file-mentions/open", {
                method: "POST",
                headers: { "content-type": "application/json" },
                body: JSON.stringify({ sessionId: id, path: candidate, mode: mode || "open" }),
                cache: "no-store",
              });
              if (res.ok) return;
            } catch (error) {
              // 网络错误继续试下一个组合
            }
          }
        }
      }

      // ── 路径提取：从 assistant 文本块里找出像路径的 token ──
      // 相对路径要求带常见扩展名（防 "3/5 个" 误伤）；绝对/~ 路径宽松匹配；排除 http(s)
      // 绝对路径覆盖 macOS(/Users)、Linux(/home /opt /etc /usr /var /root /tmp /srv /mnt)、
      // Windows(C:\ 与 C:/)；~/ 全平台。
      const EXT = "(md|markdown|txt|text|json|js|jsx|ts|tsx|py|yaml|yml|toml|css|html|svg|png|jpg|jpeg|gif|webp|pdf|docx|xlsx|csv|log|sh|bash|env|lock|mod|sum|gradle|xml|ini|conf|cfg|sql|db|wasm|c|cpp|h|hpp|java|go|rs|rb|php|vue|svelte|astro|scss|less)";
      const ABS = new RegExp("(?:/[a-zA-Z][a-zA-Z0-9_-]*/[^\\s`\"'，。；、()（）]+|[A-Za-z]:[\\\\/][^\\s`\"'，。；、()（）]+|~/[^\\s`\"'，。；、()（）]+)", "g");
      // 前瞻集含 `.`：`foo.md.`（句末英文句号）也能配中，句号不被吞进捕获组；
      // 不破坏 URL 匹配——URL 由 push 的 scheme:// 过滤兜底。
      const REL = new RegExp("(?:^|[\\s(（`])([^\\s`\"'，。；、()（）\\[\\]]+\\." + EXT + ")(?=[\\s)）\\]`，。；、:.])", "g");

      function extractPaths(content) {
        const out = [];
        const push = (p) => {
          const t = p.replace(/[，。；、)）]$/, "").trim();
          if (t === "" || /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || t.length > 300) return;
          if (!out.includes(t)) out.push(t);
        };
        if (!Array.isArray(content)) return out;
        for (const block of content) {
          if (!block || block.type !== "text" || typeof block.text !== "string") continue;
          const text = block.text;
          // 跳过围栏代码块
          const segments = text.split(/```[^\n]*\n[\s\S]*?```/g);
          for (const seg of segments) {
            for (const m of seg.matchAll(ABS)) push(m[0]);
            for (const m of seg.matchAll(/`([^`]+)`/g)) push(m[1]);
            for (const m of seg.matchAll(REL)) push(m[1]);
          }
        }
        return out;
      }

      // ── conversationEvents 收集器：每轮 assistant 文本 → 提取路径存 turn data ──
      if (convEvents !== undefined) {
        convEvents.register({
          kind: "mentionedPaths",
          match: (event) => {
            if (event.type === "turn/start") return { id: String(event.data.turn), role: "start" };
            if (event.type === "assistant/message") return { id: String(event.data.turn), role: "update" };
            return null;
          },
          start: (context, match) => ({
            turn: match.event.data.turn,
            paths: [],
          }),
          update: (context, match) => {
            if (match.event.type !== "assistant/message") return context.state;
            // 内容在 message.content（协议块数组），不是 data.content
            const found = extractPaths(match.event.data.message && match.event.data.message.content);
            if (found.length === 0) return context.state;
            const merged = [...context.state.paths];
            for (const p of found) if (!merged.includes(p)) merged.push(p);
            return { ...context.state, paths: merged };
          },
          // 关键：state → turn.data 的唯一发布通道（同官方 deliverables 模式）
          buildLocationData: (context, scope) => scope !== "turn" || context.state === void 0 ? null : {
            kind: "turn",
            turn: context.state.turn,
            key: "mentionedPaths",
            value: { paths: context.state.paths },
          },
        });
      }

      // ── 正文点击委托：点中正文里 <code> 中的路径 → 系统打开（Codex 式正文可点）──
      // 官方产物按钮结构是 <code><button>…</button></code>、URL 是 <a>、代码块是
      // <pre><code> —— 这三类 target.closest 直接跳过；剩下裸 <code> 且文本像路径才处理。
      // 只响应已打标记（存在性预检通过）的 code，未标记的一律不响应（防误点打不开）。
      // ~/ 开头、或 Windows 盘符(C:\ 或 C:/)、或 / 后跟含字母的段（纯数字段如 "3/5" 不算）、或带常见扩展名
      const PATHISH = new RegExp("(?:~/|[A-Za-z]:[\\\\/]|/[^0-9\\\\s/]|\\.(?:" + EXT + ")\\b)", "i");
      // URL/域名形态过滤：://（ftp 等非 http）、协议相对 //、域名路径（example.com/foo、www.x.com/foo）
      function isUrlish(text) {
        if (/:\/\//i.test(text)) return true;
        if (/^\/\//.test(text)) return true;
        if (/^(?:www\.|[a-z0-9-]+(?:\.[a-z0-9-]+)+\/)/i.test(text)) return true;
        return false;
      }
      function onDocumentClick(event) {
        const target = event.target;
        if (target === null || target.nodeType !== 1) return;
        if (target.closest("button") !== null || target.closest("a") !== null || target.closest("pre") !== null) return;
        // 裸绝对路径链接（processBarePaths 包裹的 span）
        const inline = target.closest("[data-fm-inline]");
        if (inline !== null) {
          const raw = inline.dataset.fmInline;
          if (raw) robustOpen(raw, "open");
          return;
        }
        const code = target.closest("code");
        if (code === null) return;
        // 未预检通过（无 data-fm-path）的 code 不响应点击
        if (code.dataset === undefined || code.dataset.fmPath !== "1") return;
        const text = (code.textContent || "").trim();
        if (text === "" || text.length > 300 || isUrlish(text)) return;
        // 直接请求 open 路由（多会话 × docs/ 前缀兜底）；全部失败时静默
        robustOpen(text, "open");
      }
      ctx.effect(() => {
        document.addEventListener("click", onDocumentClick);
        return () => document.removeEventListener("click", onDocumentClick);
      }, "file-mentions: body click delegation");

      // ── 正文路径后跟 📂 小按钮（文件管理器定位）：MutationObserver 动态补插 ──
      // 官方渲染的正文不能改，用观察器在每个"像路径的裸 code"后面插一个小按钮；
      // React 重渲染会清掉按钮和 data-fm-path 标记（CSS code[data-fm-path] 的
      // hover/链接样式依赖标记）——所以每次先重新打标记（必须在"按钮已存在"
      // continue 之前），再检查"紧邻的下一个兄弟是否还是我们的按钮"，是则跳过补插。
      //
      // 误报防线（v1.0.5）：反引号里的代码标识（notice、#2ecc71、--dsw-xxx、函数名）
      // 也会"像路径"。打标记前先做存在性预检（复用 host /check，多会话批量 + 缓存）：
      // 只有真实存在的路径才显示可点样式 + 📂；网络全挂时保守放行（保持旧行为，
      // 打开动作仍由 host 越界拦截兜底）。
      const pathCheckCache = new Map(); // text -> true/false（页面级缓存，刷新即失效）
      function markCode(code, text) {
        // 先标记再判断按钮：data-fm-path 是 hover/链接样式开关，React 重渲染会清掉它；
        // 按钮还在时 continue 跳过补插，但标记必须在 continue 之前补上，保证样式总能恢复。
        code.dataset.fmPath = "1";
        const next = code.nextElementSibling;
        if (next !== null && next.dataset !== undefined && next.dataset.fmBtn === "1") return;
        const btn = document.createElement("button");
        btn.type = "button";
        btn.dataset.fmBtn = "1";
        btn.className = "dsh-fm-reveal";
        btn.innerHTML = FOLDER_SVG;
        btn.title = "在文件管理器中显示";
        btn.addEventListener("click", (event) => {
          event.stopPropagation();
          robustOpen(text, "reveal");
        });
        if (code.parentNode !== null) code.parentNode.insertBefore(btn, code.nextSibling);
      }
      function verifyPaths(pending) {
        const ids = [];
        if (currentSessionId !== null) ids.push(currentSessionId);
        for (const id of allSessionIds()) if (!ids.includes(id)) ids.push(id);
        const okSet = new Set();
        let responded = 0;
        Promise.all(ids.map((id) =>
          fetch("/api/file-mentions/check", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ sessionId: id, paths: pending }),
            cache: "no-store",
          })
            .then((r) => (r.ok ? r.json() : null))
            .then((d) => {
              responded += 1;
              if (d && Array.isArray(d.valid)) for (const v of d.valid) okSet.add(v);
            })
            .catch(() => {})
        )).then(() => {
          // 全部请求失败（网络异常）→ 保守放行，保持旧行为；否则按存在性判
          const failOpen = responded === 0;
          for (const t of pending) {
            pathCheckCache.set(t, failOpen || okSet.has(t));
            pathCheckInflight.delete(t);
          }
          processPathCodes(); // 重跑：缓存已就绪，打标记
        });
      }
      const pathCheckInflight = new Map(); // text -> 1（去重，防同批重复请求）
      function processPathCodes() {
        const nodes = document.querySelectorAll("code");
        const pending = [];
        for (const code of nodes) {
          if (code.closest("button") !== null || code.closest("a") !== null || code.closest("pre") !== null) continue;
          const text = (code.textContent || "").trim();
          if (text === "" || text.length > 300 || isUrlish(text)) continue;
          if (!PATHISH.test(text)) continue;
          if (pathCheckCache.has(text)) {
            if (pathCheckCache.get(text)) markCode(code, text);
            continue;
          }
          if (!pathCheckInflight.has(text)) {
            pathCheckInflight.set(text, 1);
            pending.push(text);
          }
        }
        if (pending.length > 0) verifyPaths(pending);
      }
      // ── 正文裸绝对路径变可点链接：~/、盘符、/ 开头（前一个字符不能是字母/数字/冒号/斜杠，
      //    防 URL 与 a/b 这类相对写法）；MutationObserver 补插，React 重渲染自动恢复 ──
      const BARE = new RegExp("(?:~/[^\\s`\"'，。；、()（）<>]+|[A-Za-z]:[\\\\/](?![\\\\/])[^\\s`\"'，。；、()（）<>]+|(?<![A-Za-z0-9_:/])/[a-zA-Z][^\\s`\"'，。；、()（）<>]*)", "g");
      const INLINE_STYLE = "color:var(--dsw-alias-state-business-primary,#2f6fed);text-decoration:underline;text-decoration-style:dotted;cursor:pointer;";
      function processBarePaths() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const p = node.parentElement;
            if (p === null) return NodeFilter.FILTER_REJECT;
            // 跳过 React 管理的对话消息区与输入区（data-conversation-scroll / textarea / input /
            // contenteditable / mirror / backdrop / composer）：替换文本节点会与 React 渲染冲突
            // 导致输入框消失或整个对话框崩溃（issue #5：/plan 后按空格）。输入区选择器取自
            // xiaya007 的 PR #6（合并时保留 Windows 路径逻辑，仅取其输入区跳过部分）。
            // 裸路径链接只作用于消息区之外；反引号路径（processPathCodes）不受影响。
            if (p.closest("code, pre, a, button, script, style, [data-fm-inline], [data-conversation-scroll], textarea, input, [contenteditable], [data-input-mirror], [data-input-backdrop], [data-composer-card], [class$='_input']")) return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
          },
        });
        const batch = [];
        while (walker.nextNode() !== null) batch.push(walker.currentNode);
        for (const node of batch) {
          const text = node.nodeValue || "";
          if (text === "" || text.length > 400) continue;
          BARE.lastIndex = 0;
          const hits = [];
          let m;
          while ((m = BARE.exec(text)) !== null) {
            const raw = m[0];
            if (isUrlish(raw)) continue;
            hits.push([m.index, m.index + raw.length, raw]);
            if (hits.length >= 8) break;
          }
          if (hits.length === 0) continue;
          const frag = document.createDocumentFragment();
          let pos = 0;
          for (const [s, e, raw] of hits) {
            if (s > pos) frag.appendChild(document.createTextNode(text.slice(pos, s)));
            const span = document.createElement("span");
            span.dataset.fmInline = raw;
            span.title = "点击打开: " + raw;
            span.style.cssText = INLINE_STYLE;
            span.textContent = raw;
            frag.appendChild(span);
            pos = e;
          }
          if (pos < text.length) frag.appendChild(document.createTextNode(text.slice(pos)));
          if (node.parentNode !== null) node.parentNode.replaceChild(frag, node);
        }
      }
      ctx.effect(() => {
        const observer = new MutationObserver(() => {
          processPathCodes();
          processBarePaths();
        });
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
        processPathCodes();
        processBarePaths();
        return () => observer.disconnect();
      }, "file-mentions: reveal buttons + bare path links");

      // ── turnTail：官方有产出时让位（链式先匹配者胜），无产出且提到路径时显示 ──
      slots.inject("conversation.chat.turnTail", () => slots.register(
        {
          name: "conversation.chat.turnTail",
          select: (owner) => {
            const data = owner.turn && owner.turn.data ? owner.turn.data.get("mentionedPaths") : undefined;
            const paths = data && Array.isArray(data.paths) ? data.paths : [];
            return paths.length === 0 ? null : paths;
          },
        },
        (props) => {
          const matched = props.matched;
          const openFile = props.openFile;
          const sessionId = props.sessionId;
          currentSessionId = sessionId; // 供正文点击委托解析相对路径
          const [valid, setValid] = react.useState(null);

          react.useEffect(() => {
            let alive = true;
            setValid(null);
            fetch("/api/file-mentions/check", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ sessionId, paths: matched }),
              cache: "no-store",
            }).then((res) => res.json()).then((data) => {
              if (alive) setValid(data && Array.isArray(data.valid) ? data.valid : []);
            }).catch(() => {
              if (alive) setValid([]);
            });
            return () => { alive = false; };
          }, [matched, sessionId]);

          if (valid === null || valid.length === 0) return null;

          const basename = (p) => { const i = Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")); return i >= 0 ? p.slice(i + 1) : p; };
          // 系统打开：mode "open" = 默认应用打开（正文点击）；"reveal" = Finder 定位（📂 按钮）
          const systemOpen = (p, mode) => { robustOpen(p, mode); };

          return react.createElement("div", {
            style: { display: "flex", alignItems: "center", gap: "4px", flexWrap: "wrap", marginTop: "4px" },
          },
            react.createElement("span", {
              style: { display: "inline-flex", alignItems: "center", gap: "3px", fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #999)" },
              dangerouslySetInnerHTML: { __html: FOLDER_SVG },
            }, null),
            react.createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-label-tertiary, #999)" } }, "提到的文件"),
            valid.map((p, index) => react.createElement("span", {
              key: index,
              style: { display: "inline-flex", alignItems: "center", gap: "2px" },
            },
              // 主按钮：DSH 内预览文件内容（官方 openFile）
              react.createElement("button", {
                type: "button",
                onClick: () => openFile(p),
                title: p + "（点击预览内容）",
                style: {
                  border: "1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.12))",
                  background: "transparent",
                  color: "var(--dsw-alias-label-secondary, #666)",
                  borderRadius: "999px", cursor: "pointer", fontSize: "11px", lineHeight: "16px", padding: "0 8px",
                },
              }, basename(p)),
              // 小按钮：文件管理器定位（文件）或打开目录
              react.createElement("button", {
                type: "button",
                onClick: () => systemOpen(p, "reveal"),
                title: "在文件管理器中显示",
                className: "dsh-fm-reveal",
                dangerouslySetInnerHTML: { __html: FOLDER_SVG },
              })
            ))
          );
        }
      ));

      // ── 设置卡片：外置盘白名单（侧边栏页 + 插件卡片，内容一致）──
      slots.inject("settings.section", () => slots.register(
        { name: "settings.section", id: "dsh-file-mentions-settings", order: 40, label: "文件提及" },
        () => react.createElement(SettingsCard),
      ));
      slots.inject("settings.plugin.item", () => slots.register(
        { name: "settings.plugin.item", key: "file-mentions" },
        () => react.createElement(SettingsCard),
      ));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
