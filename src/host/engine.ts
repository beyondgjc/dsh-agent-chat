/**
 * 梯度 0 捆绑引擎：探测本机是否已有存活 workbench（桌面版/CLI/先前拉起的引擎），
 * 没有就 spawn 捆绑的 lib/engine.js（用当前进程的 node 可执行文件——DSH 桌面版是
 * Electron，加 ELECTRON_RUN_AS_NODE=1 即等价 node；动态端口 + portfile 握手）。
 * dispose（DSH 关闭/插件卸载）时回收子进程；数据目录与桌面版/CLI 共享。
 * 引擎 bundle 缺失（构建时没有私有仓库）→ 尝试失败，回落外部实例模式。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

export interface EngineSpawnResult {
  attempted: boolean
  started: boolean
  error?: string
}

export interface EngineStatus {
  bundled: boolean
  childAlive: boolean
  lastError: string | null
}

let child: ChildProcess | null = null
let lastError: string | null = null

/** 快速探测一个 workbench 实例是否存活（/api/groups 200 即活） */
export function probeWorkbench(base: string, timeoutMs = 1500): Promise<boolean> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  return fetch(`${base}/api/groups`, { signal: ctrl.signal })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => clearTimeout(t))
}

/** 捆绑引擎 bundle 的绝对路径；不存在（构建时没找到私有仓库）返回 null */
export function engineBundlePath(): string | null {
  const p = join(dirname(fileURLToPath(import.meta.url)), 'engine.js')
  return existsSync(p) ? p : null
}

/**
 * DSH 自带的控制台子系统 node（dsh-runtimes 各运行时的 dependencies/node/bin/node.exe）。
 * agentNodeExe 的首选注入源——桌面壳注入的就是同类副本（控制台子系统 + windowsHide，
 * agent 再 spawn 的控制台孙进程不弹窗）。找不到返回 null（回退 Electron-as-node）。
 */
export function dshNodeExe(): string | null {
  const root = join(homedir(), '.dsh', 'dsh-runtimes')
  try {
    for (const rt of readdirSync(root)) {
      const cand = join(root, rt, 'dependencies', 'node', 'bin', 'node.exe')
      if (existsSync(cand)) return cand
    }
  } catch {
    /* 无 runtimes 目录 */
  }
  return null
}

/** 拉起捆绑引擎（幂等：已有子进程直接返回成功）。就绪由调用方轮询 probe 确认。 */
export function spawnBundledEngine(): EngineSpawnResult {
  const enginePath = engineBundlePath()
  if (!enginePath) {
    lastError = '引擎未捆绑（构建时未找到私有仓库）——请安装 Super Agent 桌面版'
    return { attempted: true, started: false, error: lastError }
  }
  if (child) return { attempted: true, started: true }
  try {
    // publicDir 指向插件包内 public/（lib/engine.js 的上一级）。
    // stage0/cwd/mock 对齐桌面壳的 prepareEnv()，但安装根优先级不同：
    //   1) 构建机上的私有仓库 stage0（与引擎 bundle 同源，适配器最全）
    //   2) 桌面版安装根（LOCALAPPDATA\SuperAgent\apps）
    // bundle 形态下 realAgents 自己的 repoRoot 无意义，必须显式注入。
    const libDir = dirname(enginePath)
    const env: Record<string, string | undefined> = {
      ...process.env,
      SUPER_WORKBENCH_PORT: '0', // 动态端口，portfile 携带实际值
      SUPER_WORKBENCH_PUBLIC_DIR: join(libDir, '..', 'public'),
    }
    const pkgDir = join(libDir, '..')
    const repoStage0 = join(pkgDir, '..', '..', 'super-agent-zcode', 'stage0', 'apps')
    const desktopStage0 = join(
      process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local'),
      'SuperAgent',
      'apps',
    )
    const stage0 = existsSync(repoStage0) ? repoStage0 : desktopStage0
    if (existsSync(stage0)) {
      env.SUPER_STAGE0_APPS = stage0 // realAgents.ts 的安装根覆盖点（多根候选的第 1 优先）
      env.SUPER_AGENTS_CWD = stage0 // 子进程 cwd（仓库布局不存在）
    }
    const mockEntry = join(libDir, 'mock-agent.mjs')
    if (existsSync(mockEntry)) env.SUPER_MOCK_ENTRY = mockEntry
    let cmd: string
    let args: string[]
    const nodeExe = dshNodeExe()
    if (nodeExe) {
      // 首选：DSH 自带的控制台子系统真 node 跑引擎，并注入 SUPER_NODE_EXE
      // （agentNodeExe 的首选源，与桌面壳同一机制）——agent 孙进程不弹控制台
      cmd = nodeExe
      args = [enginePath]
      env.SUPER_NODE_EXE = nodeExe
    } else {
      // 回退：Electron 按 node 跑（GUI 子系统，agent 孙进程可能弹控制台）
      cmd = process.execPath
      args = [enginePath]
      env.ELECTRON_RUN_AS_NODE = '1'
    }
    child = spawn(cmd, args, {
      env,
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('exit', () => {
      child = null
    })
    lastError = null
    return { attempted: true, started: true }
  } catch (err) {
    child = null
    lastError = String((err as Error)?.message ?? err)
    return { attempted: true, started: false, error: lastError }
  }
}

export function killEngine(): void {
  if (child) {
    try {
      child.kill()
    } catch {
      /* 已退出 */
    }
    child = null
  }
}

export function engineStatus(): EngineStatus {
  return { bundled: engineBundlePath() !== null, childAlive: child !== null, lastError }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

/**
 * 确保有可用实例：探测存活 → 没有（且引擎可用）就拉起并轮询就绪（最长 ~20s）。
 * 返回最终是否探测到存活实例；失败信息在 engineStatus().lastError。
 */
export async function ensureEngine(
  resolveBase: () => Promise<string>,
): Promise<{ live: boolean; spawned: boolean }> {
  if (await probeWorkbench(await resolveBase())) return { live: true, spawned: false }
  const r = spawnBundledEngine()
  if (!r.started) return { live: false, spawned: false }
  for (let i = 0; i < 60; i++) {
    await sleep(333)
    if (await probeWorkbench(await resolveBase())) return { live: true, spawned: true }
  }
  lastError = '引擎启动超时（20s）'
  return { live: false, spawned: true }
}
