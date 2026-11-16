# 开发与部署指南

覆盖整个项目的两个仓库：产品本体（super-agent-zcode，私有）与 DSH 插件（dsh-agent-chat，公开）。
使用者视角的功能说明见 [README.md](README.md)；本文面向开发者——仓库结构、本地部署、发布流程、故障排查。

## 1. 仓库总览

| 仓库 | 可见性 | 分支 | 角色 |
|---|---|---|---|
| `super-agent-zcode` | 私有 | `master`（remote 已配，未设 upstream） | 产品本体：编排引擎 + 工作台 UI + 桌面壳 |
| `dsh-agent-chat` | 公开 | `main`（origin 同步，push 即 CI） | cordis 插件薄壳：接入 DSH + 分发引擎产物 |

两者只通过 **HTTP 契约**（REST API 形状 + 页面 DOM）耦合；改产品去私有仓库，改"怎么嵌进 DSH"去插件仓库。
构建期需要两仓库**同级摆放**（见 §2 摆放约定）。

### 1.1 super-agent-zcode（npm workspaces）

```
packages/
  shared/        领域模型、JSON 原子写、数据目录解析
  mock-agent/    模拟 ACP Agent（联调/异常测试用，零模型调用）
  client/        通用 ACP Client（进程管理、initialize 协商、会话复用、恢复扫描、适配器安装根解析）
  orchestrator/  讨论编排 + 群聊引擎（全部业务逻辑）
  workbench/     HTTP 服务端 + 全部 UI（public/ 原生 JS，零构建）+ engine-entry.ts（分发引擎入口）
apps/desktop/    Electron 桌面壳（主进程内嵌 workbench 服务器）
scripts/         install-agents.ts（适配器安装）等
stage0/          阶段 0 证据（stage0/apps 本机固定安装已移除——安装根改在 LOCALAPPDATA）
docs/            M2–M6 里程碑报告、GROUP-M1 群聊报告、依赖冻结记录
```

### 1.2 dsh-agent-chat（单包）

```
src/host/        路由（/shell 容器 + /wb 复用代理 + /api 反代+同源防线）、模型工具面
                 （5 个 super_* 工具 + skill 同步，默认关——config.tools 开启）、
                 skill 同步、引擎拉起 ensureEngine、首启下载、native-pick 代弹
src/client/      侧栏单一 iframe + 停靠保活
scripts/         build-engine.mjs / pack-engine-artifact.mjs / publish-engine.mjs / verify-deploy.mjs
public/          引擎 UI 静态资源镜像（与私有仓库 workbench public/ 同步）
lib/             构建产物：index.js（host ESM）+ client.js（IIFE）+ engine.js（捆绑引擎 bundle）
                 + mock-agent.mjs
```

## 2. 环境要求与摆放

- **Node ≥ 22**（CI 用 24）；包管理用 **npm**（两仓库都是 npm workspaces / package-lock，勿用 pnpm 装）
- **DSH 桌面版**：插件宿主，提供 `~/.dsh/profiles/desktop`（插件部署位）与
  `~/.dsh/dsh-runtimes`（自带 node，引擎拉起用）
- **gh CLI** 已登录（仅发布引擎 artifact 需要）
- **Windows**（当前验证平台；`desktop:dist` 用 electron-builder --win）
- **摆放约定**：两仓库必须同级——

```
<某目录>/super-agent-zcode            ← 私有产品仓库
<某目录>/dsh-agent-chat/dsh-agent-chat ← 插件仓库（仓库根内层同名目录）
```

`build-engine.mjs` 按 `<插件包>/../../super-agent-zcode` 找私有仓库打引擎 bundle；
私有仓库缺失时自动跳过引擎部分（CI 形态：公开仓库只构建/测试插件本体）。

## 3. 本地部署

### 3.1 产品侧（super-agent-zcode）

