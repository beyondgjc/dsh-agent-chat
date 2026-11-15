/**
 * 引擎 artifact 打包（首启下载分发形态，PyLance 式）：
 *   dist/engine-artifact.zip     ← 引擎 + mock + public/**（单 zip，Releases 资产平铺友好）
 *   dist/engine-manifest.json    ← { version, sha256, size }（zip 校验）
 *
 * 设计取舍（2026-11-15 调研定案）：stage0 真适配器集（1.97GB）**不进 artifact**——
 * 真适配器需要用户自己的账号认证，业界（Zed）按应用引导安装；本机已装的
 * 桌面版/仓库 stage0 继续经现有解析复用。
 * 上传：npm run publish-engine（gh release create/upload）。
 */
import AdmZip from 'adm-zip'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const pkg = join(dirname(fileURLToPath(import.meta.url)), '..')
const version = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).version
const staging = join(pkg, 'dist', 'engine-artifact')
const zipPath = join(pkg, 'dist', 'engine-artifact.zip')
const manifestPath = join(pkg, 'dist', 'engine-manifest.json')

// 组装 staging 目录：lib 两件 + public/**
rmSync(staging, { recursive: true, force: true })
mkdirSync(staging, { recursive: true })
const lib = join(pkg, 'lib')
for (const f of ['engine.js', 'mock-agent.mjs']) {
  if (!existsSync(join(lib, f))) throw new Error(`缺 ${f}——先 npm run build`)
}
cpSync(join(lib, 'engine.js'), join(staging, 'engine.js'))
cpSync(join(lib, 'mock-agent.mjs'), join(staging, 'mock-agent.mjs'))
cpSync(join(pkg, 'public'), join(staging, 'public'), { recursive: true })

// 打 zip
const zip = new AdmZip()
function addTree(abs, rel) {
  for (const name of readdirSync(abs)) {
    const full = join(abs, name)
    const r = rel ? `${rel}/${name}` : name
    if (statSync(full).isFile()) zip.addFile(r, readFileSync(full))
    else addTree(full, r)
  }
}
addTree(staging, '')
zip.writeZip(zipPath)

// 清单
const zipBuf = readFileSync(zipPath)
const manifest = {
  version,
  sha256: createHash('sha256').update(zipBuf).digest('hex'),
  size: zipBuf.length,
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 2))
console.log(`[artifact] v${version}：engine-artifact.zip ${(manifest.size / 1024 / 1024).toFixed(2)} MB`)
console.log(`[artifact] sha256 ${manifest.sha256.slice(0, 16)}…`)
console.log(`[artifact] ${zipPath}`)
