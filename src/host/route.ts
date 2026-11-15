/**
 * 在 DSH 共享 webServer 上注册 /dsh-agent-chat-598 前缀路由（后缀 598 是用户的个人命名空间
 * 标记，与 ~/.dsh 里 whale598 / persona-presets-598 同一约定）：
 *   /dsh-agent-chat-598/health        → { ok, upstream }（健康检查 + 当前上游）
 *   /dsh-agent-chat-598/wb/*          → workbench UI 整体复用通道：HTML 注入 fetch shim
 *                                       （页面里的 /api/... 请求改写到本代理）+ 根相对资源改写；
 *                                       非 HTML 字节透传。query 全程透传（/groups?id= 深链可用）
 *   /dsh-agent-chat-598/api/*         → 反向代理到 workbench /api/…（客户端半侧同源访问，无 CORS）
 * handler 抽为 createSuperRouteHandler，route.test.ts 对 7 条路径做自动化覆盖。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SuperApi } from './super-api.ts'
import { engineStatus } from './engine.ts'

export const ROUTE_PREFIX = '/dsh-agent-chat-598'
const API_PREFIX = `${ROUTE_PREFIX}/api`
const WB_PREFIX = `${ROUTE_PREFIX}/wb`

/**
 * /shell 容器页（插件自持）：tab 栏 + 两个常驻内层 iframe（经 /wb 代理的群聊|讨论页）。
 * 插件客户端只嵌这一个 iframe；内层 src 由 location.pathname 推导代理前缀。
 * tab 态记 localStorage（跨 DSH 重启）+ sessionStorage（兼容旧客户端的记忆键）；
 * agentChatNavigation 服务经 postMessage 驱动切 tab（同源校验）。
 */
export const SHELL_HTML = `<!doctype html>
<html lang="zh-CN">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Agent Chat</title>
<script>
/* 主题跟随：与内层 workbench 页共用 wb-theme（shell 是独立文档，不继承 DSH/内页颜色）；
   内页切主题时经 storage 事件同步；加载 workbench 自己的 style.css 复用同一套令牌 */
(function () {
  try { document.documentElement.dataset.theme = localStorage.getItem('wb-theme') || 'paper'; } catch (e) {}
  var base = location.pathname.replace(/\\/shell$/, '');
  var link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = base + '/wb/style.css';
  document.head.appendChild(link);
  window.addEventListener('storage', function (e) {
    if (e.key === 'wb-theme' && e.newValue) document.documentElement.dataset.theme = e.newValue;
  });
})();
</script>
<style>
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    display: flex; flex-direction: column;
    background: var(--bg); color: var(--text); font-family: var(--font-ui);
  }
  .tabs { display: flex; gap: 6px; padding: 8px 10px; border-bottom: 1px solid var(--line); }
  .tabs button {
    font-size: 13px; padding: 4px 16px; border-radius: 6px;
    border: 1px solid var(--line); background: transparent;
    color: var(--text); cursor: pointer;
  }
  .tabs button[aria-pressed="true"] { font-weight: 700; background: var(--sel-soft); color: var(--sel); }
  .frames { flex: 1; display: flex; min-height: 0; }
  .frames iframe { flex: 1; width: 100%; border: none; display: none; background: var(--bg); }
  .setup-hint { padding: 8px 12px; font-size: 12.5px; color: var(--bad); background: var(--bad-soft); }
</style>
</head>
<body>
<div id="setup-hint" class="setup-hint" hidden></div>
<div class="tabs">
  <button type="button" data-tab="groups" aria-pressed="true">群聊</button>
  <button type="button" data-tab="disc" aria-pressed="false">讨论</button>
</div>
<div class="frames">
  <iframe data-page="groups" title="Super 群聊"></iframe>
  <iframe data-page="disc" title="Super 讨论"></iframe>
</div>
<script>
(function () {
  var base = location.pathname.replace(/\\/shell$/, '');
  var frames = document.querySelectorAll('.frames iframe');
  frames[0].src = base + '/wb/groups';
  frames[1].src = base + '/wb/';
  var KEY = 'agentChatTab';
  var tab = 'groups';
  try { tab = localStorage.getItem(KEY) || sessionStorage.getItem(KEY) || 'groups'; } catch (e) {}
  function apply(t) {
    tab = t;
    document.querySelectorAll('.tabs button').forEach(function (b) {
      b.setAttribute('aria-pressed', String(b.dataset.tab === t));
    });
    frames[0].style.display = t === 'groups' ? 'flex' : 'none';
    frames[1].style.display = t === 'disc' ? 'flex' : 'none';
    try { sessionStorage.setItem(KEY, t); localStorage.setItem(KEY, t); } catch (e) {}
  }
  document.querySelector('.tabs').addEventListener('click', function (e) {
    var b = e.target && e.target.closest ? e.target.closest('button[data-tab]') : null;
    if (b) apply(b.dataset.tab);
  });
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin) return;
    var d = ev.data || {};
    if (d.type === 'agent-chat-tab' && (d.tab === 'groups' || d.tab === 'disc')) apply(d.tab);
  });
  apply(tab === 'disc' ? 'disc' : 'groups');
  /* 引擎初始化失败时给出引导（成功/外部实例模式不显示） */
  fetch(base + '/setup/status').then(function (r) { return r.json(); }).then(function (j) {
    var err = j && j.engine && j.engine.lastError;
    if (!err) return;
    var el = document.getElementById('setup-hint');
    if (!el) return;
    el.textContent = '本地引擎未能自动启动：' + err;
    el.hidden = false;
  }).catch(function () {});
})();
</script>
</body>
</html>`