```sh
cd super-agent-zcode
npm install
npm test                # vitest 全量
npm run typecheck       # tsc --noEmit

npm run workbench       # 独立引擎+工作台：http://127.0.0.1:7980（仅回环）
npm run desktop         # 桌面版开发：bundle 后 electron 起
npm run agents:install  # ACP 适配器安装到 %LOCALAPPDATA%\SuperAgent\apps（--force 重装）
```

- 数据目录：`%USERPROFILE%\Documents\SuperAgent`（`SUPER_AGENT_DATA_DIR` 覆盖，支持中文空格）；
  portfile 写在 `<数据目录>/workbench.port`（JSON `{port, pid, version, startedAt}`）
- 端口：`SUPER_WORKBENCH_PORT` 覆盖；冲突明确报错，不自动换端口
- 桌面安装包：`npm run desktop:dist` → 产物在 `apps/desktop/release/`
- 适配器（claude-code / codex-acp / gemini-cli / qwen-code / kimi-code / copilot-cli /
  opencode / cursor-agent 等）装在 `%LOCALAPPDATA%\SuperAgent\apps\<kind>`，按
  REAL_AGENT_PACKAGES 精确版本；真适配器需要用户自己的账号认证（业界惯例，同 Zed）

### 3.2 插件侧（dsh-agent-chat）

```sh
cd dsh-agent-chat/dsh-agent-chat
npm install
npm run deploy   # typecheck + test + build（tsdown + esbuild 引擎 bundle）+ 部署校验自愈
```

- deploy 终点：`~/.dsh/profiles/desktop/node_modules/dsh-agent-chat`——把 `lib/` 全件 +
  `public/` 全件 + `package.json` 硬链接进 DSH 档案目录（file: 硬链接，repo 内 rebuild 自动
  生效），并清理旧构建残留的孤儿文件。**重启 DSH 生效**；仅改 `public/`（引擎 UI）时 F5 面板即可
- `npm run deploy -- --no-engine`（或 `DSH_DEPLOY_NO_ENGINE=1`）：不同步捆绑引擎副本——
  验证"首启下载为主路径"的发布形态，否则捆绑副本永远遮蔽下载路径且版本徽标显示 vdev
- 单测：`npm test`（上游发现 / apply 冒烟 / 路由 10 用例 / 引擎 / 下载校验五组，node --test）
- CI（`.github/workflows/ci.yml`）：ubuntu + Node 24，typecheck + test + build，无私有仓库时引擎部分自动跳过

### 3.3 运行形态与联调

**引擎决策四层**（插件启动时）：

| 顺序 | 条件 | 动作 |
|---|---|---|
| 1 | 探测到存活实例（portfile + pid 存活校验） | 直接复用 |
| 2 | 无存活实例 | 拉起捆绑引擎（lib/engine.js，DSH runtimes node，动态端口） |
| 3 | 无捆绑副本 | 首启下载：GitHub Releases artifact → SHA256 校验 → `~/.dsh/cache/dsh-agent-chat/<version>/` |
| 4 | 下载失败 | 面板引导横幅（原因 + 桌面版安装建议） |

**上游发现四层**：env `SUPER_WORKBENCH_UPSTREAM` → portfile → 插件配置 `upstream` → 默认 `http://127.0.0.1:7980`。

典型联调场景：

- **A. 与桌面版共存**：桌面版开着 → portfile 探活命中 → 插件直接复用桌面版引擎，不重复拉起
- **B. 纯插件**：无桌面版 → 捆绑引擎自动拉起（env 注入 `SUPER_WORKBENCH_PORT=0` 动态端口、
  `SUPER_WORKBENCH_PUBLIC_DIR`、`SUPER_STAGE0_APPS`、`SUPER_NODE_EXE` 等）
- **C. 改引擎/编排代码**：私有仓库改 → 回插件仓 `npm run build`（重新打引擎 bundle）→
  `npm run deploy` → 重启 DSH。引擎 bundle 是构建快照，不热连
- **D. 改 UI**：私有仓库 `packages/workbench/public/` 改 → 同步到插件仓 `public/` 镜像 →
  `npm run deploy` → F5 面板

