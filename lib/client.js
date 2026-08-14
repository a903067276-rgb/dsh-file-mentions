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

    function apply(ctx) {
      const slots = ctx.get("slots");
      const convEvents = ctx.get("conversationEvents");
      const sessionsSvc = ctx.get("sessions");
      if (slots === undefined) return;

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
        const bare = !path.includes("/") && !path.includes("\\");
        for (const id of ids) {
          const tries = bare ? [path, "docs/" + path] : [path];
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
      const REL = new RegExp("(?:^|[\\s(（`])([^\\s`\"'，。；、()（）\\[\\]]+\\." + EXT + ")(?=[\\s)）\\]`，。；、:])", "g");

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
      // ~/ 开头、或 Windows 盘符(C:\ 或 C:/)、或 / 后跟含字母的段（纯数字段如 "3/5" 不算）、或带常见扩展名
      const PATHISH = new RegExp("(?:~/|[A-Za-z]:[\\\\/]|/[^0-9\\\\s/]|\\.(?:" + EXT + ")\\b)", "i");
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
        const text = (code.textContent || "").trim();
        if (text === "" || text.length > 300 || /^https?:\/\//i.test(text)) return;
        if (!PATHISH.test(text)) return;
        // 直接请求 open 路由（多会话 × docs/ 前缀兜底）；全部失败时静默
        robustOpen(text, "open");
      }
      ctx.effect(() => {
        document.addEventListener("click", onDocumentClick);
        return () => document.removeEventListener("click", onDocumentClick);
      }, "file-mentions: body click delegation");

      // ── 正文路径后跟 📂 小按钮（进目录/Finder 定位）：MutationObserver 动态补插 ──
      // 官方渲染的正文不能改，用观察器在每个"像路径的裸 code"后面插一个小按钮；
      // React 重渲染会清掉按钮，观察器对新 code 自动补插（dataset.fmDone 防重复）。
      const REVEAL_STYLE = "border:1px solid var(--dsw-alias-border-strong, rgba(0,0,0,0.12));background:transparent;color:var(--dsw-alias-text-tertiary,#999);border-radius:999px;cursor:pointer;font-size:10px;line-height:14px;padding:0 4px;margin-left:2px;vertical-align:baseline;";
      function processPathCodes() {
        const nodes = document.querySelectorAll("code");
        for (const code of nodes) {
          if (code.dataset.fmDone === "1") continue;
          if (code.closest("button") !== null || code.closest("a") !== null || code.closest("pre") !== null) continue;
          const text = (code.textContent || "").trim();
          if (text === "" || text.length > 300 || /^https?:\/\//i.test(text)) continue;
          if (!PATHISH.test(text)) continue;
          code.dataset.fmDone = "1";
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = "📂";
          btn.title = "在 Finder 中显示";
          btn.style.cssText = REVEAL_STYLE;
          btn.addEventListener("click", (event) => {
            event.stopPropagation();
            robustOpen(text, "reveal");
          });
          if (code.parentNode !== null) code.parentNode.insertBefore(btn, code.nextSibling);
        }
      }
      // ── 正文裸绝对路径变可点链接：~/、盘符、/ 开头（前一个字符不能是字母/数字/冒号/斜杠，
      //    防 URL 与 a/b 这类相对写法）；MutationObserver 补插，React 重渲染自动恢复 ──
      const BARE = new RegExp("(?:~/[^\\s`\"'，。；、()（）<>]+|[A-Za-z]:[\\\\/](?![\\\\/])[^\\s`\"'，。；、()（）<>]+|(?<![A-Za-z0-9_:/])/[a-zA-Z][^\\s`\"'，。；、()（）<>]*)", "g");
      const INLINE_STYLE = "color:var(--dsw-alias-link,#2f6fed);text-decoration:underline;text-decoration-style:dotted;cursor:pointer;";
      function processBarePaths() {
        const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
          acceptNode(node) {
            const p = node.parentElement;
            if (p === null) return NodeFilter.FILTER_REJECT;
            if (p.closest("code, pre, a, button, script, style, [data-fm-inline]")) return NodeFilter.FILTER_REJECT;
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
            if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) continue;
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
        observer.observe(document.body, { childList: true, subtree: true });
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
            react.createElement("span", { style: { fontSize: "11px", color: "var(--dsw-alias-text-tertiary, #999)" } }, "📎 提到的文件"),
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
                  border: "1px solid var(--dsw-alias-border-strong, rgba(0,0,0,0.12))",
                  background: "var(--dsw-alias-interactive-bg, rgba(97,135,216,0.12))",
                  color: "var(--dsw-alias-text-secondary, #666)",
                  borderRadius: "999px", cursor: "pointer", fontSize: "11px", lineHeight: "16px", padding: "0 8px",
                },
              }, basename(p)),
              // 小按钮：Finder 定位（文件）或打开目录
              react.createElement("button", {
                type: "button",
                onClick: () => systemOpen(p, "reveal"),
                title: "在 Finder 中显示",
                style: {
                  border: "1px solid var(--dsw-alias-border-strong, rgba(0,0,0,0.12))",
                  background: "transparent",
                  color: "var(--dsw-alias-text-tertiary, #999)",
                  borderRadius: "999px", cursor: "pointer", fontSize: "11px", lineHeight: "16px", padding: "0 5px",
                },
              }, "📂")
            ))
          );
        }
      ));
    }

    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
