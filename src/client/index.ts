/**
 * dsh-agent-chat 浏览器半侧外壳。
 *
 * 复用策略（用户定案）：不重写 UI，直接把本机 workbench 的完整界面经宿主代理嵌进来——
 * 确认页档位、恢复门、预算追加、决策编辑器…与 workbench 100% 对齐，更新自动跟进。
 * 代理通道见 src/host/route.ts（/wb 复用分支 + /shell 容器页）。
 *
 * 容器（简化定案）：插件只嵌一个 iframe，指向插件自持的 /shell tab 容器页；
 * 容器页内部再挂两个常驻 iframe（群聊 | 讨论），tab 切换与记忆都在容器页里。
 * 面板 unmount 时把这个唯一 iframe 挪进 document.body 隐藏停靠区（同文档移动不重载）
 * ——整棵 iframe 树（含内层两页）的选中、滚动、输入草稿、轮询跨面板切换全部保留。
 * 'agentChatNavigation' 服务经 postMessage 驱动容器页切 tab（同源校验在容器页侧）。
 * （设置页分区已按用户决定移除——侧栏入口即唯一入口。）
 * 编译产物 lib/client.js 是 iife 经典脚本；react 经工厂 require 取得。
 */
;(function () {
  const loader = (window as any).__ModuleLoader__
  if (!loader) return

  function makeFactory(): (require: (id: string) => any) => any {
    return function (require: (id: string) => any) {
      const React = require('react')
      const h = React.createElement

      const name = 'dsh-agent-chat'
      const inject = ['slots']
      const PANEL_ID = 'dsh-agent-chat'
      const SHELL = '/dsh-agent-chat-598/shell'

      /** 常驻单一 iframe（/shell 容器页）+ 隐藏停靠区：面板卸载不销毁 */
      let frame: HTMLIFrameElement | null = null
      let parking: HTMLDivElement | null = null

      function ensureFrame(): void {
        if (frame) return
        parking = document.createElement('div')
        parking.style.display = 'none'
        document.body.appendChild(parking)
        frame = document.createElement('iframe')
        frame.src = SHELL
        frame.title = 'Agent Chat'
        // 透明：外壳容器页自己按 workbench 主题上色（--bg），不钉死纸色
        frame.style.cssText = 'flex:1;width:100%;border:none;min-height:0;background:transparent'
        parking.appendChild(frame)
      }

      /** 导航服务用的 tab 切换：postMessage 给 shell 容器页（同源） */
      function postTab(tab: 'groups' | 'disc'): void {
        try {
          frame?.contentWindow?.postMessage({ type: 'agent-chat-tab', tab }, location.origin)
        } catch (error) {
          console.error('[dsh-agent-chat] 切 tab 失败：', error)
        }
      }

      /** 左侧导航图标（ownerProps: { size, active }） */
      function PanelIcon(props: any): any {
        const size = (props && props.size) || 18
        return h(
          'svg',
          {
            width: size,
            height: size,
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 1.8,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            'aria-hidden': true,
          },
          [
            h('path', { d: 'M4 6.5C4 4.6 5.6 3 7.5 3h9C18.4 3 20 4.6 20 6.5v8c0 1.9-1.6 3.5-3.5 3.5H10l-5 5v-5.2C4.4 17.2 4 15.8 4 14.5z' }),
            h('circle', { cx: 9, cy: 10.5, r: 0.6, fill: 'currentColor', stroke: 'none' }),
            h('circle', { cx: 12.5, cy: 10.5, r: 0.6, fill: 'currentColor', stroke: 'none' }),
            h('circle', { cx: 16, cy: 10.5, r: 0.6, fill: 'currentColor', stroke: 'none' }),
          ],
        )
      }

      /** 单 iframe 容器：挂载时认领，卸载时挪进停靠区（不销毁，页面状态全保留） */
      function SuperAgentApp(): any {
        const claimHost = (el: any): void => {
          if (el) {
            ensureFrame()
            el.appendChild(frame!)
          } else if (frame && parking) {
            parking.appendChild(frame)
          }
        }
        return h(
          'div',
          { style: { display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 } },
          h('div', {
            ref: claimHost,
            style: { display: 'flex', flex: 1, width: '100%', minHeight: 0 },
          }),
        )
      }

      function apply(ctx: any): void {
        // 1) 主面板页（main keyed 槽，key 域开放，conversation 为唯一保留键）
        ctx.effect(() => {
          try {
            ctx.slots.inject('main', function* () {
              yield ctx.slots.register({ name: 'main', key: PANEL_ID, label: 'Agent Chat' }, SuperAgentApp)
            })
          } catch (error) {
            console.error('[dsh-agent-chat] 主面板注册失败（已忽略）：', error)
          }
        }, 'dsh-agent-chat: main panel')

        // 2) 左侧导航（单一入口）
        ctx.effect(() => {
          try {
            ctx.slots.inject('sidebar.panellist', function* () {
              yield ctx.slots.register(
                { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: 'Agent Chat' },
                PanelIcon,
              )
            })
          } catch (error) {
            console.error('[dsh-agent-chat] 导航注册失败（已忽略）：', error)
          }
        }, 'dsh-agent-chat: sidebar panellist')

        // 3) 跳转服务：打开面板并经 postMessage 切 tab
        ctx.provide('agentChatNavigation', {
          openBoard: () => {
            try { ctx.layout.selectPanel(PANEL_ID) } catch (error) { console.error('[dsh-agent-chat] 打开失败：', error) }
            postTab('groups')
          },
          openDiscussions: () => {
            try { ctx.layout.selectPanel(PANEL_ID) } catch (error) { console.error('[dsh-agent-chat] 打开失败：', error) }
            postTab('disc')
          },
        })
      }

      return { name, inject, apply }
    }
  }

  loader.load({ id: 'dsh-agent-chat', factory: makeFactory() })
})()
