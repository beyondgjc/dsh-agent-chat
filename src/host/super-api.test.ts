import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createSuperApi, resolveUpstream } from './super-api.ts'

const ENV_KEYS = ['SUPER_WORKBENCH_UPSTREAM', 'SUPER_AGENT_DATA_DIR'] as const

function withEnv(map: Record<string, string | undefined>, fn: () => Promise<void> | void): Promise<void> | void {
  const saved = new Map(ENV_KEYS.map((k) => [k, process.env[k]]))
  for (const [k, v] of Object.entries(map)) {
    if (v === undefined) delete process.env[k]
    else process.env[k] = v
  }
  try {
    const r = fn()
    if (r instanceof Promise) {
      return r.finally(() => {
        for (const [k, v] of saved) {
          if (v === undefined) delete process.env[k]
          else process.env[k] = v
        }
      })
    }
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
  } catch (err) {
    for (const [k, v] of saved) {
      if (v === undefined) delete process.env[k]
      else process.env[k] = v
    }
    throw err
  }
}

test('resolveUpstream：env 覆盖最优先', async () => {
  await withEnv({ SUPER_WORKBENCH_UPSTREAM: 'http://127.0.0.1:9999/' }, async () => {
    assert.equal(await resolveUpstream('http://ignored.example'), 'http://127.0.0.1:9999')
  })
})

test('resolveUpstream：portfile 次之（SUPER_AGENT_DATA_DIR 指向临时目录）', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-portfile-'))
  writeFileSync(join(dir, 'workbench.port'), '4567')
  await withEnv({ SUPER_WORKBENCH_UPSTREAM: undefined, SUPER_AGENT_DATA_DIR: dir }, async () => {
    assert.equal(await resolveUpstream('http://ignored.example'), 'http://127.0.0.1:4567')
  })
  rmSync(dir, { recursive: true, force: true })
})

test('resolveUpstream：无 env 无 portfile → 配置兜底；再无 → 默认 7980', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'super-portfile-empty-'))
  await withEnv({ SUPER_WORKBENCH_UPSTREAM: undefined, SUPER_AGENT_DATA_DIR: dir }, async () => {
    assert.equal(await resolveUpstream('http://127.0.0.1:7000'), 'http://127.0.0.1:7000')
    assert.equal(await resolveUpstream(undefined), 'http://127.0.0.1:7980')
  })
  rmSync(dir, { recursive: true, force: true })
})

test('listGroups / postMessage 走 mock upstream；错误透出 message', async () => {
  const seen: Array<{ method: string; path: string; body: unknown }> = []
  const srv: Server = createServer((req, res) => {
    let body = ''
    req.on('data', (c) => (body += c))
    req.on('end', () => {
      seen.push({ method: req.method ?? '', path: req.url ?? '', body: body ? JSON.parse(body) : null })
      if (req.url === '/api/groups') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ groups: [{ id: 'group_x', name: '演示群', activeMembers: 2, messageSeq: 3 }] }))
        return
      }
      if (req.url === '/api/groups/group_x/messages' && req.method === 'POST') {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ message: { seq: 4, author: { kind: 'user' }, text: 'hi', mentions: [] } }))
        return
      }
      res.writeHead(409, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ error: '群不存在' }))
    })
  })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r))
  const port = (srv.address() as { port: number }).port
  await withEnv({ SUPER_WORKBENCH_UPSTREAM: `http://127.0.0.1:${port}` }, async () => {
    const api = createSuperApi()
    const groups = await api.listGroups()
    assert.equal(groups[0]!.id, 'group_x')
    const posted = await api.postMessage('group_x', '你好')
    assert.equal(posted.message.seq, 4)
    assert.equal(seen[1]!.path, '/api/groups/group_x/messages')
    await assert.rejects(() => api.getBoard('group_missing'), /群不存在/)
  })
  await new Promise<void>((r) => srv.close(() => r()))
})
