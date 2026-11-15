/**
 * 引擎打包（梯度 0）：把私有仓库 super-agent-zcode 的 workbench 引擎
 * （engine-entry + orchestrator + client + shared，全依赖内联）打成单文件
 * lib/engine.js，并把 public/ 静态资源拷进插件包。
 *
 * 私有仓库缺失/不在邻居位置 → 跳过（引擎为可选增强，运行时回落外部实例模式）。
 * CI（公开仓库）没有私有仓库 → 自动跳过，只跑 tsdown。
 */
import { build } from 'esbuild'
import { cpSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const pkg = join(here, '..')
// 包目录在 Agents/dsh-agent-chat/dsh-agent-chat → 私有仓库是 Agents/super-agent-zcode
const engineRepo = join(pkg, '..', '..', 'super-agent-zcode')
const entry = join(engineRepo, 'packages', 'workbench', 'src', 'engine-entry.ts')

if (!existsSync(entry)) {
  console.warn('[engine] 未找到私有仓库引擎入口（' + entry + '）——跳过引擎打包（外部实例模式）')
  process.exit(0)
}

mkdirSync(join(pkg, 'lib'), { recursive: true })
await build({
  entryPoints: [entry],
  outfile: join(pkg, 'lib', 'engine.js'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'info',
  // 部分依赖在 ESM 产物里可能走 CJS require——补一个 createRequire 兜底
  banner: {
    js: "import { createRequire } from 'node:module';const require = createRequire(import.meta.url);",
  },
})

const pubSrc = join(engineRepo, 'packages', 'workbench', 'public')
const pubDst = join(pkg, 'public')
mkdirSync(pubDst, { recursive: true })
cpSync(pubSrc, pubDst, { recursive: true })

// mock 适配器（联调成员）：单文件 mock-agent.mjs，SUPER_MOCK_ENTRY 指向它
await build({
  entryPoints: [join(engineRepo, 'packages', 'mock-agent', 'src', 'main.ts')],
  outfile: join(pkg, 'lib', 'mock-agent.mjs'),
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node20',
  sourcemap: false,
  logLevel: 'warning',
})

console.log('[engine] lib/engine.js + lib/mock-agent.mjs + public/ 已产出')
