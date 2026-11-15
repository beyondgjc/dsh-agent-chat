/**
 * apply 冒烟测试：stub ctx 下断言「1 条路由 + 5 个工具（零生命周期）+ skill 幂等同步」。
 * skill 根通过 apply 第三参注入临时目录，不碰真实 ~/.dsh。
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { apply } from './index.ts'
import { syncAgentChatSkill } from './skill.ts'

function makeStubCtx(): { ctx: any; tools: any[]; routes: any[]; labels: string[] } {
  const tools: any[] = []
  const routes: any[] = []
  const labels: string[] = []
  const ctx: any = {
    provided: {} as Record<string, unknown>,
    provide(name: string, value: unknown) {
      this.provided[name] = value
    },
    effect(fn: () => void, label: string) {
      labels.push(label)
      fn()
    },
    webServer: { register: (o: any) => routes.push(o) },
    tools: { register: (t: any) => tools.push(t) },
  }
  return { ctx, tools, routes, labels }
}

const EXPECTED_TOOLS = new Set([
  'super_groups_list',
  'super_group_post',
  'super_group_board',
  'super_disc_list',
  'super_disc_detail',
])

test('apply 冒烟：1 路由 + 5 工具（零生命周期）+ agentChatApi 服务', () => {
  const { ctx, tools, routes, labels } = makeStubCtx()
  const tmpHome = mkdtempSync(join(tmpdir(), 'dsh-agent-chat-test-'))
  // engineAuto:false——冒烟测试不拉真引擎
  apply(ctx, { upstream: 'http://127.0.0.1:59999', engineAuto: false }, tmpHome)

  assert.equal(routes.length, 1)
  assert.equal(routes[0].kind, 'prefix')
  assert.equal(routes[0].path, '/dsh-agent-chat-598')
  assert.equal(tools.length, 5)
  assert.deepEqual(
    new Set(tools.map((t) => t.name)),
    EXPECTED_TOOLS,
  )
  assert.ok(ctx.provided['agentChatApi'], 'agentChatApi 服务已提供')
  assert.equal(labels.length, 6) // 1 路由 + 5 工具（engineAuto:false 不注册引擎 effect）
})

test('skill 同步：写入指定根、内容含 frontmatter、二次调用幂等', () => {
  const tmpHome = mkdtempSync(join(tmpdir(), 'dsh-agent-chat-test-'))
  const first = syncAgentChatSkill(tmpHome)
  assert.equal(first.changed, true)
  const file = join(tmpHome, '.dsh', 'skills', 'agent-chat', 'SKILL.md')
  assert.ok(existsSync(file))
  const body = readFileSync(file, 'utf8')
  assert.ok(body.startsWith('---\nname: agent-chat\n'))
  assert.ok(body.includes('super_group_post'))
  assert.ok(body.includes('生命周期由人操作'))

  const second = syncAgentChatSkill(tmpHome)
  assert.equal(second.changed, false, '内容未变时不重写')
})
