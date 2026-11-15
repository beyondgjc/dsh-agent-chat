/**
 * 部署校验：profile 里的插件副本应与源构建字节一致（pnpm file: 依赖是硬链接克隆，
 * repo 内 rebuild 自动生效）。不一致 = 硬链接断了或没装，退出码 1。
 * 用法：npm run deploy（= typecheck + test + build + 本脚本）。
 */
import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const profileLib = join(
  homedir(),
  '.dsh',
  'profiles',
  'desktop',
  'node_modules',
  'dsh-agent-chat',
  'lib',
)

let ok = true
for (const f of ['index.js', 'client.js']) {
  const src = readFileSync(join('lib', f))
  let dst = null
  try {
    dst = readFileSync(join(profileLib, f))
  } catch {
    /* profile 缺文件 */
  }
  const same = dst !== null && src.equals(dst)
  console.log(`${f}: ${same ? 'profile 副本一致 ✓' : 'profile 副本不一致 ✗（进 profile 目录跑 pnpm install --prod）'}`)
  if (!same) ok = false
}

try {
  const st = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
  if (st) console.log('\ngit 未提交变更：\n' + st)
} catch {
  /* 无 git 上下文时忽略 */
}

process.exit(ok ? 0 : 1)
