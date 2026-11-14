/**
 * dsh-agent-chat 浏览器半侧外壳。
 *
 * 复用策略（用户定案）：不重写 UI，直接把本机 workbench 的完整界面经宿主代理嵌进来——
 * 讨论与群聊的全部功能（确认页档位、恢复门、预算追加、决策编辑器…）与 workbench 100% 对齐，
 * workbench 更新自动跟进。代理通道见 src/host/route.ts 的 /wb 分支（fetch shim + 资源改写）。
 *
 * 注册面：'main' keyed 槽（key='dsh-agent-chat'）→ 双 tab（群聊 | 讨论）iframe 容器；
 * 'sidebar.panellist'（id='dsh-agent-chat'）→ 气泡图标；'settings.section' → 紧凑版同款 App；
 * 'agentChatNavigation' 服务 → selectPanel + 切 tab。
 * 编译产物 lib/client.js 是 iife 经典脚本；react 经工厂 require 取得。
 */
;(function () {
  const loader = (window as any).__ModuleLoader__
  if (!loader) return

  function makeFactory(): (require: (id: string) => any) => any {
    return function (require: (id: string) => any) {
      const React = require('react')
      const h = React.createElement
      const { useState, useEffect } = React

      const name = 'dsh-agent-chat'
      const inject = ['slots']
      const PANEL_ID = 'dsh-agent-chat'
      const WB = '/dsh-agent-chat-598/wb'

      /** 导航服务与页面组件共享的 tab 设置器（组件挂载时接管） */
      let setTabExternal: ((t: 'groups' | 'disc') => void) | null = null

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

      /** 双 tab 容器：两个 iframe 常驻（隐藏切换，保留各自页面状态） */
      function makeApp(fullPage: boolean): any {
        return function SuperAgentApp(): any {
          const [tab, setTab] = useState('groups')
          useEffect(() => {
            setTabExternal = (t: 'groups' | 'disc') => setTab(t)
            return () => {
              setTabExternal = null
            }
          }, [])
          const tabBtn = (id: 'groups' | 'disc', label: string): any =>
            h(
              'button',
              {
                key: id,
                onClick: () => setTab(id),
                style: {
                  fontSize: 13,
                  padding: '4px 16px',
                  borderRadius: 6,
                  border: '1px solid rgba(128,128,128,0.4)',
                  cursor: 'pointer',
                  fontWeight: tab === id ? 700 : 400,
                  background: tab === id ? 'rgba(64,128,255,0.15)' : 'transparent',
                  color: 'inherit',
                },
              },
              label,
            )
          const frame: any = {
            flex: 1,
            width: '100%',
            border: 'none',
            minHeight: 0,
            background: '#f6f4ef',
          }
          return h(
            'div',
            {
              style: {
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                ...(fullPage ? { height: '100%', minHeight: 0 } : { minHeight: 560 }),
              },
            },
            h('div', { style: { display: 'flex', gap: 6 } }, tabBtn('groups', '群聊'), tabBtn('disc', '讨论')),
            h('iframe', { src: `${WB}/groups`, style: { ...frame, display: tab === 'groups' ? 'flex' : 'none' }, title: 'Super 群聊' }),
            h('iframe', { src: `${WB}/`, style: { ...frame, display: tab === 'disc' ? 'flex' : 'none' }, title: 'Super 讨论' }),
          )
        }
      }

      const AppFull = makeApp(true)
      const AppCompact = makeApp(false)

      function apply(ctx: any): void {
        // 1) 主面板页（main keyed 槽，key 域开放，conversation 为唯一保留键）
        ctx.effect(() => {
          try {
            ctx.slots.inject('main', function* () {
              yield ctx.slots.register({ name: 'main', key: PANEL_ID, label: 'Super Agent' }, AppFull)
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
                { name: 'sidebar.panellist', id: PANEL_ID, order: 20, label: 'Super Agent' },
                PanelIcon,
              )
            })
          } catch (error) {
            console.error('[dsh-agent-chat] 导航注册失败（已忽略）：', error)
          }
        }, 'dsh-agent-chat: sidebar panellist')

        // 3) 设置页分区（紧凑版）
        ctx.effect(() => {
          try {
            ctx.slots.inject('settings.section', function* () {
              yield ctx.slots.register(
                {
                  name: 'settings.section',
                  id: 'dsh-agent-chat',
                  order: 40,
                  label: () => 'Super Agent',
                  inject: () => ({}),
                },
                AppCompact,
              )
            })
          } catch (error) {
            console.error('[dsh-agent-chat] 设置分区注册失败（已忽略）：', error)
          }
        }, 'dsh-agent-chat: settings section')

        // 4) 跳转服务：打开面板并切到对应 tab
        ctx.provide('agentChatNavigation', {
          openBoard: () => {
            try { ctx.layout.selectPanel(PANEL_ID) } catch (error) { console.error('[dsh-agent-chat] 打开失败：', error) }
            setTabExternal?.('groups')
          },
          openDiscussions: () => {
            try { ctx.layout.selectPanel(PANEL_ID) } catch (error) { console.error('[dsh-agent-chat] 打开失败：', error) }
            setTabExternal?.('disc')
          },
        })
      }

      return { name, inject, apply }
    }
  }

  loader.load({ id: 'dsh-agent-chat', factory: makeFactory() })
})()
