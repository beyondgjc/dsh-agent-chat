# dsh-agent-chat

把 Super Agent 的群聊与讨论接入 DSH（DeepSeek Harness）的 cordis 插件。
薄插件：不嵌引擎源码、不改 Super Agent 架构；宿主半侧是本机 workbench 的
代理 + agent 工具 + skill，UI 经 `/wb` 通道整体复用。

## 功能

- **5 个 agent 工具**（零生命周期；dsh 会话里模型直接调用）：
  - `super_groups_list` — 列出全部群（拿群 ID）
  - `super_group_post` — 向群发消息（消息带「经 agent-chat」来源标注，与用户本人原话区分）
  - `super_group_board` — 读最近板面
  - `super_disc_list` / `super_disc_detail` — 讨论进度与结论（只读）
- **agent-chat skill**：插件启动时把工作流知识幂等同步到 `~/.dsh/skills/agent-chat/SKILL.md`
  （DSH skill 用户根，rank 400），模型按需加载——什么时候用群聊/讨论、@语义、
  三规则（连击上限/封板/stale）、"生命周期由人在面板操作"的边界都在里面
- **侧栏板面**：DSH 侧边栏 Agent Chat 图标 → 单一 iframe 指向插件自持的
  `/dsh-agent-chat-598/shell` 容器页（tab 栏 + 群聊|讨论 两个常驻内层 iframe，经 /wb
  代理复用 workbench 完整 UI）；**面板切换停靠保活**（选中/滚动/草稿/轮询全保留），
  tab 态记 localStorage
- **连接自愈**：workbench 死亡/重启时面板自动退避重连（1s→15s），恢复后自动回到
  原状态 + 绿横幅；常驻 iframe 切走时轮询降频 30s
- **原生目录对话框**：`选择目录…` 由插件宿主（DSH Electron 主进程）代弹原生对话框；
  非 DSH 形态自动回退网页选择器
- **`agentChatApi` cordis 服务**：其他插件可在宿主半侧 `ctx.get('agentChatApi')` 复用同一客户端

## 一件安装与引擎生命周期

插件包内捆绑完整本地引擎（`lib/engine.js`，~0.5MB 自包含 bundle：orchestrator +
workbench 服务端 + ACP SDK）。启动时的引擎决策顺序：

| 顺序 | 条件 | 动作 |
|---|---|---|
| 1 | 探测到存活实例（桌面版 / CLI / 先前引擎，portfile + pid 存活校验） | 直接复用，不重复拉起 |
| 2 | 无存活实例 | 自动拉起捆绑引擎（DSH 自带的控制台子系统 node 运行，动态端口 + portfile 握手），失败时尝试首启下载 |
| 3 | 首启下载 | 从 GitHub Releases 下载引擎 artifact（SHA256 校验）到 `~/.dsh/cache/dsh-agent-chat/<version>/` 后拉起，面板显示下载进度 |
| 4 | 下载失败 | 引导横幅给出原因与桌面版安装建议 |

- 引擎随 DSH 生命周期：DSH 关闭时自动回收（数据落盘无损）
- 引擎进程是**子进程**，独立于 DSH 主进程（崩溃不连坐）；与桌面版/CLI 通过
  portfile pid 校验互斥共存
- **真适配器（codex-acp / codebuddy 等）不随插件分发**：它们需要用户自己的账号
  认证（业界惯例，同 Zed 的 agent 模式）。本机已装的（桌面版安装根 / 仓库 stage0，
  多根自动探测）直接复用；没有的在拉人/建群时报适配器未安装

## 上游发现（Super Agent workbench 在哪）

按顺序取第一个命中的：

1. 环境变量 `SUPER_WORKBENCH_UPSTREAM`（如 `http://127.0.0.1:7980`）
2. portfile：`<SuperAgent 数据目录>/workbench.port`（workbench 启动时写入 JSON
   `{port, pid, startedAt}`，pid 存活才采信；数据目录默认 `%USERPROFILE%\Documents\SuperAgent`）
3. 插件配置 `upstream`
4. 默认 `http://127.0.0.1:7980`

HTTP 路由前缀 `/dsh-agent-chat-598`：后缀 598 是个人命名空间标记（与 `~/.dsh` 的
whale598 / persona-presets-598 同一约定）；cordis bundle id 全局唯一，前缀本不会撞。

## 架构（两个仓库）

```
DSH 桌面版（cordis 宿主）
 └─ dsh-agent-chat 插件（本仓库，公开）
     ├─ host: /shell 容器页 + /wb UI 复用代理 + /api 反代 + 5 工具 + skill 同步
     │        + 捆绑引擎拉起/首启下载 + native-pick 代弹
     └─ client: 单一 iframe + 停靠保活
          │  HTTP（portfile 发现）
          ▼
Super Agent（私有仓库 super-agent-zcode）
 ├─ packages/orchestrator   ← 群聊引擎 + 讨论引擎（全部业务逻辑）
 ├─ packages/workbench      ← HTTP API + 全部 UI
 └─ apps/desktop            ← Electron 桌面版（同一套 workbench）
```

耦合面只有 **HTTP 契约**（REST API 形状 + 页面 DOM 结构）；改产品去私有仓库，
改"怎么嵌进 DSH"去本仓库。

## 开发

```sh
npm install
npm run build          # tsdown（host ESM + client IIFE）+ esbuild 引擎 bundle + public/ 拷贝
npm test               # node --test（20 用例：上游发现/apply 冒烟/路由 10 用例/引擎集成/下载校验）
npm run typecheck      # tsc --noEmit
npm run deploy         # typecheck + test + build + verify-deploy（profile 副本字节比对+硬链接自愈）
npm run pack:artifact  # dist/engine-artifact.zip + SHA256 清单（发布产物）
npm run publish-engine # gh release create/upload（发布引擎二进制；源码仍私有）
```

- 引擎 bundle 打包需要私有仓库 `super-agent-zcode` 在同级目录（构建机）；缺失时
  自动跳过引擎部分（CI 形态：公开仓库只构建/测试适配器本体）
- 本地部署：`npm run deploy` 后重开 DSH 生效；workbench 静态资源改动热部署后 F5

## 当前状态（v0.2.0）

- 已实测：双适配器（codex-acp + codebuddy）创建群 27.5s 接入成功；引擎自动拉起、
  portfile 握手、面板自愈、首启下载（真实 Releases E2E 230KB）
- 已知边界：
  - 真适配器冷启动 25~30s 属正常（创建请求超时已放宽到 90s）
  - 捆绑引擎无 GUI：目录选择由插件宿主代弹（DSH 形态）；独立运行引擎时回退网页选择器
  - 未登录/未安装的 agent 应用在拉人下拉中会出现，接入时报"适配器未安装"
  - 引擎 artifact 走 Releases 分发（v0.2.0 起）；`lib/engine.js` 捆绑副本保留为
    开发/离线兜底，正式 npm 发布时可排除（下载层自动成为主路径）
