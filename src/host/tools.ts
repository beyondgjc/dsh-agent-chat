/**
 * agent 工具注册（inject: ['tools'] + ctx.tools.register(defineTool(...))）。
 *
 * 只保留"会话内模型真正需要"的最小面（5 个，全部读/发言，零生命周期）：
 *   super_groups_list / super_group_post / super_group_board
 *   super_disc_list / super_disc_detail
 * 建群、拉人、踢人、归队、档位、讨论的创建/启动/控制/决策都是人在 agent-chat 面板
 * 里的操作——不注册成工具（工作流知识由 agent-chat skill 承载，见 ./skill.ts）。
 * 形态镜像 packages/todo/tool-todo：parameters 用 dsh 的 ParameterSchemaSpec，
 * output 必须同时给 schema 与 render。
 */
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { SuperApi } from './super-api.ts'

const GROUP_ID_PARAM = {
  type: 'string',
  required: true,
  description: '群 ID（group_…，先调 super_groups_list 获取）',
} as const

function textBlock(text: string): { type: 'text'; text: string } {
  return { type: 'text', text }
}

function renderJson(_args: unknown, value: unknown) {
  return [textBlock(JSON.stringify(value, null, 2))]
}

function authorLabel(m: { author: { kind: string; label?: string | null; episodeId?: string | null } }): string {
  return m.author.kind === 'agent'
    ? (m.author.label ?? m.author.episodeId ?? '?')
    : m.author.kind
}

export function registerSuperTools(ctx: any, api: SuperApi): void {
  // 1) 列群
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'super_groups_list',
          description:
            '列出本机 Super Agent（多 agent 群聊工作台）里的全部群：名称、ID、在群成员数、消息数。'
            + '要在群里发言或读回复，先调这个拿群 ID。没有合适的群时不要自行建群——建群/拉人在 agent-chat 面板里做。',
          parameters: {},
          output: { schema: { type: 'json' }, render: renderJson },
          async execute() {
            const groups = await api.listGroups()
            return {
              groups: groups.map((g) => ({
                id: g.id,
                name: g.name,
                activeMembers: g.activeMembers,
                messages: g.messageSeq,
                closed: Boolean(g.closedAt),
              })),
            }
          },
        }),
      ),
    'dsh-agent-chat: tool super_groups_list',
  )

  // 2) 发消息
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'super_group_post',
          description:
            '向 Super Agent 群发一条消息（用户身份）。默认全体在群成员各回一合；'
            + 'text 里写 @显示名 可只点名特定成员（名字要写准确）。一条消息把需求说完整，别拆碎。'
            + '发送后返回落板的消息。',
          parameters: {
            groupId: GROUP_ID_PARAM,
            text: { type: 'string', required: true, description: '消息正文（可含 @显示名 点名）' },
          },
          output: { schema: { type: 'json' }, render: renderJson },
          async execute(args: { groupId: string; text: string }) {
            const m = (await api.postMessage(args.groupId, args.text)).message
            return {
              seq: m.seq,
              author: authorLabel(m),
              text: m.text,
              mentions: m.mentions,
              stale: Boolean(m.stale),
            }
          },
        }),
      ),
    'dsh-agent-chat: tool super_group_post',
  )

  // 3) 读板面
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'super_group_board',
          description:
            '读 Super Agent 群的最近板面消息（含成员回复与系统事件），按 seq 升序。'
            + '发言后成员回合需要时间，读不到新回复可稍后再读。'
            + '群里安静可能是封波机制（GRP-02），不是故障。',
          parameters: {
            groupId: GROUP_ID_PARAM,
            limit: { type: 'number', description: '最多返回的条数（默认 30）' },
          },
          output: { schema: { type: 'json' }, render: renderJson },
          async execute(args: { groupId: string; limit?: number }) {
            const all = await api.getBoard(args.groupId)
            const limit = args.limit ?? 30
            const messages: any[] = all.slice(-limit)
            return {
              count: messages.length,
              messages: messages.map((m) => ({
                seq: m.seq,
                author: authorLabel(m),
                text: m.text,
                mentions: m.mentions,
                stale: Boolean(m.stale),
                at: m.at,
              })),
            }
          },
        }),
      ),
    'dsh-agent-chat: tool super_group_board',
  )
}

/**
 * 讨论只读工具（提案→互评→修订→复核→综合→决策 主线的状态查看入口）。
 * 讨论的创建/确认启动/暂停停止/决策应用都在 agent-chat 面板里由人操作。
 */
export function registerSuperDiscTools(ctx: any, api: SuperApi): void {
  // 1) 列表
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'super_disc_list',
          description:
            '列出本机 Super Agent 的全部讨论（多应用方案评审主线）：ID、阶段、额度用量、需求预览。'
            + '查讨论进度/结论先调这个拿 ID。同一时刻全局只有一场进行中。',
          parameters: {},
          output: { schema: { type: 'json' }, render: renderJson },
          async execute(): Promise<any> {
            const j = await api.discussionsList()
            return { activeId: j.activeId, discussions: j.discussions }
          },
        }),
      ),
    'dsh-agent-chat: tool super_disc_list',
  )

  // 2) 详情
  ctx.effect(
    () =>
      ctx.tools.register(
        defineTool({
          name: 'super_disc_detail',
          description:
            '读一场讨论的详情：阶段、需求原文、产物清单（proposal/review/revision/recheck/synthesis…）、'
            + '逐项决策现状、是否在跑。汇报进度用。',
          parameters: { id: GROUP_ID_PARAM },
          output: { schema: { type: 'json' }, render: renderJson },
          async execute(args: { id: string }) {
            const d = await api.discussionDetail(args.id)
            const rec = d.record as any
            return {
              id: rec.id,
              stage: rec.stage,
              pauseReason: rec.pauseReason ?? null,
              budgetUsed: (rec.budget?.entries ?? []).length,
              requirement: rec.requirementText,
              participants: (rec.participants ?? []).map((p: any) => p.kind),
              artifactNames: d.artifactNames,
              active: d.active,
              decisions: (rec.decisions ?? []).map((x: any) => ({
                id: x.id,
                content: x.content,
                status: x.status ?? '待决定',
              })),
            }
          },
        }),
      ),
    'dsh-agent-chat: tool super_disc_detail',
  )
}
