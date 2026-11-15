/**
 * 部署校验 + 自愈：profile 里的插件副本（lib 三件 + public/）应与源构建字节一致
 * （pnpm file: 硬链接，repo 内 rebuild 自动生效）。不一致 = 硬链接被构建覆盖破坏
 * （如 build-engine 的 cpSync 换了 inode）→ 自动重链接修复。修复失败退出码 1。
 * 用法：npm run deploy（= typecheck + test + build + 本脚本）。
 */
import { existsSync, linkSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { execSync } from 'node:child_process'

const pkg = process.cwd()
const profile = join(
  homedir(),
  '.dsh',
  'profiles',
  'desktop',
  'node_modules',
  'dsh-agent-chat',
)

let ok = true

/** 字节比对；不一致/缺失时删除旧副本并重新硬链接源文件（保留 inode，rebuild 自动同步） */
function compareAndRelink(relSrc, relDst, label) {
  const src = join(pkg, relSrc)
  const dst = join(profile, relDst)
  if (!existsSync(src)) {
    console.log(`${label}: 源不存在 ✗`)
    ok = false
    return
  }
  let dstBuf = null
  try {
    dstBuf = readFileSync(dst)
  } catch {
    /* 缺失 */
  }
  if (dstBuf && dstBuf.equals(readFileSync(src))) {
    console.log(`${label}: ✓`)
    return
  }
  try {
    try {
      unlinkSync(dst)
    } catch {
      /* 不存在 */
    }
    linkSync(src, dst)
    console.log(`${label}: 已重链接 ✓`)
  } catch (e) {
    console.log(`${label}: 修复失败 ✗ ${e.message}`)
    ok = false
  }
}

for (const f of ['index.js', 'client.js', 'engine.js', 'mock-agent.mjs']) {
  compareAndRelink(join('lib', f), join('lib', f), `lib/${f}`)
}

// public/ 静态资源（引擎捆绑形态下由插件提供，扁平文件）
const pubSrc = join(pkg, 'public')
if (existsSync(pubSrc)) {
  for (const name of readdirSync(pubSrc)) {
    if (statSync(join(pubSrc, name)).isFile()) {
      compareAndRelink(join('public', name), join('public', name), `public/${name}`)
    }
  }
} else {
  console.log('public/: 源不存在（未跑 build-engine）——跳过')
}

try {
  const st = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
  if (st) console.log('\ngit 未提交变更：\n' + st)
} catch {
  /* 无 git 上下文时忽略 */
}

process.exit(ok ? 0 : 1)
