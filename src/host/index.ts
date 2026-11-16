/**
 * dsh-agent-chat 宿主半侧（cordis bundle 插件）。
 *
 * 职责（Tier 1 薄插件）：
 * - agentChatApi 服务：Super Agent workbench（本机 HTTP）的薄客户端，供同宿主其他插件消费
 * - /dsh-agent-chat-598 前缀路由：客户端半侧（web 板面）同源访问 workbench 的代理
 * - 模型工具面（5 个 super_* 工具 + agent-chat skill）：默认**关闭**（config.tools 开启），
 *   先满足 UI 面板使用；工具面作为后续迭代项
 *
 * 上游发现：env SUPER_WORKBENCH_UPSTREAM → <dataDir>/workbench.port → config.upstream → 7980 默认。
 */
import { createSuperApi, type SuperApi } from './super-api.ts'
import { ensureEngine, killEngine, engineStatus } from './engine.ts'
import { registerSuperRoute } from './route.ts'
import { removeAgentChatSkill, syncAgentChatSkill } from './skill.ts'
import { registerSuperDiscTools, registerSuperTools } from './tools.ts'

export const name = 'dsh-agent-chat'
export const inject = ['webServer', 'tools']

export interface Config {
  /** workbench 上游基址；留空走 portfile 发现 / 默认 7980 */
  upstream?: string
  /** 捆绑引擎自动拉起开关（默认开）：无存活实例时 spawn lib/engine.js */
  engineAuto?: boolean
  /** 模型工具面（5 个 super_* 工具 + agent-chat skill 同步）：默认**关**。
   *  用户定案 2026-11-17：先满足 UI 面板使用，工具面后续迭代；开启时注册工具并同步 skill，
   *  关闭时回收历史同步的 skill 目录（stale 内容会把模型指向不存在的工具）。 */
  tools?: boolean
}

export function apply(ctx: any, config: Config = {}, homeDir?: string): void {
  const api: SuperApi = createSuperApi(config.upstream)

  ctx.provide('agentChatApi', api)

  registerSuperRoute(ctx, api)

  if (config.tools === true) {
    // skill 同步是启动期一次性副作用：失败只降级（模型没 skill 但工具仍在），绝不阻断插件加载
    try {
      const synced = syncAgentChatSkill(homeDir)
      if (synced.changed) console.warn('[dsh-agent-chat] skill 已同步 →', synced.path)
    } catch (error) {
      console.warn('[dsh-agent-chat] skill 同步失败（忽略）：', error)
    }

    registerSuperTools(ctx, api)
    registerSuperDiscTools(ctx, api)
  } else {
    // 默认不注入模型工具面：回收此前版本同步过的 skill（尽力而为，不抛错）
    if (removeAgentChatSkill(homeDir)) {
      console.warn('[dsh-agent-chat] 工具面关闭——已移除旧 agent-chat skill')
    }
  }

  // 梯度 0：无存活实例时自动拉起捆绑引擎（一次性尝试 + 20s 就绪轮询；dispose 回收子进程）。
  // 有桌面版/CLI 在跑时探测即命中，不会重复拉起。失败只降级（红横幅自愈照旧），不阻断插件。
  if (config.engineAuto !== false) {
    ctx.effect(
      () => {
        void (async () => {
          try {
            const r = await ensureEngine(() => api.resolveBase())
            if (!r.live) console.warn('[dsh-agent-chat] 引擎不可用：', engineStatus().lastError)
          } catch (error) {
            console.warn('[dsh-agent-chat] 引擎初始化异常（忽略）：', error)
          }
        })()
        return () => killEngine()
      },
      'dsh-agent-chat: bundled engine',
    )
  }
}
