/**
 * 捆绑引擎集成测试：spawn lib/engine.js（动态端口 + 临时数据目录）→
 * portfile 握手 → /api/groups 200 → 回收子进程。
 * 需要先 npm run build（lib/engine.js 存在）；缺失时跳过（CI 无私有仓库的形态）。
 */
import { describe, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { engineBundlePath, engineStatus, killEngine, spawnBundledEngine } from './engine.ts'

describe('bundled engine（梯度 0 捆绑引擎）', () => {
  test('spawn → portfile 握手 → API 200 → 回收', { timeout: 30_000 }, async () => {
    const bundle = engineBundlePath()
    if (!bundle) {
      console.warn('lib/engine.js 不存在（未跑 build-engine）——跳过')
      return
    }
    const dataDir = mkdtempSync(join(tmpdir(), 'dsh-agent-chat-engine-'))
    process.env.SUPER_AGENT_DATA_DIR = dataDir
    const r = spawnBundledEngine()
    assert.equal(r.started, true, r.error ?? 'spawn 失败')
    try {
      // 引擎写 portfile（动态端口）→ 轮询直到 API 200（引擎自身有单实例防护与 EADDRINUSE 明确报错）
      let ok = false
      for (let i = 0; i < 60 && !ok; i++) {
        await new Promise((res) => setTimeout(res, 333))
        const pf = join(dataDir, 'workbench.port')
        if (!existsSync(pf)) continue
        try {
          const j = JSON.parse(readFileSync(pf, 'utf8')) as { port?: number }
          if (typeof j.port !== 'number') continue
          const resp = await fetch(`http://127.0.0.1:${j.port}/api/groups`)
          ok = resp.ok
        } catch {
          /* 未就绪，继续轮询 */
        }
      }
      assert.equal(ok, true, '引擎 20s 内未就绪')
      assert.equal(engineStatus().childAlive, true)
    } finally {
      killEngine()
    }
  })
})
