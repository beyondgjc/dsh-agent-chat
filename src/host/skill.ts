/**
 * agent-chat skill：把"什么时候用群聊/讨论、怎么用、边界在哪"的工作流知识
 * 交给 DSH 会话里的模型（按需加载，不占每次会话的常驻上下文）。
 *
 * DSH 的 skill 发现根（按优先级）：
 *   100 <projectRoot>/.dsh/skills → 200 <projectRoot>/.agents/skills
 *   → 300 Config.customSkillDirs → 400 <dshHome>/skills → 500 <agentsHome>/skills
 * 本插件在 apply() 时把 SKILL.md 幂等同步到用户根 ~/.dsh/skills/agent-chat/：
 * 内容没变就不写；卸载插件不回收（skill 留着无害，避免误删用户目录里的东西）。
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const SKILL_DIRNAME = 'agent-chat'

const SKILL_MD = `---
name: agent-chat
description: 多 agent 群聊与讨论（Super Agent 工作台）。当用户想让多个 agent 讨论问题、征求意见、评审方案，或者要在 Super Agent 群里发言、查看板面回复、查询讨论进度与结论时使用。
---

# Agent Chat：多 agent 群聊 / 讨论

本机 Super Agent 工作台（DSH 插件 dsh-agent-chat）提供跨应用的多 agent 协作：
群聊（多 agent 群里问答）与讨论（提案→互评→修订→复核 的方案评审主线）。
相关 agent 工具以 \`super_\` 前缀注册。

## 群聊：把问题扔进群里

适用："扔到群里问问"、"让几个 agent 讨论/看看"、"听听多方意见"。

1. \`super_groups_list\`：拿群 ID 与在群成员数，确认有合适的群
2. \`super_group_post\`：向群发言
   - 默认全体在群成员各回一合；\`@显示名\` 可只点名特定成员（名字要写准确）
   - 一条消息把需求说完整，不要拆成多条碎片
3. \`super_group_board\`：读板面回复（seq 升序，limit 控制条数）
   - 成员回合需要时间，读不到新回复就稍后再读
4. 综合成员观点回复用户；观点冲突时如实并列，不擅自裁决

## 讨论：方案评审主线

\`super_disc_list\` 列出讨论（ID、阶段、需求预览；同一时刻全局只有一场进行中）
→ \`super_disc_detail\` 读阶段、产物清单与逐项决策现状。
适合回答"讨论跑到哪了 / 结论是什么"。

## 群机制（解释现象用）

- 成员每回合收到的是自上次以来的新消息增量，不是全量历史
- GRP-01：同一对成员互 @ 有次数上限，防止两个 agent 刷屏
- GRP-02：没人接话时本回合封波结束——群里安静是正常机制，不是故障
- GRP-03：基于过期消息的回复会被标 stale（过时）

## 边界：生命周期由人操作

建群、拉人、踢人、归队（复用会话重拉）、档位（模型/推理档）设置，
讨论的创建/确认启动/暂停停止/决策应用，都是人在 agent-chat 面板（DSH 侧边栏）里完成的。
不要用工具创建或修改群与讨论；用户提出这类需求时，引导其打开面板操作。

- 通过 super_group_post 发言时，消息会标注「经 agent-chat」来源——群里看到的不是用户本人原话。
  不要替用户下结论或替用户选择方案；重要取舍先向用户确认再发。
`

export interface SkillSyncResult {
  path: string
  changed: boolean
}

/** 把 SKILL.md 幂等写到用户 skill 根；内容一致则跳过。homeDir 仅供测试注入。 */
export function syncAgentChatSkill(homeDir: string = homedir()): SkillSyncResult {
  const dir = join(homeDir, '.dsh', 'skills', SKILL_DIRNAME)
  const file = join(dir, 'SKILL.md')
  let existing: string | null = null
  if (existsSync(file)) {
    try {
      existing = readFileSync(file, 'utf8')
    } catch {
      existing = null
    }
  }
  if (existing === SKILL_MD) return { path: file, changed: false }
  mkdirSync(dir, { recursive: true })
  writeFileSync(file, SKILL_MD, 'utf8')
  return { path: file, changed: true }
}

/** 工具面关闭时回收已同步的 skill 目录——stale 内容会把模型指向不存在的工具。尽力而为不抛错。 */
export function removeAgentChatSkill(homeDir: string = homedir()): boolean {
  const dir = join(homeDir, '.dsh', 'skills', SKILL_DIRNAME)
  try {
    if (!existsSync(dir)) return false
    rmSync(dir, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}
