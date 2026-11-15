/**
 * 下载层集成测试：本地 http server 伪造成 Releases（manifest + zip）→
 * downloadEngineArtifact 下载 → SHA256 校验 → 解压落盘。
 * 另覆盖：SHA 不匹配 → 抛错（防篡改）。
 */
import { describe, test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { artifactCacheDir, downloadEngineArtifact } from './engine.ts'

describe('engine artifact download（首启下载分发）', () => {
  let upstream: Server
  let bad: Server
  let base = ''
  let badBase = ''
  let engineBody = 'console.log("engine")'

  before(async () => {
    const zip = new AdmZip()
    zip.addFile('engine.js', Buffer.from(engineBody))
    zip.addFile('mock-agent.mjs', Buffer.from('console.log("mock")'))
    zip.addFile('public/app.js', Buffer.from('console.log("ui")'))
    const zipBuf = zip.toBuffer()
    const sha = createHash('sha256').update(zipBuf).digest('hex')
    const serve = (good: boolean) => (req: unknown, res: any) => {
      const url = (req as { url?: string }).url ?? ''
      if (url.endsWith('engine-manifest.json')) {
        res.writeHead(200, { 'content-type': 'application/json' })
        res.end(JSON.stringify({ version: '0.2.0', sha256: good ? sha : 'deadbeef', size: zipBuf.length }))
        return
      }
      if (url.endsWith('engine-artifact.zip')) {
        res.writeHead(200, { 'content-type': 'application/zip' })
        res.end(zipBuf)
        return
      }
      res.writeHead(404)
      res.end()
    }
    upstream = createServer(serve(true))
    await new Promise<void>((r) => upstream.listen(0, '127.0.0.1', r))
    base = `http://127.0.0.1:${(upstream.address() as { port: number }).port}`
    bad = createServer(serve(false))
    await new Promise<void>((r) => bad.listen(0, '127.0.0.1', r))
    badBase = `http://127.0.0.1:${(bad.address() as { port: number }).port}`
  })
  after(async () => {
    // 两台都要关：漏关任何一台都会挂住 node --test 进程（教训）
    await new Promise<void>((r) => upstream.close(() => r()))
    await new Promise<void>((r) => bad.close(() => r()))
  })

  test('下载 → SHA256 校验 → 解压落盘（engine/mock/public）', async () => {
    // 隔离缓存目录：走 env 覆盖（downloadEngineArtifact 读 ARTIFACT_CACHE_ROOT 的时机在此后）
    process.env.DSH_AGENT_CHAT_CACHE = mkdtempSync(join(tmpdir(), 'dsh-agent-chat-artifact-'))
    await downloadEngineArtifact(base)
    const cache = artifactCacheDir()
    assert.equal(readFileSync(join(cache, 'engine.js'), 'utf8'), engineBody)
    assert.equal(existsSync(join(cache, 'public', 'app.js')), true)
    assert.equal(existsSync(join(cache, 'mock-agent.mjs')), true)
  })

  test('SHA 不匹配 → 抛错（防篡改）', async () => {
    process.env.DSH_AGENT_CHAT_CACHE = mkdtempSync(join(tmpdir(), 'dsh-agent-chat-artifact-bad-'))
    await assert.rejects(() => downloadEngineArtifact(badBase), /SHA256/)
  })
})
