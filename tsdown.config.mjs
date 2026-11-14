// tsdown 配置（仿 dsh-pet：src → lib 产物）
//   1) 浏览器半侧（client → lib/client.js）：window.__ModuleLoader__.load 单文件形态，
//      整份产物包一层 IIFE（DSH 把 client.js 当经典脚本重复执行，防全局声明重复），
//      前导 ';' 抵消多插件 combo 拼接的 ASI 歧义。
//   2) 宿主半侧（index → lib/index.js）：保持 ESM，由 DSH 的 Loader import，绝不能包 IIFE。
//   @deepseek-ai/*、react 一律外部化（由 DSH 宿主/页面平台模块提供）。
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'tsdown'

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)))

const shared = {
  platform: 'node',
  target: 'es2020',
  dts: false,
  outDir: 'lib',
  clean: false,
}

export default defineConfig([
  {
    ...shared,
    // 浏览器半侧用原生 iife：产物即经典脚本（无 ESM export 语句），
    // 被 DSH 当经典脚本重复执行也安全；副作用就是 window.__ModuleLoader__.load(...)
    format: ['iife'],
    entry: { client: 'src/client/index.ts' },
    outputOptions: { entryFileNames: '[name].js' },
    external: [/^@deepseek-ai\//, /^node:/, 'react'],
  },
  {
    ...shared,
    entry: { index: 'src/host/index.ts' },
    external: [/^@deepseek-ai\//, /^node:/],
  },
])
