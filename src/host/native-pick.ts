/**
 * 原生目录选择（捆绑引擎的恢复方案）：引擎是无 GUI 的纯 node 进程，弹不了系统对话框；
 * 但插件宿主跑在 DSH 的 Electron 主进程里，可以代弹（dialog.showOpenDialog）。
 *
 * 仅 Electron 主进程（process.type === 'browser'）可用——Electron 会在该进程内全局拦截
 * 'electron' 模块解析；plain node（测试/CLI 宿主形态）里 require('electron') 会触发
 * npm 包的懒安装（数百 MB 下载，dsh-pet 的教训），所以必须先守卫再 require。
 * 不可用时返回 null，页面自动回退网页目录选择器（现有流程）。
 */
import { createRequire } from 'node:module'

export async function nativePickDirectory(startDir?: string): Promise<string | null> {
  if ((process as any).type !== 'browser') return null
  try {
    const require = createRequire(import.meta.url)
    const electron = require('electron') as any
    const dialog = electron?.dialog ?? electron?.default?.dialog
    if (!dialog?.showOpenDialog) return null
    const r = await dialog.showOpenDialog({
      title: '选择工作目录',
      defaultPath: startDir,
      properties: ['openDirectory', 'createDirectory'],
    })
    if (r.canceled || !r.filePaths?.length) return null
    return r.filePaths[0]
  } catch {
    return null
  }
}
