/**
 * 梯度 0 → 首启下载分发：引擎的探测/拉起/下载/回收。
 *
 * ensureEngine 层级（DSH 启动时执行一次）：
 *   1) 探测存活实例（桌面版/CLI/先前引擎，portfile）→ 直接复用（伴侣应用模式）
 *   2) 捆绑副本（lib/engine.js，dev/本地 deploy 形态）→ 拉起
 *   3) 下载产物缓存（~/.dsh/cache/dsh-agent-chat/<version>/，含 SHA256 校验）→ 拉起
 *   4) 首启下载（GitHub Releases manifest + 分文件下载 + 进度上报）
 *   5) 全失败 → 引导横幅（shell 轮询 /setup/status 展示进度与原因）
 *
 * env 注入对齐桌面壳 prepareEnv()：SUPER_NODE_EXE（DSH 自带 CUI node，agent 孙进程
 * 不弹控制台）、SUPER_STAGE0_APPS/SUPER_AGENTS_CWD（优先私有仓库 stage0，回落桌面
 * 安装根）、SUPER_MOCK_ENTRY。引擎子进程独立于 DSH 生命周期，dispose 时回收。
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { homedir } from 'node:os'
import { fileURLToPath } from 'node:url'

declare const __PLUGIN_VERSION__: string | undefined

/**
 * 插件版本解析：构建期 define（tsdown/rolldown）→ 运行时读包版本 → 'dev'。
 * 不能只信 define：rolldown 管线下 define 曾静默失效（产物保留标识符，运行时落
 * 'dev' → 首启下载被跳过）；package.json 是同一真源（config 的 define 也取自它），
 * 且 verify-deploy 会把它同步进 profile，任何安装形态都读得到。
 */
function resolvePluginVersion(): string {
  if (typeof __PLUGIN_VERSION__ !== 'undefined' && __PLUGIN_VERSION__) return __PLUGIN_VERSION__
  try {
    const pkg = JSON.parse(
      readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
    ) as { version?: string }
    if (typeof pkg.version === 'string' && pkg.version) return pkg.version
  } catch {
    /* 无包上下文（eval/异常布局） */
  }
  return 'dev'
}
export const PLUGIN_VERSION: string = resolvePluginVersion()

const REPO_SLUG = 'beyondgjc/dsh-agent-chat'
/** 缓存根（可 DSH_AGENT_CHAT_CACHE 覆盖，测试/多实例隔离用） */
export const ARTIFACT_CACHE_ROOT =
  process.env.DSH_AGENT_CHAT_CACHE?.trim() || join(homedir(), '.dsh', 'cache', 'dsh-agent-chat')

/** 下载产物缓存目录（按插件版本隔离） */
export function artifactCacheDir(): string {
  return join(ARTIFACT_CACHE_ROOT, PLUGIN_VERSION)
}

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

export type DownloadPhase = 'idle' | 'downloading' | 'verifying' | 'done' | 'failed'

export const downloadState: {
  phase: DownloadPhase
  file: string
  received: number
  total: number
  error: string | null
} = { phase: 'idle', file: '', received: 0, total: 0, error: null }

let child: ChildProcess | null = null
let lastError: string | null = null

function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM'
  }
}

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

