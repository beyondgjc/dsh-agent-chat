/**
 * 在 DSH 共享 webServer 上注册 /dsh-agent-chat-598 前缀路由（后缀是用户的个人命名空间标记，
 * 与 ~/.dsh 里 whale598 / persona-presets-598 同一约定）：
 *   /dsh-agent-chat-598/health        → { ok, upstream }（健康检查 + 当前上游）
 *   /dsh-agent-chat-598/api/groups…   → 反向代理到 workbench /api/…（客户端半侧同源访问，无 CORS）
 * 客户端半侧（web 页面）只发同源相对路径请求，由宿主 fetch 上游。
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { SuperApi } from './super-api.ts'

const ROUTE_PREFIX = '/dsh-agent-chat-598'
const API_PREFIX = `${ROUTE_PREFIX}/api`

export function registerSuperRoute(ctx: any, api: SuperApi): void {
  ctx.effect(
    () =>
      ctx.webServer.register({
        kind: 'prefix',
        path: ROUTE_PREFIX,
        handler: async (req: IncomingMessage, res: ServerResponse) => {
          const rawUrl = req.url ?? '/'
          const url = rawUrl.split('?')[0] ?? '/'
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
            // /dsh-agent-chat/wb/* —— 整个 workbench UI 的复用通道：
            // HTML 注入 fetch shim（页面里的 /api/... 请求改写到本代理）并改写根相对资源；
            // 非文本资源字节透传。这样 workbench 的全部功能（讨论+群聊）原样出现在插件页里。
            if (url === `${ROUTE_PREFIX}/wb` || url === `${ROUTE_PREFIX}/wb/` || url.startsWith(`${ROUTE_PREFIX}/wb/`)) {
              const upstreamPath = url.slice((`${ROUTE_PREFIX}/wb`).length) || '/'
              const base = await api.resolveBase()
              const upstream = await fetch(`${base}${upstreamPath === '/' ? '/' : upstreamPath}`)
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
              const query = rawUrl.includes('?') ? `?${rawUrl.split('?')[1] ?? ''}` : ''
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
        },
      }),
    'dsh-agent-chat: /dsh-agent-chat route',
  )
}
