/**
 * /wb + /api 代理胶水的自动化测试（此前全靠手工 fake-ctx 验证）。
 * mock upstream = 真实 http server（fetch 走真网络）；fake res 为同步对象 + 延迟捕获
 * （Promise 作 res 会破坏 handler 的 writeHead 时序——历史教训）。
 */
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { createSuperRouteHandler, ROUTE_PREFIX } from './route.ts'
import type { SuperApi } from './super-api.ts'

describe('super route handler（/wb 复用通道 + /api 反代）', () => {
  let upstream: Server
  let upstreamBase = ''
  const seen: Array<{ method: string; path: string; body: string }> = []

  before(async () => {
    upstream = createServer((req, res) => {
      const chunks: Buffer[] = []
      req.on('data', (c: Buffer) => chunks.push(c))
      req.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8')
        seen.push({ method: req.method ?? '', path: req.url ?? '', body })
        const url = req.url ?? ''
        if (url.startsWith('/api/')) {
          res.writeHead(200, { 'content-type': 'application/json' })
          res.end(JSON.stringify({ ok: true, path: url, body }))
          return
        }
        if (url === '/groups' || url.startsWith('/groups?')) {
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
          res.end(
            '<!doctype html><html><head><link rel="stylesheet" href="/style.css">'
            + '<script src="/app.js"></script></head>'
            + '<body><a href="/groups">x</a><a href="https://example.com">ext</a></body></html>',
          )
          return
        }
        res.writeHead(200, { 'content-type': 'text/css' })
        res.end('body{color:red}')
      })
    })
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
    upstreamBase = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
  })
  after(() => new Promise<void>((r) => upstream.close(() => r())))

  const api = { resolveBase: async () => upstreamBase } as unknown as SuperApi
  const handler = createSuperRouteHandler(api)

  function fakeRes(): { res: any; captured: { status?: number; headers?: any; body?: string } } {
    const captured: { status?: number; headers?: any; body?: string } = {}
    const res: any = {
      writeHead(status: number, headers?: any) {
        captured.status = status
        captured.headers = headers
        return res
      },
      end(body?: any) {
        captured.body = typeof body === 'string' ? body : (body?.toString('utf8') ?? '')
        return res
      },
    }
    return { res, captured }
  }

  function fakeReq(url: string, method = 'GET', body?: string): any {
    const chunks = body ? [Buffer.from(body)] : []
    return {
      url,
      method,
      async *[Symbol.asyncIterator]() {
        for (const c of chunks) yield c
      },
    }
  }

  test('health → 200 + 当前上游', async () => {
    const { res, captured } = fakeRes()
    await handler(fakeReq(`${ROUTE_PREFIX}/health`), res)
    assert.equal(captured.status, 200)
    const j = JSON.parse(captured.body!)
    assert.equal(j.ok, true)
    assert.equal(j.upstream, upstreamBase)
  })

  test('/wb HTML：注入 fetch shim + 根相对资源改写到代理（外链不动）', async () => {
    const { res, captured } = fakeRes()
    await handler(fakeReq(`${ROUTE_PREFIX}/wb/groups`), res)
    assert.equal(captured.status, 200)
    assert.ok(captured.body!.includes(`href="${ROUTE_PREFIX}/wb/style.css"`))
    assert.ok(captured.body!.includes(`src="${ROUTE_PREFIX}/wb/app.js"`))
    assert.ok(captured.body!.includes(`href="${ROUTE_PREFIX}/wb/groups"`)) // 根相对锚点同样改写（站内导航走代理）
    assert.match(captured.body!, /https:\/\/example\.com/) // 外链不改写
  })

  test('/wb 深链 query 透传到上游（P1-5：/groups?id=7 可用）', async () => {
    const { res, captured } = fakeRes()
    await handler(fakeReq(`${ROUTE_PREFIX}/wb/groups?id=7`), res)
    assert.equal(captured.status, 200)
    assert.equal(seen.at(-1)!.path, '/groups?id=7')
  })

  test('/wb 非 HTML：字节透传 + content-type 保留', async () => {
    const { res, captured } = fakeRes()
    await handler(fakeReq(`${ROUTE_PREFIX}/wb/style.css`), res)
    assert.equal(captured.status, 200)
    assert.equal(captured.body!, 'body{color:red}')
    assert.match(String(captured.headers?.['content-type']), /text\/css/)
  })

  test('/api GET 透传（query 保留）', async () => {
    const { res, captured } = fakeRes()
    await handler(fakeReq(`${ROUTE_PREFIX}/api/groups?after=5`), res)
    assert.equal(captured.status, 200)
    assert.equal(seen.at(-1)!.path, '/api/groups?after=5')
    assert.equal(JSON.parse(captured.body!).ok, true)
  })

  test('/api POST 透传方法与 body', async () => {
    const { res, captured } = fakeRes()
    await handler(fakeReq(`${ROUTE_PREFIX}/api/groups/g1/messages`, 'POST', '{"text":"hi"}'), res)
    assert.equal(captured.status, 200)
    assert.equal(seen.at(-1)!.method, 'POST')
    assert.equal(seen.at(-1)!.path, '/api/groups/g1/messages')
    assert.equal(seen.at(-1)!.body, '{"text":"hi"}')
  })

  test('上游不可达 → 502 JSON（不炸宿主）', async () => {
    const bad = createSuperRouteHandler({
      resolveBase: async () => 'http://127.0.0.1:1',
    } as unknown as SuperApi)
    const { res, captured } = fakeRes()
    await bad(fakeReq(`${ROUTE_PREFIX}/api/groups`), res)
    assert.equal(captured.status, 502)
    assert.ok('error' in JSON.parse(captured.body!))
  })

  test('未知路径 → 404 JSON', async () => {
    const { res, captured } = fakeRes()
    await handler(fakeReq(`${ROUTE_PREFIX}/nope`), res)
    assert.equal(captured.status, 404)
    assert.ok('error' in JSON.parse(captured.body!))
  })

  test('/setup/status → 引擎状态（bundled/childAlive/lastError）', async () => {
    const { res, captured } = fakeRes()
    await handler(fakeReq(`${ROUTE_PREFIX}/setup/status`), res)
    assert.equal(captured.status, 200)
    const j = JSON.parse(captured.body!)
    assert.equal(j.ok, true)
    assert.equal(j.upstream, upstreamBase)
    assert.ok('bundled' in j.engine)
    assert.ok('childAlive' in j.engine)
  })

  test('/shell 容器页：HTML + 双内层 iframe + postMessage tab 通道 + 主题跟随', async () => {
    const { res, captured } = fakeRes()
    await handler(fakeReq(`${ROUTE_PREFIX}/shell`), res)
    assert.equal(captured.status, 200)
    assert.match(String(captured.headers?.['content-type']), /text\/html/)
    assert.ok(captured.body!.includes(`base + '/wb/groups'`)) // 内层群聊 iframe
    assert.ok(captured.body!.includes(`base + '/wb/'`)) // 内层讨论 iframe
    assert.ok(captured.body!.includes(`'agent-chat-tab'`)) // 导航服务 postMessage 通道
    assert.ok(captured.body!.includes(`data-page="groups"`))
    assert.ok(captured.body!.includes(`data-page="disc"`))
    // 主题跟随：读内页共用的 wb-theme + storage 事件同步 + 复用 workbench style.css 令牌
    assert.ok(captured.body!.includes(`localStorage.getItem('wb-theme')`))
    assert.ok(captured.body!.includes(`/wb/style.css`))
    assert.ok(captured.body!.includes(`dataset.theme = e.newValue`))
  })
})
