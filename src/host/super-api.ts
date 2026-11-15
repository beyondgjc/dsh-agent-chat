/**
 * Super Agent workbench 客户端（宿主半侧）。
 *
 * 上游解析顺序（每个请求实时解析，容忍 workbench 重启换端口）：
 *   1. env SUPER_WORKBENCH_UPSTREAM（显式覆盖，如 http://127.0.0.1:7980）
 *   2. portfile：<dataDir>/workbench.port（Super Agent workbench listen 时写入；
 *      dataDir 依次尝试 env SUPER_AGENT_DATA_DIR 与默认 %USERPROFILE%\Documents\SuperAgent）
 *   3. 配置的 upstream（cordis.patch.yml 的 config.upstream，默认 http://127.0.0.1:7980）
 */
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

const DEFAULT_UPSTREAM = 'http://127.0.0.1:7980'

function trimBase(raw: string): string {
  return raw.replace(/\/+$/, '')
}

/** pid 存活探测（process.kill(pid,0) 即存在性检查；EPERM = 存在但无权限，也算活着） */
function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

async function readPortfile(): Promise<string | null> {
  // SUPER_AGENT_DATA_DIR 是整体覆盖：设了就只查它（测试/多实例隔离），否则查默认数据目录
  const dir =
    process.env.SUPER_AGENT_DATA_DIR?.trim() ||
    join(homedir(), 'Documents', 'SuperAgent')
  try {
    const raw = (await readFile(join(dir, 'workbench.port'), 'utf8')).trim()
    // 旧格式：纯端口（桌面版 0.3.x 写入）——直接信任
    if (/^\d{2,5}$/.test(raw)) return raw
    // 新格式：JSON {port, pid, startedAt}——pid 已死视为残留 portfile，
    // 不再回退读取（否则端口被系统复用时可能连到陌生服务）
    try {
      const j = JSON.parse(raw) as { port?: number; pid?: number }
      if (typeof j.port === 'number' && typeof j.pid === 'number') {
        return pidAlive(j.pid) ? String(j.port) : null
      }
    } catch {
      /* 非 JSON：忽略 */
    }
  } catch {
    /* 无 portfile */
  }
  return null
}

export async function resolveUpstream(configured?: string): Promise<string> {
  const env = process.env.SUPER_WORKBENCH_UPSTREAM?.trim()
  if (env) return trimBase(env)
  const port = await readPortfile()
  if (port) return `http://127.0.0.1:${port}`
  if (configured?.trim()) return trimBase(configured)
  return DEFAULT_UPSTREAM
}

