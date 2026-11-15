/**
 * 部署校验 + 自愈：profile 里的插件副本（lib/ 全件 + public/ 全件）应与源构建字节一致
 * （pnpm file: 硬链接，repo 内 rebuild 自动生效）。不一致 = 硬链接被构建覆盖破坏
 * （如 build-engine 的 cpSync 换了 inode）→ 自动重链接修复。修复失败退出码 1。
 * 清单不硬编码：tsdown chunk 分包（rolldown-runtime / adm-zip-<hash>.js）曾是漏网
 * 之鱼——profile 缺 chunk → index.js 静态 import 失败 →「启动时没能加载」。
 * 同时清理 profile 里的孤儿文件（旧构建的 hash chunk 残留）。
 * 用法：npm run deploy（= typecheck + test + build + 本脚本）。
 */
import { existsSync, linkSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
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

/** 递归收集目录下全部文件的相对路径（/ 分隔） */
function walkRel(abs, rel = '') {
  const out = []
  for (const name of readdirSync(abs)) {
    const full = join(abs, name)
    const r = rel ? `${rel}/${name}` : name
    if (statSync(full).isDirectory()) out.push(...walkRel(full, r))
    else out.push(r)
  }
  return out
}

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
    mkdirSync(dirname(dst), { recursive: true })
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

/** 同步一整个目录（lib/ 或 public/）：全件硬链接 + 清理 profile 孤儿 */
function syncTree(relDir) {
  const srcAbs = join(pkg, relDir)
  const dstAbs = join(profile, relDir)
  if (!existsSync(srcAbs)) {
    console.log(`${relDir}/: 源不存在——跳过`)
    return
  }
  const rels = walkRel(srcAbs)
  for (const rel of rels) compareAndRelink(join(relDir, rel), join(relDir, rel), `${relDir}/${rel}`)
  if (existsSync(dstAbs)) {
    const srcSet = new Set(rels)
    for (const rel of walkRel(dstAbs)) {
      if (srcSet.has(rel)) continue
      try {
        unlinkSync(join(dstAbs, rel))
        console.log(`${relDir}/${rel}: 孤儿已清理`)
      } catch {
        /* 留待下次 */
      }
    }
  }
}

syncTree('lib')
syncTree('public')
// package.json（版本真源）：engine.ts 运行时读它解析 PLUGIN_VERSION；pnpm file: 安装
// 时拷贝一次后不再更新，版本升了不同步会让首启下载去拉不存在的旧版 Release
compareAndRelink('package.json', 'package.json', 'package.json')

try {
  const st = execSync('git status --porcelain', { encoding: 'utf8' }).trim()
  if (st) console.log('\ngit 未提交变更：\n' + st)
} catch {
  /* 无 git 上下文时忽略 */
}

process.exit(ok ? 0 : 1)