/** 通用引擎拉起：engineFile 所在目录需含 mock-agent.mjs，publicDir 相邻提供 */
function spawnEngineAt(engineFile: string, publicDir: string): EngineSpawnResult {
  if (child) return { attempted: true, started: true }
  try {
    const env: Record<string, string | undefined> = {
      ...process.env,
      SUPER_WORKBENCH_PORT: '0', // 动态端口，portfile 携带实际值
      SUPER_WORKBENCH_PUBLIC_DIR: publicDir,
    }
    // stage0/cwd/mock 对齐桌面壳 prepareEnv()，但安装根优先级不同：
    //   1) 构建机上的私有仓库 stage0（与引擎 bundle 同源，适配器最全）
    //   2) 桌面版安装根（LOCALAPPDATA\SuperAgent\apps）
    const pkgDir = join(dirname(engineFile), '..')
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
    const mockEntry = join(dirname(engineFile), 'mock-agent.mjs')
    if (existsSync(mockEntry)) env.SUPER_MOCK_ENTRY = mockEntry
    const nodeExe = dshNodeExe()
    if (nodeExe) env.SUPER_NODE_EXE = nodeExe

    // 首选 DSH 自带 CUI node 跑引擎；找不到（罕见）回退当前进程 exe（DSH 桌面形态下
    // 是 Electron，需 ELECTRON_RUN_AS_NODE；GUI 子系统下 agent 孙进程可能弹控制台）
    if (nodeExe) {
      child = spawn(nodeExe, [engineFile], { env, stdio: 'ignore', windowsHide: true })
    } else {
      child = spawn(process.execPath, [engineFile], {
        env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
        stdio: 'ignore',
        windowsHide: true,
      })
    }
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

/** 捆绑形态拉起（lib/engine.js + 包内 public/）——保留为 dev/本地 deploy 形态 */
export function spawnBundledEngine(): EngineSpawnResult {
  const b = engineBundlePath()
  if (!b) {
    lastError = '引擎未捆绑（构建时未找到私有仓库）'
    return { attempted: true, started: false, error: lastError }
  }
  return spawnEngineAt(b, join(dirname(b), '..', 'public'))
}

export function engineStatus(): EngineStatus {
  return { bundled: engineBundlePath() !== null, childAlive: child !== null, lastError }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}

async function waitReady(resolveBase: () => Promise<string>, tries = 60): Promise<boolean> {
  for (let i = 0; i < tries; i++) {
    await sleep(333)
    if (await probeWorkbench(await resolveBase())) return true
  }
  return false
}

interface ArtifactManifest {
  version: string
  sha256: string
  size: number
}

/** 带超时的 fetch（CN→GitHub 长悬挂实测：无超时 = 引导层永远 0%） */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController()
  const t = setTimeout(() => ctrl.abort(), timeoutMs)
  try {
    return await fetch(url, { signal: ctrl.signal })
  } finally {
    clearTimeout(t)
  }
}

const DL_ATTEMPTS = 3
const MANIFEST_TIMEOUT_MS = Number(process.env.DSH_DL_TIMEOUT_MS ?? 10_000)
const ZIP_IDLE_TIMEOUT_MS = Number(process.env.DSH_DL_IDLE_TIMEOUT_MS ?? 20_000)

/** 下载/校验引擎 artifact（单 zip + SHA256）并解压到缓存目录，进度上报到 downloadState。
 *  清单与 zip 各 3 次尝试、超时快速失败（manifest 10s / zip 流 20s 无进展即断），
 *  拒绝无限悬挂。 */
export async function downloadEngineArtifact(
  baseUrl = `https://github.com/${REPO_SLUG}/releases/download/v${PLUGIN_VERSION}`,
): Promise<void> {
  const cache = artifactCacheDir()
  mkdirSync(cache, { recursive: true })
  downloadState.phase = 'downloading'
  downloadState.error = null
  downloadState.received = 0
  downloadState.total = 0

  // 1) 清单（3 次尝试）
  let manifest: ArtifactManifest | null = null
  let lastErr: unknown = null
  for (let attempt = 1; attempt <= DL_ATTEMPTS && !manifest; attempt++) {
    try {
      const mResp = await fetchWithTimeout(`${baseUrl}/engine-manifest.json`, MANIFEST_TIMEOUT_MS)
      if (!mResp.ok) throw new Error(`清单获取失败：HTTP ${mResp.status}`)
      manifest = (await mResp.json()) as ArtifactManifest
    } catch (err) {
      lastErr = err
      if (attempt < DL_ATTEMPTS) await sleep(1500 * attempt)
    }
  }
  if (!manifest) {
    throw new Error(
      `${String((lastErr as Error)?.message ?? lastErr)}（重试 ${DL_ATTEMPTS} 次未成功）`,
    )
  }
  downloadState.total = manifest.size || 0
  downloadState.file = 'engine-artifact.zip'

  // 2) zip（3 次尝试；读流 20s 无进展即断重试）
  let zipBuf: Buffer | null = null
  for (let attempt = 1; attempt <= DL_ATTEMPTS && !zipBuf; attempt++) {
    const ctrl = new AbortController()
    let idleTimer: NodeJS.Timeout | undefined
    const armIdle = () => {
      clearTimeout(idleTimer)
      idleTimer = setTimeout(() => ctrl.abort(), ZIP_IDLE_TIMEOUT_MS)
    }
    try {
      const resp = await fetch(`${baseUrl}/engine-artifact.zip`, { signal: ctrl.signal })
      if (!resp.ok) throw new Error(`引擎下载失败：HTTP ${resp.status}`)
      const chunks: Buffer[] = []
      const reader = resp.body?.getReader()
      if (reader) {
        armIdle()
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          armIdle()
          chunks.push(Buffer.from(value))
          downloadState.received += value.length
        }
      }
      zipBuf = Buffer.concat(chunks)
    } catch (err) {
      lastErr = err
      downloadState.received = 0
      if (attempt < DL_ATTEMPTS) await sleep(1500 * attempt)
    } finally {
      clearTimeout(idleTimer)
    }
  }
  if (!zipBuf) {
    throw new Error(
      `${String((lastErr as Error)?.message ?? lastErr)}（重试 ${DL_ATTEMPTS} 次未成功——网络可达 GitHub Releases 时将自动重试）`,
    )
  }

  downloadState.phase = 'verifying'
  const got = createHash('sha256').update(zipBuf).digest('hex')
  if (manifest.sha256 && got !== manifest.sha256) throw new Error('引擎 artifact SHA256 不匹配')
  const AdmZip = (await import('adm-zip')).default
  new AdmZip(zipBuf).extractAllTo(cache, true)
  // manifest 落盘进缓存：cacheValid 以它判完整性；engine-entry 以它自报版本
  // （zip 内不含 manifest——历史上只用于校验后即弃，缓存层与版本接管全部失灵）
  writeFileSync(join(cache, 'engine-manifest.json'), JSON.stringify(manifest), 'utf8')
  downloadState.phase = 'done'
}