/** workbench 的 JSON 错误体形如 {"error": "..."}——透出 message，不吞成 "500" */
async function requestJson(base: string, path: string, init?: RequestInit): Promise<unknown> {
  let resp: Response
  try {
    resp = await fetch(`${base}${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
    })
  } catch (err) {
    // portfile 可能指向已退出的实例：回退默认端口再试一次（CLI 固定 7980 的场景）
    const fallback = DEFAULT_UPSTREAM
    if (trimBase(base) !== fallback) {
      try {
        resp = await fetch(`${fallback}${path}`, {
          ...init,
          headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
        })
        base = fallback
      } catch {
        throw new Error(
          `Super Agent workbench（${base} 与 ${fallback}）均不可达：${String((err as Error)?.message ?? err)}。`
            + '请确认 Super Agent 桌面版正在运行，或 `npm run workbench` 已启动。',
        )
      }
    } else {
      throw new Error(
        `Super Agent workbench（${base}）不可达：${String((err as Error)?.message ?? err)}。`
          + '请确认 Super Agent 桌面版正在运行，或 `npm run workbench` 已启动。',
      )
    }
  }
  const body: unknown = await resp.json().catch(() => ({}))
  if (!resp.ok) {
    const msg =
      (body as { error?: string })?.error ?? `HTTP ${resp.status}`
    const e: any = new Error(`Super Agent API ${path} 失败：${msg}`)
    // 保留完整错误体（恢复门 payload / sensitiveHits 等结构化信息）
    if (body && typeof body === 'object') e.body = body
    throw e
  }
  return body
}

export interface SuperGroupSummary {
  id: string
  name: string
  cwd: string
  updatedAt: string
  activeMembers: number
  messageSeq: number
  closedAt: string | null
}

export interface BoardMessage {
  seq: number
  at: string
  author: { kind: 'user' | 'agent' | 'system'; episodeId?: string; label?: string; via?: string }
  text: string
  mentions: string[]
  stale?: boolean
}

export interface SuperApi {
  /** 当前解析出的上游基址（用于健康检查与调试展示） */
  resolveBase(): Promise<string>
  listGroups(): Promise<SuperGroupSummary[]>
  getBoard(groupId: string, after?: number): Promise<BoardMessage[]>
  postMessage(
    groupId: string,
    text: string,
    mentions?: string[],
    via?: string,
  ): Promise<{ message: BoardMessage }>
  createGroup(input: {
    name: string
    cwd: string
    members?: Array<{ appId: string; label?: string }>
  }): Promise<{ record: { id: string; name: string } }>
  kickMember(groupId: string, episodeId: string): Promise<{ kicked: boolean; needsReview: boolean }>

  /* 讨论（workbench /api/discussions 透传） */
  discussionsList(): Promise<{
    discussions: Array<Record<string, unknown>>
    activeId: string | null
  }>
  discussionDetail(id: string): Promise<{
    record: Record<string, unknown>
    artifactNames: string[]
    active: boolean
    activeStages: string[]
  }>
  discussionCreate(input: {
    requirement: string
    cwd?: string
    participants?: string[]
    roles?: string[]
    rounds?: number
    runMode?: 'auto' | 'step'
    allowSensitive?: boolean
  }): Promise<{ record: Record<string, unknown>; sensitiveHits: unknown[]; configs: unknown }>
  /** action: confirm | resume | pause | stop | mode | message | final-review */
  discussionAction(
    id: string,
    action: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>>
  discussionArtifact(
    id: string,
    name: string,
  ): Promise<{ name: string; raw: string; parsed: unknown }>
  discussionDecisions(
    id: string,
    decisions: Array<{ id: string; status: string; option?: string; note?: string }>,
    finalize?: boolean,
  ): Promise<{ applied: number; grade: string | null; stage: string; briefPath: string }>
  /** 返回导出的 Markdown 原文（GET，不改变状态 SYN-08） */
  discussionExport(id: string): Promise<string>

  /** 通用透传：插件页/工具访问 workbench 其余端点 */
  request(path: string, init?: RequestInit): Promise<unknown>
}

export function createSuperApi(configuredUpstream?: string): SuperApi {
  async function base(): Promise<string> {
    return resolveUpstream(configuredUpstream)
  }

  const api: SuperApi = {
    resolveBase: base,
    async listGroups() {
      const b = await base()
      const j = (await requestJson(b, '/api/groups')) as { groups: SuperGroupSummary[] }
      return j.groups ?? []
    },
    async getBoard(groupId, after = 0) {
      const b = await base()
      const j = (await requestJson(b, `/api/groups/${encodeURIComponent(groupId)}/messages?after=${after}`)) as {
        messages: BoardMessage[]
      }
      return j.messages ?? []
    },
    async postMessage(groupId, text, mentions, via) {
      const b = await base()
      const j = (await requestJson(b, `/api/groups/${encodeURIComponent(groupId)}/messages`, {
        method: 'POST',
        body: JSON.stringify({
          text,
          ...(mentions?.length ? { mentions } : {}),
          ...(via ? { via } : {}),
        }),
      })) as { message: BoardMessage }
      return j
    },
    async createGroup(input) {
      const b = await base()
      const j = (await requestJson(b, '/api/groups', {
        method: 'POST',
        body: JSON.stringify(input),
      })) as { record: { id: string; name: string } }
      return j
    },
    async kickMember(groupId, episodeId) {
      const b = await base()
      const j = (await requestJson(b, `/api/groups/${encodeURIComponent(groupId)}/kick`, {
        method: 'POST',
        body: JSON.stringify({ episodeId }),
      })) as { kicked: boolean; needsReview: boolean }
      return j
    },

    /* ---------- 讨论（workbench /api/discussions 全套透传） ---------- */

    async discussionsList() {
      const b = await base()
      return (await requestJson(b, '/api/discussions')) as {
        discussions: Array<Record<string, unknown>>
        activeId: string | null
      }
    },
    async discussionDetail(id: string) {
      const b = await base()
      return (await requestJson(b, `/api/discussions/${encodeURIComponent(id)}`)) as {
        record: Record<string, unknown>
        artifactNames: string[]
        active: boolean
        activeStages: string[]
      }
    },
    async discussionCreate(input: {
      requirement: string
      cwd?: string
      participants?: string[]
      roles?: string[]
      rounds?: number
      runMode?: 'auto' | 'step'
      allowSensitive?: boolean
    }) {
      const b = await base()
      return (await requestJson(b, '/api/discussions', {
        method: 'POST',
        body: JSON.stringify(input),
      })) as { record: Record<string, unknown>; sensitiveHits: unknown[]; configs: unknown }
    },
    async discussionAction(id: string, action: string, body?: Record<string, unknown>) {
      const b = await base()
      return (await requestJson(b, `/api/discussions/${encodeURIComponent(id)}/${action}`, {
        method: 'POST',
        body: JSON.stringify(body ?? {}),
      })) as Record<string, unknown>
    },
    async discussionArtifact(id: string, name: string) {
      const b = await base()
      return (await requestJson(
        b,
        `/api/discussions/${encodeURIComponent(id)}/artifact?name=${encodeURIComponent(name)}`,
      )) as { name: string; raw: string; parsed: unknown }
    },
    async discussionDecisions(
      id: string,
      decisions: Array<{ id: string; status: string; option?: string; note?: string }>,
      finalize?: boolean,
    ) {
      const b = await base()
      return (await requestJson(b, `/api/discussions/${encodeURIComponent(id)}/decisions`, {
        method: 'POST',
        body: JSON.stringify({ decisions, finalize }),
      })) as { applied: number; grade: string | null; stage: string; briefPath: string }
    },
    async discussionExport(id: string): Promise<string> {
      const b = await base()
      const resp = await fetch(`${b}/api/discussions/${encodeURIComponent(id)}/export`)
      if (!resp.ok) {
        const j: any = await resp.json().catch(() => ({}))
        throw new Error(j?.error ?? `HTTP ${resp.status}`)
      }
      return await resp.text()
    },

    async request(path: string, init?: RequestInit) {
      const b = await base()
      return await requestJson(b, path, init)
    },
  }

  return api
}
