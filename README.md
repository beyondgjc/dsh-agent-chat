# dsh-agent-chat

把 [Super Agent](https://github.com/) 的群聊（多 agent 群聊工作台）接入 DSH 的 cordis 插件。
Tier 1 薄插件：**不嵌引擎、不改 Super Agent 架构**，宿主半侧是对本机 workbench HTTP API 的薄客户端。

## 功能

- **5 个 agent 工具**（零生命周期；dsh 会话里模型直接调用）：
  - `super_groups_list` — 列出全部群（拿群 ID）
  - `super_group_post` — 向群发消息（用户身份；@显示名 点名）
  - `super_group_board` — 读最近板面
  - `super_disc_list` / `super_disc_detail` — 讨论进度与结论（只读）
- **agent-chat skill**：插件启动时把工作流知识幂等同步到 `~/.dsh/skills/agent-chat/SKILL.md`
  （DSH skill 用户根，rank 400），模型按需加载——什么时候用群聊/讨论、@语义、三规则、
  "生命周期由人在面板操作"的边界都在里面
- **HTTP 前缀 `/dsh-agent-chat-598`**：后缀 598 是个人命名空间标记（与 ~/.dsh 的
  whale598 / persona-presets-598 同一约定）；cordis bundle id 全局唯一，前缀本不会撞，纯惯例
- **侧栏板面**：DSH 侧边栏 agent-chat 图标 → 单一 iframe 指向插件自持的 `/dsh-agent-chat-598/shell` 容器页（tab 栏 + 群聊|讨论 两个常驻内层 iframe，经 /wb 代理复用 workbench 完整 UI）；面板切换停靠保活，tab 态记 localStorage
- **`agentChatApi` cordis 服务**：其他插件可在宿主半侧 `ctx.get('agentChatApi')` 复用同一客户端

## 安装

```sh
# 先构建
npm install && npm run build

# 装进 desktop profile
dsh plugin --profile desktop add file:C:/Users/beyondguo/Documents/Agents/dsh-agent-chat/dsh-agent-chat
```

装完**重开 DSH** 生效。

## 上游发现（Super Agent workbench 在哪）

按顺序取第一个命中的：

1. 环境变量 `SUPER_WORKBENCH_UPSTREAM`（如 `http://127.0.0.1:7980`）
2. portfile：`<SuperAgent 数据目录>/workbench.port`（workbench 启动时自动写入、关闭时清理；
   数据目录依次尝试 `SUPER_AGENT_DATA_DIR` 与默认 `%USERPROFILE%\Documents\SuperAgent`）
3. 插件配置 `upstream`（cordis.patch.yml 的 config；需要时在该文件加：
   `- id: dsh-agent-chat` 的 `{ id, name, config: { upstream: "…" } }` 条目）
4. 默认 `http://127.0.0.1:7980`

**一件安装（默认）**：插件包内捆绑了完整的本地引擎（lib/engine.js）——首次启动若检测不到
存活实例，会自动用本机 Node 拉起引擎（动态端口 + portfile 握手），无需安装任何东西；
DSH 关闭时引擎自动回收。引擎不可用（bundle 缺失/启动失败）时面板横幅给出原因。

**已有 Super Agent 桌面版/CLI**：探测命中即直接复用，不会重复拉起（pid 校验互斥共存）。
桌面版默认动态端口 → 靠 portfile 自动发现；CLI `npm run workbench` 固定 7980。

## 开发

```sh
npm run typecheck   # tsc --noEmit
npm run build       # tsdown → lib/（host ESM + client IIFE）
npm test            # node --test（super-api 上游发现/请求/错误路径）
```

构建产物 `lib/index.js`（宿主，ESM）+ `lib/client.js`（浏览器，IIFE 包裹的经典脚本）。
