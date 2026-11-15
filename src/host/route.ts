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
import { downloadState, engineStatus, PLUGIN_VERSION, portfileEngineVersion, probeWorkbench } from './engine.ts'
import { nativePickDirectory } from './native-pick.ts'

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
<link id="wb-tokens" rel="stylesheet">
<script>
/* 令牌样式表：workbench 的 theme 变量（href 需要 base，head 内联推导） */
(function () {
  var b = location.pathname.replace(/\\/shell$/, '');
  var l = document.getElementById('wb-tokens');
  if (l) l.href = b + '/wb/style.css';
})();
</script>
<style>
  /* 主题跟随 v3（v0.2.15）：同源直读内层 iframe 的 DOM——内层页在 head 里同步设定
     data-theme（首帧绘制前），shell 每 500ms 直读该属性套用同一套 workbench 令牌。
     不经存储/事件/宿主中转（三轮运行时同步在 DSH webview 里的教训），纯同源 DOM
     读取是 web 平台保底能力。内层未就绪时保持深色底（与引导层一致）。 */
  html, body { height: 100%; margin: 0; padding: 0; }
  body {
    position: relative;
    display: flex; flex-direction: column;
    background: #10151b; color: #d6d9dd;
    font-family: -apple-system, "Segoe UI", "Microsoft YaHei", sans-serif;
  }
  html[data-theme="paper"] body { background: var(--bg); color: var(--text); }
  html[data-theme="signal"] body { background: var(--bg); color: var(--text); }
  .frames { flex: 1; display: flex; min-height: 0; }
  .frames iframe { flex: 1; width: 100%; border: none; display: none; background: #10151b; }
  /* 引擎初始化引导层：自成一体深色（不依赖 workbench 令牌），覆盖全页 */
  #setup {
    position: absolute; inset: 0; z-index: 9;
    display: flex; align-items: center; justify-content: center;
    background: #10151b;
  }
  #setup[hidden] { display: none; }
  .setup-card { width: min(420px, 84%); text-align: center; }
  .setup-title { font-size: 15px; font-weight: 700; margin-bottom: 14px; color: #e8ebee; }
  .bar {
    height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.14);
    overflow: hidden; margin: 0 6px;
  }
  .bar-fill {
    height: 100%; width: 0%; border-radius: 999px;
    background: #4d8fd6; transition: width .35s ease;
  }
  .bar-fill.indet { width: 38%; animation: setup-slide 1.1s ease-in-out infinite alternate; }
  @keyframes setup-slide { from { margin-left: 0; } to { margin-left: 62%; } }
  @media (prefers-reduced-motion: reduce) {
    .bar-fill.indet { animation: none; width: 100%; opacity: .5; }
  }
  .setup-status { margin-top: 12px; font-size: 12.5px; color: #9aa5af; }
  .setup-err {
    margin-top: 12px; padding: 8px 12px; border-radius: 8px; text-align: left;
    font-size: 12.5px; color: #ff8a7a; background: rgba(255, 90, 70, 0.12);
    word-break: break-all;
  }
  /* 版本徽标：仅在不健康（引擎版本不匹配/引擎未运行）时出现，右下角不扰民 */
  .ver-badge {
    position: absolute; right: 10px; bottom: 8px; z-index: 5;
    font-size: 10.5px; color: rgba(214, 217, 221, 0.45); pointer-events: none;
    font-family: Consolas, "Cascadia Mono", monospace; white-space: nowrap;
    display: none;
  }
  .ver-badge.show { display: block; }
  .ver-badge.mismatch { color: #ffb547; opacity: 1; }
  /* 引擎初始化引导层：自成一体深色（不依赖 workbench 令牌），覆盖全页（含 tab） */
  #setup {
    position: absolute; inset: 0; z-index: 9;
    display: flex; align-items: center; justify-content: center;
    background: #10151b;
  }
  #setup[hidden] { display: none; }
  .setup-card { width: min(420px, 84%); text-align: center; }
  .setup-title { font-size: 15px; font-weight: 700; margin-bottom: 14px; color: #e8ebee; }
  .bar {
    height: 8px; border-radius: 999px; background: rgba(255, 255, 255, 0.14);
    overflow: hidden; margin: 0 6px;
  }
  .bar-fill {
    height: 100%; width: 0%; border-radius: 999px;
    background: #4d8fd6; transition: width .35s ease;
  }
  .bar-fill.indet { width: 38%; animation: setup-slide 1.1s ease-in-out infinite alternate; }
  @keyframes setup-slide { from { margin-left: 0; } to { margin-left: 62%; } }
  @media (prefers-reduced-motion: reduce) {
    .bar-fill.indet { animation: none; width: 100%; opacity: .5; }
  }
  .setup-status { margin-top: 12px; font-size: 12.5px; color: #9aa5af; }
  .setup-err {
    margin-top: 12px; padding: 8px 12px; border-radius: 8px; text-align: left;
    font-size: 12.5px; color: #ff8a7a; background: rgba(255, 90, 70, 0.12);
    word-break: break-all;
  }
</style>
</head>
<body>
<div id="setup" hidden>
  <div class="setup-card">
    <div class="setup-title">正在准备本地引擎</div>
    <div class="bar"><div class="bar-fill indet" id="setup-bar"></div></div>
    <div class="setup-status" id="setup-status">连接中…</div>
    <div class="setup-err" id="setup-err" hidden></div>
  </div>
</div>
<div class="frames">
  <iframe data-page="groups" title="Super 群聊"></iframe>
  <iframe data-page="disc" title="Super 讨论"></iframe>
</div>
<span id="ver-badge" class="ver-badge" title="插件版本 · 存活引擎版本（不匹配 = 修复未生效；仅异常时显示）"></span>
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
    frames[0].style.display = t === 'groups' ? 'flex' : 'none';
    frames[1].style.display = t === 'disc' ? 'flex' : 'none';
    try { sessionStorage.setItem(KEY, t); localStorage.setItem(KEY, t); } catch (e) {}
  }
  window.addEventListener('message', function (ev) {
    if (ev.origin !== location.origin) return;
    var d = ev.data || {};
    if (d.type === 'agent-chat-tab' && (d.tab === 'groups' || d.tab === 'disc')) apply(d.tab);
    if (d.type === 'agent-chat-theme' && (d.theme === 'paper' || d.theme === 'signal')) {
      document.documentElement.dataset.theme = d.theme;
    }
  });
  apply(tab === 'disc' ? 'disc' : 'groups');
  /* 主题跟随：同源直读「当前可见」内层 iframe 的 data-theme（500ms）。
     只读可见页——DSH 里两个内页存储分区各自为政（主题可能不同步），
     跟随可见页 = tab 条永远与用户眼前的一致；切 tab 即切跟随对象。 */
  setInterval(function () {
    var f = frames[tab === 'disc' ? 1 : 0];
    try {
      var t = f.contentDocument && f.contentDocument.documentElement.dataset.theme;
      if (t === 'paper' || t === 'signal') document.documentElement.dataset.theme = t;
    } catch (e) { /* 未就绪：下一轮再试 */ }
  }, 500);
  /* 版本徽标：健康（版本匹配且引擎存活）时完全隐藏，异常才现身 */
  function updateVerBadge(j) {
    var el = document.getElementById('ver-badge');
    if (!el) return;
    var pv = j && j.pluginVersion, ev = j && j.engineVersion;
    var mismatch = !!(pv && ev && pv !== ev);
    var down = !j || !j.live;
    if (!mismatch && !down) { el.className = 'ver-badge'; el.style.display = 'none'; return; }
    el.style.display = 'block';
    el.className = 'ver-badge' + (mismatch ? ' mismatch' : '');
    el.textContent = (mismatch ? '版本不匹配 · ' : '') + (down ? '引擎未运行 · ' : '') +
      '插件 v' + (pv || '?') + ' 引擎 v' + (ev || '?') +
      (j && j.download && j.download.phase === 'downloading' ? ' · 新引擎下载中 ' +
        Math.round(((j.download.received || 0) / (j.download.total || 1)) * 100) + '%' : '');
  }
  /* 引导层渲染（boot 轮询与常驻监视共用）：引擎死 → 重现引导卡；恢复 → 重载内页 */
  var shellSawDown = false;
  function renderSetup(j) {
    updateVerBadge(j);
    var overlay = document.getElementById('setup');
    if (!overlay) return;
    if (j && j.live) {
      if (shellSawDown) {
        overlay.hidden = true;
        // 引擎是后起来的：内层页打开时 /wb 还不通，重载拿到真界面
        frames[0].src = frames[0].src;
        frames[1].src = frames[1].src;
        shellSawDown = false;
      }
      return;
    }
    shellSawDown = true;
    overlay.hidden = false;
    var bar = document.getElementById('setup-bar');
    var status = document.getElementById('setup-status');
    var err = document.getElementById('setup-err');
    var d = (j && j.download) || {};
    err.hidden = true;
    bar.classList.remove('indet');
    if (d.phase === 'downloading') {
      var pct = d.total ? Math.round((d.received / d.total) * 100) : 0;
      bar.style.width = (d.total ? pct : 38) + '%';
      if (!d.total) bar.classList.add('indet');
      status.textContent = '正在下载引擎 ' + pct + '%（' +
        (d.received / 1048576).toFixed(2) + ' / ' + (d.total ? (d.total / 1048576).toFixed(2) : '?') + ' MB）';
    } else if (d.phase === 'verifying') {
      bar.style.width = '100%';
      status.textContent = '下载完成，正在校验完整性…';
    } else if (d.phase === 'done') {
      bar.style.width = '100%';
      status.textContent = '引擎就绪，正在启动…';
    } else if (j && j.engine && j.engine.lastError) {
      bar.classList.add('indet');
      status.textContent = '引擎未能自动启动';
      err.textContent = j.engine.lastError + '——可尝试安装桌面版（含引擎）后重开面板，或在已装 Super Agent CLI 的机器上先启动 workbench 再重开本面板。';
      err.hidden = false;
    } else {
      bar.classList.add('indet');
      status.textContent = '正在启动本地引擎…';
    }
  }
  /* 常驻监视（5s）：boot 轮询结束后接管——引擎中途死亡时引导层重现（不再裸奔
     fetch failed），恢复后自动重载内页；版本徽标同步刷新 */
  var bootPollDone = false;
  setInterval(function () {
    fetch(base + '/setup/status').then(function (r) { return r.json(); }).then(function (j) {
      if (bootPollDone) renderSetup(j);
      else updateVerBadge(j);
    }).catch(function () {
      shellSawDown = true;
      if (bootPollDone) renderSetup(null);
      updateVerBadge(null);
      var el = document.getElementById('ver-badge');
      if (el) el.textContent = '插件 v? · 引擎未运行';
    });
  }, 5000);
  /* boot 轮询（800ms × 600）：首屏快速跟进下载进度；结束（就绪/超时/失败）后交棒监视器 */
  (function pollSetup(tries) {
    fetch(base + '/setup/status').then(function (r) { return r.json(); }).then(function (j) {
      renderSetup(j);
      if (j.live || tries >= 600) { bootPollDone = true; return; }
      setTimeout(function () { pollSetup(tries + 1); }, 800);
    }).catch(function () {
      if (tries >= 600) { bootPollDone = true; return; }
      setTimeout(function () { pollSetup(tries + 1); }, 800);
    });
  })(0);
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
      // /setup/status —— 引擎初始化状态（shell 引导横幅/下载进度/调试用）
      if (url === `${ROUTE_PREFIX}/setup/status`) {
        const base = await api.resolveBase()
        send(200, {
          ok: true,
          upstream: base,
          live: await probeWorkbench(base),
          engine: engineStatus(),
          download: downloadState,
          // 版本可见化：插件期望版本 vs 存活引擎版本——"修复没生效"这类困惑一眼看穿
          pluginVersion: PLUGIN_VERSION,
          engineVersion: portfileEngineVersion(),
        })
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
            `if(typeof u==='string'&&u.charAt(0)==='/'&&u.indexOf(window.__SUPER_PROXY__)!==0)u=window.__SUPER_PROXY__+u;` +
            `return of.call(window,u,o)}})();` +
            /* 内页互跳链接（← 讨论工作台 / 群聊室 →）在嵌入态转为 shell tab 切换：
               点击拦截 + postMessage（保活容器换显 iframe，不导航、状态全保留）。
               独立运行（无父窗/非代理路径）时照常导航，桌面版/CLI 不受影响。 */
            `(function(){` +
            `var pre=window.__SUPER_PROXY__+'/wb/';` +
            `document.addEventListener('click',function(e){` +
            `var a=e.target&&e.target.closest?e.target.closest('a[href]'):null;` +
            `if(!a||window.parent===window)return;` +
            `var h=a.getAttribute('href')||'';` +
            `if(h.indexOf(pre)!==0)return;` +
            `var rest=h.slice(pre.length).split('?')[0];` +
            `var tab=rest==='groups'?'groups':rest===''?'disc':null;` +
            `if(!tab)return;` +
            `e.preventDefault();` +
            `try{window.parent.postMessage({type:'agent-chat-tab',tab:tab},location.origin)}catch(err){}` +
            `},true);})();</script>`
          html = /<head[^>]*>/i.test(html)
            ? html.replace(/<head[^>]*>/i, (m) => m + shim)
            : shim + html
          // 根相对资源（/app.js、/style.css、/groups…）改写到代理前缀 + 追加版本参数
          // （升级后 URL 变化强制破缓存——上游 no-store 曾被本代理非 HTML 分支丢弃，
          //  webview 启发式缓存把旧 JS 钉死，版本更新后界面不变）
          html = html.replace(
            /(href|src)="\/(?!\/)([^"]*)"/g,
            (_m, attr, path) =>
              `${attr}="${ROUTE_PREFIX}/wb/${path}${path.includes("?") ? "&" : "?"}v=${PLUGIN_VERSION}"`,
          )
          res.writeHead(upstream.status, { 'content-type': ctype, 'cache-control': 'no-store' })
          res.end(html)
          return
        }
        const buf = Buffer.from(await upstream.arrayBuffer())
        res.writeHead(upstream.status, { 'content-type': ctype, 'cache-control': 'no-store' })
        res.end(buf)
        return
      }
      if (url === API_PREFIX || url.startsWith(`${API_PREFIX}/`)) {
        // 原生目录选择：捆绑引擎（无 GUI）弹不了系统对话框 → 由插件宿主代弹
        // （DSH Electron 主进程的 dialog）。非 DSH 形态返回 path:null，页面回退网页选择器。
        if (req.method === 'POST' && url === `${API_PREFIX}/fs/native-pick`) {
          const chunks: Buffer[] = []
          for await (const chunk of req) chunks.push(chunk as Buffer)
          let startDir: string | undefined
          try {
            const body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}') as { cwd?: string }
            if (typeof body.cwd === 'string' && body.cwd.trim()) startDir = body.cwd
          } catch {
            /* 无 body */
          }
          const picked = await nativePickDirectory(startDir)
          send(200, { path: picked })
          return
        }
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
