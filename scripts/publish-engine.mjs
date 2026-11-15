/**
 * 引擎 artifact 发布：gh release create/upload 到公开插件仓库
 * （beyondgjc/dsh-agent-chat）。发布 = 引擎二进制产物公开（源码仍私有）。
 * 前置：npm run build && npm run pack:artifact（dist/ 里有 zip + manifest）。
 */
import { execSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version
const tag = `v${version}`
const zip = join(pkg, 'dist', 'engine-artifact.zip')
const manifest = join(pkg, 'dist', 'engine-manifest.json')
for (const f of [zip, manifest]) {
  if (!existsSync(f)) throw new Error(`缺 ${f}——先 npm run pack:artifact`)
}

const repo = 'beyondgjc/dsh-agent-chat'
function gh(cmd) {
  return execSync(`gh ${cmd}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] })
}

let exists = true
try {
  gh(`release view ${tag} -R ${repo}`)
} catch {
  exists = false
}
if (exists) {
  console.log(`[publish] release ${tag} 已存在——追加/覆盖资产`)
  gh(`release upload ${tag} "${zip}" "${manifest}" -R ${repo} --clobber`)
} else {
  console.log(`[publish] 创建 release ${tag}`)
  gh(
    `release create ${tag} "${zip}" "${manifest}" -R ${repo} `
    + `--title "引擎 artifact ${tag}" `
    + `--notes "本地引擎产物：插件首启自动下载使用。sha256 见 engine-manifest.json。"`,
  )
}
console.log(`[publish] ✓ https://github.com/${repo}/releases/tag/${tag}`)