/** 缓存目录是否是一份解压完整的产物 */
function cacheValid(cache: string): boolean {
  return (
    existsSync(join(cache, 'engine.js')) &&
    existsSync(join(cache, 'engine-manifest.json')) &&
    existsSync(join(cache, 'public', 'app.js'))
  )
}

/** 引擎进程存活实例的版本（portfile.version；v0.2.7 前的旧引擎无此字段 → null） */
export function portfileEngineVersion(): string | null {
  try {
    const dataDir =
      process.env.SUPER_AGENT_DATA_DIR?.trim() || join(homedir(), 'Documents', 'SuperAgent')
    const j = JSON.parse(readFileSync(join(dataDir, 'workbench.port'), 'utf8')) as {
      version?: string
    }
    return typeof j.version === 'string' && j.version ? j.version : null
  } catch {
    return null
  }
}

/**
 * 确保有可用实例：探测存活 → 捆绑副本 → 下载缓存 → 首启下载 → 放弃。
 * 探测复用带版本比对：存活实例版本 ≠ 插件期望版本时——**旧引擎继续服役**（面板
 * 不中断），新引擎在后台下载，下次 DSH 启动由 engine-entry 的版本守卫接管。
 * （v0.2.19 教训：升级期不保留旧引擎服役 = 网络一抖面板全砖。）
 * 返回最终是否探测到存活实例；失败信息在 engineStatus().lastError / downloadState。
 */
export async function ensureEngine(
  resolveBase: () => Promise<string>,
): Promise<{ live: boolean; spawned: boolean }> {
  if (await probeWorkbench(await resolveBase())) {
    const liveVer = portfileEngineVersion()
    if (!liveVer || liveVer === PLUGIN_VERSION) return { live: true, spawned: false }
    // 版本不匹配：旧引擎继续服役，新引擎后台下载（缓存就绪后下次启动接管）
    lastError = `存活引擎 v${liveVer}，插件期望 v${PLUGIN_VERSION}——新引擎后台下载中，下次启动接管`
    if (!cacheValid(artifactCacheDir())) {
      void downloadEngineArtifact().catch(() => {})
    }
    return { live: true, spawned: false }
  }

  // 1) 捆绑副本（dev / 本地 deploy 形态）
  const bundled = engineBundlePath()
  if (bundled) {
    spawnEngineAt(bundled, join(dirname(bundled), '..', 'public'))
    if (await waitReady(resolveBase)) return { live: true, spawned: true }
    killEngine()
  }

  // 2) 下载产物缓存（此前下载过且完整）
  const cache = artifactCacheDir()
  const cacheEngine = join(cache, 'engine.js')
  if (cacheValid(cache) && existsSync(cacheEngine)) {
    spawnEngineAt(cacheEngine, join(cache, 'public'))
    if (await waitReady(resolveBase)) return { live: true, spawned: true }
    killEngine()
  }

  // 3) 首启下载（GitHub Releases；dev 版本无 release → 跳过）
  if (PLUGIN_VERSION !== 'dev') {
    try {
      await downloadEngineArtifact()
      spawnEngineAt(join(cache, 'engine.js'), join(cache, 'public'))
      if (await waitReady(resolveBase)) return { live: true, spawned: true }
      lastError = '引擎启动超时（20s）'
    } catch (err) {
      lastError = String((err as Error)?.message ?? err)
      downloadState.phase = 'failed'
      downloadState.error = lastError
    }
  } else {
    lastError = 'dev 构建无捆绑副本且未配置引擎（外部实例模式）'
  }

  return { live: false, spawned: true }
}