**适配器解析顺序**（引擎侧）：env `SUPER_STAGE0_APPS` → `%LOCALAPPDATA%\SuperAgent\apps` →
仓库 `stage0/apps`（已移除，恒跳过）。

### 3.4 验证清单

1. 访问 `/dsh-agent-chat-598/setup/status` → live / engine / download 状态正常，版本徽标 = 当前版本
2. 创建群（codex-acp + codebuddy）：~30s 接入成功、不弹控制台黑窗（超时已放宽 90s）
3. 「选择目录…」弹出原生对话框（client 顶层主帧桥直调 DSH preload 的
   `__DSH_DIRECTORY_PICKER__` → Electron 主进程 dialog；iframe 直调会被主进程的
   mainFrame 硬门拒绝）
4. 面板切走再切回：选中/滚动/草稿保留（停靠保活）

## 4. 发布

### 4.1 版本号

唯一真源是插件仓 `package.json` 的 `version`（当前 0.2.26，npm 包同名同步）：tsdown 以
`__PLUGIN_VERSION__` 注入 host，运行时决定缓存子目录（`~/.dsh/cache/dsh-agent-chat/<version>/`）、
Release tag（`v<version>`）与 npm 引擎下载 URL（Releases/download/v<version>/）。
**引擎/编排有实质变更才 bump**；纯插件壳小改不必 bump（捆绑副本随 lib 走）。

### 4.2 引擎 artifact 发布（对外，PyLance 式）

```sh
npm run build            # tsdown + esbuild 引擎 bundle（需同级私有仓库）
npm run pack:artifact    # dist/engine-artifact.zip + engine-manifest.json {version, sha256, size}
npm run publish-engine   # gh release create/upload v<version>；已存在则 --clobber 覆盖资产
```

- 发布的是**产物**（引擎 bundle + mock + public），源码仍私有
- GitHub Releases 新资产有几分钟 404 传播延迟：publish 后 curl 校验 manifest 返回 200 再宣称完成
- **npm 版本与 artifact 必须成对**：npm 用户装的版本会按 `v<version>` 下载引擎——bump 后
  忘了 publish-engine = npm 用户首启下载 404

### 4.3 插件发布到 npm（CI 通道）

包 = 插件壳（`.npmignore` 排除 `lib/engine.js` / `lib/mock-agent.mjs` / `lib/engine-manifest.json` /
`public/`——引擎不上 npm，下载层为主路径；`repository` 字段指回本仓库，市场自动关联）。
**发布走 GitHub Actions**（`.github/workflows/publish.yml`，workflow_dispatch + 版本一致性门禁 +
断言无引擎）：

```sh
# 一次性：npmjs.com 生成 granular token（读写本包）→ gh secret set NPM_TOKEN --repo beyondgjc/dsh-agent-chat
gh workflow run publish.yml -f confirm=<package.json 版本>   # 如 0.2.27
```

坑（0.2.24~26 三连实录）：

- 本机 `npm publish` 会**假成功**：stage 成功、finalize 被本机透明代理吞掉（npm 照常打印
  `+ <pkg>@<version>`），但包从未落库（unpkg/jsdelivr 404）。**发布一律走 CI**
- 本机默认 registry 是 npmmirror（镜像不能发也不能官方登录）：任何 npm 命令查/发官方源
  必须显式 `--registry https://registry.npmjs.org`
- 核验**别信本机 GET**（代理缓存污染，cache-bust 也可能被无视）：用 unpkg / jsdelivr /
  npmmirror 等第三方视角，或 CI 日志
- **全新包名**的 registry 索引/CDN 传播有分钟级延迟：publish 成功后别急着下结论（0.2.24
  曾被误判为"被吞"，一小时后实为全部落库）
- 同版本重发撞上已 staged 的残留 → 409 "Cannot publish over previously staged version"：
  bump 新版本绕过；`0.0.0-stage` 占位哨兵是 staged 残留（无害，用带 2FA 的浏览器会话可删）
- peer 范围按 awesome 列表的 node-semver 元组警告补显式预发布分支（`^4.0.4 || >=4.0.5-alpha.0
  <4.0.6-0 || …`），否则会静默排除 harness 预发布构建