export function createSuperRouteHandler(api: SuperApi) {
  return async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const rawUrl = req.url ?? '/'
    const qIdx = rawUrl.indexOf('?')
    const url = (qIdx === -1 ? rawUrl : rawUrl.slice(0, qIdx)) || '/'
    // query 原样透传给上游（含 ? 本体）：/wb 深链与 /api 分页参数都依赖它
    const query = qIdx === -1 ? '' : rawUrl.slice(qIdx)
    const send = (status: number, body: unknown): void => {
      res.writeHead(status, {
        'content-type': 'application/json; charset=utf-8',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify(body))
    }
    try {
      if (url === `${ROUTE_PREFIX}/health`) {
        send(200, { ok: true, upstream: await api.resolveBase() })
        return
      }
      // /setup/status —— 引擎初始化状态（shell 引导横幅/调试用）
      if (url === `${ROUTE_PREFIX}/setup/status`) {
        send(200, { ok: true, upstream: await api.resolveBase(), engine: engineStatus() })
        return
      }
      // /shell —— 插件自持的 tab 容器页（客户端唯一 iframe 指向这里）
      if (url === `${ROUTE_PREFIX}/shell`) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' })
        res.end(SHELL_HTML)
        return
      }
      // /wb/* —— 整个 workbench UI 的复用通道（详见文件头注释）
      if (url === WB_PREFIX || url === `${WB_PREFIX}/` || url.startsWith(`${WB_PREFIX}/`)) {
        const upstreamPath = (url.slice(WB_PREFIX.length) || '/') + query
        const base = await api.resolveBase()
        const upstream = await fetch(`${base}${upstreamPath}`)
        const ctype = upstream.headers.get('content-type') ?? 'text/html; charset=utf-8'
        if (ctype.includes('text/html')) {
          let html = await upstream.text()
          const shim =
            `<script>window.__SUPER_PROXY__='${ROUTE_PREFIX}';` +
            `(function(){var of=window.fetch;window.fetch=function(u,o){` +
            `if(typeof u==='string'&&u.charAt(0)==='/')u=window.__SUPER_PROXY__+u;` +
            `return of.call(window,u,o)}})();</script>`
          html = /<head[^>]*>/i.test(html)
            ? html.replace(/<head[^>]*>/i, (m) => m + shim)
            : shim + html
          // 根相对资源（/app.js、/style.css、/groups…）改写到代理前缀；忽略协议相对与外链
          html = html.replace(/(href|src)="\/(?!\/)/g, `$1="${ROUTE_PREFIX}/wb/`)
          res.writeHead(upstream.status, { 'content-type': ctype, 'cache-control': 'no-store' })
          res.end(html)
          return
        }
        const buf = Buffer.from(await upstream.arrayBuffer())
        res.writeHead(upstream.status, { 'content-type': ctype })
        res.end(buf)
        return
      }
      if (url === API_PREFIX || url.startsWith(`${API_PREFIX}/`)) {
        const upstreamPath = `/api${url.slice(API_PREFIX.length)}${query}`
        const base = await api.resolveBase()
        const chunks: Buffer[] = []
        for await (const chunk of req) chunks.push(chunk as Buffer)
        const body = chunks.length > 0 ? Buffer.concat(chunks) : undefined
        const upstream = await fetch(`${base}${upstreamPath}`, {
          method: req.method ?? 'GET',
          headers: { 'content-type': 'application/json' },
          ...(body ? { body } : {}),
        })
        const text = await upstream.text()
        res.writeHead(upstream.status, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
        })
        res.end(text)
        return
      }
      send(404, { error: 'not found' })
    } catch (err) {
      send(502, { error: String((err as Error)?.message ?? err) })
    }
  }
}

export function registerSuperRoute(ctx: any, api: SuperApi): void {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: createSuperRouteHandler(api),
      }),
    'dsh-agent-chat: /dsh-agent-chat-598 route',
  )
}