### 4.4 桌面版发布（产品侧，私有/内部分发）

```sh
cd super-agent-zcode
npm run desktop:dist     # electron-builder --win → apps/desktop/release/
```

### 4.5 源码推送

- `dsh-agent-chat`：`main` → origin，push 即触发 CI（typecheck + test + build）
- `super-agent-zcode`：`master`，remote 已配置但未设 upstream，按需手动 push 备份

### 4.6 发布检查单

1. 两仓库 working tree 干净；插件 `main` 与 origin 同步
2. 引擎/编排有变更 → bump `package.json` version → `npm run build`（同步引擎 bundle 与 public/）→ `npm run pack:artifact`
3. `npm run deploy` 本机全绿 → 重启 DSH 实测（§3.4 清单）
4. `npm run publish-engine` → 等传播延迟 → curl 校验 manifest（npm 版本与 artifact 必须成对）
5. `git push`；npm 发布走 `gh workflow run publish.yml -f confirm=<版本>`（需 NPM_TOKEN secret）→
   unpkg/jsdelivr 视角核验落库
6. CI 绿 + npm latest 指向新版本即收工

## 5. 故障排查

| 症状 | 处置 |
|---|---|
| 「启动时没能加载」/插件半死 | profile 缺 chunk 或硬链接断裂 → `npm run deploy`（自动重链接 + 清孤儿） |
| 版本徽标显示 vdev | `package.json` 没同步进 profile（deploy 会补）；或在验证发布形态时忘了 `--no-engine` |
| 面板白屏/连接失败 | 看 `/setup/status`；校验 portfile（JSON，pid 存活才采信）；引擎死亡时面板自动退避重连 1s→15s |
| 升级后仍是旧行为 | 旧引擎实例存活钉死 → portfile 带版本，版本守卫应自动换新；仍钉死则手动结束旧引擎进程再重启 DSH |
| 拉人报"适配器未安装" | `npm run agents:install`（产品仓），或确认 `%LOCALAPPDATA%\SuperAgent\apps` 下有对应 kind |
| 首启下载 404 | 刚发布的传播延迟（等几分钟）；或 npm 版本与 Release tag 不齐（npm 版本与 artifact 必须成对发布） |
| npm publish 假成功（unpkg 404） | 本机透明代理吞 finalize——发布一律走 CI（§4.3）；本机 GET 验证不可信 |
| 引擎拉起弹黑窗 | 引擎必须用 DSH runtimes 的控制台子系统 node（windowsHide）；检查 `dshNodeExe()` 是否命中 |
| 引擎进程归属 | 引擎随 DSH 生命周期回收，独立子进程（崩溃不连坐）；与桌面版/CLI 经 portfile pid 互斥共存 |

Windows 开发陷阱：

- 探活别用 Python `os.kill(pid, 0)`——Windows 上等于 TerminateProcess；用 PowerShell 或 Node
- bash 工具层吃 `\\`：Windows 路径在生成的代码/命令里写正斜杠

## 附录：关键路径速查

| 路径 | 用途 |
|---|---|
| `~/.dsh/profiles/desktop/node_modules/dsh-agent-chat` | 插件部署位（deploy 硬链接终点） |
| `~/.dsh/cache/dsh-agent-chat/<version>/` | 首启下载缓存（`DSH_AGENT_CHAT_CACHE` 覆盖） |
| `~/.dsh/dsh-runtimes/*/dependencies/node/bin/node.exe` | 引擎拉起用 node（`dshNodeExe()`） |
| `%USERPROFILE%\Documents\SuperAgent` | 数据目录（`SUPER_AGENT_DATA_DIR` 覆盖） |
| `<数据目录>/workbench.port` | portfile（JSON port/pid/version/startedAt） |
| `%LOCALAPPDATA%\SuperAgent\apps` | 适配器安装根（`agents:install` 写入处） |
| `~/.dsh/skills/agent-chat/SKILL.md` | agent-chat skill 同步目标 |
