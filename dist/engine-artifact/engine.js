import { createRequire } from 'node:module';const require = createRequire(import.meta.url);
var __defProp = Object.defineProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};

// ../../super-agent-zcode/packages/workbench/src/engine-entry.ts
import * as fs7 from "node:fs";
import * as path11 from "node:path";

// ../../super-agent-zcode/packages/shared/src/ids.ts
import { randomUUID } from "node:crypto";
function newId(prefix) {
  return `${prefix}_${randomUUID()}`;
}

// ../../super-agent-zcode/packages/shared/src/attempt.ts
var TERMINAL_STATUSES = [
  "succeeded",
  "cancelled_confirmed",
  "failed",
  "unknown",
  "needs_review"
];
function isTerminalStatus(status) {
  return TERMINAL_STATUSES.includes(status);
}

// ../../super-agent-zcode/packages/shared/src/persistence.ts
import { promises as fs } from "node:fs";
import * as path from "node:path";
async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}
var tmpSeq = 0;
async function writeJsonAtomic(filePath, value, retries = 3) {
  await ensureDir(path.dirname(filePath));
  const tmp = `${filePath}.${process.pid}.${Date.now()}.${++tmpSeq}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(tmp, filePath);
      return;
    } catch (err) {
      const code = err?.code;
      if (attempt >= retries || code !== "EPERM" && code !== "EACCES") {
        await fs.rm(tmp, { force: true }).catch(() => {
        });
        throw err;
      }
      await new Promise((r) => setTimeout(r, 20 * (attempt + 1)));
    }
  }
}
async function readJson(filePath) {
  let raw;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if (err?.code === "ENOENT") return null;
    throw err;
  }
  return JSON.parse(raw);
}
var JsonlLog = class {
  constructor(filePath) {
    this.filePath = filePath;
  }
  filePath;
  chain = Promise.resolve();
  append(entry) {
    this.chain = this.chain.then(async () => {
      await ensureDir(path.dirname(this.filePath));
      await fs.appendFile(this.filePath, `${JSON.stringify(entry)}
`, "utf8");
    });
    this.chain = this.chain.catch(() => {
    });
  }
  /** 等待全部追加完成（测试与关停时使用） */
  flush() {
    return this.chain;
  }
};
var ByteLog = class {
  constructor(filePath) {
    this.filePath = filePath;
  }
  filePath;
  chain = Promise.resolve();
  append(data) {
    this.chain = this.chain.then(async () => {
      await ensureDir(path.dirname(this.filePath));
      await fs.appendFile(this.filePath, data);
    });
    this.chain = this.chain.catch(() => {
    });
  }
  flush() {
    return this.chain;
  }
};

// ../../super-agent-zcode/packages/shared/src/dataDir.ts
import * as os from "node:os";
import * as path2 from "node:path";
function defaultDataDir() {
  return path2.join(os.homedir(), "Documents", "SuperAgent");
}
function resolveDataDir() {
  const override = process.env.SUPER_AGENT_DATA_DIR?.trim();
  return override ? path2.resolve(override) : defaultDataDir();
}

// ../../super-agent-zcode/packages/workbench/src/server.ts
import { spawn as spawn2 } from "node:child_process";
import { createServer } from "node:http";
import * as fs6 from "node:fs/promises";
import * as path10 from "node:path";

// ../../super-agent-zcode/packages/orchestrator/src/budget.ts
var SYNTHESIS_RESERVE = 1;
var BudgetExhaustedError = class extends Error {
  constructor(phase, normalTotal, used, kind = "normal") {
    super(
      kind === "fix" ? `\u4FEE\u590D\u989D\u5EA6\u4E0D\u8DB3\uFF08${phase} \u9636\u6BB5\u91CD\u8BD5\u9700 1 \u6B21\uFF09\uFF1A\u5DF2\u7528 ${used}/${normalTotal}\uFF1B\u662F\u5426\u91CD\u8BD5\u7531\u7528\u6237\u51B3\u5B9A\uFF08\xA79.5\uFF09` : `\u9884\u7B97\u4E0D\u8DB3\uFF08${phase} \u9636\u6BB5\u9700 1 \u6B21\uFF09\uFF1A\u6B63\u5E38\u989D\u5EA6 ${used}/${normalTotal}\uFF0C\u4E14\u987B\u4FDD\u7559\u7EFC\u5408 1 \u6B21\uFF1B\u8FFD\u52A0\u9700\u7528\u6237\u786E\u8BA4\uFF08BUD-08\uFF09`
    );
    this.phase = phase;
    this.normalTotal = normalTotal;
    this.used = used;
    this.kind = kind;
    this.name = "BudgetExhaustedError";
  }
  phase;
  normalTotal;
  used;
  kind;
};
var Budget = class {
  constructor(disc) {
    this.disc = disc;
  }
  disc;
  get used() {
    return this.disc.budget.entries.length;
  }
  get usedNormal() {
    return this.disc.budget.entries.filter((e) => e.kind === "normal").length;
  }
  get usedFix() {
    return this.disc.budget.entries.filter((e) => e.kind === "fix").length;
  }
  /** BUD-08 用户追加额度（D-26 后仅人主动继续时授权）；extraTotal 未设置视为 0 */
  get extraTotal() {
    return this.disc.budget.extraTotal ?? 0;
  }
  get usedExtra() {
    return this.disc.budget.entries.filter((e) => e.kind === "extra").length;
  }
  /** 追加池剩余可提交次数 */
  get extraRemaining() {
    return Math.max(0, this.extraTotal - this.usedExtra);
  }
  get voided() {
    return this.disc.budget.voidedEntries?.length ?? 0;
  }
  /** 综合完成前各阶段可用的提交次数（综合使用保留额度后可为 0，不显示负数） */
  get remainingForPhases() {
    return Math.max(0, this.disc.budget.normalTotal - SYNTHESIS_RESERVE - this.usedNormal);
  }
  /** P1 多轮：下一轮需要 cost 次正常额度（不动用综合保留） */
  allowsRoundCost(cost) {
    return this.disc.budget.normalTotal - SYNTHESIS_RESERVE - this.usedNormal >= cost;
  }
  canCommit(phase, kind = "normal") {
    if (kind === "extra") {
      return this.extraRemaining > 0;
    }
    if (kind === "fix") {
      return this.usedFix < this.disc.budget.fixTotal;
    }
    if (phase === "synthesis") {
      return this.disc.budget.normalTotal - this.usedNormal >= 1;
    }
    return this.disc.budget.normalTotal - SYNTHESIS_RESERVE - this.usedNormal >= 1;
  }
  /** 提交前先落账（NFR-02：先持久化再推进）；无额度则抛错，不静默放行 */
  commit(attemptId, phase, participantId, now, kind = "normal", round = 1) {
    if (!this.canCommit(phase, kind)) {
      throw new BudgetExhaustedError(
        phase,
        kind === "fix" ? this.disc.budget.fixTotal : this.disc.budget.normalTotal,
        kind === "fix" ? this.usedFix : this.usedNormal,
        kind
      );
    }
    const entry = {
      attemptId,
      phase,
      kind,
      participantId,
      round,
      committedAt: now()
    };
    this.disc.budget.entries.push(entry);
    return entry;
  }
  /**
   * 用户确认后作废幽灵账（有记账、无 attempt 记录）：从 entries 移出、不计额，
   * 保留在 voidedEntries 供审计。只由显式用户确认路径调用，不做静默退额。
   */
  voidEntry(attemptId, reason, now) {
    const idx = this.disc.budget.entries.findIndex((e) => e.attemptId === attemptId);
    if (idx < 0) return false;
    const [entry] = this.disc.budget.entries.splice(idx, 1);
    if (!entry) return false;
    this.disc.budget.voidedEntries ??= [];
    this.disc.budget.voidedEntries.push({
      ...entry,
      voidedAt: now(),
      voidedReason: reason,
      voidedBy: "user"
    });
    return true;
  }
};

// ../../super-agent-zcode/packages/orchestrator/src/finalize.ts
import * as fs4 from "node:fs/promises";
import * as path8 from "node:path";

// ../../super-agent-zcode/packages/orchestrator/src/discussion.ts
import * as fs3 from "node:fs/promises";
import * as path7 from "node:path";
import { mkdir as mkdir2 } from "node:fs/promises";

// ../../super-agent-zcode/packages/client/src/realAgents.ts
import * as os2 from "node:os";
import * as path3 from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
var clientDir = path3.dirname(fileURLToPath(import.meta.url));
var repoRoot = path3.resolve(clientDir, "..", "..", "..");
function agentsCwd() {
  return process.env.SUPER_AGENTS_CWD?.trim() || repoRoot;
}
function agentNodeExe() {
  return process.env.SUPER_NODE_EXE?.trim() || process.execPath;
}
function stage0AppsRoot() {
  return process.env.SUPER_STAGE0_APPS ?? path3.join(repoRoot, "stage0", "apps");
}
function stage0RootCandidates() {
  const roots = [];
  const envRoot = process.env.SUPER_STAGE0_APPS?.trim();
  if (envRoot) roots.push(envRoot);
  roots.push(path3.join(localAppDataRoot(), "SuperAgent", "apps"));
  roots.push(path3.join(repoRoot, "stage0", "apps"));
  return [...new Set(roots)];
}
function resolveStage0Entry(appDir, ...rel) {
  const candidates = stage0RootCandidates();
  for (const root of candidates) {
    const cand = path3.join(root, appDir, ...rel);
    if (existsSync(cand)) return cand;
  }
  const last = candidates[candidates.length - 1] ?? stage0AppsRoot();
  return path3.join(last, appDir, ...rel);
}
var REAL_AGENT_PACKAGES = {
  "codex-acp": {
    pkg: "@agentclientprotocol/codex-acp",
    version: "2.6.0",
    source: "LocalAppData/SuperAgent/apps/codex-acp \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF0C2026-11-09 \u5347\u7EA7 2.6.0 / Codex 0.166.0\uFF1Bstage0/apps \u4E3A\u7248\u672C\u6E90\uFF09",
    shape: "\u751F\u6001\u9002\u914D\u5668\uFF1A\u5E95\u5C42\u542F\u52A8 Codex App Server\uFF0C\u975E\u5382\u5546\u539F\u751F ACP\uFF08AC-41 \u5982\u5B9E\u6807\u6CE8\uFF09"
  },
  dsh: {
    pkg: "@deepseek-ai/dsh",
    version: "0.2.2-rc.1",
    source: "stage0/apps/dsh \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF09",
    shape: "\u5382\u5546\u5B98\u65B9\u539F\u751F ACP\uFF08DeepSeek Harness\uFF0C--profile acp\uFF09"
  },
  qoder: {
    pkg: "@qoder-ai/qodercli",
    version: "1.1.84",
    source: "stage0/apps/qoder \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF0C2026-11-07\uFF09",
    shape: "\u5382\u5546\u5B98\u65B9\u539F\u751F ACP\uFF08qoder --acp\uFF0Cstdio\uFF09\uFF1BWindows amd64 \u652F\u6301\u3001arm64 \u6682\u4E0D\u652F\u6301\uFF1BACP \u4E0E CLI \u5171\u7528\u767B\u5F55\uFF08qoder login \u6216 QODER_PERSONAL_ACCESS_TOKEN\uFF09"
  },
  "zcode-acp": {
    pkg: "zcode-acp-server",
    version: "0.82.1",
    source: "stage0/apps/zcode-acp \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF0C2026-11-07\uFF1B\u793E\u533A\u9002\u914D\u5668\uFF0CApache-2.0\uFF0Cwilliam0wang \u7EF4\u62A4\uFF09",
    shape: "\u793E\u533A\u9002\u914D\u5668\uFF1A\u6865\u63A5 zcode app-server --stdio\uFF0C\u975E\u5382\u5546\u539F\u751F\uFF08AC-41 \u5982\u5B9E\u6807\u6CE8\uFF09\uFF1B\u8981\u6C42\u672C\u673A ZCode CLI \u2265 0.16.0"
  },
  codebuddy: {
    pkg: "@tencent-ai/codebuddy-code",
    version: "2.180.0",
    source: "stage0/apps/codebuddy \u672C\u5730\u5B89\u88C5\uFF082026-11-07\uFF0C\u817E\u8BAF\u5B98\u65B9 npm\uFF09",
    shape: "\u5382\u5546\u5B98\u65B9\u539F\u751F ACP\uFF08codebuddy --acp\uFF09\uFF1B\u6CE8\u610F\uFF1Afs/terminal \u5DE5\u5177\u4EC5\u5728\u5BA2\u6237\u7AEF\u58F0\u660E\u80FD\u529B\u65F6\u624D\u4EE3\u7406\u2014\u2014\u672C\u4EA7\u54C1\u58F0\u660E\u4E3A\u7A7A\uFF08AGT-14\uFF09\uFF0C\u76F8\u5173\u5DE5\u5177\u5C06\u4E0D\u53EF\u7528"
  },
  "claude-code": {
    pkg: "@agentclientprotocol/claude-agent-acp",
    version: "0.104.1",
    source: "LocalAppData/SuperAgent/apps/claude-code \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF0C2026-11-11\uFF09",
    shape: "\u751F\u6001\u9002\u914D\u5668\uFF1A\u5B98\u65B9 ACP \u7EC4\u7EC7\u53D1\u5E03\uFF0C\u57FA\u4E8E Claude Agent SDK \u5C01\u88C5 Claude Code\uFF08AC-41 \u5982\u5B9E\u6807\u6CE8\uFF0C\u975E Anthropic \u5382\u5546\u539F\u751F\uFF09\uFF1B\u51ED\u636E=Claude \u8BA2\u9605/API\uFF08claude login\uFF09"
  },
  "gemini-cli": {
    pkg: "@google/gemini-cli",
    version: "0.67.0",
    source: "LocalAppData/SuperAgent/apps/gemini-cli \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF0C2026-11-11\uFF09",
    shape: "\u5382\u5546\u5B98\u65B9\u539F\u751F ACP\uFF08gemini --acp\uFF0CGoogle\uFF1BACP \u534F\u8BAE\u7684\u7B2C\u4E00\u4E2A agent\uFF09\uFF1B\u51ED\u636E=Google \u8D26\u53F7\u767B\u5F55\uFF08\u6709\u514D\u8D39\u989D\u5EA6\u5C42\uFF09"
  },
  "qwen-code": {
    pkg: "@qwen-code/qwen-code",
    version: "0.27.1",
    source: "LocalAppData/SuperAgent/apps/qwen-code \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF0C2026-11-11\uFF09",
    shape: "\u5382\u5546\u5B98\u65B9\u539F\u751F ACP\uFF08qwen --acp\uFF0CQwenLM\uFF0CGemini CLI \u884D\u751F\uFF09\uFF1B\u51ED\u636E=Qwen OAuth\uFF08\u6BCF\u65E5 2000 \u6B21\u514D\u8D39\u8BF7\u6C42\uFF09\u6216 API key"
  },
  "kimi-code": {
    pkg: "@moonshot-ai/kimi-code",
    version: "2.5.2",
    source: "LocalAppData/SuperAgent/apps/kimi-code \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF0C2026-11-11\uFF09",
    shape: "\u5382\u5546\u5B98\u65B9\u539F\u751F ACP\uFF08kimi acp \u5B50\u547D\u4EE4\uFF0CMoonshotAI \u65B0\u4E00\u4EE3 Kimi Code CLI\uFF1Bnpm \u4E0A\u88F8\u540D kimi-code \u4E3A\u7B2C\u4E09\u65B9\u5192\u540D\u5305\u5DF2\u907F\u5F00\uFF09\uFF1B\u51ED\u636E=kimi /login"
  },
  "copilot-cli": {
    pkg: "@github/copilot",
    version: "1.0.109",
    source: "LocalAppData/SuperAgent/apps/copilot-cli \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF0C2026-11-11\uFF09",
    shape: "\u5382\u5546\u5B98\u65B9\u539F\u751F ACP\uFF08copilot --acp\uFF0CGitHub \u516C\u6D4B\uFF09\uFF1B\u51ED\u636E=GitHub \u8D26\u53F7 + Copilot \u8BA2\u9605"
  },
  opencode: {
    pkg: "opencode-ai",
    version: "1.19.5",
    source: "LocalAppData/SuperAgent/apps/opencode \u672C\u5730\u7CBE\u786E\u5B89\u88C5\uFF08npm exact\uFF0C2026-11-11\uFF09",
    shape: "\u5382\u5546\u5B98\u65B9\u539F\u751F ACP\uFF08opencode acp \u5B50\u547D\u4EE4\uFF0Csst\uFF1Bbin \u4E3A\u539F\u751F exe + \u5E73\u53F0\u53EF\u9009\u4F9D\u8D56\uFF09\uFF1B\u51ED\u636E=\u6A21\u578B\u63D0\u4F9B\u5546 API key / opencode auth"
  }
};
function localAppDataRoot() {
  return process.env.LOCALAPPDATA ?? path3.join(os2.homedir(), "AppData", "Local");
}
function appsEntry(kind, rel) {
  if (rel.startsWith("*")) {
    const relPath2 = rel.slice(1);
    return path3.join(
      localAppDataRoot(),
      "SuperAgent",
      "apps",
      kind,
      "node_modules",
      relPath2
    );
  }
  const local = path3.join(
    localAppDataRoot(),
    "SuperAgent",
    "apps",
    kind,
    "node_modules",
    rel
  );
  if (existsSync(local)) return local;
  return resolveStage0Entry(kind, "node_modules", rel);
}
function codexAcpEntry() {
  if (process.env.SUPER_CODEX_ACP_ENTRY) return process.env.SUPER_CODEX_ACP_ENTRY;
  const local = path3.join(
    localAppDataRoot(),
    "SuperAgent",
    "apps",
    "codex-acp",
    "node_modules",
    "@agentclientprotocol",
    "codex-acp",
    "dist",
    "index.js"
  );
  if (existsSync(local)) return local;
  return resolveStage0Entry(
    "codex-acp",
    "node_modules",
    "@agentclientprotocol",
    "codex-acp",
    "dist",
    "index.js"
  );
}
function dshEntry() {
  return process.env.SUPER_DSH_ENTRY ?? resolveStage0Entry(
    "dsh",
    "node_modules",
    "@deepseek-ai",
    "dsh",
    "lib",
    "bin.js"
  );
}
function qoderLaunch() {
  if (process.env.SUPER_QODER_ENTRY) {
    return { command: agentNodeExe(), args: [process.env.SUPER_QODER_ENTRY, "--acp"] };
  }
  const nativeCli = path3.join(os2.homedir(), ".qoder", "bin", "qodercli", "qodercli.exe");
  if (existsSync(nativeCli)) {
    return { command: nativeCli, args: ["--acp"] };
  }
  return {
    command: agentNodeExe(),
    args: [
      resolveStage0Entry(
        "qoder",
        "node_modules",
        "@qoder-ai",
        "qodercli",
        "bundle",
        "qoder-npm-dispatcher.cjs"
      ),
      "--acp"
    ]
  };
}
function zcodeAcpEntry() {
  return process.env.SUPER_ZCODE_ACP_ENTRY ?? resolveStage0Entry("zcode-acp", "node_modules", "zcode-acp-server", "dist", "cli.js");
}
function bundledZcodeCjs() {
  const p = path3.join(
    process.env.LOCALAPPDATA ?? "",
    "Programs",
    "ZCode",
    "resources",
    "glm",
    "zcode.cjs"
  );
  return existsSync(p) ? p : null;
}
function codebuddyEntry() {
  return process.env.SUPER_CODEBUDDY_ENTRY ?? resolveStage0Entry("codebuddy", "node_modules", "@tencent-ai", "codebuddy-code", "bin", "codebuddy");
}
function codexAcpConfig(participantId, env = {}) {
  return {
    participantId,
    command: agentNodeExe(),
    args: [codexAcpEntry()],
    cwd: agentsCwd(),
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}
function dshAcpConfig(participantId, env = {}) {
  return {
    participantId,
    command: agentNodeExe(),
    args: [dshEntry(), "--profile", "acp"],
    cwd: agentsCwd(),
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}
function qoderConfig(participantId, env = {}) {
  const { command, args } = qoderLaunch();
  return {
    participantId,
    command,
    args,
    cwd: agentsCwd(),
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}
function zcodeAcpConfig(participantId, env = {}) {
  const zcodeBin = env.ZCODE_BIN ?? process.env.ZCODE_BIN ?? bundledZcodeCjs();
  if (!zcodeBin) {
    throw new Error(
      "\u672A\u627E\u5230 ZCode CLI\uFF1A\u8BF7\u8BBE\u7F6E ZCODE_BIN \u6307\u5411 zcode.cjs \u6216\u5B89\u88C5 ZCode \u684C\u9762\u5E94\u7528"
    );
  }
  return {
    participantId,
    command: agentNodeExe(),
    args: [zcodeAcpEntry()],
    cwd: agentsCwd(),
    env: {
      // 桌面壳下 command 可能是 electron.exe——按 Node 运行；CLI 的 node 忽略此变量
      ELECTRON_RUN_AS_NODE: "1",
      ZCODE_BIN: zcodeBin,
      ZCODE_NODE: process.env.ZCODE_NODE ?? agentNodeExe(),
      ...env
    }
  };
}
function codebuddyConfig(participantId, env = {}) {
  return {
    participantId,
    command: agentNodeExe(),
    args: [codebuddyEntry(), "--acp"],
    cwd: agentsCwd(),
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}
function claudeAcpConfig(participantId, env = {}) {
  return {
    participantId,
    command: agentNodeExe(),
    args: [appsEntry("claude-code", "@agentclientprotocol/claude-agent-acp/dist/index.js")],
    cwd: agentsCwd(),
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}
function geminiConfig(participantId, env = {}) {
  return {
    participantId,
    command: agentNodeExe(),
    args: [
      process.env.SUPER_GEMINI_ENTRY ?? appsEntry("gemini-cli", "@google/gemini-cli/bundle/gemini.js"),
      "--acp"
    ],
    cwd: agentsCwd(),
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}
function qwenConfig(participantId, env = {}) {
  return {
    participantId,
    command: agentNodeExe(),
    args: [
      process.env.SUPER_QWEN_ENTRY ?? appsEntry("qwen-code", "@qwen-code/qwen-code/cli-entry.js"),
      "--acp"
    ],
    cwd: agentsCwd(),
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}
function kimiConfig(participantId, env = {}) {
  return {
    participantId,
    command: agentNodeExe(),
    args: [
      process.env.SUPER_KIMI_ENTRY ?? appsEntry("kimi-code", "@moonshot-ai/kimi-code/dist/main.mjs"),
      "acp"
    ],
    cwd: agentsCwd(),
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}
function copilotConfig(participantId, env = {}) {
  return {
    participantId,
    command: agentNodeExe(),
    args: [
      process.env.SUPER_COPILOT_ENTRY ?? appsEntry("copilot-cli", "@github/copilot/npm-loader.js"),
      "--acp"
    ],
    cwd: agentsCwd(),
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}
function opencodeConfig(participantId, env = {}) {
  const dataHome = path3.join(localAppDataRoot(), "SuperAgent", "opencode-data");
  mkdirSync(dataHome, { recursive: true });
  return {
    participantId,
    command: process.env.SUPER_OPENCODE_ENTRY ?? appsEntry("opencode", "*opencode-ai/bin/opencode.exe"),
    args: ["acp"],
    cwd: agentsCwd(),
    env: { XDG_DATA_HOME: dataHome, ...env }
  };
}
function realAgentConfig(kind, participantId, env = {}) {
  switch (kind) {
    case "codex-acp":
      return codexAcpConfig(participantId, env);
    case "dsh":
      return dshAcpConfig(participantId, env);
    case "qoder":
      return qoderConfig(participantId, env);
    case "zcode-acp":
      return zcodeAcpConfig(participantId, env);
    case "codebuddy":
      return codebuddyConfig(participantId, env);
    case "claude-code":
      return claudeAcpConfig(participantId, env);
    case "gemini-cli":
      return geminiConfig(participantId, env);
    case "qwen-code":
      return qwenConfig(participantId, env);
    case "kimi-code":
      return kimiConfig(participantId, env);
    case "copilot-cli":
      return copilotConfig(participantId, env);
    case "opencode":
      return opencodeConfig(participantId, env);
    default:
      throw new Error(`\u672A\u77E5\u5E94\u7528\u7C7B\u578B\uFF1A${kind}`);
  }
}

// ../../super-agent-zcode/packages/client/src/agentConnection.ts
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { PassThrough } from "node:stream";
import { mkdir } from "node:fs/promises";
import * as path4 from "node:path";
import { Writable, Readable } from "node:stream";

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/v1/schema/index.js
var AGENT_METHODS = {
  initialize: "initialize",
  authenticate: "authenticate",
  session_new: "session/new",
  session_load: "session/load",
  session_set_mode: "session/set_mode",
  session_set_config_option: "session/set_config_option",
  session_prompt: "session/prompt",
  session_cancel: "session/cancel",
  session_list: "session/list",
  session_delete: "session/delete",
  session_resume: "session/resume",
  session_close: "session/close",
  logout: "logout"
};
var CLIENT_METHODS = {
  session_request_permission: "session/request_permission",
  session_update: "session/update",
  fs_write_text_file: "fs/write_text_file",
  fs_read_text_file: "fs/read_text_file",
  terminal_create: "terminal/create",
  terminal_output: "terminal/output",
  terminal_release: "terminal/release",
  terminal_wait_for_exit: "terminal/wait_for_exit",
  terminal_kill: "terminal/kill",
  elicitation_create: "elicitation/create",
  elicitation_complete: "elicitation/complete"
};
var PROTOCOL_METHODS = {
  cancel_request: "$/cancel_request"
};
var PROTOCOL_VERSION = 1;

// ../../super-agent-zcode/node_modules/zod/v4/core/util.js
var util_exports = {};
__export(util_exports, {
  BIGINT_FORMAT_RANGES: () => BIGINT_FORMAT_RANGES,
  CONSTANT_CATCH: () => CONSTANT_CATCH,
  Class: () => Class,
  NUMBER_FORMAT_RANGES: () => NUMBER_FORMAT_RANGES,
  aborted: () => aborted,
  allowsEval: () => allowsEval,
  assert: () => assert,
  assertEqual: () => assertEqual,
  assertIs: () => assertIs,
  assertNever: () => assertNever,
  assertNotEqual: () => assertNotEqual,
  assignProp: () => assignProp,
  attachSchema: () => attachSchema,
  base64ToUint8Array: () => base64ToUint8Array,
  base64urlToUint8Array: () => base64urlToUint8Array,
  cached: () => cached,
  captureStackTrace: () => captureStackTrace,
  cleanEnum: () => cleanEnum,
  cleanRegex: () => cleanRegex,
  clone: () => clone,
  cloneDef: () => cloneDef,
  codePointLength: () => codePointLength,
  constantCatch: () => constantCatch,
  createTransparentProxy: () => createTransparentProxy,
  defineLazy: () => defineLazy,
  defineLazyInternal: () => defineLazyInternal,
  derived: () => derived,
  esc: () => esc,
  escapeRegex: () => escapeRegex,
  explicitlyAborted: () => explicitlyAborted,
  extend: () => extend,
  finalizeIssue: () => finalizeIssue,
  floatSafeRemainder: () => floatSafeRemainder,
  getElementAtPath: () => getElementAtPath,
  getEnumValues: () => getEnumValues,
  getLengthableOrigin: () => getLengthableOrigin,
  getParsedType: () => getParsedType,
  getSizableOrigin: () => getSizableOrigin,
  hexToUint8Array: () => hexToUint8Array,
  hide: () => hide,
  installLazyProp: () => installLazyProp,
  isObject: () => isObject,
  isPlainObject: () => isPlainObject,
  issue: () => issue,
  joinValues: () => joinValues,
  jsonStringifyReplacer: () => jsonStringifyReplacer,
  members: () => members,
  merge: () => merge,
  mergeDefs: () => mergeDefs,
  normalizeParams: () => normalizeParams,
  nullish: () => nullish,
  numKeys: () => numKeys,
  objectClone: () => objectClone,
  omit: () => omit,
  optionalKeys: () => optionalKeys,
  own: () => own,
  parsedType: () => parsedType,
  partial: () => partial,
  pick: () => pick,
  prefixIssues: () => prefixIssues,
  primitiveTypes: () => primitiveTypes,
  promiseAllObject: () => promiseAllObject,
  propertyKeyTypes: () => propertyKeyTypes,
  randomString: () => randomString,
  rawShape: () => rawShape,
  required: () => required,
  safeExtend: () => safeExtend,
  shallowClone: () => shallowClone,
  sizeCaps: () => sizeCaps,
  slugify: () => slugify,
  stringifyPrimitive: () => stringifyPrimitive,
  toZod: () => toZod,
  uint8ArrayToBase64: () => uint8ArrayToBase64,
  uint8ArrayToBase64url: () => uint8ArrayToBase64url,
  uint8ArrayToHex: () => uint8ArrayToHex,
  unwrapMessage: () => unwrapMessage
});
function assertEqual(val) {
  return val;
}
function assertNotEqual(val) {
  return val;
}
function toZod() {
  return (schema) => schema;
}
function assertIs(_arg) {
}
function assertNever(_x) {
  throw new Error("Unexpected value in exhaustive check");
}
function assert(_) {
}
function getEnumValues(entries) {
  const numericValues = Object.values(entries).filter((v) => typeof v === "number");
  const values = Object.entries(entries).filter(([k, _]) => numericValues.indexOf(+k) === -1).map(([_, v]) => v);
  return values;
}
function joinValues(array2, separator = "|") {
  return array2.map((val) => stringifyPrimitive(val)).join(separator);
}
function jsonStringifyReplacer(_, value) {
  if (typeof value === "bigint")
    return value.toString();
  return value;
}
var Cached = class {
  constructor(getter) {
    this._getter = getter;
    this._value = void 0;
  }
  get value() {
    const getter = this._getter;
    if (getter !== void 0) {
      this._value = getter();
      this._getter = void 0;
    }
    return this._value;
  }
};
function cached(getter) {
  return new Cached(getter);
}
function nullish(input) {
  return input === null || input === void 0;
}
function cleanRegex(source) {
  const start = source.startsWith("^") ? 1 : 0;
  const end = source.endsWith("$") ? source.length - 1 : source.length;
  return source.slice(start, end);
}
function floatSafeRemainder(val, step) {
  const ratio = val / step;
  const roundedRatio = Math.round(ratio);
  const tolerance = 4 * Number.EPSILON * Math.max(Math.abs(ratio), 1);
  if (Math.abs(ratio - roundedRatio) < tolerance)
    return 0;
  return ratio - roundedRatio;
}
var EVALUATING = /* @__PURE__ */ Symbol("evaluating");
function defineLazy(object2, key, getter) {
  let value = void 0;
  Object.defineProperty(object2, key, {
    get() {
      if (value === EVALUATING) {
        return void 0;
      }
      if (value === void 0) {
        value = EVALUATING;
        value = getter();
      }
      return value;
    },
    set(v) {
      Object.defineProperty(object2, key, {
        value: v
        // configurable: true,
      });
    },
    configurable: true
  });
}
function objectClone(obj) {
  return Object.create(Object.getPrototypeOf(obj), Object.getOwnPropertyDescriptors(obj));
}
function assignProp(target, prop, value) {
  Object.defineProperty(target, prop, {
    value,
    writable: true,
    enumerable: true,
    configurable: true
  });
}
function rawShape(def) {
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  return desc?.get ? desc.get.raw : desc?.value;
}
function sourceShape(schema) {
  return rawShape(schema._zod.def) ?? schema._zod.def.shape;
}
function deferProp(target, key, getter) {
  Object.defineProperty(target, key, {
    get() {
      const value = getter();
      assignProp(this, key, value);
      return value;
    },
    enumerable: true,
    configurable: true
  });
}
function putProp(target, key, value) {
  if (key in target)
    assignProp(target, key, value);
  else
    target[key] = value;
}
function mirrorShape(target, source, keys, wrap) {
  const raw = sourceShape(source);
  for (const key of keys) {
    const desc = Object.getOwnPropertyDescriptor(raw, key);
    if (!desc.enumerable)
      continue;
    if (desc.get) {
      deferProp(target, key, () => {
        const value = source._zod.def.shape[key];
        return wrap ? wrap(value, key) : value;
      });
    } else
      putProp(target, key, wrap ? wrap(desc.value, key) : desc.value);
  }
}
function mirrorProps(target, source) {
  for (const key of Reflect.ownKeys(source)) {
    const desc = Object.getOwnPropertyDescriptor(source, key);
    if (!desc.enumerable)
      continue;
    if (desc.get)
      deferProp(target, key, () => source[key]);
    else
      putProp(target, key, desc.value);
  }
}
function mergeDefs(...defs) {
  const mergedDescriptors = {};
  for (const def of defs) {
    const descriptors = Object.getOwnPropertyDescriptors(def);
    Object.assign(mergedDescriptors, descriptors);
  }
  return Object.defineProperties({}, mergedDescriptors);
}
function cloneDef(schema) {
  return mergeDefs(schema._zod.def);
}
function getElementAtPath(obj, path12) {
  if (!path12)
    return obj;
  return path12.reduce((acc, key) => acc?.[key], obj);
}
function promiseAllObject(promisesObj) {
  const keys = Object.keys(promisesObj);
  const promises = keys.map((key) => promisesObj[key]);
  return Promise.all(promises).then((results) => {
    const resolvedObj = {};
    for (let i = 0; i < keys.length; i++) {
      resolvedObj[keys[i]] = results[i];
    }
    return resolvedObj;
  });
}
function randomString(length = 10) {
  const chars = "abcdefghijklmnopqrstuvwxyz";
  let str = "";
  for (let i = 0; i < length; i++) {
    str += chars[Math.floor(Math.random() * chars.length)];
  }
  return str;
}
function esc(str) {
  return JSON.stringify(str);
}
function slugify(input) {
  return input.toLowerCase().trim().replace(/[^\w\s-]/g, "").replace(/[\s_-]+/g, "-").replace(/^-+|-+$/g, "");
}
var captureStackTrace = "captureStackTrace" in Error ? Error.captureStackTrace : (..._args) => {
};
function isObject(data) {
  return typeof data === "object" && data !== null && !Array.isArray(data);
}
var allowsEval = /* @__PURE__ */ cached(() => {
  if (globalConfig.jitless) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator?.userAgent?.includes("Cloudflare")) {
    return false;
  }
  try {
    const F = Function;
    new F("");
    return true;
  } catch (_) {
    return false;
  }
});
function isPlainObject(o) {
  if (isObject(o) === false)
    return false;
  const ctor = o.constructor;
  if (ctor === void 0)
    return true;
  if (typeof ctor !== "function")
    return true;
  const prot = ctor.prototype;
  if (isObject(prot) === false)
    return false;
  if (Object.prototype.hasOwnProperty.call(prot, "isPrototypeOf") === false) {
    return false;
  }
  return true;
}
function shallowClone(o) {
  if (isPlainObject(o))
    return { ...o };
  if (Array.isArray(o))
    return [...o];
  if (o instanceof Map)
    return new Map(o);
  if (o instanceof Set)
    return new Set(o);
  return o;
}
function numKeys(data) {
  let keyCount = 0;
  for (const key in data) {
    if (Object.prototype.hasOwnProperty.call(data, key)) {
      keyCount++;
    }
  }
  return keyCount;
}
var getParsedType = (data) => {
  const t = typeof data;
  switch (t) {
    case "undefined":
      return "undefined";
    case "string":
      return "string";
    case "number":
      return Number.isNaN(data) ? "nan" : "number";
    case "boolean":
      return "boolean";
    case "function":
      return "function";
    case "bigint":
      return "bigint";
    case "symbol":
      return "symbol";
    case "object":
      if (Array.isArray(data)) {
        return "array";
      }
      if (data === null) {
        return "null";
      }
      if (data.then && typeof data.then === "function" && data.catch && typeof data.catch === "function") {
        return "promise";
      }
      if (typeof Map !== "undefined" && data instanceof Map) {
        return "map";
      }
      if (typeof Set !== "undefined" && data instanceof Set) {
        return "set";
      }
      if (typeof Date !== "undefined" && data instanceof Date) {
        return "date";
      }
      if (typeof File !== "undefined" && data instanceof File) {
        return "file";
      }
      return "object";
    default:
      throw new Error(`Unknown data type: ${t}`);
  }
};
var propertyKeyTypes = /* @__PURE__ */ new Set(["string", "number", "symbol"]);
var primitiveTypes = /* @__PURE__ */ new Set([
  "string",
  "number",
  "bigint",
  "boolean",
  "symbol",
  "undefined"
]);
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function clone(inst, def, params) {
  const cl = new inst._zod.constr(def ?? inst._zod.def);
  if (!def || params?.parent)
    cl._zod.parent = inst;
  return cl;
}
function normalizeParams(_params) {
  const params = _params;
  if (!params)
    return {};
  if (typeof params === "string")
    return { error: () => params };
  if (params?.message !== void 0) {
    if (params?.error !== void 0)
      throw new Error("Cannot specify both `message` and `error` params");
    params.error = params.message;
  }
  delete params.message;
  if (typeof params.error === "string")
    return { ...params, error: () => params.error };
  return params;
}
function createTransparentProxy(getter) {
  let target;
  return new Proxy({}, {
    get(_, prop, receiver) {
      target ?? (target = getter());
      return Reflect.get(target, prop, receiver);
    },
    set(_, prop, value, receiver) {
      target ?? (target = getter());
      return Reflect.set(target, prop, value, receiver);
    },
    has(_, prop) {
      target ?? (target = getter());
      return Reflect.has(target, prop);
    },
    deleteProperty(_, prop) {
      target ?? (target = getter());
      return Reflect.deleteProperty(target, prop);
    },
    ownKeys(_) {
      target ?? (target = getter());
      return Reflect.ownKeys(target);
    },
    getOwnPropertyDescriptor(_, prop) {
      target ?? (target = getter());
      return Reflect.getOwnPropertyDescriptor(target, prop);
    },
    defineProperty(_, prop, descriptor) {
      target ?? (target = getter());
      return Reflect.defineProperty(target, prop, descriptor);
    }
  });
}
function stringifyPrimitive(value) {
  if (typeof value === "bigint")
    return value.toString() + "n";
  if (typeof value === "string")
    return `"${value}"`;
  return `${value}`;
}
function optionalKeys(shape) {
  return Object.keys(shape).filter((k) => {
    return shape[k]._zod.optin !== void 0 && shape[k]._zod.optout === "optional";
  });
}
var NUMBER_FORMAT_RANGES = /* @__PURE__ */ (() => ({
  safeint: [Number.MIN_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
  int32: [-2147483648, 2147483647],
  uint32: [0, 4294967295],
  float32: [-34028234663852886e22, 34028234663852886e22],
  float64: [-Number.MAX_VALUE, Number.MAX_VALUE]
}))();
var BIGINT_FORMAT_RANGES = {
  int64: [/* @__PURE__ */ BigInt("-9223372036854775808"), /* @__PURE__ */ BigInt("9223372036854775807")],
  uint64: [/* @__PURE__ */ BigInt(0), /* @__PURE__ */ BigInt("18446744073709551615")]
};
function pick(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".pick() cannot be used on object schemas containing refinements");
  }
  const newShape = {};
  mirrorShape(newShape, schema, maskedKeys(schema, mask));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function maskedKeys(schema, mask) {
  const raw = sourceShape(schema);
  const keys = [];
  for (const key of Reflect.ownKeys(mask)) {
    if (!Object.getOwnPropertyDescriptor(raw, key)?.enumerable) {
      throw new Error(`Unrecognized key: "${String(key)}"`);
    }
    if (mask[key])
      keys.push(key);
  }
  return keys;
}
function omit(schema, mask) {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(".omit() cannot be used on object schemas containing refinements");
  }
  const omitted = new Set(maskedKeys(schema, mask));
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)).filter((key) => !omitted.has(key)));
  return clone(schema, mergeDefs(currDef, { shape: newShape, checks: [] }));
}
function extend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to extend: expected a plain object");
  }
  const checks = schema._zod.def.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    const existingShape = sourceShape(schema);
    for (const key of Reflect.ownKeys(shape)) {
      if (Object.getOwnPropertyDescriptor(existingShape, key) !== void 0) {
        throw new Error("Cannot overwrite keys on object schemas containing refinements. Use `.safeExtend()` instead.");
      }
    }
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function extended(schema, shape) {
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)));
  mirrorProps(newShape, shape);
  return newShape;
}
function safeExtend(schema, shape) {
  if (!isPlainObject(shape)) {
    throw new Error("Invalid input to safeExtend: expected a plain object");
  }
  return clone(schema, mergeDefs(schema._zod.def, { shape: extended(schema, shape) }));
}
function merge(a, b) {
  if (!b?._zod?.def) {
    throw new Error("Invalid input to merge: expected an object schema. To merge a plain shape, use `.extend()`.");
  }
  if (a._zod.def.checks?.length) {
    throw new Error(".merge() cannot be used on object schemas containing refinements. Use .safeExtend() instead.");
  }
  const newShape = {};
  mirrorShape(newShape, a, Reflect.ownKeys(sourceShape(a)));
  mirrorShape(newShape, b, Reflect.ownKeys(sourceShape(b)));
  const def = mergeDefs(a._zod.def, {
    shape: newShape,
    get catchall() {
      return b._zod.def.catchall;
    },
    checks: b._zod.def.checks ?? []
  });
  return clone(a, def);
}
function partial(Class2, schema, mask, name = "partial") {
  const currDef = schema._zod.def;
  const checks = currDef.checks;
  const hasChecks = checks && checks.length > 0;
  if (hasChecks) {
    throw new Error(`.${name}() cannot be used on object schemas containing refinements`);
  }
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), Class2 && ((value, key) => selected && !selected.has(key) ? value : new Class2({ type: "optional", innerType: value })));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape, checks: [] }));
}
function required(Class2, schema, mask) {
  const selected = mask ? new Set(maskedKeys(schema, mask)) : void 0;
  const newShape = {};
  mirrorShape(newShape, schema, Reflect.ownKeys(sourceShape(schema)), (value, key) => (
    // overwrite with non-optional
    selected && !selected.has(key) ? value : new Class2({ type: "nonoptional", innerType: value })
  ));
  return clone(schema, mergeDefs(schema._zod.def, { shape: newShape }));
}
function aborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue !== true) {
      return true;
    }
  }
  return false;
}
function explicitlyAborted(x, startIndex = 0) {
  if (x.aborted === true)
    return true;
  for (let i = startIndex; i < x.issues.length; i++) {
    if (x.issues[i]?.continue === false) {
      return true;
    }
  }
  return false;
}
function prefixIssues(path12, issues) {
  return issues.map((iss) => {
    var _a3;
    (_a3 = iss).path ?? (_a3.path = []);
    iss.path.unshift(path12);
    return iss;
  });
}
function unwrapMessage(message) {
  return typeof message === "string" ? message : message?.message;
}
function sizeCaps(defChecks) {
  const caps = [];
  for (const ch of defChecks ?? []) {
    const d = ch._zod.def;
    if (!/_(length|size)$|_equals$/.test(d.check))
      break;
    const max = d.maximum ?? d.length ?? d.size;
    if (max >= 0)
      caps.push([max, ch]);
  }
  return caps;
}
function attachSchema(issues, start, inst) {
  var _a3;
  for (let i = start; i < issues.length; i++) {
    (_a3 = issues[i]).schema ?? (_a3.schema = inst);
  }
}
function finalizeIssue(iss, ctx, config2) {
  var _a3;
  const traits = iss.inst?._zod?.traits;
  if (traits?.has("$ZodType")) {
    if (traits.has("$ZodCheck"))
      (_a3 = iss).schema ?? (_a3.schema = iss.inst);
    else
      iss.schema = iss.inst;
  }
  const schemaError = iss.schema !== iss.inst ? iss.schema?._zod.def?.error : void 0;
  const message = iss.message ? iss.message : unwrapMessage(iss.inst?._zod.def?.error?.(iss)) ?? unwrapMessage(schemaError?.(iss)) ?? unwrapMessage(ctx?.error?.(iss)) ?? unwrapMessage(config2.customError?.(iss)) ?? unwrapMessage(config2.localeError?.(iss)) ?? "Invalid input";
  const full = {};
  for (const k of Object.keys(iss)) {
    if (k === "inst" || k === "schema" || k === "continue" || k === "input" || k === "__proto__")
      continue;
    full[k] = iss[k];
  }
  full.path ?? (full.path = []);
  full.message = message;
  if (ctx?.reportInput) {
    full.input = iss.input;
  }
  return full;
}
function getSizableOrigin(input) {
  if (input instanceof Set)
    return "set";
  if (input instanceof Map)
    return "map";
  if (input instanceof File)
    return "file";
  return "unknown";
}
var highSurrogate = /[\uD800-\uDBFF]/;
function codePointLength(str) {
  const units = str.length;
  if (!highSurrogate.test(str))
    return units;
  let count = units;
  for (let i = 0; i < units - 1; i++) {
    if ((str.charCodeAt(i) & 64512) === 55296 && (str.charCodeAt(i + 1) & 64512) === 56320) {
      count--;
      i++;
    }
  }
  return count;
}
function getLengthableOrigin(input) {
  if (Array.isArray(input))
    return "array";
  if (typeof input === "string")
    return "string";
  return "unknown";
}
function parsedType(data) {
  const t = typeof data;
  switch (t) {
    case "number": {
      return Number.isNaN(data) ? "nan" : "number";
    }
    case "object": {
      if (data === null) {
        return "null";
      }
      if (Array.isArray(data)) {
        return "array";
      }
      const obj = data;
      if (obj && Object.getPrototypeOf(obj) !== Object.prototype && "constructor" in obj && obj.constructor) {
        return obj.constructor.name;
      }
    }
  }
  return t;
}
function issue(...args) {
  const [iss, input, inst] = args;
  if (typeof iss === "string") {
    return {
      message: iss,
      code: "custom",
      input,
      inst
    };
  }
  return { ...iss };
}
function cleanEnum(obj) {
  return Object.entries(obj).filter(([k, _]) => {
    return Number.isNaN(Number.parseInt(k, 10));
  }).map((el) => el[1]);
}
function base64ToUint8Array(base642) {
  const binaryString = atob(base642);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}
function uint8ArrayToBase64(bytes) {
  let binaryString = "";
  for (let i = 0; i < bytes.length; i++) {
    binaryString += String.fromCharCode(bytes[i]);
  }
  return btoa(binaryString);
}
function base64urlToUint8Array(base64url2) {
  const base642 = base64url2.replace(/-/g, "+").replace(/_/g, "/");
  const padding = "=".repeat((4 - base642.length % 4) % 4);
  return base64ToUint8Array(base642 + padding);
}
function uint8ArrayToBase64url(bytes) {
  return uint8ArrayToBase64(bytes).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
}
function hexToUint8Array(hex) {
  const cleanHex = hex.replace(/^0x/, "");
  if (cleanHex.length % 2 !== 0) {
    throw new Error("Invalid hex string length");
  }
  const bytes = new Uint8Array(cleanHex.length / 2);
  for (let i = 0; i < cleanHex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(cleanHex.slice(i, i + 2), 16);
  }
  return bytes;
}
function uint8ArrayToHex(bytes) {
  return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
}
var Class = class {
  constructor(..._args) {
  }
};
function members(proto, table) {
  for (const key in table) {
    const desc = Object.getOwnPropertyDescriptor(table, key);
    if (desc.get)
      Object.defineProperty(proto, key, { ...desc, enumerable: false });
    else
      defineBound(proto, key, desc.value);
  }
}
function own(inst, key, value, enumerable = true) {
  Object.defineProperty(inst, key, { configurable: true, writable: true, enumerable, value });
  return value;
}
function hide(inst, key, value) {
  return own(inst, key, value, false);
}
// @__NO_SIDE_EFFECTS__
function derived(computes, table) {
  for (const key in computes) {
    const compute = computes[key];
    Object.defineProperty(table, key, {
      configurable: true,
      enumerable: true,
      get() {
        return own(this, key, compute(this));
      },
      set(value) {
        own(this, key, value);
      }
    });
  }
  return table;
}
function defineBound(proto, key, fn) {
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      return this == null ? fn : own(this, key, fn.bind(this));
    },
    set(value) {
      own(this, key, value);
    }
  });
}
function claim(inst, sentinel) {
  const proto = Object.getPrototypeOf(inst);
  return sentinel in proto ? void 0 : proto;
}
var installing;
var broke = false;
var breaker = {
  configurable: true,
  get() {
    broke = true;
    return void 0;
  }
};
function defineLazyInternal(inst, key, compute) {
  const proto = Object.getPrototypeOf(inst._zod);
  if (key in proto && installing !== inst._zod) {
    installing = void 0;
    return;
  }
  installing = inst._zod;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      Object.defineProperty(this, key, breaker);
      const outer = broke;
      broke = false;
      try {
        const value = compute(this);
        if (broke)
          delete this[key];
        else
          Object.defineProperty(this, key, { configurable: true, writable: true, value });
        broke = broke || outer;
        return value;
      } catch (err) {
        delete this[key];
        broke = broke || outer;
        throw err;
      }
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, value });
    }
  });
}
function installLazyProp(inst, key, make, enumerable) {
  const proto = claim(inst, key);
  if (!proto)
    return;
  Object.defineProperty(proto, key, {
    configurable: true,
    get() {
      const desc = { configurable: true, writable: true, enumerable, value: void 0 };
      Object.defineProperty(this, key, desc);
      desc.value = make(this);
      Object.defineProperty(this, key, desc);
      return desc.value;
    },
    set(value) {
      Object.defineProperty(this, key, { configurable: true, writable: true, enumerable, value });
    }
  });
}
var CONSTANT_CATCH = "~constantCatch";
function constantCatch(value) {
  const fn = () => value;
  fn[CONSTANT_CATCH] = true;
  return fn;
}

// ../../super-agent-zcode/node_modules/zod/v4/core/core.js
var _a;
var NEVER = /* @__PURE__ */ Object.freeze({
  status: "aborted"
});
var _zodDesc = { value: void 0, enumerable: false };
var _E = "captureStackTrace" in Error ? Error : null;
function newError(Definition) {
  const E = _E;
  if (E) {
    const saved = E.stackTraceLimit;
    if (typeof saved === "number") {
      try {
        E.stackTraceLimit = 0;
      } catch {
        _E = null;
        return new Definition();
      }
      try {
        return new Definition();
      } finally {
        E.stackTraceLimit = saved;
      }
    }
  }
  return new Definition();
}
// @__NO_SIDE_EFFECTS__
function $constructor(name, initializer3, proto, params) {
  const zodProto = {};
  function Internals(def) {
    this.def = def;
    this.constr = _;
    this.traits = /* @__PURE__ */ new Set();
  }
  Internals.prototype = zodProto;
  const protoMembers = proto;
  const initialized = protoMembers && /* @__PURE__ */ new WeakSet();
  function init(inst, def) {
    if (!inst._zod) {
      _zodDesc.value = new Internals(def);
      try {
        Object.defineProperty(inst, "_zod", _zodDesc);
      } finally {
        _zodDesc.value = void 0;
      }
    } else if (inst._zod.traits.has(name)) {
      return;
    }
    inst._zod.traits.add(name);
    initializer3(inst, def);
    if (initialized) {
      const own2 = Object.getPrototypeOf(inst);
      const ctorProto = inst._zod.constr.prototype;
      let up = own2;
      while (up && up !== ctorProto)
        up = Object.getPrototypeOf(up);
      const target = up ?? own2;
      if (!initialized.has(target)) {
        initialized.add(target);
        members(target, protoMembers);
      }
    }
    const proto2 = _.prototype;
    for (const k in proto2) {
      if (!Object.prototype.hasOwnProperty.call(proto2, k))
        continue;
      if (!(k in inst)) {
        inst[k] = proto2[k].bind(inst);
      }
    }
  }
  const Parent = params?.Parent ?? Object;
  class Definition extends Parent {
  }
  Object.defineProperty(Definition, "name", { value: name });
  function _(def) {
    const inst = params?.Parent ? newError(Definition) : this;
    init(inst, def);
    const deferred = inst._zod.deferred;
    if (deferred) {
      for (const fn of deferred) {
        fn();
      }
      inst._zod.deferred = void 0;
    }
    const pp = globalThis.__zod_globalConfig?.postProcessor;
    if (pp)
      pp(inst);
    return inst;
  }
  Object.defineProperty(_, "init", { value: init });
  Object.defineProperty(_, Symbol.hasInstance, {
    value: (inst) => {
      if (params?.Parent && inst instanceof params.Parent)
        return true;
      return inst?._zod?.traits?.has(name);
    }
  });
  Object.defineProperty(_, "name", { value: name });
  return _;
}
var $ZodAsyncError = class extends Error {
  constructor() {
    super(`Encountered Promise during synchronous parse. Use .parseAsync() instead.`);
  }
};
var $ZodEncodeError = class extends Error {
  constructor(name) {
    super(`Encountered unidirectional transform during encode: ${name}`);
    this.name = "ZodEncodeError";
  }
};
(_a = globalThis).__zod_globalConfig ?? (_a.__zod_globalConfig = {});
var globalConfig = globalThis.__zod_globalConfig;
function config(newConfig) {
  if (newConfig)
    Object.assign(globalConfig, newConfig);
  return globalConfig;
}

// ../../super-agent-zcode/node_modules/zod/v4/core/errors.js
function _getMessage() {
  const internals = this._zod;
  internals.message ?? (internals.message = JSON.stringify(internals.def, jsonStringifyReplacer, 2));
  return internals.message;
}
function _setMessage(value) {
  this._zod.message = value;
}
var _messageDesc = {
  get: _getMessage,
  set: _setMessage,
  enumerable: true,
  configurable: true
};
var _issuesDesc = { value: void 0, enumerable: false };
var _installedToString = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
var initializer = (inst, def) => {
  inst.name = "$ZodError";
  _issuesDesc.value = def;
  Object.defineProperty(inst, "issues", _issuesDesc);
  _issuesDesc.value = void 0;
  Object.defineProperty(inst, "message", _messageDesc);
  const proto = Object.getPrototypeOf(inst);
  if (!_installedToString.has(proto)) {
    _installedToString.add(proto);
    Object.defineProperty(proto, "toString", {
      configurable: true,
      enumerable: false,
      get() {
        const value = () => this.message;
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
        return value;
      },
      set(value) {
        Object.defineProperty(this, "toString", { value, configurable: true, writable: true });
      }
    });
  }
};
var $ZodError = $constructor("$ZodError", initializer);
var $ZodRealError = $constructor("$ZodError", initializer, void 0, {
  Parent: Error
});
function node(obj, key, make) {
  if (!Object.prototype.hasOwnProperty.call(obj, key)) {
    if (key === "__proto__") {
      Object.defineProperty(obj, key, { value: make(), writable: true, enumerable: true, configurable: true });
    } else {
      obj[key] = make();
    }
  }
  return obj[key];
}
function flattenError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = {};
  const formErrors = [];
  for (const sub of error2.issues) {
    if (sub.path.length > 0) {
      node(fieldErrors, sub.path[0], () => []).push(mapper(sub));
    } else {
      formErrors.push(mapper(sub));
    }
  }
  return { formErrors, fieldErrors };
}
function formatError(error2, mapper = (issue2) => issue2.message) {
  const fieldErrors = { _errors: [] };
  const processError = (error3, path12 = []) => {
    for (const issue2 of error3.issues) {
      if (issue2.code === "invalid_union" && issue2.errors.length) {
        issue2.errors.map((issues) => processError({ issues }, [...path12, ...issue2.path]));
      } else if (issue2.code === "invalid_key") {
        processError({ issues: issue2.issues }, [...path12, ...issue2.path]);
      } else if (issue2.code === "invalid_element") {
        processError({ issues: issue2.issues }, [...path12, ...issue2.path]);
      } else {
        const fullpath = [...path12, ...issue2.path];
        if (fullpath.length === 0) {
          fieldErrors._errors.push(mapper(issue2));
        } else {
          let curr = fieldErrors;
          let i = 0;
          while (i < fullpath.length) {
            const el = fullpath[i];
            const terminal = i === fullpath.length - 1;
            if (el === "_errors") {
              if (terminal)
                curr._errors.push(mapper(issue2));
              i++;
              continue;
            }
            if (!Object.prototype.hasOwnProperty.call(curr, el)) {
              Object.defineProperty(curr, el, {
                value: { _errors: [] },
                enumerable: true,
                writable: true,
                configurable: true
              });
            }
            const node2 = curr[el];
            if (terminal) {
              node2._errors.push(mapper(issue2));
            }
            curr = node2;
            i++;
          }
        }
      }
    }
  };
  processError(error2);
  return fieldErrors;
}

// ../../super-agent-zcode/node_modules/zod/v4/core/parse.js
function finalizeParams(callee, params) {
  return { callee: params?.callee ?? callee, Err: params?.Err };
}
var _parse = (_Err) => {
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
    const result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise) {
      throw new $ZodAsyncError();
    }
    if (result.issues.length) {
      const e = new (_params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, _params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _parseAsync = (_Err) => {
  const fn = async (schema, value, _ctx, params) => {
    const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
    let result = schema._zod.run({ value, issues: [] }, ctx);
    if (result instanceof Promise)
      result = await result;
    if (result.issues.length) {
      const e = new (params?.Err ?? _Err)(result.issues.map((iss) => finalizeIssue(iss, ctx, config())));
      captureStackTrace(e, params?.callee ?? fn);
      throw e;
    }
    return result.value;
  };
  return fn;
};
var _safeParse = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: false } : { async: false };
  const result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
function failure(Err, issues, ctx) {
  let error2;
  return {
    success: false,
    get error() {
      if (!error2) {
        error2 = new Err(issues.map((iss) => finalizeIssue(iss, ctx, config())));
        issues = void 0;
        ctx = void 0;
      }
      return error2;
    },
    set error(e) {
      error2 = e;
      issues = void 0;
      ctx = void 0;
    }
  };
}
var _safeParseAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true } : { async: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length ? failure(_Err, result.issues, ctx) : { success: true, data: result.value };
};
var COMPILE_INVALID = /* @__PURE__ */ Symbol.for("zod.compile.invalid");
var COMPILE_FALLBACK = /* @__PURE__ */ Symbol.for("zod.compile.fallback");
var validate = ((schema, value, _ctx) => {
  const validator = schema._zod.bag.validator;
  if (validator !== void 0) {
    if (validator(value) !== COMPILE_INVALID)
      return true;
    if (validator.definite === true && _ctx === void 0)
      return false;
  }
  return validateFallback(schema, value, _ctx);
});
function validateFallback(schema, value, _ctx) {
  const ctx = _ctx ? { ..._ctx, async: false, abortEarly: true } : { async: false, abortEarly: true };
  const fallbackRun = schema._zod.bag.fallbackRun;
  let result;
  if (fallbackRun) {
    ctx[COMPILE_FALLBACK] = true;
    result = fallbackRun({ value, issues: [] }, ctx);
  } else {
    result = schema._zod.run({ value, issues: [] }, ctx);
  }
  if (result instanceof Promise) {
    throw new $ZodAsyncError();
  }
  return result.issues.length === 0;
}
var validateAsync = async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, async: true, abortEarly: true } : { async: true, abortEarly: true };
  let result = schema._zod.run({ value, issues: [] }, ctx);
  if (result instanceof Promise)
    result = await result;
  return result.issues.length === 0;
};
var _encode = (_Err) => {
  const parse2 = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return parse2(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decode = (_Err) => {
  const parse2 = _parse(_Err);
  const fn = (schema, value, _ctx, _params) => {
    return parse2(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _encodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
    return await parseAsync2(schema, value, ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _decodeAsync = (_Err) => {
  const parseAsync2 = _parseAsync(_Err);
  const fn = async (schema, value, _ctx, _params) => {
    return await parseAsync2(schema, value, _ctx, finalizeParams(fn, _params));
  };
  return fn;
};
var _safeEncode = (_Err) => (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParse(_Err)(schema, value, ctx);
};
var _safeDecode = (_Err) => (schema, value, _ctx) => {
  return _safeParse(_Err)(schema, value, _ctx);
};
var _safeEncodeAsync = (_Err) => async (schema, value, _ctx) => {
  const ctx = _ctx ? { ..._ctx, direction: "backward" } : { direction: "backward" };
  return _safeParseAsync(_Err)(schema, value, ctx);
};
var _safeDecodeAsync = (_Err) => async (schema, value, _ctx) => {
  return _safeParseAsync(_Err)(schema, value, _ctx);
};

// ../../super-agent-zcode/node_modules/zod/v4/core/regexes.js
var cuid = /^[cC][0-9a-z]{6,}$/;
var cuid2 = /^[0-9a-z]+$/;
var ulid = /^[0-7][0-9A-HJKMNP-TV-Za-hjkmnp-tv-z]{25}$/;
var xid = /^[0-9a-vA-V]{20}$/;
var ksuid = /^[A-Za-z0-9]{27}$/;
var nanoid = /^[a-zA-Z0-9_-]{21}$/;
function nanoidOfLength(length) {
  return new RegExp(`^[a-zA-Z0-9_-]{${length}}$`);
}
var duration = /^P(?:(\d+W)|(?!.*W)(?=\d|T\d)(\d+Y)?(\d+M)?(\d+D)?(T(?=\d)(\d+H)?(\d+M)?(\d+([.,]\d+)?S)?)?)$/;
var guid = /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})$/;
var uuid = (version2) => {
  if (!version2)
    return /^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$/;
  return new RegExp(`^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-${version2}[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12})$`);
};
var email = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
var _emoji = `^(?=[\\s\\S]*[\\p{Extended_Pictographic}\\p{Regional_Indicator}\\u20E3])[\\p{Extended_Pictographic}\\p{Emoji_Component}]+$`;
function emoji() {
  return new RegExp(_emoji, "u");
}
var ipv4 = /^(?:(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(?:25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])$/;
var ipv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))$/;
var cidrv4 = /^((25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\.){3}(25[0-5]|2[0-4][0-9]|1[0-9][0-9]|[1-9][0-9]|[0-9])\/([0-9]|[1-2][0-9]|3[0-2])$/;
var cidrv6 = /^(([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:))\/(12[0-8]|1[01][0-9]|[1-9]?[0-9])$/;
var base64 = /^$|^(?:[0-9a-zA-Z+/]{4})*(?:(?:[0-9a-zA-Z+/]{2}==)|(?:[0-9a-zA-Z+/]{3}=))?$/;
var base64url = /^(?:[A-Za-z0-9_-]{4})*(?:[A-Za-z0-9_-]{2,3})?$/;
var httpProtocol = /^https?$/;
var e164 = /^\+[1-9]\d{6,14}$/;
var dateSource = `(?:(?:\\d\\d[2468][048]|\\d\\d[13579][26]|\\d\\d0[48]|[02468][048]00|[13579][26]00)-02-29|\\d{4}-(?:(?:0[13578]|1[02])-(?:0[1-9]|[12]\\d|3[01])|(?:0[469]|11)-(?:0[1-9]|[12]\\d|30)|(?:02)-(?:0[1-9]|1\\d|2[0-8])))`;
function anchor(source) {
  return new RegExp(`^${source}$`);
}
var date = /* @__PURE__ */ anchor(dateSource);
function timeSource(args) {
  const hhmm = `(?:[01]\\d|2[0-3]):[0-5]\\d`;
  const regex = typeof args.precision === "number" ? args.precision === -1 ? `${hhmm}` : args.precision === 0 ? `${hhmm}:[0-5]\\d` : `${hhmm}:[0-5]\\d\\.\\d{${args.precision}}` : args.seconds ? `${hhmm}:[0-5]\\d(?:\\.\\d+)?` : `${hhmm}(?::[0-5]\\d(?:\\.\\d+)?)?`;
  return regex;
}
function time(args) {
  return new RegExp(`^${timeSource(args)}$`);
}
function datetime(args) {
  const opts2 = ["Z"];
  if (args.offset)
    opts2.push(`([+-](?:[01]\\d|2[0-3]):[0-5]\\d)`);
  const qualified = `${timeSource({ precision: args.precision, seconds: true })}(?:${opts2.join("|")})`;
  const timeRegex = args.local ? `${qualified}|${timeSource({ precision: args.precision })}` : qualified;
  return new RegExp(`^${dateSource}T(?:${timeRegex})$`);
}
var anyString = /^[\s\S]{0,}$/;
var integer = /^-?\d+$/;
var number = /^-?\d+(?:\.\d+)?$/;
var boolean = /^(?:true|false)$/i;
var lowercase = /^[^A-Z]*$/;
var uppercase = /^[^a-z]*$/;

// ../../super-agent-zcode/node_modules/zod/v4/core/checks.js
var $ZodCheck = /* @__PURE__ */ $constructor("$ZodCheck", (inst, def) => {
  var _a3;
  inst._zod ?? (inst._zod = {});
  inst._zod.def = def;
  (_a3 = inst._zod).onattach ?? (_a3.onattach = []);
});
var _whenHasLength = (payload) => {
  const val = payload.value;
  return !nullish(val) && val.length !== void 0;
};
var numericOriginMap = {
  number: "number",
  bigint: "bigint",
  object: "date"
};
var $ZodCheckLessThan = /* @__PURE__ */ $constructor("$ZodCheckLessThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value <= def.value : payload.value < def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_big",
      maximum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckGreaterThan = /* @__PURE__ */ $constructor("$ZodCheckGreaterThan", (inst, def) => {
  $ZodCheck.init(inst, def);
  const origin = numericOriginMap[typeof def.value];
  inst._zod.check = (payload) => {
    if (def.inclusive ? payload.value >= def.value : payload.value > def.value) {
      return;
    }
    payload.issues.push({
      origin: numericOriginMap[typeof payload.value] ?? origin,
      code: "too_small",
      minimum: typeof def.value === "object" ? def.value.getTime() : def.value,
      input: payload.value,
      inclusive: def.inclusive,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMultipleOf = /* @__PURE__ */ $constructor("$ZodCheckMultipleOf", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    if (typeof payload.value !== typeof def.value)
      throw new Error("Cannot mix number and bigint in multiple_of check.");
    const isMultiple = typeof payload.value === "bigint" ? (
      // `value % 0n` throws, and nothing is a multiple of zero — the number branch already fails this way via NaN
      def.value !== BigInt(0) && payload.value % def.value === BigInt(0)
    ) : floatSafeRemainder(payload.value, def.value) === 0;
    if (isMultiple)
      return;
    payload.issues.push({
      origin: typeof payload.value,
      code: "not_multiple_of",
      divisor: def.value,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckNumberFormat = /* @__PURE__ */ $constructor("$ZodCheckNumberFormat", (inst, def) => {
  $ZodCheck.init(inst, def);
  def.format = def.format || "float64";
  const isInt = def.format?.includes("int");
  const origin = isInt ? "int" : "number";
  const [minimum, maximum] = NUMBER_FORMAT_RANGES[def.format];
  inst._zod.check = (payload) => {
    const input = payload.value;
    if (isInt) {
      if (!Number.isInteger(input)) {
        payload.issues.push({
          expected: origin,
          format: def.format,
          code: "invalid_type",
          continue: false,
          input,
          inst
        });
        return;
      }
      if (!Number.isSafeInteger(input)) {
        if (input > 0) {
          payload.issues.push({
            input,
            code: "too_big",
            maximum: Number.MAX_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        } else {
          payload.issues.push({
            input,
            code: "too_small",
            minimum: Number.MIN_SAFE_INTEGER,
            note: "Integers must be within the safe integer range.",
            inst,
            origin,
            inclusive: true,
            continue: !def.abort
          });
        }
        return;
      }
    }
    if (input < minimum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_small",
        minimum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
    if (input > maximum) {
      payload.issues.push({
        origin: "number",
        input,
        code: "too_big",
        maximum,
        inclusive: true,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCheckMaxLength = /* @__PURE__ */ $constructor("$ZodCheckMaxLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units > def.maximum ? codePointLength(input) : units;
    if (length <= def.maximum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_big",
      maximum: def.maximum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckMinLength = /* @__PURE__ */ $constructor("$ZodCheckMinLength", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.minimum && units < def.minimum * 2 ? codePointLength(input) : units;
    if (length >= def.minimum)
      return;
    const origin = getLengthableOrigin(input);
    payload.issues.push({
      origin,
      code: "too_small",
      minimum: def.minimum,
      inclusive: true,
      input,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLengthEquals = /* @__PURE__ */ $constructor("$ZodCheckLengthEquals", (inst, def) => {
  var _a3;
  $ZodCheck.init(inst, def);
  (_a3 = inst._zod.def).when ?? (_a3.when = _whenHasLength);
  inst._zod.check = (payload) => {
    const input = payload.value;
    const units = input.length;
    const length = typeof input === "string" && units >= def.length && units <= def.length * 2 ? codePointLength(input) : units;
    if (length === def.length)
      return;
    const origin = getLengthableOrigin(input);
    const tooBig = length > def.length;
    payload.issues.push({
      origin,
      ...tooBig ? { code: "too_big", maximum: def.length } : { code: "too_small", minimum: def.length },
      inclusive: true,
      exact: true,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStringFormat = /* @__PURE__ */ $constructor("$ZodCheckStringFormat", (inst, def) => {
  var _a3, _b;
  $ZodCheck.init(inst, def);
  if (def.pattern)
    (_a3 = inst._zod).check ?? (_a3.check = (payload) => {
      def.pattern.lastIndex = 0;
      if (def.pattern.test(payload.value))
        return;
      payload.issues.push({
        origin: "string",
        code: "invalid_format",
        format: def.format,
        input: payload.value,
        ...def.pattern ? { pattern: def.pattern.toString() } : {},
        inst,
        continue: !def.abort
      });
    });
  else
    (_b = inst._zod).check ?? (_b.check = () => {
    });
});
var $ZodCheckRegex = /* @__PURE__ */ $constructor("$ZodCheckRegex", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    def.pattern.lastIndex = 0;
    if (def.pattern.test(payload.value))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "regex",
      input: payload.value,
      pattern: def.pattern.toString(),
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckLowerCase = /* @__PURE__ */ $constructor("$ZodCheckLowerCase", (inst, def) => {
  def.pattern ?? (def.pattern = lowercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckUpperCase = /* @__PURE__ */ $constructor("$ZodCheckUpperCase", (inst, def) => {
  def.pattern ?? (def.pattern = uppercase);
  $ZodCheckStringFormat.init(inst, def);
});
var $ZodCheckIncludes = /* @__PURE__ */ $constructor("$ZodCheckIncludes", (inst, def) => {
  $ZodCheck.init(inst, def);
  const escapedRegex = escapeRegex(def.includes);
  const pattern = new RegExp(typeof def.position === "number" ? `^.{${def.position},}${escapedRegex}` : escapedRegex);
  def.pattern = pattern;
  inst._zod.check = (payload) => {
    if (payload.value.includes(def.includes, def.position))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "includes",
      includes: def.includes,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckStartsWith = /* @__PURE__ */ $constructor("$ZodCheckStartsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`^${escapeRegex(def.prefix)}.*`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.startsWith(def.prefix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "starts_with",
      prefix: def.prefix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckEndsWith = /* @__PURE__ */ $constructor("$ZodCheckEndsWith", (inst, def) => {
  $ZodCheck.init(inst, def);
  const pattern = new RegExp(`.*${escapeRegex(def.suffix)}$`);
  def.pattern ?? (def.pattern = pattern);
  inst._zod.check = (payload) => {
    if (payload.value.endsWith(def.suffix))
      return;
    payload.issues.push({
      origin: "string",
      code: "invalid_format",
      format: "ends_with",
      suffix: def.suffix,
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodCheckOverwrite = /* @__PURE__ */ $constructor("$ZodCheckOverwrite", (inst, def) => {
  $ZodCheck.init(inst, def);
  inst._zod.check = (payload) => {
    payload.value = def.tx(payload.value);
  };
});

// ../../super-agent-zcode/node_modules/zod/v4/core/doc.js
var Doc = class {
  constructor(args = [], closed = {}) {
    this.content = [];
    this.indent = 0;
    this.args = args;
    this.closed = closed;
  }
  // the compiler catches a child's throw and keeps writing into this doc, so the indent has to unwind with it
  indented(fn) {
    this.indent += 1;
    try {
      fn(this);
    } finally {
      this.indent -= 1;
    }
  }
  write(arg) {
    if (typeof arg === "function") {
      arg(this, { execution: "sync" });
      arg(this, { execution: "async" });
      return;
    }
    const content = arg;
    const lines = content.split("\n").filter((x) => x);
    const minIndent = Math.min(...lines.map((x) => x.length - x.trimStart().length));
    const dedented = lines.map((x) => x.slice(minIndent)).map((x) => " ".repeat(this.indent * 2) + x);
    for (const line of dedented) {
      this.content.push(line);
    }
  }
  compile() {
    const F = Function;
    const content = this?.content ?? [``];
    const factory = new F(...Object.keys(this.closed), `return function (${this.args.join(", ")}) {
${content.join("\n")}
};`);
    return factory(...Object.values(this.closed));
  }
};

// ../../super-agent-zcode/node_modules/zod/v4/core/versions.js
var version = {
  major: 4,
  minor: 6,
  patch: 7
};

// ../../super-agent-zcode/node_modules/zod/v4/core/schemas.js
var $ZodType = /* @__PURE__ */ $constructor("$ZodType", (inst, def) => {
  var _a3;
  inst ?? (inst = {});
  inst._zod.def = def;
  inst._zod.bag = inst._zod.bag || {};
  inst._zod.version = version;
  const defChecks = inst._zod.def.checks;
  const checks = inst._zod.traits.has("$ZodCheck") ? [inst, ...defChecks ?? []] : defChecks?.length ? [...defChecks] : [];
  for (const ch of checks) {
    for (const fn of ch._zod.onattach) {
      fn(inst);
    }
  }
  if (checks.length === 0) {
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred?.push(() => {
      inst._zod.run = inst._zod.parse;
    });
  } else {
    const runChecks = (payload, checks2, ctx) => {
      if (payload.memo)
        return payload;
      let isAborted = aborted(payload);
      let asyncResult;
      for (const ch of checks2) {
        if (ch._zod.def.when) {
          if (explicitlyAborted(payload))
            continue;
          const shouldRun = ch._zod.def.when(payload);
          if (!shouldRun)
            continue;
        } else if (isAborted) {
          continue;
        }
        const currLen = payload.issues.length;
        const _ = ch._zod.check(payload);
        if (_ instanceof Promise && ctx?.async === false) {
          throw new $ZodAsyncError();
        }
        if (asyncResult || _ instanceof Promise) {
          asyncResult = (asyncResult ?? Promise.resolve()).then(async () => {
            await _;
            const nextLen = payload.issues.length;
            if (nextLen === currLen)
              return;
            attachSchema(payload.issues, currLen, inst);
            if (!isAborted)
              isAborted = aborted(payload, currLen);
          });
        } else {
          const nextLen = payload.issues.length;
          if (nextLen === currLen)
            continue;
          attachSchema(payload.issues, currLen, inst);
          if (!isAborted)
            isAborted = aborted(payload, currLen);
        }
      }
      if (asyncResult) {
        return asyncResult.then(() => {
          return payload;
        });
      }
      return payload;
    };
    const handleCanaryResult = (canary, payload, ctx) => {
      if (aborted(canary)) {
        canary.aborted = true;
        return canary;
      }
      const checkResult = runChecks(payload, checks, ctx);
      if (checkResult instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return checkResult.then((checkResult2) => inst._zod.parse(checkResult2, ctx));
      }
      return inst._zod.parse(checkResult, ctx);
    };
    inst._zod.run = (payload, ctx) => {
      if (ctx.skipChecks) {
        return inst._zod.parse(payload, ctx);
      }
      if (ctx.direction === "backward") {
        const canary = inst._zod.parse({ value: payload.value, issues: [] }, { ...ctx, skipChecks: true });
        if (canary instanceof Promise) {
          return canary.then((canary2) => {
            return handleCanaryResult(canary2, payload, ctx);
          });
        }
        return handleCanaryResult(canary, payload, ctx);
      }
      const result = inst._zod.parse(payload, ctx);
      if (result instanceof Promise) {
        if (ctx.async === false)
          throw new $ZodAsyncError();
        return result.then((result2) => runChecks(result2, checks, ctx));
      }
      return runChecks(result, checks, ctx);
    };
  }
}, {
  // Wrappers extend this by installing a richer factory over it; reading it eagerly would defeat the laziness.
  get "~standard"() {
    return hide(this, "~standard", standardProps(this));
  },
  set "~standard"(value) {
    own(this, "~standard", value);
  }
});
var toStandardResult = (r, ctx) => r.issues.length ? { issues: r.issues.map((iss) => finalizeIssue(iss, ctx, config())) } : { value: r.value };
async function validateAsync2(inst, value) {
  const ctx = { async: true };
  return toStandardResult(await inst._zod.run({ value, issues: [] }, ctx), ctx);
}
function standardProps(inst) {
  return {
    validate: (value) => {
      const ctx = { async: false };
      try {
        const r = inst._zod.run({ value, issues: [] }, ctx);
        if (!(r instanceof Promise))
          return toStandardResult(r, ctx);
      } catch (_) {
      }
      return validateAsync2(inst, value);
    },
    vendor: "zod",
    version: 1
  };
}
var $ZodString = /* @__PURE__ */ $constructor("$ZodString", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = def.pattern ?? anyString;
  inst._zod.parse = (payload, _) => {
    if (def.coerce)
      try {
        payload.value = String(payload.value);
      } catch (_2) {
      }
    if (typeof payload.value === "string")
      return payload;
    payload.issues.push({
      expected: "string",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
var $ZodStringFormat = /* @__PURE__ */ $constructor("$ZodStringFormat", (inst, def) => {
  $ZodCheckStringFormat.init(inst, def);
  $ZodString.init(inst, def);
});
var $ZodGUID = /* @__PURE__ */ $constructor("$ZodGUID", (inst, def) => {
  def.pattern ?? (def.pattern = guid);
  $ZodStringFormat.init(inst, def);
});
var $ZodUUID = /* @__PURE__ */ $constructor("$ZodUUID", (inst, def) => {
  if (def.version) {
    const versionMap = {
      v1: 1,
      v2: 2,
      v3: 3,
      v4: 4,
      v5: 5,
      v6: 6,
      v7: 7,
      v8: 8
    };
    const v = versionMap[def.version];
    if (v === void 0)
      throw new Error(`Invalid UUID version: "${def.version}"`);
    def.pattern ?? (def.pattern = uuid(v));
  } else
    def.pattern ?? (def.pattern = uuid());
  $ZodStringFormat.init(inst, def);
});
var $ZodEmail = /* @__PURE__ */ $constructor("$ZodEmail", (inst, def) => {
  def.pattern ?? (def.pattern = email);
  $ZodStringFormat.init(inst, def);
});
var URL_BAD_FORMAT = 1;
var URL_UNPARSEABLE = 2;
function canParseURL(input) {
  try {
    if (typeof URL !== "undefined" && typeof URL.canParse === "function")
      return URL.canParse(input);
    new URL(input);
    return true;
  } catch {
    return false;
  }
}
function validateURL(trimmed, def) {
  if (!("normalize" in def) && !("hostname" in def) && !("protocol" in def)) {
    return canParseURL(trimmed) || URL_UNPARSEABLE;
  }
  return parseURLObject(trimmed, def);
}
function parseURLObject(trimmed, def) {
  if (!def.normalize && def.protocol?.source === httpProtocol.source && !/^https?:\/\//i.test(trimmed)) {
    return URL_BAD_FORMAT;
  }
  try {
    if (typeof URL !== "undefined") {
      const URLStatic = URL;
      if (typeof URLStatic.parse === "function")
        return URLStatic.parse(trimmed) ?? URL_UNPARSEABLE;
    }
    return new URL(trimmed);
  } catch {
    return URL_UNPARSEABLE;
  }
}
var asciiTabOrNewline = /[\t\n\r]/g;
function stripTabAndNewline(value) {
  return value.replace(asciiTabOrNewline, "");
}
function urlHostnameOk(url2, hostname) {
  hostname.lastIndex = 0;
  return hostname.test(url2.hostname);
}
function urlProtocolOk(url2, protocol) {
  protocol.lastIndex = 0;
  return protocol.test(url2.protocol.endsWith(":") ? url2.protocol.slice(0, -1) : url2.protocol);
}
var $ZodURL = /* @__PURE__ */ $constructor("$ZodURL", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    try {
      const trimmed = payload.value.trim();
      const url2 = validateURL(trimmed, def);
      if (url2 === URL_BAD_FORMAT) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid URL format",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url2 === URL_UNPARSEABLE) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          input: payload.value,
          inst,
          continue: !def.abort
        });
        return;
      }
      if (url2 === true) {
        payload.value = stripTabAndNewline(trimmed);
        return;
      }
      if (def.hostname && !urlHostnameOk(url2, def.hostname)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid hostname",
          pattern: def.hostname.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      if (def.protocol && !urlProtocolOk(url2, def.protocol)) {
        payload.issues.push({
          code: "invalid_format",
          format: "url",
          note: "Invalid protocol",
          pattern: def.protocol.source,
          input: payload.value,
          inst,
          continue: !def.abort
        });
      }
      payload.value = def.normalize ? url2.href : stripTabAndNewline(trimmed);
      return;
    } catch (_) {
      payload.issues.push({
        code: "invalid_format",
        format: "url",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodEmoji = /* @__PURE__ */ $constructor("$ZodEmoji", (inst, def) => {
  def.pattern ?? (def.pattern = emoji());
  $ZodStringFormat.init(inst, def);
});
var $ZodNanoID = /* @__PURE__ */ $constructor("$ZodNanoID", (inst, def) => {
  if (def.length !== void 0 && (!Number.isInteger(def.length) || def.length < 1))
    throw new Error(`Invalid nanoid length: ${def.length}`);
  def.pattern ?? (def.pattern = def.length === void 0 ? nanoid : nanoidOfLength(def.length));
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID = /* @__PURE__ */ $constructor("$ZodCUID", (inst, def) => {
  def.pattern ?? (def.pattern = cuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodCUID2 = /* @__PURE__ */ $constructor("$ZodCUID2", (inst, def) => {
  def.pattern ?? (def.pattern = cuid2);
  $ZodStringFormat.init(inst, def);
});
var $ZodULID = /* @__PURE__ */ $constructor("$ZodULID", (inst, def) => {
  def.pattern ?? (def.pattern = ulid);
  $ZodStringFormat.init(inst, def);
});
var $ZodXID = /* @__PURE__ */ $constructor("$ZodXID", (inst, def) => {
  def.pattern ?? (def.pattern = xid);
  $ZodStringFormat.init(inst, def);
});
var $ZodKSUID = /* @__PURE__ */ $constructor("$ZodKSUID", (inst, def) => {
  def.pattern ?? (def.pattern = ksuid);
  $ZodStringFormat.init(inst, def);
});
var $ZodISODateTime = /* @__PURE__ */ $constructor("$ZodISODateTime", (inst, def) => {
  def.pattern ?? (def.pattern = datetime(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODate = /* @__PURE__ */ $constructor("$ZodISODate", (inst, def) => {
  def.pattern ?? (def.pattern = date);
  $ZodStringFormat.init(inst, def);
});
var $ZodISOTime = /* @__PURE__ */ $constructor("$ZodISOTime", (inst, def) => {
  def.pattern ?? (def.pattern = time(def));
  $ZodStringFormat.init(inst, def);
});
var $ZodISODuration = /* @__PURE__ */ $constructor("$ZodISODuration", (inst, def) => {
  def.pattern ?? (def.pattern = duration);
  $ZodStringFormat.init(inst, def);
});
var $ZodIPv4 = /* @__PURE__ */ $constructor("$ZodIPv4", (inst, def) => {
  def.pattern ?? (def.pattern = ipv4);
  $ZodStringFormat.init(inst, def);
});
var ipv6Alphabet = /^[0-9a-fA-F:.]+$/;
function isValidIPv6(value) {
  if (!ipv6Alphabet.test(value))
    return false;
  return canParseURL(`http://[${value}]`);
}
var $ZodIPv6 = /* @__PURE__ */ $constructor("$ZodIPv6", (inst, def) => {
  def.pattern ?? (def.pattern = ipv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidIPv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "ipv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
var $ZodCIDRv4 = /* @__PURE__ */ $constructor("$ZodCIDRv4", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv4);
  $ZodStringFormat.init(inst, def);
});
function isValidCIDRv6(value) {
  const parts = value.split("/");
  if (parts.length !== 2)
    return false;
  const [address, prefix] = parts;
  if (!prefix)
    return false;
  const prefixNum = Number(prefix);
  if (`${prefixNum}` !== prefix)
    return false;
  if (prefixNum < 0 || prefixNum > 128)
    return false;
  return isValidIPv6(address);
}
var $ZodCIDRv6 = /* @__PURE__ */ $constructor("$ZodCIDRv6", (inst, def) => {
  def.pattern ?? (def.pattern = cidrv6);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (!isValidCIDRv6(payload.value)) {
      payload.issues.push({
        code: "invalid_format",
        format: "cidrv6",
        input: payload.value,
        inst,
        continue: !def.abort
      });
    }
  };
});
function isValidBase64(data) {
  if (data === "")
    return true;
  if (/\s/.test(data))
    return false;
  if (data.length % 4 !== 0)
    return false;
  try {
    atob(data);
    return true;
  } catch {
    return false;
  }
}
var base64Charset = /^[0-9a-zA-Z+/]*={0,2}$/;
var $ZodBase64 = /* @__PURE__ */ $constructor("$ZodBase64", (inst, def) => {
  def.pattern ?? (def.pattern = base64Charset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var base64urlCharset = /^[A-Za-z0-9_-]*$/;
function isValidBase64URL(data) {
  if (!base64urlCharset.test(data))
    return false;
  const base642 = data.replace(/[-_]/g, (c) => c === "-" ? "+" : "/");
  const padded = base642.padEnd(Math.ceil(base642.length / 4) * 4, "=");
  return isValidBase64(padded);
}
var $ZodBase64URL = /* @__PURE__ */ $constructor("$ZodBase64URL", (inst, def) => {
  def.pattern ?? (def.pattern = base64urlCharset);
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidBase64URL(payload.value))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "base64url",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodE164 = /* @__PURE__ */ $constructor("$ZodE164", (inst, def) => {
  def.pattern ?? (def.pattern = e164);
  $ZodStringFormat.init(inst, def);
});
function isValidJWT(token, algorithm = null) {
  try {
    const tokensParts = token.split(".");
    if (tokensParts.length !== 3)
      return false;
    const [header] = tokensParts;
    if (!header)
      return false;
    const parsedHeader = JSON.parse(atob(header));
    if ("typ" in parsedHeader && parsedHeader?.typ !== "JWT")
      return false;
    if (!parsedHeader.alg)
      return false;
    if (algorithm && (!("alg" in parsedHeader) || parsedHeader.alg !== algorithm))
      return false;
    return true;
  } catch {
    return false;
  }
}
var $ZodJWT = /* @__PURE__ */ $constructor("$ZodJWT", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  inst._zod.check = (payload) => {
    if (isValidJWT(payload.value, def.alg))
      return;
    payload.issues.push({
      code: "invalid_format",
      format: "jwt",
      input: payload.value,
      inst,
      continue: !def.abort
    });
  };
});
var $ZodNumber = /* @__PURE__ */ $constructor("$ZodNumber", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = number;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Number(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "number" && !Number.isNaN(input) && Number.isFinite(input)) {
      return payload;
    }
    const received = typeof input === "number" ? Number.isNaN(input) ? "NaN" : !Number.isFinite(input) ? String(input) : void 0 : void 0;
    payload.issues.push({
      expected: "number",
      code: "invalid_type",
      input,
      inst,
      ...received ? { received } : {}
    });
    return payload;
  };
});
var $ZodNumberFormat = /* @__PURE__ */ $constructor("$ZodNumberFormat", (inst, def) => {
  $ZodCheckNumberFormat.init(inst, def);
  $ZodNumber.init(inst, def);
});
var $ZodBoolean = /* @__PURE__ */ $constructor("$ZodBoolean", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.pattern = boolean;
  inst._zod.parse = (payload, _ctx) => {
    if (def.coerce)
      try {
        payload.value = Boolean(payload.value);
      } catch (_) {
      }
    const input = payload.value;
    if (typeof input === "boolean")
      return payload;
    payload.issues.push({
      expected: "boolean",
      code: "invalid_type",
      input,
      inst
    });
    return payload;
  };
});
var $ZodUnknown = /* @__PURE__ */ $constructor("$ZodUnknown", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload) => payload;
});
var $ZodNever = /* @__PURE__ */ $constructor("$ZodNever", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _ctx) => {
    payload.issues.push({
      expected: "never",
      code: "invalid_type",
      input: payload.value,
      inst
    });
    return payload;
  };
});
function capSize(inst, size) {
  const caps = sizeCaps(inst._zod.def.checks);
  if (!caps.length)
    return;
  const cap = Math.min(...caps.map((c) => c[0]));
  const parse2 = inst._zod.parse;
  inst._zod.parse = (payload, ctx) => {
    const n = size(payload.value);
    if (n > cap && !ctx?.skipChecks && ctx?.direction !== "backward") {
      for (const [max, ch] of sizeCaps(inst._zod.def.checks)) {
        if (n > max && ch._zod.def.when(payload)) {
          const start = payload.issues.length;
          ch._zod.check(payload);
          payload.issues[start].continue = false;
          attachSchema(payload.issues, start, inst);
          return payload;
        }
      }
    }
    return parse2(payload, ctx);
  };
}
var arraySize = (input) => Array.isArray(input) ? input.length : -1;
function handleArrayResult(result, final, index) {
  if (result.issues.length) {
    final.issues.push(...prefixIssues(index, result.issues));
  }
  final.value[index] = result.value;
}
var $ZodArray = /* @__PURE__ */ $constructor("$ZodArray", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!Array.isArray(input)) {
      payload.issues.push({
        expected: "array",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, Array(input.length), ctx) : Array(input.length);
    const proms = [];
    const abortEarly = ctx?.abortEarly;
    for (let i = 0; i < input.length; i++) {
      const item = input[i];
      const result = def.element._zod.run({
        value: item,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        proms.push(result.then((result2) => handleArrayResult(result2, payload, i)));
      } else {
        handleArrayResult(result, payload, i);
        if (abortEarly && result.issues.length !== 0 && aborted(result))
          break;
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
  capSize(inst, arraySize);
});
function handlePropertyResult(result, final, key, input, optin, optout) {
  const isPresent = key in input;
  const isOptionalOut = optout === "optional";
  if (!isPresent && isOptionalOut && optin === "optional") {
    return;
  }
  if (result.issues.length) {
    if (optin !== void 0 && isOptionalOut && !isPresent) {
      return;
    }
    final.issues.push(...prefixIssues(key, result.issues));
  }
  if (!isPresent && optin === void 0) {
    if (!result.issues.length) {
      final.issues.push({
        code: "invalid_type",
        expected: "nonoptional",
        input: void 0,
        path: [key]
      });
    }
    return;
  }
  if (result.value === void 0) {
    if (isPresent || optin === "defaulted" && !isOptionalOut) {
      final.value[key] = void 0;
    }
  } else {
    final.value[key] = result.value;
  }
}
var NO_SYMBOL_KEYS = [];
function normalizeDef(def) {
  const keys = Object.keys(def.shape);
  const ownSymbols = Object.getOwnPropertySymbols(def.shape);
  const symbolKeys = ownSymbols.length ? ownSymbols : NO_SYMBOL_KEYS;
  const allKeys = symbolKeys.length ? [...keys, ...symbolKeys] : keys;
  for (const k of allKeys) {
    if (!def.shape?.[k]?._zod?.traits?.has("$ZodType")) {
      throw new Error(`Invalid element at key "${String(k)}": expected a Zod schema`);
    }
  }
  const okeys = optionalKeys(def.shape);
  return {
    ...def,
    allKeys,
    symbolKeys,
    // string-only: handleCatchall matches it against `for...in`, which never yields a symbol
    keySet: new Set(keys),
    numKeys: keys.length,
    optionalKeys: new Set(okeys)
  };
}
function handleCatchall(proms, input, payload, ctx, def, inst, abortEarly) {
  const unrecognized = [];
  const keySet = def.keySet;
  const _catchall = def.catchall._zod;
  const t = _catchall.def.type;
  const optin = _catchall.optin;
  const optout = _catchall.optout;
  let seen = 0;
  for (const key in input) {
    if (abortEarly && payload.issues.length !== seen) {
      if (aborted(payload, seen))
        break;
      seen = payload.issues.length;
    }
    if (keySet.has(key))
      continue;
    if (key === "__proto__") {
      if (t === "never")
        unrecognized.push(key);
      continue;
    }
    if (t === "never") {
      unrecognized.push(key);
      continue;
    }
    const r = _catchall.run({ value: input[key], issues: [] }, ctx);
    if (r instanceof Promise) {
      proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
    } else {
      handlePropertyResult(r, payload, key, input, optin, optout);
    }
  }
  if (unrecognized.length) {
    payload.issues.push({
      code: "unrecognized_keys",
      keys: unrecognized,
      input,
      inst,
      // Describes the shape of the input, not the validity of the parsed value, so it never aborts. The parse still fails; the schema's own checks just get to run first, and an enclosing intersection can reconcile the key against a sibling operand.
      continue: true
    });
  }
  if (!proms.length)
    return payload;
  return Promise.all(proms).then(() => {
    return payload;
  });
}
var $ZodObject = /* @__PURE__ */ $constructor("$ZodObject", (inst, def) => {
  $ZodType.init(inst, def);
  const desc = Object.getOwnPropertyDescriptor(def, "shape");
  const sh = desc?.get ? desc.get.raw : def.shape ?? {};
  if (sh) {
    const get = () => {
      const newSh = { ...sh };
      Object.defineProperty(def, "shape", { value: newSh });
      get.raw = newSh;
      return newSh;
    };
    get.raw = sh;
    Object.defineProperty(def, "shape", { get });
  }
  const _normalized = cached(() => normalizeDef(def));
  defineLazyInternal(inst, "propValues", (zod) => {
    const shape = zod.def.shape;
    const propValues = {};
    for (const key in shape) {
      const field = shape[key]._zod;
      if (field.values) {
        if (!Object.prototype.hasOwnProperty.call(propValues, key)) {
          assignProp(propValues, key, /* @__PURE__ */ new Set());
        }
        for (const v of field.values)
          propValues[key].add(v);
        if (field.optin !== void 0)
          propValues[key].add(void 0);
      }
    }
    return propValues;
  });
  const isObject2 = isObject;
  const catchall = def.catchall;
  let value;
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
    const proms = [];
    const shape = value.shape;
    const abortEarly = ctx?.abortEarly;
    let seen = payload.issues.length;
    for (const key of value.allKeys) {
      if (abortEarly && payload.issues.length !== seen) {
        if (aborted(payload, seen))
          break;
        seen = payload.issues.length;
      }
      if (key === "__proto__")
        continue;
      const el = shape[key];
      const optin = el._zod.optin;
      const optout = el._zod.optout;
      const r = el._zod.run({ value: input[key], issues: [] }, ctx);
      if (r instanceof Promise) {
        proms.push(r.then((r2) => handlePropertyResult(r2, payload, key, input, optin, optout)));
      } else {
        handlePropertyResult(r, payload, key, input, optin, optout);
      }
    }
    if (!catchall) {
      return proms.length ? Promise.all(proms).then(() => payload) : payload;
    }
    return handleCatchall(proms, input, payload, ctx, _normalized.value, inst, abortEarly === true);
  };
});
var $ZodObjectJIT = /* @__PURE__ */ $constructor("$ZodObjectJIT", (inst, def) => {
  $ZodObject.init(inst, def);
  const superParse = inst._zod.parse;
  const _normalized = cached(() => normalizeDef(def));
  const memo2 = globalConfig.memoizer;
  const generateFastpass = (shape) => {
    const normalized = _normalized.value;
    const syms = normalized.symbolKeys;
    const doc = new Doc(["payload", "ctx"], { shape, inst, memo: memo2, syms });
    const parseStr = (k) => `shape[${k}]._zod.run({ value: input[${k}], issues: [] }, ctx)`;
    const prefixStr = (id, k) => `
          let ${id}_ab = false;
          for (let i = 0; i < ${id}.issues.length; i++) {
            const iss = ${id}.issues[i];
            iss.path = iss.path ? [${k}, ...iss.path] : [${k}];
            payload.issues.push(iss);
            if (iss.continue !== true) ${id}_ab = true;
          }
          if (${id}_ab && ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }`;
    doc.write(`const input = payload.value;`);
    const ids = /* @__PURE__ */ Object.create(null);
    let counter = 0;
    for (const key of normalized.allKeys) {
      ids[key] = `key_${counter++}`;
    }
    doc.write(memo2 ? `const newResult = memo.alloc(inst, payload, {}, ctx);` : `const newResult = {};`);
    for (const key of normalized.allKeys) {
      if (key === "__proto__")
        continue;
      const id = ids[key];
      const k = typeof key === "symbol" ? `syms[${syms.indexOf(key)}]` : esc(key);
      const isPresent = `${k} in input`;
      const schema = shape[key];
      const optin = schema?._zod?.optin;
      const isOptionalIn = optin !== void 0;
      const isOptionalOut = schema?._zod?.optout === "optional";
      doc.write(`const ${id} = ${parseStr(k)};`);
      if (isOptionalIn && isOptionalOut) {
        const assign = optin === "optional" ? `${id}_present` : `${id}.value !== undefined || ${id}_present`;
        doc.write(`
        const ${id}_present = ${isPresent};
        if (!${id}.issues.length || ${id}_present) {
          if (${id}.issues.length) {${prefixStr(id, k)}
          }

          if (${assign}) {
            newResult[${k}] = ${id}.value;
          }
        }

      `);
      } else if (!isOptionalIn) {
        doc.write(`
        const ${id}_present = ${isPresent};
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
        if (!${id}_present && !${id}.issues.length) {
          payload.issues.push({
            code: "invalid_type",
            expected: "nonoptional",
            input: undefined,
            path: [${k}]
          });
          if (ctx && ctx.abortEarly) {
            payload.value = newResult;
            return payload;
          }
        }

        if (${id}_present) {
          newResult[${k}] = ${id}.value;
        }

      `);
      } else {
        doc.write(`
        if (${id}.issues.length) {${prefixStr(id, k)}
        }
      `);
        if (optin === "defaulted") {
          doc.write(`newResult[${k}] = ${id}.value;`);
        } else {
          doc.write(`
        if (${id}.value !== undefined || ${isPresent}) {
          newResult[${k}] = ${id}.value;
        }
      `);
        }
      }
    }
    doc.write(`payload.value = newResult;`);
    doc.write(`return payload;`);
    return doc.compile();
  };
  let fastpass;
  const isObject2 = isObject;
  const jit = !globalConfig.jitless;
  const allowsEval2 = allowsEval;
  const fastEnabled = jit && allowsEval2.value;
  const catchall = def.catchall;
  let value;
  inst._zod.parse = (payload, ctx) => {
    value ?? (value = _normalized.value);
    const input = payload.value;
    if (!isObject2(input)) {
      payload.issues.push({
        expected: "object",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    if (jit && fastEnabled && ctx?.async === false && ctx.jitless !== true) {
      if (!fastpass)
        fastpass = generateFastpass(def.shape);
      payload = fastpass(payload, ctx);
      if (!catchall)
        return payload;
      return handleCatchall([], input, payload, ctx, value, inst, ctx?.abortEarly === true);
    }
    return superParse(payload, ctx);
  };
});
function handleUnionResults(results, final, inst, ctx) {
  for (const result of results) {
    if (result.issues.length === 0) {
      final.value = result.value;
      return final;
    }
  }
  const nonaborted = results.filter((r) => !aborted(r));
  if (nonaborted.length === 1) {
    final.value = nonaborted[0].value;
    return nonaborted[0];
  }
  final.issues.push({
    code: "invalid_union",
    input: final.value,
    inst,
    errors: results.map((result) => result.issues.map((iss) => finalizeIssue(iss, ctx, config())))
  });
  return final;
}
var $ZodUnion = /* @__PURE__ */ $constructor("$ZodUnion", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.options.some((o) => o._zod.optin === "defaulted") ? "defaulted" : zod.def.options.some((o) => o._zod.optin !== void 0) ? "optional" : void 0);
  defineLazyInternal(inst, "optout", (zod) => zod.def.options.some((o) => o._zod.optout === "optional") ? "optional" : void 0);
  defineLazyInternal(inst, "values", (zod) => {
    if (zod.def.options.every((o) => o._zod.values)) {
      return new Set(zod.def.options.flatMap((option) => Array.from(option._zod.values)));
    }
    return void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    if (zod.def.options.every((o) => o._zod.pattern)) {
      const patterns = zod.def.options.map((o) => o._zod.pattern);
      return new RegExp(`^(${patterns.map((p) => cleanRegex(p.source)).join("|")})$`);
    }
    return void 0;
  });
  const first = def.options.length === 1 ? def.options[0]._zod.run : null;
  inst._zod.parse = (payload, ctx) => {
    if (first) {
      return first(payload, ctx);
    }
    let async = false;
    const results = [];
    for (const option of def.options) {
      const result = option._zod.run({
        value: payload.value,
        issues: []
      }, ctx);
      if (result instanceof Promise) {
        results.push(result);
        async = true;
      } else {
        if (result.issues.length === 0)
          return result;
        results.push(result);
      }
    }
    if (!async)
      return handleUnionResults(results, payload, inst, ctx);
    return Promise.all(results).then((results2) => {
      return handleUnionResults(results2, payload, inst, ctx);
    });
  };
});
var $ZodIntersection = /* @__PURE__ */ $constructor("$ZodIntersection", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    const left = def.left._zod.run({ value: input, issues: [] }, ctx);
    const right = def.right._zod.run({ value: input, issues: [] }, ctx);
    const async = left instanceof Promise || right instanceof Promise;
    if (async) {
      return Promise.all([left, right]).then(([left2, right2]) => {
        return handleIntersectionResults(payload, left2, right2);
      });
    }
    return handleIntersectionResults(payload, left, right);
  };
});
function mergeValues(a, b) {
  if (a === b) {
    return { valid: true, data: a };
  }
  if (a instanceof Date && b instanceof Date && +a === +b) {
    return { valid: true, data: a };
  }
  if (isPlainObject(a) && isPlainObject(b)) {
    const bKeys = Object.keys(b);
    const sharedKeys = Object.keys(a).filter((key) => bKeys.indexOf(key) !== -1);
    const newObj = { ...a, ...b };
    if (Object.prototype.hasOwnProperty.call(newObj, "__proto__"))
      delete newObj.__proto__;
    for (const key of sharedKeys) {
      if (key === "__proto__")
        continue;
      const sharedValue = mergeValues(a[key], b[key]);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [key, ...sharedValue.mergeErrorPath]
        };
      }
      newObj[key] = sharedValue.data;
    }
    return { valid: true, data: newObj };
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      return { valid: false, mergeErrorPath: [] };
    }
    const newArray = [];
    for (let index = 0; index < a.length; index++) {
      const itemA = a[index];
      const itemB = b[index];
      const sharedValue = mergeValues(itemA, itemB);
      if (!sharedValue.valid) {
        return {
          valid: false,
          mergeErrorPath: [index, ...sharedValue.mergeErrorPath]
        };
      }
      newArray.push(sharedValue.data);
    }
    return { valid: true, data: newArray };
  }
  return { valid: false, mergeErrorPath: [] };
}
function handleIntersectionResults(result, left, right) {
  const unrecKeys = /* @__PURE__ */ new Map();
  let unrecIssue;
  const keyIssues = /* @__PURE__ */ new Map();
  const collect = (iss, side) => {
    let keys;
    if (iss.code === "unrecognized_keys" && !iss.path?.length) {
      unrecIssue ?? (unrecIssue = iss);
      keys = iss.keys;
    } else if (iss.code === "invalid_key" && iss.origin === "record" && iss.path?.length === 1) {
      const k = String(iss.path[0]);
      if (!keyIssues.has(k))
        keyIssues.set(k, iss);
      keys = [k];
    } else {
      return false;
    }
    for (const k of keys) {
      if (!unrecKeys.has(k))
        unrecKeys.set(k, {});
      unrecKeys.get(k)[side] = true;
    }
    return true;
  };
  for (const iss of left.issues) {
    if (!collect(iss, "l"))
      result.issues.push(iss);
  }
  for (const iss of right.issues) {
    if (!collect(iss, "r"))
      result.issues.push(iss);
  }
  const bothKeys = [...unrecKeys].filter(([, f]) => f.l && f.r).map(([k]) => k);
  if (bothKeys.length) {
    const aggregated = unrecIssue ? bothKeys.filter((k) => unrecIssue.keys.includes(k)) : [];
    if (aggregated.length)
      result.issues.push({ ...unrecIssue, keys: aggregated });
    for (const k of bothKeys) {
      if (!aggregated.includes(k) && keyIssues.has(k))
        result.issues.push(keyIssues.get(k));
    }
  }
  const merged = mergeValues(left.value, right.value);
  if (!merged.valid) {
    if (aborted(result))
      return result;
    throw new Error(`Unmergable intersection. Error path: ${JSON.stringify(merged.mergeErrorPath)}`);
  }
  result.value = merged.data;
  return result;
}
var $ZodRecord = /* @__PURE__ */ $constructor("$ZodRecord", (inst, def) => {
  $ZodType.init(inst, def);
  const memo2 = globalConfig.memoizer;
  memo2?.attach(inst);
  inst._zod.parse = (payload, ctx) => {
    const input = payload.value;
    if (!isPlainObject(input)) {
      payload.issues.push({
        expected: "record",
        code: "invalid_type",
        input,
        inst
      });
      return payload;
    }
    const proms = [];
    const values = def.keyType._zod.values;
    if (values && !def.partial) {
      payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
      const recordKeys = /* @__PURE__ */ new Set();
      for (const key of values) {
        if (typeof key === "string" || typeof key === "number" || typeof key === "symbol") {
          recordKeys.add(typeof key === "number" ? key.toString() : key);
          if (key === "__proto__")
            continue;
          const keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
          if (keyResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (keyResult.issues.length) {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
            continue;
          }
          const outKey = keyResult.value;
          if (outKey === "__proto__")
            continue;
          const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
          if (result instanceof Promise) {
            proms.push(result.then((result2) => {
              if (result2.issues.length) {
                payload.issues.push(...prefixIssues(key, result2.issues));
              }
              payload.value[outKey] = result2.value;
            }));
          } else {
            if (result.issues.length) {
              payload.issues.push(...prefixIssues(key, result.issues));
            }
            payload.value[outKey] = result.value;
          }
        }
      }
      let unrecognized;
      for (const key in input) {
        if (!recordKeys.has(key)) {
          if (def.mode === "loose") {
            if (key === "__proto__")
              continue;
            payload.value[key] = input[key];
          } else {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          }
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    } else {
      payload.value = memo2 ? memo2.alloc(inst, payload, {}, ctx) : {};
      let unrecognized;
      for (const key of Reflect.ownKeys(input)) {
        if (key === "__proto__")
          continue;
        if (!Object.prototype.propertyIsEnumerable.call(input, key))
          continue;
        let keyResult = def.keyType._zod.run({ value: key, issues: [] }, ctx);
        if (keyResult instanceof Promise) {
          throw new Error("Async schemas not supported in object keys currently");
        }
        const checkNumericKey = typeof key === "string" && number.test(key) && keyResult.issues.length;
        if (checkNumericKey) {
          const retryResult = def.keyType._zod.run({ value: Number(key), issues: [] }, ctx);
          if (retryResult instanceof Promise) {
            throw new Error("Async schemas not supported in object keys currently");
          }
          if (retryResult.issues.length === 0) {
            keyResult = retryResult;
          }
        }
        if (keyResult.issues.length) {
          if (def.mode === "loose") {
            payload.value[key] = input[key];
          } else if (values) {
            unrecognized = unrecognized ?? [];
            unrecognized.push(key);
          } else {
            payload.issues.push({
              code: "invalid_key",
              origin: "record",
              issues: keyResult.issues.map((iss) => finalizeIssue(iss, ctx, config())),
              input: key,
              path: [key],
              inst
            });
          }
          continue;
        }
        const outKey = keyResult.value;
        if (outKey === "__proto__")
          continue;
        const result = def.valueType._zod.run({ value: input[key], issues: [] }, ctx);
        if (result instanceof Promise) {
          proms.push(result.then((result2) => {
            if (result2.issues.length) {
              payload.issues.push(...prefixIssues(key, result2.issues));
            }
            payload.value[outKey] = result2.value;
          }));
        } else {
          if (result.issues.length) {
            payload.issues.push(...prefixIssues(key, result.issues));
          }
          payload.value[outKey] = result.value;
        }
      }
      if (unrecognized && unrecognized.length > 0) {
        payload.issues.push({
          code: "unrecognized_keys",
          input,
          inst,
          keys: unrecognized,
          continue: true
        });
      }
    }
    if (proms.length) {
      return Promise.all(proms).then(() => payload);
    }
    return payload;
  };
});
var $ZodEnum = /* @__PURE__ */ $constructor("$ZodEnum", (inst, def) => {
  $ZodType.init(inst, def);
  const values = getEnumValues(def.entries);
  const valuesSet = new Set(values);
  inst._zod.values = valuesSet;
  defineLazyInternal(inst, "pattern", (zod) => {
    const patternValues = getEnumValues(zod.def.entries).filter((k) => propertyKeyTypes.has(typeof k));
    return new RegExp(patternValues.length ? `^(${patternValues.map((o) => escapeRegex(o.toString())).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (valuesSet.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodLiteral = /* @__PURE__ */ $constructor("$ZodLiteral", (inst, def) => {
  $ZodType.init(inst, def);
  const values = new Set(def.values);
  inst._zod.values = values;
  defineLazyInternal(inst, "pattern", (zod) => {
    const vals = zod.def.values;
    return new RegExp(vals.length ? `^(${vals.map((o) => typeof o === "string" ? escapeRegex(o) : o ? escapeRegex(o.toString()) : String(o)).join("|")})$` : "^[^\\s\\S]$");
  });
  inst._zod.parse = (payload, _ctx) => {
    const input = payload.value;
    if (values.has(input)) {
      return payload;
    }
    payload.issues.push({
      code: "invalid_value",
      values: def.values,
      input,
      inst
    });
    return payload;
  };
});
var $ZodTransform = /* @__PURE__ */ $constructor("$ZodTransform", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "optional";
  globalConfig.memoizer?.guard(inst);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    const _out = def.transform(payload.value, payload);
    if (ctx.async) {
      const output = _out instanceof Promise ? _out : Promise.resolve(_out);
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    if (_out instanceof Promise) {
      throw new $ZodAsyncError();
    }
    payload.value = _out;
    return payload;
  };
});
function handleOptionalResult(payload, result) {
  payload.value = result.issues.length ? void 0 : result.value;
  return payload;
}
var $ZodOptional = /* @__PURE__ */ $constructor("$ZodOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  inst._zod.optout = "optional";
  defineLazyInternal(inst, "values", (zod) => {
    const values = zod.def.innerType._zod.values;
    return values ? /* @__PURE__ */ new Set([...values, void 0]) : void 0;
  });
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)})?$`) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === void 0) {
      if (def.innerType._zod.optin !== "defaulted")
        return payload;
      const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
      if (result instanceof Promise)
        return result.then((result2) => handleOptionalResult(payload, result2));
      return handleOptionalResult(payload, result);
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodExactOptional = /* @__PURE__ */ $constructor("$ZodExactOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "pattern", (zod) => zod.def.innerType._zod.pattern);
  inst._zod.parse = (payload, ctx) => {
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNullable = /* @__PURE__ */ $constructor("$ZodNullable", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "pattern", (zod) => {
    const pattern = zod.def.innerType._zod.pattern;
    return pattern ? new RegExp(`^(${cleanRegex(pattern.source)}|null)$`) : void 0;
  });
  defineLazyInternal(inst, "values", (zod) => {
    return zod.def.innerType._zod.values ? /* @__PURE__ */ new Set([...zod.def.innerType._zod.values, null]) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    if (payload.value === null)
      return payload;
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodDefault = /* @__PURE__ */ $constructor("$ZodDefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
      return payload;
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleDefaultResult(result2, def));
    }
    return handleDefaultResult(result, def);
  };
});
function handleDefaultResult(payload, def) {
  if (payload.value === void 0) {
    payload.value = def.defaultValue;
  }
  return payload;
}
var $ZodPrefault = /* @__PURE__ */ $constructor("$ZodPrefault", (inst, def) => {
  $ZodType.init(inst, def);
  inst._zod.optin = "defaulted";
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    if (payload.value === void 0) {
      payload.value = def.defaultValue;
    }
    return def.innerType._zod.run(payload, ctx);
  };
});
var $ZodNonOptional = /* @__PURE__ */ $constructor("$ZodNonOptional", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => {
    const v = zod.def.innerType._zod.values;
    return v ? new Set([...v].filter((x) => x !== void 0)) : void 0;
  });
  inst._zod.parse = (payload, ctx) => {
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleNonOptionalResult(result2, inst));
    }
    return handleNonOptionalResult(result, inst);
  };
});
function handleNonOptionalResult(payload, inst) {
  if (!payload.issues.length && payload.value === void 0) {
    payload.issues.push({
      code: "invalid_type",
      expected: "nonoptional",
      input: payload.value,
      inst
    });
  }
  return payload;
}
function handleCatchResult(payload, result, def, ctx) {
  if (!result.issues.length) {
    payload.value = result.value;
    if (result.memo)
      payload.memo = true;
    return payload;
  }
  payload.value = def.catchValue({
    ...result,
    value: payload.value,
    error: {
      issues: result.issues.map((iss) => finalizeIssue(iss, ctx, config()))
    },
    input: payload.value
  });
  return payload;
}
var $ZodCatch = /* @__PURE__ */ $constructor("$ZodCatch", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType._zod.optin === "defaulted" ? "defaulted" : "optional");
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType._zod.optout);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run({ value: payload.value, issues: [] }, ctx);
    if (result instanceof Promise) {
      return result.then((result2) => handleCatchResult(payload, result2, def, ctx));
    }
    return handleCatchResult(payload, result, def, ctx);
  };
});
var $ZodPipe = /* @__PURE__ */ $constructor("$ZodPipe", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "values", (zod) => zod.def.in._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.in._zod.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.out._zod.optout);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.in._zod.propValues);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      const right = def.out._zod.run(payload, ctx);
      if (right instanceof Promise) {
        return right.then((right2) => handlePipeResult(right2, def.in, ctx));
      }
      return handlePipeResult(right, def.in, ctx);
    }
    const left = def.in._zod.run(payload, ctx);
    if (left instanceof Promise) {
      return left.then((left2) => handlePipeResult(left2, def.out, ctx));
    }
    return handlePipeResult(left, def.out, ctx);
  };
});
function handlePipeResult(left, next, ctx) {
  if (left.issues.some((iss) => iss.code !== "unrecognized_keys")) {
    left.aborted = true;
    return left;
  }
  return next._zod.run({ value: left.value, issues: left.issues }, ctx);
}
var $ZodPreprocess = /* @__PURE__ */ $constructor("$ZodPreprocess", (inst, def) => {
  $ZodPipe.init(inst, def);
});
var $ZodReadonly = /* @__PURE__ */ $constructor("$ZodReadonly", (inst, def) => {
  $ZodType.init(inst, def);
  defineLazyInternal(inst, "propValues", (zod) => zod.def.innerType._zod.propValues);
  defineLazyInternal(inst, "values", (zod) => zod.def.innerType._zod.values);
  defineLazyInternal(inst, "optin", (zod) => zod.def.innerType?._zod?.optin);
  defineLazyInternal(inst, "optout", (zod) => zod.def.innerType?._zod?.optout);
  inst._zod.parse = (payload, ctx) => {
    if (ctx.direction === "backward") {
      return def.innerType._zod.run(payload, ctx);
    }
    const result = def.innerType._zod.run(payload, ctx);
    if (result instanceof Promise) {
      return result.then(handleReadonlyResult);
    }
    return handleReadonlyResult(result);
  };
});
function handleReadonlyResult(payload) {
  if (!payload.memo)
    payload.value = Object.freeze(payload.value);
  return payload;
}
var $ZodCustom = /* @__PURE__ */ $constructor("$ZodCustom", (inst, def) => {
  $ZodCheck.init(inst, def);
  $ZodType.init(inst, def);
  inst._zod.parse = (payload, _) => {
    return payload;
  };
  inst._zod.check = (payload) => {
    const input = payload.value;
    const r = def.fn(input);
    if (r instanceof Promise) {
      return r.then((r2) => handleRefineResult(r2, payload, input, inst));
    }
    handleRefineResult(r, payload, input, inst);
    return;
  };
});
function handleRefineResult(result, payload, input, inst) {
  if (!result) {
    const _iss = {
      code: "custom",
      input,
      inst,
      // incorporates params.error into issue reporting
      path: [...inst._zod.def.path ?? []],
      // incorporates params.error into issue reporting
      continue: !inst._zod.def.abort
      // params: inst._zod.def.params,
    };
    if (inst._zod.def.params)
      _iss.params = inst._zod.def.params;
    payload.issues.push(issue(_iss));
  }
}

// ../../super-agent-zcode/node_modules/zod/v4/core/memoizer.js
var $ZodCyclicError = class extends Error {
  constructor() {
    super(`Cannot parse a reference cycle that closes through a transform`);
    this.name = "ZodCyclicError";
  }
};
var STATE = "~memo";
var NO_ISSUES = [];
function isRef(value) {
  return value !== null && typeof value === "object";
}
function cloneIssues(issues) {
  return issues.map((iss) => iss.path ? { ...iss, path: iss.path.slice() } : { ...iss });
}
var recursive = /* @__PURE__ */ new WeakMap();
var NONE = 0;
var ASSUMED = 1;
var PROVEN = 2;
function isRecursive(inst, stack, resolve7) {
  const cached2 = recursive.get(inst);
  if (cached2 !== void 0)
    return cached2 ? PROVEN : NONE;
  if (stack.has(inst))
    return PROVEN;
  stack.add(inst);
  let result = NONE;
  const check = (child) => {
    if (result !== PROVEN && child?._zod) {
      const answer = isRecursive(child, stack, resolve7);
      if (answer > result)
        result = answer;
    }
  };
  const shape = (sh, spread) => {
    let answer = NONE;
    for (const key of Reflect.ownKeys(sh)) {
      const desc = Object.getOwnPropertyDescriptor(sh, key);
      if (spread && !desc.enumerable)
        continue;
      const child = desc.get ? ASSUMED : desc.value?._zod ? isRecursive(desc.value, stack, resolve7) : NONE;
      if (child > answer)
        answer = child;
    }
    return answer;
  };
  const merge2 = (answer) => {
    if (answer > result)
      result = answer;
  };
  const def = inst._zod.def;
  const kind = def.type;
  switch (kind) {
    case "object": {
      const raw = rawShape(def);
      merge2(raw ? shape(raw, true) : ASSUMED);
      check(def.catchall);
      break;
    }
    case "array":
      check(def.element);
      break;
    case "tuple":
      for (const el of def.items)
        check(el);
      check(def.rest);
      break;
    case "record":
    case "map":
      check(def.keyType);
      check(def.valueType);
      break;
    case "set":
      check(def.valueType);
      break;
    case "union":
      for (const el of def.options)
        check(el);
      break;
    case "intersection":
      check(def.left);
      check(def.right);
      break;
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "catch":
    case "readonly":
    case "nonoptional":
    case "promise":
    case "success":
      check(def.innerType);
      break;
    case "pipe":
      check(def.in);
      check(def.out);
      break;
    case "function":
      check(def.input);
      check(def.output);
      break;
    // `$ZodLazy` caches its inner on the def, so a resolved edge is followed exactly
    case "lazy": {
      const inner = def._cachedInner ?? (resolve7 ? inst._zod.innerType : void 0);
      merge2(inner ? isRecursive(inner, stack, false) : ASSUMED);
      break;
    }
    // a leaf by choice: `parts` are regex fragments, not data positions
    case "template_literal":
    // leaves
    case "string":
    case "number":
    case "int":
    case "boolean":
    case "bigint":
    case "symbol":
    case "undefined":
    case "null":
    case "void":
    case "never":
    case "any":
    case "unknown":
    case "date":
    case "nan":
    case "enum":
    case "literal":
    case "file":
    case "transform":
    case "custom":
      break;
    default: {
      kind;
      for (const key in def) {
        const desc = Object.getOwnPropertyDescriptor(def, key);
        if (!desc || desc.get)
          continue;
        const value = desc.value;
        if (!value || typeof value !== "object")
          continue;
        if (value._zod)
          check(value);
        else if (Array.isArray(value))
          for (const el of value)
            check(el);
      }
    }
  }
  stack.delete(inst);
  return settle(inst, result);
}
function settle(inst, answer) {
  if (answer !== ASSUMED)
    recursive.set(inst, answer === PROVEN);
  return answer;
}
function bucketFor(state, inst) {
  let bucket = state.buckets.get(inst);
  if (!bucket) {
    bucket = /* @__PURE__ */ new WeakMap();
    state.buckets.set(inst, bucket);
  }
  return bucket;
}
var handoff;
var open = [];
var memo = {
  alloc(_inst, payload, empty) {
    const bucket = handoff;
    if (!bucket)
      return empty;
    handoff = void 0;
    const entry = { value: empty, issues: null };
    bucket.set(payload.value, entry);
    open.push(entry);
    return empty;
  },
  guard(inst) {
    var _a3;
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (ctx.direction !== "backward" && isBackEdge(ctx, payload.value))
          throw new $ZodCyclicError();
        return base(payload, ctx);
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  },
  attach(inst) {
    var _a3;
    let isRecursiveInst;
    let rechecked = false;
    let lastCtx;
    let lastBucket;
    (_a3 = inst._zod).deferred ?? (_a3.deferred = []);
    inst._zod.deferred.push(() => {
      const base = inst._zod.parse;
      const wrapped = (payload, ctx) => {
        if (isRecursiveInst === void 0) {
          const walked = isRecursive(inst, /* @__PURE__ */ new Set(), false);
          if (walked === NONE) {
            inst._zod.parse = base;
            if (inst._zod.run === wrapped)
              inst._zod.run = base;
            return base(payload, ctx);
          }
          if (walked === PROVEN || rechecked)
            isRecursiveInst = true;
          else
            rechecked = true;
        }
        const input = payload.value;
        if (!isRef(input))
          return base(payload, ctx);
        let state = ctx[STATE];
        if (!state) {
          state = { buckets: /* @__PURE__ */ new WeakMap(), backEdges: void 0 };
          ctx[STATE] = state;
        }
        let bucket;
        if (lastCtx === ctx) {
          bucket = lastBucket;
        } else {
          bucket = bucketFor(state, inst);
          lastCtx = ctx;
          lastBucket = bucket;
        }
        const hit = bucket.get(input);
        if (hit) {
          payload.value = hit.value;
          if (hit.issues) {
            if (hit.issues.length)
              payload.issues.push(...cloneIssues(hit.issues));
          } else {
            payload.memo = true;
            state.backEdges ?? (state.backEdges = /* @__PURE__ */ new WeakSet());
            state.backEdges.add(hit.value);
          }
          return payload;
        }
        handoff = bucket;
        const depth = open.length;
        const result = base(payload, ctx);
        handoff = void 0;
        const entry = open.length > depth ? open.pop() : void 0;
        if (result instanceof Promise) {
          return result.then((r) => {
            if (entry)
              entry.issues = r.issues.length ? cloneIssues(r.issues) : NO_ISSUES;
            return r;
          });
        }
        if (entry)
          entry.issues = result.issues.length ? cloneIssues(result.issues) : NO_ISSUES;
        return result;
      };
      inst._zod.parse = wrapped;
      if (inst._zod.run === base)
        inst._zod.run = wrapped;
    });
  }
};
function memoizer() {
  return memo;
}
function isBackEdge(ctx, value) {
  const backEdges = ctx[STATE]?.backEdges;
  return backEdges !== void 0 && isRef(value) && backEdges.has(value);
}

// ../../super-agent-zcode/node_modules/zod/v4/locales/en.js
var error = () => {
  const Sizable = {
    string: { unit: "characters", verb: "to have" },
    file: { unit: "bytes", verb: "to have" },
    array: { unit: "items", verb: "to have" },
    set: { unit: "items", verb: "to have" },
    map: { unit: "entries", verb: "to have" }
  };
  function getSizing(origin) {
    return Sizable[origin] ?? null;
  }
  const FormatDictionary = {
    regex: "input",
    email: "email address",
    url: "URL",
    emoji: "emoji",
    uuid: "UUID",
    uuidv4: "UUIDv4",
    uuidv6: "UUIDv6",
    nanoid: "nanoid",
    guid: "GUID",
    cuid: "cuid",
    cuid2: "cuid2",
    ulid: "ULID",
    xid: "XID",
    ksuid: "KSUID",
    datetime: "ISO datetime",
    date: "ISO date",
    time: "ISO time",
    duration: "ISO duration",
    ipv4: "IPv4 address",
    ipv6: "IPv6 address",
    mac: "MAC address",
    cidrv4: "IPv4 range",
    cidrv6: "IPv6 range",
    base64: "base64-encoded string",
    base64url: "base64url-encoded string",
    json_string: "JSON string",
    e164: "E.164 number",
    currency_code: "currency code",
    credit_card: "credit card number",
    iban: "IBAN",
    jwt: "JWT",
    template_literal: "input"
  };
  const TypeDictionary = {
    // Compatibility: "nan" -> "NaN" for display
    nan: "NaN"
    // All other type names omitted - they fall back to raw values via ?? operator
  };
  function getTypeName(type, input) {
    if (type === "number" && typeof input === "number" && !Number.isFinite(input)) {
      return String(input);
    }
    return TypeDictionary[type] ?? type;
  }
  return (issue2) => {
    switch (issue2.code) {
      case "invalid_type": {
        const expected = getTypeName(issue2.expected);
        const receivedType = parsedType(issue2.input);
        const received = getTypeName(receivedType, issue2.input);
        return `Invalid input: expected ${expected}, received ${received}`;
      }
      case "invalid_value":
        if (issue2.values.length === 1)
          return `Invalid input: expected ${stringifyPrimitive(issue2.values[0])}`;
        return `Invalid option: expected one of ${joinValues(issue2.values, "|")}`;
      case "too_big": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? "<=" : "<";
        const sizing = getSizing(issue2.origin);
        if (sizing)
          return `Too big: expected ${issue2.origin ?? "value"} to have ${adj}${issue2.maximum.toString()} ${sizing.unit ?? "elements"}`;
        return `Too big: expected ${issue2.origin ?? "value"} to be ${adj}${issue2.maximum.toString()}`;
      }
      case "too_small": {
        const adj = issue2.exact ? "exactly " : issue2.inclusive ? ">=" : ">";
        const sizing = getSizing(issue2.origin);
        if (sizing) {
          return `Too small: expected ${issue2.origin} to have ${adj}${issue2.minimum.toString()} ${sizing.unit}`;
        }
        return `Too small: expected ${issue2.origin} to be ${adj}${issue2.minimum.toString()}`;
      }
      case "invalid_format": {
        const _issue = issue2;
        if (_issue.format === "starts_with") {
          return `Invalid string: must start with "${_issue.prefix}"`;
        }
        if (_issue.format === "ends_with")
          return `Invalid string: must end with "${_issue.suffix}"`;
        if (_issue.format === "includes")
          return `Invalid string: must include "${_issue.includes}"`;
        if (_issue.format === "regex")
          return `Invalid string: must match pattern ${_issue.pattern}`;
        return `Invalid ${FormatDictionary[_issue.format] ?? issue2.format}`;
      }
      case "not_multiple_of":
        return `Invalid number: must be a multiple of ${issue2.divisor}`;
      case "unrecognized_keys":
        return `Unrecognized key${issue2.keys.length > 1 ? "s" : ""}: ${joinValues(issue2.keys, ", ")}`;
      case "invalid_key":
        return `Invalid key in ${issue2.origin}`;
      case "invalid_union":
        if (issue2.options && Array.isArray(issue2.options) && issue2.options.length > 0) {
          const opts2 = issue2.options.map((o) => `'${o}'`).join(" | ");
          return `Invalid discriminator value. Expected ${opts2}`;
        }
        if (issue2.inclusive === false) {
          return "Invalid input: more than one option matched";
        }
        return "Invalid input";
      case "invalid_element":
        return `Invalid value in ${issue2.origin}`;
      default:
        return `Invalid input`;
    }
  };
};
function en_default() {
  return {
    localeError: error()
  };
}

// ../../super-agent-zcode/node_modules/zod/v4/core/registries.js
var _a2;
var $ZodRegistry = class {
  constructor() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
  }
  add(schema, ..._meta) {
    const meta2 = _meta[0];
    this._map.set(schema, meta2);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.set(meta2.id, schema);
    }
    return this;
  }
  clear() {
    this._map = /* @__PURE__ */ new WeakMap();
    this._idmap = /* @__PURE__ */ new Map();
    return this;
  }
  remove(schema) {
    const meta2 = this._map.get(schema);
    if (meta2 && typeof meta2 === "object" && "id" in meta2) {
      this._idmap.delete(meta2.id);
    }
    this._map.delete(schema);
    return this;
  }
  get(schema) {
    const p = schema._zod.parent;
    if (p) {
      const pm = { ...this.get(p) ?? {} };
      delete pm.id;
      const f = { ...pm, ...this._map.get(schema) };
      return Object.keys(f).length ? f : void 0;
    }
    return this._map.get(schema);
  }
  has(schema) {
    return this._map.has(schema);
  }
};
function registry() {
  return new $ZodRegistry();
}
(_a2 = globalThis).__zod_globalRegistry ?? (_a2.__zod_globalRegistry = registry());
var globalRegistry = globalThis.__zod_globalRegistry;

// ../../super-agent-zcode/node_modules/zod/v4/core/api.js
function snapshotChecks(def) {
  if (def.checks)
    def.checks = [...def.checks];
  return def;
}
// @__NO_SIDE_EFFECTS__
function _string(Class2, params) {
  return new Class2(snapshotChecks({ type: "string", ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _email(Class2, params) {
  return new Class2({
    type: "string",
    format: "email",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _guid(Class2, params) {
  return new Class2({
    type: "string",
    format: "guid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v4",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v6",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uuidv7(Class2, params) {
  return new Class2({
    type: "string",
    format: "uuid",
    check: "string_format",
    abort: false,
    version: "v7",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _url(Class2, params) {
  return new Class2({
    type: "string",
    format: "url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _emoji2(Class2, params) {
  return new Class2({
    type: "string",
    format: "emoji",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _nanoid(Class2, params) {
  return new Class2({
    type: "string",
    format: "nanoid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cuid2(Class2, params) {
  return new Class2({
    type: "string",
    format: "cuid2",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ulid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ulid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _xid(Class2, params) {
  return new Class2({
    type: "string",
    format: "xid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ksuid(Class2, params) {
  return new Class2({
    type: "string",
    format: "ksuid",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _ipv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "ipv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv4(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv4",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _cidrv6(Class2, params) {
  return new Class2({
    type: "string",
    format: "cidrv6",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _base64url(Class2, params) {
  return new Class2({
    type: "string",
    format: "base64url",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _e164(Class2, params) {
  return new Class2({
    type: "string",
    format: "e164",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _jwt(Class2, params) {
  return new Class2({
    type: "string",
    format: "jwt",
    check: "string_format",
    abort: false,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDateTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "datetime",
    check: "string_format",
    offset: false,
    local: false,
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDate(Class2, params) {
  return new Class2({
    type: "string",
    format: "date",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoTime(Class2, params) {
  return new Class2({
    type: "string",
    format: "time",
    check: "string_format",
    precision: null,
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _isoDuration(Class2, params) {
  return new Class2({
    type: "string",
    format: "duration",
    check: "string_format",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _number(Class2, params) {
  return new Class2(snapshotChecks({ type: "number", checks: [], ...normalizeParams(params) }));
}
// @__NO_SIDE_EFFECTS__
function _int(Class2, params) {
  return new Class2({
    type: "number",
    check: "number_format",
    abort: false,
    format: "safeint",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _boolean(Class2, params) {
  return new Class2({
    type: "boolean",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _unknown(Class2) {
  return new Class2({
    type: "unknown"
  });
}
// @__NO_SIDE_EFFECTS__
function _never(Class2, params) {
  return new Class2({
    type: "never",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _lt(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _lte(value, params) {
  return new $ZodCheckLessThan({
    check: "less_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _gt(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: false
  });
}
// @__NO_SIDE_EFFECTS__
function _gte(value, params) {
  return new $ZodCheckGreaterThan({
    check: "greater_than",
    ...normalizeParams(params),
    value,
    inclusive: true
  });
}
// @__NO_SIDE_EFFECTS__
function _multipleOf(value, params) {
  return new $ZodCheckMultipleOf({
    check: "multiple_of",
    ...normalizeParams(params),
    value
  });
}
// @__NO_SIDE_EFFECTS__
function _maxLength(maximum, params) {
  const ch = new $ZodCheckMaxLength({
    check: "max_length",
    ...normalizeParams(params),
    maximum
  });
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _minLength(minimum, params) {
  return new $ZodCheckMinLength({
    check: "min_length",
    ...normalizeParams(params),
    minimum
  });
}
// @__NO_SIDE_EFFECTS__
function _length(length, params) {
  return new $ZodCheckLengthEquals({
    check: "length_equals",
    ...normalizeParams(params),
    length
  });
}
// @__NO_SIDE_EFFECTS__
function _regex(pattern, params) {
  return new $ZodCheckRegex({
    check: "string_format",
    format: "regex",
    ...normalizeParams(params),
    pattern
  });
}
// @__NO_SIDE_EFFECTS__
function _lowercase(params) {
  return new $ZodCheckLowerCase({
    check: "string_format",
    format: "lowercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _uppercase(params) {
  return new $ZodCheckUpperCase({
    check: "string_format",
    format: "uppercase",
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _includes(includes, params) {
  return new $ZodCheckIncludes({
    check: "string_format",
    format: "includes",
    ...normalizeParams(params),
    includes
  });
}
// @__NO_SIDE_EFFECTS__
function _startsWith(prefix, params) {
  return new $ZodCheckStartsWith({
    check: "string_format",
    format: "starts_with",
    ...normalizeParams(params),
    prefix
  });
}
// @__NO_SIDE_EFFECTS__
function _endsWith(suffix, params) {
  return new $ZodCheckEndsWith({
    check: "string_format",
    format: "ends_with",
    ...normalizeParams(params),
    suffix
  });
}
// @__NO_SIDE_EFFECTS__
function _overwrite(tx) {
  return new $ZodCheckOverwrite({
    check: "overwrite",
    tx
  });
}
// @__NO_SIDE_EFFECTS__
function _normalize(form) {
  return /* @__PURE__ */ _overwrite((input) => input.normalize(form));
}
// @__NO_SIDE_EFFECTS__
function _trim() {
  return /* @__PURE__ */ _overwrite((input) => input.trim());
}
// @__NO_SIDE_EFFECTS__
function _toLowerCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toLowerCase());
}
// @__NO_SIDE_EFFECTS__
function _toUpperCase() {
  return /* @__PURE__ */ _overwrite((input) => input.toUpperCase());
}
// @__NO_SIDE_EFFECTS__
function _slugify() {
  return /* @__PURE__ */ _overwrite((input) => slugify(input));
}
// @__NO_SIDE_EFFECTS__
function _array(Class2, element, params) {
  return new Class2({
    type: "array",
    element,
    // get element() {
    //   return element;
    // },
    ...normalizeParams(params)
  });
}
// @__NO_SIDE_EFFECTS__
function _refine(Class2, fn, _params) {
  const schema = new Class2({
    type: "custom",
    check: "custom",
    fn,
    ...normalizeParams(_params)
  });
  return schema;
}
// @__NO_SIDE_EFFECTS__
function _superRefine(fn, params) {
  const ch = /* @__PURE__ */ _check((payload) => {
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(issue(issue2, payload.value, ch._zod.def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = ch);
        _issue.continue ?? (_issue.continue = !ch._zod.def.abort);
        payload.issues.push(issue(_issue));
      }
    };
    return fn(payload.value, payload);
  }, params);
  return ch;
}
// @__NO_SIDE_EFFECTS__
function _check(fn, params) {
  const ch = new $ZodCheck({
    check: "custom",
    ...normalizeParams(params)
  });
  ch._zod.check = fn;
  return ch;
}

// ../../super-agent-zcode/node_modules/zod/v4/core/to-json-schema.js
function assignProps(target, ...sources) {
  for (const source of sources) {
    for (const key of Reflect.ownKeys(source)) {
      if (Object.prototype.propertyIsEnumerable.call(source, key)) {
        assignProp(target, key, source[key]);
      }
    }
  }
  return target;
}
function initializeContext(params) {
  let target = params?.target ?? "draft-2020-12";
  if (target === "draft-4")
    target = "draft-04";
  if (target === "draft-7")
    target = "draft-07";
  return {
    processors: params.processors ?? {},
    metadataRegistry: params?.metadata ?? globalRegistry,
    target,
    unrepresentable: params?.unrepresentable ?? "throw",
    override: params?.override ?? (() => {
    }),
    io: params?.io ?? "output",
    counter: 0,
    seen: /* @__PURE__ */ new Map(),
    sharedDefsExtractedFor: void 0,
    sharedEmitDoneFor: void 0,
    cycles: params?.cycles ?? "ref",
    reused: params?.reused ?? "inline",
    intersections: [],
    deferred: [],
    external: params?.external ?? void 0
  };
}
function handleUnrepresentable(schema, ctx, json, params, message) {
  const result = typeof ctx.unrepresentable === "function" ? ctx.unrepresentable({ zodSchema: schema, path: params.path, message }) : ctx.unrepresentable;
  if (result === "any")
    return false;
  if (result === void 0 || result === "throw")
    throw new Error(message);
  Object.assign(json, result);
  return true;
}
function processSchema(schema, ctx, _params = { path: [], schemaPath: [] }) {
  var _a3;
  const def = schema._zod.def;
  const seen = ctx.seen.get(schema);
  if (seen) {
    seen.count++;
    const isCycle = _params.schemaPath.includes(schema);
    if (isCycle) {
      seen.cycle = _params.path;
    }
    return seen.schema;
  }
  const result = { schema: {}, count: 1, cycle: void 0, path: _params.path };
  ctx.seen.set(schema, result);
  ctx.sharedDefsExtractedFor = void 0;
  ctx.sharedEmitDoneFor = void 0;
  const overrideSchema = schema._zod.toJSONSchema?.();
  if (overrideSchema) {
    result.schema = overrideSchema;
  } else {
    const params = {
      ..._params,
      schemaPath: [..._params.schemaPath, schema],
      path: _params.path
    };
    if (schema._zod.processJSONSchema) {
      schema._zod.processJSONSchema(ctx, result.schema, params);
    } else {
      const _json = result.schema;
      const processor = ctx.processors[def.type];
      if (!processor) {
        throw new Error(`[toJSONSchema]: Non-representable type encountered: ${def.type}`);
      }
      processor(schema, ctx, _json, params);
    }
    const parent = schema._zod.parent;
    if (parent) {
      if (!result.ref)
        result.ref = parent;
      processSchema(parent, ctx, params);
      ctx.seen.get(parent).isParent = true;
    }
  }
  const meta2 = ctx.metadataRegistry.get(schema);
  if (meta2)
    assignProps(result.schema, meta2);
  if (ctx.io === "input" && isTransforming(schema)) {
    delete result.schema.examples;
    delete result.schema.default;
  }
  if (ctx.io === "input" && "_prefault" in result.schema)
    (_a3 = result.schema).default ?? (_a3.default = result.schema._prefault);
  delete result.schema._prefault;
  const _result = ctx.seen.get(schema);
  return _result.schema;
}
function encodeJSONPointerSegment(segment) {
  return segment.replace(/~/g, "~0").replace(/\//g, "~1");
}
function extractDefs(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  if (ctx.external && ctx.sharedDefsExtractedFor === ctx.external)
    return;
  const idToSchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.entries()) {
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      const existing = idToSchema.get(id);
      if (existing && existing !== entry[0]) {
        throw new Error(`Duplicate schema id "${id}" detected during JSON Schema conversion. Two different schemas cannot share the same id when converted together.`);
      }
      idToSchema.set(id, entry[0]);
    }
  }
  const makeURI = (entry) => {
    const defsSegment = ctx.target === "draft-2020-12" ? "$defs" : "definitions";
    if (ctx.external) {
      const externalId = ctx.external.registry.get(entry[0])?.id;
      const uriGenerator = ctx.external.uri ?? ((id2) => id2);
      if (externalId) {
        return { ref: uriGenerator(externalId) };
      }
      const id = entry[1].defId ?? entry[1].schema.id ?? `schema${ctx.counter++}`;
      entry[1].defId = id;
      return { defId: id, ref: `${uriGenerator("__shared")}#/${defsSegment}/${encodeJSONPointerSegment(id)}` };
    }
    const uriPrefix = `#`;
    const defUriPrefix = `${uriPrefix}/${defsSegment}/`;
    if (entry[1] === root && !entry[1].schema.id) {
      return { ref: uriPrefix };
    }
    const defId = entry[1].schema.id ?? `__schema${ctx.counter++}`;
    return { defId, ref: defUriPrefix + encodeJSONPointerSegment(defId) };
  };
  const extractToDef = (entry) => {
    if (entry[1].schema.$ref) {
      return;
    }
    const seen = entry[1];
    const { ref, defId } = makeURI(entry);
    seen.def = { ...seen.schema };
    if (defId)
      seen.defId = defId;
    const schema2 = seen.schema;
    for (const key in schema2) {
      delete schema2[key];
    }
    schema2.$ref = ref;
  };
  if (ctx.cycles === "throw") {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.cycle) {
        throw new Error(`Cycle detected: #/${seen.cycle?.join("/")}/<root>

Set the \`cycles\` parameter to \`"ref"\` to resolve cyclical schemas with defs.`);
      }
    }
  }
  for (const entry of ctx.seen.entries()) {
    const seen = entry[1];
    if (schema === entry[0]) {
      extractToDef(entry);
      continue;
    }
    if (ctx.external) {
      const ext = ctx.external.registry.get(entry[0])?.id;
      if (schema !== entry[0] && ext) {
        extractToDef(entry);
        continue;
      }
    }
    const id = ctx.metadataRegistry.get(entry[0])?.id;
    if (id) {
      extractToDef(entry);
      continue;
    }
    if (seen.cycle) {
      extractToDef(entry);
      continue;
    }
    if (seen.count > 1) {
      if (ctx.reused === "ref") {
        extractToDef(entry);
      }
    }
  }
  if (ctx.external)
    ctx.sharedDefsExtractedFor = ctx.external;
}
function compactTypeUnion(schema) {
  const options = schema.anyOf;
  if (!Array.isArray(options) || options.length === 0 || schema.type !== void 0)
    return;
  const types = [];
  for (const option of options) {
    if (!option || typeof option !== "object")
      return;
    compactTypeUnion(option);
    const keys = Object.keys(option);
    if (keys.length !== 1 || keys[0] !== "type")
      return;
    const type = option.type;
    for (const member of Array.isArray(type) ? type : [type]) {
      if (typeof member !== "string")
        return;
      if (!types.includes(member))
        types.push(member);
    }
  }
  delete schema.anyOf;
  schema.type = types.length === 1 ? types[0] : types;
}
var FOLDABLE_KEYS = /* @__PURE__ */ new Set(["type", "properties", "required", "additionalProperties"]);
var UNION_KEYS = ["oneOf", "anyOf"];
function undeclaredConstraint(member) {
  const extra = member.additionalProperties;
  if (extra === void 0 || extra === false || typeof extra !== "object" || extra === null)
    return null;
  return Object.keys(extra).length ? extra : null;
}
function foldObjects(members2) {
  const objects = [];
  for (const member of members2) {
    if (typeof member !== "object" || member.type !== "object")
      return null;
    for (const key in member) {
      if (!FOLDABLE_KEYS.has(key))
        return null;
    }
    objects.push(member);
  }
  const properties = {};
  const required2 = /* @__PURE__ */ new Set();
  for (const object2 of objects) {
    for (const key in object2.properties) {
      if (Object.prototype.hasOwnProperty.call(properties, key))
        continue;
      const parts = [];
      for (const other of objects) {
        const part = other.properties?.[key] ?? undeclaredConstraint(other);
        if (part === null || part === void 0)
          continue;
        if (!parts.some((seen) => JSON.stringify(seen) === JSON.stringify(part)))
          parts.push(part);
      }
      const merged = parts.length === 1 ? parts[0] : foldObjects(parts) ?? { allOf: parts };
      assignProp(properties, key, merged);
    }
    for (const key of object2.required ?? [])
      required2.add(key);
  }
  const folded = { type: "object", properties };
  if (required2.size)
    folded.required = [...required2];
  if (objects.every((object2) => object2.additionalProperties === false)) {
    folded.additionalProperties = false;
  } else {
    const constraints = [];
    for (const object2 of objects) {
      const constraint = undeclaredConstraint(object2);
      if (constraint && !constraints.some((seen) => JSON.stringify(seen) === JSON.stringify(constraint)))
        constraints.push(constraint);
    }
    if (constraints.length === 1)
      folded.additionalProperties = constraints[0];
    else if (constraints.length > 1)
      folded.additionalProperties = { allOf: constraints };
  }
  return folded;
}
function foldIntersection(json) {
  const allOf = json.allOf;
  if (!Array.isArray(allOf) || allOf.length < 2)
    return;
  for (const key of FOLDABLE_KEYS)
    if (key in json)
      return;
  const unions = allOf.filter((m) => UNION_KEYS.some((k) => Array.isArray(m[k])));
  let folded = null;
  if (!unions.length) {
    folded = foldObjects(allOf);
  } else {
    const union2 = unions[0];
    const keyword = UNION_KEYS.find((k) => Array.isArray(union2[k]));
    if (Object.keys(union2).length !== 1)
      return;
    const rest = allOf.filter((m) => m !== union2);
    const branches = union2[keyword].map((branch) => foldObjects([...rest, branch]));
    if (branches.some((b) => !b))
      return;
    folded = { [keyword]: branches };
  }
  if (!folded)
    return;
  delete json.allOf;
  assignProps(json, folded);
}
function finalize(ctx, schema) {
  const root = ctx.seen.get(schema);
  if (!root)
    throw new Error("Unprocessed schema. This is a bug in Zod.");
  const flattenRef = (zodSchema) => {
    const seen = ctx.seen.get(zodSchema);
    if (seen.ref === null)
      return;
    const schema2 = seen.def ?? seen.schema;
    const _cached = { ...schema2 };
    const ref = seen.ref;
    seen.ref = null;
    if (ref) {
      flattenRef(ref);
      const refSeen = ctx.seen.get(ref);
      const refSchema = refSeen.schema;
      if (refSchema.$ref && (ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0")) {
        schema2.allOf = schema2.allOf ?? [];
        schema2.allOf.push(refSchema);
      } else {
        assignProps(schema2, refSchema);
      }
      assignProps(schema2, _cached);
      const isParentRef = zodSchema._zod.parent === ref;
      if (isParentRef) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (!(key in _cached)) {
            delete schema2[key];
          }
        }
      }
      if (refSchema.$ref && refSeen.def) {
        for (const key in schema2) {
          if (key === "$ref" || key === "allOf")
            continue;
          if (key in refSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(refSeen.def[key])) {
            delete schema2[key];
          }
        }
      }
    }
    const parent = zodSchema._zod.parent;
    if (parent && parent !== ref) {
      flattenRef(parent);
      const parentSeen = ctx.seen.get(parent);
      if (parentSeen?.schema.$ref) {
        schema2.$ref = parentSeen.schema.$ref;
        if (parentSeen.def) {
          for (const key in schema2) {
            if (key === "$ref" || key === "allOf")
              continue;
            if (key in parentSeen.def && JSON.stringify(schema2[key]) === JSON.stringify(parentSeen.def[key])) {
              delete schema2[key];
            }
          }
        }
      }
    }
    ctx.override({
      zodSchema,
      jsonSchema: schema2,
      path: seen.path ?? []
    });
  };
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of [...ctx.seen.entries()].reverse()) {
      flattenRef(entry[0]);
    }
    if (ctx.target !== "openapi-3.0") {
      for (const entry of ctx.seen.entries()) {
        compactTypeUnion(entry[1].def ?? entry[1].schema);
      }
    }
    for (const rewrite of ctx.deferred)
      rewrite();
    if (ctx.intersections.length) {
      const carriers = /* @__PURE__ */ new Map();
      for (const seen of ctx.seen.values()) {
        for (const json of [seen.schema, seen.def]) {
          const allOf = json?.allOf;
          if (!Array.isArray(allOf))
            continue;
          const existing = carriers.get(allOf);
          if (existing)
            existing.push(json);
          else
            carriers.set(allOf, [json]);
        }
      }
      for (const allOf of ctx.intersections) {
        for (const json of carriers.get(allOf) ?? [])
          foldIntersection(json);
      }
    }
  }
  const result = {};
  if (ctx.target === "draft-2020-12") {
    result.$schema = "https://json-schema.org/draft/2020-12/schema";
  } else if (ctx.target === "draft-07") {
    result.$schema = "http://json-schema.org/draft-07/schema#";
  } else if (ctx.target === "draft-04") {
    result.$schema = "http://json-schema.org/draft-04/schema#";
  } else if (ctx.target === "openapi-3.0") {
  } else {
  }
  if (ctx.external?.uri) {
    const id = ctx.external.registry.get(schema)?.id;
    if (!id)
      throw new Error("Schema is missing an `id` property");
    result.$id = ctx.external.uri(id);
  }
  assignProps(result, root.defId ? root.schema : root.def ?? root.schema);
  const rootMetaId = ctx.metadataRegistry.get(schema)?.id;
  if (rootMetaId !== void 0 && result.id === rootMetaId)
    delete result.id;
  const defs = ctx.external?.defs ?? {};
  if (!ctx.external || ctx.sharedEmitDoneFor !== ctx.external) {
    for (const entry of ctx.seen.entries()) {
      const seen = entry[1];
      if (seen.def && seen.defId) {
        if (seen.def.id === seen.defId)
          delete seen.def.id;
        assignProp(defs, seen.defId, seen.def);
      }
    }
  }
  if (ctx.external)
    ctx.sharedEmitDoneFor = ctx.external;
  if (ctx.external) {
  } else {
    if (Object.keys(defs).length > 0) {
      if (ctx.target === "draft-2020-12") {
        result.$defs = defs;
      } else {
        result.definitions = defs;
      }
    }
  }
  try {
    const finalized = JSON.parse(JSON.stringify(result));
    Object.defineProperty(finalized, "~standard", {
      value: {
        ...schema["~standard"],
        jsonSchema: {
          input: createStandardJSONSchemaMethod(schema, "input", ctx.processors),
          output: createStandardJSONSchemaMethod(schema, "output", ctx.processors)
        }
      },
      enumerable: false,
      writable: false
    });
    return finalized;
  } catch (_err) {
    throw new Error("Error converting schema to JSON.");
  }
}
function isTransforming(_schema, _ctx) {
  const ctx = _ctx ?? { seen: /* @__PURE__ */ new Set() };
  if (ctx.seen.has(_schema))
    return false;
  ctx.seen.add(_schema);
  const def = _schema._zod.def;
  if (def.type === "transform")
    return true;
  if (def.type === "array")
    return isTransforming(def.element, ctx);
  if (def.type === "set")
    return isTransforming(def.valueType, ctx);
  if (def.type === "lazy")
    return isTransforming(def.getter(), ctx);
  if (def.type === "promise" || def.type === "optional" || def.type === "nonoptional" || def.type === "nullable" || def.type === "readonly" || def.type === "default" || def.type === "prefault" || def.type === "catch") {
    return isTransforming(def.innerType, ctx);
  }
  if (def.type === "intersection") {
    return isTransforming(def.left, ctx) || isTransforming(def.right, ctx);
  }
  if (def.type === "record" || def.type === "map") {
    return isTransforming(def.keyType, ctx) || isTransforming(def.valueType, ctx);
  }
  if (def.type === "pipe") {
    if (_schema._zod.traits.has("$ZodCodec"))
      return true;
    return isTransforming(def.in, ctx) || isTransforming(def.out, ctx);
  }
  if (def.type === "object") {
    for (const key in def.shape) {
      if (isTransforming(def.shape[key], ctx))
        return true;
    }
    return false;
  }
  if (def.type === "union") {
    for (const option of def.options) {
      if (isTransforming(option, ctx))
        return true;
    }
    return false;
  }
  if (def.type === "tuple") {
    for (const item of def.items) {
      if (isTransforming(item, ctx))
        return true;
    }
    if (def.rest && isTransforming(def.rest, ctx))
      return true;
    return false;
  }
  return false;
}
var createToJSONSchemaMethod = (schema, processors = {}) => (params) => {
  const ctx = initializeContext({ ...params, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};
var createStandardJSONSchemaMethod = (schema, io, processors = {}) => (params) => {
  const { libraryOptions, target } = params ?? {};
  const ctx = initializeContext({ ...libraryOptions ?? {}, target, io, processors });
  processSchema(schema, ctx);
  extractDefs(ctx, schema);
  return finalize(ctx, schema);
};

// ../../super-agent-zcode/node_modules/zod/v4/core/json-schema-processors.js
var narrowMin = (agg, key, value) => {
  if (agg[key] === void 0 || value > agg[key])
    agg[key] = value;
};
var narrowMax = (agg, key, value) => {
  if (agg[key] === void 0 || value < agg[key])
    agg[key] = value;
};
var narrowBoth = (agg, value) => {
  narrowMin(agg, "minimum", value);
  narrowMax(agg, "maximum", value);
};
var addDivisor = (agg, value) => {
  agg.multipleOf ?? (agg.multipleOf = []);
  if (!agg.multipleOf.includes(value))
    agg.multipleOf.push(value);
};
var addPattern = (agg, pattern) => {
  agg.patterns ?? (agg.patterns = /* @__PURE__ */ new Set());
  agg.patterns.add(pattern);
};
var intersectMime = (agg, mime) => {
  agg.mime = agg.mime ? agg.mime.filter((m) => mime.includes(m)) : [...mime];
};
var setFormat = (agg, format) => {
  agg.format = format;
  if (format.includes("int"))
    agg.isInt = true;
};
var minContributor = (agg, def) => narrowMin(agg, "minimum", def.minimum);
var maxContributor = (agg, def) => narrowMax(agg, "maximum", def.maximum);
var formatContributor = (ranges) => (agg, def) => {
  setFormat(agg, def.format);
  const [minimum, maximum] = ranges[def.format];
  narrowMin(agg, "minimum", minimum);
  narrowMax(agg, "maximum", maximum);
};
var contributors = {
  greater_than: (agg, def) => narrowMin(agg, def.inclusive ? "minimum" : "exclusiveMinimum", def.value),
  less_than: (agg, def) => narrowMax(agg, def.inclusive ? "maximum" : "exclusiveMaximum", def.value),
  multiple_of: (agg, def) => addDivisor(agg, def.value),
  number_format: formatContributor(NUMBER_FORMAT_RANGES),
  bigint_format: formatContributor(BIGINT_FORMAT_RANGES),
  min_length: minContributor,
  max_length: maxContributor,
  length_equals: (agg, def) => narrowBoth(agg, def.length),
  min_size: minContributor,
  max_size: maxContributor,
  size_equals: (agg, def) => narrowBoth(agg, def.size),
  string_format: (agg, def) => {
    setFormat(agg, def.format);
    if (def.pattern)
      addPattern(agg, def.pattern);
    if (def.format === "base64" || def.format === "base64url")
      agg.contentEncoding = def.format;
    if (def.local || def.precision === -1)
      agg.laxFormat = true;
  },
  mime_type: (agg, def) => intersectMime(agg, def.mime)
};
function aggregateChecks(schema) {
  const agg = {};
  const def = schema._zod.def;
  const list = schema._zod.traits.has("$ZodCheck") ? [schema, ...def.checks ?? []] : def.checks ?? [];
  for (const ch of list)
    contributors[ch._zod.def.check]?.(agg, ch._zod.def);
  const bag = schema._zod.bag;
  if (bag.minimum !== void 0)
    narrowMin(agg, "minimum", bag.minimum);
  if (bag.exclusiveMinimum !== void 0)
    narrowMin(agg, "exclusiveMinimum", bag.exclusiveMinimum);
  if (bag.maximum !== void 0)
    narrowMax(agg, "maximum", bag.maximum);
  if (bag.exclusiveMaximum !== void 0)
    narrowMax(agg, "exclusiveMaximum", bag.exclusiveMaximum);
  if (bag.multipleOf !== void 0)
    addDivisor(agg, bag.multipleOf);
  if (bag.format !== void 0) {
    agg.format ?? (agg.format = bag.format);
    if (bag.format.includes("int"))
      agg.isInt = true;
  }
  if (bag.mime)
    intersectMime(agg, bag.mime);
  for (const pattern of bag.patterns ?? [])
    addPattern(agg, pattern);
  return agg;
}
var formatMap = {
  guid: "uuid",
  url: "uri",
  datetime: "date-time",
  json_string: "json-string",
  regex: ""
  // do not set
};
var exactPatterns = /* @__PURE__ */ new Map([
  [base64Charset, base64],
  [base64urlCharset, base64url]
]);
var exactPattern = (p) => exactPatterns.get(p) ?? p;
var stringProcessor = (schema, ctx, _json, _params) => {
  const json = _json;
  json.type = "string";
  const { minimum, maximum, format, patterns, contentEncoding, laxFormat } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minLength = minimum;
  if (typeof maximum === "number")
    json.maxLength = maximum;
  if (format) {
    json.format = formatMap[format] ?? format;
    if (json.format === "")
      delete json.format;
    if (format === "time" || laxFormat) {
      delete json.format;
    }
  }
  if (contentEncoding)
    json.contentEncoding = contentEncoding;
  if (patterns && patterns.size > 0) {
    const patternList = [...patterns].map(exactPattern);
    if (patternList.length === 1)
      json.pattern = patternList[0].source;
    else if (patternList.length > 1) {
      json.allOf = [
        ...patternList.map((regex) => ({
          ...ctx.target === "draft-07" || ctx.target === "draft-04" || ctx.target === "openapi-3.0" ? { type: "string" } : {},
          pattern: regex.source
        }))
      ];
    }
  }
};
var numberProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const { minimum, maximum, multipleOf, exclusiveMaximum, exclusiveMinimum, isInt } = aggregateChecks(schema);
  json.type = isInt ? "integer" : "number";
  const exMin = typeof exclusiveMinimum === "number" && exclusiveMinimum >= (minimum ?? Number.NEGATIVE_INFINITY);
  const exMax = typeof exclusiveMaximum === "number" && exclusiveMaximum <= (maximum ?? Number.POSITIVE_INFINITY);
  const legacy = ctx.target === "draft-04" || ctx.target === "openapi-3.0";
  if (exMin) {
    if (legacy) {
      json.minimum = exclusiveMinimum;
      json.exclusiveMinimum = true;
    } else {
      json.exclusiveMinimum = exclusiveMinimum;
    }
  } else if (typeof minimum === "number") {
    json.minimum = minimum;
  }
  if (exMax) {
    if (legacy) {
      json.maximum = exclusiveMaximum;
      json.exclusiveMaximum = true;
    } else {
      json.exclusiveMaximum = exclusiveMaximum;
    }
  } else if (typeof maximum === "number") {
    json.maximum = maximum;
  }
  if (multipleOf) {
    const divisors = /* @__PURE__ */ new Set();
    for (const divisor of multipleOf) {
      if (Number.isFinite(divisor) && divisor !== 0)
        divisors.add(Math.abs(divisor));
      else
        handleUnrepresentable(schema, ctx, json, params, `A multipleOf divisor of ${divisor} cannot be represented in JSON Schema`);
    }
    const [first, ...rest] = divisors;
    if (first !== void 0)
      json.multipleOf = first;
    if (rest.length)
      json.allOf = [...json.allOf ?? [], ...rest.map((m) => ({ multipleOf: m }))];
  }
};
var booleanProcessor = (_schema, _ctx, json, _params) => {
  json.type = "boolean";
};
var neverProcessor = (_schema, _ctx, json, _params) => {
  json.not = {};
};
var unknownProcessor = (_schema, _ctx, _json, _params) => {
};
var enumProcessor = (schema, _ctx, json, _params) => {
  const def = schema._zod.def;
  const values = getEnumValues(def.entries);
  if (values.length === 0) {
    json.not = {};
    return;
  }
  if (values.every((v) => typeof v === "number"))
    json.type = "number";
  if (values.every((v) => typeof v === "string"))
    json.type = "string";
  json.enum = values;
};
var literalProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  if (def.values.length === 0) {
    json.not = {};
    return;
  }
  const vals = [];
  for (const val of def.values) {
    if (val === void 0) {
      if (handleUnrepresentable(schema, ctx, json, params, "Literal `undefined` cannot be represented in JSON Schema"))
        return;
    } else if (typeof val === "bigint") {
      if (handleUnrepresentable(schema, ctx, json, params, "BigInt literals cannot be represented in JSON Schema"))
        return;
      vals.push(Number(val));
    } else {
      vals.push(val);
    }
  }
  if (vals.length === 0) {
  } else if (vals.length === 1) {
    const val = vals[0];
    json.type = val === null ? "null" : typeof val;
    if (ctx.target === "draft-04" || ctx.target === "openapi-3.0") {
      json.enum = [val];
    } else {
      json.const = val;
    }
  } else {
    if (vals.every((v) => typeof v === "number"))
      json.type = "number";
    if (vals.every((v) => typeof v === "string"))
      json.type = "string";
    if (vals.every((v) => typeof v === "boolean"))
      json.type = "boolean";
    if (vals.every((v) => v === null))
      json.type = "null";
    json.enum = vals;
  }
};
var customProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Custom types cannot be represented in JSON Schema");
};
var transformProcessor = (schema, ctx, json, params) => {
  handleUnrepresentable(schema, ctx, json, params, "Transforms cannot be represented in JSON Schema");
};
var arrayProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const { minimum, maximum } = aggregateChecks(schema);
  if (typeof minimum === "number")
    json.minItems = minimum;
  if (typeof maximum === "number")
    json.maxItems = maximum;
  json.type = "array";
  json.items = processSchema(def.element, ctx, {
    ...params,
    path: [...params.path, "items"]
  });
};
function inputOptin(schema) {
  const def = schema._zod.def;
  if (def.type === "pipe" && def.in._zod.traits.has("$ZodTransform")) {
    return inputOptin(def.out);
  }
  if (def.type === "catch") {
    return inputOptin(def.innerType);
  }
  return schema._zod.optin;
}
var objectProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  const shape = def.shape;
  const symbolKeys = Object.getOwnPropertySymbols(shape);
  if (symbolKeys.length && handleUnrepresentable(schema, ctx, json, params, "Symbol keys cannot be represented in JSON Schema")) {
    return;
  }
  json.type = "object";
  json.properties = {};
  for (const key in shape) {
    assignProp(json.properties, key, processSchema(shape[key], ctx, {
      ...params,
      path: [...params.path, "properties", key]
    }));
  }
  const requiredKeys = [];
  for (const key of Object.keys(shape)) {
    const field = def.shape[key];
    if (ctx.io === "input" ? inputOptin(field) === void 0 : field._zod.optout === void 0) {
      requiredKeys.push(key);
    }
  }
  if (requiredKeys.length > 0) {
    json.required = requiredKeys;
  }
  if (def.catchall?._zod.def.type === "never") {
    json.additionalProperties = false;
  } else if (!def.catchall) {
    if (ctx.io === "output")
      json.additionalProperties = false;
  } else if (def.catchall) {
    json.additionalProperties = processSchema(def.catchall, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
};
var unionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const isExclusive = def.inclusive === false;
  const options = def.options.map((x, i) => processSchema(x, ctx, {
    ...params,
    path: [...params.path, isExclusive ? "oneOf" : "anyOf", i]
  }));
  if (isExclusive) {
    json.oneOf = options;
  } else {
    json.anyOf = options;
  }
};
var intersectionProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const a = processSchema(def.left, ctx, {
    ...params,
    path: [...params.path, "allOf", 0]
  });
  const b = processSchema(def.right, ctx, {
    ...params,
    path: [...params.path, "allOf", 1]
  });
  const isSimpleIntersection = (val) => "allOf" in val && Object.keys(val).length === 1;
  const allOf = [
    ...isSimpleIntersection(a) ? a.allOf : [a],
    ...isSimpleIntersection(b) ? b.allOf : [b]
  ];
  json.allOf = allOf;
  ctx.intersections.push(allOf);
};
function stringifyKeyNames(bySchema, json, visited) {
  if (json.$ref) {
    if (visited.has(json))
      return json;
    visited.add(json);
    const def = bySchema.get(json)?.def;
    if (!def)
      return json;
    const inlined = stringifyKeyNames(bySchema, def, visited);
    return inlined === def ? json : inlined;
  }
  for (const keyword of ["anyOf", "oneOf"]) {
    const branches = json[keyword];
    if (!Array.isArray(branches))
      continue;
    const mapped = branches.map((branch) => stringifyKeyNames(bySchema, branch, visited));
    if (mapped.some((branch, i) => branch !== branches[i]))
      json = { ...json, [keyword]: mapped };
  }
  const types = Array.isArray(json.type) ? json.type : [json.type];
  const numericType = !types.includes("string") && types.some((t) => t === "number" || t === "integer");
  const values = json.enum ?? (json.const !== void 0 ? [json.const] : void 0);
  if (!numericType && !values?.some((v) => typeof v === "number"))
    return json;
  const { minimum, maximum, exclusiveMinimum, exclusiveMaximum, multipleOf, format, id, ...rest } = json;
  if (rest.enum)
    rest.enum = rest.enum.map((v) => typeof v === "number" ? String(v) : v);
  else if (typeof rest.const === "number")
    rest.const = String(rest.const);
  if (!numericType)
    return rest;
  rest.type = "string";
  if (!values)
    rest.pattern = (types.includes("number") ? number : integer).source;
  return rest;
}
var pendingRecords = /* @__PURE__ */ new WeakMap();
function rewriteKeyNames(ctx) {
  const bySchema = /* @__PURE__ */ new Map();
  for (const entry of ctx.seen.values()) {
    if (entry.def && !bySchema.has(entry.schema))
      bySchema.set(entry.schema, entry);
  }
  const rewrites = /* @__PURE__ */ new Map();
  for (const record2 of pendingRecords.get(ctx) ?? []) {
    const seen = ctx.seen.get(record2);
    const names = (seen?.def ?? seen?.schema)?.propertyNames;
    if (!names || names === true || rewrites.has(names))
      continue;
    const rewritten = stringifyKeyNames(bySchema, names, /* @__PURE__ */ new Set());
    if (rewritten !== names)
      rewrites.set(names, rewritten);
  }
  if (!rewrites.size)
    return;
  for (const entry of ctx.seen.values()) {
    for (const carrier of [entry.schema, entry.def]) {
      const rewritten = carrier && rewrites.get(carrier.propertyNames);
      if (rewritten)
        carrier.propertyNames = rewritten;
    }
  }
}
var recordProcessor = (schema, ctx, _json, params) => {
  const json = _json;
  const def = schema._zod.def;
  json.type = "object";
  const keyType = def.keyType;
  const patterns = aggregateChecks(keyType).patterns;
  if (def.mode === "loose" && patterns && patterns.size > 0) {
    const valueSchema = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "patternProperties", "*"]
    });
    json.patternProperties = {};
    for (const pattern of patterns) {
      assignProp(json.patternProperties, exactPattern(pattern).source, valueSchema);
    }
  } else {
    if (ctx.target === "draft-07" || ctx.target === "draft-2020-12") {
      json.propertyNames = processSchema(def.keyType, ctx, {
        ...params,
        path: [...params.path, "propertyNames"]
      });
      let pending = pendingRecords.get(ctx);
      if (!pending) {
        pending = [];
        pendingRecords.set(ctx, pending);
        ctx.deferred.push(() => rewriteKeyNames(ctx));
      }
      pending.push(schema);
    }
    json.additionalProperties = processSchema(def.valueType, ctx, {
      ...params,
      path: [...params.path, "additionalProperties"]
    });
  }
  const keyValues = keyType._zod.values;
  const omittableOnInput = ctx.io === "input" && inputOptin(def.valueType) !== void 0;
  if (keyValues && !def.partial && !omittableOnInput) {
    const validKeyValues = [...keyValues].filter((v) => typeof v === "string" || typeof v === "number");
    if (validKeyValues.length > 0) {
      json.required = validKeyValues.map(String);
    }
  }
};
var nullableProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  const inner = processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  if (ctx.target === "openapi-3.0") {
    seen.ref = def.innerType;
    json.nullable = true;
  } else {
    json.anyOf = [inner, { type: "null" }];
  }
};
var nonoptionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};
var UNREPRESENTABLE_DEFAULT = /* @__PURE__ */ Symbol();
function serializeDefaultValue(value, schema, ctx, json, params) {
  let unrepresentable = false;
  const serialized = JSON.stringify(value, (_, val) => {
    if (typeof val !== "bigint")
      return val;
    unrepresentable = true;
    return null;
  });
  if (!unrepresentable)
    return JSON.parse(serialized);
  handleUnrepresentable(schema, ctx, json, params, "BigInt defaults cannot be represented in JSON Schema");
  return UNREPRESENTABLE_DEFAULT;
}
var defaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json.default = value;
};
var prefaultProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  if (ctx.io !== "input")
    return;
  const value = serializeDefaultValue(def.defaultValue, schema, ctx, json, params);
  if (value !== UNREPRESENTABLE_DEFAULT)
    json._prefault = value;
};
var catchProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  let catchValue;
  try {
    catchValue = def.catchValue(void 0);
  } catch {
    handleUnrepresentable(schema, ctx, json, params, "Dynamic catch values are not supported in JSON Schema");
    return;
  }
  json.default = catchValue;
};
var pipeProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  const inIsTransform = def.in._zod.traits.has("$ZodTransform");
  const innerType = ctx.io === "input" ? inIsTransform ? def.out : def.in : def.out;
  processSchema(innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = innerType;
};
var readonlyProcessor = (schema, ctx, json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
  json.readOnly = true;
};
var optionalProcessor = (schema, ctx, _json, params) => {
  const def = schema._zod.def;
  processSchema(def.innerType, ctx, params);
  const seen = ctx.seen.get(schema);
  seen.ref = def.innerType;
};

// ../../super-agent-zcode/node_modules/zod/v4/classic/errors.js
var _installedErrorProtos = /* @__PURE__ */ new WeakSet([Object.prototype, Error.prototype]);
function _lazyMethod(proto, key, make) {
  Object.defineProperty(proto, key, {
    configurable: true,
    enumerable: false,
    get() {
      const value = make(this);
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
      return value;
    },
    set(value) {
      Object.defineProperty(this, key, { value, configurable: true, writable: true });
    }
  });
}
var initializer2 = (inst, issues) => {
  $ZodError.init(inst, issues);
  inst.name = "ZodError";
  const proto = Object.getPrototypeOf(inst);
  if (_installedErrorProtos.has(proto))
    return;
  _installedErrorProtos.add(proto);
  _lazyMethod(proto, "format", (self) => (mapper) => formatError(self, mapper));
  _lazyMethod(proto, "flatten", (self) => (mapper) => flattenError(self, mapper));
  _lazyMethod(proto, "addIssue", (self) => (issue2) => {
    self.issues.push(issue2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  _lazyMethod(proto, "addIssues", (self) => (issues2) => {
    self.issues.push(...issues2);
    self.message = JSON.stringify(self.issues, jsonStringifyReplacer, 2);
  });
  Object.defineProperty(proto, "isEmpty", {
    configurable: true,
    enumerable: false,
    get() {
      return this.issues.length === 0;
    }
  });
};
var ZodRealError = /* @__PURE__ */ $constructor("ZodError", initializer2, void 0, {
  Parent: Error
});

// ../../super-agent-zcode/node_modules/zod/v4/classic/parse.js
var parse = /* @__PURE__ */ _parse(ZodRealError);
var parseAsync = /* @__PURE__ */ _parseAsync(ZodRealError);
var safeParse = /* @__PURE__ */ _safeParse(ZodRealError);
var safeParseAsync = /* @__PURE__ */ _safeParseAsync(ZodRealError);
var encode = /* @__PURE__ */ _encode(ZodRealError);
var decode = /* @__PURE__ */ _decode(ZodRealError);
var encodeAsync = /* @__PURE__ */ _encodeAsync(ZodRealError);
var decodeAsync = /* @__PURE__ */ _decodeAsync(ZodRealError);
var safeEncode = /* @__PURE__ */ _safeEncode(ZodRealError);
var safeDecode = /* @__PURE__ */ _safeDecode(ZodRealError);
var safeEncodeAsync = /* @__PURE__ */ _safeEncodeAsync(ZodRealError);
var safeDecodeAsync = /* @__PURE__ */ _safeDecodeAsync(ZodRealError);

// ../../super-agent-zcode/node_modules/zod/v4/classic/schemas.js
function _ensureDefaultLocale() {
  if (!globalConfig.localeError)
    config(en_default());
}
function _ensureDefaultMemoizer() {
  if (!globalConfig.memoizer)
    config({ memoizer: memoizer() });
}
var ZodType = /* @__PURE__ */ $constructor("ZodType", (inst, def) => {
  _ensureDefaultLocale();
  $ZodType.init(inst, def);
  inst.def = def;
  inst.type = def.type;
  return inst;
}, {
  check(...chks) {
    const def = this.def;
    return this.clone(util_exports.mergeDefs(def, {
      checks: [
        ...def.checks ?? [],
        ...chks.map((ch) => typeof ch === "function" ? { _zod: { check: ch, def: { check: "custom" }, onattach: [] } } : ch)
      ]
    }), { parent: true });
  },
  with(...chks) {
    return this.check(...chks);
  },
  clone(def, params) {
    return clone(this, def, params);
  },
  brand() {
    return this;
  },
  register(reg, meta2) {
    reg.add(this, meta2);
    return this;
  },
  refine(check, params) {
    return this.check(refine(check, params));
  },
  superRefine(refinement, params) {
    return this.check(superRefine(refinement, params));
  },
  overwrite(fn) {
    return this.check(_overwrite(fn));
  },
  optional() {
    return optional(this);
  },
  exactOptional() {
    return exactOptional(this);
  },
  nullable() {
    return nullable(this);
  },
  nullish() {
    return optional(nullable(this));
  },
  nonoptional(params) {
    return nonoptional(this, params);
  },
  array() {
    return array(this);
  },
  or(arg) {
    return union([this, arg]);
  },
  and(arg) {
    return intersection(this, arg);
  },
  transform(tx) {
    return pipe(this, transform(tx));
  },
  default(d) {
    return _default(this, d);
  },
  prefault(d) {
    return prefault(this, d);
  },
  catch(params) {
    return _catch(this, params);
  },
  pipe(target) {
    return pipe(this, target);
  },
  readonly() {
    return readonly(this);
  },
  describe(description) {
    const cl = this.clone();
    globalRegistry.add(cl, { description });
    return cl;
  },
  meta(...args) {
    if (args.length === 0)
      return globalRegistry.get(this);
    const cl = this.clone();
    globalRegistry.add(cl, args[0]);
    return cl;
  },
  isOptional() {
    return this.safeParse(void 0).success;
  },
  isNullable() {
    return this.safeParse(null).success;
  },
  apply(fn, ...args) {
    return args.length === 0 ? fn(this) : fn(this, ...args);
  },
  // Overrides core's `~standard` to add `jsonSchema`. Must stay a prototype entry: redefining it per instance demotes instances to dictionary mode.
  get "~standard"() {
    return util_exports.hide(this, "~standard", {
      ...standardProps(this),
      jsonSchema: {
        input: createStandardJSONSchemaMethod(this, "input"),
        output: createStandardJSONSchemaMethod(this, "output")
      }
    });
  },
  set "~standard"(value) {
    util_exports.own(this, "~standard", value);
  },
  parse: function _parse2(data, params) {
    return parse(this, data, params, { callee: _parse2 });
  },
  parseAsync: async function _parseAsync2(data, params) {
    return await parseAsync(this, data, params, { callee: _parseAsync2 });
  },
  safeParse(data, params) {
    return safeParse(this, data, params);
  },
  async safeParseAsync(data, params) {
    return safeParseAsync(this, data, params);
  },
  // `spa` is an alias: same function object as `safeParseAsync`, as before.
  get spa() {
    return this?.safeParseAsync;
  },
  set spa(value) {
    util_exports.own(this, "spa", value);
  },
  validate(data, params) {
    return validate(this, data, params);
  },
  validateAsync(data, params) {
    return validateAsync(this, data, params);
  },
  encode: function _encode2(data, params) {
    return encode(this, data, params, { callee: _encode2 });
  },
  decode: function _decode2(data, params) {
    return decode(this, data, params, { callee: _decode2 });
  },
  encodeAsync: async function _encodeAsync2(data, params) {
    return await encodeAsync(this, data, params, { callee: _encodeAsync2 });
  },
  decodeAsync: async function _decodeAsync2(data, params) {
    return await decodeAsync(this, data, params, { callee: _decodeAsync2 });
  },
  safeEncode(data, params) {
    return safeEncode(this, data, params);
  },
  safeDecode(data, params) {
    return safeDecode(this, data, params);
  },
  async safeEncodeAsync(data, params) {
    return safeEncodeAsync(this, data, params);
  },
  async safeDecodeAsync(data, params) {
    return safeDecodeAsync(this, data, params);
  },
  toJSONSchema(params) {
    return createToJSONSchemaMethod(this, {})(params);
  },
  // Reads through to the registry on every access, so it must not cache.
  get description() {
    return globalRegistry.get(this)?.description;
  },
  // No setter: `schema._def = x` throws, as it did when `_def` was a non-writable own property.
  get _def() {
    return this._zod.def;
  }
});
var _ZodString = /* @__PURE__ */ $constructor(
  "_ZodString",
  (inst, def) => {
    $ZodString.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => stringProcessor(inst, ctx, json, params);
  },
  /* @__PURE__ */ util_exports.derived({
    format: (inst) => aggregateChecks(inst).format ?? null,
    minLength: (inst) => aggregateChecks(inst).minimum ?? null,
    maxLength: (inst) => aggregateChecks(inst).maximum ?? null
  }, {
    regex(...args) {
      return this.check(_regex(...args));
    },
    includes(...args) {
      return this.check(_includes(...args));
    },
    startsWith(...args) {
      return this.check(_startsWith(...args));
    },
    endsWith(...args) {
      return this.check(_endsWith(...args));
    },
    min(...args) {
      return this.check(_minLength(...args));
    },
    max(...args) {
      return this.check(_maxLength(...args));
    },
    length(...args) {
      return this.check(_length(...args));
    },
    nonempty(...args) {
      return this.check(_minLength(1, ...args));
    },
    lowercase(params) {
      return this.check(_lowercase(params));
    },
    uppercase(params) {
      return this.check(_uppercase(params));
    },
    trim() {
      return this.check(_trim());
    },
    normalize(...args) {
      return this.check(_normalize(...args));
    },
    toLowerCase() {
      return this.check(_toLowerCase());
    },
    toUpperCase() {
      return this.check(_toUpperCase());
    },
    slugify() {
      return this.check(_slugify());
    }
  })
);
var ZodString = /* @__PURE__ */ $constructor("ZodString", (inst, def) => {
  $ZodString.init(inst, def);
  _ZodString.init(inst, def);
}, {
  email(params) {
    return this.check(_email(ZodEmail, params));
  },
  url(params) {
    return this.check(_url(ZodURL, params));
  },
  jwt(params) {
    return this.check(_jwt(ZodJWT, params));
  },
  emoji(params) {
    return this.check(_emoji2(ZodEmoji, params));
  },
  guid(params) {
    return this.check(_guid(ZodGUID, params));
  },
  uuid(params) {
    return this.check(_uuid(ZodUUID, params));
  },
  uuidv4(params) {
    return this.check(_uuidv4(ZodUUID, params));
  },
  uuidv6(params) {
    return this.check(_uuidv6(ZodUUID, params));
  },
  uuidv7(params) {
    return this.check(_uuidv7(ZodUUID, params));
  },
  nanoid(params) {
    return this.check(_nanoid(ZodNanoID, params));
  },
  cuid(params) {
    return this.check(_cuid(ZodCUID, params));
  },
  cuid2(params) {
    return this.check(_cuid2(ZodCUID2, params));
  },
  ulid(params) {
    return this.check(_ulid(ZodULID, params));
  },
  base64(params) {
    return this.check(_base64(ZodBase64, params));
  },
  base64url(params) {
    return this.check(_base64url(ZodBase64URL, params));
  },
  xid(params) {
    return this.check(_xid(ZodXID, params));
  },
  ksuid(params) {
    return this.check(_ksuid(ZodKSUID, params));
  },
  ipv4(params) {
    return this.check(_ipv4(ZodIPv4, params));
  },
  ipv6(params) {
    return this.check(_ipv6(ZodIPv6, params));
  },
  cidrv4(params) {
    return this.check(_cidrv4(ZodCIDRv4, params));
  },
  cidrv6(params) {
    return this.check(_cidrv6(ZodCIDRv6, params));
  },
  e164(params) {
    return this.check(_e164(ZodE164, params));
  },
  datetime(params) {
    return this.check(_isoDateTime(ZodISODateTime, params));
  },
  date(params) {
    return this.check(_isoDate(ZodISODate, params));
  },
  time(params) {
    return this.check(_isoTime(ZodISOTime, params));
  },
  duration(params) {
    return this.check(_isoDuration(ZodISODuration, params));
  }
});
function string2(params) {
  return _string(ZodString, params);
}
var ZodStringFormat = /* @__PURE__ */ $constructor("ZodStringFormat", (inst, def) => {
  $ZodStringFormat.init(inst, def);
  _ZodString.init(inst, def);
});
var ZodISODateTime = /* @__PURE__ */ $constructor("ZodISODateTime", (inst, def) => {
  $ZodISODateTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODate = /* @__PURE__ */ $constructor("ZodISODate", (inst, def) => {
  $ZodISODate.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISOTime = /* @__PURE__ */ $constructor("ZodISOTime", (inst, def) => {
  $ZodISOTime.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodISODuration = /* @__PURE__ */ $constructor("ZodISODuration", (inst, def) => {
  $ZodISODuration.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodEmail = /* @__PURE__ */ $constructor("ZodEmail", (inst, def) => {
  $ZodEmail.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodGUID = /* @__PURE__ */ $constructor("ZodGUID", (inst, def) => {
  $ZodGUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodUUID = /* @__PURE__ */ $constructor("ZodUUID", (inst, def) => {
  $ZodUUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodURL = /* @__PURE__ */ $constructor("ZodURL", (inst, def) => {
  $ZodURL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
function url(params) {
  return _url(ZodURL, params);
}
var ZodEmoji = /* @__PURE__ */ $constructor("ZodEmoji", (inst, def) => {
  $ZodEmoji.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNanoID = /* @__PURE__ */ $constructor("ZodNanoID", (inst, def) => {
  $ZodNanoID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID = /* @__PURE__ */ $constructor("ZodCUID", (inst, def) => {
  $ZodCUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCUID2 = /* @__PURE__ */ $constructor("ZodCUID2", (inst, def) => {
  $ZodCUID2.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodULID = /* @__PURE__ */ $constructor("ZodULID", (inst, def) => {
  $ZodULID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodXID = /* @__PURE__ */ $constructor("ZodXID", (inst, def) => {
  $ZodXID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodKSUID = /* @__PURE__ */ $constructor("ZodKSUID", (inst, def) => {
  $ZodKSUID.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv4 = /* @__PURE__ */ $constructor("ZodIPv4", (inst, def) => {
  $ZodIPv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodIPv6 = /* @__PURE__ */ $constructor("ZodIPv6", (inst, def) => {
  $ZodIPv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv4 = /* @__PURE__ */ $constructor("ZodCIDRv4", (inst, def) => {
  $ZodCIDRv4.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodCIDRv6 = /* @__PURE__ */ $constructor("ZodCIDRv6", (inst, def) => {
  $ZodCIDRv6.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64 = /* @__PURE__ */ $constructor("ZodBase64", (inst, def) => {
  $ZodBase64.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodBase64URL = /* @__PURE__ */ $constructor("ZodBase64URL", (inst, def) => {
  $ZodBase64URL.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodE164 = /* @__PURE__ */ $constructor("ZodE164", (inst, def) => {
  $ZodE164.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodJWT = /* @__PURE__ */ $constructor("ZodJWT", (inst, def) => {
  $ZodJWT.init(inst, def);
  ZodStringFormat.init(inst, def);
});
var ZodNumber = /* @__PURE__ */ $constructor(
  "ZodNumber",
  (inst, def) => {
    $ZodNumber.init(inst, def);
    ZodType.init(inst, def);
    inst._zod.processJSONSchema = (ctx, json, params) => numberProcessor(inst, ctx, json, params);
    inst.isFinite = true;
  },
  /* @__PURE__ */ util_exports.derived({
    minValue: (inst) => {
      const { minimum, exclusiveMinimum } = aggregateChecks(inst);
      return Math.max(minimum ?? Number.NEGATIVE_INFINITY, exclusiveMinimum ?? Number.NEGATIVE_INFINITY);
    },
    maxValue: (inst) => {
      const { maximum, exclusiveMaximum } = aggregateChecks(inst);
      return Math.min(maximum ?? Number.POSITIVE_INFINITY, exclusiveMaximum ?? Number.POSITIVE_INFINITY);
    },
    isInt: (inst) => {
      const { isInt, multipleOf } = aggregateChecks(inst);
      return !!isInt || !!multipleOf?.some(Number.isSafeInteger);
    },
    format: (inst) => aggregateChecks(inst).format ?? null
  }, {
    gt(value, params) {
      return this.check(_gt(value, params));
    },
    gte(value, params) {
      return this.check(_gte(value, params));
    },
    min(value, params) {
      return this.check(_gte(value, params));
    },
    lt(value, params) {
      return this.check(_lt(value, params));
    },
    lte(value, params) {
      return this.check(_lte(value, params));
    },
    max(value, params) {
      return this.check(_lte(value, params));
    },
    int(params) {
      return this.check(int(params));
    },
    safe(params) {
      return this.check(int(params));
    },
    positive(params) {
      return this.check(_gt(0, params));
    },
    nonnegative(params) {
      return this.check(_gte(0, params));
    },
    negative(params) {
      return this.check(_lt(0, params));
    },
    nonpositive(params) {
      return this.check(_lte(0, params));
    },
    multipleOf(value, params) {
      return this.check(_multipleOf(value, params));
    },
    step(value, params) {
      return this.check(_multipleOf(value, params));
    },
    finite() {
      return this;
    }
  })
);
function number2(params) {
  return _number(ZodNumber, params);
}
var ZodNumberFormat = /* @__PURE__ */ $constructor("ZodNumberFormat", (inst, def) => {
  $ZodNumberFormat.init(inst, def);
  ZodNumber.init(inst, def);
});
function int(params) {
  return _int(ZodNumberFormat, params);
}
var ZodBoolean = /* @__PURE__ */ $constructor("ZodBoolean", (inst, def) => {
  $ZodBoolean.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => booleanProcessor(inst, ctx, json, params);
});
function boolean2(params) {
  return _boolean(ZodBoolean, params);
}
var ZodUnknown = /* @__PURE__ */ $constructor("ZodUnknown", (inst, def) => {
  $ZodUnknown.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unknownProcessor(inst, ctx, json, params);
});
function unknown() {
  return _unknown(ZodUnknown);
}
var ZodNever = /* @__PURE__ */ $constructor("ZodNever", (inst, def) => {
  $ZodNever.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => neverProcessor(inst, ctx, json, params);
});
function never(params) {
  return _never(ZodNever, params);
}
var ZodArray = /* @__PURE__ */ $constructor("ZodArray", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodArray.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => arrayProcessor(inst, ctx, json, params);
  inst.element = def.element;
}, {
  min(n, params) {
    return this.check(_minLength(n, params));
  },
  nonempty(params) {
    return this.check(_minLength(1, params));
  },
  max(n, params) {
    return this.check(_maxLength(n, params));
  },
  length(n, params) {
    return this.check(_length(n, params));
  },
  unwrap() {
    return this.element;
  }
});
function array(element, params) {
  return _array(ZodArray, element, params);
}
var ZodObject = /* @__PURE__ */ $constructor("ZodObject", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodObjectJIT.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => objectProcessor(inst, ctx, json, params);
  util_exports.installLazyProp(inst, "shape", (self) => self._zod.def.shape, false);
}, {
  keyof() {
    return _enum(Object.keys(this._zod.def.shape));
  },
  catchall(catchall) {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall }));
  },
  passthrough() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  loose() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: unknown() }));
  },
  strict() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: never() }));
  },
  strip() {
    return this.clone(util_exports.mergeDefs(this._zod.def, { catchall: void 0 }));
  },
  extend(incoming) {
    return util_exports.extend(this, incoming);
  },
  safeExtend(incoming) {
    return util_exports.safeExtend(this, incoming);
  },
  merge(other) {
    return util_exports.merge(this, other);
  },
  pick(mask) {
    return util_exports.pick(this, mask);
  },
  omit(mask) {
    return util_exports.omit(this, mask);
  },
  partial(...args) {
    return util_exports.partial(ZodOptional, this, args[0]);
  },
  exactPartial(...args) {
    return util_exports.partial(ZodExactOptional, this, args[0], "exactPartial");
  },
  required(...args) {
    return util_exports.required(ZodNonOptional, this, args[0]);
  }
});
function object(shape, params) {
  const def = {
    type: "object",
    shape: shape ?? {},
    ...util_exports.normalizeParams(params)
  };
  return new ZodObject(def);
}
var ZodUnion = /* @__PURE__ */ $constructor("ZodUnion", (inst, def) => {
  $ZodUnion.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => unionProcessor(inst, ctx, json, params);
  inst.options = def.options;
});
function union(options, params) {
  return new ZodUnion({
    type: "union",
    options,
    ...util_exports.normalizeParams(params)
  });
}
var ZodIntersection = /* @__PURE__ */ $constructor("ZodIntersection", (inst, def) => {
  $ZodIntersection.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => intersectionProcessor(inst, ctx, json, params);
});
function intersection(left, right) {
  return new ZodIntersection({
    type: "intersection",
    left,
    right
  });
}
var ZodRecord = /* @__PURE__ */ $constructor("ZodRecord", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodRecord.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => recordProcessor(inst, ctx, json, params);
  inst.keyType = def.keyType;
  inst.valueType = def.valueType;
});
function record(keyType, valueType, params) {
  if (!valueType || !valueType._zod) {
    return new ZodRecord({
      type: "record",
      keyType: string2(),
      valueType: keyType,
      ...util_exports.normalizeParams(valueType)
    });
  }
  return new ZodRecord({
    type: "record",
    keyType,
    valueType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodEnum = /* @__PURE__ */ $constructor("ZodEnum", (inst, def) => {
  $ZodEnum.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => enumProcessor(inst, ctx, json, params);
  inst.enum = def.entries;
  inst.options = [...inst._zod.values];
  const keys = new Set(Object.keys(def.entries));
  inst.extract = (values, params) => {
    const newEntries = {};
    for (const value of values) {
      if (keys.has(value)) {
        newEntries[value] = def.entries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
  inst.exclude = (values, params) => {
    const newEntries = { ...def.entries };
    for (const value of values) {
      if (keys.has(value)) {
        delete newEntries[value];
      } else
        throw new Error(`Key ${value} not found in enum`);
    }
    return new ZodEnum({
      ...def,
      checks: [],
      ...util_exports.normalizeParams(params),
      entries: newEntries
    });
  };
});
function _enum(values, params) {
  const entries = Array.isArray(values) ? Object.fromEntries(values.map((v) => [v, v])) : values;
  return new ZodEnum({
    type: "enum",
    entries,
    ...util_exports.normalizeParams(params)
  });
}
var ZodLiteral = /* @__PURE__ */ $constructor("ZodLiteral", (inst, def) => {
  $ZodLiteral.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => literalProcessor(inst, ctx, json, params);
  inst.values = new Set(def.values);
  Object.defineProperty(inst, "value", {
    get() {
      if (def.values.length > 1) {
        throw new Error("This schema contains multiple valid literal values. Use `.values` instead.");
      }
      return def.values[0];
    }
  });
});
function literal(value, params) {
  return new ZodLiteral({
    type: "literal",
    values: Array.isArray(value) ? value : [value],
    ...util_exports.normalizeParams(params)
  });
}
var ZodTransform = /* @__PURE__ */ $constructor("ZodTransform", (inst, def) => {
  _ensureDefaultMemoizer();
  $ZodTransform.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => transformProcessor(inst, ctx, json, params);
  inst._zod.parse = (payload, _ctx) => {
    if (_ctx.direction === "backward") {
      throw new $ZodEncodeError(inst.constructor.name);
    }
    payload.addIssue = (issue2) => {
      if (typeof issue2 === "string") {
        payload.issues.push(util_exports.issue(issue2, payload.value, def));
      } else {
        const _issue = issue2;
        if (_issue.fatal)
          _issue.continue = false;
        _issue.code ?? (_issue.code = "custom");
        if (!("input" in _issue))
          _issue.input = payload.value;
        _issue.inst ?? (_issue.inst = inst);
        payload.issues.push(util_exports.issue(_issue));
      }
    };
    const output = def.transform(payload.value, payload);
    if (output instanceof Promise) {
      return output.then((output2) => {
        payload.value = output2;
        return payload;
      });
    }
    payload.value = output;
    return payload;
  };
});
function transform(fn) {
  return new ZodTransform({
    type: "transform",
    transform: fn
  });
}
var ZodOptional = /* @__PURE__ */ $constructor("ZodOptional", (inst, def) => {
  $ZodOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function optional(innerType) {
  return new ZodOptional({
    type: "optional",
    innerType
  });
}
var ZodExactOptional = /* @__PURE__ */ $constructor("ZodExactOptional", (inst, def) => {
  $ZodExactOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => optionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function exactOptional(innerType) {
  return new ZodExactOptional({
    type: "optional",
    innerType
  });
}
var ZodNullable = /* @__PURE__ */ $constructor("ZodNullable", (inst, def) => {
  $ZodNullable.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nullableProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nullable(innerType) {
  return new ZodNullable({
    type: "nullable",
    innerType
  });
}
var ZodDefault = /* @__PURE__ */ $constructor("ZodDefault", (inst, def) => {
  $ZodDefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => defaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeDefault = inst.unwrap;
});
function _default(innerType, defaultValue) {
  return new ZodDefault({
    type: "default",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodPrefault = /* @__PURE__ */ $constructor("ZodPrefault", (inst, def) => {
  $ZodPrefault.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => prefaultProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function prefault(innerType, defaultValue) {
  return new ZodPrefault({
    type: "prefault",
    innerType,
    get defaultValue() {
      return typeof defaultValue === "function" ? defaultValue() : util_exports.shallowClone(defaultValue);
    }
  });
}
var ZodNonOptional = /* @__PURE__ */ $constructor("ZodNonOptional", (inst, def) => {
  $ZodNonOptional.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => nonoptionalProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function nonoptional(innerType, params) {
  return new ZodNonOptional({
    type: "nonoptional",
    innerType,
    ...util_exports.normalizeParams(params)
  });
}
var ZodCatch = /* @__PURE__ */ $constructor("ZodCatch", (inst, def) => {
  $ZodCatch.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => catchProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
  inst.removeCatch = inst.unwrap;
});
function _catch(innerType, catchValue) {
  return new ZodCatch({
    type: "catch",
    innerType,
    catchValue: typeof catchValue === "function" ? catchValue : util_exports.constantCatch(catchValue)
  });
}
var ZodPipe = /* @__PURE__ */ $constructor("ZodPipe", (inst, def) => {
  $ZodPipe.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => pipeProcessor(inst, ctx, json, params);
  inst.in = def.in;
  inst.out = def.out;
});
function pipe(in_, out) {
  return new ZodPipe({
    type: "pipe",
    in: in_,
    out
    // ...util.normalizeParams(params),
  });
}
var ZodPreprocess = /* @__PURE__ */ $constructor("ZodPreprocess", (inst, def) => {
  ZodPipe.init(inst, def);
  $ZodPreprocess.init(inst, def);
});
var ZodReadonly = /* @__PURE__ */ $constructor("ZodReadonly", (inst, def) => {
  $ZodReadonly.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => readonlyProcessor(inst, ctx, json, params);
  inst.unwrap = () => inst._zod.def.innerType;
});
function readonly(innerType) {
  return new ZodReadonly({
    type: "readonly",
    innerType
  });
}
var ZodCustom = /* @__PURE__ */ $constructor("ZodCustom", (inst, def) => {
  $ZodCustom.init(inst, def);
  ZodType.init(inst, def);
  inst._zod.processJSONSchema = (ctx, json, params) => customProcessor(inst, ctx, json, params);
});
function refine(fn, _params = {}) {
  return _refine(ZodCustom, fn, _params);
}
function superRefine(fn, params) {
  return _superRefine(fn, params);
}
function preprocess(fn, schema) {
  return new ZodPreprocess({
    type: "pipe",
    in: transform(fn),
    out: schema
  });
}

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/core/schema-deserialize.js
var skippedItem = /* @__PURE__ */ Symbol("skippedItem");
function defaultOnError(schema, fallback) {
  return schema.catch(fallback);
}
function requiredDefaultOnError(schema, fallback) {
  const schemaWithCatch = schema.catch(fallback);
  return unknown().transform((value, context) => {
    if (value !== void 0)
      return schemaWithCatch.parse(value);
    context.addIssue({
      code: "custom",
      message: "Required value is missing"
    });
    return NEVER;
  });
}
function stringTag(value, key) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return void 0;
  }
  const tag = value[key];
  return typeof tag === "string" ? tag : void 0;
}
function excludeKnownTags(schema, key, knownTags) {
  return schema.superRefine((value, context) => {
    const tag = stringTag(value, key);
    if (tag !== void 0 && knownTags.includes(tag)) {
      context.addIssue({
        code: "custom",
        path: [key],
        message: `${key} ${JSON.stringify(tag)} is reserved by a known variant, but the value does not match that variant's schema`
      });
    }
  });
}
function preserveCustomPayload(schema, key, knownTags) {
  return unknown().transform((value, context) => {
    const result = schema.safeParse(value);
    if (!result.success) {
      for (const issue2 of result.error.issues) {
        context.addIssue({ ...issue2, input: value });
      }
      return NEVER;
    }
    const output = result.data;
    const tag = stringTag(value, key);
    if (tag !== void 0 && !knownTags.includes(tag)) {
      const raw = value;
      for (const [property, rawValue] of Object.entries(raw)) {
        if (property === "__proto__")
          continue;
        if (!Object.hasOwn(output, property))
          output[property] = rawValue;
      }
    }
    return output;
  });
}
function vecSkipError(itemSchema) {
  return array(itemSchema.catch(skippedItem)).transform((items) => items.filter((item) => item !== skippedItem));
}
function defaultOnNull(schema, empty) {
  return preprocess((value) => value === null ? empty() : value, schema);
}
function wideInt() {
  return number2().refine(Number.isInteger, {
    error: "Invalid input: expected int, received number"
  });
}

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/v1/schema/zod.gen.js
var zRequestId = union([wideInt(), string2()]).nullable();
var zSessionId = string2();
var zWriteTextFileRequest = object({
  sessionId: zSessionId,
  path: string2(),
  content: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zReadTextFileRequest = object({
  sessionId: zSessionId,
  path: string2(),
  line: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(),
  limit: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zToolCallId = string2();
var zToolKind = union([
  literal("read"),
  literal("edit"),
  literal("delete"),
  literal("move"),
  literal("search"),
  literal("execute"),
  literal("think"),
  literal("fetch"),
  literal("switch_mode"),
  literal("other")
]);
var zToolCallStatus = union([
  literal("pending"),
  literal("in_progress"),
  literal("completed"),
  literal("failed")
]);
var zRole = union([literal("assistant"), literal("user")]);
var zAnnotations = object({
  audience: defaultOnError(vecSkipError(zRole).nullish(), () => void 0),
  lastModified: defaultOnError(string2().nullish(), () => void 0),
  priority: defaultOnError(number2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zTextContent = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  text: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zImageContent = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  data: string2(),
  mimeType: string2(),
  uri: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAudioContent = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  data: string2(),
  mimeType: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zResourceLink = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  description: defaultOnError(string2().nullish(), () => void 0),
  mimeType: defaultOnError(string2().nullish(), () => void 0),
  name: string2(),
  size: defaultOnError(wideInt().nullish(), () => void 0),
  title: defaultOnError(string2().nullish(), () => void 0),
  uri: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zTextResourceContents = object({
  mimeType: defaultOnError(string2().nullish(), () => void 0),
  text: string2(),
  uri: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zBlobResourceContents = object({
  blob: string2(),
  mimeType: defaultOnError(string2().nullish(), () => void 0),
  uri: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zEmbeddedResourceResource = union([
  zTextResourceContents,
  zBlobResourceContents
]);
var zEmbeddedResource = object({
  annotations: defaultOnError(zAnnotations.nullish(), () => void 0),
  resource: zEmbeddedResourceResource,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zContentBlock = union([
  zTextContent.and(object({
    type: literal("text")
  })),
  zImageContent.and(object({
    type: literal("image")
  })),
  zAudioContent.and(object({
    type: literal("audio")
  })),
  zResourceLink.and(object({
    type: literal("resource_link")
  })),
  zEmbeddedResource.and(object({
    type: literal("resource")
  }))
]);
var zContent = object({
  content: zContentBlock,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zDiff = object({
  path: string2(),
  oldText: defaultOnError(string2().nullish(), () => void 0),
  newText: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zTerminalId = string2();
var zTerminal = object({
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zToolCallContent = union([
  zContent.and(object({
    type: literal("content")
  })),
  zDiff.and(object({
    type: literal("diff")
  })),
  zTerminal.and(object({
    type: literal("terminal")
  }))
]);
var zToolCallLocation = object({
  path: string2(),
  line: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zToolCallUpdate = object({
  toolCallId: zToolCallId,
  kind: defaultOnError(zToolKind.nullish(), () => void 0),
  status: defaultOnError(zToolCallStatus.nullish(), () => void 0),
  title: defaultOnError(string2().nullish(), () => void 0),
  name: defaultOnError(string2().nullish(), () => void 0),
  content: defaultOnError(vecSkipError(zToolCallContent).nullish(), () => void 0),
  locations: defaultOnError(vecSkipError(zToolCallLocation).nullish(), () => void 0),
  rawInput: defaultOnError(unknown().optional(), () => void 0),
  rawOutput: defaultOnError(unknown().optional(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zPermissionOptionId = string2();
var zPermissionOptionKind = union([
  literal("allow_once"),
  literal("allow_always"),
  literal("reject_once"),
  literal("reject_always")
]);
var zPermissionOption = object({
  optionId: zPermissionOptionId,
  name: string2(),
  kind: zPermissionOptionKind,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zRequestPermissionRequest = object({
  sessionId: zSessionId,
  toolCall: zToolCallUpdate,
  options: array(zPermissionOption),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zEnvVariable = object({
  name: string2(),
  value: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCreateTerminalRequest = object({
  sessionId: zSessionId,
  command: string2(),
  args: defaultOnNull(array(string2()), () => []).optional(),
  env: defaultOnNull(array(zEnvVariable), () => []).optional(),
  cwd: string2().nullish(),
  outputByteLimit: wideInt().gte(0).nullish(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zTerminalOutputRequest = object({
  sessionId: zSessionId,
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zReleaseTerminalRequest = object({
  sessionId: zSessionId,
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zWaitForTerminalExitRequest = object({
  sessionId: zSessionId,
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zKillTerminalRequest = object({
  sessionId: zSessionId,
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zElicitationSessionScope = object({
  sessionId: zSessionId,
  toolCallId: defaultOnError(zToolCallId.nullish(), () => void 0)
});
var zElicitationRequestScope = object({
  requestId: zRequestId
});
var zElicitationSchemaType = literal("object");
var zStringFormat = union([
  literal("email"),
  literal("uri"),
  literal("date"),
  literal("date-time")
]);
var zEnumOption = object({
  const: string2(),
  title: string2(),
  description: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zStringPropertySchema = object({
  title: defaultOnError(string2().nullish(), () => void 0),
  description: defaultOnError(string2().nullish(), () => void 0),
  minLength: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(),
  maxLength: int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(),
  pattern: string2().nullish(),
  format: zStringFormat.nullish(),
  default: defaultOnError(string2().nullish(), () => void 0),
  enum: array(string2()).nullish(),
  oneOf: array(zEnumOption).nullish(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zNumberPropertySchema = object({
  title: defaultOnError(string2().nullish(), () => void 0),
  description: defaultOnError(string2().nullish(), () => void 0),
  minimum: number2().nullish(),
  maximum: number2().nullish(),
  default: defaultOnError(number2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zIntegerPropertySchema = object({
  title: defaultOnError(string2().nullish(), () => void 0),
  description: defaultOnError(string2().nullish(), () => void 0),
  minimum: wideInt().nullish(),
  maximum: wideInt().nullish(),
  default: defaultOnError(wideInt().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zBooleanPropertySchema = object({
  title: defaultOnError(string2().nullish(), () => void 0),
  description: defaultOnError(string2().nullish(), () => void 0),
  default: defaultOnError(boolean2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zStringMultiSelectItems = object({
  enum: array(string2()),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zTitledMultiSelectItems = object({
  anyOf: array(zEnumOption),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zMultiSelectItems = preserveCustomPayload(union([
  zStringMultiSelectItems.and(object({
    type: literal("string")
  })),
  excludeKnownTags(object({
    type: string2()
  }), "type", ["string"]),
  zTitledMultiSelectItems
]), "type", ["string"]);
var zMultiSelectPropertySchema = object({
  title: defaultOnError(string2().nullish(), () => void 0),
  description: defaultOnError(string2().nullish(), () => void 0),
  minItems: wideInt().gte(0).nullish(),
  maxItems: wideInt().gte(0).nullish(),
  items: zMultiSelectItems,
  default: defaultOnError(vecSkipError(string2()).nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zElicitationPropertySchema = preserveCustomPayload(union([
  zStringPropertySchema.and(object({
    type: literal("string")
  })),
  zNumberPropertySchema.and(object({
    type: literal("number")
  })),
  zIntegerPropertySchema.and(object({
    type: literal("integer")
  })),
  zBooleanPropertySchema.and(object({
    type: literal("boolean")
  })),
  zMultiSelectPropertySchema.and(object({
    type: literal("array")
  })),
  excludeKnownTags(object({
    type: string2()
  }), "type", ["array", "boolean", "integer", "number", "string"])
]), "type", ["array", "boolean", "integer", "number", "string"]);
var zElicitationSchema = object({
  type: defaultOnError(zElicitationSchemaType.optional().default("object"), () => "object"),
  title: defaultOnError(string2().nullish(), () => void 0),
  properties: record(string2(), zElicitationPropertySchema).optional().default({}),
  required: array(string2()).nullish(),
  description: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zElicitationFormMode = intersection(union([zElicitationSessionScope, zElicitationRequestScope]), object({
  requestedSchema: zElicitationSchema
}));
var zElicitationId = string2();
var zElicitationUrlMode = intersection(union([zElicitationSessionScope, zElicitationRequestScope]), object({
  elicitationId: zElicitationId,
  url: url()
}));
var zCreateElicitationRequest = preserveCustomPayload(intersection(union([
  zElicitationFormMode.and(object({
    mode: literal("form")
  })),
  zElicitationUrlMode.and(object({
    mode: literal("url")
  })),
  excludeKnownTags(intersection(union([zElicitationSessionScope, zElicitationRequestScope]), object({
    mode: string2()
  })), "mode", ["form", "url"])
]), object({
  message: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
})), "mode", ["form", "url"]);
var zExtRequest = unknown();
var zAgentRequest = object({
  id: zRequestId,
  method: string2(),
  params: union([
    zWriteTextFileRequest,
    zReadTextFileRequest,
    zRequestPermissionRequest,
    zCreateTerminalRequest,
    zTerminalOutputRequest,
    zReleaseTerminalRequest,
    zWaitForTerminalExitRequest,
    zKillTerminalRequest,
    zCreateElicitationRequest,
    zExtRequest
  ]).nullish()
});
var zProtocolVersion = int().gte(0).lte(65535);
var zPromptCapabilities = object({
  image: defaultOnError(boolean2().optional().default(false), () => false),
  audio: defaultOnError(boolean2().optional().default(false), () => false),
  embeddedContext: defaultOnError(boolean2().optional().default(false), () => false),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zMcpCapabilities = object({
  http: defaultOnError(boolean2().optional().default(false), () => false),
  sse: defaultOnError(boolean2().optional().default(false), () => false),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionListCapabilities = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionDeleteCapabilities = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionAdditionalDirectoriesCapabilities = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionResumeCapabilities = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionCloseCapabilities = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionCapabilities = object({
  list: defaultOnError(zSessionListCapabilities.nullish(), () => void 0),
  delete: defaultOnError(zSessionDeleteCapabilities.nullish(), () => void 0),
  additionalDirectories: defaultOnError(zSessionAdditionalDirectoriesCapabilities.nullish(), () => void 0),
  resume: defaultOnError(zSessionResumeCapabilities.nullish(), () => void 0),
  close: defaultOnError(zSessionCloseCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zLogoutCapabilities = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAgentAuthCapabilities = object({
  logout: defaultOnError(zLogoutCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAgentCapabilities = object({
  loadSession: defaultOnError(boolean2().optional().default(false), () => false),
  promptCapabilities: defaultOnError(zPromptCapabilities.optional().default({
    image: false,
    audio: false,
    embeddedContext: false
  }), () => ({
    image: false,
    audio: false,
    embeddedContext: false
  })),
  mcpCapabilities: defaultOnError(zMcpCapabilities.optional().default({ http: false, sse: false }), () => ({ http: false, sse: false })),
  sessionCapabilities: defaultOnError(zSessionCapabilities.optional().default({}), () => ({})),
  auth: defaultOnError(zAgentAuthCapabilities.optional().default({}), () => ({})),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAuthMethodId = string2();
var zAuthMethodTerminal = object({
  id: zAuthMethodId,
  name: string2(),
  description: defaultOnError(string2().nullish(), () => void 0),
  args: defaultOnNull(array(string2()), () => []).optional(),
  env: defaultOnNull(record(string2(), string2()), () => ({})).optional(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAuthMethodAgent = object({
  id: zAuthMethodId,
  name: string2(),
  description: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAuthMethod = union([
  zAuthMethodTerminal.and(object({
    type: literal("terminal")
  })),
  zAuthMethodAgent
]);
var zImplementation = object({
  name: string2(),
  title: defaultOnError(string2().nullish(), () => void 0),
  version: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zInitializeResponse = object({
  protocolVersion: zProtocolVersion,
  agentCapabilities: defaultOnError(zAgentCapabilities.optional().default({
    loadSession: false,
    promptCapabilities: {
      image: false,
      audio: false,
      embeddedContext: false
    },
    mcpCapabilities: { http: false, sse: false },
    sessionCapabilities: {},
    auth: {}
  }), () => ({
    loadSession: false,
    promptCapabilities: {
      image: false,
      audio: false,
      embeddedContext: false
    },
    mcpCapabilities: { http: false, sse: false },
    sessionCapabilities: {},
    auth: {}
  })),
  authMethods: defaultOnError(vecSkipError(zAuthMethod).optional().default([]), () => []),
  agentInfo: defaultOnError(zImplementation.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAuthenticateResponse = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zLogoutResponse = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionModeId = string2();
var zSessionMode = object({
  id: zSessionModeId,
  name: string2(),
  description: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionModeState = object({
  currentModeId: zSessionModeId,
  availableModes: requiredDefaultOnError(vecSkipError(zSessionMode), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionConfigId = string2();
var zSessionConfigOptionCategory = union([
  literal("mode"),
  literal("model"),
  literal("model_config"),
  literal("thought_level"),
  string2()
]);
var zSessionConfigValueId = string2();
var zSessionConfigSelectOption = object({
  value: zSessionConfigValueId,
  name: string2(),
  description: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionConfigGroupId = string2();
var zSessionConfigSelectGroup = object({
  group: zSessionConfigGroupId,
  name: string2(),
  options: requiredDefaultOnError(vecSkipError(zSessionConfigSelectOption), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionConfigSelectOptions = union([
  array(zSessionConfigSelectOption),
  array(zSessionConfigSelectGroup)
]);
var zSessionConfigSelect = object({
  currentValue: zSessionConfigValueId,
  options: zSessionConfigSelectOptions
});
var zSessionConfigBoolean = object({
  currentValue: boolean2()
});
var zSessionConfigOption = intersection(union([
  zSessionConfigSelect.and(object({
    type: literal("select")
  })),
  zSessionConfigBoolean.and(object({
    type: literal("boolean")
  }))
]), object({
  id: zSessionConfigId,
  name: string2(),
  description: defaultOnError(string2().nullish(), () => void 0),
  category: defaultOnError(zSessionConfigOptionCategory.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
}));
var zNewSessionResponse = object({
  sessionId: zSessionId,
  modes: defaultOnError(zSessionModeState.nullish(), () => void 0),
  configOptions: defaultOnError(vecSkipError(zSessionConfigOption).nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zLoadSessionResponse = object({
  modes: defaultOnError(zSessionModeState.nullish(), () => void 0),
  configOptions: defaultOnError(vecSkipError(zSessionConfigOption).nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionInfo = object({
  sessionId: zSessionId,
  cwd: string2(),
  additionalDirectories: defaultOnError(vecSkipError(string2()).optional(), () => []),
  title: defaultOnError(string2().nullish(), () => void 0),
  updatedAt: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zListSessionsResponse = object({
  sessions: requiredDefaultOnError(vecSkipError(zSessionInfo), () => []),
  nextCursor: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zDeleteSessionResponse = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zResumeSessionResponse = object({
  modes: defaultOnError(zSessionModeState.nullish(), () => void 0),
  configOptions: defaultOnError(vecSkipError(zSessionConfigOption).nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCloseSessionResponse = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSetSessionModeResponse = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSetSessionConfigOptionResponse = object({
  configOptions: requiredDefaultOnError(vecSkipError(zSessionConfigOption), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zStopReason = union([
  literal("end_turn"),
  literal("max_tokens"),
  literal("max_turn_requests"),
  literal("refusal"),
  literal("cancelled")
]);
var zPromptResponse = object({
  stopReason: zStopReason,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zExtResponse = unknown();
var zErrorCode = union([
  literal(-32700),
  literal(-32600),
  literal(-32601),
  literal(-32602),
  literal(-32603),
  literal(-32800),
  literal(-32e3),
  literal(-32002),
  int().min(-2147483648, {
    error: "Invalid value: Expected int32 to be >= -2147483648"
  }).max(2147483647, {
    error: "Invalid value: Expected int32 to be <= 2147483647"
  })
]);
var zError = object({
  code: zErrorCode,
  message: string2(),
  data: defaultOnError(unknown().optional(), () => void 0)
});
var zAgentResponse = union([
  object({
    id: zRequestId,
    result: union([
      zInitializeResponse,
      zAuthenticateResponse,
      zLogoutResponse,
      zNewSessionResponse,
      zLoadSessionResponse,
      zListSessionsResponse,
      zDeleteSessionResponse,
      zResumeSessionResponse,
      zCloseSessionResponse,
      zSetSessionModeResponse,
      zSetSessionConfigOptionResponse,
      zPromptResponse,
      zExtResponse
    ])
  }),
  object({
    id: zRequestId,
    error: zError
  })
]);
var zMessageId = string2();
var zContentChunk = object({
  content: zContentBlock,
  messageId: defaultOnError(zMessageId.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zToolCall = object({
  toolCallId: zToolCallId,
  title: string2(),
  name: defaultOnError(string2().nullish(), () => void 0),
  kind: defaultOnError(zToolKind.optional(), () => void 0),
  status: defaultOnError(zToolCallStatus.optional(), () => void 0),
  content: defaultOnError(vecSkipError(zToolCallContent).optional(), () => []),
  locations: defaultOnError(vecSkipError(zToolCallLocation).optional(), () => []),
  rawInput: defaultOnError(unknown().optional(), () => void 0),
  rawOutput: defaultOnError(unknown().optional(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zPlanEntryPriority = union([
  literal("high"),
  literal("medium"),
  literal("low")
]);
var zPlanEntryStatus = union([
  literal("pending"),
  literal("in_progress"),
  literal("completed")
]);
var zPlanEntry = object({
  content: string2(),
  priority: zPlanEntryPriority,
  status: zPlanEntryStatus,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zPlan = object({
  entries: requiredDefaultOnError(vecSkipError(zPlanEntry), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zUnstructuredCommandInput = object({
  hint: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAvailableCommandInput = zUnstructuredCommandInput;
var zAvailableCommand = object({
  name: string2(),
  description: string2(),
  input: defaultOnError(zAvailableCommandInput.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAvailableCommandsUpdate = object({
  availableCommands: requiredDefaultOnError(vecSkipError(zAvailableCommand), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCurrentModeUpdate = object({
  currentModeId: zSessionModeId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zConfigOptionUpdate = object({
  configOptions: requiredDefaultOnError(vecSkipError(zSessionConfigOption), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionInfoUpdate = object({
  title: defaultOnError(string2().nullish(), () => void 0),
  updatedAt: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCost = object({
  amount: number2(),
  currency: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zUsageUpdate = object({
  used: wideInt().gte(0),
  size: wideInt().gte(0),
  cost: defaultOnError(zCost.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zNoticeSeverity = union([
  literal("info"),
  literal("warning"),
  literal("error"),
  string2()
]);
var zNotice = object({
  severity: zNoticeSeverity,
  title: string2().min(1),
  description: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCompactionId = string2();
var zCompactionStatus = union([
  literal("in_progress"),
  literal("completed"),
  literal("failed"),
  literal("cancelled"),
  string2()
]);
var zCompactionUpdate = object({
  compactionId: zCompactionId,
  status: zCompactionStatus,
  summary: defaultOnError(vecSkipError(zContentBlock).nullish(), () => void 0),
  error: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCompactionSummaryChunk = object({
  compactionId: zCompactionId,
  content: zContentBlock,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionUpdate = union([
  zContentChunk.and(object({
    sessionUpdate: literal("user_message_chunk")
  })),
  zContentChunk.and(object({
    sessionUpdate: literal("agent_message_chunk")
  })),
  zContentChunk.and(object({
    sessionUpdate: literal("agent_thought_chunk")
  })),
  zToolCall.and(object({
    sessionUpdate: literal("tool_call")
  })),
  zToolCallUpdate.and(object({
    sessionUpdate: literal("tool_call_update")
  })),
  zPlan.and(object({
    sessionUpdate: literal("plan")
  })),
  zAvailableCommandsUpdate.and(object({
    sessionUpdate: literal("available_commands_update")
  })),
  zCurrentModeUpdate.and(object({
    sessionUpdate: literal("current_mode_update")
  })),
  zConfigOptionUpdate.and(object({
    sessionUpdate: literal("config_option_update")
  })),
  zSessionInfoUpdate.and(object({
    sessionUpdate: literal("session_info_update")
  })),
  zUsageUpdate.and(object({
    sessionUpdate: literal("usage_update")
  })),
  zNotice.and(object({
    sessionUpdate: literal("notice")
  })),
  zCompactionUpdate.and(object({
    sessionUpdate: literal("compaction_update")
  })),
  zCompactionSummaryChunk.and(object({
    sessionUpdate: literal("compaction_summary_chunk")
  }))
]);
var zSessionNotification = object({
  sessionId: zSessionId,
  update: zSessionUpdate,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCompleteElicitationNotification = object({
  elicitationId: zElicitationId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zExtNotification = unknown();
var zAgentNotification = object({
  method: string2(),
  params: union([
    zSessionNotification,
    zCompleteElicitationNotification,
    zExtNotification
  ]).nullish()
});
var zFileSystemCapabilities = object({
  readTextFile: defaultOnError(boolean2().optional().default(false), () => false),
  writeTextFile: defaultOnError(boolean2().optional().default(false), () => false),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCompactionCapabilities = record(string2(), unknown());
var zBooleanConfigOptionCapabilities = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSessionConfigOptionsCapabilities = object({
  boolean: defaultOnError(zBooleanConfigOptionCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zNoticeCapabilities = record(string2(), unknown());
var zClientSessionCapabilities = object({
  compaction: defaultOnError(zCompactionCapabilities.nullish(), () => void 0),
  configOptions: defaultOnError(zSessionConfigOptionsCapabilities.nullish(), () => void 0),
  notices: defaultOnError(zNoticeCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAuthCapabilities = object({
  terminal: defaultOnError(boolean2().optional().default(false), () => false),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zElicitationFormCapabilities = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zElicitationUrlCapabilities = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zElicitationCapabilities = object({
  form: defaultOnError(zElicitationFormCapabilities.nullish(), () => void 0),
  url: defaultOnError(zElicitationUrlCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zClientCapabilities = object({
  fs: defaultOnError(zFileSystemCapabilities.optional().default({ readTextFile: false, writeTextFile: false }), () => ({ readTextFile: false, writeTextFile: false })),
  terminal: defaultOnError(boolean2().optional().default(false), () => false),
  session: defaultOnError(zClientSessionCapabilities.nullish(), () => void 0),
  auth: defaultOnError(zAuthCapabilities.optional().default({ terminal: false }), () => ({ terminal: false })),
  elicitation: defaultOnError(zElicitationCapabilities.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zInitializeRequest = object({
  protocolVersion: zProtocolVersion,
  clientCapabilities: defaultOnError(zClientCapabilities.optional().default({
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    auth: { terminal: false }
  }), () => ({
    fs: { readTextFile: false, writeTextFile: false },
    terminal: false,
    auth: { terminal: false }
  })),
  clientInfo: defaultOnError(zImplementation.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zAuthenticateRequest = object({
  methodId: zAuthMethodId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zLogoutRequest = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zHttpHeader = object({
  name: string2(),
  value: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zMcpServerHttp = object({
  name: string2(),
  url: string2(),
  headers: defaultOnNull(array(zHttpHeader), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zMcpServerSse = object({
  name: string2(),
  url: string2(),
  headers: defaultOnNull(array(zHttpHeader), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zMcpServerStdio = object({
  name: string2(),
  command: string2(),
  args: defaultOnNull(array(string2()), () => []),
  env: defaultOnNull(array(zEnvVariable), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zMcpServer = union([
  zMcpServerHttp.and(object({
    type: literal("http")
  })),
  zMcpServerSse.and(object({
    type: literal("sse")
  })),
  zMcpServerStdio
]);
var zNewSessionRequest = object({
  cwd: string2(),
  additionalDirectories: defaultOnNull(array(string2()), () => []).optional(),
  mcpServers: defaultOnNull(array(zMcpServer), () => []),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zLoadSessionRequest = object({
  mcpServers: defaultOnNull(array(zMcpServer), () => []),
  cwd: string2(),
  additionalDirectories: defaultOnNull(array(string2()), () => []).optional(),
  sessionId: zSessionId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zListSessionsRequest = object({
  cwd: string2().nullish(),
  cursor: string2().nullish(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zDeleteSessionRequest = object({
  sessionId: zSessionId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zResumeSessionRequest = object({
  sessionId: zSessionId,
  cwd: string2(),
  additionalDirectories: defaultOnNull(array(string2()), () => []).optional(),
  mcpServers: defaultOnNull(array(zMcpServer), () => []).optional(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCloseSessionRequest = object({
  sessionId: zSessionId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSetSessionModeRequest = object({
  sessionId: zSessionId,
  modeId: zSessionModeId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSetSessionConfigOptionRequest = intersection(union([
  object({
    type: literal("boolean"),
    value: boolean2()
  }),
  object({
    value: zSessionConfigValueId
  })
]), object({
  sessionId: zSessionId,
  configId: zSessionConfigId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
}));
var zPromptRequest = object({
  sessionId: zSessionId,
  prompt: array(zContentBlock),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zClientRequest = object({
  id: zRequestId,
  method: string2(),
  params: union([
    zInitializeRequest,
    zAuthenticateRequest,
    zLogoutRequest,
    zNewSessionRequest,
    zLoadSessionRequest,
    zListSessionsRequest,
    zDeleteSessionRequest,
    zResumeSessionRequest,
    zCloseSessionRequest,
    zSetSessionModeRequest,
    zSetSessionConfigOptionRequest,
    zPromptRequest,
    zExtRequest
  ]).nullish()
});
var zWriteTextFileResponse = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zReadTextFileResponse = object({
  content: string2(),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zSelectedPermissionOutcome = object({
  optionId: zPermissionOptionId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zRequestPermissionOutcome = union([
  object({
    outcome: literal("cancelled")
  }),
  zSelectedPermissionOutcome.and(object({
    outcome: literal("selected")
  }))
]);
var zRequestPermissionResponse = object({
  outcome: zRequestPermissionOutcome,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zCreateTerminalResponse = object({
  terminalId: zTerminalId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zTerminalExitStatus = object({
  exitCode: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  signal: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zTerminalOutputResponse = object({
  output: string2(),
  truncated: boolean2(),
  exitStatus: defaultOnError(zTerminalExitStatus.nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zReleaseTerminalResponse = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zWaitForTerminalExitResponse = object({
  exitCode: defaultOnError(int().gte(0).max(4294967295, {
    error: "Invalid value: Expected uint32 to be <= 4294967295"
  }).nullish(), () => void 0),
  signal: defaultOnError(string2().nullish(), () => void 0),
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zKillTerminalResponse = object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zElicitationContentValue = union([
  string2(),
  wideInt(),
  number2(),
  boolean2(),
  array(string2())
]);
var zElicitationAcceptAction = object({
  content: record(string2(), zElicitationContentValue).nullish()
});
var zCreateElicitationResponse = preserveCustomPayload(intersection(union([
  zElicitationAcceptAction.and(object({
    action: literal("accept")
  })),
  object({
    action: literal("decline")
  }),
  object({
    action: literal("cancel")
  }),
  excludeKnownTags(object({
    action: string2()
  }), "action", ["accept", "cancel", "decline"])
]), object({
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
})), "action", ["accept", "cancel", "decline"]);
var zClientResponse = union([
  object({
    id: zRequestId,
    result: union([
      zWriteTextFileResponse,
      zReadTextFileResponse,
      zRequestPermissionResponse,
      zCreateTerminalResponse,
      zTerminalOutputResponse,
      zReleaseTerminalResponse,
      zWaitForTerminalExitResponse,
      zKillTerminalResponse,
      zCreateElicitationResponse,
      zExtResponse
    ])
  }),
  object({
    id: zRequestId,
    error: zError
  })
]);
var zCancelNotification = object({
  sessionId: zSessionId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});
var zClientNotification = object({
  method: string2(),
  params: union([zCancelNotification, zExtNotification]).nullish()
});
var zCancelRequestNotification = object({
  requestId: zRequestId,
  _meta: defaultOnError(record(string2(), unknown()).nullish(), () => void 0)
});

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/core/jsonrpc.js
var CANCEL_REQUEST_METHOD = "$/cancel_request";
function treatSessionNotFoundAsSuccess(method, response, success) {
  if (method !== "session/close" && method !== "session/delete") {
    return response;
  }
  return response.catch((error2) => {
    if (error2 instanceof RequestError && error2.code === -32002) {
      return success();
    }
    throw error2;
  });
}
function isRequestMessage(value) {
  return isJsonRpcEnvelope(value) && "id" in value && typeof value["method"] === "string" && isJsonRpcId(value["id"]);
}
function isResponseMessage(value) {
  if (!isJsonRpcEnvelope(value) || "method" in value) {
    return false;
  }
  if (!("id" in value) || !isJsonRpcId(value["id"])) {
    return false;
  }
  const hasResult = Object.hasOwn(value, "result");
  const hasError = Object.hasOwn(value, "error");
  if (hasResult === hasError) {
    return false;
  }
  return !hasError || isErrorResponse(value["error"]);
}
function isNotificationMessage(value) {
  return isJsonRpcEnvelope(value) && !("id" in value) && typeof value["method"] === "string";
}
function isRecord(value) {
  return typeof value === "object" && value !== null;
}
function isJsonRpcEnvelope(value) {
  return isRecord(value) && value["jsonrpc"] === "2.0";
}
function isJsonRpcId(value) {
  return value === null || typeof value === "string" || typeof value === "number" && Number.isFinite(value);
}
function isResponseShapedMessage(value) {
  return isRecord(value) && !("method" in value) && ("id" in value || "result" in value || "error" in value);
}
function cancelRequestId(params) {
  if (!isRecord(params) || !isJsonRpcId(params["requestId"])) {
    return void 0;
  }
  return params["requestId"];
}
function isErrorResponse(value) {
  return isRecord(value) && typeof value["code"] === "number" && Number.isInteger(value["code"]) && typeof value["message"] === "string";
}
var Handled = {
  /**
   * Marks a message as handled.
   */
  yes() {
    return { handled: true };
  },
  /**
   * Leaves a message unhandled so later handlers can process it.
   */
  no(message, retry = false) {
    return { handled: false, message, retry };
  }
};
function rejectedPromise(error2) {
  const promise = Promise.reject(error2);
  promise.catch(() => {
  });
  return promise;
}
function errorDetails(error2) {
  if (error2 instanceof Error) {
    return error2.message;
  }
  if (typeof error2 === "object" && error2 != null && "message" in error2 && typeof error2.message === "string") {
    return error2.message;
  }
  return void 0;
}
function isZodError(error2) {
  return typeof error2 === "object" && error2 !== null && "name" in error2 && error2.name === "ZodError" && "issues" in error2 && Array.isArray(error2.issues) && "format" in error2 && typeof error2.format === "function";
}
function describeInvalidMessage(message) {
  if (Array.isArray(message)) {
    return { type: "array" };
  }
  if (isRecord(message)) {
    return { type: "object", keys: Object.keys(message) };
  }
  return { type: message === null ? "null" : typeof message };
}
function errorToResult(error2) {
  if (error2 instanceof RequestError) {
    return error2.toResult();
  }
  if (isZodError(error2)) {
    return RequestError.invalidParams(error2.format()).toResult();
  }
  const details = errorDetails(error2);
  try {
    return RequestError.internalError(details ? JSON.parse(details) : {}).toResult();
  } catch {
    return RequestError.internalError({ details }).toResult();
  }
}
function requestCancelledError(reason) {
  if (reason instanceof RequestError && reason.code === -32800) {
    return reason;
  }
  return RequestError.requestCancelled(reason);
}
function errorToRequestResult(error2, signal) {
  const requestCancelled = abortErrorToRequestCancelled(error2, signal);
  return requestCancelled ? requestCancelled.toResult() : errorToResult(error2);
}
function abortErrorToRequestCancelled(error2, signal) {
  if (!signal.aborted || !isAbortError(error2)) {
    return void 0;
  }
  return requestCancelledError(signal.reason);
}
function isAbortError(error2) {
  if (typeof error2 !== "object" || error2 === null) {
    return false;
  }
  const maybeAbortError = error2;
  return maybeAbortError.name === "AbortError" || maybeAbortError.code === "ABORT_ERR";
}
var RequestResponder = class {
  id;
  sendResult;
  signal;
  finishRequest;
  didRespond = false;
  constructor(id, sendResult, signal = new AbortController().signal, finishRequest) {
    this.id = id;
    this.sendResult = sendResult;
    this.signal = signal;
    this.finishRequest = finishRequest;
  }
  /**
   * Whether this request has already received a response.
   */
  get responded() {
    return this.didRespond;
  }
  /**
   * Sends a successful JSON-RPC response.
   */
  respond(response) {
    return this.respondWithResult({ result: response ?? null });
  }
  /**
   * Sends an error JSON-RPC response.
   */
  respondWithError(error2) {
    const errorResponse = error2 instanceof RequestError ? error2.toErrorResponse() : error2;
    return this.respondWithResult({ error: errorResponse });
  }
  /**
   * Sends a complete JSON-RPC result payload.
   */
  respondWithResult(result) {
    if (this.didRespond) {
      return rejectedPromise(new Error("JSON-RPC request already responded"));
    }
    this.didRespond = true;
    return this.sendResult(result).finally(() => {
      this.finishRequest?.();
    });
  }
};
var nullIdResponders = /* @__PURE__ */ new WeakSet();
var HandlerRegistration = class {
  disposeHandler;
  active = true;
  constructor(disposeHandler) {
    this.disposeHandler = disposeHandler;
  }
  /**
   * Unregisters the associated handler.
   */
  dispose() {
    if (!this.active) {
      return;
    }
    this.active = false;
    this.disposeHandler();
  }
  /**
   * Supports explicit resource management with `using`.
   */
  [Symbol.dispose]() {
    this.dispose();
  }
  /**
   * Returns this registration for call sites that intentionally keep it active.
   */
  runIndefinitely() {
    return this;
  }
};
var ConnectionContext = class {
  connection;
  constructor(connection) {
    this.connection = connection;
  }
  /**
   * Sends a request over the connection.
   */
  sendRequest(method, params, mapResponse, options) {
    return this.connection.sendRequest(method, params, mapResponse, options);
  }
  /**
   * Sends a notification over the connection.
   */
  sendNotification(method, params) {
    return this.connection.sendNotification(method, params);
  }
  /**
   * Sends a protocol-level request cancellation notification.
   */
  sendCancelRequest(requestId) {
    return this.connection.sendCancelRequest(requestId);
  }
  /**
   * Registers a handler that can be disposed independently.
   */
  addDynamicHandler(handler) {
    return this.connection.addDynamicHandler(handler);
  }
  /**
   * AbortSignal that aborts when the connection closes.
   */
  get signal() {
    return this.connection.signal;
  }
  /**
   * Promise that resolves when the connection closes.
   */
  get closed() {
    return this.connection.closed;
  }
};
var Connection = class {
  pendingResponses = /* @__PURE__ */ new Map();
  incomingRequests = /* @__PURE__ */ new Map();
  nextRequestId = 0;
  staticHandlers = [];
  dynamicHandlers = /* @__PURE__ */ new Set();
  fallbackHandlers = [];
  stream;
  writeQueue = Promise.resolve();
  abortController = new AbortController();
  closedPromise;
  retryQueue = [];
  context = new ConnectionContext(this);
  receiveReader;
  constructor(requestHandlerOrStream, notificationHandlerOrHandlers, streamOrOptions, options) {
    if (typeof requestHandlerOrStream === "function") {
      const requestHandler = requestHandlerOrStream;
      const notificationHandler = notificationHandlerOrHandlers;
      const stream2 = streamOrOptions;
      this.initialize(stream2, [
        ...options?.handlers ?? [],
        this.legacyHandler(requestHandler, notificationHandler)
      ], options);
      return;
    }
    const stream = requestHandlerOrStream;
    const handlers = notificationHandlerOrHandlers;
    const connectionOptions = streamOrOptions;
    this.initialize(stream, [...connectionOptions?.handlers ?? [], ...handlers], connectionOptions);
  }
  /**
   * Creates a builder for configuring a handler-based connection.
   */
  static builder() {
    return new ConnectionBuilder();
  }
  /**
   * Runs an operation while the connection is open, then closes the connection.
   *
   * If the stream closes before `op` settles, the returned promise rejects with
   * the connection close reason.
   */
  runUntil(op) {
    let opSettled = false;
    const opPromise = Promise.resolve().then(() => op(this.context)).finally(() => {
      opSettled = true;
    });
    const closedPromise = this.closed.then(() => {
      if (opSettled) {
        return new Promise(() => {
        });
      }
      throw this.closedReason();
    });
    return Promise.race([opPromise, closedPromise]).finally(() => {
      opSettled = true;
      this.close();
    });
  }
  /**
   * Adds a handler after the connection has started.
   *
   * Any messages queued with `Handled.no(message, true)` are retried after the
   * handler is added.
   */
  addDynamicHandler(handler) {
    this.dynamicHandlers.add(handler);
    if (this.retryQueue.length > 0) {
      for (const message of this.retryQueue.splice(0)) {
        void this.processIncomingMessage(message).catch((error2) => this.close(error2));
      }
    }
    return new HandlerRegistration(() => {
      this.dynamicHandlers.delete(handler);
    });
  }
  /**
   * AbortSignal that aborts when the connection closes.
   */
  get signal() {
    return this.abortController.signal;
  }
  /**
   * Promise that resolves when the connection closes.
   */
  get closed() {
    return this.closedPromise;
  }
  /** @internal */
  getContext() {
    return this.context;
  }
  /**
   * Sends a JSON-RPC request.
   *
   * `mapResponse` can convert the raw result before the returned promise
   * resolves.
   */
  sendRequest(method, params, mapResponse, options = {}) {
    if (this.abortController.signal.aborted) {
      return rejectedPromise(this.closedReason());
    }
    const request = this.prepareRequest(method, params, mapResponse, options);
    const requestSent = this.sendMessage(request.message);
    void requestSent.catch(() => {
    });
    if (options.cancellationSignal?.aborted) {
      request.cancel();
    }
    return request.response;
  }
  /**
   * Sends a protocol-level request cancellation notification.
   */
  sendCancelRequest(requestId) {
    return this.sendNotification(CANCEL_REQUEST_METHOD, { requestId });
  }
  /**
   * Sends a JSON-RPC notification.
   */
  sendNotification(method, params) {
    if (this.abortController.signal.aborted) {
      return rejectedPromise(this.closedReason());
    }
    return this.sendMessage({ jsonrpc: "2.0", method, params });
  }
  prepareRequest(method, params, mapResponse, options = {}) {
    const id = this.nextRequestId++;
    let cancel = () => {
    };
    const response = new Promise((resolve7, reject) => {
      const pendingResponse = {
        resolve: (value) => {
          try {
            resolve7(mapResponse ? mapResponse(value) : value);
          } catch (error2) {
            reject(error2);
          }
        },
        reject
      };
      cancel = () => {
        if (pendingResponse.cancellationSent) {
          return;
        }
        pendingResponse.cancellationSent = true;
        pendingResponse.cleanup?.();
        void this.sendCancelRequest(id).catch(() => {
        });
        if (options.stopWaitingOnCancel) {
          pendingResponse.abandoned = true;
          reject(requestCancelledError(options.cancellationSignal?.reason));
        }
      };
      options.cancellationSignal?.addEventListener("abort", cancel, {
        once: true
      });
      pendingResponse.cleanup = () => {
        options.cancellationSignal?.removeEventListener("abort", cancel);
      };
      this.pendingResponses.set(id, pendingResponse);
    });
    response.catch(() => {
    });
    return {
      message: { jsonrpc: "2.0", id, method, params },
      response,
      cancel: () => cancel()
    };
  }
  /**
   * Closes the connection and rejects pending requests.
   */
  close(error2) {
    if (this.abortController.signal.aborted) {
      return;
    }
    const closeError = error2 ?? new Error("ACP connection closed");
    this.abortController.abort(closeError);
    for (const pendingResponse of this.pendingResponses.values()) {
      pendingResponse.cleanup?.();
      pendingResponse.reject(closeError);
    }
    this.pendingResponses.clear();
    for (const controller of this.incomingRequests.values()) {
      controller.abort(closeError);
    }
    this.incomingRequests.clear();
    void this.receiveReader?.cancel(closeError).catch(() => {
    });
  }
  initialize(stream, handlers, options) {
    this.stream = stream;
    this.staticHandlers = handlers;
    this.fallbackHandlers = [...options?.fallbackHandlers ?? []];
    this.closedPromise = new Promise((resolve7) => {
      this.abortController.signal.addEventListener("abort", () => resolve7());
    });
    void this.receive();
  }
  legacyHandler(requestHandler, notificationHandler) {
    return {
      handleMessage: async (message, cx) => {
        if (message.kind === "request") {
          const result = await requestHandler(message.method, message.params, cx);
          await message.responder.respond(result);
        } else {
          await notificationHandler(message.method, message.params, cx);
        }
        return Handled.yes();
      }
    };
  }
  async receive() {
    let closeError = void 0;
    try {
      const reader = this.stream.readable.getReader();
      this.receiveReader = reader;
      try {
        while (!this.abortController.signal.aborted) {
          const { value: message, done } = await reader.read();
          if (this.abortController.signal.aborted) {
            break;
          }
          if (done) {
            break;
          }
          this.receiveUnvalidatedMessage(message);
        }
      } finally {
        if (this.receiveReader === reader) {
          this.receiveReader = void 0;
        }
        reader.releaseLock();
      }
    } catch (error2) {
      closeError = error2;
    } finally {
      this.close(closeError);
    }
  }
  receiveUnvalidatedMessage(message) {
    if (Array.isArray(message)) {
      void this.sendMessage(protocolErrorResponse(RequestError.invalidRequest(void 0, "JSON-RPC batches are not supported"))).catch(() => {
      });
      return;
    }
    if (!isRequestMessage(message) && !isNotificationMessage(message) && !isResponseShapedMessage(message)) {
      void this.sendMessage(protocolErrorResponse(RequestError.invalidRequest(message))).catch(() => {
      });
      return;
    }
    this.receiveMessage(message);
  }
  receiveMessage(message) {
    if (this.abortController.signal.aborted) {
      return Promise.resolve();
    }
    if (!isRecord(message)) {
      console.error("Invalid message", describeInvalidMessage(message));
      return Promise.resolve();
    }
    if ("method" in message) {
      if (!("id" in message)) {
        this.handleProtocolNotification(message);
      }
      return this.processIncomingMessage(this.toIncomingMessage(message)).catch((error2) => this.close(error2));
    } else if ("id" in message) {
      this.handleResponse(message);
    } else {
      console.error("Invalid message", describeInvalidMessage(message));
    }
    return Promise.resolve();
  }
  async processIncomingMessage(message) {
    if (this.abortController.signal.aborted) {
      return;
    }
    let current = message;
    let retry = false;
    try {
      for (const handler of [
        ...this.staticHandlers,
        ...this.dynamicHandlers.values(),
        ...this.fallbackHandlers
      ]) {
        if (this.abortController.signal.aborted) {
          return;
        }
        const result = await handler.handleMessage(current, this.context) ?? {
          handled: true
        };
        if (result.handled) {
          return;
        }
        current = result.message ?? current;
        retry = retry || Boolean(result.retry);
      }
      if (retry) {
        this.retryQueue.push(current);
      } else if (current.kind === "request") {
        await current.responder.respondWithError(RequestError.methodNotFound(current.method));
      }
    } catch (error2) {
      if (this.abortController.signal.aborted) {
        return;
      }
      if (current.kind === "request" && !current.responder.responded) {
        await current.responder.respondWithResult(errorToRequestResult(error2, current.responder.signal));
      } else {
        const response = errorToResult(error2);
        if ("error" in response) {
          console.error("Error handling notification", {
            method: message.method,
            code: response.error.code,
            message: response.error.message
          });
        }
      }
    }
  }
  toIncomingMessage(message) {
    if ("id" in message) {
      const abortController = new AbortController();
      this.incomingRequests.set(message.id, abortController);
      const finishRequest = () => {
        if (this.incomingRequests.get(message.id) === abortController) {
          this.incomingRequests.delete(message.id);
        }
      };
      const responder = new RequestResponder(message.id, (result) => {
        const response = {
          jsonrpc: "2.0",
          id: nullIdResponders.has(responder) ? null : message.id,
          ...result
        };
        return this.sendMessage(response);
      }, abortController.signal, finishRequest);
      return {
        kind: "request",
        method: message.method,
        params: message.params,
        raw: message,
        signal: abortController.signal,
        responder
      };
    }
    return {
      kind: "notification",
      method: message.method,
      params: message.params,
      raw: message
    };
  }
  handleResponse(response) {
    const pendingResponse = this.pendingResponses.get(response.id);
    if (pendingResponse) {
      this.pendingResponses.delete(response.id);
      pendingResponse.cleanup?.();
      if (pendingResponse.abandoned) {
        return;
      }
      if (!isResponseMessage(response)) {
        pendingResponse.reject(RequestError.invalidRequest(response));
      } else if ("result" in response) {
        pendingResponse.resolve(response.result);
      } else {
        const { code, message, data } = response.error;
        pendingResponse.reject(new RequestError(code, message, data));
      }
    } else {
      console.error("Got response to unknown request", response.id);
    }
  }
  handleProtocolNotification(message) {
    if (message.method !== CANCEL_REQUEST_METHOD) {
      return;
    }
    const requestId = cancelRequestId(message.params);
    if (requestId === void 0) {
      return;
    }
    const controller = this.incomingRequests.get(requestId);
    if (!controller || controller.signal.aborted) {
      return;
    }
    controller.abort(RequestError.requestCancelled({ requestId }));
  }
  closedReason() {
    return this.abortController.signal.reason ?? new Error("ACP connection closed");
  }
  async sendMessage(message) {
    if (this.abortController.signal.aborted) {
      return rejectedPromise(this.closedReason());
    }
    this.writeQueue = this.writeQueue.then(async () => {
      if (this.abortController.signal.aborted) {
        throw this.closedReason();
      }
      const writer = this.stream.writable.getWriter();
      try {
        await writer.write(message);
      } finally {
        writer.releaseLock();
      }
    }).catch((error2) => {
      this.close(error2);
      throw error2;
    });
    return this.writeQueue;
  }
};
var ConnectionBuilder = class {
  handlers = [];
  fallbackHandlers = [];
  connectionName;
  /**
   * Sets a diagnostic name used by handlers created from this builder.
   */
  name(name) {
    this.connectionName = name;
    return this;
  }
  /**
   * Adds a raw JSON-RPC handler to the handler chain.
   */
  withHandler(handler) {
    this.handlers.push(handler);
    return this;
  }
  /**
   * Adds a fallback after static and dynamic handlers. Each connection snapshots
   * this registration alongside the builder's other handlers.
   */
  withFallbackHandler(handler) {
    this.fallbackHandlers.push(handler);
    return this;
  }
  /**
   * Adds a handler that can inspect every incoming request or notification.
   *
   * Observer callbacks that return void pass the message through to later
   * handlers. Return `Handled.yes()` to stop dispatch explicitly.
   */
  onReceiveMessage(handler) {
    return this.withHandler({
      handleMessage: async (message, cx) => await handler(message, cx) ?? Handled.no(message),
      describe: () => this.connectionName ?? "onReceiveMessage"
    });
  }
  /**
   * Adds a typed request handler for one method.
   */
  onReceiveRequest(method, parse2, handler) {
    return this.withHandler({
      handleMessage: async (message, cx) => {
        if (message.kind !== "request" || message.method !== method) {
          return Handled.no(message);
        }
        const request = parse2(message.params);
        return await handler(request, message.responder, cx) ?? Handled.yes();
      },
      describe: () => `${this.connectionName ?? "request"}:${method}`
    });
  }
  /**
   * Adds a typed notification handler for one method.
   */
  onReceiveNotification(method, parse2, handler) {
    return this.withHandler({
      handleMessage: async (message, cx) => {
        if (message.kind !== "notification" || message.method !== method) {
          return Handled.no(message);
        }
        const notification = parse2(message.params);
        return await handler(notification, cx) ?? Handled.yes();
      },
      describe: () => `${this.connectionName ?? "notification"}:${method}`
    });
  }
  /**
   * Connects the configured handlers to a stream.
   */
  connect(stream, options) {
    return new Connection(stream, this.handlers, {
      ...options,
      fallbackHandlers: [
        ...options?.fallbackHandlers ?? [],
        ...this.fallbackHandlers
      ]
    });
  }
  /**
   * Connects to a stream for the lifetime of `op`, then closes the connection.
   */
  connectWith(stream, op, options) {
    return this.connect(stream, options).runUntil(op);
  }
};
var RequestError = class _RequestError extends Error {
  code;
  /**
   * Additional JSON-RPC error data.
   */
  data;
  constructor(code, message, data) {
    super(message);
    this.code = code;
    this.name = "RequestError";
    this.data = data;
  }
  /**
   * Invalid JSON was received by the server. An error occurred on the server while parsing the JSON text.
   */
  static parseError(data, additionalMessage) {
    return new _RequestError(-32700, `Parse error${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * The JSON sent is not a valid Request object.
   */
  static invalidRequest(data, additionalMessage) {
    return new _RequestError(-32600, `Invalid request${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * The method does not exist / is not available.
   */
  static methodNotFound(method) {
    return new _RequestError(-32601, `"Method not found": ${method}`, {
      method
    });
  }
  /**
   * Invalid method parameter(s).
   */
  static invalidParams(data, additionalMessage) {
    return new _RequestError(-32602, `Invalid params${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * Internal JSON-RPC error.
   */
  static internalError(data, additionalMessage) {
    return new _RequestError(-32603, `Internal error${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * Execution of the request was aborted.
   */
  static requestCancelled(data, additionalMessage) {
    return new _RequestError(-32800, `Request cancelled${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * Authentication required.
   */
  static authRequired(data, additionalMessage) {
    return new _RequestError(-32e3, `Authentication required${additionalMessage ? `: ${additionalMessage}` : ""}`, data);
  }
  /**
   * A referenced resource, such as a session or file, does not exist.
   *
   * For an unknown or inactive session, prefer
   * {@link RequestError.sessionNotFound}, which sets `data.sessionId` as the
   * protocol expects.
   */
  static resourceNotFound(uri) {
    return new _RequestError(-32002, `Resource not found${uri ? `: ${uri}` : ""}`, uri && { uri });
  }
  /**
   * The session named by a session-scoped request does not exist or is not
   * active on this connection.
   *
   * Produces a `-32002` (Resource not found) error with `data.sessionId` set
   * to the requested session ID.
   */
  static sessionNotFound(sessionId) {
    return new _RequestError(-32002, "Resource not found", {
      sessionId
    });
  }
  /**
   * No supported protocol version is at or below the requested version.
   *
   * Produces a `-32022` error whose data lists the `requested` version and the
   * `supported` versions.
   */
  static unsupportedProtocolVersion(requested, supported) {
    return new _RequestError(-32022, "Unsupported protocol version", {
      requested,
      supported: [...supported]
    });
  }
  /**
   * Converts this error to a JSON-RPC result object.
   */
  toResult() {
    return {
      error: {
        code: this.code,
        message: this.message,
        data: this.data
      }
    };
  }
  /**
   * Converts this error to a JSON-RPC error response payload.
   */
  toErrorResponse() {
    return {
      code: this.code,
      message: this.message,
      data: this.data
    };
  }
};
function protocolErrorResponse(error2) {
  return {
    jsonrpc: "2.0",
    id: null,
    error: error2.toErrorResponse()
  };
}

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/core/stream-limits.js
var DEFAULT_MAX_MESSAGE_BYTES = 32 * 1024 * 1024;
var MessageTooLargeError = class extends Error {
  maxMessageBytes;
  constructor(maxMessageBytes) {
    super(`Incoming ACP data exceeds the configured ${maxMessageBytes} byte limit`);
    this.maxMessageBytes = maxMessageBytes;
    this.name = "MessageTooLargeError";
  }
};
function resolveMaxMessageBytes(value) {
  const maxMessageBytes = value ?? DEFAULT_MAX_MESSAGE_BYTES;
  if (!Number.isSafeInteger(maxMessageBytes) || maxMessageBytes <= 0) {
    throw new RangeError("maxMessageBytes must be a positive safe integer");
  }
  return maxMessageBytes;
}
var MessageBuffer = class {
  #buffer = new Uint8Array(0);
  #length = 0;
  #maxMessageBytes;
  constructor(maxMessageBytes) {
    this.#maxMessageBytes = resolveMaxMessageBytes(maxMessageBytes);
  }
  get byteLength() {
    return this.#length;
  }
  get lastByte() {
    return this.#buffer[this.#length - 1];
  }
  #checkAppend(byteLength) {
    if (byteLength > this.#maxMessageBytes - this.#length) {
      this.clear();
      throw new MessageTooLargeError(this.#maxMessageBytes);
    }
  }
  append(bytes) {
    this.#checkAppend(bytes.byteLength);
    const length = this.#length + bytes.byteLength;
    if (length > this.#buffer.byteLength) {
      const capacity = Math.min(this.#maxMessageBytes, Math.max(length, this.#buffer.byteLength * 2, 1024));
      const buffer = new Uint8Array(capacity);
      buffer.set(this.#buffer.subarray(0, this.#length));
      this.#buffer = buffer;
    }
    this.#buffer.set(bytes, this.#length);
    this.#length = length;
  }
  take() {
    const bytes = this.#buffer.subarray(0, this.#length);
    this.clear();
    return bytes;
  }
  clear() {
    this.#buffer = new Uint8Array(0);
    this.#length = 0;
  }
};

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/core/line-buffer.js
var newline = 10;
var carriageReturn = 13;
var LineBuffer = class {
  /** Bytes of the current (incomplete) line, carried across chunks. */
  #pending;
  #maxMessageBytes;
  #splitOnCarriageReturn;
  /** Whether the last line ended at a CR whose LF may start the next chunk. */
  #afterCarriageReturn = false;
  constructor(maxMessageBytes, { splitOnCarriageReturn = false } = {}) {
    this.#maxMessageBytes = resolveMaxMessageBytes(maxMessageBytes);
    this.#pending = new MessageBuffer(Math.min(Number.MAX_SAFE_INTEGER, this.#maxMessageBytes + 1));
    this.#splitOnCarriageReturn = splitOnCarriageReturn;
  }
  /**
   * Consumes a chunk, yielding each complete line without its line ending.
   */
  *push(chunk) {
    let start = 0;
    if (this.#afterCarriageReturn && chunk.byteLength > 0) {
      this.#afterCarriageReturn = false;
      if (chunk[0] === newline) {
        start = 1;
      }
    }
    let newlineIndex = chunk.indexOf(newline, start);
    let carriageReturnIndex = this.#splitOnCarriageReturn ? chunk.indexOf(carriageReturn, start) : -1;
    while (newlineIndex !== -1 || carriageReturnIndex !== -1) {
      if (carriageReturnIndex === -1 || newlineIndex !== -1 && newlineIndex < carriageReturnIndex) {
        yield this.#takeLine(chunk.subarray(start, newlineIndex));
        start = newlineIndex + 1;
        newlineIndex = chunk.indexOf(newline, start);
      } else {
        yield this.#takeLine(chunk.subarray(start, carriageReturnIndex));
        start = carriageReturnIndex + 1;
        if (start === chunk.byteLength) {
          this.#afterCarriageReturn = true;
        } else if (chunk[start] === newline) {
          start++;
          newlineIndex = chunk.indexOf(newline, start);
        }
        carriageReturnIndex = chunk.indexOf(carriageReturn, start);
      }
    }
    if (start < chunk.byteLength) {
      const tail = chunk.subarray(start);
      this.#checkLine(tail);
      this.#pending.append(tail);
    }
  }
  /**
   * Returns the trailing unterminated line and resets the buffer, or
   * undefined if no bytes are buffered.
   */
  flush() {
    this.#afterCarriageReturn = false;
    if (this.#pending.byteLength === 0) {
      return void 0;
    }
    return stripCarriageReturn(this.#pending.take());
  }
  clear() {
    this.#afterCarriageReturn = false;
    this.#pending.clear();
  }
  #takeLine(tail) {
    this.#checkLine(tail);
    if (this.#pending.byteLength === 0) {
      return stripCarriageReturn(tail);
    }
    this.#pending.append(tail);
    return stripCarriageReturn(this.#pending.take());
  }
  #checkLine(tail) {
    const lastByte = tail.byteLength > 0 ? tail[tail.byteLength - 1] : this.#pending.lastByte;
    const byteLength = this.#pending.byteLength + tail.byteLength - (lastByte === carriageReturn ? 1 : 0);
    if (byteLength > this.#maxMessageBytes) {
      this.clear();
      throw new MessageTooLargeError(this.#maxMessageBytes);
    }
  }
};
function stripCarriageReturn(line) {
  return line[line.byteLength - 1] === carriageReturn ? line.subarray(0, -1) : line;
}

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/core/stream.js
function ndJsonStream(output, input, options = {}) {
  const maxMessageBytes = resolveMaxMessageBytes(options.maxMessageBytes);
  const textEncoder = new TextEncoder();
  const textDecoder = new TextDecoder();
  let cancelled = false;
  let inputReader;
  let outputWrite = Promise.resolve();
  const writeJson = (message) => {
    const content = JSON.stringify(message) + "\n";
    const write = outputWrite.then(async () => {
      const writer = output.getWriter();
      try {
        await writer.write(textEncoder.encode(content));
      } finally {
        writer.releaseLock();
      }
    });
    outputWrite = write.catch(() => {
    });
    return write;
  };
  const readable = new ReadableStream({
    async start(controller) {
      const lines = new LineBuffer(maxMessageBytes);
      const enqueueLine = async (lineBytes) => {
        const trimmedLine = textDecoder.decode(lineBytes).trim();
        if (!trimmedLine) {
          return;
        }
        let message;
        try {
          message = JSON.parse(trimmedLine);
        } catch {
          await writeJson(protocolErrorResponse(RequestError.parseError()));
          return;
        }
        if (Array.isArray(message)) {
          await writeJson(protocolErrorResponse(RequestError.invalidRequest(void 0, "JSON-RPC batches are not supported")));
        } else if (isRecord(message)) {
          controller.enqueue(message);
        } else {
          await writeJson(protocolErrorResponse(RequestError.invalidRequest(message)));
        }
      };
      const reader = input.getReader();
      inputReader = reader;
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (cancelled) {
            return;
          }
          if (done) {
            break;
          }
          if (!value) {
            continue;
          }
          for (const line of lines.push(value)) {
            await enqueueLine(line);
            if (cancelled) {
              return;
            }
          }
        }
        if (cancelled) {
          return;
        }
        const lastLine = lines.flush();
        if (lastLine) {
          await enqueueLine(lastLine);
        }
      } catch (err) {
        if (cancelled) {
          return;
        }
        controller.error(err);
        void reader.cancel(err).catch(() => {
        });
        return;
      } finally {
        lines.clear();
        if (inputReader === reader) {
          inputReader = void 0;
        }
        reader.releaseLock();
      }
      if (cancelled) {
        return;
      }
      controller.close();
    },
    cancel(reason) {
      cancelled = true;
      return inputReader?.cancel(reason);
    }
  });
  const writable = new WritableStream({
    write(message) {
      return writeJson(message);
    }
  });
  return { readable, writable };
}

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/v1/schema/guards.gen.js
var zGuardCreateElicitationRequestForm = zElicitationFormMode.and(object({ mode: literal("form") })).and(object({ message: string2() }));
var zGuardCreateElicitationRequestUrl = zElicitationUrlMode.and(object({ mode: literal("url") })).and(object({ message: string2() }));
var zGuardCreateElicitationRequestCustom = union([zElicitationSessionScope, zElicitationRequestScope]).and(object({ message: string2() }));
var zGuardElicitationPropertySchemaString = zStringPropertySchema.and(object({ type: literal("string") }));
var zGuardElicitationPropertySchemaNumber = zNumberPropertySchema.and(object({ type: literal("number") }));
var zGuardElicitationPropertySchemaInteger = zIntegerPropertySchema.and(object({ type: literal("integer") }));
var zGuardElicitationPropertySchemaBoolean = zBooleanPropertySchema.and(object({ type: literal("boolean") }));
var zGuardElicitationPropertySchemaArray = zMultiSelectPropertySchema.and(object({ type: literal("array") }));
var zGuardMultiSelectItemsString = zStringMultiSelectItems.and(object({ type: literal("string") }));
var zGuardCreateElicitationResponseAccept = zElicitationAcceptAction.and(object({ action: literal("accept") }));
var zGuardCreateElicitationResponseDecline = object({
  action: literal("decline")
});
var zGuardCreateElicitationResponseCancel = object({
  action: literal("cancel")
});

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/core/app-handlers.js
function parseParams(parser, params) {
  if (!parser) {
    return params;
  }
  if (typeof parser === "function") {
    return parser(params);
  }
  return parser.parse(params);
}
function registerAppRequest(builder, spec, context, handler, serializeResponse, lifecycle) {
  const handle = async (params, responder, cx, method) => {
    try {
      const response = await handler(context(params, cx, responder.signal, responder.id, method));
      const sentResponse = serializeResponse ? serializeResponse(response) : response;
      lifecycle?.beforeResponse(params, sentResponse, cx);
      await responder.respond(sentResponse);
    } catch (error2) {
      lifecycle?.onError(cx, error2);
      throw error2;
    }
  };
  if (spec.method === "*") {
    builder.withFallbackHandler({
      handleMessage: async (message, cx) => {
        if (message.kind !== "request")
          return Handled.no(message);
        await handle(message.params, message.responder, cx, message.method);
        return Handled.yes();
      }
    });
  } else {
    builder.onReceiveRequest(spec.method, (params) => parseParams(spec.params, params), (params, responder, cx) => handle(params, responder, cx, spec.method));
  }
}
function registerAppNotification(builder, spec, context, handler) {
  if (spec.method === "*") {
    builder.withFallbackHandler({
      handleMessage: async (message, cx) => {
        if (message.kind !== "notification")
          return Handled.no(message);
        await handler(context(message.params, cx, cx.signal, message.method));
        return Handled.yes();
      }
    });
  } else {
    builder.onReceiveNotification(spec.method, (params) => parseParams(spec.params, params), (params, cx) => handler(context(params, cx, cx.signal, spec.method)));
  }
}

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/core/connection-access.js
var connectionContextOf = /* @__PURE__ */ Symbol("connectionContextOf");

// ../../super-agent-zcode/node_modules/@agentclientprotocol/sdk/dist/v1/stable/acp.js
function ndJsonStream2(output, input, options) {
  return ndJsonStream(output, input, options);
}
var initializedConnections = /* @__PURE__ */ new WeakSet();
function agentInitializationGate(enabled) {
  return {
    handleMessage(message, cx) {
      if (message.kind !== "request" || !enabled() || initializedConnections.has(cx)) {
        return Handled.no(message);
      }
      if (message.method !== AGENT_METHODS.initialize) {
        return message.responder.respondWithError(RequestError.invalidRequest(void 0, `ACP connection must be initialized before '${message.method}'`)).then(() => Handled.yes());
      }
      const { responder } = message;
      return Handled.no({
        ...message,
        responder: new RequestResponder(responder.id, (result) => {
          if ("result" in result) {
            initializedConnections.add(cx);
          }
          return responder.respondWithResult(result);
        }, responder.signal)
      });
    },
    describe: () => "agent-initialization"
  };
}
function emptyObjectResponse(response) {
  return response ?? {};
}
function isStream(value) {
  return typeof value === "object" && value !== null && "readable" in value && "writable" in value;
}
function memoryStreamPair() {
  const leftToRight = new TransformStream();
  const rightToLeft = new TransformStream();
  return [
    {
      readable: rightToLeft.readable,
      writable: leftToRight.writable
    },
    {
      readable: leftToRight.readable,
      writable: rightToLeft.writable
    }
  ];
}
var methods = {
  agent: {
    initialize: AGENT_METHODS.initialize,
    authenticate: AGENT_METHODS.authenticate,
    logout: AGENT_METHODS.logout,
    session: {
      new: AGENT_METHODS.session_new,
      load: AGENT_METHODS.session_load,
      list: AGENT_METHODS.session_list,
      delete: AGENT_METHODS.session_delete,
      resume: AGENT_METHODS.session_resume,
      close: AGENT_METHODS.session_close,
      setMode: AGENT_METHODS.session_set_mode,
      setConfigOption: AGENT_METHODS.session_set_config_option,
      prompt: AGENT_METHODS.session_prompt,
      cancel: AGENT_METHODS.session_cancel
    }
  },
  client: {
    session: {
      requestPermission: CLIENT_METHODS.session_request_permission,
      update: CLIENT_METHODS.session_update
    },
    fs: {
      writeTextFile: CLIENT_METHODS.fs_write_text_file,
      readTextFile: CLIENT_METHODS.fs_read_text_file
    },
    terminal: {
      create: CLIENT_METHODS.terminal_create,
      output: CLIENT_METHODS.terminal_output,
      release: CLIENT_METHODS.terminal_release,
      waitForExit: CLIENT_METHODS.terminal_wait_for_exit,
      kill: CLIENT_METHODS.terminal_kill
    },
    elicitation: {
      create: CLIENT_METHODS.elicitation_create,
      complete: CLIENT_METHODS.elicitation_complete
    }
  },
  protocol: {
    cancelRequest: PROTOCOL_METHODS.cancel_request
  }
};
var startActiveSession = /* @__PURE__ */ Symbol("startActiveSession");
var AcpContext = class {
  cx;
  currentRequestId;
  /** @internal */
  constructor(cx, currentRequestId) {
    this.cx = cx;
    this.currentRequestId = currentRequestId;
  }
  /**
   * JSON-RPC id of the request currently being handled.
   *
   * This is `undefined` for notification handlers and for contexts created
   * outside an inbound request, such as `connect(...)` and `connectWith(...)`.
   */
  get requestId() {
    return this.currentRequestId;
  }
  /** @internal */
  get connectionContext() {
    return this.cx;
  }
  /** @hidden SDK helpers use this to identify the connection. */
  [connectionContextOf]() {
    return this.cx;
  }
  /** @internal */
  sendRequest(method, params, mapResponse, options) {
    return this.cx.sendRequest(method, params, mapResponse, options);
  }
  /** @internal */
  sendNotification(method, params) {
    return this.cx.sendNotification(method, params);
  }
  /** @internal */
  addDynamicHandler(handler) {
    return this.cx.addDynamicHandler(handler);
  }
};
var AgentContext = class _AgentContext extends AcpContext {
  constructor(cx, requestId) {
    super(cx, requestId);
  }
  /** @internal */
  static create(cx, requestId) {
    return new _AgentContext(cx, requestId);
  }
  /**
   * Executes a command in a new client terminal.
   *
   * Returns a handle for reading output, waiting for exit, killing the command,
   * and releasing the terminal. Check the client's terminal capability first.
   * Use `await using` or call `release()` when finished.
   */
  async createTerminal(params, options) {
    const response = await this.request(CLIENT_METHODS.terminal_create, params, options);
    return TerminalHandle.create(response.terminalId, params.sessionId, this.connectionContext);
  }
  request(method, params, options) {
    const spec = clientRequestSpecsByMethod[method];
    return this.sendRequest(method, params, spec?.mapResponse, options);
  }
  notify(method, params) {
    return this.sendNotification(method, params);
  }
};
var ClientContext = class _ClientContext extends AcpContext {
  constructor(cx, requestId) {
    super(cx, requestId);
  }
  /** @internal */
  static create(cx, requestId) {
    return new _ClientContext(cx, requestId);
  }
  /** @internal */
  [startActiveSession](params, options) {
    return this.sendRequest(AGENT_METHODS.session_new, params, (response) => this.attachSession(response), options);
  }
  buildSession(cwdOrRequest) {
    if (typeof cwdOrRequest === "string") {
      return SessionBuilder.create(this, {
        cwd: cwdOrRequest,
        mcpServers: []
      });
    }
    return SessionBuilder.create(this, cwdOrRequest);
  }
  /**
   * Builds active-session helpers around a `session/new` response.
   */
  attachSession(response) {
    const updates = new AsyncQueue();
    const closeSignal = this.connectionContext.signal;
    const failUpdatesOnClose = () => {
      updates.fail(closeSignal.reason ?? new Error("ACP connection closed"));
    };
    if (closeSignal.aborted) {
      failUpdatesOnClose();
    } else {
      closeSignal.addEventListener("abort", failUpdatesOnClose);
    }
    const sessionRegistration = sessionUpdateRouter(this.connectionContext).attach(response, updates);
    const closeRegistration = new HandlerRegistration(() => {
      closeSignal.removeEventListener("abort", failUpdatesOnClose);
    });
    return ActiveSession.create(this, response, updates, [
      sessionRegistration,
      closeRegistration
    ]);
  }
  request(method, params, options) {
    const spec = agentRequestSpecsByMethod[method];
    return treatSessionNotFoundAsSuccess(method, this.sendRequest(method, params, spec?.mapResponse, options), () => spec?.mapResponse ? spec.mapResponse({}) : {});
  }
  notify(method, params) {
    return this.sendNotification(method, params);
  }
};
var AcpConnectionHandle = class {
  connection;
  constructor(connection) {
    this.connection = connection;
  }
  get signal() {
    return this.connection.signal;
  }
  get closed() {
    return this.connection.closed;
  }
  close(error2) {
    this.connection.close(error2);
  }
};
var AgentConnectionHandle = class extends AcpConnectionHandle {
  connectHandlers;
  client;
  didStartConnectHandlers = false;
  constructor(connection, connectHandlers = []) {
    super(connection);
    this.connectHandlers = connectHandlers;
    this.client = AgentContext.create(connection.getContext());
  }
  /** @internal */
  startConnectHandlers() {
    if (this.didStartConnectHandlers) {
      return;
    }
    this.didStartConnectHandlers = true;
    runConnectHandlers(this, this.connectHandlers);
  }
};
var ClientConnectionHandle = class extends AcpConnectionHandle {
  connectHandlers;
  agent;
  didStartConnectHandlers = false;
  constructor(connection, connectHandlers = []) {
    super(connection);
    this.connectHandlers = connectHandlers;
    this.agent = ClientContext.create(connection.getContext());
  }
  /** @internal */
  startConnectHandlers() {
    if (this.didStartConnectHandlers) {
      return;
    }
    this.didStartConnectHandlers = true;
    runConnectHandlers(this, this.connectHandlers);
  }
};
function agentConnection(connection, connectHandlers = []) {
  return new AgentConnectionHandle(connection, connectHandlers);
}
function clientConnection(connection, connectHandlers = []) {
  return new ClientConnectionHandle(connection, connectHandlers);
}
var AsyncQueue = class {
  values = [];
  waiters = [];
  failed = false;
  failure;
  enqueue(value) {
    if (this.failed) {
      return;
    }
    const waiter = this.waiters.shift();
    if (waiter) {
      waiter.resolve(value);
    } else {
      this.values.push({ kind: "value", value });
    }
  }
  reject(error2) {
    if (this.failed) {
      return;
    }
    if (this.waiters.length > 0) {
      for (const waiter of this.waiters.splice(0)) {
        waiter.reject(error2);
      }
      return;
    }
    this.values.push({ kind: "error", error: error2 });
  }
  clearErrors() {
    this.values = this.values.filter((entry) => entry.kind === "value");
  }
  fail(error2) {
    if (this.failed) {
      return;
    }
    this.failed = true;
    this.failure = error2;
    for (const waiter of this.waiters.splice(0)) {
      waiter.reject(error2);
    }
  }
  next() {
    if (this.values.length > 0) {
      const entry = this.values.shift();
      if (entry.kind === "error") {
        return Promise.reject(entry.error);
      }
      return Promise.resolve(entry.value);
    }
    if (this.failed) {
      return Promise.reject(this.failure);
    }
    return new Promise((resolve7, reject) => {
      this.waiters.push({ resolve: resolve7, reject });
    });
  }
};
function cloneNewSessionRequest(request) {
  return {
    ...request,
    additionalDirectories: request.additionalDirectories ? [...request.additionalDirectories] : void 0,
    mcpServers: [...request.mcpServers]
  };
}
var SessionBuilder = class _SessionBuilder {
  cx;
  request;
  constructor(cx, request) {
    this.cx = cx;
    this.request = cloneNewSessionRequest(request);
  }
  /** @internal */
  static create(cx, request) {
    return new _SessionBuilder(cx, request);
  }
  /**
   * Returns the `session/new` request that will be sent.
   *
   * The returned object is a defensive copy, so mutating it does not change the
   * builder.
   */
  toRequest() {
    return cloneNewSessionRequest(this.request);
  }
  /**
   * Replaces the additional workspace roots for this session.
   *
   * `additionalDirectories` expand the session's file-system scope without
   * changing `cwd`. Each path should be absolute.
   */
  withAdditionalDirectories(additionalDirectories) {
    this.request = {
      ...this.request,
      additionalDirectories: [...additionalDirectories]
    };
    return this;
  }
  /**
   * Adds one MCP server to the `session/new` request.
   */
  withMcpServer(mcpServer) {
    this.request = {
      ...this.request,
      mcpServers: [...this.request.mcpServers, mcpServer]
    };
    return this;
  }
  /**
   * Starts the session and returns an `ActiveSession` for prompting and reading
   * updates.
   *
   * Call `dispose()` on the returned session when you no longer need update
   * routing, or use `withSession(...)` to scope disposal automatically.
   */
  async start(options) {
    return this.cx[startActiveSession](this.toRequest(), options);
  }
  /**
   * Starts the session, runs `op`, and disposes the active-session update
   * routing when `op` finishes or throws.
   */
  async withSession(op) {
    const session = await this.start();
    try {
      return await op(session);
    } finally {
      session.dispose();
    }
  }
};
var ActiveSession = class _ActiveSession {
  cx;
  sessionResponse;
  updates;
  registrations;
  constructor(cx, sessionResponse, updates, registrations) {
    this.cx = cx;
    this.sessionResponse = sessionResponse;
    this.updates = updates;
    this.registrations = registrations;
  }
  /** @internal */
  static create(cx, sessionResponse, updates, registrations) {
    return new _ActiveSession(cx, sessionResponse, updates, registrations);
  }
  /**
   * Session ID returned by `session/new`.
   */
  get sessionId() {
    return this.sessionResponse.sessionId;
  }
  /**
   * Mode state returned when the session was created, if the agent provided it.
   */
  get modes() {
    return this.sessionResponse.modes;
  }
  /**
   * Metadata returned when the session was created.
   */
  get meta() {
    return this.sessionResponse._meta;
  }
  /**
   * Full response returned by `session/new`.
   */
  get newSessionResponse() {
    return this.sessionResponse;
  }
  /**
   * Sends a prompt to this session.
   *
   * Strings are converted to one text content block. A single content block is
   * wrapped in an array. The returned promise resolves with the final
   * `PromptResponse`, and the same completion is also queued as a `stop`
   * message for `nextUpdate()`.
   */
  prompt(prompt, options) {
    this.updates.clearErrors();
    const response = this.cx.request(AGENT_METHODS.session_prompt, {
      sessionId: this.sessionId,
      prompt: this.promptBlocks(prompt)
    }, options);
    void response.then((value) => {
      this.updates.enqueue({
        kind: "stop",
        response: value,
        stopReason: value.stopReason
      });
    }, (error2) => {
      this.updates.reject(error2);
    });
    return response;
  }
  /**
   * Reads the next update or stop message for this session.
   */
  nextUpdate() {
    return this.updates.next();
  }
  /**
   * Reads text chunks until the current prompt turn stops.
   *
   * Only `agent_message_chunk` updates with text content are appended. Other
   * update types are ignored by this helper; use `nextUpdate()` when you need
   * tool calls, plans, or the final `PromptResponse`.
   */
  async readText() {
    let output = "";
    for (; ; ) {
      const message = await this.nextUpdate();
      if (message.kind === "stop") {
        return output;
      }
      const { update } = message;
      if (update.sessionUpdate === "agent_message_chunk" && update.content.type === "text") {
        output += update.content.text;
      }
    }
  }
  /**
   * Stops routing updates to this active-session helper.
   *
   * This does not close the ACP session on the agent. Use `ClientContext`
   * session lifecycle methods when the protocol session itself should be closed
   * or deleted.
   */
  dispose() {
    for (const registration of this.registrations.splice(0)) {
      registration.dispose();
    }
    this.updates.fail(new Error("Active session disposed"));
  }
  /**
   * Supports explicit resource management with `using`.
   */
  [Symbol.dispose]() {
    this.dispose();
  }
  promptBlocks(prompt) {
    if (typeof prompt === "string") {
      return [{ type: "text", text: prompt }];
    }
    if (Array.isArray(prompt)) {
      return prompt;
    }
    return [prompt];
  }
};
function requestSpec(method, params, mapResponse) {
  return {
    method,
    // Match Rust's empty-payload handling without bypassing required fields.
    params: (value) => parseParams(params, value ?? {}),
    mapResponse
  };
}
function notificationSpec(method, params) {
  return { method, params };
}
function specsByMethod(specs) {
  const byMethod = {};
  for (const spec of Object.values(specs)) {
    byMethod[spec.method] = spec;
  }
  return byMethod;
}
var agentRequestSpecs = {
  initialize: requestSpec(AGENT_METHODS.initialize, zInitializeRequest),
  newSession: requestSpec(AGENT_METHODS.session_new, zNewSessionRequest),
  loadSession: requestSpec(AGENT_METHODS.session_load, zLoadSessionRequest, emptyObjectResponse),
  listSessions: requestSpec(AGENT_METHODS.session_list, zListSessionsRequest),
  deleteSession: requestSpec(AGENT_METHODS.session_delete, zDeleteSessionRequest, emptyObjectResponse),
  resumeSession: requestSpec(AGENT_METHODS.session_resume, zResumeSessionRequest),
  closeSession: requestSpec(AGENT_METHODS.session_close, zCloseSessionRequest, emptyObjectResponse),
  setSessionMode: requestSpec(AGENT_METHODS.session_set_mode, zSetSessionModeRequest, emptyObjectResponse),
  setSessionConfigOption: requestSpec(AGENT_METHODS.session_set_config_option, zSetSessionConfigOptionRequest),
  authenticate: requestSpec(AGENT_METHODS.authenticate, zAuthenticateRequest, emptyObjectResponse),
  logout: requestSpec(AGENT_METHODS.logout, zLogoutRequest, emptyObjectResponse),
  prompt: requestSpec(AGENT_METHODS.session_prompt, zPromptRequest)
};
var agentNotificationSpecs = {
  cancel: notificationSpec(AGENT_METHODS.session_cancel, zCancelNotification)
};
var clientRequestSpecs = {
  requestPermission: requestSpec(CLIENT_METHODS.session_request_permission, zRequestPermissionRequest),
  writeTextFile: requestSpec(CLIENT_METHODS.fs_write_text_file, zWriteTextFileRequest, emptyObjectResponse),
  readTextFile: requestSpec(CLIENT_METHODS.fs_read_text_file, zReadTextFileRequest),
  createTerminal: requestSpec(CLIENT_METHODS.terminal_create, zCreateTerminalRequest),
  terminalOutput: requestSpec(CLIENT_METHODS.terminal_output, zTerminalOutputRequest),
  releaseTerminal: requestSpec(CLIENT_METHODS.terminal_release, zReleaseTerminalRequest, emptyObjectResponse),
  waitForTerminalExit: requestSpec(CLIENT_METHODS.terminal_wait_for_exit, zWaitForTerminalExitRequest),
  killTerminal: requestSpec(CLIENT_METHODS.terminal_kill, zKillTerminalRequest, emptyObjectResponse),
  createElicitation: requestSpec(CLIENT_METHODS.elicitation_create, zCreateElicitationRequest)
};
var clientNotificationSpecs = {
  sessionUpdate: notificationSpec(CLIENT_METHODS.session_update, zSessionNotification),
  completeElicitation: notificationSpec(CLIENT_METHODS.elicitation_complete, zCompleteElicitationNotification)
};
var agentRequestSpecsByMethod = specsByMethod(agentRequestSpecs);
var agentNotificationSpecsByMethod = specsByMethod(agentNotificationSpecs);
var clientRequestSpecsByMethod = specsByMethod(clientRequestSpecs);
var clientNotificationSpecsByMethod = specsByMethod(clientNotificationSpecs);
function agentRequestContext(params, client2, signal, requestId, method) {
  return {
    method,
    params,
    requestId,
    signal,
    client: client2
  };
}
function agentNotificationContext(params, client2, signal, method) {
  return {
    method,
    params,
    signal,
    client: client2
  };
}
function clientRequestContext(params, agent, signal, requestId, method) {
  return {
    method,
    params,
    requestId,
    signal,
    agent
  };
}
function clientNotificationContext(params, agent, signal, method) {
  return {
    method,
    params,
    signal,
    agent
  };
}
var SessionUpdateRouter = class {
  activeSessions = /* @__PURE__ */ new Map();
  handleMessage(message) {
    if (message.kind !== "notification" || message.method !== CLIENT_METHODS.session_update) {
      return Handled.no(message);
    }
    const notification = zSessionNotification.parse(message.params);
    const update = {
      kind: "session_update",
      notification,
      update: notification.update
    };
    const activeSessions = this.activeSessions.get(notification.sessionId);
    if (activeSessions && activeSessions.size > 0) {
      for (const session of activeSessions) {
        session.enqueue(update);
      }
    }
    return Handled.no(message);
  }
  attach(response, updates) {
    const sessions = this.activeSessions.get(response.sessionId) ?? /* @__PURE__ */ new Set();
    sessions.add(updates);
    this.activeSessions.set(response.sessionId, sessions);
    return new HandlerRegistration(() => {
      sessions.delete(updates);
      if (sessions.size === 0) {
        this.activeSessions.delete(response.sessionId);
      }
    });
  }
};
var sessionUpdateRouters = /* @__PURE__ */ new WeakMap();
function sessionUpdateRouter(cx) {
  let router = sessionUpdateRouters.get(cx);
  if (!router) {
    router = new SessionUpdateRouter();
    sessionUpdateRouters.set(cx, router);
  }
  return router;
}
function runConnectHandlers(connection, handlers) {
  for (const handler of handlers) {
    let result;
    try {
      result = handler(connection);
    } catch (error2) {
      connection.close(error2);
      throw error2;
    }
    void Promise.resolve(result).catch((error2) => {
      connection.close(error2);
    });
  }
}
var appBuilder = /* @__PURE__ */ Symbol("appBuilder");
var runAgentConnectHandlers = /* @__PURE__ */ Symbol("runAgentConnectHandlers");
var runClientConnectHandlers = /* @__PURE__ */ Symbol("runClientConnectHandlers");
var AgentApp = class {
  builder = Connection.builder();
  connectHandlers = [];
  fallbackKinds = /* @__PURE__ */ new Set();
  hasInitializeHandler = false;
  constructor(options = {}) {
    this.builder.withHandler(agentInitializationGate(() => this.hasInitializeHandler));
    if (options.name) {
      this.builder.name(options.name);
    }
  }
  /** @internal */
  [appBuilder]() {
    return this.builder;
  }
  /** @internal */
  [runAgentConnectHandlers](connection) {
    runConnectHandlers(connection, this.connectHandlers);
  }
  connect(target, options = {}) {
    return this.connectConnection(target, options).connection;
  }
  /**
   * Connects this agent app to a stream or client app for the lifetime of `op`.
   *
   * The callback receives an `AgentContext` for calling client-side methods.
   * When `op` resolves or rejects, the connection is closed.
   */
  connectWith(target, op) {
    const { rawConnection, connection } = this.connectConnection(target);
    return rawConnection.runUntil(() => op(connection.client));
  }
  /**
   * Registers a handler that runs when this agent app opens a connection.
   *
   * Use this for connection-scoped work that needs to call client-side ACP
   * methods outside an inbound request handler, or to set up per-connection
   * state that the request handlers use.
   *
   * Handlers are called synchronously in registration order and are not
   * awaited. A handler that throws or rejects closes the connection. When they
   * are called depends on who opens the connection:
   *
   * - `connect(...)` and `connectWith(...)` call them before the connection
   *   handles its first inbound message, and so does the experimental
   *   `AgentProtocolRouter`'s `connect(...)` when it routes to this app. Only
   *   the work a handler does before its first `await` is guaranteed to come
   *   first.
   * - The experimental `AcpServer` calls them after the client has completed
   *   `initialize`, so messages they send cannot replace the initialize
   *   response. Request handlers, including `initialize`, can run before them.
   */
  onConnect(handler) {
    this.connectHandlers.push(handler);
    return this;
  }
  onRequest(method, handlerOrParams, handler) {
    if (method === "*") {
      if (handler)
        throw new Error("Wildcard handlers receive raw params; omit the parser.");
      if (this.fallbackKinds.has("request"))
        throw new Error("A request fallback is already registered.");
      this.fallbackKinds.add("request");
      return this.request({ method }, handlerOrParams);
    }
    if (handler) {
      return this.request({ method, params: handlerOrParams }, handler);
    }
    const spec = agentRequestSpecsByMethod[method];
    if (!spec) {
      throw new Error(`Unknown ACP request method '${method}'. Pass a params parser for custom methods.`);
    }
    if (method === AGENT_METHODS.initialize) {
      this.hasInitializeHandler = true;
    }
    return this.request(spec, handlerOrParams);
  }
  onNotification(method, handlerOrParams, handler) {
    if (method === "*") {
      if (handler)
        throw new Error("Wildcard handlers receive raw params; omit the parser.");
      if (this.fallbackKinds.has("notification"))
        throw new Error("A notification fallback is already registered.");
      this.fallbackKinds.add("notification");
      return this.notification({ method }, handlerOrParams);
    }
    if (handler) {
      return this.notification({ method, params: handlerOrParams }, handler);
    }
    const spec = agentNotificationSpecsByMethod[method];
    if (!spec) {
      throw new Error(`Unknown ACP notification method '${method}'. Pass a params parser for custom methods.`);
    }
    return this.notification(spec, handlerOrParams);
  }
  request(spec, handler) {
    registerAppRequest(this.builder, spec, (params, cx, signal, requestId, method) => agentRequestContext(params, AgentContext.create(cx, requestId), signal, requestId, method), handler, spec.mapResponse);
    return this;
  }
  notification(spec, handler) {
    registerAppNotification(this.builder, spec, (params, cx, signal, method) => agentNotificationContext(params, AgentContext.create(cx), signal, method), handler);
    return this;
  }
  connectConnection(target, options = {}) {
    if (isStream(target)) {
      const state2 = this.openStreamConnection(target);
      if (!options.deferConnectHandlers) {
        this[runAgentConnectHandlers](state2.connection);
      }
      return state2;
    }
    const [thisStream, peerStream] = memoryStreamPair();
    const peerRawConnection = target[appBuilder]().connect(peerStream);
    const peerConnection = clientConnection(peerRawConnection);
    const state = this.openStreamConnection(thisStream);
    void state.rawConnection.closed.then(() => peerConnection.close());
    void peerRawConnection.closed.then(() => state.connection.close());
    try {
      target[runClientConnectHandlers](peerConnection);
      this[runAgentConnectHandlers](state.connection);
    } catch (error2) {
      peerConnection.close(error2);
      state.connection.close(error2);
      throw error2;
    }
    return state;
  }
  openStreamConnection(stream) {
    const rawConnection = this.builder.connect(stream);
    return {
      rawConnection,
      connection: agentConnection(rawConnection, this.connectHandlers)
    };
  }
};
function client(options) {
  return new ClientApp(options);
}
var ClientApp = class {
  builder = Connection.builder();
  connectHandlers = [];
  fallbackKinds = /* @__PURE__ */ new Set();
  constructor(options = {}) {
    if (options.name) {
      this.builder.name(options.name);
    }
    this.builder.withHandler({
      handleMessage: (message, cx) => sessionUpdateRouter(cx).handleMessage(message),
      describe: () => "client-session-update-router"
    });
  }
  /** @internal */
  [appBuilder]() {
    return this.builder;
  }
  /** @internal */
  [runClientConnectHandlers](connection) {
    runConnectHandlers(connection, this.connectHandlers);
  }
  connect(target) {
    return this.connectConnection(target).connection;
  }
  /**
   * Connects this client app to a stream or agent app for the lifetime of `op`.
   *
   * The callback receives a `ClientContext` for calling agent-side methods.
   * When `op` resolves or rejects, the connection is closed.
   */
  connectWith(target, op) {
    const { rawConnection, connection } = this.connectConnection(target);
    return rawConnection.runUntil(() => op(connection.agent));
  }
  /**
   * Registers a handler that runs when this client app opens a connection.
   *
   * Use this for connection-scoped work that needs to call agent-side ACP
   * methods outside an inbound request handler.
   */
  onConnect(handler) {
    this.connectHandlers.push(handler);
    return this;
  }
  onRequest(method, handlerOrParams, handler) {
    if (method === "*") {
      if (handler)
        throw new Error("Wildcard handlers receive raw params; omit the parser.");
      if (this.fallbackKinds.has("request"))
        throw new Error("A request fallback is already registered.");
      this.fallbackKinds.add("request");
      return this.request({ method }, handlerOrParams);
    }
    if (handler) {
      return this.request({ method, params: handlerOrParams }, handler);
    }
    const spec = clientRequestSpecsByMethod[method];
    if (!spec) {
      throw new Error(`Unknown ACP request method '${method}'. Pass a params parser for custom methods.`);
    }
    return this.request(spec, handlerOrParams);
  }
  onNotification(method, handlerOrParams, handler) {
    if (method === "*") {
      if (handler)
        throw new Error("Wildcard handlers receive raw params; omit the parser.");
      if (this.fallbackKinds.has("notification"))
        throw new Error("A notification fallback is already registered.");
      this.fallbackKinds.add("notification");
      return this.notification({ method }, handlerOrParams);
    }
    if (handler) {
      return this.notification({ method, params: handlerOrParams }, handler);
    }
    const spec = clientNotificationSpecsByMethod[method];
    if (!spec) {
      throw new Error(`Unknown ACP notification method '${method}'. Pass a params parser for custom methods.`);
    }
    return this.notification(spec, handlerOrParams);
  }
  request(spec, handler) {
    registerAppRequest(this.builder, spec, (params, cx, signal, requestId, method) => clientRequestContext(params, ClientContext.create(cx, requestId), signal, requestId, method), handler, spec.mapResponse);
    return this;
  }
  notification(spec, handler) {
    registerAppNotification(this.builder, spec, (params, cx, signal, method) => clientNotificationContext(params, ClientContext.create(cx), signal, method), handler);
    return this;
  }
  connectConnection(target) {
    if (isStream(target)) {
      const state2 = this.openStreamConnection(target);
      this[runClientConnectHandlers](state2.connection);
      return state2;
    }
    const [thisStream, peerStream] = memoryStreamPair();
    const peerRawConnection = target[appBuilder]().connect(peerStream);
    const peerConnection = agentConnection(peerRawConnection);
    const state = this.openStreamConnection(thisStream);
    void state.rawConnection.closed.then(() => peerConnection.close());
    void peerRawConnection.closed.then(() => state.connection.close());
    try {
      target[runAgentConnectHandlers](peerConnection);
      this[runClientConnectHandlers](state.connection);
    } catch (error2) {
      peerConnection.close(error2);
      state.connection.close(error2);
      throw error2;
    }
    return state;
  }
  openStreamConnection(stream) {
    const rawConnection = this.builder.connect(stream);
    return {
      rawConnection,
      connection: clientConnection(rawConnection, this.connectHandlers)
    };
  }
};
var TerminalHandle = class _TerminalHandle {
  /**
   * Terminal identifier returned by `terminal/create`.
   */
  id;
  sessionId;
  connection;
  constructor(id, sessionId, conn) {
    this.id = id;
    this.sessionId = sessionId;
    this.connection = conn;
  }
  /** @internal */
  static create(id, sessionId, conn) {
    return new _TerminalHandle(id, sessionId, conn);
  }
  /**
   * Gets the current terminal output without waiting for the command to exit.
   */
  currentOutput() {
    return this.connection.sendRequest(CLIENT_METHODS.terminal_output, {
      sessionId: this.sessionId,
      terminalId: this.id
    });
  }
  /**
   * Waits for the terminal command to complete and returns its exit status.
   */
  waitForExit() {
    return this.connection.sendRequest(CLIENT_METHODS.terminal_wait_for_exit, {
      sessionId: this.sessionId,
      terminalId: this.id
    });
  }
  /**
   * Kills the terminal command without releasing the terminal.
   *
   * The terminal remains valid after killing, allowing you to:
   * - Get the final output with `currentOutput()`
   * - Check the exit status
   * - Release the terminal when done
   *
   * Useful for implementing timeouts or cancellation.
   */
  kill() {
    return this.connection.sendRequest(CLIENT_METHODS.terminal_kill, {
      sessionId: this.sessionId,
      terminalId: this.id
    }, emptyObjectResponse);
  }
  /**
   * Releases the terminal and frees all associated resources.
   *
   * If the command is still running, it will be killed.
   * After release, the terminal ID becomes invalid and cannot be used
   * with other terminal methods.
   *
   * Tool calls that already reference this terminal will continue to
   * display its output.
   *
   * **Important:** Always call this method when done with the terminal.
   */
  release() {
    return this.connection.sendRequest(CLIENT_METHODS.terminal_release, {
      sessionId: this.sessionId,
      terminalId: this.id
    }, emptyObjectResponse);
  }
  /**
   * Releases the terminal when used with `await using`.
   */
  async [Symbol.asyncDispose]() {
    await this.release();
  }
};

// ../../super-agent-zcode/packages/client/src/agentConnection.ts
function tapStream(inner, onMessage) {
  const outgoing = new TransformStream({
    transform(msg, controller) {
      onMessage("out", msg);
      controller.enqueue(msg);
    }
  });
  const incoming = new TransformStream({
    transform(msg, controller) {
      onMessage("in", msg);
      controller.enqueue(msg);
    }
  });
  void outgoing.readable.pipeTo(inner.writable).catch(() => {
  });
  return {
    writable: outgoing.writable,
    readable: inner.readable.pipeThrough(incoming)
  };
}
var AgentConnectionHandle2 = class _AgentConnectionHandle {
  id = newId("conn");
  child;
  /** 线路原文（字节级，未解析，两个方向按到达顺序）——尝试记录引用此文件 */
  rawLogPath;
  /** 消息级结构化日志（JSONL，每个 JSON-RPC 报文一行） */
  msgLogPath;
  stderrLogPath;
  /** initialize 响应 —— Agent 声明的能力（AGT-03：声明与实测分开） */
  declared = null;
  /** 观察到的私有/扩展方法（下划线前缀），只记名字不记内容（AC-28） */
  observedExtensions = [];
  conn;
  msgLog;
  wireLog;
  closedListeners = /* @__PURE__ */ new Set();
  permissionHandlers = /* @__PURE__ */ new Map();
  closedAnnounced = false;
  constructor(child, dataDir, conn) {
    this.child = child;
    this.conn = conn;
    this.rawLogPath = path4.join(dataDir, "raw-wire", `${this.id}.log`);
    this.msgLogPath = path4.join(dataDir, "raw", `${this.id}.jsonl`);
    this.stderrLogPath = path4.join(dataDir, "agent-stderr", `${this.id}.log`);
    this.msgLog = new JsonlLog(this.msgLogPath);
    this.wireLog = new ByteLog(this.rawLogPath);
  }
  static async start(cfg, dataDir, callbacks) {
    const command = process.env.SUPER_NODE_EXE?.trim() || cfg.command;
    const parentEnv = { ...process.env };
    delete parentEnv.ELECTRON_RUN_AS_NODE;
    const child = spawn(command, cfg.args, {
      cwd: cfg.cwd,
      env: { ...parentEnv, ...cfg.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true
    });
    const app = client({ name: "super-agent-client" });
    const handleRef = {};
    app.onNotification("session/update", ({ params }) => {
      const handle2 = handleRef.handle;
      if (handle2) callbacks.onSessionUpdate(handle2, params);
    });
    app.onNotification("*", ({ method }) => {
      const handle2 = handleRef.handle;
      if (handle2 && method.startsWith("_")) handle2.notePrivateNotification(method);
    });
    app.onRequest("session/request_permission", ({ params }) => {
      const handler = handleRef.handle?.permissionHandlerFor(params.sessionId);
      if (handler) return handler(params);
      return Promise.resolve({ outcome: { outcome: "cancelled" } });
    });
    const stdoutTee = new PassThrough();
    child.stdout.pipe(stdoutTee);
    stdoutTee.on("data", (chunk) => handleRef.handle?.appendWire("in", chunk));
    const stdinTee = new PassThrough();
    stdinTee.pipe(child.stdin);
    stdinTee.on("data", (chunk) => handleRef.handle?.appendWire("out", chunk));
    const wire = ndJsonStream2(
      Writable.toWeb(stdinTee),
      Readable.toWeb(stdoutTee)
    );
    const tapped = tapStream(wire, (dir, msg) => {
      handleRef.handle?.appendRaw(dir, msg);
    });
    const conn = app.connect(tapped);
    const handle = new _AgentConnectionHandle(child, dataDir, conn);
    handleRef.handle = handle;
    await mkdir(path4.dirname(handle.stderrLogPath), { recursive: true });
    const stderrFile = createWriteStream(handle.stderrLogPath, { flags: "a" });
    child.stderr?.pipe(stderrFile);
    const announceClosed = (info) => {
      if (handle.closedAnnounced) return;
      handle.closedAnnounced = true;
      for (const listener of handle.closedListeners) {
        try {
          listener(info);
        } catch {
        }
      }
    };
    child.on("exit", (code, signal) => announceClosed({ exitCode: code, signal }));
    child.on(
      "error",
      (err) => announceClosed({ exitCode: null, signal: null, error: err })
    );
    void conn.closed.then(
      () => announceClosed({
        exitCode: child.exitCode,
        signal: child.signalCode ?? null
      })
    );
    const INIT_TIMEOUT_MS = Number(process.env.SUPER_INIT_TIMEOUT_MS ?? 6e4);
    const initRequest = conn.agent.request("initialize", {
      protocolVersion: PROTOCOL_VERSION,
      clientCapabilities: {},
      clientInfo: { name: "super-agent-client", version: "0.1.0-m1" }
    });
    let initTimer;
    try {
      handle.declared = await Promise.race([
        initRequest,
        new Promise((_, reject) => {
          initTimer = setTimeout(
            () => reject(
              new Error(
                `initialize \u8D85\u65F6\uFF08${INIT_TIMEOUT_MS}ms\uFF09\uFF1A\u8FDB\u7A0B\u672A\u6309 ACP stdio \u5E94\u7B54\uFF08\u68C0\u67E5\u542F\u52A8\u547D\u4EE4/\u53C2\u6570\u4E0E\u767B\u5F55\u6001\uFF09`
              )
            ),
            INIT_TIMEOUT_MS
          );
        })
      ]);
    } catch (err) {
      handle.close();
      throw err;
    } finally {
      clearTimeout(initTimer);
    }
    return handle;
  }
  onClosed(listener) {
    this.closedListeners.add(listener);
  }
  /** 连接是否已宣布关闭（用于区分“对端断开导致的请求失败”与真实协议错误） */
  get connectionClosed() {
    return this.closedAnnounced;
  }
  appendRaw(dir, msg) {
    this.msgLog.append({ dir, at: (/* @__PURE__ */ new Date()).toISOString(), msg });
  }
  /** 字节级线路原文：不解析、不改写字节内容；块之间插入方向标记便于排检 */
  appendWire(dir, chunk) {
    this.wireLog.append(Buffer.from(`
@@${dir}
`));
    this.wireLog.append(chunk);
  }
  /** 私有/扩展通知：只记录方法名，内容留在原始日志，不进入标准化事件（AC-28） */
  notePrivateNotification(method) {
    if (!this.observedExtensions.includes(method)) {
      this.observedExtensions.push(method);
    }
    this.msgLog.append({
      private_notification: method,
      at: (/* @__PURE__ */ new Date()).toISOString(),
      note: "\u5185\u5BB9\u4E0D\u5165\u6807\u51C6\u5316\u4E8B\u4EF6\uFF08\u9690\u79C1\uFF09"
    });
  }
  registerPermissionHandler(sessionId, handler) {
    this.permissionHandlers.set(sessionId, handler);
  }
  unregisterPermissionHandler(sessionId) {
    this.permissionHandlers.delete(sessionId);
  }
  permissionHandlerFor(sessionId) {
    return this.permissionHandlers.get(sessionId);
  }
  newSession(cwd) {
    return this.conn.agent.request("session/new", { cwd, mcpServers: [] });
  }
  /** 切换会话模式（如 Codex 的 read-only）；不支持时由对端报错，调用方按 AC-37 处理 */
  setMode(sessionId, modeId) {
    return this.conn.agent.request("session/set_mode", { sessionId, modeId });
  }
  /** 设置会话配置项（模型/推理档位等）；value 为布尔或配置值 ID */
  setConfigOption(sessionId, configId, value) {
    const configValue = typeof value === "boolean" ? { type: "boolean", value } : { value };
    return this.conn.agent.request("session/set_config_option", {
      sessionId,
      configId,
      ...configValue
    });
  }
  prompt(sessionId, text) {
    return this.conn.agent.request("session/prompt", {
      sessionId,
      prompt: [{ type: "text", text }]
    });
  }
  cancel(sessionId) {
    return this.conn.agent.notify("session/cancel", { sessionId });
  }
  /** AGT-09：恢复本产品创建的会话（应用不支持时报错，调用方按 AC-37 回退新会话） */
  resumeSession(sessionId, cwd) {
    return this.conn.agent.request("session/resume", { sessionId, cwd });
  }
  /** 关闭会话（两款均声明支持；失败按 AC-37 记录差异，不虚报） */
  closeSession(sessionId) {
    return this.conn.agent.request("session/close", { sessionId });
  }
  /** 关闭连接并终止本产品创建的进程（不全局杀应用，§12.3） */
  close() {
    try {
      this.conn.close();
    } catch {
    }
    if (process.platform === "win32" && this.child.pid) {
      try {
        spawn("taskkill", ["/PID", String(this.child.pid), "/T", "/F"], {
          stdio: "ignore",
          windowsHide: true,
          detached: true
        }).unref();
      } catch {
      }
    }
    this.child.kill();
  }
  async flushLogs() {
    await Promise.all([this.msgLog.flush(), this.wireLog.flush()]);
  }
};

// ../../super-agent-zcode/packages/client/src/errors.ts
function serializeError(err) {
  if (err instanceof Error) {
    const rec = err;
    const out = {
      name: err.name,
      message: err.message,
      stack: err.stack
    };
    if (rec.code !== void 0) out.code = rec.code;
    if (rec.data !== void 0) out.data = rec.data;
    return out;
  }
  return err;
}
function errorCategory(err) {
  const rec = err;
  if (rec && typeof rec.code === "number") {
    return `jsonrpc_error:${rec.code}`;
  }
  if (rec && typeof rec.code === "string") {
    return `local_error:${rec.code}`;
  }
  return "unknown_error";
}

// ../../super-agent-zcode/packages/client/src/attemptRunner.ts
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var AttemptRunner = class {
  constructor(participantId, conn, store, permissionDecider) {
    this.participantId = participantId;
    this.conn = conn;
    this.store = store;
    this.permissionDecider = permissionDecider;
  }
  participantId;
  conn;
  store;
  permissionDecider;
  pendingCancels = /* @__PURE__ */ new Map();
  /** prompt 发出前已被请求取消的尝试：发出 prompt 前再检查一次，避免停不下来 */
  cancelRequested = /* @__PURE__ */ new Set();
  /**
   * 请求取消一次进行中的尝试：
   * - 已进入 prompt：发出 ACP session/cancel 并等待核对窗口；
   * - 尚未发出 prompt：记住取消请求，在发出前中止（返回 false）。
   * 返回 false 不再表示“已终态”，只表示当前没有可发送的 session/cancel。
   */
  cancel(attemptId) {
    this.cancelRequested.add(attemptId);
    const fn = this.pendingCancels.get(attemptId);
    if (!fn) return false;
    fn("user");
    return true;
  }
  async run(opts2) {
    const now = () => (/* @__PURE__ */ new Date()).toISOString();
    const rec = {
      id: opts2.attemptId ?? newId("attempt"),
      participantId: this.participantId,
      connectionId: this.conn.id,
      agentSessionId: null,
      requestSeq: null,
      inputVersion: opts2.inputVersion,
      status: "queued",
      submitStartedAt: null,
      terminalAt: null,
      stopReason: null,
      errorCategory: null,
      errorDetail: null,
      unknownReason: null,
      cancelRequestedAt: null,
      cancelConfirmed: false,
      timeoutMs: opts2.timeoutMs,
      permissionRequests: [],
      declaredCapabilities: this.conn.declared,
      observedCapabilities: [],
      lateEventCount: 0,
      lateTerminal: null,
      rawLogPath: this.conn.rawLogPath,
      eventLogPath: this.store.eventLogPath("pending"),
      createdAt: now(),
      updatedAt: now()
    };
    rec.eventLogPath = this.store.eventLogPath(rec.id);
    this.store.create(rec);
    await this.store.persist(rec);
    try {
      rec.status = "submitting";
      rec.submitStartedAt = now();
      await this.store.persist(rec);
      let sessionId;
      if (opts2.resumeSessionId) {
        try {
          await this.conn.resumeSession(opts2.resumeSessionId, opts2.cwd);
          sessionId = opts2.resumeSessionId;
          rec.sessionMode = "resumed";
        } catch (err) {
          const msg = String(err?.message ?? err);
          if (/already active/i.test(msg)) {
            sessionId = opts2.resumeSessionId;
            rec.sessionMode = "resumed";
          } else {
            const s = await this.conn.newSession(opts2.cwd);
            sessionId = s.sessionId;
            rec.sessionMode = "new_fallback";
          }
        }
      } else {
        const s = await this.conn.newSession(opts2.cwd);
        sessionId = s.sessionId;
        rec.sessionMode = "new";
      }
      rec.agentSessionId = sessionId;
      rec.round = opts2.round ?? null;
      rec.requestSeq = 1;
      this.store.bindRoute(this.conn.id, sessionId, rec.id);
      await this.store.persist(rec);
      rec.status = "running";
      await this.store.persist(rec);
      if (this.cancelRequested.has(rec.id)) {
        return await this.abortLocal(rec, "stop_requested_before_prompt");
      }
      if (opts2.beforePrompt) {
        await opts2.beforePrompt(sessionId);
      }
      if (this.cancelRequested.has(rec.id)) {
        return await this.abortLocal(rec, "stop_requested_before_prompt");
      }
      const promptToSend = rec.sessionMode === "resumed" ? opts2.prompt : opts2.promptFallback ?? opts2.prompt;
      return await this.awaitPrompt(rec, opts2, sessionId, promptToSend);
    } catch (err) {
      if (!isTerminalStatus(rec.status)) {
        rec.status = "failed";
        rec.errorCategory = errorCategory(err);
        rec.errorDetail = serializeError(err);
        rec.terminalAt = now();
        await this.store.persist(rec);
      }
      return rec;
    } finally {
      this.pendingCancels.delete(rec.id);
      this.cancelRequested.delete(rec.id);
      if (rec.agentSessionId) {
        this.conn.unregisterPermissionHandler(rec.agentSessionId);
      }
    }
  }
  /** prompt 未发出时的本地取消：不产生外部任务，按 failed/local_cancel 留痕 */
  async abortLocal(rec, reason) {
    rec.status = "failed";
    rec.errorCategory = "local_cancel";
    rec.errorDetail = { reason };
    rec.terminalAt = (/* @__PURE__ */ new Date()).toISOString();
    await this.store.persist(rec);
    return rec;
  }
  awaitPrompt(rec, opts2, sessionId, promptText) {
    return new Promise((resolve7) => {
      let settled = false;
      let cancelSent = false;
      const now = () => (/* @__PURE__ */ new Date()).toISOString();
      const finish = async (mutate) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        this.pendingCancels.delete(rec.id);
        mutate(rec);
        rec.terminalAt = now();
        await this.store.persist(rec);
        resolve7(rec);
      };
      const settleLate = async (detail) => {
        rec.lateTerminal = { at: now(), kind: "prompt_response", detail };
        await this.store.persist(rec);
      };
      const requestCancel = (reason) => {
        void (async () => {
          if (settled || cancelSent) return;
          cancelSent = true;
          rec.cancelRequestedAt = now();
          await this.store.persist(rec);
          try {
            await this.conn.cancel(sessionId);
          } catch {
          }
          await sleep(opts2.cancelGraceMs);
          if (!settled) {
            await finish((r) => {
              r.status = "unknown";
              r.unknownReason = reason === "timeout" ? "timeout_cancel_unconfirmed" : "cancel_unconfirmed";
            });
          }
        })();
      };
      this.pendingCancels.set(rec.id, requestCancel);
      const timer = setTimeout(() => requestCancel("timeout"), opts2.timeoutMs);
      this.conn.onClosed(() => {
        if (!settled) {
          void finish((r) => {
            r.status = "unknown";
            r.unknownReason = "connection_closed_unconfirmed";
            r.errorCategory = "process_exited";
          });
        }
      });
      this.conn.registerPermissionHandler(
        sessionId,
        (req) => this.handlePermission(rec, req)
      );
      if (this.cancelRequested.has(rec.id)) {
        void finish((r) => {
          r.status = "failed";
          r.errorCategory = "local_cancel";
          r.errorDetail = { reason: "stop_requested_before_prompt" };
        });
        return;
      }
      this.conn.prompt(sessionId, promptText).then(
        (resp) => {
          if (settled) {
            void settleLate(resp);
            return;
          }
          if (resp.stopReason === "cancelled") {
            void finish((r) => {
              r.status = "cancelled_confirmed";
              r.stopReason = resp.stopReason;
              r.cancelConfirmed = true;
            });
          } else {
            void finish((r) => {
              r.status = "succeeded";
              r.stopReason = resp.stopReason;
            });
          }
        },
        (err) => {
          if (settled) {
            void settleLate(serializeError(err));
            return;
          }
          if (this.conn.connectionClosed) {
            void finish((r) => {
              r.status = "unknown";
              r.unknownReason = "connection_closed_unconfirmed";
              r.errorCategory = "process_exited";
              r.errorDetail = serializeError(err);
            });
            return;
          }
          void finish((r) => {
            r.status = "failed";
            r.errorCategory = errorCategory(err);
            r.errorDetail = serializeError(err);
          });
        }
      );
    });
  }
  /** 权限请求：记录 + 决策 + 期间置 awaiting_permission（计时不停，BUD-05） */
  async handlePermission(rec, req) {
    const now = () => (/* @__PURE__ */ new Date()).toISOString();
    const entry = {
      seq: rec.permissionRequests.length + 1,
      requestedAt: now(),
      sessionId: req.sessionId,
      toolCallId: req.toolCall?.toolCallId ?? null,
      title: req.toolCall?.title ?? null,
      optionsCount: req.options?.length ?? 0,
      outcome: "",
      decidedAt: "",
      decidedBy: this.permissionDecider.name
    };
    rec.permissionRequests.push(entry);
    const wasRunning = rec.status === "running";
    if (wasRunning) {
      rec.status = "awaiting_permission";
      await this.store.persist(rec);
    }
    try {
      const resp = await this.permissionDecider.decide(req);
      entry.outcome = resp.outcome.outcome === "selected" ? `selected:${resp.outcome.optionId}` : "cancelled";
      entry.decidedAt = now();
      return resp;
    } finally {
      if (wasRunning && !isTerminalStatus(rec.status)) {
        rec.status = "running";
        await this.store.persist(rec);
      }
    }
  }
};

// ../../super-agent-zcode/packages/client/src/store.ts
import { promises as fs2 } from "node:fs";
import * as path5 from "node:path";
var AttemptStore = class _AttemptStore {
  constructor(dataDir) {
    this.dataDir = dataDir;
    this.attemptsDir = path5.join(dataDir, "attempts");
    this.eventsDir = path5.join(dataDir, "events");
  }
  dataDir;
  attemptsDir;
  eventsDir;
  records = /* @__PURE__ */ new Map();
  routes = /* @__PURE__ */ new Map();
  eventLogs = /* @__PURE__ */ new Map();
  attemptPath(id) {
    return path5.join(this.attemptsDir, `${id}.json`);
  }
  eventLogPath(id) {
    return path5.join(this.eventsDir, `${id}.jsonl`);
  }
  static routeKey(connectionId, sessionId) {
    return `${connectionId}\0${sessionId}`;
  }
  create(record2) {
    this.records.set(record2.id, record2);
  }
  get(id) {
    return this.records.get(id);
  }
  all() {
    return [...this.records.values()];
  }
  /** 每次状态变化整体落盘（NFR-02：保存结果与状态后才算完成和推进） */
  async persist(record2) {
    record2.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    await writeJsonAtomic(this.attemptPath(record2.id), record2);
  }
  bindRoute(connectionId, sessionId, attemptId) {
    this.routes.set(_AttemptStore.routeKey(connectionId, sessionId), attemptId);
  }
  lookupRoute(connectionId, sessionId) {
    return this.routes.get(_AttemptStore.routeKey(connectionId, sessionId));
  }
  eventLog(id) {
    let log = this.eventLogs.get(id);
    if (!log) {
      log = new JsonlLog(this.eventLogPath(id));
      this.eventLogs.set(id, log);
    }
    return log;
  }
  appendStandardized(attemptId, event) {
    this.eventLog(attemptId).append(event);
  }
  /** 读取单个标准化事件日志（测试/检视用） */
  async readStandardizedEvents(attemptId) {
    const raw = await fs2.readFile(this.eventLogPath(attemptId), "utf8").catch(() => null);
    if (raw === null) return [];
    return raw.split("\n").filter((line) => line.trim().length > 0).map((line) => JSON.parse(line));
  }
  /** 等待全部标准化事件追加落盘（测试/关停用） */
  async flushEvents() {
    await Promise.all([...this.eventLogs.values()].map((log) => log.flush()));
  }
  /**
   * 重启恢复（NFR-01）：扫描非终态尝试，一律转 needs_review 暂停核对，
   * 绝不自动重发；路由按 (connectionId, sessionId) 重建，迟到报文仍可归档。
   */
  async loadForRecovery() {
    await ensureDir(this.attemptsDir);
    const files = await fs2.readdir(this.attemptsDir);
    const reviewed = [];
    for (const file of files) {
      if (!file.endsWith(".json") || file.includes(".tmp")) continue;
      const rec = await readJson(path5.join(this.attemptsDir, file));
      if (!rec || isTerminalStatus(rec.status)) continue;
      rec.status = "needs_review";
      rec.unknownReason = "restarted_before_terminal";
      await this.persist(rec);
      this.records.set(rec.id, rec);
      if (rec.connectionId && rec.agentSessionId) {
        this.bindRoute(rec.connectionId, rec.agentSessionId, rec.id);
      }
      reviewed.push(rec);
    }
    return { reviewed };
  }
};

// ../../super-agent-zcode/packages/client/src/controller.ts
var SENSITIVE_UPDATE_KINDS = /* @__PURE__ */ new Set(["available_commands_update"]);
var SuperAgentController = class {
  constructor(dataDir, permissionDecider) {
    this.dataDir = dataDir;
    this.permissionDecider = permissionDecider;
    this.store = new AttemptStore(dataDir);
  }
  dataDir;
  permissionDecider;
  store;
  connections = /* @__PURE__ */ new Map();
  async startAgent(cfg) {
    const handle = await AgentConnectionHandle2.start(cfg, this.dataDir, {
      onSessionUpdate: (conn, notif) => this.routeSessionUpdate(conn, notif),
      onClosed: (conn, info) => this.onConnectionClosed(conn, info)
    });
    this.connections.set(handle.id, handle);
    return handle;
  }
  createRunner(participantId, conn) {
    return new AttemptRunner(participantId, conn, this.store, this.permissionDecider);
  }
  /**
   * 会话更新路由（AGT-13）：外部 sessionId 只在连接作用域内解释。
   * 无认领 → 孤儿归档；终态后到达 → 迟到计数（AC-14/AC-38）。
   */
  routeSessionUpdate(conn, notif) {
    const updateKind = notif.update?.sessionUpdate ?? null;
    const sensitive = updateKind !== null && SENSITIVE_UPDATE_KINDS.has(updateKind);
    const attemptId = this.store.lookupRoute(conn.id, notif.sessionId);
    if (!attemptId) {
      this.store.appendStandardized(`orphan_${conn.id}`, {
        at: (/* @__PURE__ */ new Date()).toISOString(),
        kind: "orphan_update",
        connectionId: conn.id,
        sessionId: notif.sessionId,
        updateKind,
        sensitive,
        detail: sensitive ? void 0 : notif
      });
      return;
    }
    const rec = this.store.get(attemptId);
    if (!rec) return;
    if (isTerminalStatus(rec.status)) {
      rec.lateEventCount += 1;
      void this.store.persist(rec).catch(() => {
      });
      return;
    }
    if (updateKind && !rec.observedCapabilities.includes(updateKind)) {
      rec.observedCapabilities.push(updateKind);
    }
    this.store.appendStandardized(attemptId, {
      at: (/* @__PURE__ */ new Date()).toISOString(),
      kind: "session_update",
      connectionId: conn.id,
      sessionId: notif.sessionId,
      updateKind,
      sensitive,
      // 敏感事件只记种类与时间，detail 不落标准化日志（内容仅在原始线路日志本地留存）
      detail: sensitive ? void 0 : notif.update
    });
  }
  // 尝试级的中断处理在 AttemptRunner 的 onClosed 监听里完成
  onConnectionClosed(_conn, _info) {
  }
  /** 重启恢复（NFR-01）：非终态一律转 needs_review，不自动重发 */
  async recover() {
    const { reviewed } = await this.store.loadForRecovery();
    return { reviewed: reviewed.length };
  }
  closeAll() {
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
  }
};

// ../../super-agent-zcode/packages/client/src/mockLauncher.ts
import * as path6 from "node:path";
import { fileURLToPath as fileURLToPath2 } from "node:url";
var thisDir = path6.dirname(fileURLToPath2(import.meta.url));
var repoRoot2 = path6.resolve(thisDir, "..", "..", "..");
var tsxCli = path6.join(repoRoot2, "node_modules", "tsx", "dist", "cli.mjs");
var mockMain = path6.join(repoRoot2, "packages", "mock-agent", "src", "main.ts");
function mockAgentConfig(participantId, env = {}) {
  const entry = process.env.SUPER_MOCK_ENTRY?.trim();
  return {
    participantId,
    command: process.env.SUPER_NODE_EXE?.trim() || process.execPath,
    args: entry ? [entry] : [tsxCli, mockMain],
    cwd: process.env.SUPER_AGENTS_CWD?.trim() || repoRoot2,
    // 桌面壳下 command 可能是 electron.exe——按 Node 运行；CLI 的 node 忽略此变量
    env: { ELECTRON_RUN_AS_NODE: "1", ...env }
  };
}

// ../../super-agent-zcode/packages/client/src/permissionBroker.ts
function autoAllowOnce() {
  return {
    name: "auto_allow_once",
    async decide(req) {
      const allow = req.options.find((o) => o.kind === "allow_once") ?? req.options[0];
      if (!allow) return { outcome: { outcome: "cancelled" } };
      return { outcome: { outcome: "selected", optionId: allow.optionId } };
    }
  };
}

// ../../super-agent-zcode/packages/client/src/sessionConfig.ts
function currentSelectValue(option) {
  const value = option?.currentValue;
  return typeof value === "string" ? value : null;
}
function selectValues(option) {
  const list = option?.options;
  if (!Array.isArray(list)) return [];
  return list.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const rec = item;
    if (typeof rec.value === "string" && typeof rec.name === "string") {
      return [{ value: rec.value, name: rec.name }];
    }
    if (Array.isArray(rec.options)) {
      const groupName = typeof rec.name === "string" ? rec.name : typeof rec.group === "string" ? rec.group : null;
      return rec.options.filter(
        (x) => typeof x.value === "string" && typeof x.name === "string"
      ).map((x) => ({
        value: x.value,
        name: groupName ? `${groupName} / ${x.name}` : x.name
      }));
    }
    return [];
  });
}
async function discoverSessionConfig(handle, cwd, log) {
  const session = await handle.newSession(cwd);
  const modes = session.modes;
  const configOptions = session.configOptions ?? [];
  const readOnlyModeId = modes?.availableModes.find((m) => /read.?only/i.test(`${m.id} ${m.name}`))?.id ?? null;
  const modelOpt = configOptions.find((c) => /model/i.test(c.id));
  const reasonOpt = configOptions.find((c) => /reason|thought/i.test(c.id));
  const modelOptions = selectValues(modelOpt);
  const reasoningOptions = selectValues(reasonOpt);
  const flashModelValueId = modelOptions.find((v) => /flash/i.test(`${v.value} ${v.name}`))?.value ?? null;
  const reasoningLowValueId = reasoningOptions.find((v) => /low/i.test(`${v.value} ${v.name}`))?.value ?? null;
  log?.(
    `\u914D\u7F6E\u53D1\u73B0\uFF1Amodes=${JSON.stringify(modes?.availableModes.map((m) => m.id) ?? [])}\uFF0CconfigOptions=${JSON.stringify(configOptions.map((c) => c.id))}\uFF0C\u6A21\u578B ${modelOptions.length} \u9879 / \u601D\u8003 ${reasoningOptions.length} \u9879\uFF0C\u4F4E\u6863\u503C model=${flashModelValueId ?? "\u672A\u53D1\u73B0"} / reasoning=${reasoningLowValueId ?? "\u672A\u53D1\u73B0"}`
  );
  try {
    await handle.closeSession(session.sessionId);
  } catch {
    log?.("\uFF08session/close \u4E0D\u53EF\u7528\uFF0C\u6309 AC-37 \u8BB0\u5F55\u5DEE\u5F02\uFF09");
  }
  return {
    readOnlyModeId,
    modelConfigId: modelOpt?.id ?? null,
    reasoningConfigId: reasonOpt?.id ?? null,
    flashModelValueId,
    reasoningLowValueId,
    modelOptions,
    reasoningOptions,
    currentModelValue: currentSelectValue(modelOpt),
    currentReasoningValue: currentSelectValue(reasonOpt)
  };
}
function dshLowCostConfig(handle, cfg) {
  return async (sessionId) => {
    if (!cfg.modelConfigId || !cfg.flashModelValueId || !cfg.reasoningConfigId || !cfg.reasoningLowValueId) {
      throw new Error("\u672A\u53D1\u73B0\u53EF\u7528\u7684 model/reasoning \u4F4E\u6863\u503C\uFF0C\u62D2\u7EDD\u4EE5\u9ED8\u8BA4\u6863\u4F4D\u6D88\u8017");
    }
    await handle.setConfigOption(sessionId, cfg.modelConfigId, cfg.flashModelValueId);
    await handle.setConfigOption(sessionId, cfg.reasoningConfigId, cfg.reasoningLowValueId);
  };
}
function codebuddyLowCostConfig(handle, cfg, warn) {
  return async (sessionId) => {
    if (cfg.modelConfigId && cfg.flashModelValueId) {
      try {
        await handle.setConfigOption(sessionId, cfg.modelConfigId, cfg.flashModelValueId);
      } catch (err) {
        warn?.(`\u26A0\uFE0F codebuddy model=${cfg.flashModelValueId} \u8BBE\u7F6E\u5931\u8D25\uFF08AC-37 \u8BB0\u5F55\u5DEE\u5F02\uFF09\uFF1A${String(err).slice(0, 120)}`);
      }
    } else {
      warn?.("\u26A0\uFE0F codebuddy \u672A\u53D1\u73B0\u4F4E\u6863\u6A21\u578B\u914D\u7F6E\u9879\uFF0C\u6309\u9ED8\u8BA4\u6863\u7EE7\u7EED");
    }
  };
}
function zcodeLowCostConfig(handle, cfg, warn) {
  return async (sessionId) => {
    if (cfg.modelConfigId && cfg.flashModelValueId) {
      try {
        await handle.setConfigOption(sessionId, cfg.modelConfigId, cfg.flashModelValueId);
      } catch (err) {
        warn?.(`\u26A0\uFE0F zcode model=${cfg.flashModelValueId} \u8BBE\u7F6E\u5931\u8D25\uFF08AC-37 \u8BB0\u5F55\u5DEE\u5F02\uFF09\uFF1A${String(err).slice(0, 120)}`);
      }
    }
    if (cfg.reasoningConfigId && cfg.reasoningLowValueId) {
      try {
        await handle.setConfigOption(sessionId, cfg.reasoningConfigId, cfg.reasoningLowValueId);
      } catch (err) {
        warn?.(`\u26A0\uFE0F zcode thought=low \u8BBE\u7F6E\u5931\u8D25\uFF08AC-37 \u8BB0\u5F55\u5DEE\u5F02\uFF09\uFF1A${String(err).slice(0, 120)}`);
      }
    }
  };
}
function codexReadOnlyConfig(handle, cfg, strict, warn) {
  return async (sessionId) => {
    if (strict) return;
    if (cfg.readOnlyModeId) {
      await handle.setMode(sessionId, cfg.readOnlyModeId);
    } else {
      warn?.("\u26A0\uFE0F \u672A\u53D1\u73B0 read-only \u6A21\u5F0F\uFF0C\u6309\u9ED8\u8BA4\u6A21\u5F0F\u7EE7\u7EED\uFF08\u7EAF\u8BFB\u4EFB\u52A1\uFF09");
    }
    if (cfg.reasoningConfigId && cfg.reasoningLowValueId) {
      try {
        await handle.setConfigOption(sessionId, cfg.reasoningConfigId, cfg.reasoningLowValueId);
      } catch (err) {
        warn?.(`\u26A0\uFE0F reasoning=low \u8BBE\u7F6E\u5931\u8D25\uFF08AC-37 \u8BB0\u5F55\u5DEE\u5F02\uFF09\uFF1A${String(err).slice(0, 120)}`);
      }
    }
  };
}

// ../../super-agent-zcode/packages/orchestrator/src/slots.ts
var ConcurrencySlots = class {
  constructor(perAppLimit = 1, globalLimit = 2) {
    this.perAppLimit = perAppLimit;
    this.globalLimit = globalLimit;
  }
  perAppLimit;
  globalLimit;
  running = /* @__PURE__ */ new Map();
  waiters = [];
  total() {
    let sum = 0;
    for (const n of this.running.values()) sum += n;
    return sum;
  }
  canAcquire(appKey) {
    return (this.running.get(appKey) ?? 0) < this.perAppLimit && this.total() < this.globalLimit;
  }
  async acquire(appKey) {
    for (; ; ) {
      if (this.canAcquire(appKey)) {
        this.running.set(appKey, (this.running.get(appKey) ?? 0) + 1);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          this.running.set(appKey, Math.max(0, (this.running.get(appKey) ?? 1) - 1));
          const next = this.waiters.shift();
          if (next) next();
        };
      }
      await new Promise((resolve7) => this.waiters.push(resolve7));
    }
  }
};

// ../../super-agent-zcode/packages/orchestrator/src/prompts.ts
function proposalPrompt(requirement, cwd, role) {
  return [
    `\u4F60\u662F\u65B9\u6848\u53C2\u4E0E\u8005\uFF08${role}\uFF09\u3002\u8BF7\u57FA\u4E8E\u4EE5\u4E0B\u9700\u6C42\u72EC\u7ACB\u5B8C\u6210\u4E00\u4EFD\u65B9\u6848\u63D0\u6848\u3002`,
    "",
    "\u3010\u9700\u6C42\u3011",
    requirement,
    "",
    `\u3010\u9879\u76EE\u76EE\u5F55\u3011${cwd}`,
    "\u4F60\u53EF\u4EE5\u67E5\u770B\u8BE5\u76EE\u5F55\uFF1B\u672C\u8F6E\u4E0D\u5F3A\u5236\u9605\u8BFB\u4EE3\u7801\u2014\u2014\u82E5\u672A\u5B9E\u9645\u8BFB\u53D6\uFF0C\u8BF7\u5728\u300C\u4E8B\u5B9E\u4E0E\u5047\u8BBE\u300D\u4E2D\u6CE8\u660E\u300C\u4EC5\u57FA\u4E8E\u9700\u6C42\u300D\u3002",
    "",
    "\u3010\u8F93\u51FA\u8981\u6C42\u3011\uFF08Markdown\uFF0C\u4F7F\u7528\u4EE5\u4E0B\u5C0F\u8282\u6807\u9898\uFF09",
    "## \u9700\u6C42\u7406\u89E3",
    "## \u4E8B\u5B9E\u4E0E\u5047\u8BBE",
    "## \u63A8\u8350\u65B9\u6848",
    "## \u5907\u9009\u65B9\u6848",
    "## \u5F71\u54CD\u4E0E\u98CE\u9669",
    "## \u5B9E\u65BD\u4E0E\u9A8C\u6536\u8981\u70B9",
    "",
    "\u6CE8\u610F\uFF1A\u72EC\u7ACB\u4F5C\u7B54\uFF0C\u4E0D\u8981\u5047\u8BBE\u6216\u5F15\u7528\u5176\u4ED6\u53C2\u4E0E\u8005\u7684\u65B9\u6848\uFF1B\u4E0D\u786E\u5B9A\u7684\u5185\u5BB9\u6807\u6CE8\u4E3A\u5047\u8BBE\u3002"
  ].join("\n");
}
function reviewPrompt(requirement, targetParticipant, targetVersion, targetProposal) {
  return [
    "\u4F60\u662F\u540C\u884C\u8BC4\u5BA1\u8005\u3002\u4EE5\u4E0B\u662F\u53E6\u4E00\u4F4D\u53C2\u4E0E\u8005\u5BF9\u540C\u4E00\u9700\u6C42\u7684\u65B9\u6848\u63D0\u6848\uFF0C\u8BF7\u8FDB\u884C\u8BC4\u5BA1\u3002",
    "",
    "\u3010\u9700\u6C42\u3011",
    requirement,
    "",
    `\u3010\u5F85\u8BC4\u5BA1\u63D0\u6848\uFF08${targetParticipant}\uFF0C\u7248\u672C ${targetVersion}\uFF09\u3011`,
    targetProposal,
    "",
    "\u3010\u8F93\u51FA\u8981\u6C42\u3011\uFF08Markdown\uFF09",
    "\u5148\u5199\u4E00\u884C\u6574\u4F53\u7ED3\u8BBA\uFF08\u5982\uFF1A\u65B9\u6848\u6210\u7ACB / \u65B9\u6848\u6709\u91CD\u5927\u98CE\u9669\uFF09\u3002",
    "\u82E5\u6709\u610F\u89C1\uFF0C\u9010\u6761\u6309\u4EE5\u4E0B\u683C\u5F0F\u8F93\u51FA\uFF1B\u6CA1\u6709\u610F\u89C1\u5C31\u660E\u786E\u5199\u300C\u65E0\u610F\u89C1\u300D\u3002\u4E0D\u8981\u4E3A\u4E86\u8BC4\u5BA1\u800C\u5236\u9020\u610F\u89C1\u3002",
    "",
    "### \u610F\u89C1 1",
    "- \u7EA7\u522B: \u963B\u585E | \u9AD8 | \u4E00\u822C | \u5EFA\u8BAE",
    "- \u7C7B\u578B: \u4E8B\u5B9E\u95EE\u9898 | \u65B9\u6848\u98CE\u9669 | \u9700\u6C42\u9057\u6F0F | \u4EA7\u54C1\u53D6\u820D | \u8868\u8FBE\u95EE\u9898",
    "- \u63CF\u8FF0: \uFF08\u95EE\u9898\u662F\u4EC0\u4E48\uFF09",
    "- \u8BC1\u636E: \uFF08\u5F15\u7528\u63D0\u6848\u539F\u6587\u6216\u8BF4\u660E\u4F9D\u636E\uFF1B\u672A\u9A8C\u8BC1\u7684\u6807\u6CE8\u300C\u672A\u9A8C\u8BC1\u300D\uFF09",
    "- \u5EFA\u8BAE: \uFF08\u5982\u4F55\u89E3\u51B3\u6216\u5904\u7F6E\uFF09"
  ].join("\n");
}
function reviewPromptIncremental(targetParticipant, targetVersion, targetProposal) {
  return [
    "\u4F60\u662F\u540C\u884C\u8BC4\u5BA1\u8005\u3002\u4EE5\u4E0B\u662F\u53E6\u4E00\u4F4D\u53C2\u4E0E\u8005\u5BF9\u540C\u4E00\u9700\u6C42\u7684\u65B9\u6848\u63D0\u6848\uFF0C\u8BF7\u8FDB\u884C\u8BC4\u5BA1\u3002",
    "\uFF08\u4F60\u81EA\u5DF1\u7684\u65B9\u6848\u5DF2\u5728\u4F1A\u8BDD\u4E0A\u4E0B\u6587\u4E2D\uFF0C\u53EF\u76F4\u63A5\u5BF9\u6BD4\u4E24\u8005\u5DEE\u5F02\u2014\u2014\u5DEE\u5F02\u6B63\u662F\u8BC4\u5BA1\u91CD\u70B9\u3002\uFF09",
    "",
    `\u3010\u5F85\u8BC4\u5BA1\u63D0\u6848\uFF08${targetParticipant}\uFF0C\u7248\u672C ${targetVersion}\uFF09\u3011`,
    targetProposal,
    "",
    "\u3010\u8F93\u51FA\u8981\u6C42\u3011\uFF08Markdown\uFF09",
    "\u5148\u5199\u4E00\u884C\u6574\u4F53\u7ED3\u8BBA\uFF08\u5982\uFF1A\u65B9\u6848\u6210\u7ACB / \u65B9\u6848\u6709\u91CD\u5927\u98CE\u9669\uFF09\u3002",
    "\u82E5\u6709\u610F\u89C1\uFF0C\u9010\u6761\u6309\u4EE5\u4E0B\u683C\u5F0F\u8F93\u51FA\uFF1B\u6CA1\u6709\u610F\u89C1\u5C31\u660E\u786E\u5199\u300C\u65E0\u610F\u89C1\u300D\u3002\u4E0D\u8981\u4E3A\u4E86\u8BC4\u5BA1\u800C\u5236\u9020\u610F\u89C1\u3002",
    "",
    "### \u610F\u89C1 1",
    "- \u7EA7\u522B: \u963B\u585E | \u9AD8 | \u4E00\u822C | \u5EFA\u8BAE",
    "- \u7C7B\u578B: \u4E8B\u5B9E\u95EE\u9898 | \u65B9\u6848\u98CE\u9669 | \u9700\u6C42\u9057\u6F0F | \u4EA7\u54C1\u53D6\u820D | \u8868\u8FBE\u95EE\u9898",
    "- \u63CF\u8FF0: \uFF08\u95EE\u9898\u662F\u4EC0\u4E48\uFF09",
    "- \u8BC1\u636E: \uFF08\u5F15\u7528\u63D0\u6848\u539F\u6587\u6216\u8BF4\u660E\u4F9D\u636E\uFF1B\u672A\u9A8C\u8BC1\u7684\u6807\u6CE8\u300C\u672A\u9A8C\u8BC1\u300D\uFF09",
    "- \u5EFA\u8BAE: \uFF08\u5982\u4F55\u89E3\u51B3\u6216\u5904\u7F6E\uFF09"
  ].join("\n");
}
function revisionPrompt(requirement, ownParticipantId, ownVersion, ownProposal, reviewer, reviewText, nextVersion) {
  return [
    `\u4F60\u662F\u539F\u65B9\u6848\u4F5C\u8005\uFF08${ownParticipantId}\uFF09\u3002\u8BC4\u5BA1\u8005\uFF08${reviewer}\uFF09\u5BF9\u4F60\u7684\u63D0\u6848 ${ownVersion} \u63D0\u51FA\u4E86\u610F\u89C1\uFF0C\u8BF7\u9010\u6761\u56DE\u5E94\u5E76\u7ED9\u51FA\u4FEE\u8BA2\u7248\u63D0\u6848 ${nextVersion}\u3002`,
    "",
    "\u3010\u9700\u6C42\u3011",
    requirement,
    "",
    `\u3010\u4F60\u7684\u63D0\u6848 ${ownVersion}\u3011`,
    ownProposal,
    "",
    `\u3010\u8BC4\u5BA1\u610F\u89C1\uFF08${reviewer}\uFF09\u3011`,
    reviewText,
    "",
    "\u3010\u8F93\u51FA\u8981\u6C42\u3011\uFF08Markdown\uFF09",
    "\u7B2C\u4E00\u90E8\u5206\u9010\u6761\u56DE\u5E94\uFF08\u6BCF\u6761\u610F\u89C1\u90FD\u8981\u56DE\u5E94\uFF0C\u63A5\u53D7/\u90E8\u5206\u63A5\u53D7/\u53CD\u9A73/\u8BF7\u6C42\u6F84\u6E05\u5747\u53EF\uFF0C\u53CD\u9A73\u8981\u7ED9\u4F9D\u636E\uFF09\uFF1A",
    "",
    "## \u56DE\u5E94",
    "### \u56DE\u5E94 \u610F\u89C1 1",
    "- \u5904\u7F6E: \u63A5\u53D7 | \u90E8\u5206\u63A5\u53D7 | \u53CD\u9A73 | \u8BF7\u6C42\u6F84\u6E05",
    "- \u8BF4\u660E: \uFF08\u505A\u4E86\u4EC0\u4E48\u4FEE\u6539\u6216\u4E3A\u4EC0\u4E48\u53CD\u9A73\uFF09",
    "",
    "\u7B2C\u4E8C\u90E8\u5206\u7ED9\u51FA\u4FEE\u8BA2\u540E\u7684\u5B8C\u6574\u63D0\u6848\uFF08\u672A\u6539\u52A8\u7684\u90E8\u5206\u4E5F\u8981\u5B8C\u6574\u4FDD\u7559\uFF0C\u4E0D\u8981\u53EA\u5199\u589E\u91CF\uFF09\uFF1A",
    "",
    "---",
    `# \u4FEE\u8BA2\u540E\u63D0\u6848\uFF08${nextVersion}\uFF09`,
    "\uFF08\u5B8C\u6574\u63D0\u6848\u5168\u6587\uFF0C\u542B\u9700\u6C42\u7406\u89E3/\u4E8B\u5B9E\u4E0E\u5047\u8BBE/\u63A8\u8350\u65B9\u6848/\u5907\u9009\u65B9\u6848/\u5F71\u54CD\u4E0E\u98CE\u9669/\u5B9E\u65BD\u4E0E\u9A8C\u6536\u8981\u70B9\uFF09"
  ].join("\n");
}
function revisionPromptIncremental(reviewer, reviewText, nextVersion) {
  return [
    `\u8BC4\u5BA1\u8005\uFF08${reviewer}\uFF09\u5DF2\u5BF9\u4F60\u7684\u63D0\u6848\u63D0\u51FA\u610F\u89C1\uFF0C\u8BF7\u9010\u6761\u56DE\u5E94\u5E76\u7ED9\u51FA\u4FEE\u8BA2\u7248\u63D0\u6848 ${nextVersion}\u3002`,
    "",
    "\u3010\u8BC4\u5BA1\u610F\u89C1\uFF08\u539F\u6587\uFF09\u3011",
    reviewText,
    "",
    "\u3010\u8F93\u51FA\u8981\u6C42\u3011\uFF08Markdown\uFF09",
    "\u7B2C\u4E00\u90E8\u5206\u9010\u6761\u56DE\u5E94\uFF08\u6BCF\u6761\u610F\u89C1\u90FD\u8981\u56DE\u5E94\uFF0C\u63A5\u53D7/\u90E8\u5206\u63A5\u53D7/\u53CD\u9A73/\u8BF7\u6C42\u6F84\u6E05\u5747\u53EF\uFF0C\u53CD\u9A73\u8981\u7ED9\u4F9D\u636E\uFF09\uFF1A",
    "",
    "## \u56DE\u5E94",
    "### \u56DE\u5E94 \u610F\u89C1 1",
    "- \u5904\u7F6E: \u63A5\u53D7 | \u90E8\u5206\u63A5\u53D7 | \u53CD\u9A73 | \u8BF7\u6C42\u6F84\u6E05",
    "- \u8BF4\u660E: \uFF08\u505A\u4E86\u4EC0\u4E48\u4FEE\u6539\u6216\u4E3A\u4EC0\u4E48\u53CD\u9A73\uFF09",
    "",
    "\u7B2C\u4E8C\u90E8\u5206\u7ED9\u51FA\u4FEE\u8BA2\u540E\u7684\u5B8C\u6574\u63D0\u6848\uFF08\u672A\u6539\u52A8\u7684\u90E8\u5206\u4E5F\u8981\u5B8C\u6574\u4FDD\u7559\uFF0C\u4E0D\u8981\u53EA\u5199\u589E\u91CF\uFF09\uFF1A",
    "",
    "---",
    `# \u4FEE\u8BA2\u540E\u63D0\u6848\uFF08${nextVersion}\uFF09`,
    "\uFF08\u5B8C\u6574\u63D0\u6848\u5168\u6587\uFF0C\u542B\u9700\u6C42\u7406\u89E3/\u4E8B\u5B9E\u4E0E\u5047\u8BBE/\u63A8\u8350\u65B9\u6848/\u5907\u9009\u65B9\u6848/\u5F71\u54CD\u4E0E\u98CE\u9669/\u5B9E\u65BD\u4E0E\u9A8C\u6536\u8981\u70B9\uFF09",
    "",
    "\u6CE8\u610F\uFF1A\u53EA\u6309\u8BC4\u5BA1\u610F\u89C1\u4FEE\u6539\uFF1B\u4E0D\u5F97\u5F15\u5165\u5BF9\u65B9\u63D0\u6848\u4E2D\u8BC4\u5BA1\u610F\u89C1\u4E4B\u5916\u7684\u5185\u5BB9\u3002"
  ].join("\n");
}
function recheckPrompt(requirement, targetParticipant, nextVersion, originalReviewText, revisionText) {
  return [
    `\u4F60\u662F\u539F\u8BC4\u5BA1\u8005\u3002${targetParticipant} \u5DF2\u9488\u5BF9\u4F60\u7684\u610F\u89C1\u63D0\u4EA4\u4E86\u56DE\u5E94\u4E0E\u4FEE\u8BA2\uFF08\u7248\u672C ${nextVersion}\uFF09\uFF0C\u8BF7\u9010\u6761\u590D\u6838\u3002`,
    "",
    "\u3010\u9700\u6C42\u3011",
    requirement,
    "",
    "\u3010\u4F60\u7684\u539F\u8BC4\u5BA1\u610F\u89C1\u3011",
    originalReviewText,
    "",
    `\u3010${targetParticipant} \u7684\u56DE\u5E94\u4E0E\u4FEE\u8BA2\uFF08${nextVersion}\uFF09\u3011`,
    revisionText,
    "",
    "\u3010\u8F93\u51FA\u8981\u6C42\u3011\uFF08Markdown\uFF09",
    "\u5BF9\u6BCF\u6761\u539F\u610F\u89C1\u7ED9\u51FA\u590D\u6838\u7ED3\u8BBA\uFF1B\u518D\u5224\u65AD\u662F\u5426\u6709\u65B0\u7684\u5B9E\u8D28\u95EE\u9898\u3002\u4E8B\u5B9E\u4E89\u8BAE\u4E0D\u80FD\u9760\u591A\u6570\u7968\u89E3\u51B3\uFF1A\u65E0\u8BC1\u636E\u7684\u76F8\u53CD\u5224\u65AD\u5199\u300C\u4ECD\u6709\u4E89\u8BAE\u300D\u3002",
    "",
    "## \u590D\u6838\u7ED3\u8BBA",
    "### \u610F\u89C1 1 \u590D\u6838",
    "- \u7ED3\u8BBA: \u5DF2\u89E3\u51B3 | \u672A\u89E3\u51B3 | \u4ECD\u6709\u4E89\u8BAE",
    "- \u8BF4\u660E: \uFF08\u4F9D\u636E\u4F5C\u8005\u56DE\u5E94\u4E0E\u4FEE\u8BA2\u5185\u5BB9\uFF09",
    "",
    "\uFF08\u5982\u6709\u65B0\u7684\u5B9E\u8D28\u95EE\u9898\uFF0C\u9010\u6761\u8FFD\u52A0\uFF1A\uFF09",
    "### \u65B0\u610F\u89C1 1",
    "- \u7EA7\u522B: \u963B\u585E | \u9AD8 | \u4E00\u822C | \u5EFA\u8BAE",
    "- \u7C7B\u578B: \u4E8B\u5B9E\u95EE\u9898 | \u65B9\u6848\u98CE\u9669 | \u9700\u6C42\u9057\u6F0F | \u4EA7\u54C1\u53D6\u820D | \u8868\u8FBE\u95EE\u9898",
    "- \u63CF\u8FF0: ...",
    "- \u8BC1\u636E: ...",
    "- \u5EFA\u8BAE: ...",
    "",
    "\u6CA1\u6709\u65B0\u95EE\u9898\u5C31\u660E\u786E\u5199\u300C\u65E0\u65B0\u5B9E\u8D28\u95EE\u9898\u300D\u3002"
  ].join("\n");
}
function recheckPromptIncremental(targetParticipant, nextVersion, revisionText) {
  return [
    `\uFF08${targetParticipant}\uFF09\u5DF2\u9488\u5BF9\u4F60\u7684\u610F\u89C1\u63D0\u4EA4\u4E86\u56DE\u5E94\u4E0E\u4FEE\u8BA2\uFF08\u7248\u672C ${nextVersion}\uFF09\uFF0C\u8BF7\u9010\u6761\u590D\u6838\u3002`,
    "",
    "\u3010\u5BF9\u65B9\u7684\u56DE\u5E94\u4E0E\u4FEE\u8BA2\uFF08\u539F\u6587\u5982\u4E0B\uFF09\u3011",
    revisionText,
    "",
    "\u3010\u8F93\u51FA\u8981\u6C42\u3011\uFF08Markdown\uFF09",
    "\u5BF9\u6BCF\u6761\u539F\u610F\u89C1\u7ED9\u51FA\u590D\u6838\u7ED3\u8BBA\uFF1B\u518D\u5224\u65AD\u662F\u5426\u6709\u65B0\u7684\u5B9E\u8D28\u95EE\u9898\u3002\u4E8B\u5B9E\u4E89\u8BAE\u4E0D\u80FD\u9760\u591A\u6570\u7968\u89E3\u51B3\uFF1A\u65E0\u8BC1\u636E\u7684\u76F8\u53CD\u5224\u65AD\u5199\u300C\u4ECD\u6709\u4E89\u8BAE\u300D\u3002",
    "",
    "## \u590D\u6838\u7ED3\u8BBA",
    "### \u610F\u89C1 1 \u590D\u6838",
    "- \u7ED3\u8BBA: \u5DF2\u89E3\u51B3 | \u672A\u89E3\u51B3 | \u4ECD\u6709\u4E89\u8BAE",
    "- \u8BF4\u660E: \uFF08\u4F9D\u636E\u4F5C\u8005\u56DE\u5E94\u4E0E\u4FEE\u8BA2\u5185\u5BB9\uFF09",
    "",
    "\uFF08\u5982\u6709\u65B0\u7684\u5B9E\u8D28\u95EE\u9898\uFF0C\u9010\u6761\u8FFD\u52A0\uFF1A\uFF09",
    "### \u65B0\u610F\u89C1 1",
    "- \u7EA7\u522B: \u963B\u585E | \u9AD8 | \u4E00\u822C | \u5EFA\u8BAE",
    "- \u7C7B\u578B: \u4E8B\u5B9E\u95EE\u9898 | \u65B9\u6848\u98CE\u9669 | \u9700\u6C42\u9057\u6F0F | \u4EA7\u54C1\u53D6\u820D | \u8868\u8FBE\u95EE\u9898",
    "- \u63CF\u8FF0: ...",
    "- \u8BC1\u636E: ...",
    "- \u5EFA\u8BAE: ...",
    "",
    "\u6CA1\u6709\u65B0\u95EE\u9898\u5C31\u660E\u786E\u5199\u300C\u65E0\u65B0\u5B9E\u8D28\u95EE\u9898\u300D\u3002"
  ].join("\n");
}
function synthesisPrompt(requirement, inputs, reviewSummaries, synthesizer, forced = false) {
  const sections = inputs.map((i) => `\u3010${i.participantId} \u6700\u7EC8\u63D0\u6848\uFF08\u7248\u672C ${i.version}\uFF09\u3011
${i.text}`).join("\n\n");
  return [
    `\u4F60\u662F\u7EFC\u5408\u8005\uFF08${synthesizer}\uFF09\u3002\u57FA\u4E8E\u4EE5\u4E0B\u8F93\u5165\u751F\u6210\u7EFC\u5408\u65B9\u6848\u3002\u4F60\u5728\u72EC\u7ACB\u4E0A\u4E0B\u6587\u4E2D\u5DE5\u4F5C\uFF1A\u4F60\u4E0D\u662F\u88C1\u5224\uFF0C\u4E0D\u80FD\u51ED\u7A7A\u88C1\u5B9A\u65E0\u8BC1\u636E\u7684\u4E8B\u5B9E\uFF1B\u4E24\u65B9\u90FD\u672A\u9A8C\u8BC1\u7684\u5185\u5BB9\u4FDD\u6301\u300C\u672A\u9A8C\u8BC1\u300D\u72B6\u6001\u3002`,
    ...forced ? [
      "\u3010\u7528\u6237\u51B3\u5B9A\u3011\u7528\u6237\u5DF2\u51B3\u5B9A\u8DF3\u8FC7\u5269\u4F59\u4FEE\u8BA2/\u590D\u6838\u9636\u6BB5\uFF0C\u76F4\u63A5\u7EFC\u5408\u5F53\u524D\u4EA7\u7269\u3002\u4EE5\u4E0B\u8BC4\u5BA1\u610F\u89C1\u53EF\u80FD\u5C1A\u672A\u88AB\u56DE\u5E94\u6216\u590D\u6838\u2014\u2014\u672A\u88AB\u56DE\u5E94\u7684\u610F\u89C1\u5728\u7EFC\u5408\u65F6\u5982\u5B9E\u6807\u6CE8\uFF08\u5982\u300C\u672A\u56DE\u5E94\u300D\uFF09\uFF0C\u4E0D\u8981\u5F53\u4F5C\u5DF2\u89E3\u51B3\u3002"
    ] : [],
    "",
    "\u3010\u9700\u6C42\u3011",
    requirement,
    "",
    sections,
    "",
    "\u3010\u8BC4\u5BA1\u4E0E\u590D\u6838\u6458\u8981\u3011",
    reviewSummaries,
    "",
    "\u3010\u8F93\u51FA\u8981\u6C42\u3011\uFF08Markdown\uFF0C\u5C0F\u8282\u6807\u9898\u5FC5\u987B\u4E00\u81F4\uFF09",
    "## \u7EFC\u5408\u6458\u8981",
    "## \u5DEE\u5F02\u8868",
    "\uFF08\u9010\u9879\u5217\u51FA\u4E24\u65B9\u5DEE\u5F02\uFF0C\u6807\u6CE8\u7C7B\u578B\uFF1A\u4E8B\u5B9E\u5DEE\u5F02 | \u4EA7\u54C1\u53D6\u820D | \u5B8C\u6574\u5EA6\u5DEE\u5F02\uFF1B\u4E8B\u5B9E\u4E89\u8BAE\u6CE8\u660E\u300C\u672A\u9A8C\u8BC1\u300D\uFF0C\u4E0D\u5F97\u6295\u7968\u88C1\u5B9A\uFF09",
    "## \u63A8\u8350\u65B9\u6848",
    "\uFF08\u7EFC\u5408\u4E24\u65B9\u4F18\u70B9\uFF1B\u51E1\u7531\u4F60\u65B0\u589E\u3001\u53CC\u65B9\u5747\u672A\u63D0\u51FA\u7684\u91CD\u8981\u8BBE\u8BA1\uFF0C\u5FC5\u987B\u7D27\u8DDF\u6807\u6CE8\u300C\uFF08\u65B0\u589E\uFF0C\u672A\u8BC4\u5BA1\uFF09\u300D\uFF09",
    "## \u63A5\u53E3/\u72B6\u6001/\u5F02\u5E38\u8981\u70B9",
    "## \u5B9E\u65BD\u6E05\u5355\u4E0E\u9A8C\u6536",
    "## \u98CE\u9669\u3001\u5047\u8BBE\u4E0E\u672A\u9A8C\u8BC1\u4E8B\u5B9E",
    "\uFF08\u4FDD\u7559\u5C11\u6570\u610F\u89C1\u4E0E\u672A\u9A8C\u8BC1\u4E8B\u5B9E\uFF0C\u4E0D\u5F97\u5220\u9664\uFF09",
    "## \u5F85\u51B3\u7B56\u9879",
    "\uFF08\u628A\u9700\u8981\u7528\u6237\u62CD\u677F\u7684\u53D6\u820D\u6574\u7406\u4E3A\u51B3\u7B56\u9879\uFF09",
    "",
    "### \u51B3\u7B56 1",
    "- \u5185\u5BB9: \uFF08\u8981\u51B3\u5B9A\u4EC0\u4E48\uFF09",
    "- \u5907\u9009: \uFF08\u6709\u54EA\u4E9B\u9009\u9879\uFF09",
    "- \u7406\u7531: \uFF08\u5404\u65B9\u7ACB\u573A\u4E0E\u4F9D\u636E\uFF09",
    "- \u6765\u6E90: \uFF08\u63D0\u6848A / \u63D0\u6848B / \u65B0\u589E\uFF09"
  ].join("\n");
}

// ../../super-agent-zcode/packages/orchestrator/src/dedup.ts
function normalize(text) {
  return text.toLowerCase().replace(/[，。！？、；：""''（）\[\]{}<>\/\\|—…·\s]/g, "").replace(/[.,!?;:'"()\[\]{}<>\/\\|—…-\s]/g, "");
}
function tokens(text) {
  const norm = normalize(text);
  const set = /* @__PURE__ */ new Set();
  for (let i = 0; i < norm.length - 1; i++) {
    set.add(norm.slice(i, i + 2));
  }
  if (norm.length === 1) set.add(norm);
  return set;
}
function jaccard(a, b) {
  if (a.size === 0 && b.size === 0) return 1;
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}
var SIMILARITY_THRESHOLD = 0.55;
function isDuplicateOpenIssue(newText, existing, existingTexts) {
  void existing;
  const newTokens = tokens(newText);
  for (const ex of existingTexts) {
    if (jaccard(newTokens, tokens(ex)) >= SIMILARITY_THRESHOLD) return true;
  }
  return false;
}

// ../../super-agent-zcode/packages/orchestrator/src/standardize.ts
function standardizeReview(raw) {
  const issues = [];
  const sectionRe = /^#{2,4}\s*新?意见\s*(\d+)/gm;
  const marks = [];
  const matches = [...raw.matchAll(sectionRe)];
  matches.forEach((m, i) => {
    marks.push({ index: m.index ?? 0, end: matches[i + 1]?.index ?? raw.length });
  });
  for (const mark of marks) {
    const body = raw.slice(mark.index, mark.end);
    const field = (name) => {
      const m = new RegExp(`^\\s*[-*]\\s*${name}\\s*[:\uFF1A]\\s*(.+)$`, "m").exec(body);
      return m ? m[1].trim() : null;
    };
    issues.push({
      index: issues.length + 1,
      level: field("\u7EA7\u522B"),
      type: field("\u7C7B\u578B"),
      description: field("\u63CF\u8FF0"),
      evidence: field("\u8BC1\u636E"),
      suggestion: field("\u5EFA\u8BAE")
    });
  }
  const verdictLine = /^\s*(?:\*\*)?整体结论(?:\*\*)?\s*[:：]\s*(.+)$/m.exec(raw);
  const noIssue = issues.length === 0 && /无意见|方案成立|没有意见/.test(raw);
  return {
    issues,
    overallVerdict: verdictLine ? verdictLine[1].trim() : issues.length > 0 ? null : "\u672A\u89E3\u6790\u5230\u7ED3\u8BBA",
    unstandardized: issues.length === 0 && !noIssue
  };
}
function checkProposal(raw) {
  const has = (re) => re.test(raw);
  return {
    hasRequirementUnderstanding: has(/^\s*#{1,4}\s*需求理解/m),
    hasFactsAssumptions: has(/^\s*#{1,4}\s*事实(?:与|和)?假设/m),
    hasRecommendation: has(/^\s*#{1,4}\s*推荐方案/m),
    hasRisks: has(/^\s*#{1,4}\s*影响与风险/m),
    hasAcceptance: has(/^\s*#{1,4}\s*实施与验收/m)
  };
}
function parseResponses(raw) {
  const sectionRe = /^#{2,4}\s*回应\s*[:：]?\s*意见\s*(\d+)/gm;
  const matches = [...raw.matchAll(sectionRe)];
  if (matches.length === 0) return [];
  return matches.map((m, i) => {
    const body = raw.slice(m.index ?? 0, matches[i + 1]?.index ?? raw.length);
    const field = (name) => {
      const f = new RegExp(`^\\s*[-*]\\s*${name}\\s*[:\uFF1A]\\s*(.+)$`, "m").exec(body);
      return f ? f[1].trim() : null;
    };
    const disposition = field("\u5904\u7F6E");
    return {
      issueIndex: Number(m[1]),
      disposition,
      note: field("\u8BF4\u660E"),
      unstandardized: disposition === null
    };
  });
}
function standardizeRecheck(raw) {
  const sectionRe = /^#{2,4}\s*(?:意见\s*(\d+)\s*)?复核/gm;
  const matches = [...raw.matchAll(sectionRe)];
  const conclusions = matches.filter((m) => m[1] !== void 0).map((m, i, arr) => {
    const body = raw.slice(m.index ?? 0, arr[i + 1]?.index ?? raw.length);
    const field = (name) => {
      const f = new RegExp(`^\\s*[-*]\\s*${name}\\s*[:\uFF1A]\\s*(.+)$`, "m").exec(body);
      return f ? f[1].trim() : null;
    };
    return { issueIndex: Number(m[1]), conclusion: field("\u7ED3\u8BBA"), note: field("\u8BF4\u660E") };
  });
  const newSectionIdx = raw.search(/^#{2,4}\s*新意见/gm);
  const newIssues = newSectionIdx >= 0 ? standardizeReview(raw.slice(newSectionIdx)).issues : [];
  const declaredNone = /无新实质问题/.test(raw);
  return {
    conclusions,
    newIssues,
    hasNewIssues: newIssues.length > 0,
    unstandardized: conclusions.length === 0 && !declaredNone
  };
}
function parseDecisions(raw) {
  const sectionRe = /^#{2,4}\s*决策\s*(\d+)/gm;
  const matches = [...raw.matchAll(sectionRe)];
  return matches.map((m, i) => {
    const body = raw.slice(m.index ?? 0, matches[i + 1]?.index ?? raw.length);
    const field = (name) => {
      const f = new RegExp(`^\\s*[-*]\\s*${name}\\s*[:\uFF1A]\\s*([\\s\\S]+?)(?=\\n\\s*[-*]\\s|$)`, "m").exec(body);
      return f ? f[1].trim() : null;
    };
    return {
      id: `D${m[1]}`,
      content: field("\u5185\u5BB9") ?? body.replace(/^#{2,4}\s*决策\s*\d+\s*/m, "").trim().slice(0, 200),
      alternatives: field("\u5907\u9009"),
      rationale: field("\u7406\u7531"),
      source: field("\u6765\u6E90")
    };
  });
}

// ../../super-agent-zcode/packages/orchestrator/src/discussion.ts
var TASK_TIMEOUT_MS = 10 * 6e4;
var CANCEL_GRACE_MS = 8e3;
var RUNNING_STAGES = [
  "checking",
  "proposing",
  "reviewing",
  "responding",
  "rechecking",
  "synthesizing"
];
function isRunningStage(stage) {
  return RUNNING_STAGES.includes(stage);
}
function isDiscussionTerminal(stage) {
  return stage === "stopped" || stage === "closed" || stage === "failed" || stage === "reviewed" || stage === "completed";
}
function bumpVersion(v) {
  const n = Number(v.replace(/^v/, ""));
  return Number.isFinite(n) ? `v${n + 1}` : `${v}+1`;
}
function spawnConfigFor(plan) {
  if (plan.kind === "mock") {
    return mockAgentConfig(
      plan.participantId,
      plan.env ?? { SUPER_MOCK_BEHAVIOR: "discussion" }
    );
  }
  return realAgentConfig(plan.kind, plan.participantId, plan.env);
}
function createDiscussionRecord(input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const n = input.participants.length;
  if (n < 1 || n > 5) {
    throw new Error(`\u53C2\u4E0E\u8005\u6570\u91CF\u987B\u4E3A 1-5\uFF0C\u6536\u5230 ${n}\uFF08P1\uFF1A\u7528\u6237\u9009\u5B9A\u672C\u6B21\u4EFB\u52A1\u7684 agent \u6570\u91CF\uFF09`);
  }
  const maxRounds = Math.min(3, Math.max(1, input.maxRounds ?? 1));
  const normalTotal = input.normalTotal ?? (n === 1 ? 2 + maxRounds : n * 4 * maxRounds + 1);
  const synthesizerId = input.synthesizerId ?? input.participants[0].participantId;
  return {
    id: newId("disc"),
    stage: "draft",
    requirementVersion: "v1",
    requirementText: input.requirementText,
    cwd: input.cwd,
    participants: input.participants,
    budget: {
      normalTotal,
      fixTotal: input.fixTotal ?? Math.max(2, n),
      entries: [],
      voidedEntries: []
    },
    runMode: input.runMode === "step" ? "step" : "auto",
    // AGT-09 会话复用：默认开启（2026-11-10 用户确认，依据 RUN B' 对照数据：快 28% 省 35%）；
    // 综合仍强制新会话（SYN-01）；resume 失败自动回退新会话并留痕 sessionMode
    sessionReuse: input.sessionReuse ?? true,
    proposalVersions: {},
    responseVersions: {},
    revisionRelations: [],
    maxRounds,
    roundsCompleted: 0,
    synthesizerId,
    reviewRelations: [],
    recheckRelations: [],
    openIssues: [],
    synthesis: null,
    decisions: [],
    grade: null,
    pauseReason: null,
    pausedFromStage: null,
    pauseKind: null,
    createdAt: now,
    updatedAt: now
  };
}
var PersistFailedError = class extends Error {
  constructor(cause) {
    super(`\u672C\u5730\u4FDD\u5B58\u5931\u8D25\uFF08AC-29/\xA712.1\uFF09\uFF1A${String(cause)}`);
    this.cause = cause;
    this.name = "PersistFailedError";
  }
  cause;
};
function assertResumable(stage) {
  if (stage === "completed" || stage === "stopped" || stage === "closed" || stage === "failed") {
    throw new Error(`\u8BA8\u8BBA\u5904\u4E8E\u7EC8\u6001 ${stage}\uFF1A\u4E0D\u80FD\u539F\u5730\u91CD\u5F00\uFF08AC-46/\xA712.1\uFF09\uFF1B\u5982\u9700\u7EE7\u7EED\u8BF7\u65B0\u5EFA\u5173\u8054\u8BA8\u8BBA\u5E76\u5F15\u7528\u672C\u8BA8\u8BBA`);
  }
}
function migrateDiscussionRecord(record2) {
  record2.responseVersions ??= {};
  record2.revisionRelations ??= [];
  record2.recheckRelations ??= [];
  record2.openIssues ??= [];
  record2.synthesis ??= null;
  record2.decisions ??= [];
  for (const item of record2.decisions) {
    item.chosenOption ??= null;
  }
  record2.grade ??= null;
  record2.pausedFromStage ??= null;
  record2.pauseKind ??= null;
  record2.runMode ??= "auto";
  record2.userDirectives ??= {};
  record2.directMessages ??= [];
  record2.finalReviews ??= [];
  record2.budget.voidedEntries ??= [];
  record2.budget.extraTotal ??= 0;
  record2.synthesisForced ??= false;
  if (!Number.isInteger(record2.maxRounds)) record2.maxRounds = 1;
  if (!Number.isInteger(record2.roundsCompleted)) record2.roundsCompleted = 0;
  if (!record2.synthesizerId) record2.synthesizerId = record2.participants[0]?.participantId ?? "";
  for (const rel of record2.reviewRelations) {
    rel.phase ??= "review";
  }
  return record2;
}
var DiscussionRunner = class {
  constructor(dataDir, disc, log = () => {
  }) {
    this.dataDir = dataDir;
    this.disc = disc;
    this.log = log;
    migrateDiscussionRecord(disc);
    this.discDir = path7.join(dataDir, "discussions", disc.id);
    this.controller = new SuperAgentController(dataDir, autoAllowOnce());
    this.events = new JsonlLog(path7.join(this.discDir, "events.jsonl"));
    this.budget = new Budget(disc);
    this.slots = new ConcurrencySlots(disc.participants.length, disc.participants.length);
  }
  dataDir;
  disc;
  log;
  controller;
  events;
  discDir;
  slots;
  connections = /* @__PURE__ */ new Map();
  sessionConfigs = /* @__PURE__ */ new Map();
  activeAttempts = /* @__PURE__ */ new Map();
  /** 协作式调度标志（工作台/CLI 的暂停与停止） */
  pauseRequested = false;
  stopRequested = false;
  /** D-26 分步模式：本次 runAfterConfirmation 入口是否有阶段实际派发了任务（步骤边界判定） */
  phaseWorkedThisEntry = false;
  /** D-27 直接综合：用户请求跳过剩余阶段，下个阶段边界生效（在途任务先完成归档） */
  synthesisRequested = false;
  /** D-29 下一轮互评：无需内存标志——开启=动态抬高 maxRounds，轮次门（round>=maxRounds）自然放行 */
  budget;
  /** 一次性提交额度种类覆盖（--fix-retry 置 fix；首次提交后复位 normal，§9.5/BUD-03） */
  nextCommitKind = "normal";
  proposals = /* @__PURE__ */ new Map();
  /* ---------- 持久化 ---------- */
  async persist() {
    this.disc.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
    try {
      await writeJsonAtomic(path7.join(this.discDir, "discussion.json"), this.disc);
    } catch (err) {
      this.disc.stage = "failed";
      this.disc.pauseReason = `\u672C\u5730\u4FDD\u5B58\u5931\u8D25\uFF1A${String(err).slice(0, 160)}`;
      throw new PersistFailedError(err);
    }
  }
  async setStage(stage) {
    if (isDiscussionTerminal(this.disc.stage) && this.disc.stage !== stage) {
      throw new Error(`\u8BA8\u8BBA\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u8F6C\u6362\u5230 ${stage}\uFF08AC-46\uFF09`);
    }
    this.disc.stage = stage;
    this.events.append({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "stage", stage });
    await this.persist();
  }
  /* ---------- 阶段 0：接入检查 ---------- */
  /**
   * 建立/补齐连接（不改变讨论阶段）。首次接入与恢复共用；
   * 已连接且未断开的参与者复用，断开的重新拉起。
   */
  /** 连接建立中备忘（并发 connect 只补一轮，防止双 spawn 互相覆盖句柄） */
  connecting;
  async connect() {
    if (this.connecting) return this.connecting;
    this.connecting = this.doConnect().finally(() => {
      this.connecting = void 0;
    });
    return this.connecting;
  }
  async doConnect() {
    for (const p of this.disc.participants) {
      let handle = this.connections.get(p.participantId);
      if (!handle || handle.connectionClosed) {
        if (handle) this.connections.delete(p.participantId);
        handle = await this.controller.startAgent(spawnConfigFor(p));
        this.connections.set(p.participantId, handle);
        this.log(`[\u63A5\u5165] ${p.participantId} (${p.kind}) agentInfo=${JSON.stringify(handle.declared?.agentInfo ?? null)}`);
      }
      if (p.kind !== "mock" && !this.sessionConfigs.has(p.participantId)) {
        this.sessionConfigs.set(
          p.participantId,
          await discoverSessionConfig(handle, this.disc.cwd, (m) => this.log(`[\u914D\u7F6E] ${p.participantId} ${m}`))
        );
      }
    }
  }
  async checkAccess() {
    await this.setStage("checking");
    await this.connect();
    await this.setStage("awaiting_confirmation");
  }
  /** 本场接入检查发现的各参与者档位（供确认页展示与校验） */
  getDiscoveredConfigs() {
    return Object.fromEntries(this.sessionConfigs.entries());
  }
  /**
   * 确认页提交的档位选择：先全量校验，再写入讨论记录。
   * 空字符串表示“默认档”，会清空显式选择并保留低成本守卫。
   */
  applyParticipantConfigs(input) {
    const pending = [];
    for (const [participantId, raw] of Object.entries(input)) {
      const plan = this.disc.participants.find((p) => p.participantId === participantId);
      if (!plan) throw new Error(`\u672A\u77E5\u53C2\u4E0E\u8005\uFF1A${participantId}`);
      const cfg = this.sessionConfigs.get(participantId);
      const model = typeof raw?.model === "string" ? raw.model.trim() : "";
      const reasoning = typeof raw?.reasoning === "string" ? raw.reasoning.trim() : "";
      if (!cfg) {
        if (model || reasoning) {
          throw new Error(`\u53C2\u4E0E\u8005 ${participantId}\uFF08${plan.kind}\uFF09\u672A\u53D1\u73B0\u53EF\u914D\u7F6E\u7684\u4F1A\u8BDD\u6863\u4F4D`);
        }
        continue;
      }
      if (model) {
        if (!cfg.modelConfigId || !cfg.modelOptions.some((o) => o.value === model)) {
          throw new Error(`\u53C2\u4E0E\u8005 ${participantId} \u7684\u6A21\u578B\u6863\u4F4D\u65E0\u6548\uFF1A${model}`);
        }
      }
      if (reasoning) {
        if (!cfg.reasoningConfigId || !cfg.reasoningOptions.some((o) => o.value === reasoning)) {
          throw new Error(`\u53C2\u4E0E\u8005 ${participantId} \u7684\u601D\u8003\u5F3A\u5EA6\u6863\u4F4D\u65E0\u6548\uFF1A${reasoning}`);
        }
      }
      pending.push({ plan, config: { model: model || null, reasoning: reasoning || null } });
    }
    for (const item of pending) item.plan.config = item.config;
  }
  /**
   * 统一恢复入口（CLI continue 与工作台 resume 共用）：
   * 1) 重启后核对门；2) 幽灵账对账（仅用户确认后作废）；3) 未确认尝试核对门；
   * 4) 重连成功后才恢复原阶段并调度。任何门未通过都不改阶段。
   */
  async prepareResume(opts2) {
    if (isDiscussionTerminal(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF1A\u4E0D\u80FD\u539F\u5730\u6062\u590D\uFF08AC-46/\xA712.1\uFF09`);
    }
    if (this.disc.pauseKind === "restart" && !opts2.recoveryConfirmed) {
      return { ok: false, kind: "restart_review", pauseReason: this.disc.pauseReason };
    }
    let anomalies = await findLedgerAnomalies(this.dataDir, this.disc);
    if (anomalies.length > 0) {
      if (!opts2.voidGhosts) return { ok: false, kind: "ledger", entries: anomalies };
      const now = (/* @__PURE__ */ new Date()).toISOString();
      for (const a of anomalies) {
        if (!a.voidable) continue;
        if (this.budget.voidEntry(
          a.attemptId,
          "\u7528\u6237\u786E\u8BA4\uFF1A\u65E0 attempt \u8BB0\u5F55\uFF0C\u5224\u5B9A\u672A\u63D0\u4EA4\uFF08BUD-01/\xA79.5\uFF09",
          () => now
        )) {
          this.events.append({
            at: now,
            event: "budget_void",
            attemptId: a.attemptId,
            participantId: a.participantId,
            phase: a.phase,
            round: a.round,
            reason: "ghost_entry_user_confirmed"
          });
        }
      }
      await this.events.flush();
      anomalies = await findLedgerAnomalies(this.dataDir, this.disc);
      if (anomalies.length > 0) return { ok: false, kind: "ledger", entries: anomalies };
      await this.persist();
    }
    const unconfirmed = await findUnconfirmedAttempts(this.dataDir, this.disc);
    if (unconfirmed.length > 0 && !opts2.recoveryConfirmed) {
      return { ok: false, kind: "recovery", attempts: unconfirmed };
    }
    this.pauseRequested = false;
    this.stopRequested = false;
    await this.connect();
    const rawTarget = this.disc.stage === "paused" || this.disc.stage === "interrupted" ? this.disc.pausedFromStage ?? inferResumeStage(this.disc) : this.disc.stage;
    const target = rawTarget === "checking" ? "awaiting_confirmation" : rawTarget;
    await this.resumeFromDisk();
    this.disc.stage = target;
    this.disc.pausedFromStage = null;
    this.disc.pauseKind = null;
    this.disc.pauseReason = null;
    await this.persist();
    return {
      ok: true,
      stage: target,
      shouldRun: target === "proposing" || target === "reviewing" || target === "responding" || target === "rechecking" || target === "synthesizing"
    };
  }
  /** 服务/进程重启后强制先暂停核对（§12.3），不自动调度 */
  async markRestartPaused(reason = "\u670D\u52A1\u91CD\u542F\uFF0C\u5F85\u6838\u5BF9\uFF08\xA712.3\uFF09") {
    if (isDiscussionTerminal(this.disc.stage) || this.disc.stage === "paused") return;
    if (!isRunningStage(this.disc.stage)) return;
    this.disc.pausedFromStage = this.disc.stage === "checking" ? "awaiting_confirmation" : this.disc.stage;
    this.disc.pauseKind = "restart";
    this.disc.stage = "paused";
    this.disc.pauseReason = reason;
    this.events.append({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "paused", reason, trigger: "restart" });
    await this.persist();
    await this.events.flush();
  }
  /* ---------- 执行（确认后调用） ---------- */
  async runAfterConfirmation() {
    if (isDiscussionTerminal(this.disc.stage)) return this.outcome();
    try {
      this.phaseWorkedThisEntry = false;
      await this.runPhaseProposals();
      if (!this.proposalsDone()) return this.outcome();
      if (await this.stopIfRequested()) return this.outcome();
      if (this.pauseRequested || this.stageIsPaused()) {
        await this.markPaused("\u7528\u6237\u6682\u505C");
        return this.outcome();
      }
      if (await this.stepPauseIfDue()) return this.outcome();
      if (this.synthesisRequested) return await this.finishWithSynthesis();
      for (let round = 1; round <= this.disc.maxRounds; round++) {
        await this.runPhaseReviews(round);
        if (!this.reviewsDoneForRound(round)) return this.outcome();
        if (await this.stopIfRequested()) return this.outcome();
        if (this.pauseRequested || this.stageIsPaused()) {
          await this.markPaused("\u7528\u6237\u6682\u505C");
          return this.outcome();
        }
        if (await this.stepPauseIfDue()) return this.outcome();
        if (this.synthesisRequested) return await this.finishWithSynthesis();
        await this.runPhaseResponses(round);
        if (!this.responsesDoneForRound(round)) return this.outcome();
        if (await this.stopIfRequested()) return this.outcome();
        if (this.pauseRequested || this.stageIsPaused()) {
          await this.markPaused("\u7528\u6237\u6682\u505C");
          return this.outcome();
        }
        if (await this.stepPauseIfDue()) return this.outcome();
        if (this.synthesisRequested) return await this.finishWithSynthesis();
        await this.runPhaseRechecks(round);
        if (!this.rechecksDoneForRound(round)) return this.outcome();
        this.disc.roundsCompleted = round;
        await this.persist();
        if (await this.stopIfRequested()) return this.outcome();
        if (this.pauseRequested || this.stageIsPaused()) {
          await this.markPaused("\u7528\u6237\u6682\u505C");
          return this.outcome();
        }
        if (await this.stepPauseIfDue()) return this.outcome();
        if (this.synthesisRequested) return await this.finishWithSynthesis();
        if (this.disc.runMode !== "step" && round >= this.disc.maxRounds) {
          const cost = this.roundCost();
          const todo = this.disc.openIssues.length;
          await this.markPaused(
            `\u7B2C ${round} \u8F6E\u4E92\u8BC4\u5B8C\u6210${todo ? `\uFF08\u5F85\u529E ${todo} \u6761\uFF09` : ""}\u2014\u2014\u53EF\u5F00\u542F\u4E0B\u4E00\u8F6E\u4E92\u8BC4\uFF08\u7EA6\u9700 ${cost} \u6B21\u989D\u5EA6\uFF0C\u603B\u4E0A\u9650 3 \u8F6E\uFF09\uFF0C\u6216\u76F4\u63A5\u7EFC\u5408`,
            "round"
          );
          return this.outcome();
        }
      }
      return await this.finishWithSynthesis();
    } catch (err) {
      if (err instanceof PersistFailedError) {
        this.log(`[\u5931\u8D25] ${err.message}\u2014\u2014\u8BA8\u8BBA\u5DF2\u6807\u8BB0 failed\uFF0C\u5DF2\u843D\u76D8\u6210\u679C\u4FDD\u7559\uFF0C\u4E0D\u81EA\u52A8\u91CD\u8BD5`);
        return this.outcome();
      }
      throw err;
    }
  }
  /** D-26 分步模式：本入口刚完成一个步骤 → 落 paused 等待“继续”（在途任务不受影响） */
  async stepPauseIfDue() {
    if (this.disc.runMode === "step" && this.phaseWorkedThisEntry) {
      await this.markPaused("\u5206\u6B65\u6A21\u5F0F\uFF1A\u5F53\u524D\u6B65\u9AA4\u5DF2\u5B8C\u6210\uFF0C\u7B49\u5F85\u7EE7\u7EED");
      return true;
    }
    return false;
  }
  /** 综合收尾（正常流程末尾与 D-27“直接综合”共用）：综合 → 待最终决策 */
  async finishWithSynthesis() {
    this.synthesisRequested = false;
    await this.runPhaseSynthesis();
    if (!this.disc.synthesis) return this.outcome();
    if (this.disc.stage !== "awaiting_decisions" && !isDiscussionTerminal(this.disc.stage)) {
      await this.setStage("awaiting_decisions");
    }
    return this.outcome();
  }
  /* ---------- 阶段完成判定（幂等：断点续跑时跳过已完成阶段） ---------- */
  stageIsPaused() {
    return this.disc.stage === "paused";
  }
  /** REV-07：检查新待办是否与已有待办相似（去重；原文在 artifact 中保留） */
  isOpenIssueDuplicate(text) {
    if (this.disc.openIssues.length === 0) return false;
    return isDuplicateOpenIssue(text, this.disc.openIssues, this.disc.openIssues);
  }
  proposalsDone() {
    return this.disc.participants.every((p) => {
      const v = this.disc.proposalVersions[p.participantId];
      return !!v && this.proposals.has(p.participantId);
    });
  }
  reviewsDoneForRound(round) {
    if (this.disc.participants.length < 2) return true;
    return this.disc.participants.every(
      (p) => this.disc.reviewRelations.some(
        (r) => r.phase === "review" && r.valid && r.round === round && r.targetParticipant === p.participantId
      )
    );
  }
  /**
   * 修订完成判定：优先按本轮 revisionRelations（成功才有效）；旧记录没有该字段时
   * 回落到原预算记账语义，避免升级后重跑历史轮次。
   */
  revisionDone(participantId, round) {
    const rels = this.disc.revisionRelations ?? [];
    if (rels.length > 0) {
      return rels.some((r) => r.valid && r.round === round && r.participantId === participantId);
    }
    return this.disc.budget.entries.some(
      (e) => e.phase === "revision" && e.round === round && e.participantId === participantId
    );
  }
  responsesDoneForRound(round) {
    if (this.disc.participants.length === 0) return true;
    return this.disc.participants.every((p) => this.revisionDone(p.participantId, round));
  }
  rechecksDoneForRound(round) {
    if (this.disc.participants.length < 2) return true;
    return this.disc.participants.every(
      (p) => this.disc.recheckRelations.some((r) => r.valid && r.round === round && r.reviewer === p.participantId)
    );
  }
  /**
   * 断点续跑：从磁盘重建内存态（提案/修订正文与版本），使已有讨论可以从任意已完成阶段继续。
   * 产物不可变，重放无损（§13.1）；不改变讨论阶段。
   */
  async resumeFromDisk() {
    for (const p of this.disc.participants) {
      const version2 = this.disc.proposalVersions[p.participantId];
      if (!version2) continue;
      const text = await fs3.readFile(this.artifactPath(`proposal-${p.participantId}-${version2}.md`), "utf8").catch(() => null);
      if (text !== null) this.proposals.set(p.participantId, { text, version: version2 });
      const responseVersion = this.disc.responseVersions[p.participantId];
      if (responseVersion) {
        const revText = await fs3.readFile(this.artifactPath(`revision-${p.participantId}-${responseVersion}.md`), "utf8").catch(() => null);
        if (revText !== null) {
          this.proposals.set(p.participantId, { text: revText, version: responseVersion });
        }
      }
    }
  }
  outcome() {
    const proposals = [];
    for (const p of this.disc.participants) {
      const version2 = this.disc.proposalVersions[p.participantId];
      if (!version2) continue;
      proposals.push({
        participantId: p.participantId,
        version: version2,
        artifactPath: this.artifactPath(`proposal-${p.participantId}-${version2}.md`),
        check: checkProposal(this.proposals.get(p.participantId)?.text ?? "")
      });
    }
    const status = (() => {
      switch (this.disc.stage) {
        case "reviewed":
          return "reviewed";
        case "awaiting_decisions":
          return "awaiting_decisions";
        case "completed":
          return "completed";
        case "stopped":
          return "stopped";
        case "closed":
          return "closed";
        case "interrupted":
          return "interrupted";
        case "failed":
          return "failed";
        default:
          return "paused";
      }
    })();
    const revisions = this.disc.participants.map((p) => {
      const version2 = this.disc.responseVersions[p.participantId];
      return version2 ? {
        participantId: p.participantId,
        version: version2,
        artifactPath: this.artifactPath(`revision-${p.participantId}-${version2}.md`)
      } : null;
    }).filter((x) => x !== null);
    return {
      status,
      pausedReason: this.disc.pauseReason,
      proposals,
      reviews: this.disc.reviewRelations,
      revisions,
      rechecks: this.disc.recheckRelations,
      openIssues: this.disc.openIssues,
      synthesis: this.disc.synthesis,
      decisions: this.disc.decisions,
      grade: this.disc.grade,
      budgetUsed: this.budget.usedNormal,
      budgetFixUsed: this.budget.usedFix,
      budgetVoided: this.budget.voided,
      budgetRemainingForPhases: this.budget.remainingForPhases
    };
  }
  artifactPath(name) {
    return path7.join(this.discDir, "artifacts", name);
  }
  async writeArtifact(name, content) {
    const filePath = this.artifactPath(name);
    await mkdir2(path7.dirname(filePath), { recursive: true });
    await fs3.writeFile(filePath, content, "utf8");
    return filePath;
  }
  /* ---------- 提案阶段 ---------- */
  async runPhaseProposals() {
    const todo = this.disc.participants.filter(
      (p) => !this.disc.proposalVersions[p.participantId] || !this.proposals.has(p.participantId)
    );
    if (todo.length === 0) return;
    this.phaseWorkedThisEntry = true;
    await this.setStage("proposing");
    const results = await Promise.all(
      todo.map(
        (p) => this.runScoped(p.participantId, "proposal", 1, {
          prompt: proposalPrompt(this.disc.requirementText, this.disc.cwd, p.participantId),
          inputVersion: `${this.disc.requirementVersion}`
        })
      )
    );
    let failure2 = null;
    for (const [i, p] of todo.entries()) {
      const r = results[i];
      if (!r.ok) {
        failure2 = { participantId: p.participantId, reason: r.reason, budgetExhausted: r.budgetExhausted === true };
        continue;
      }
      const version2 = "v1";
      this.proposals.set(p.participantId, { text: r.text, version: version2 });
      this.disc.proposalVersions[p.participantId] = version2;
      await this.writeArtifact(`proposal-${p.participantId}-${version2}.md`, r.text);
      this.log(`[\u63D0\u6848] ${p.participantId} ${version2} \u5B8C\u6210\uFF08${r.text.length} \u5B57\u7B26\uFF09`);
    }
    if (failure2) {
      await this.pause(
        `\u63D0\u6848\u9636\u6BB5\u5931\u8D25\uFF1A${failure2.participantId} ${failure2.reason}\uFF08\u5DF2\u6210\u529F\u65B9\u6210\u679C\u4FDD\u7559\uFF0C\xA79.4\uFF09`,
        failure2.budgetExhausted ? "budget" : "failure"
      );
      return;
    }
    await this.persist();
  }
  /* ---------- 互评阶段 ---------- */
  async runPhaseReviews(round) {
    const n = this.disc.participants.length;
    if (n < 2) return;
    if (!this.proposalsDone()) {
      await this.pause("\u4E92\u8BC4\u524D\u7F6E\u4E0D\u6EE1\u8DB3\uFF1A\u7F3A\u5C11\u6709\u6548\u63D0\u6848\uFF08\xA79.2\uFF09");
      return;
    }
    const pairs = this.disc.participants.map((p, i) => {
      const target = this.disc.participants[(i + 1) % n].participantId;
      const targetProposal = this.proposals.get(target);
      return { reviewer: p.participantId, target, targetVersion: targetProposal.version };
    }).filter(
      ({ reviewer, target }) => (
        // 完成判定只按轮次/评审者/方向；targetVersion 仅用于本次绑定与产物命名。
        // 否则修订后续跑会把“首稿已评”误判为缺评，重复评审并重复扣额。
        !this.disc.reviewRelations.some(
          (r) => r.phase === "review" && r.valid && r.round === round && r.reviewer === reviewer && r.targetParticipant === target
        )
      )
    );
    if (pairs.length === 0) return;
    this.phaseWorkedThisEntry = true;
    await this.setStage("reviewing");
    const results = await Promise.all(
      pairs.map(({ reviewer, target, targetVersion }) => {
        const targetProposal = this.proposals.get(target);
        return this.runScoped(reviewer, "review", round, {
          prompt: reviewPromptIncremental(target, targetVersion, targetProposal.text),
          promptFallback: reviewPrompt(
            this.disc.requirementText,
            target,
            targetVersion,
            targetProposal.text
          ),
          inputVersion: `${this.disc.requirementVersion}+peer-${targetVersion}`
        }).then((r) => ({ reviewer, target, targetVersion, r }));
      })
    );
    let failure2 = null;
    for (const { reviewer, target, targetVersion, r } of results) {
      if (!r.ok) {
        failure2 = { reviewer, target, reason: r.reason, budgetExhausted: r.budgetExhausted === true };
        continue;
      }
      const parsed = standardizeReview(r.text);
      const artifact = await this.writeArtifact(
        `review-${reviewer}-on-${target}-${targetVersion}.md`,
        r.text
      );
      const relation = {
        relationId: newId("revrel"),
        reviewer,
        targetParticipant: target,
        targetVersion,
        phase: "review",
        round,
        attemptId: r.attemptId,
        valid: true,
        unstandardized: parsed.unstandardized,
        artifactPath: artifact
      };
      this.disc.reviewRelations.push(relation);
      this.log(
        `[\u4E92\u8BC4] ${reviewer} \u2192 ${target} ${targetVersion}\uFF1A\u610F\u89C1 ${parsed.issues.length} \u6761${parsed.unstandardized ? "\uFF08\u7ED3\u6784\u5316\u89E3\u6790\u5931\u8D25\uFF0C\u539F\u6587\u5DF2\u5F52\u6863\uFF09" : ""}`
      );
    }
    if (failure2) {
      await this.pause(
        `\u4E92\u8BC4\u9636\u6BB5\u5931\u8D25\uFF1A${failure2.reviewer} \u8BC4\u5BA1 ${failure2.target} \u65F6 ${failure2.reason}\uFF08\u5DF2\u6210\u529F\u65B9\u6210\u679C\u4FDD\u7559\uFF0C\xA79.4\uFF09`,
        failure2.budgetExhausted ? "budget" : "failure"
      );
      return;
    }
    await this.persist();
  }
  /* ---------- 回应/修订阶段（§7 步骤 5，PRP-05/REV-05） ---------- */
  async runPhaseResponses(round) {
    const todo = this.disc.participants.filter((p) => {
      const own2 = this.proposals.get(p.participantId);
      return !!own2 && !this.revisionDone(p.participantId, round);
    });
    if (todo.length === 0) return;
    this.phaseWorkedThisEntry = true;
    await this.setStage("responding");
    const results = await Promise.all(
      todo.map(async (p) => {
        const own2 = this.proposals.get(p.participantId);
        const ownVersion = this.disc.responseVersions[p.participantId] ?? this.disc.proposalVersions[p.participantId];
        if (!own2 || !ownVersion) {
          return { participantId: p.participantId, ok: false, reason: "\u7F3A\u5C11\u6709\u6548\u63D0\u6848", nextVersion: "" };
        }
        const relation = this.disc.reviewRelations.find(
          (r2) => r2.phase === "review" && r2.round === round && r2.targetParticipant === p.participantId
        );
        const reviewText = relation ? await fs3.readFile(relation.artifactPath, "utf8").catch(() => "\uFF08\u8BC4\u5BA1\u539F\u6587\u8BFB\u53D6\u5931\u8D25\uFF09") : "\uFF08\u65E0\u5916\u90E8\u8BC4\u5BA1\u3002\u8BF7\u81EA\u67E5\u4EE5\u4E0B\u65B9\u9762\u5E76\u4FEE\u8BA2\uFF1A\u9700\u6C42\u8986\u76D6\u5B8C\u6574\u6027\u3001\u9519\u8BEF\u5904\u7406\u5065\u58EE\u6027\u3001\u8FB9\u754C\u6761\u4EF6\u3001\u672A\u9A8C\u8BC1\u4E8B\u5B9E\u7684\u6807\u6CE8\u3002\uFF09";
        const nextVersion = bumpVersion(ownVersion);
        const r = await this.runScoped(p.participantId, "revision", round, {
          prompt: revisionPromptIncremental(relation?.reviewer ?? "self\uFF08\u81EA\u8BC4\uFF09", reviewText, nextVersion),
          promptFallback: revisionPrompt(
            this.disc.requirementText,
            p.participantId,
            ownVersion,
            own2.text,
            relation?.reviewer ?? "self\uFF08\u81EA\u8BC4\uFF09",
            reviewText,
            nextVersion
          ),
          inputVersion: `${this.disc.requirementVersion}+self-${ownVersion}`
        });
        return r.ok ? { participantId: p.participantId, ok: true, text: r.text, attemptId: r.attemptId, nextVersion } : { participantId: p.participantId, ok: false, reason: r.reason, attemptId: r.attemptId, nextVersion, budgetExhausted: r.budgetExhausted === true };
      })
    );
    let failure2 = null;
    for (const [i, p] of todo.entries()) {
      const r = results[i];
      const relation = {
        relationId: newId("revrel"),
        participantId: p.participantId,
        round,
        version: r.nextVersion,
        attemptId: r.attemptId ?? null,
        artifactPath: null,
        valid: false,
        reason: r.reason ?? null
      };
      if (!r.ok) {
        this.disc.revisionRelations ??= [];
        this.disc.revisionRelations.push(relation);
        failure2 = {
          participantId: p.participantId,
          reason: r.reason ?? "\u672A\u77E5\u539F\u56E0",
          budgetExhausted: r.budgetExhausted === true
        };
        continue;
      }
      const nextVersion = r.nextVersion;
      this.disc.responseVersions[p.participantId] = nextVersion;
      const artifact = await this.writeArtifact(`revision-${p.participantId}-${nextVersion}.md`, r.text);
      this.proposals.set(p.participantId, { text: r.text, version: nextVersion });
      relation.valid = true;
      relation.artifactPath = artifact;
      relation.reason = null;
      this.disc.revisionRelations ??= [];
      this.disc.revisionRelations.push(relation);
      this.log(`[\u4FEE\u8BA2] ${p.participantId} ${nextVersion} \u5B8C\u6210\uFF08${r.text.length} \u5B57\u7B26\uFF09`);
    }
    if (failure2) {
      await this.pause(
        `\u4FEE\u8BA2\u9636\u6BB5\u5931\u8D25\uFF1A${failure2.participantId} ${failure2.reason}\uFF08\u5DF2\u6210\u529F\u65B9\u6210\u679C\u4FDD\u7559\uFF0C\xA79.4\uFF09`,
        failure2.budgetExhausted ? "budget" : "failure"
      );
      return;
    }
    await this.persist();
  }
  /* ---------- 复核阶段（§7 步骤 6，REV-06；一轮为止，AC-15） ---------- */
  async runPhaseRechecks(round) {
    const reviewRels = this.disc.reviewRelations.filter(
      (r) => r.phase === "review" && r.valid && r.round === round && !this.disc.recheckRelations.some(
        (x) => x.valid && x.round === round && x.reviewer === r.reviewer && x.targetParticipant === r.targetParticipant
      )
    );
    if (reviewRels.length === 0) return;
    this.phaseWorkedThisEntry = true;
    await this.setStage("rechecking");
    const results = await Promise.all(
      reviewRels.map(async (rel) => {
        const revisionVersion = this.disc.responseVersions[rel.targetParticipant];
        if (!revisionVersion) {
          return { reviewer: rel.reviewer, target: rel.targetParticipant, revisionVersion: rel.targetVersion, ok: false, reason: "\u4F5C\u8005\u7F3A\u5C11\u4FEE\u8BA2\u7248\u672C" };
        }
        const revisionText = this.proposals.get(rel.targetParticipant)?.text ?? "";
        const originalReview = await fs3.readFile(rel.artifactPath, "utf8").catch(() => "\uFF08\u8BC4\u5BA1\u539F\u6587\u7F3A\u5931\uFF09");
        const r = await this.runScoped(rel.reviewer, "recheck", round, {
          prompt: recheckPromptIncremental(rel.targetParticipant, revisionVersion, revisionText),
          promptFallback: recheckPrompt(
            this.disc.requirementText,
            rel.targetParticipant,
            revisionVersion,
            originalReview,
            revisionText
          ),
          inputVersion: `${this.disc.requirementVersion}+peer-${revisionVersion}`
        });
        return r.ok ? { reviewer: rel.reviewer, target: rel.targetParticipant, revisionVersion, ok: true, text: r.text, attemptId: r.attemptId } : { reviewer: rel.reviewer, target: rel.targetParticipant, revisionVersion, ok: false, reason: r.reason, budgetExhausted: r.budgetExhausted === true };
      })
    );
    let failure2 = null;
    for (const item of results) {
      if (!item.ok) {
        failure2 = { reviewer: item.reviewer, reason: item.reason ?? "\u672A\u77E5\u539F\u56E0", budgetExhausted: item.budgetExhausted === true };
        continue;
      }
      const parsed = standardizeRecheck(item.text);
      const artifact = await this.writeArtifact(
        `recheck-${item.reviewer}-on-${item.target}-${item.revisionVersion}.md`,
        item.text
      );
      const relation = {
        relationId: newId("revrel"),
        reviewer: item.reviewer,
        targetParticipant: item.target,
        targetVersion: item.revisionVersion,
        phase: "recheck",
        round,
        attemptId: item.attemptId,
        valid: true,
        unstandardized: parsed.unstandardized,
        artifactPath: artifact
      };
      this.disc.recheckRelations.push(relation);
      for (const c of parsed.conclusions) {
        if (c.conclusion && c.conclusion !== "\u5DF2\u89E3\u51B3") {
          const text = `\u610F\u89C1 ${c.issueIndex}\uFF08${item.target} ${item.revisionVersion}\uFF09\uFF1A${c.conclusion}${c.note ? ` \u2014 ${c.note}` : ""}`;
          if (!this.isOpenIssueDuplicate(text)) {
            this.disc.openIssues.push(text);
          }
        }
      }
      for (const ni of parsed.newIssues) {
        const text = `\u590D\u6838\u65B0\u610F\u89C1\uFF08${item.reviewer} \u2192 ${item.target}\uFF09[${ni.level ?? "\u672A\u6807\u7EA7"}] ${ni.description ?? ""}`;
        if (!this.isOpenIssueDuplicate(text)) {
          this.disc.openIssues.push(text);
        }
      }
      const solved = parsed.conclusions.filter((c) => c.conclusion === "\u5DF2\u89E3\u51B3").length;
      this.log(
        `[\u590D\u6838] ${item.reviewer} \u2192 ${item.target} ${item.revisionVersion}\uFF1A\u5DF2\u89E3\u51B3 ${solved}/${parsed.conclusions.length}${parsed.hasNewIssues ? `\uFF0C\u65B0\u95EE\u9898 ${parsed.newIssues.length} \u6761` : "\uFF0C\u65E0\u65B0\u5B9E\u8D28\u95EE\u9898"}`
      );
    }
    if (failure2) {
      await this.pause(
        `\u590D\u6838\u9636\u6BB5\u5931\u8D25\uFF1A${failure2.reviewer} ${failure2.reason}\uFF08\u6210\u679C\u4FDD\u7559\uFF0C\xA79.4\uFF09`,
        failure2.budgetExhausted ? "budget" : "failure"
      );
      return;
    }
    await this.persist();
  }
  /* ---------- 综合阶段（§7 步骤 8，SYN-01~06；DSC-03：第一位参与者兼任综合者） ---------- */
  async runPhaseSynthesis() {
    if (this.disc.synthesis) return;
    this.phaseWorkedThisEntry = true;
    await this.setStage("synthesizing");
    const synthesizer = this.disc.participants.find((p) => p.participantId === this.disc.synthesizerId) ?? this.disc.participants[0];
    const inputs = this.disc.participants.map((p) => ({
      participantId: p.participantId,
      version: this.disc.responseVersions[p.participantId] ?? this.disc.proposalVersions[p.participantId],
      text: this.proposals.get(p.participantId)?.text ?? ""
    }));
    const reviewSummaries = await this.buildReviewSummary();
    const inputVersions = inputs.map((i) => ({ participantId: i.participantId, version: i.version }));
    const r = await this.runScoped(synthesizer.participantId, "synthesis", 1, {
      prompt: synthesisPrompt(
        this.disc.requirementText,
        inputs,
        reviewSummaries,
        synthesizer.participantId,
        this.disc.synthesisForced === true
      ),
      inputVersion: `${this.disc.requirementVersion}+inputs:${inputVersions.map((i) => `${i.participantId}@${i.version}`).join(",")}`
    });
    if (!r.ok) {
      await this.pause(
        `\u7EFC\u5408\u5931\u8D25\uFF1A${r.reason}\uFF08\u53EF\u786E\u8BA4\u8FFD\u52A0\u989D\u5EA6\u91CD\u8BD5\uFF0C\u6216\u5BFC\u51FA\u672A\u7EFC\u5408\u8349\u7A3F\uFF0C\xA79.6\uFF09`,
        r.budgetExhausted ? "budget" : "failure"
      );
      return;
    }
    const parsed = parseDecisions(r.text);
    const decisions = parsed.map((d) => ({
      ...d,
      status: "\u5F85\u51B3\u5B9A",
      chosenOption: null,
      decidedAt: null,
      note: null
    }));
    const artifact = await this.writeArtifact("synthesis-v1.md", r.text);
    this.disc.synthesis = {
      attemptId: r.attemptId,
      synthesizer: synthesizer.participantId,
      version: "v1",
      artifactPath: artifact,
      inputVersions,
      unstandardized: decisions.length === 0,
      // AC-27：新增设计必须标注；未标注视为未标记（综合层不阻断，展示层提示）
      newDesignFlagged: /（新增，未评审）/.test(r.text)
    };
    this.disc.decisions = decisions;
    await this.persist();
    this.log(
      `[\u7EFC\u5408] ${synthesizer.participantId} v1 \u5B8C\u6210\uFF08${r.text.length} \u5B57\u7B26\uFF0C\u51B3\u7B56\u9879 ${decisions.length}${this.disc.synthesis.newDesignFlagged ? "" : "\uFF0C\u26A0\uFE0F \u672A\u6807\u6CE8\u65B0\u589E\u8BBE\u8BA1"}\uFF09`
    );
  }
  /** 评审与复核原文摘要（每份截断，NFR-08 输出边界） */
  async buildReviewSummary() {
    const parts = [];
    for (const rel of [...this.disc.reviewRelations, ...this.disc.recheckRelations]) {
      const raw = await fs3.readFile(rel.artifactPath, "utf8").catch(() => "\uFF08\u539F\u6587\u7F3A\u5931\uFF09");
      const clipped = raw.length > 4e3 ? `${raw.slice(0, 4e3)}
[\u622A\u65AD\uFF0C\u539F\u6587 ${raw.length} \u5B57\u7B26]` : raw;
      parts.push(
        `### ${rel.reviewer} \u2192 ${rel.targetParticipant} ${rel.targetVersion}\uFF08${rel.phase}\uFF09
${clipped}`
      );
    }
    return parts.join("\n\n");
  }
  /* ---------- 单次受控提交（槽 + 预算 + 暂停语义） ---------- */
  async runScoped(participantId, phase, round, opts2) {
    const plan = this.disc.participants.find((p) => p.participantId === participantId);
    const appKey = plan?.kind ?? participantId;
    const release = await this.slots.acquire(appKey);
    try {
      if (this.stopRequested) {
        return { ok: false, reason: "\u7528\u6237\u5DF2\u505C\u6B62\uFF08\u4E0D\u518D\u8C03\u5EA6\u65B0\u4EFB\u52A1\uFF0C\xA712.1\uFF09" };
      }
      if (this.pauseRequested) {
        return { ok: false, reason: "\u7528\u6237\u5DF2\u6682\u505C\uFF08\u4E0D\u518D\u8C03\u5EA6\u65B0\u4EFB\u52A1\uFF0C\xA712.1\uFF09" };
      }
      if (isDiscussionTerminal(this.disc.stage)) {
        return { ok: false, reason: "\u8BA8\u8BBA\u5DF2\u6682\u505C/\u505C\u6B62" };
      }
      const handle = this.connections.get(participantId);
      if (!handle || handle.connectionClosed) {
        return { ok: false, reason: "\u8FDE\u63A5\u4E0D\u5B58\u5728\u6216\u5DF2\u65AD\u5F00\uFF08\u672A\u63D0\u4EA4\uFF0C\u4E0D\u6263\u989D\u5EA6\uFF09" };
      }
      if ([...this.activeAttempts.values()].some((a) => a.participantId === participantId)) {
        return { ok: false, reason: `\u53C2\u4E0E\u8005 ${participantId} \u5DF2\u6709\u5728\u9014\u4EFB\u52A1\uFF0C\u7A0D\u540E\u91CD\u8BD5` };
      }
      const attemptId = newId("attempt");
      const runner = this.controller.createRunner(participantId, handle);
      let resolveDone;
      const done = new Promise((resolve7) => {
        resolveDone = resolve7;
      });
      this.activeAttempts.set(attemptId, {
        attemptId,
        runner,
        participantId,
        phase,
        round,
        done,
        resolveDone
      });
      try {
        try {
          const isRetry = this.disc.budget.entries.some(
            (e) => e.participantId === participantId && e.phase === phase && e.round === round
          );
          const wanted = this.nextCommitKind === "fix" || isRetry ? "fix" : "normal";
          this.nextCommitKind = "normal";
          let commitKind = wanted;
          if (!this.budget.canCommit(phase, commitKind) && this.budget.extraRemaining > 0) {
            commitKind = "extra";
          }
          this.budget.commit(attemptId, phase, participantId, () => (/* @__PURE__ */ new Date()).toISOString(), commitKind, round);
          await this.persist();
        } catch (err) {
          if (err instanceof BudgetExhaustedError) {
            return { ok: false, reason: err.message, budgetExhausted: true };
          }
          throw err;
        }
        this.events.append({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "budget_commit", attemptId, phase, participantId });
        const segments = [];
        const role = plan?.role?.trim();
        if (role) segments.push(`\u3010\u89D2\u8272\u8BBE\u5B9A\u3011${role}`);
        const directiveBlock = this.takeUserDirectives(participantId, phase, round, attemptId);
        if (directiveBlock) segments.push(directiveBlock);
        const promptPrefix = segments.length > 0 ? `${segments.join("\n\n---\n\n")}

---

` : "";
        const prompt = `${promptPrefix}${opts2.prompt}`;
        const promptFallback = opts2.promptFallback ? `${promptPrefix}${opts2.promptFallback}` : opts2.promptFallback;
        const resumeSessionId = this.disc.sessionReuse === true && phase !== "synthesis" ? (this.disc.participantSessions ?? {})[participantId]?.sessionId : void 0;
        const rec = await runner.run({
          attemptId,
          prompt,
          promptFallback,
          resumeSessionId,
          round,
          cwd: this.disc.cwd,
          inputVersion: opts2.inputVersion,
          timeoutMs: TASK_TIMEOUT_MS,
          cancelGraceMs: CANCEL_GRACE_MS,
          beforePrompt: this.beforePromptFor(participantId)
        });
        if (rec.status !== "succeeded") {
          if (rec.status !== "cancelled_confirmed") {
            this.disc.participantSessions = this.disc.participantSessions ?? {};
            delete this.disc.participantSessions[participantId];
            await this.persist();
          }
          return {
            ok: false,
            reason: `\u5C1D\u8BD5 ${rec.status}${rec.stopReason ? `(${rec.stopReason})` : ""}${rec.unknownReason ? `/${rec.unknownReason}` : ""}`,
            attemptId
          };
        }
        this.disc.participantSessions = this.disc.participantSessions ?? {};
        if (rec.agentSessionId) {
          this.disc.participantSessions[participantId] = {
            sessionId: rec.agentSessionId,
            connectionId: handle.id
          };
        }
        const text = await this.extractAssistantText(rec.id);
        return { ok: true, text, attemptId };
      } finally {
        this.activeAttempts.delete(attemptId);
        resolveDone();
      }
    } finally {
      release();
    }
  }
  /**
   * 低档位守卫：dsh 强制 flash+low（失败=零消耗中止）；codex 强制 read-only（F1 唯一协议层写保护）；
   * codebuddy 设低档模型（若发现）。qoder/zcode-acp 暂无已知会话级档位接口，如实留空并在计划展示中说明。
   */
  beforePromptFor(participantId) {
    const plan = this.disc.participants.find((x) => x.participantId === participantId);
    const cfg = this.sessionConfigs.get(participantId);
    const handle = this.connections.get(participantId);
    if (!plan || plan.kind === "mock" || !cfg || !handle) return void 0;
    const warn = (m) => this.log(`  \u26A0\uFE0F ${m}`);
    const userModel = plan.config?.model ?? null;
    const userReasoning = plan.config?.reasoning ?? null;
    const low = plan.kind === "dsh" ? dshLowCostConfig(handle, cfg) : plan.kind === "codex-acp" ? codexReadOnlyConfig(handle, cfg, false, warn) : plan.kind === "codebuddy" ? codebuddyLowCostConfig(handle, cfg, warn) : plan.kind === "zcode-acp" ? zcodeLowCostConfig(handle, cfg, warn) : void 0;
    return async (sessionId) => {
      if (plan.kind === "codex-acp") {
        await low(sessionId);
      } else if (low) {
        const skipDshLow = plan.kind === "dsh" && !!userModel && !!userReasoning;
        if (!skipDshLow) await low(sessionId);
      }
      if (userModel) {
        if (!cfg.modelConfigId || !cfg.modelOptions.some((o) => o.value === userModel)) {
          throw new Error(
            `\u53C2\u4E0E\u8005 ${participantId} \u7684\u6A21\u578B\u6863\u4F4D\u65E0\u6548\uFF1A${userModel}\uFF08\u672A\u5728\u672C\u673A\u4F1A\u8BDD\u914D\u7F6E\u4E2D\u53D1\u73B0\uFF09`
          );
        }
        await handle.setConfigOption(sessionId, cfg.modelConfigId, userModel);
      }
      if (userReasoning) {
        if (!cfg.reasoningConfigId || !cfg.reasoningOptions.some((o) => o.value === userReasoning)) {
          throw new Error(
            `\u53C2\u4E0E\u8005 ${participantId} \u7684\u601D\u8003\u5F3A\u5EA6\u6863\u4F4D\u65E0\u6548\uFF1A${userReasoning}\uFF08\u672A\u5728\u672C\u673A\u4F1A\u8BDD\u914D\u7F6E\u4E2D\u53D1\u73B0\uFF09`
          );
        }
        await handle.setConfigOption(sessionId, cfg.reasoningConfigId, userReasoning);
      }
    };
  }
  /** 提案/评审正文 = 流式 agent_message_chunk 文本拼接（原文在线路日志） */
  async extractAssistantText(attemptId) {
    await this.controller.store.flushEvents();
    const events = await this.controller.store.readStandardizedEvents(attemptId);
    return events.filter((e) => e.updateKind === "agent_message_chunk" && !e.sensitive).map((e) => {
      const d = e.detail;
      return d?.content?.type === "text" ? d.content.text ?? "" : "";
    }).join("");
  }
  async pause(reason, kind = "failure") {
    if (isDiscussionTerminal(this.disc.stage) || this.disc.stage === "interrupted") return;
    if (this.disc.stage !== "paused") {
      this.disc.pausedFromStage = this.disc.stage === "checking" ? "awaiting_confirmation" : this.disc.stage;
    }
    this.disc.pauseKind = kind;
    this.disc.stage = "paused";
    this.disc.pauseReason = reason;
    this.events.append({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "paused", reason, trigger: kind });
    await this.persist();
    this.log(`[\u6682\u505C] ${reason}`);
  }
  /** 用户暂停（§12.1/D-26 分步模式/D-29 轮次门）：阻止新调度，不假定外部任务停止；恢复用 continue */
  async markPaused(reason, kind = "user") {
    if (isDiscussionTerminal(this.disc.stage) || this.disc.stage === "paused" || this.disc.stage === "interrupted") {
      return;
    }
    this.disc.pausedFromStage = this.disc.stage === "checking" ? "awaiting_confirmation" : this.disc.stage;
    this.disc.pauseKind = kind;
    this.disc.stage = "paused";
    this.disc.pauseReason = reason;
    this.events.append({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "paused", reason, trigger: kind });
    await this.persist().catch(() => {
    });
  }
  /** 协作式暂停标志：阻止“新任务”调度（§12.1），在途任务允许完成并归档 */
  requestPause() {
    this.pauseRequested = true;
  }
  /** 协作式停止标志：在途任务完成后不再调度任何新任务；迟到结果仅归档 */
  requestStop() {
    this.stopRequested = true;
    this.pauseRequested = true;
  }
  /** D-26：设置运行模式（auto=全自动；step=每步完成后暂停）。运行中可切换，下一步边界生效 */
  async setRunMode(mode) {
    if (isDiscussionTerminal(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5DF2\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u66F4\u6539\u8FD0\u884C\u6A21\u5F0F`);
    }
    if (this.disc.runMode !== mode) {
      this.disc.runMode = mode;
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "run_mode",
        mode,
        stage: this.disc.stage
      });
      await this.persist();
      this.log(`[\u6A21\u5F0F] \u8FD0\u884C\u6A21\u5F0F\u5207\u6362\u4E3A ${mode === "step" ? "\u5206\u6B65\uFF08\u6BCF\u6B65\u5B8C\u6210\u540E\u6682\u505C\uFF09" : "\u5168\u81EA\u52A8"}`);
    }
  }
  /* ---------- D-28：用户给特定 agent 发消息 ---------- */
  /**
   * D-28 附着式：记录用户给某参与者的补充指示，随其下一次任务提示词携带（零额外调用）。
   * participantId 传 "all" = 广播（每位参与者各存一份显式副本，逐人留痕）；
   * sticky=true = 持续携带（注入该参与者之后每一个任务提示词，直到讨论结束——需求变更场景）。
   */
  attachUserDirective(participantId, text, opts2) {
    if (isDiscussionTerminal(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5DF2\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u53D1\u9001\u6D88\u606F`);
    }
    const trimmed = text.trim();
    if (!trimmed) throw new Error("\u6D88\u606F\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
    const targets = participantId === "all" ? this.disc.participants.map((p) => p.participantId) : [participantId];
    for (const pid of targets) {
      const plan = this.disc.participants.find((p) => p.participantId === pid);
      if (!plan) throw new Error(`\u672A\u77E5\u53C2\u4E0E\u8005\uFF1A${pid}`);
      this.disc.userDirectives ??= {};
      (this.disc.userDirectives[pid] ??= []).push({
        text: trimmed,
        at: (/* @__PURE__ */ new Date()).toISOString(),
        ...opts2?.sticky ? { sticky: true } : {}
      });
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "user_directive_attached",
        participantId: pid,
        length: trimmed.length,
        sticky: opts2?.sticky === true,
        broadcast: participantId === "all"
      });
    }
    void this.persist().catch(() => {
    });
    this.log(
      `[\u7528\u6237\u6D88\u606F] \u5DF2\u8BB0\u5F55\u7ED9 ${participantId === "all" ? "\u5168\u90E8\u53C2\u4E0E\u8005" : participantId} \u7684\u8865\u5145\u6307\u793A\uFF08${trimmed.length} \u5B57${opts2?.sticky ? "\uFF0C\u6301\u7EED\u643A\u5E26" : "\uFF0C\u968F\u4E0B\u6B21\u4EFB\u52A1\u643A\u5E26"}\uFF09`
    );
  }
  /**
   * 取出某参与者待注入的指示并拼成提示词块：
   * 一次性指示取出即消费（injectedAt 留痕）；sticky 指示持续保留、每次任务都携带。
   */
  takeUserDirectives(participantId, phase, round, attemptId) {
    const all = this.disc.userDirectives?.[participantId] ?? [];
    const sticky = all.filter((d) => d.sticky === true);
    const oneShot = all.filter((d) => d.sticky !== true && !d.injectedAt);
    if (sticky.length === 0 && oneShot.length === 0) return "";
    const now = (/* @__PURE__ */ new Date()).toISOString();
    for (const d of oneShot) {
      d.injectedAt = now;
      d.carriedPhase = phase;
      d.carriedRound = round;
    }
    const block = [...sticky, ...oneShot].map((d) => `- ${d.text}`).join("\n");
    this.events.append({
      at: now,
      event: "user_directive_injected",
      participantId,
      attemptId,
      phase,
      round,
      count: oneShot.length,
      stickyCount: sticky.length
    });
    this.log(
      `[\u7528\u6237\u6D88\u606F] ${oneShot.length} \u6761\u4E00\u6B21\u6027 + ${sticky.length} \u6761\u6301\u7EED\u6307\u793A\u5DF2\u968F ${participantId} \u7684 ${phase} \u4EFB\u52A1\u643A\u5E26`
    );
    return `\u3010\u7528\u6237\u8865\u5145\u6307\u793A\uFF08\u8BA8\u8BBA\u8FDB\u884C\u4E2D\u7531\u7528\u6237\u53D1\u9001\u7ED9\u4F60\uFF1B\u672A\u7279\u522B\u6807\u6CE8\u7684\u5176\u4ED6\u53C2\u4E0E\u8005\u4E0D\u4F1A\u6536\u5230\uFF0C\u4E5F\u65E0\u9700\u5728\u4EA7\u51FA\u4E2D\u7279\u522B\u6807\u6CE8\u6765\u6E90\uFF09\u3011
${block}`;
  }
  /**
   * D-28 直发式：用户与单个 agent 单独对话一次（独立 prompt，回复归档）。
   * 不计额度（用户主动行为，D-28 例外于 BUD-01）；占并发槽；仅该参与者可见，全文留痕。
   */
  async directMessage(participantId, text, opts2 = {}) {
    if (isDiscussionTerminal(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5DF2\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u53D1\u9001\u6D88\u606F`);
    }
    const plan = this.disc.participants.find((p) => p.participantId === participantId);
    if (!plan) throw new Error(`\u672A\u77E5\u53C2\u4E0E\u8005\uFF1A${participantId}`);
    const trimmed = text.trim();
    if (!trimmed) throw new Error("\u6D88\u606F\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
    if ([...this.activeAttempts.values()].some((a) => a.participantId === participantId)) {
      throw new Error(`\u53C2\u4E0E\u8005 ${participantId} \u6B63\u5728\u6267\u884C\u4EFB\u52A1\uFF1A\u8BF7\u5148\u6682\u505C\u6216\u7B49\u5F85\u5176\u5B8C\u6210\u540E\u53D1\u9001`);
    }
    let handle = this.connections.get(participantId);
    if (!handle || handle.connectionClosed) {
      await this.connect();
      handle = this.connections.get(participantId);
      if (!handle || handle.connectionClosed) {
        throw new Error("\u8BE5\u53C2\u4E0E\u8005\u8FDE\u63A5\u5EFA\u7ACB\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u670D\u52A1\u65E5\u5FD7\u540E\u91CD\u8BD5");
      }
    }
    const appKey = plan.kind;
    const release = await this.slots.acquire(appKey);
    const attemptId = newId("attempt");
    const runner = this.controller.createRunner(participantId, handle);
    let resolveDone;
    const done = new Promise((resolve7) => {
      resolveDone = resolve7;
    });
    this.activeAttempts.set(attemptId, {
      attemptId,
      runner,
      participantId,
      phase: "user_message",
      round: 1,
      done,
      resolveDone
    });
    try {
      const resumeSessionId = this.disc.sessionReuse === true ? (this.disc.participantSessions ?? {})[participantId]?.sessionId : void 0;
      const header = opts2.broadcast ? `\u3010\u7528\u6237\u76F4\u63A5\u6D88\u606F\uFF08\u5E7F\u64AD\uFF1A\u540C\u4E00\u6587\u672C\u5DF2\u53D1\u7ED9\u5168\u4F53\u53C2\u4E0E\u8005\uFF0C\u4F60\u72EC\u7ACB\u56DE\u5E94\u5373\u53EF\uFF0C\u65E0\u9700\u590D\u8FF0\u6216\u8BC4\u4EF7\u4ED6\u4EBA\uFF09\u3011` : `\u3010\u7528\u6237\u76F4\u63A5\u6D88\u606F\uFF08\u4EC5\u4F60\u53EF\u89C1\uFF1B\u8FD9\u662F\u7528\u6237\u4E0E\u4F60\u7684\u5355\u72EC\u6C9F\u901A\uFF0C\u4E0D\u4F1A\u5206\u53D1\u7ED9\u5176\u4ED6\u53C2\u4E0E\u8005\uFF0C\u4E5F\u65E0\u9700\u5728\u4EA7\u51FA\u4E2D\u7279\u522B\u6807\u6CE8\u6765\u6E90\uFF09\u3011`;
      const prompt = `${header}

${trimmed}

\u8BF7\u76F4\u63A5\u56DE\u5E94\u7528\u6237\u8FD9\u6761\u6D88\u606F\u3002`;
      const rec = await runner.run({
        attemptId,
        prompt,
        resumeSessionId,
        round: 1,
        cwd: this.disc.cwd,
        inputVersion: `${this.disc.requirementVersion}+user-msg`,
        timeoutMs: TASK_TIMEOUT_MS,
        cancelGraceMs: CANCEL_GRACE_MS,
        beforePrompt: this.beforePromptFor(participantId)
      });
      if (rec.status !== "succeeded") {
        throw new Error(
          `\u6D88\u606F\u53D1\u9001\u672A\u6210\u529F\uFF08${rec.status}${rec.stopReason ? `(${rec.stopReason})` : ""}\uFF09\uFF1A\u672C\u6B21\u4E0D\u8BA1\u8BA8\u8BBA\u8D26\u672C\u989D\u5EA6\uFF1B\u771F\u5B9E\u8BA1\u8D39\u4EE5\u5404\u5E94\u7528\u5B9E\u9645\u7ED3\u7B97\u4E3A\u51C6\uFF0C\u53EF\u91CD\u8BD5`
        );
      }
      const reply = await this.extractAssistantText(attemptId);
      const seq = (this.disc.directMessages?.length ?? 0) + 1;
      const artifactPath = await this.writeArtifact(
        `user-message-${participantId}-${seq}.md`,
        `# \u7528\u6237\u76F4\u53D1\u6D88\u606F\uFF08${participantId}\uFF0C${(/* @__PURE__ */ new Date()).toISOString()}\uFF09

## \u7528\u6237\u6D88\u606F

${trimmed}

## \u56DE\u590D

${reply || "\uFF08\u65E0\u6587\u672C\u56DE\u590D\uFF09"}`
      );
      (this.disc.directMessages ??= []).push({
        participantId,
        text: trimmed,
        reply,
        attemptId,
        artifactPath,
        at: (/* @__PURE__ */ new Date()).toISOString()
      });
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "user_direct_message",
        participantId,
        attemptId,
        length: trimmed.length
      });
      await this.persist();
      this.log(`[\u7528\u6237\u6D88\u606F] \u76F4\u53D1 ${participantId} \u5B8C\u6210\uFF0C\u56DE\u590D ${reply.length} \u5B57\uFF08\u5DF2\u5F52\u6863\uFF0C\u4E0D\u8BA1\u989D\u5EA6\uFF09`);
      return { reply, artifactPath, attemptId };
    } finally {
      this.activeAttempts.delete(attemptId);
      resolveDone();
      release();
    }
  }
  /**
   * D-28 广播直发：同一文本并行直发给全部参与者，逐个回报成败——忙/连接失败只影响
   * 该参与者自己，不拖垮其他人。成功者按单发同口径归档产物 + directMessages 留痕，
   * 不计额度；提示词头标注广播语义（各自独立回应）。
   */
  async directMessageAll(text) {
    if (isDiscussionTerminal(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5DF2\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u53D1\u9001\u6D88\u606F`);
    }
    const trimmed = text.trim();
    if (!trimmed) throw new Error("\u6D88\u606F\u5185\u5BB9\u4E0D\u80FD\u4E3A\u7A7A");
    const targets = this.disc.participants.map((p) => p.participantId);
    if (!targets.length) throw new Error("\u8BA8\u8BBA\u6CA1\u6709\u53C2\u4E0E\u8005");
    return Promise.all(
      targets.map(async (participantId) => {
        try {
          const r = await this.directMessage(participantId, trimmed, { broadcast: true });
          return { participantId, ok: true, reply: r.reply };
        } catch (err) {
          return {
            participantId,
            ok: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      })
    );
  }
  /**
   * SYN-09 交叉终审（用户手动触发，非自动流程）：由非综合者的参与者对综合方案做一次独立审查。
   * 走修复额度（不足自动转追加池，BUD-03/08）；结果归档为产物并记录结论；可重复执行。
   */
  async finalReview(reviewerId) {
    if (isDiscussionTerminal(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5DF2\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u6267\u884C\u7EC8\u5BA1`);
    }
    if (!this.disc.synthesis) {
      throw new Error("\u8FD8\u6CA1\u6709\u7EFC\u5408\u4EA7\u7269\uFF1A\u7EC8\u5BA1\u5728\u7EFC\u5408\u5B8C\u6210\u540E\u53EF\u7528");
    }
    const candidates = this.disc.participants.filter((p) => p.participantId !== this.disc.synthesizerId);
    if (candidates.length === 0) {
      throw new Error("\u53EA\u6709\u4E00\u4F4D\u53C2\u4E0E\u8005\uFF0C\u6CA1\u6709\u53EF\u6267\u884C\u4EA4\u53C9\u7EC8\u5BA1\u7684\u53E6\u4E00\u65B9");
    }
    const reviewer = candidates.find((p) => p.participantId === reviewerId) ?? candidates[0];
    const participantId = reviewer.participantId;
    if (reviewerId && !candidates.some((p) => p.participantId === reviewerId)) {
      throw new Error(`\u7EC8\u5BA1\u8005\u5FC5\u987B\u662F\u7EFC\u5408\u8005\u4EE5\u5916\u7684\u53C2\u4E0E\u8005\uFF08\u7EFC\u5408\u8005=${this.disc.synthesizerId}\uFF09`);
    }
    if ([...this.activeAttempts.values()].some((a) => a.participantId === participantId)) {
      throw new Error(`\u53C2\u4E0E\u8005 ${participantId} \u6B63\u5728\u6267\u884C\u4EFB\u52A1\uFF1A\u8BF7\u7A0D\u540E\u518D\u8BD5`);
    }
    let handle = this.connections.get(participantId);
    if (!handle || handle.connectionClosed) {
      await this.connect();
      handle = this.connections.get(participantId);
      if (!handle || handle.connectionClosed) {
        throw new Error("\u7EC8\u5BA1\u8005\u8FDE\u63A5\u5EFA\u7ACB\u5931\u8D25\uFF0C\u8BF7\u67E5\u770B\u670D\u52A1\u65E5\u5FD7\u540E\u91CD\u8BD5");
      }
    }
    const release = await this.slots.acquire(reviewer.kind);
    const attemptId = newId("attempt");
    const runner = this.controller.createRunner(participantId, handle);
    let resolveDone;
    const done = new Promise((resolve7) => {
      resolveDone = resolve7;
    });
    this.activeAttempts.set(attemptId, {
      attemptId,
      runner,
      participantId,
      phase: "final_review",
      round: 1,
      done,
      resolveDone
    });
    try {
      let commitKind = "fix";
      if (!this.budget.canCommit("final_review", "fix") && this.budget.extraRemaining > 0) {
        commitKind = "extra";
      }
      try {
        this.budget.commit(attemptId, "final_review", participantId, () => (/* @__PURE__ */ new Date()).toISOString(), commitKind, 1);
        await this.persist();
      } catch (err) {
        if (err instanceof BudgetExhaustedError) {
          throw new Error(`\u989D\u5EA6\u4E0D\u8DB3\uFF1A\u7EC8\u5BA1\u9700 1 \u6B21\u4FEE\u590D\uFF08\u6216\u8FFD\u52A0\uFF09\u989D\u5EA6\u2014\u2014${err.message}`);
        }
        throw err;
      }
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "budget_commit",
        attemptId,
        phase: "final_review",
        participantId
      });
      const synth = this.disc.synthesis;
      const synthesisText = await fs3.readFile(synth.artifactPath, "utf8").catch(() => "\uFF08\u7EFC\u5408\u4EA7\u7269\u8BFB\u53D6\u5931\u8D25\uFF09");
      const resumeSessionId = this.disc.sessionReuse === true ? (this.disc.participantSessions ?? {})[participantId]?.sessionId : void 0;
      const prompt = `\u3010\u4EA4\u53C9\u7EC8\u5BA1\uFF08SYN-09\uFF09\uFF1A\u4F60\u662F\u672C\u6B21\u8BA8\u8BBA\u7684\u975E\u7EFC\u5408\u8005\uFF0C\u7528\u6237\u8BF7\u6C42\u4F60\u5BF9\u7EFC\u5408\u65B9\u6848\u505A\u4E00\u6B21\u72EC\u7ACB\u7EC8\u5BA1\u3011

\u9700\u6C42\u539F\u6587\uFF1A
${this.disc.requirementText}

\u7EFC\u5408\u65B9\u6848\uFF08\u7EFC\u5408\u8005 ${this.disc.synthesizerId}\uFF0C\u7248\u672C ${synth.version}\uFF09\uFF1A
${synthesisText}

\u8BF7\u4ECE\u4EE5\u4E0B\u89D2\u5EA6\u5BA1\u67E5\uFF1A
1. \u65B0\u589E\u8BBE\u8BA1\uFF1A\u7EFC\u5408\u4E2D\u6807\u6CE8\u300C\u65B0\u589E\u3001\u672A\u8BC4\u5BA1\u300D\u6216\u5176\u4ED6\u5E76\u975E\u6765\u81EA\u63D0\u6848/\u8BC4\u5BA1\u7684\u5185\u5BB9\uFF0C\u9010\u6761\u5224\u65AD\u662F\u5426\u6709\u4F9D\u636E\uFF1B
2. \u5206\u6B67\u4FDD\u7559\uFF1A\u8BA8\u8BBA\u4E2D\u7684\u5C11\u6570\u610F\u89C1\u4E0E\u672A\u89E3\u51B3\u5F85\u529E\u662F\u5426\u88AB\u5982\u5B9E\u4FDD\u7559\uFF1B
3. \u51B3\u7B56\u8986\u76D6\uFF1A\u5F85\u51B3\u7B56\u9879\u662F\u5426\u8986\u76D6\u63D0\u6848\u95F4\u7684\u5168\u90E8\u5B9E\u8D28\u5DEE\u5F02\uFF1B
4. \u9057\u6F0F\u98CE\u9669\uFF1A\u4F5C\u4E3A\u5B9E\u65BD\u4F9D\u636E\u8FD8\u6709\u4EC0\u4E48\u660E\u663E\u7F3A\u53E3\u3002

\u7B2C\u4E00\u884C\u6309\u6B64\u683C\u5F0F\u7ED9\u51FA\u7ED3\u8BBA\uFF1A\u7EC8\u5BA1\u7ED3\u8BBA: \u901A\u8FC7 | \u6709\u4FDD\u7559\u901A\u8FC7 | \u4E0D\u901A\u8FC7
\u968F\u540E\u9010\u6761\u5217\u51FA\u53D1\u73B0\uFF08\u7EA7\u522B\u3001\u63CF\u8FF0\u3001\u4F9D\u636E\uFF09\uFF1B\u6CA1\u6709\u53D1\u73B0\u4E5F\u8981\u8BF4\u660E\u68C0\u67E5\u4E86\u54EA\u4E9B\u65B9\u9762\u3002`;
      const rec = await runner.run({
        attemptId,
        prompt,
        resumeSessionId,
        round: 1,
        cwd: this.disc.cwd,
        inputVersion: `${this.disc.requirementVersion}+synthesis-${synth.version}+final-review`,
        timeoutMs: TASK_TIMEOUT_MS,
        cancelGraceMs: CANCEL_GRACE_MS,
        beforePrompt: this.beforePromptFor(participantId)
      });
      if (rec.status !== "succeeded") {
        throw new Error(
          `\u7EC8\u5BA1\u672A\u6210\u529F\uFF08${rec.status}${rec.stopReason ? `(${rec.stopReason})` : ""}\uFF09\uFF1A\u989D\u5EA6\u5DF2\u6D88\u8017\uFF0C\u53EF\u91CD\u8BD5`
        );
      }
      const text = await this.extractAssistantText(attemptId);
      const verdict = text.match(/终审结论[:：]\s*(通过|有保留通过|不通过)/)?.[1] ?? "\u672A\u6807\u6CE8";
      const seq = (this.disc.finalReviews?.length ?? 0) + 1;
      const artifactPath = await this.writeArtifact(
        `final-review-${participantId}-${seq}.md`,
        `# \u4EA4\u53C9\u7EC8\u5BA1\uFF08${participantId} \u2192 \u7EFC\u5408 ${synth.version}\uFF0C${(/* @__PURE__ */ new Date()).toISOString()}\uFF09

${text || "\uFF08\u65E0\u6587\u672C\u56DE\u590D\uFF09"}`
      );
      (this.disc.finalReviews ??= []).push({
        reviewer: participantId,
        attemptId,
        artifactPath,
        verdict,
        at: (/* @__PURE__ */ new Date()).toISOString()
      });
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "final_review",
        participantId,
        attemptId,
        verdict
      });
      await this.persist();
      this.log(`[\u7EC8\u5BA1] ${participantId} \u4EA4\u53C9\u7EC8\u5BA1\u5B8C\u6210\uFF1A${verdict}\uFF08\u5DF2\u5F52\u6863\uFF09`);
      return { reviewer: participantId, verdict, artifactPath, attemptId };
    } finally {
      this.activeAttempts.delete(attemptId);
      resolveDone();
      release();
    }
  }
  /**
   * BUD-08 额度追加：用户显式确认的超额支出授权（默认池耗尽后人主动继续时使用）。
   * 只扩授权池，不立即计费——实际消耗仍按提交尝试记账（kind=extra）。
   */
  async grantExtraBudget(n, reason = "\u7528\u6237\u786E\u8BA4\u8FFD\u52A0\uFF08BUD-08\uFF09") {
    if (!Number.isInteger(n) || n < 1 || n > 50) {
      throw new Error(`\u8FFD\u52A0\u989D\u5EA6\u987B\u4E3A 1-50 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${n}`);
    }
    this.disc.budget.extraTotal = (this.disc.budget.extraTotal ?? 0) + n;
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "budget_extend",
      amount: n,
      total: this.disc.budget.extraTotal,
      reason
    });
    await this.persist();
    this.log(`[\u989D\u5EA6] \u7528\u6237\u786E\u8BA4\u8FFD\u52A0 ${n} \u6B21\u989D\u5EA6\uFF08\u7D2F\u8BA1\u8FFD\u52A0 ${this.disc.budget.extraTotal}\uFF09`);
    return this.disc.budget.extraTotal;
  }
  /** D-27：是否可“直接综合”——全部提案完成、尚未综合、非终态且不在决策页 */
  canForceSynthesis() {
    return !isDiscussionTerminal(this.disc.stage) && this.disc.stage !== "awaiting_decisions" && !this.disc.synthesis && this.proposalsDone();
  }
  /** D-27：用户决定跳过剩余阶段（修订/复核/后续轮次）直接综合；在途任务先完成归档，下个阶段边界生效 */
  async requestSynthesis() {
    if (!this.canForceSynthesis()) {
      throw new Error("\u5F53\u524D\u72B6\u6001\u4E0D\u80FD\u76F4\u63A5\u7EFC\u5408\uFF08\u9700\u5168\u90E8\u63D0\u6848\u5B8C\u6210\u4E14\u5C1A\u672A\u7EFC\u5408\uFF09");
    }
    this.synthesisRequested = true;
    this.disc.synthesisForced = true;
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "synthesis_forced",
      stage: this.disc.stage
    });
    await this.persist();
    this.log("[\u7EFC\u5408] \u7528\u6237\u51B3\u5B9A\u8DF3\u8FC7\u5269\u4F59\u9636\u6BB5\uFF0C\u76F4\u63A5\u7EFC\u5408\uFF08\u5728\u9014\u4EFB\u52A1\u5B8C\u6210\u540E\u751F\u6548\uFF09");
  }
  /** D-29：开启一轮所需的正常额度（互评+修订+复核；N=1 自评为每轮 1 次修订） */
  roundCost() {
    return this.disc.participants.length === 1 ? 1 : this.disc.participants.length * 4;
  }
  /**
   * D-29：用户在轮次边界显式开启下一轮互评——动态抬高计划轮数（maxRounds），
   * 轮次门（round >= maxRounds 才设门）自然放行。总轮数硬上限 3（D-25）。
   * 预算校验：正常额度或追加额度须能覆盖该轮开销。
   */
  async armNextRound() {
    if (isDiscussionTerminal(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5DF2\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u5F00\u542F\u65B0\u8F6E\u6B21`);
    }
    const next = (this.disc.roundsCompleted ?? 0) + 1;
    if (next > 3) {
      throw new Error("\u5DF2\u8FBE\u8F6E\u6570\u4E0A\u9650 3\uFF08D-25\uFF09\uFF0C\u4E0D\u80FD\u5F00\u542F\u66F4\u591A\u8F6E\uFF1B\u53EF\u76F4\u63A5\u7EFC\u5408\u6216\u7ED3\u675F\u672C\u573A");
    }
    const cost = this.roundCost();
    if (!this.budget.allowsRoundCost(cost) && this.budget.extraRemaining < cost) {
      throw new Error(
        `\u9884\u7B97\u4E0D\u8DB3\u4EE5\u5F00\u542F\u7B2C ${next} \u8F6E\uFF08\u7EA6\u9700 ${cost} \u6B21\u989D\u5EA6\uFF0C\u6B63\u5E38\u989D\u5EA6\u4E0D\u8DB3\u4E14\u65E0\u8FFD\u52A0\u989D\u5EA6\uFF09\uFF1B\u53EF\u8FFD\u52A0\u989D\u5EA6\u540E\u91CD\u8BD5\uFF0C\u6216\u76F4\u63A5\u7EFC\u5408`
      );
    }
    const extended2 = next > this.disc.maxRounds;
    if (extended2) this.disc.maxRounds = next;
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "round_armed",
      round: next,
      cost,
      maxRounds: this.disc.maxRounds
    });
    await this.persist();
    this.log(
      `[\u8F6E\u6B21] \u7528\u6237\u5F00\u542F\u7B2C ${next} \u8F6E\u4E92\u8BC4\uFF08\u7EA6\u9700 ${cost} \u6B21\u989D\u5EA6\uFF09${extended2 ? `\u2014\u2014\u8BA1\u5212\u8F6E\u6570\u52A8\u6001\u6269\u5C55\u81F3 ${this.disc.maxRounds}` : ""}`
    );
  }
  /** 向所有在途尝试发 ACP session/cancel，等待核对窗口后统计取消确认情况 */
  async cancelInFlight() {
    const active = [...this.activeAttempts.values()];
    for (const a of active) a.runner.cancel(a.attemptId);
    if (active.length > 0) {
      await Promise.race([
        Promise.all(active.map((a) => a.done)),
        new Promise((resolve7) => {
          const timer = setTimeout(resolve7, CANCEL_GRACE_MS + 2e3);
          timer.unref();
        })
      ]);
    }
    let cancelled = 0;
    let unconfirmed = 0;
    const confirmed = /* @__PURE__ */ new Set(["succeeded", "failed", "cancelled_confirmed"]);
    for (const a of active) {
      const rec = this.controller.store.get(a.attemptId);
      if (rec?.status === "cancelled_confirmed") cancelled++;
      else if (!rec || !confirmed.has(rec.status)) unconfirmed++;
    }
    return { active: active.length, cancelled, unconfirmed };
  }
  /**
   * D-26 用户暂停（新语义）：立即向在途任务发 cancel，但讨论不结束——
   * 落 interrupted（可恢复，恢复=重调度未完成任务）。未确认终止计入 unconfirmed。
   */
  async interruptAndCancel(reason = "\u7528\u6237\u6682\u505C") {
    if (isDiscussionTerminal(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5DF2\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u518D\u6682\u505C\uFF08AC-46\uFF09`);
    }
    this.pauseRequested = true;
    const stats = await this.cancelInFlight();
    await this.markInterrupted(
      `${reason}\uFF08\u5728\u9014 ${stats.active}\uFF0C\u53D6\u6D88\u786E\u8BA4 ${stats.cancelled}\uFF0C\u672A\u786E\u8BA4 ${stats.unconfirmed}\uFF09`
    );
    return stats;
  }
  /**
   * D-26 用户结束：cancel 在途任务并关闭讨论（closed 终态，AC-46 不可重开）。
   * 未确认终止的在途任务计入 unconfirmed，不假报“已停止”。
   */
  async stopAndCancel(reason = "\u7528\u6237\u7ED3\u675F") {
    if (isDiscussionTerminal(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5DF2\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u505C\u6B62/\u91CD\u5F00\uFF08AC-46\uFF09`);
    }
    this.stopRequested = true;
    this.pauseRequested = true;
    const stats = await this.cancelInFlight();
    await this.markClosed(
      `${reason}\uFF08\u5728\u9014 ${stats.active}\uFF0C\u53D6\u6D88\u786E\u8BA4 ${stats.cancelled}\uFF0C\u672A\u786E\u8BA4 ${stats.unconfirmed}\uFF09`
    );
    return stats;
  }
  /** 阶段结束后检查停止请求；stopAndCancel 已落 closed 时不再重复 markClosed */
  async stopIfRequested() {
    if (!this.stopRequested) return false;
    if (this.disc.stage !== "closed") await this.markClosed("\u7528\u6237\u7ED3\u675F");
    return true;
  }
  get activeAttemptCount() {
    return this.activeAttempts.size;
  }
  /** 清除暂停标志（恢复调度；停止标志不可清除——终态语义） */
  clearPause() {
    this.pauseRequested = false;
  }
  /** D-26 用户暂停落盘：在途已发 cancel、讨论未结束（可恢复=重调度未完成任务） */
  async markInterrupted(reason) {
    if (isDiscussionTerminal(this.disc.stage) || this.disc.stage === "interrupted") return;
    if (this.disc.stage !== "paused") {
      this.disc.pausedFromStage = this.disc.stage === "checking" ? "awaiting_confirmation" : this.disc.stage;
    }
    this.disc.pauseKind = "user";
    this.disc.stage = "interrupted";
    this.disc.pauseReason = reason;
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "interrupted",
      reason,
      trigger: "user"
    });
    await this.persist();
    this.log(`[\u6682\u505C] ${reason}`);
  }
  /** 用户结束（D-26：closed 终态，AC-46）；外部任务可能仍在运行，迟到结果仅归档 */
  async markClosed(reason) {
    if (["completed", "stopped", "closed", "failed"].includes(this.disc.stage)) {
      throw new Error(`\u8BA8\u8BBA\u5DF2\u5904\u4E8E\u7EC8\u6001 ${this.disc.stage}\uFF0C\u4E0D\u80FD\u505C\u6B62/\u91CD\u5F00\uFF08AC-46\uFF09`);
    }
    this.disc.pausedFromStage = null;
    this.disc.pauseKind = null;
    this.disc.stage = "closed";
    this.disc.pauseReason = reason;
    this.events.append({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "closed", reason, trigger: "user" });
    await this.persist();
  }
  /** 不可恢复错误标记（运行时兜底；终态幂等） */
  async markFailed(reason) {
    if (isDiscussionTerminal(this.disc.stage)) return;
    this.disc.pausedFromStage = null;
    this.disc.pauseKind = null;
    this.disc.stage = "failed";
    this.disc.pauseReason = reason;
    this.events.append({ at: (/* @__PURE__ */ new Date()).toISOString(), event: "failed", reason });
    await this.persist().catch(() => {
    });
  }
  /** CLI --fix-retry：下一次提交改用修复额度（§9.5：重试由用户决定） */
  setNextCommitKindFix() {
    this.nextCommitKind = "fix";
  }
  closeAll() {
    this.controller.closeAll();
  }
};
async function findLedgerAnomalies(dataDir, record2) {
  const out = [];
  for (const entry of record2.budget.entries) {
    let rec;
    try {
      rec = await readJson(
        path7.join(dataDir, "attempts", `${entry.attemptId}.json`)
      );
    } catch (err) {
      out.push({
        attemptId: entry.attemptId,
        participantId: entry.participantId,
        phase: entry.phase,
        round: entry.round,
        kind: "corrupt",
        detail: `attempt \u8BB0\u5F55\u635F\u574F\uFF1A${String(err).slice(0, 120)}`,
        voidable: false
      });
      continue;
    }
    if (!rec) {
      out.push({
        attemptId: entry.attemptId,
        participantId: entry.participantId,
        phase: entry.phase,
        round: entry.round,
        kind: "missing",
        detail: "\u65E0 attempt \u8BB0\u5F55\uFF08\u672A\u8FDB\u5165\u63D0\u4EA4\uFF09",
        voidable: true
      });
    }
  }
  return out;
}
async function findUnconfirmedAttempts(dataDir, record2) {
  const confirmed = /* @__PURE__ */ new Set(["succeeded", "cancelled_confirmed", "failed"]);
  const out = [];
  for (const entry of record2.budget.entries) {
    let rec;
    try {
      rec = await readJson(
        path7.join(dataDir, "attempts", `${entry.attemptId}.json`)
      );
    } catch {
      out.push({
        attemptId: entry.attemptId,
        participantId: entry.participantId,
        phase: entry.phase,
        status: "\u8BB0\u5F55\u635F\u574F"
      });
      continue;
    }
    if (!rec) continue;
    if (!confirmed.has(rec.status)) {
      out.push({ attemptId: rec.id, participantId: entry.participantId, phase: entry.phase, status: rec.status });
    }
  }
  return out;
}
function inferResumeStage(record2) {
  if (record2.synthesis) return "awaiting_decisions";
  const participants = record2.participants;
  if (participants.length === 0) return "proposing";
  if (participants.some((p) => !record2.proposalVersions[p.participantId])) return "proposing";
  const round = Math.min(Math.max(1, (record2.roundsCompleted ?? 0) + 1), record2.maxRounds ?? 1);
  const reviewsDone = participants.length < 2 || participants.every(
    (p) => record2.reviewRelations.some(
      (r) => r.phase === "review" && r.valid && r.round === round && r.targetParticipant === p.participantId
    )
  );
  if (!reviewsDone) return "reviewing";
  const rels = record2.revisionRelations ?? [];
  const revisionsDone = participants.every((p) => {
    if (rels.length > 0) {
      return rels.some((r) => r.valid && r.round === round && r.participantId === p.participantId);
    }
    return record2.budget.entries.some(
      (e) => e.phase === "revision" && e.round === round && e.participantId === p.participantId
    );
  });
  if (!revisionsDone) return "responding";
  const rechecksDone = participants.length < 2 || participants.every(
    (p) => record2.recheckRelations.some(
      (r) => r.valid && r.round === round && r.reviewer === p.participantId
    )
  );
  if (!rechecksDone) return "rechecking";
  if ((record2.roundsCompleted ?? 0) < (record2.maxRounds ?? 1)) {
    return participants.length < 2 ? "responding" : "reviewing";
  }
  return "synthesizing";
}

// ../../super-agent-zcode/packages/orchestrator/src/finalize.ts
var DECISION_STATUSES = [
  "\u5F85\u51B3\u5B9A",
  "\u63A5\u53D7",
  "\u4FEE\u6539",
  "\u62D2\u7EDD",
  "\u6682\u7F13"
];
async function loadDiscussion(dataDir, discId) {
  const filePath = path8.join(dataDir, "discussions", discId, "discussion.json");
  const raw = await fs4.readFile(filePath, "utf8").catch(() => {
    throw new Error(`\u8BA8\u8BBA\u4E0D\u5B58\u5728\uFF1A${discId}`);
  });
  return migrateDiscussionRecord(JSON.parse(raw));
}
async function persistDiscussion(dataDir, record2) {
  record2.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeJsonAtomic(
    path8.join(dataDir, "discussions", record2.id, "discussion.json"),
    record2
  );
}
function applyDecisions(record2, inputs, now = () => (/* @__PURE__ */ new Date()).toISOString()) {
  let applied = 0;
  for (const input of inputs) {
    const item = record2.decisions.find((d) => d.id === input.id);
    if (!item) {
      throw new Error(`\u51B3\u7B56\u9879\u4E0D\u5B58\u5728\uFF1A${input.id}\uFF08\u53EF\u7528\uFF1A${record2.decisions.map((d) => d.id).join(", ")}\uFF09`);
    }
    if (!DECISION_STATUSES.includes(input.status)) {
      throw new Error(`\u975E\u6CD5\u51B3\u7B56\u72B6\u6001\uFF1A${input.status}\uFF08\u53EF\u7528\uFF1A${DECISION_STATUSES.join("/")}\uFF09`);
    }
    item.status = input.status;
    item.chosenOption = input.option ?? item.chosenOption;
    item.note = input.note ?? item.note;
    item.decidedAt = now();
    applied += 1;
  }
  record2.grade = computeGrade(record2);
  return applied;
}
function computeGrade(record2) {
  if (!record2.synthesis || record2.decisions.length === 0) return "\u8349\u7A3F";
  const accepted = record2.decisions.filter((d) => d.status === "\u63A5\u53D7").length;
  if (accepted === 0) return "\u8349\u7A3F";
  if (accepted < record2.decisions.length) return "\u90E8\u5206\u786E\u8BA4";
  return "\u5B8C\u6574\u786E\u8BA4";
}
function finalizeDiscussion(record2) {
  const accepted = record2.decisions.filter((d) => d.status === "\u63A5\u53D7").length;
  if (accepted === 0) {
    throw new Error("\u6CA1\u6709\u4EFB\u4F55\u5DF2\u63A5\u53D7\u7684\u51B3\u7B56\u9879\uFF1A\u4E0D\u80FD\u6807\u8BB0\u201C\u5DF2\u5B8C\u6210\u201D\uFF0C\u8BF7\u7528\u505C\u6B62\u6216\u4FDD\u6301\u5F85\u51B3\u7B56");
  }
  record2.stage = "completed";
  record2.grade = computeGrade(record2);
  return record2.grade;
}
function sectionOf(synthesisText, titlePrefix) {
  const lines = synthesisText.split("\n");
  const sections = /* @__PURE__ */ new Map();
  let current = null;
  for (const line of lines) {
    if (/^##\s+/.test(line)) {
      if (current) sections.set(current.title, current.body.join("\n").trim());
      current = { title: line.replace(/^##\s+/, "").trim(), body: [] };
    } else if (current) {
      current.body.push(line);
    }
  }
  if (current) sections.set(current.title, current.body.join("\n").trim());
  for (const [title, body] of sections) {
    if (title.startsWith(titlePrefix)) return body;
  }
  return null;
}
function buildFinalBrief(record2, synthesisText) {
  const keep = (prefix, fallback) => sectionOf(synthesisText, prefix) ?? fallback;
  const undecided = record2.decisions.filter((d) => d.status === "\u5F85\u51B3\u5B9A").length;
  const lines = [];
  lines.push(`# \u6267\u884C\u8F93\u5165\uFF08\u6700\u7EC8\u5B9E\u65BD\u65B9\u6848\uFF09`);
  lines.push("");
  lines.push(
    `> \u672C\u6587\u4EF6\u7531\u7CFB\u7EDF\u81EA\u52A8\u88C5\u914D\uFF1A\u7EFC\u5408\u65B9\u6848 + \u7528\u6237\u9010\u9879\u51B3\u7B56 \u2192 \u6267\u884C\u65B9\u8F93\u5165\u3002\u8FC7\u7A0B\u6750\u6599\uFF08\u5DEE\u5F02\u8868\u3001\u8BC4\u5BA1\u4E0E\u5206\u6B67\uFF09\u89C1\u7EFC\u5408\u65B9\u6848\u539F\u6587\uFF1B\u91CD\u65B0\u5E94\u7528\u51B3\u7B56\u4F1A\u66F4\u65B0\u672C\u6587\u4EF6\u3002`
  );
  lines.push("");
  lines.push("## \u9700\u6C42\uFF08\u4E0D\u53EF\u53D8\u5FEB\u7167\uFF09");
  lines.push("");
  lines.push(record2.requirementText);
  lines.push("");
  lines.push("## \u51B3\u7B56\u88C1\u5B9A\uFF08\u7528\u6237\u5DF2\u786E\u8BA4\uFF09");
  lines.push("");
  lines.push("| # | \u51B3\u7B56 | \u9009\u5B9A | \u72B6\u6001 |");
  lines.push("| --- | --- | --- | --- |");
  for (const d of record2.decisions) {
    lines.push(
      `| ${d.id} | ${md(d.content)} | ${md(d.chosenOption ?? d.note)} | ${d.status === "\u63A5\u53D7" ? "\u2705 \u5DF2\u88C1\u5B9A" : `\u26A0\uFE0F ${d.status}`} |`
    );
  }
  lines.push("");
  if (undecided > 0) {
    lines.push(`> \u26A0\uFE0F \u5C1A\u6709 ${undecided} \u9879\u672A\u88C1\u5B9A\u2014\u2014\u6267\u884C\u524D\u8BF7\u5148\u786E\u8BA4\u3002`);
    lines.push("");
  }
  const summary = sectionOf(synthesisText, "\u7EFC\u5408\u6458\u8981");
  if (summary) {
    lines.push("## \u7EFC\u5408\u6458\u8981");
    lines.push("");
    lines.push(summary);
    lines.push("");
  }
  lines.push("## \u63A8\u8350\u65B9\u6848\uFF08\u542B\u5DF2\u88C1\u5B9A\u7684\u5907\u9009\uFF09");
  lines.push("");
  lines.push(keep("\u63A8\u8350\u65B9\u6848", "\uFF08\u7EFC\u5408\u65B9\u6848\u672A\u5305\u542B\u6B64\u8282\uFF09"));
  lines.push("");
  lines.push(keep("\u63A5\u53E3", "\uFF08\u7EFC\u5408\u65B9\u6848\u672A\u5305\u542B\u63A5\u53E3\u8282\uFF09"));
  lines.push("");
  lines.push("## \u5B9E\u65BD\u6E05\u5355\u4E0E\u9A8C\u6536");
  lines.push("");
  lines.push(keep("\u5B9E\u65BD\u6E05\u5355", "\uFF08\u7EFC\u5408\u65B9\u6848\u672A\u5305\u542B\u6B64\u8282\uFF09"));
  lines.push("");
  lines.push("## \u98CE\u9669\u3001\u5047\u8BBE\u4E0E\u672A\u9A8C\u8BC1\u4E8B\u5B9E\uFF08\u5B9E\u65BD\u524D\u8BF7\u786E\u8BA4\uFF09");
  lines.push("");
  lines.push(keep("\u98CE\u9669", "\uFF08\u7EFC\u5408\u65B9\u6848\u672A\u5305\u542B\u6B64\u8282\uFF09"));
  lines.push("");
  lines.push("---");
  lines.push("");
  lines.push("\u6267\u884C\u63D0\u793A\uFF1A\u672C\u6587\u4EF6\u662F\u8FD9\u573A\u8BA8\u8BBA\u7684\u6700\u7EC8\u8F93\u51FA\uFF0C\u53EF\u76F4\u63A5\u4F5C\u4E3A\u5B9E\u65BD\u4EFB\u52A1\u4E66\u4EA4\u7ED9\u6267\u884C\u65B9\uFF08\u628A\u65B9\u6848\u53D8\u4E3A\u4EE3\u7801\u662F\u53E6\u4E00\u6B21\u7528\u6237\u53D1\u8D77\u7684\u884C\u4E3A\uFF09\u3002");
  return lines.join("\n");
}
async function regenerateFinalBrief(dataDir, record2) {
  if (!record2.synthesis) return null;
  const synthesisRaw = await fs4.readFile(record2.synthesis.artifactPath, "utf8").catch(() => null);
  if (synthesisRaw === null) return null;
  const briefPath = path8.join(
    dataDir,
    "discussions",
    record2.id,
    "artifacts",
    "final-brief.md"
  );
  await fs4.mkdir(path8.dirname(briefPath), { recursive: true });
  await fs4.writeFile(briefPath, buildFinalBrief(record2, synthesisRaw), "utf8");
  return briefPath;
}
async function exportMarkdown(dataDir, record2, outPath) {
  const discDir = path8.join(dataDir, "discussions", record2.id);
  const target = outPath ? path8.resolve(outPath) : path8.join(discDir, "export.md");
  await fs4.mkdir(path8.dirname(target), { recursive: true });
  await fs4.writeFile(target, buildExportMarkdown(record2), "utf8");
  return target;
}
function buildExportMarkdown(record2) {
  const [a, b] = record2.participants;
  const lines = [];
  lines.push(`# Super Agent \u8BA8\u8BBA\u5BFC\u51FA\uFF1A${record2.id}`);
  lines.push("");
  lines.push(`- \u751F\u6210\u65F6\u95F4\uFF1A${(/* @__PURE__ */ new Date()).toISOString()}\uFF08\u5BFC\u51FA\u4E0D\u6539\u53D8\u8BA8\u8BBA\u72B6\u6001\uFF0CSYN-08\uFF09`);
  lines.push(`- \u8BA8\u8BBA\u72B6\u6001\uFF1A${record2.stage}\uFF1B\u4EA7\u7269\u7B49\u7EA7\uFF1A${record2.grade ?? "\u672A\u8BC4\u7EA7"}\uFF1B\u9700\u6C42\u7248\u672C\uFF1A${record2.requirementVersion}`);
  lines.push(
    `- \u53C2\u4E0E\u8005\uFF1A${record2.participants.map((p) => p.participantId + "=" + p.kind).join("\u3001")}\uFF1B\u7EFC\u5408\u8005\uFF1A${record2.synthesis?.synthesizer ?? "\u672A\u7EFC\u5408"}`
  );
  lines.push(`- \u9879\u76EE\u76EE\u5F55\uFF1A${record2.cwd}`);
  lines.push(
    `- \u4EA7\u7269\u7B49\u7EA7\u53E3\u5F84\uFF1A${record2.grade === "\u5B8C\u6574\u786E\u8BA4" ? "\u5168\u90E8\u51B3\u7B56\u9879\u5DF2\u63A5\u53D7" : record2.grade === "\u90E8\u5206\u786E\u8BA4" ? "\u6709\u63A5\u53D7\u9879\uFF0C\u4F46\u4ECD\u6709\u672A\u63A5\u53D7\u9879\uFF08\u4FEE\u6539/\u62D2\u7EDD/\u6682\u7F13/\u5F85\u51B3\u5B9A\uFF09\u2014\u2014\u4E0D\u6807\u6CE8\u5B8C\u6574\u786E\u8BA4" : "\u65E0\u7EFC\u5408\u6216\u65E0\u63A5\u53D7\u9879"}`
  );
  lines.push("");
  lines.push("## \u9700\u6C42\uFF08\u4E0D\u53EF\u53D8\u5FEB\u7167\uFF09");
  lines.push("");
  lines.push(record2.requirementText);
  lines.push("");
  lines.push("## \u4EA7\u7269\u7D22\u5F15");
  lines.push("");
  lines.push("| \u9636\u6BB5 | \u53C2\u4E0E\u8005 | \u7248\u672C | \u6587\u4EF6 |");
  lines.push("| --- | --- | --- | --- |");
  for (const p of record2.participants) {
    const v = record2.proposalVersions[p.participantId];
    if (v) lines.push(`| \u63D0\u6848 | ${p.participantId} | ${v} | artifacts/proposal-${p.participantId}-${v}.md |`);
    const rv = record2.responseVersions[p.participantId];
    if (rv) lines.push(`| \u56DE\u5E94/\u4FEE\u8BA2 | ${p.participantId} | ${rv} | artifacts/revision-${p.participantId}-${rv}.md |`);
  }
  for (const r of record2.reviewRelations) {
    lines.push(`| \u4E92\u8BC4\uFF08${r.reviewer}\u2192${r.targetParticipant}\uFF09 | ${r.reviewer} | ${r.targetVersion} | ${relPath(r.artifactPath)} |`);
  }
  for (const r of record2.recheckRelations) {
    lines.push(`| \u590D\u6838\uFF08${r.reviewer}\u2192${r.targetParticipant}\uFF09 | ${r.reviewer} | ${r.targetVersion} | ${relPath(r.artifactPath)} |`);
  }
  if (record2.synthesis) {
    lines.push(`| \u7EFC\u5408 | ${record2.synthesis.synthesizer} | ${record2.synthesis.version} | ${relPath(record2.synthesis.artifactPath)} |`);
  }
  lines.push("");
  if (record2.synthesis) {
    lines.push("## \u7EFC\u5408\u65B9\u6848");
    lines.push("");
    lines.push(`- \u8F93\u5165\u7248\u672C\uFF1A${record2.synthesis.inputVersions.map((i) => `${i.participantId}@${i.version}`).join("\u3001")}\uFF08SYN-01 \u56FA\u5B9A\uFF09`);
    lines.push(
      `- \u65B0\u589E\u8BBE\u8BA1\u6807\u6CE8\uFF1A${record2.synthesis.newDesignFlagged ? "\u5DF2\u6807\u6CE8" : "\u26A0\uFE0F \u7EFC\u5408\u6587\u672C\u672A\u51FA\u73B0\u300C\uFF08\u65B0\u589E\uFF0C\u672A\u8BC4\u5BA1\uFF09\u300D\u6807\u6CE8\u2014\u2014\u8BF7\u4EBA\u5DE5\u6838\u5BF9\u7EFC\u5408\u65B9\u6848\u4E2D\u7684\u65B0\u589E\u5185\u5BB9"}`
    );
    lines.push("");
    lines.push("## \u5F85\u51B3\u7B56\u9879\uFF08SYN-06\uFF1A\u9010\u9879\u786E\u8BA4\uFF09");
    lines.push("");
    lines.push("| ID | \u5185\u5BB9 | \u5907\u9009 | \u9009\u5B9A | \u7406\u7531 | \u6765\u6E90 | \u72B6\u6001 | \u5907\u6CE8 |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
    for (const d of record2.decisions) {
      lines.push(
        `| ${d.id} | ${md(d.content)} | ${md(d.alternatives)} | ${md(d.chosenOption)} | ${md(d.rationale)} | ${md(d.source)} | ${d.status} | ${md(d.note)} |`
      );
    }
    const undecided = record2.decisions.filter((d) => d.status === "\u5F85\u51B3\u5B9A").length;
    lines.push("");
    lines.push(`\u672A\u51B3\u7B56\u9879\uFF1A${undecided}\u3002\u90E8\u5206\u63A5\u53D7\u4E0D\u9ED8\u8BA4\u901A\u8FC7\u5176\u4ED6\u9879\u3002`);
  } else {
    lines.push("## \u7EFC\u5408\u65B9\u6848");
    lines.push("");
    lines.push("\u672A\u751F\u6210\u7EFC\u5408\u65B9\u6848\uFF08\u5BFC\u51FA\u4E3A\u672A\u7EFC\u5408\u8349\u7A3F\uFF0C\u4E0D\u662F\u6210\u529F\u95ED\u73AF\uFF09\u3002");
  }
  const voided = record2.budget.voidedEntries ?? [];
  if (voided.length > 0) {
    lines.push("");
    lines.push("## \u4F5C\u5E9F\u989D\u5EA6\uFF08\u5BA1\u8BA1\uFF1A\u6709\u8BB0\u8D26\u3001\u65E0 attempt \u8BB0\u5F55\uFF0C\u7528\u6237\u786E\u8BA4\u672A\u63D0\u4EA4\uFF09");
    lines.push("");
    lines.push("| \u5C1D\u8BD5 | \u53C2\u4E0E\u8005 | \u9636\u6BB5 | \u8F6E\u6B21 | \u4F5C\u5E9F\u65F6\u95F4 | \u539F\u56E0 |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    for (const v of voided) {
      lines.push(
        `| ${v.attemptId} | ${v.participantId} | ${v.phase} | ${v.round} | ${v.voidedAt} | ${md(v.voidedReason)} |`
      );
    }
  }
  if (record2.openIssues.length > 0) {
    lines.push("");
    lines.push("## \u672A\u89E3\u51B3\u95EE\u9898\u4E0E\u5F85\u529E\uFF08\u4FDD\u7559\uFF0C\u4E0D\u9690\u85CF\uFF09");
    lines.push("");
    for (const issue2 of record2.openIssues) lines.push(`- ${issue2}`);
  }
  lines.push("");
  lines.push("## \u8FB9\u754C\u58F0\u660E");
  lines.push("");
  lines.push("- \u4E8B\u5B9E\u4E89\u8BAE\u4E0D\u6295\u7968\u88C1\u5B9A\uFF1A\u65E0\u8BC1\u636E\u7684\u76F8\u53CD\u5224\u65AD\u4FDD\u6301\u300C\u672A\u9A8C\u8BC1\u300D\uFF1B\u98CE\u9669\u63A5\u53D7\u4E0D\u6539\u53D8\u4E8B\u5B9E\u72B6\u6001\u3002");
  lines.push("- \u672C\u5BFC\u51FA\u4EC5\u4E3A\u65B9\u6848\u6587\u6863\uFF1A\u4E0D\u4FEE\u6539\u4E1A\u52A1\u4EE3\u7801\u3001\u4E0D\u521B\u5EFA\u5B9E\u65BD\u4EFB\u52A1\uFF1B\u628A\u7ED3\u679C\u4EA4\u7ED9\u67D0\u4E2A Agent \u5B9E\u65BD\u662F\u53E6\u4E00\u6B21\u7528\u6237\u53D1\u8D77\u7684\u884C\u4E3A\u3002");
  lines.push("- \u5404\u9636\u6BB5\u539F\u6587\u4EE5 artifacts/ \u4E0B\u7684\u6587\u4EF6\u4E0E data/raw-wire/ \u7EBF\u8DEF\u65E5\u5FD7\u4E3A\u51C6\uFF0C\u672C\u5BFC\u51FA\u4E0D\u66FF\u6362\u539F\u6587\u3002");
  return lines.join("\n");
}
function relPath(artifactPath) {
  const idx = artifactPath.indexOf("artifacts");
  return idx >= 0 ? artifactPath.slice(idx) : artifactPath;
}
function md(value) {
  if (!value) return "";
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

// ../../super-agent-zcode/packages/orchestrator/src/sensitive.ts
var SENSITIVE_PATTERNS = [
  ["API \u5BC6\u94A5\u6837\u4F8B\uFF08sk-/pk-/rk-\uFF09", /\b(?:sk|pk|rk)-[A-Za-z0-9]{16,}\b/],
  ["\u79C1\u94A5\u5757", /BEGIN\s+(?:RSA\s+|EC\s+|OPENSSH\s+)?PRIVATE\s+KEY/],
  ["AWS \u8BBF\u95EE\u5BC6\u94A5", /\bAKIA[0-9A-Z]{16}\b/],
  ["\u8FDE\u63A5\u4E32\u5185\u5D4C\u51ED\u636E", /:\/\/[^/\s:]+:[^/\s@]+@/],
  ["password/secret/token \u8D4B\u503C", /\b(?:password|passwd|secret|token)\s*[:=]\s*["'][^"']{6,}["']/i]
];
function scanSensitive(text) {
  return SENSITIVE_PATTERNS.filter(([, re]) => re.test(text)).map(([name]) => name);
}

// ../../super-agent-zcode/packages/orchestrator/src/templates.ts
var BUILTIN_TEMPLATES = [
  {
    id: "standard-review",
    name: "\u6807\u51C6\u65B9\u6848\u8BC4\u5BA1",
    description: "\u4E24\u6B3E\u4E0D\u540C\u5E94\u7528\u5404\u81EA\u63D0\u6848\u3001\u4E92\u8BC4\u3001\u4FEE\u8BA2\u540E\u7EFC\u5408\uFF1B\u9760\u5E94\u7528\u5DEE\u5F02\u4EA7\u51FA\u5206\u6B67\u3002\u6700\u5E38\u7528\u7684\u9ED8\u8BA4\u6253\u6CD5\u3002",
    participants: [{ kind: "codex-acp" }, { kind: "dsh" }],
    rounds: 1,
    runMode: "auto"
  },
  {
    id: "deep-adversarial",
    name: "\u6DF1\u5EA6\u5BF9\u6297",
    description: "\u4E24\u65B9\u5E26\u5BF9\u7ACB\u89D2\u8272\uFF0C2 \u8F6E\u4E92\u8BC4\u4FEE\u8BA2\uFF0C\u5206\u6B65\u63A8\u8FDB\u2014\u2014\u9002\u5408\u652F\u4ED8\u3001\u6743\u9650\u3001\u6570\u636E\u8FC1\u79FB\u7B49\u9AD8\u98CE\u9669\u51B3\u7B56\u3002",
    participants: [
      {
        kind: "codex-acp",
        role: "\u4F60\u5728\u4FDD\u8BC1\u53EF\u9760\u6027\u7684\u524D\u63D0\u4E0B\u8BC4\u5BA1\u65B9\u6848\uFF1A\u4F18\u5148\u5BA1\u89C6\u8FB9\u754C\u6761\u4EF6\u3001\u5931\u8D25\u8DEF\u5F84\u3001\u5B89\u5168\u4E0E\u56DE\u9000\u7B56\u7565\uFF1B\u5BF9\u672A\u9A8C\u8BC1\u4E8B\u5B9E\u4FDD\u6301\u6000\u7591\uFF0C\u5B81\u53EF\u63A8\u7FFB\u4E5F\u4E0D\u653E\u8FC7\u9690\u60A3\u3002"
      },
      {
        kind: "dsh",
        role: "\u4F60\u5728\u4FDD\u8BC1\u4EA4\u4ED8\u901F\u5EA6\u7684\u524D\u63D0\u4E0B\u8BC4\u5BA1\u65B9\u6848\uFF1A\u4F18\u5148\u5BA1\u89C6\u6700\u5C0F\u5B9E\u73B0\u3001\u53EF\u88C1\u526A\u8303\u56F4\u4E0E\u5EF6\u540E\u4EE3\u4EF7\uFF1B\u6562\u4E8E\u63D0\u51FA\u780D\u9700\u6C42\u7684\u53CD\u63D0\u6848\u3002"
      }
    ],
    rounds: 2,
    runMode: "step"
  },
  {
    id: "brainstorm",
    name: "\u5934\u8111\u98CE\u66B4",
    description: "\u4E09\u4E2A\u540C\u5E94\u7528\u5B9E\u4F8B\u5E26\u4E0D\u540C\u804C\u8D23\u5206\u6B65\u53D1\u6563\uFF0C\u770B\u5B8C\u5168\u90E8\u6B65\u9AA4\u540E\u518D\u51B3\u5B9A\u7EFC\u5408\u6216\u52A0\u4E00\u8F6E\u3002",
    participants: [
      {
        kind: "codex-acp",
        role: "\u4F60\u7684\u804C\u8D23\u662F\u53D1\u6563\uFF1A\u63D0\u51FA\u4E0E\u4E3B\u6D41\u601D\u8DEF\u4E0D\u540C\u7684\u65B0\u89D2\u5EA6\uFF0C\u5B81\u53EF\u5927\u80C6\u4E0D\u53EF\u5E73\u5EB8\uFF1B\u6BCF\u4E2A\u89D2\u5EA6\u9644\u4E00\u53E5\u4E3A\u4EC0\u4E48\u503C\u5F97\u8BD5\u3002"
      },
      {
        kind: "codex-acp",
        role: "\u4F60\u7684\u804C\u8D23\u662F\u6311\u523A\uFF1A\u53EA\u627E\u6F0F\u6D1E\u4E0E\u9690\u60A3\uFF0C\u4E0D\u7ED9\u51FA\u66FF\u4EE3\u65B9\u6848\uFF1B\u6BCF\u4E2A\u95EE\u9898\u6CE8\u660E\u4E25\u91CD\u7A0B\u5EA6\u3002"
      },
      {
        kind: "codex-acp",
        role: "\u4F60\u7684\u804C\u8D23\u662F\u843D\u5730\uFF1A\u628A\u4E00\u5207\u60F3\u6CD5\u6536\u655B\u6210\u53EF\u6267\u884C\u7684\u4E0B\u4E00\u6B65\uFF0C\u6807\u6CE8\u5DE5\u4F5C\u91CF\u4E0E\u4F9D\u8D56\u3002"
      }
    ],
    rounds: 1,
    runMode: "step"
  },
  {
    id: "code-review",
    name: "\u4EE3\u7801\u8BC4\u5BA1",
    description: "\u5BF9\u65E2\u6709\u5B9E\u73B0\u505A\u5BA1\u67E5\uFF1A\u9879\u76EE\u76EE\u5F55\u6307\u5411\u4EE3\u7801\uFF0Ccodex \u4FA7 read-only \u5199\u4FDD\u62A4\u4E0D\u53D8\u3002",
    participants: [
      {
        kind: "codex-acp",
        role: "\u4F60\u4E13\u6CE8\u4E8E\u5B89\u5168\u4E0E\u6B63\u786E\u6027\uFF1A\u6CE8\u5165\u3001\u8D8A\u6743\u3001\u5E76\u53D1\u3001\u9519\u8BEF\u5904\u7406\u4E0E\u8FB9\u754C\u6761\u4EF6\uFF1B\u7ED3\u8BBA\u5FC5\u987B\u5F15\u7528\u5177\u4F53\u4EE3\u7801\u4F4D\u7F6E\u4F5C\u4E3A\u8BC1\u636E\u3002"
      },
      {
        kind: "dsh",
        role: "\u4F60\u4E13\u6CE8\u4E8E\u6027\u80FD\u4E0E\u53EF\u7EF4\u62A4\u6027\uFF1A\u70ED\u70B9\u8DEF\u5F84\u3001\u91CD\u590D\u4EE3\u7801\u3001\u547D\u540D\u4E0E\u7ED3\u6784\uFF1B\u6BCF\u6761\u5EFA\u8BAE\u9644\u6539\u52A8\u91CF\u8BC4\u4F30\u3002"
      }
    ],
    rounds: 1,
    runMode: "auto"
  },
  {
    id: "quick-self",
    name: "\u5FEB\u901F\u81EA\u8BC4",
    description: "\u5355\u4E2A\u5E94\u7528\u81EA\u8BC4\u6A21\u5F0F\uFF08\u63D0\u6848\u2192\u81EA\u8BC4\u4FEE\u8BA2\u2192\u7EFC\u5408\uFF09\uFF0C\u6700\u7701\u989D\u5EA6\uFF08\u7EA6 3 \u6B21\uFF09\u2014\u2014\u5199\u5B8C\u9700\u6C42\u6216\u65B9\u6848\u5148\u5FEB\u901F\u6311\u4E00\u904D\u6BDB\u75C5\u3002",
    participants: [{ kind: "codex-acp" }],
    rounds: 1,
    runMode: "auto"
  }
];

// ../../super-agent-zcode/packages/orchestrator/src/group.ts
import * as fs5 from "node:fs/promises";
import * as path9 from "node:path";
var TASK_TIMEOUT_MS2 = 10 * 6e4;
var CANCEL_GRACE_MS2 = 8e3;
var GROUP_MEMBER_LIMIT = 8;
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function parseMentions(text, labels) {
  const out = /* @__PURE__ */ new Set();
  for (const label of labels) {
    if (!label) continue;
    const re = new RegExp(`@${escapeRegExp(label)}(?![\\w\\u4e00-\\u9fff-])`);
    if (re.test(text)) out.add(label);
  }
  return [...out];
}
function buildMember(appId, n, input, now) {
  const episodeId = `${appId}#${n}`;
  return {
    episodeId,
    appId,
    label: input.label?.trim() || `${appId}#${n}`,
    env: input.env,
    role: input.role?.trim() || null,
    joinedAt: now,
    leftAt: null,
    leftReason: null,
    needsReview: false,
    sessionId: null,
    connectionId: null,
    lastSeenSeq: 0,
    config: null
  };
}
function createGroupRecord(input) {
  const now = (/* @__PURE__ */ new Date()).toISOString();
  const name = input.name.trim();
  if (!name) throw new Error("\u7FA4\u540D\u79F0\u4E0D\u80FD\u4E3A\u7A7A");
  if (!input.cwd.trim()) throw new Error("\u7FA4\u5FC5\u987B\u7ED1\u5B9A\u4E00\u4E2A\u6587\u4EF6\u5939\uFF08cwd\uFF09");
  const members2 = [];
  const nextEpisode = {};
  for (const m of input.members ?? []) {
    const n = (nextEpisode[m.appId] ?? 0) + 1;
    nextEpisode[m.appId] = n;
    members2.push(buildMember(m.appId, n, m, now));
  }
  validateLabels(members2);
  return {
    id: newId("group"),
    name,
    cwd: input.cwd,
    createdAt: now,
    updatedAt: now,
    settings: {
      maxComboDepth: input.settings?.maxComboDepth ?? 2,
      maxCascadeTurns: input.settings?.maxCascadeTurns ?? 12
    },
    members: members2,
    nextEpisode,
    messageSeq: 0,
    closedAt: null
  };
}
function validateLabels(members2) {
  const seen = /* @__PURE__ */ new Set();
  for (const m of members2) {
    if (seen.has(m.label)) throw new Error(`\u6210\u5458\u663E\u793A\u540D\u91CD\u590D\uFF1A${m.label}`);
    seen.add(m.label);
  }
}
function migrateGroupRecord(record2) {
  record2.settings ??= { maxComboDepth: 2, maxCascadeTurns: 12 };
  if (!Number.isInteger(record2.settings.maxComboDepth) || record2.settings.maxComboDepth < 1) {
    record2.settings.maxComboDepth = 2;
  }
  if (!Number.isInteger(record2.settings.maxCascadeTurns) || record2.settings.maxCascadeTurns < 1) {
    record2.settings.maxCascadeTurns = 12;
  }
  record2.members ??= [];
  for (const m of record2.members) {
    m.leftAt ??= null;
    m.leftReason ??= null;
    m.needsReview ??= false;
    m.sessionId ??= null;
    m.connectionId ??= null;
    m.lastSeenSeq ??= 0;
    m.config ??= null;
  }
  record2.nextEpisode ??= {};
  if (!Number.isInteger(record2.messageSeq)) record2.messageSeq = 0;
  record2.closedAt ??= null;
  return record2;
}
function groupDirOf(dataDir, groupId) {
  return path9.join(dataDir, "groups", groupId);
}
async function loadGroup(dataDir, groupId) {
  const filePath = path9.join(groupDirOf(dataDir, groupId), "group.json");
  const raw = await readJson(filePath);
  if (!raw) throw new Error(`\u7FA4\u4E0D\u5B58\u5728\uFF1A${groupId}`);
  return migrateGroupRecord(raw);
}
async function persistGroup(dataDir, record2) {
  record2.updatedAt = (/* @__PURE__ */ new Date()).toISOString();
  await writeJsonAtomic(path9.join(groupDirOf(dataDir, record2.id), "group.json"), record2);
}
async function readJsonl(filePath) {
  const raw = await fs5.readFile(filePath, "utf8").catch(() => "");
  const out = [];
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (t) out.push(JSON.parse(t));
  }
  return out;
}
async function listGroups(dataDir) {
  const root = path9.join(dataDir, "groups");
  const entries = await fs5.readdir(root).catch(() => []);
  const out = [];
  for (const id of entries) {
    const rec = await readJson(path9.join(root, id, "group.json")).catch(() => null);
    if (rec) out.push(migrateGroupRecord(rec));
  }
  out.sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1);
  return out;
}
function renderBoard(msgs) {
  if (msgs.length === 0) return "\uFF08\u7248\u9762\u4E3A\u7A7A\uFF09";
  return msgs.map((m) => {
    const who = m.author.kind === "user" ? m.author.via ? `\u7528\u6237\uFF08\u7ECF ${m.author.via}\uFF09` : "\u7528\u6237" : m.author.kind === "system" ? "\u7CFB\u7EDF" : `\u300C${m.author.label ?? m.author.episodeId}\u300D`;
    const stale = m.stale ? "\u3014\u8BE5\u56DE\u590D\u57FA\u4E8E\u65E7\u7248\u9762\u3015" : "";
    return `#${m.seq} ${who}\uFF1A${m.text}${stale}`;
  }).join("\n");
}
var DELTA_FOLD_THRESHOLD = 30;
var DELTA_FOLD_TAIL = 10;
function foldDelta(delta, opts2) {
  const tail = opts2.tail ?? DELTA_FOLD_TAIL;
  const start = delta[0].seq;
  const end = delta[delta.length - 1].seq;
  const counts = /* @__PURE__ */ new Map();
  for (const m of delta) {
    const who = m.author.kind === "user" ? m.author.via ? `\u7528\u6237\uFF08\u7ECF ${m.author.via}\uFF09` : "\u7528\u6237" : m.author.kind === "system" ? "\u7CFB\u7EDF" : `\u300C${m.author.label ?? m.author.episodeId ?? "?"}\u300D`;
    counts.set(who, (counts.get(who) ?? 0) + 1);
  }
  const statLine = [...counts.entries()].map(([who, n]) => `${who} ${n}`).join("\u3001");
  const addressed = delta.filter((m) => m.mentions.includes(opts2.memberLabel));
  const parts = [
    `\u3014\u672A\u8BFB\u6D88\u606F\u8F83\u591A\uFF08#${start}\u2013#${end} \u5171 ${delta.length} \u6761\uFF09\uFF0C\u5DF2\u6298\u53E0\u2014\u2014\u5B8C\u6574\u7248\u9762\uFF08\u6BCF\u884C\u4E00\u6761 JSON\uFF1Aseq/\u4F5C\u8005/\u65F6\u95F4/\u6B63\u6587\uFF09\u53EF\u8BFB\u6587\u4EF6\uFF1A${opts2.historyPath}\u3015`,
    `\u6298\u53E0\u533A\u95F4\u6784\u6210\uFF1A${statLine}\u3002`
  ];
  if (addressed.length > 0) {
    parts.push(`\u5176\u4E2D\u70B9\u540D @\u4F60 \u7684 ${addressed.length} \u6761\uFF08\u9010\u5B57\u4FDD\u7559\uFF09\uFF1A
${renderBoard(addressed)}`);
  } else {
    parts.push("\u671F\u95F4\u65E0\u4EBA\u70B9\u540D @\u4F60\u3002");
  }
  parts.push(`\u6700\u8FD1 ${Math.min(tail, delta.length)} \u6761\u539F\u6587\uFF1A
${renderBoard(delta.slice(-tail))}`);
  return parts.join("\n\n");
}
function turnPrompt(opts2) {
  return [
    `\u4F60\u662F\u7FA4\u804A\u6210\u5458\u300C${opts2.label}\u300D\u3002`,
    "",
    `\u3010\u7FA4\u7248\u9762\uFF08${opts2.full ? "\u5168\u91CF" : "\u589E\u91CF\uFF1A\u4F60\u4E0A\u6B21\u53D1\u8A00\u4E4B\u540E\u7684\u65B0\u6D88\u606F"}\uFF0C\u622A\u81F3 #${opts2.topSeq}\uFF09\u3011`,
    opts2.board,
    "",
    `\u3010\u9879\u76EE\u76EE\u5F55\u3011${opts2.cwd}`,
    "\u8FD9\u662F\u5168\u4F53\u6210\u5458\u5171\u4EAB\u7684\u5DE5\u4F5C\u76EE\u5F55\uFF0C\u53EF\u6309\u9700\u8BFB\u53D6\u3002",
    "",
    "\u3010\u4F60\u7684\u4EFB\u52A1\u3011",
    `\u8BF7\u4EE5\u300C${opts2.label}\u300D\u7684\u8EAB\u4EFD\u56DE\u590D\u672C\u8F6E\u3002\u76F4\u63A5\u8F93\u51FA\u56DE\u590D\u6B63\u6587\uFF1B\u9700\u8981\u67D0\u4F4D\u6210\u5458\u7EE7\u7EED\u8DDF\u8FDB\u65F6\uFF0C\u5728\u6B63\u6587\u4E2D\u5199 @\u8BE5\u6210\u5458\u7684\u663E\u793A\u540D\uFF08\u7CBE\u786E\u5168\u540D\uFF09\uFF1B\u65E0\u9700\u6C42\u4ED6\u4EBA\u8DDF\u8FDB\u65F6\u4E0D\u8981 @ \u4EFB\u4F55\u4EBA\u3002`
  ].join("\n");
}
var GroupRunner = class _GroupRunner {
  constructor(dataDir, group, log = () => {
  }) {
    this.dataDir = dataDir;
    this.group = group;
    this.log = log;
    migrateGroupRecord(this.group);
    this.groupDir = groupDirOf(dataDir, this.group.id);
    this.controller = new SuperAgentController(dataDir, autoAllowOnce());
    this.events = new JsonlLog(path9.join(this.groupDir, "events.jsonl"));
    this.messagesLog = new JsonlLog(path9.join(this.groupDir, "messages.jsonl"));
  }
  dataDir;
  group;
  log;
  controller;
  groupDir;
  events;
  /** 增量折叠阈值（delta 超过即折叠）；实例字段便于测试注入小阈值 */
  deltaFoldThreshold = DELTA_FOLD_THRESHOLD;
  messagesLog;
  messages = [];
  connections = /* @__PURE__ */ new Map();
  activeTurns = /* @__PURE__ */ new Map();
  slots = new ConcurrencySlots(GROUP_MEMBER_LIMIT, GROUP_MEMBER_LIMIT);
  /** 各成员 episode 已发现的会话档位（免费发现；mock/发现失败为全 null 哨兵） */
  sessionConfigs = /* @__PURE__ */ new Map();
  /** 连接建立中备忘（并发 connect 去重，防止同 episode 双 spawn 互相覆盖） */
  connecting = /* @__PURE__ */ new Map();
  /** GRP-01：无序成员对 → 连击状态 */
  combos = /* @__PURE__ */ new Map();
  /** 待触发回合的 episodeId（去重；在途者转 retriggerPending，完成后携增量补一回合） */
  pendingTriggers = /* @__PURE__ */ new Set();
  retriggerPending = /* @__PURE__ */ new Set();
  pumping = false;
  pumpChain = Promise.resolve();
  cascadeActive = false;
  cascadeTurns = 0;
  /** 从磁盘装载记录与板面（构造后调用一次；工作台/测试共用） */
  static async open(dataDir, group, log) {
    const runner = new _GroupRunner(dataDir, group, log);
    const dir = groupDirOf(dataDir, group.id);
    runner.messages.push(
      ...await readJsonl(path9.join(dir, "messages.jsonl"))
    );
    return runner;
  }
  /* ---------- 板面与查询 ---------- */
  getBoardMessages(afterSeq = 0) {
    return this.messages.filter((m) => m.seq > afterSeq);
  }
  activeMembers() {
    return this.group.members.filter((m) => !m.leftAt);
  }
  findMember(episodeId) {
    return this.group.members.find((m) => m.episodeId === episodeId);
  }
  inFlightEpisodeIds() {
    return [...this.activeTurns.values()].map((t) => t.episodeId);
  }
  activeTurnAttemptId(episodeId) {
    return this.activeTurns.get(episodeId)?.attemptId;
  }
  topSeq() {
    return this.group.messageSeq;
  }
  async persist() {
    await persistGroup(this.dataDir, this.group);
  }
  appendMessage(msg) {
    const full = { ...msg, seq: this.group.messageSeq + 1 };
    this.group.messageSeq = full.seq;
    this.messages.push(full);
    this.messagesLog.append(full);
    return full;
  }
  appendSystem(text) {
    this.appendMessage({ at: (/* @__PURE__ */ new Date()).toISOString(), author: { kind: "system" }, text, mentions: [] });
  }
  /** 等待全部在途回合与调度排空（测试与关停用） */
  async waitIdle() {
    while (this.pumping || this.activeTurns.size > 0) {
      await this.pumpChain;
    }
  }
  /** 等待全部异步日志链落盘（测试断言 events.jsonl/messages.jsonl 前调用） */
  async flushLogs() {
    await this.events.flush();
    await this.messagesLog.flush();
    await this.controller.store.flushEvents();
  }
  /* ---------- 成员生命周期 ---------- */
  spawnConfigForMember(member) {
    if (member.appId === "mock") {
      return mockAgentConfig(member.episodeId, member.env ?? { SUPER_MOCK_BEHAVIOR: "board" });
    }
    return realAgentConfig(member.appId, member.episodeId, member.env);
  }
  async ensureConnected(member) {
    const pending = this.connecting.get(member.episodeId);
    if (pending) {
      await pending;
      return this.connections.get(member.episodeId);
    }
    let handle = this.connections.get(member.episodeId);
    if (!handle || handle.connectionClosed) {
      if (handle) this.connections.delete(member.episodeId);
      const connectPromise = (async () => {
        const h = await this.controller.startAgent(this.spawnConfigForMember(member));
        this.connections.set(member.episodeId, h);
        this.log(`[\u7FA4\u63A5\u5165] ${member.episodeId} (${member.appId})`);
        if (member.appId !== "mock" && !this.sessionConfigs.has(member.episodeId)) {
          try {
            this.sessionConfigs.set(
              member.episodeId,
              await discoverSessionConfig(h, this.group.cwd, (m) => this.log(`[\u7FA4\u914D\u7F6E] ${member.episodeId} ${m}`))
            );
          } catch (err) {
            this.sessionConfigs.set(member.episodeId, {
              readOnlyModeId: null,
              modelConfigId: null,
              reasoningConfigId: null,
              flashModelValueId: null,
              reasoningLowValueId: null,
              modelOptions: [],
              reasoningOptions: [],
              currentModelValue: null,
              currentReasoningValue: null
            });
            this.log(`[\u7FA4\u914D\u7F6E] ${member.episodeId} \u6863\u4F4D\u53D1\u73B0\u5931\u8D25\uFF08\u4FDD\u6301\u5E94\u7528\u9ED8\u8BA4\uFF09\uFF1A${String(err).slice(0, 120)}`);
          }
        }
      })();
      this.connecting.set(member.episodeId, connectPromise);
      try {
        await connectPromise;
      } finally {
        this.connecting.delete(member.episodeId);
      }
    }
    return this.connections.get(member.episodeId);
  }
  /** 建立全部在群成员的连接（建群后/进入群详情时调用，尽早暴露接入失败） */
  async connectAll() {
    for (const m of this.activeMembers()) {
      await this.ensureConnected(m);
    }
  }
  /** 拉人：新 episode（重拉同 appId 序号递增）；连接立即建立以便尽早暴露接入失败 */
  async addMember(input) {
    if (this.group.closedAt) throw new Error("\u7FA4\u5DF2\u5173\u95ED\uFF0C\u4E0D\u80FD\u518D\u62C9\u4EBA");
    const active = this.activeMembers();
    if (active.length >= GROUP_MEMBER_LIMIT) {
      throw new Error(`\u5728\u7FA4\u6210\u5458\u5DF2\u8FBE\u4E0A\u9650 ${GROUP_MEMBER_LIMIT}`);
    }
    const n = (this.group.nextEpisode[input.appId] ?? 0) + 1;
    this.group.nextEpisode[input.appId] = n;
    const member = buildMember(input.appId, n, input, (/* @__PURE__ */ new Date()).toISOString());
    this.group.members.push(member);
    try {
      validateLabels(this.activeMembers());
    } catch (err) {
      this.group.members.pop();
      this.group.nextEpisode[input.appId] = n - 1;
      throw err;
    }
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "member_added",
      episodeId: member.episodeId,
      label: member.label,
      appId: member.appId
    });
    this.appendSystem(`\u300C${member.label}\u300D\u52A0\u5165\u7FA4\u804A`);
    await this.persist();
    await this.ensureConnected(member);
    return member;
  }
  /**
   * 踢人：先取消在途回合并等核对窗口（AC-39 序列）；未确认 → needsReview 留痕，
   * 不静默宣称已停；确认后按协议关闭会话（失败记差异，不虚报）再断开连接。
   */
  async kickMember(episodeId, reason) {
    const member = this.findMember(episodeId);
    if (!member) throw new Error(`\u6210\u5458\u4E0D\u5B58\u5728\uFF1A${episodeId}`);
    if (member.leftAt) throw new Error(`\u6210\u5458\u5DF2\u4E0D\u5728\u7FA4\uFF1A${episodeId}`);
    if (this.group.closedAt) throw new Error("\u7FA4\u5DF2\u5173\u95ED");
    const inflight = [...this.activeTurns.values()].filter((t) => t.episodeId === episodeId);
    for (const t of inflight) t.runner.cancel(t.attemptId);
    if (inflight.length > 0) {
      await Promise.race([
        Promise.all(inflight.map((t) => t.done)),
        new Promise((resolve7) => {
          const timer = setTimeout(resolve7, CANCEL_GRACE_MS2 + 2e3);
          timer.unref();
        })
      ]);
    }
    const confirmed = /* @__PURE__ */ new Set(["succeeded", "failed", "cancelled_confirmed"]);
    let needsReview = false;
    for (const t of inflight) {
      const rec = this.controller.store.get(t.attemptId);
      if (!rec || !confirmed.has(rec.status)) needsReview = true;
    }
    member.leftAt = (/* @__PURE__ */ new Date()).toISOString();
    member.leftReason = reason?.trim() || "\u7528\u6237\u79FB\u51FA\u7FA4\u804A";
    member.needsReview = needsReview;
    const handle = this.connections.get(episodeId);
    if (!needsReview && member.sessionId && handle) {
      try {
        await handle.closeSession(member.sessionId);
      } catch (err) {
        this.events.append({
          at: (/* @__PURE__ */ new Date()).toISOString(),
          event: "session_close_failed",
          episodeId,
          detail: String(err?.message ?? err).slice(0, 200)
        });
      }
    }
    handle?.close();
    this.connections.delete(episodeId);
    if (needsReview) member.sessionId = member.sessionId ?? null;
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "member_removed",
      episodeId,
      label: member.label,
      needsReview,
      reason: member.leftReason
    });
    if (needsReview) {
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "member_kick_unconfirmed",
        episodeId,
        detail: "\u5728\u9014\u56DE\u5408\u53D6\u6D88\u672A\u83B7\u7EC8\u6B62\u786E\u8BA4\uFF08AC-39\uFF09\uFF1B\u5C1D\u8BD5\u8BB0\u5F55\u4FDD\u6301 unknown\uFF0C\u5F85\u4EBA\u5DE5\u6838\u5BF9"
      });
    }
    this.appendSystem(
      needsReview ? `\u300C${member.label}\u300D\u88AB\u79FB\u51FA\u7FA4\u804A\uFF08\u5728\u9014\u56DE\u5408\u53D6\u6D88\u672A\u786E\u8BA4\uFF0C\u5F85\u6838\u5BF9\uFF09` : `\u300C${member.label}\u300D\u88AB\u79FB\u51FA\u7FA4\u804A`
    );
    await this.persist();
    return { needsReview };
  }
  /**
   * 归队：让已移出的旧 episode 原样复活（同 episodeId/label，保留会话引用与 lastSeenSeq）。
   * 与「重拉=全新成员」相对：归队保留会话记忆，下一回合经 session/resume 续上旧上下文，
   * 只收增量板面；resume 失败由 AC-37 机制自动降级新会话 + 全量板面（最坏不劣于重拉）。
   * needsReview（取消未确认）的旧会话状态不可信 → 强制新会话归队。
   */
  readdMember(episodeId, opts2 = {}) {
    const member = this.findMember(episodeId);
    if (!member) throw new Error(`\u6210\u5458\u4E0D\u5B58\u5728\uFF1A${episodeId}`);
    if (this.group.closedAt) throw new Error("\u7FA4\u5DF2\u5173\u95ED\uFF0C\u4E0D\u80FD\u5F52\u961F");
    if (!member.leftAt) throw new Error(`\u6210\u5458\u5DF2\u5728\u7FA4\uFF1A${episodeId}`);
    const wasNeedsReview = member.needsReview === true;
    const reuseSession = opts2.reuseSession !== false && !wasNeedsReview;
    member.leftAt = null;
    member.leftReason = null;
    member.needsReview = false;
    if (!reuseSession) member.sessionId = null;
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "member_readded",
      episodeId,
      label: member.label,
      reuseSession: Boolean(member.sessionId) && reuseSession,
      wasNeedsReview
    });
    this.appendSystem(
      reuseSession && member.sessionId ? `\u300C${member.label}\u300D\u5F52\u961F\uFF08\u4FDD\u7559\u4F1A\u8BDD\u8BB0\u5FC6\uFF09` : `\u300C${member.label}\u300D\u5F52\u961F\uFF08\u65B0\u4F1A\u8BDD\uFF0C\u5DF2\u8BFB\u5168\u91CF\u677F\u9762\uFF09`
    );
    void this.persist();
    void this.ensureConnected(member).catch((err) => {
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "member_readd_connect_failed",
        episodeId,
        detail: String(err?.message ?? err).slice(0, 200)
      });
    });
    return member;
  }
  async closeGroup(reason) {
    if (this.group.closedAt) return;
    if (this.activeTurns.size > 0) {
      throw new Error("\u4ECD\u6709\u5728\u9014\u56DE\u5408\uFF0C\u5148\u7B49\u5B8C\u6210\u6216\u8E22\u51FA/\u53D6\u6D88\u540E\u518D\u5173\u95ED\u7FA4");
    }
    this.group.closedAt = (/* @__PURE__ */ new Date()).toISOString();
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "group_closed",
      reason: reason ?? null
    });
    this.appendSystem("\u7FA4\u5DF2\u5173\u95ED");
    await this.persist();
    this.closeAll();
  }
  /* ---------- 发消息与级联调度 ---------- */
  /**
   * 用户发消息：落板 → audience = mentions ∩ 在群成员（无 mentions = 全体）→ 触发回合。
   * 用户消息重置全部连击计数（GRP-01：他方插话重置）。
   */
  async postUserMessage(text, mentions, via) {
    if (this.group.closedAt) throw new Error("\u7FA4\u5DF2\u5173\u95ED\uFF0C\u4E0D\u80FD\u518D\u53D1\u8A00");
    const trimmed = text.trim();
    if (!trimmed) throw new Error("\u6D88\u606F\u4E0D\u80FD\u4E3A\u7A7A");
    const labels = this.activeMembers().map((m) => m.label);
    const parsed = parseMentions(trimmed, labels);
    const merged = [.../* @__PURE__ */ new Set([...mentions ?? [], ...parsed])].filter((l) => labels.includes(l));
    const msg = this.appendMessage({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      author: via ? { kind: "user", via } : { kind: "user" },
      text: trimmed,
      mentions: merged
    });
    this.combos.clear();
    const audience = (merged.length > 0 ? merged : labels).map((label) => this.activeMembers().find((m) => m.label === label)).filter((m) => Boolean(m)).map((m) => m.episodeId);
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "message",
      seq: msg.seq,
      author: "user",
      audience
    });
    if (audience.length > 0) {
      this.cascadeActive = true;
      this.cascadeTurns = 0;
      this.enqueueTriggers(audience);
    } else {
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "cascade_ended",
        reason: "no_audience",
        turns: 0
      });
    }
    await this.persist();
    return msg;
  }
  enqueueTriggers(episodeIds) {
    for (const ep of episodeIds) {
      if (this.activeTurns.has(ep)) {
        this.retriggerPending.add(ep);
      } else {
        this.pendingTriggers.add(ep);
      }
    }
    void this.pump();
  }
  async pump() {
    this.pumpChain = this.pumpChain.then(() => this.pumpLoop());
    return this.pumpChain;
  }
  async pumpLoop() {
    if (this.pumping) return;
    this.pumping = true;
    try {
      while (this.pendingTriggers.size > 0) {
        const budget = this.group.settings.maxCascadeTurns - this.cascadeTurns;
        if (budget <= 0) {
          this.endCascade("turn_cap");
          this.pendingTriggers.clear();
          this.retriggerPending.clear();
          break;
        }
        const eps = [...this.pendingTriggers].slice(0, budget);
        for (const ep of eps) this.pendingTriggers.delete(ep);
        await Promise.all(eps.map((ep) => this.runTurnSafe(ep)));
      }
      if (this.cascadeActive) {
        this.endCascade("silence");
      }
    } finally {
      this.pumping = false;
    }
  }
  endCascade(reason) {
    this.cascadeActive = false;
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "cascade_ended",
      reason,
      turns: this.cascadeTurns
    });
  }
  async runTurnSafe(episodeId) {
    try {
      await this.runTurn(episodeId);
    } catch (err) {
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "turn_failed",
        episodeId,
        detail: String(err?.message ?? err).slice(0, 300)
      });
      this.log(`[\u7FA4\u56DE\u5408\u5931\u8D25] ${episodeId}: ${String(err)}`);
    }
  }
  /** 单个成员的一回合：提交 → 回复落板 → 解析提及 → 触发级联（三规则在此收口） */
  async runTurn(episodeId) {
    const member = this.findMember(episodeId);
    if (!member || member.leftAt || this.group.closedAt) return;
    if (this.activeTurns.has(episodeId)) {
      this.retriggerPending.add(episodeId);
      return;
    }
    const handle = await this.ensureConnected(member);
    if (handle.connectionClosed) {
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "turn_skipped",
        episodeId,
        detail: "\u8FDE\u63A5\u4E0D\u53EF\u7528"
      });
      return;
    }
    const attemptId = newId("attempt");
    const runner = this.controller.createRunner(episodeId, handle);
    let resolveDone;
    const done = new Promise((resolve7) => {
      resolveDone = resolve7;
    });
    this.activeTurns.set(episodeId, { attemptId, runner, episodeId, done, resolveDone });
    this.cascadeTurns += 1;
    try {
      const basedOn = this.topSeq();
      const full = !member.sessionId;
      const lastSeen = member.lastSeenSeq ?? 0;
      const delta = this.messages.filter(
        (m) => m.seq > lastSeen && !(m.author.kind === "agent" && m.author.episodeId === episodeId)
      );
      const boardBlock = full ? renderBoard(this.messages) : delta.length > this.deltaFoldThreshold ? foldDelta(delta, {
        memberLabel: member.label,
        historyPath: path9.join(this.groupDir, "messages.jsonl")
      }) : renderBoard(delta);
      const prompt = turnPrompt({
        label: member.label,
        cwd: this.group.cwd,
        board: boardBlock,
        topSeq: basedOn,
        full
      });
      const promptFallback = turnPrompt({
        label: member.label,
        cwd: this.group.cwd,
        board: renderBoard(this.messages),
        topSeq: basedOn,
        full: true
      });
      const segments = [];
      const role = member.role?.trim();
      if (role) segments.push(`\u3010\u89D2\u8272\u8BBE\u5B9A\u3011${role}`);
      const promptPrefix = segments.length > 0 ? `${segments.join("\n\n---\n\n")}

---

` : "";
      this.events.append({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        event: "turn_submitted",
        attemptId,
        episodeId,
        basedOn,
        full,
        cascadeTurn: this.cascadeTurns
      });
      const rec = await runner.run({
        attemptId,
        prompt: `${promptPrefix}${prompt}`,
        promptFallback: `${promptPrefix}${promptFallback}`,
        resumeSessionId: member.sessionId ?? void 0,
        cwd: this.group.cwd,
        inputVersion: `board:${basedOn}`,
        timeoutMs: TASK_TIMEOUT_MS2,
        cancelGraceMs: CANCEL_GRACE_MS2,
        beforePrompt: this.beforePromptFor(member)
      });
      if (member.leftAt) return;
      if (rec.status !== "succeeded") {
        if (rec.status !== "cancelled_confirmed") {
          member.sessionId = null;
        }
        this.events.append({
          at: (/* @__PURE__ */ new Date()).toISOString(),
          event: "turn_not_succeeded",
          attemptId,
          episodeId,
          status: rec.status,
          stopReason: rec.stopReason,
          unknownReason: rec.unknownReason
        });
        return;
      }
      if (rec.agentSessionId) {
        member.sessionId = rec.agentSessionId;
        member.connectionId = handle.id;
      }
      const text = await this.extractAssistantText(attemptId);
      member.lastSeenSeq = basedOn;
      const labels = this.activeMembers().map((m) => m.label);
      const mentions = parseMentions(text, labels);
      const msg = this.appendMessage({
        at: (/* @__PURE__ */ new Date()).toISOString(),
        author: { kind: "agent", episodeId, label: member.label },
        text,
        mentions,
        basedOn,
        stale: basedOn < this.topSeq(),
        attemptId
      });
      if (msg.stale) {
        this.events.append({
          at: (/* @__PURE__ */ new Date()).toISOString(),
          event: "turn_stale",
          attemptId,
          episodeId,
          basedOn,
          topSeq: this.topSeq()
        });
      }
      await this.persist();
      this.applyComboAndTrigger(member, mentions);
    } finally {
      this.activeTurns.delete(episodeId);
      resolveDone();
      if (this.retriggerPending.delete(episodeId)) {
        const m = this.findMember(episodeId);
        if (m && !m.leftAt && !this.group.closedAt && this.cascadeTurns < this.group.settings.maxCascadeTurns) {
          this.cascadeActive = true;
          this.pendingTriggers.add(episodeId);
          void this.pump();
        }
      }
    }
  }
  /** GRP-01：更新互@连击深度；超限抑制自动触发。作者未提及的对子重置。 */
  applyComboAndTrigger(author, mentioned) {
    const pairKey = (a, b) => [a, b].sort().join("\0");
    for (const key of [...this.combos.keys()]) {
      const [x, y] = key.split("\0");
      if (x !== author.label && y !== author.label) continue;
      const other = x === author.label ? y : x;
      if (!mentioned.includes(other)) this.combos.delete(key);
    }
    const targets = [];
    for (const label of mentioned) {
      if (label === author.label) continue;
      const target = this.activeMembers().find((m) => m.label === label);
      if (!target) continue;
      const key = pairKey(author.label, label);
      const prev = this.combos.get(key);
      let depth;
      if (prev && prev.lastFrom === label && prev.lastTo === author.label) {
        depth = prev.depth + 1;
      } else {
        depth = 1;
      }
      this.combos.set(key, { depth, lastFrom: author.label, lastTo: label });
      if (depth > this.group.settings.maxComboDepth) {
        this.events.append({
          at: (/* @__PURE__ */ new Date()).toISOString(),
          event: "mention_suppressed",
          from: author.label,
          to: label,
          depth,
          maxComboDepth: this.group.settings.maxComboDepth
        });
        continue;
      }
      targets.push(target.episodeId);
    }
    if (targets.length > 0) {
      this.cascadeActive = true;
      this.enqueueTriggers(targets);
    }
  }
  /* ---------- 文本提取与关停 ---------- */
  /** 回复正文 = 流式 agent_message_chunk 文本拼接（与讨论的 extractAssistantText 同路径） */
  async extractAssistantText(attemptId) {
    await this.controller.store.flushEvents();
    const events = await this.controller.store.readStandardizedEvents(attemptId);
    return events.filter((e) => e.updateKind === "agent_message_chunk" && !e.sensitive).map((e) => {
      const d = e.detail;
      return d?.content?.type === "text" ? d.content.text ?? "" : "";
    }).join("");
  }
  closeAll() {
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
  }
  /**
   * 回合提交前的档位应用（讨论 beforePromptFor 同款语义，群聊差异：无低成本守卫、
   * 不强制 codex read-only——用户明确要求群聊 agent 可执行）。用户未选择时保持应用默认。
   * 应用失败（档位无效/应用不支持运行中切档）→ 该回合不发出、零消耗，错误可见。
   */
  beforePromptFor(member) {
    const cfg = this.sessionConfigs.get(member.episodeId);
    const handle = this.connections.get(member.episodeId);
    if (member.appId === "mock" || !cfg || !handle) return void 0;
    const userModel = member.config?.model ?? null;
    const userReasoning = member.config?.reasoning ?? null;
    if (!userModel && !userReasoning) return void 0;
    return async (sessionId) => {
      if (userModel) {
        if (!cfg.modelConfigId || !cfg.modelOptions.some((o) => o.value === userModel)) {
          throw new Error(`\u6210\u5458 ${member.label} \u7684\u6A21\u578B\u6863\u4F4D\u65E0\u6548\uFF1A${userModel}\uFF08\u672A\u5728\u672C\u673A\u4F1A\u8BDD\u914D\u7F6E\u4E2D\u53D1\u73B0\uFF09`);
        }
        await handle.setConfigOption(sessionId, cfg.modelConfigId, userModel);
      }
      if (userReasoning) {
        if (!cfg.reasoningConfigId || !cfg.reasoningOptions.some((o) => o.value === userReasoning)) {
          throw new Error(`\u6210\u5458 ${member.label} \u7684\u601D\u8003\u5F3A\u5EA6\u6863\u4F4D\u65E0\u6548\uFF1A${userReasoning}\uFF08\u672A\u5728\u672C\u673A\u4F1A\u8BDD\u914D\u7F6E\u4E2D\u53D1\u73B0\uFF09`);
        }
        await handle.setConfigOption(sessionId, cfg.reasoningConfigId, userReasoning);
      }
    };
  }
  /** 各在群成员已发现的会话档位（供设置/成员栏的档位下拉） */
  getMemberConfigs() {
    return this.activeMembers().map((m) => ({
      episodeId: m.episodeId,
      label: m.label,
      appId: m.appId,
      config: this.sessionConfigs.get(m.episodeId) ?? null,
      selected: { model: m.config?.model ?? null, reasoning: m.config?.reasoning ?? null }
    }));
  }
  /**
   * 运行中改档位（模型/思考强度）：写 member.config 并留痕，下一回合提交前
   * 经 beforePrompt 真实应用到会话（set_config_option），不中断会话、不需踢出重拉。
   * mock / 未发现档位 / 非法值 → 明确报错，不静默。
   */
  setMemberConfig(episodeId, patch) {
    const member = this.findMember(episodeId);
    if (!member) throw new Error(`\u6210\u5458\u4E0D\u5B58\u5728\uFF1A${episodeId}`);
    if (member.leftAt) throw new Error(`\u6210\u5458\u5DF2\u4E0D\u5728\u7FA4\uFF1A${episodeId}`);
    if (member.appId === "mock") throw new Error("mock \u6210\u5458\u6CA1\u6709\u53EF\u914D\u7F6E\u6863\u4F4D");
    const cfg = this.sessionConfigs.get(episodeId);
    if (!cfg || !cfg.modelConfigId) {
      throw new Error(`\u6210\u5458 ${member.label} \u672A\u5728\u672C\u673A\u53D1\u73B0\u53EF\u914D\u7F6E\u6863\u4F4D\uFF08\u4FDD\u6301\u5E94\u7528\u9ED8\u8BA4\u8FD0\u884C\uFF09`);
    }
    const model = patch.model?.trim() || null;
    const reasoning = patch.reasoning?.trim() || null;
    if (model && !cfg.modelOptions.some((o) => o.value === model)) {
      throw new Error(`\u6A21\u578B\u6863\u4F4D\u65E0\u6548\uFF1A${model}\uFF08\u672A\u5728\u672C\u673A\u4F1A\u8BDD\u914D\u7F6E\u4E2D\u53D1\u73B0\uFF09`);
    }
    if (reasoning && !cfg.reasoningOptions.some((o) => o.value === reasoning)) {
      throw new Error(`\u601D\u8003\u5F3A\u5EA6\u6863\u4F4D\u65E0\u6548\uFF1A${reasoning}\uFF08\u672A\u5728\u672C\u673A\u4F1A\u8BDD\u914D\u7F6E\u4E2D\u53D1\u73B0\uFF09`);
    }
    member.config = { model, reasoning };
    this.events.append({
      at: (/* @__PURE__ */ new Date()).toISOString(),
      event: "member_config",
      episodeId,
      label: member.label,
      model,
      reasoning,
      note: "\u4E0B\u4E00\u56DE\u5408\u63D0\u4EA4\u524D\u5E94\u7528\uFF08\u8BA8\u8BBA\u540C\u6B3E beforePrompt \u673A\u5236\uFF09"
    });
    void this.persist();
  }
};

// ../../super-agent-zcode/packages/workbench/src/server.ts
var HttpError = class extends Error {
  constructor(status, message, extra) {
    super(message);
    this.status = status;
    this.extra = extra;
    this.name = "HttpError";
  }
  status;
  extra;
};
var ACTIVE_STAGE_SET = /* @__PURE__ */ new Set([
  "checking",
  "proposing",
  "reviewing",
  "responding",
  "rechecking",
  "synthesizing"
]);
function createWorkbenchServer(opts2) {
  const log = opts2.log ?? (() => {
  });
  const runners = /* @__PURE__ */ new Map();
  const groupRunners = /* @__PURE__ */ new Map();
  const portfile = path10.join(opts2.dataDir, "workbench.port");
  let active = null;
  let boundPort = opts2.port ?? 0;
  let nativePickInFlight = false;
  function sendJson(res, status, body) {
    const data = JSON.stringify(body);
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store"
    });
    res.end(data);
  }
  function readBody(req) {
    return new Promise((resolve7, reject) => {
      const chunks = [];
      let size = 0;
      req.on("data", (c) => {
        size += c.length;
        if (size > 1e6) {
          reject(new HttpError(413, "\u8BF7\u6C42\u4F53\u8FC7\u5927"));
          req.destroy();
          return;
        }
        chunks.push(c);
      });
      req.on("end", () => {
        if (chunks.length === 0) return resolve7({});
        try {
          resolve7(JSON.parse(Buffer.concat(chunks).toString("utf8")));
        } catch {
          reject(new HttpError(400, "\u8BF7\u6C42\u4F53\u4E0D\u662F\u5408\u6CD5 JSON"));
        }
      });
      req.on("error", () => reject(new HttpError(400, "\u8BF7\u6C42\u8BFB\u53D6\u5931\u8D25")));
    });
  }
  function securityCheck(req, res) {
    const host = req.headers.host ?? "";
    const local = host === `127.0.0.1:${boundPort}` || host === `localhost:${boundPort}` || host === `[::1]:${boundPort}`;
    if (!local) {
      sendJson(res, 403, { error: "\u4EC5\u5141\u8BB8\u672C\u673A\u56DE\u73AF\u8BBF\u95EE\uFF08AC-26\uFF09" });
      return false;
    }
    const origin = req.headers.origin;
    if (typeof origin === "string" && origin.length > 0 && origin !== `http://127.0.0.1:${boundPort}` && origin !== `http://localhost:${boundPort}` && origin !== `http://[::1]:${boundPort}`) {
      sendJson(res, 403, { error: "\u8DE8\u6E90\u8BF7\u6C42\u88AB\u62D2\u7EDD\uFF08AC-26\uFF1A\u9632\u5176\u4ED6\u7F51\u9875\u89E6\u53D1\u672C\u673A\u4EFB\u52A1\uFF09" });
      return false;
    }
    return true;
  }
  function getOrCreateRunner(record2) {
    let runner = runners.get(record2.id);
    if (!runner) {
      runner = new DiscussionRunner(opts2.dataDir, record2, log);
      runners.set(record2.id, runner);
    }
    return runner;
  }
  async function getGroupRunner(groupId) {
    if (!/^[A-Za-z0-9._-]+$/.test(groupId)) throw new HttpError(400, "\u975E\u6CD5\u7FA4 ID");
    let runner = groupRunners.get(groupId);
    if (!runner) {
      const record2 = await loadGroup(opts2.dataDir, groupId).catch(() => {
        throw new HttpError(404, "\u7FA4\u4E0D\u5B58\u5728");
      });
      runner = await GroupRunner.open(opts2.dataDir, record2, log);
      groupRunners.set(groupId, runner);
    }
    return runner;
  }
  function normalizeMemberInput(raw) {
    if (typeof raw !== "object" || raw === null) throw new HttpError(400, "\u6210\u5458\u683C\u5F0F\u4E0D\u6B63\u786E");
    const m = raw;
    const appId = m.appId;
    if (typeof appId !== "string" || appId !== "mock" && !(appId in REAL_AGENT_PACKAGES)) {
      throw new HttpError(400, `\u672A\u77E5\u5E94\u7528\u7C7B\u578B\uFF1A${String(appId)}`);
    }
    const env = {};
    if (typeof m.env === "object" && m.env !== null) {
      for (const [k, v] of Object.entries(m.env)) {
        if (typeof v === "string") env[k] = v;
      }
    }
    return {
      appId,
      label: typeof m.label === "string" ? m.label : void 0,
      env,
      role: typeof m.role === "string" ? m.role : null
    };
  }
  async function recoverInterruptedDiscussions() {
    const root = path10.join(opts2.dataDir, "discussions");
    const ids = (await fs6.readdir(root).catch(() => [])).filter((d) => !d.startsWith("."));
    for (const id of ids) {
      try {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        if (!isRunningStage(record2.stage)) continue;
        const runner = getOrCreateRunner(record2);
        await runner.markRestartPaused();
        log(`[\u6062\u590D] \u8BA8\u8BBA ${id} \u505C\u5728\u8FDB\u884C\u4E2D\u9636\u6BB5 ${record2.pausedFromStage}\uFF0C\u5DF2\u6807\u8BB0\u6682\u505C\u5F85\u6838\u5BF9\uFF08\xA712.3\uFF09`);
        runner.closeAll();
        runners.delete(id);
      } catch (err) {
        log(`[\u6062\u590D] \u8BA8\u8BBA ${id} \u626B\u63CF\u5931\u8D25\uFF1A${String(err).slice(0, 200)}`);
      }
    }
  }
  function startBackground(id, runner) {
    if (active && active.id !== id) {
      throw new HttpError(409, "\u9996\u671F\u6574\u4E2A\u670D\u52A1\u4EC5\u8FD0\u884C\u4E00\u573A\u8BA8\u8BBA\uFF08\xA76.1\uFF09");
    }
    if (active?.id === id && active.runner === runner) {
      return;
    }
    active = { id, runner };
    void runner.runAfterConfirmation().then(async () => {
      if (runner.disc.synthesis) {
        await regenerateFinalBrief(opts2.dataDir, runner.disc).catch(() => {
        });
      }
    }).catch(async (err) => {
      log(`[\u8FD0\u884C\u65F6\u9519\u8BEF] ${String(err).slice(0, 300)}`);
      await runner.markFailed(`\u8FD0\u884C\u65F6\u9519\u8BEF\uFF1A${String(err).slice(0, 160)}`);
    }).finally(() => {
      if (active?.id === id) active = null;
    });
  }
  async function listDiscussions() {
    const root = path10.join(opts2.dataDir, "discussions");
    const ids = (await fs6.readdir(root).catch(() => [])).filter((d) => !d.startsWith("."));
    const out = [];
    for (const id of ids) {
      const rec = await fs6.readFile(path10.join(root, id, "discussion.json"), "utf8").then((t) => JSON.parse(t)).catch(() => null);
      if (!rec) continue;
      out.push({
        id: rec.id,
        stage: rec.stage,
        grade: rec.grade ?? null,
        updatedAt: rec.updatedAt,
        budgetUsed: rec.budget.entries.length,
        requirementPreview: rec.requirementText.slice(0, 60)
      });
    }
    out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
    return { discussions: out, activeId: active?.id ?? null };
  }
  async function artifactPayload(record2, name) {
    if (!/^[A-Za-z0-9._-]+$/.test(name) || name.includes("..")) {
      throw new HttpError(400, "\u975E\u6CD5\u4EA7\u7269\u6587\u4EF6\u540D");
    }
    const dir = path10.join(opts2.dataDir, "discussions", record2.id, "artifacts");
    const filePath = path10.join(dir, name);
    if (!path10.resolve(filePath).startsWith(path10.resolve(dir))) {
      throw new HttpError(400, "\u975E\u6CD5\u4EA7\u7269\u8DEF\u5F84");
    }
    const raw = await fs6.readFile(filePath, "utf8").catch(() => {
      throw new HttpError(404, "\u4EA7\u7269\u4E0D\u5B58\u5728");
    });
    let parsed = null;
    if (name.startsWith("review-")) {
      parsed = { kind: "review", ...standardizeReview(raw) };
    } else if (name.startsWith("recheck-")) {
      parsed = { kind: "recheck", ...standardizeRecheck(raw) };
    } else if (name.startsWith("revision-")) {
      parsed = { kind: "responses", responses: parseResponses(raw) };
    } else if (name.startsWith("synthesis")) {
      parsed = { kind: "decisions", decisions: parseDecisions(raw) };
    }
    return { name, raw, parsed };
  }
  async function route(req, res) {
    const url2 = new URL(req.url ?? "/", `http://127.0.0.1:${boundPort}`);
    const parts = url2.pathname.split("/").filter(Boolean);
    const staticFile = parts.length === 0 ? "index.html" : parts[0] === "groups" && parts.length === 1 ? "group.html" : ["app.js", "style.css", "group.html", "group.js"].includes(parts[0]) ? parts[0] : null;
    if (req.method === "GET" && staticFile) {
      const file = staticFile;
      const body = await fs6.readFile(path10.join(opts2.publicDir, file), "utf8").catch(() => null);
      if (body === null) {
        sendJson(res, 404, { error: "not found" });
        return;
      }
      const type = file.endsWith(".js") ? "text/javascript; charset=utf-8" : file.endsWith(".css") ? "text/css; charset=utf-8" : "text/html; charset=utf-8";
      res.writeHead(200, { "content-type": type, "cache-control": "no-store" });
      res.end(body);
      return;
    }
    if (parts[0] !== "api") {
      sendJson(res, 404, { error: "not found" });
      return;
    }
    if (req.method === "DELETE" && parts[1] === "discussions" && typeof parts[2] === "string" && !parts[3]) {
      const id = parts[2];
      if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new HttpError(400, "\u975E\u6CD5\u8BA8\u8BBA ID");
      if (active?.id === id) throw new HttpError(409, "\u8BA8\u8BBA\u8FD0\u884C\u4E2D\uFF0C\u4E0D\u80FD\u5220\u9664\uFF08\u8BF7\u5148\u6682\u505C\u6216\u505C\u6B62\uFF09");
      const dir = path10.join(opts2.dataDir, "discussions", id);
      const st = await fs6.stat(dir).catch(() => null);
      if (!st) throw new HttpError(404, "\u8BA8\u8BBA\u4E0D\u5B58\u5728");
      runners.get(id)?.closeAll();
      await fs6.rm(dir, { recursive: true });
      runners.delete(id);
      log(`[\u5220\u9664] \u8BA8\u8BBA ${id} \u5DF2\u5220\u9664\uFF08\u7528\u6237\u786E\u8BA4\uFF09`);
      sendJson(res, 200, { deleted: true });
      return;
    }
    if (req.method === "GET" && parts[1] === "agents" && parts.length === 2) {
      const agents = Object.entries(REAL_AGENT_PACKAGES).map(([kind, m]) => ({
        kind,
        label: `${kind}\uFF08${m.shape.split("\uFF1B")[0]}\uFF09`,
        pkg: m.pkg,
        version: m.version,
        shape: m.shape
      }));
      sendJson(res, 200, { agents, defaultPair: ["codex-acp", "dsh"] });
      return;
    }
    if (req.method === "GET" && parts[1] === "templates" && parts.length === 2) {
      sendJson(res, 200, { templates: BUILTIN_TEMPLATES });
      return;
    }
    if (req.method === "GET" && parts[1] === "groups" && parts.length === 2) {
      const groups = await listGroups(opts2.dataDir);
      sendJson(res, 200, {
        groups: groups.map((g) => ({
          id: g.id,
          name: g.name,
          cwd: g.cwd,
          updatedAt: g.updatedAt,
          activeMembers: g.members.filter((m) => !m.leftAt).length,
          messageSeq: g.messageSeq,
          closedAt: g.closedAt ?? null
        }))
      });
      return;
    }
    if (req.method === "POST" && parts[1] === "groups" && parts.length === 2) {
      const body = await readBody(req);
      const name = typeof body.name === "string" ? body.name : "";
      const cwd = typeof body.cwd === "string" ? body.cwd.trim() : "";
      if (!cwd) throw new HttpError(400, "\u7FA4\u5FC5\u987B\u7ED1\u5B9A\u4E00\u4E2A\u5DE5\u4F5C\u76EE\u5F55");
      const st = await fs6.stat(cwd).catch(() => null);
      if (!st || !st.isDirectory()) throw new HttpError(400, "\u5DE5\u4F5C\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u4E0D\u662F\u76EE\u5F55");
      const rawMembers = Array.isArray(body.members) ? body.members : [];
      let record2;
      try {
        record2 = createGroupRecord({
          name,
          cwd,
          members: rawMembers.map((m) => normalizeMemberInput(m))
        });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      await persistGroup(opts2.dataDir, record2);
      const runner = new GroupRunner(opts2.dataDir, record2, log);
      try {
        await runner.connectAll();
      } catch (err) {
        runner.closeAll();
        await fs6.rm(path10.join(opts2.dataDir, "groups", record2.id), { recursive: true, force: true });
        throw new HttpError(400, `\u6210\u5458\u63A5\u5165\u5931\u8D25\uFF1A${err instanceof Error ? err.message : String(err)}`);
      }
      groupRunners.set(record2.id, runner);
      log(`[\u5EFA\u7FA4] ${record2.id} "${record2.name}" \u6210\u5458=${record2.members.map((m) => m.label).join(", ") || "\u65E0"}`);
      sendJson(res, 200, { record: record2 });
      return;
    }
    if (req.method === "GET" && parts[1] === "groups" && typeof parts[2] === "string" && parts.length === 3) {
      const runner = await getGroupRunner(parts[2]);
      const afterRaw = url2.searchParams.get("after");
      const after = afterRaw === null ? 0 : Number(afterRaw);
      sendJson(res, 200, {
        record: runner.group,
        board: runner.getBoardMessages(Number.isFinite(after) ? after : 0),
        topSeq: runner.group.messageSeq,
        inFlight: runner.inFlightEpisodeIds()
      });
      return;
    }
    if (req.method === "GET" && parts[1] === "groups" && typeof parts[2] === "string" && parts[3] === "messages" && parts.length === 4) {
      const runner = await getGroupRunner(parts[2]);
      const after = Number(url2.searchParams.get("after") ?? "0");
      sendJson(res, 200, {
        messages: runner.getBoardMessages(Number.isFinite(after) ? after : 0),
        inFlight: runner.inFlightEpisodeIds()
      });
      return;
    }
    if (req.method === "POST" && parts[1] === "groups" && typeof parts[2] === "string" && parts[3] === "messages" && parts.length === 4) {
      const runner = await getGroupRunner(parts[2]);
      const body = await readBody(req);
      try {
        const message = await runner.postUserMessage(
          typeof body.text === "string" ? body.text : "",
          void 0,
          body.via === "agent-chat" ? "agent-chat" : void 0
        );
        sendJson(res, 200, { message });
      } catch (err) {
        throw new HttpError(409, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (req.method === "POST" && parts[1] === "groups" && typeof parts[2] === "string" && parts[3] === "members" && parts.length === 4) {
      const runner = await getGroupRunner(parts[2]);
      const body = await readBody(req);
      try {
        const member = await runner.addMember(normalizeMemberInput(body));
        log(`[\u7FA4\u62C9\u4EBA] ${parts[2]} + ${member.episodeId}\uFF08${member.label}\uFF09`);
        sendJson(res, 200, { member });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (req.method === "POST" && parts[1] === "groups" && typeof parts[2] === "string" && parts[3] === "kick" && parts.length === 4) {
      const runner = await getGroupRunner(parts[2]);
      const body = await readBody(req);
      if (typeof body.episodeId !== "string" || !body.episodeId) {
        throw new HttpError(400, "\u7F3A\u5C11 episodeId");
      }
      try {
        const r = await runner.kickMember(
          body.episodeId,
          typeof body.reason === "string" ? body.reason : void 0
        );
        log(`[\u7FA4\u8E22\u4EBA] ${parts[2]} - ${body.episodeId} needsReview=${r.needsReview}`);
        sendJson(res, 200, { kicked: true, ...r });
      } catch (err) {
        throw new HttpError(409, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (req.method === "GET" && parts[1] === "groups" && typeof parts[2] === "string" && parts[3] === "configs" && parts.length === 4) {
      const runner = await getGroupRunner(parts[2]);
      sendJson(res, 200, { configs: runner.getMemberConfigs() });
      return;
    }
    if (req.method === "POST" && parts[1] === "groups" && typeof parts[2] === "string" && parts[3] === "member-config" && parts.length === 4) {
      const runner = await getGroupRunner(parts[2]);
      const body = await readBody(req);
      if (typeof body.episodeId !== "string" || !body.episodeId) {
        throw new HttpError(400, "\u7F3A\u5C11 episodeId");
      }
      try {
        runner.setMemberConfig(body.episodeId, {
          model: typeof body.model === "string" ? body.model : void 0,
          reasoning: typeof body.reasoning === "string" ? body.reasoning : void 0
        });
        log(`[\u7FA4\u6863\u4F4D] ${parts[2]} ${body.episodeId} model=${String(body.model)} reasoning=${String(body.reasoning)}`);
        sendJson(res, 200, { ok: true, effective: "\u4E0B\u4E00\u56DE\u5408\u63D0\u4EA4\u524D\u5E94\u7528\uFF08set_config_option\uFF09" });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (req.method === "POST" && parts[1] === "groups" && typeof parts[2] === "string" && parts[3] === "readd" && parts.length === 4) {
      const runner = await getGroupRunner(parts[2]);
      const body = await readBody(req);
      if (typeof body.episodeId !== "string" || !body.episodeId) {
        throw new HttpError(400, "\u7F3A\u5C11 episodeId");
      }
      try {
        const member = runner.readdMember(body.episodeId);
        log(`[\u7FA4\u5F52\u961F] ${parts[2]} ${body.episodeId}\uFF08${member.label}\uFF09`);
        sendJson(res, 200, {
          readded: true,
          episodeId: member.episodeId,
          label: member.label,
          sessionReused: Boolean(member.sessionId)
        });
      } catch (err) {
        throw new HttpError(400, err instanceof Error ? err.message : String(err));
      }
      return;
    }
    if (req.method === "DELETE" && parts[1] === "groups" && typeof parts[2] === "string" && !parts[3]) {
      const id = parts[2];
      const runner = groupRunners.get(id);
      if (runner && runner.inFlightEpisodeIds().length > 0) {
        throw new HttpError(409, "\u7FA4\u6709\u5728\u9014\u56DE\u5408\uFF0C\u7B49\u56DE\u5408\u7ED3\u675F\u518D\u5220\u9664");
      }
      runner?.closeAll();
      groupRunners.delete(id);
      const dir = path10.join(opts2.dataDir, "groups", id);
      const st = await fs6.stat(dir).catch(() => null);
      if (!st) throw new HttpError(404, "\u7FA4\u4E0D\u5B58\u5728");
      await fs6.rm(dir, { recursive: true });
      log(`[\u5220\u7FA4] ${id} \u5DF2\u5220\u9664\uFF08\u7528\u6237\u786E\u8BA4\uFF09`);
      sendJson(res, 200, { deleted: true });
      return;
    }
    if (req.method === "GET" && parts[1] === "discussions" && parts.length === 2) {
      sendJson(res, 200, await listDiscussions());
      return;
    }
    if (req.method === "GET" && parts[1] === "fs" && parts[2] === "list" && parts.length === 3) {
      const dirParam = (url2.searchParams.get("dir") ?? "").trim();
      log(`[fs/list] \u6536\u5230\u8BF7\u6C42 dir="${dirParam || "(\u7A7A\u2192\u76D8\u7B26)"}"`);
      if (!dirParam) {
        const roots = await listDrives();
        log(`[fs/list] \u76D8\u7B26\u63A2\u6D4B\u5B8C\u6210: ${roots.join(", ") || "(\u65E0)"}`);
        sendJson(res, 200, { dir: "", parent: null, dirs: roots.map((r) => ({ name: r, path: r })) });
        return;
      }
      const resolved = path10.resolve(dirParam);
      const st = await withTimeout(fs6.stat(resolved), 3e3).catch(() => null);
      if (!st || !st.isDirectory()) throw new HttpError(400, "\u76EE\u5F55\u4E0D\u5B58\u5728\u6216\u4E0D\u662F\u76EE\u5F55");
      const entries = await withTimeout(
        fs6.readdir(resolved, { withFileTypes: true }),
        3e3
      ).catch(() => {
        throw new HttpError(504, "\u76EE\u5F55\u8BFB\u53D6\u8D85\u65F6\u2014\u2014\u76EE\u6807\u76D8\u53EF\u80FD\u79BB\u7EBF\u6216\u4F11\u7720\uFF08AC-23\uFF1A\u4E0D\u5047\u88C5\u80FD\u8BFB\uFF09");
      });
      const dirs = entries.filter((e) => e.isDirectory() && !e.name.startsWith(".")).map((e) => ({ name: e.name, path: path10.join(resolved, e.name) }));
      const parent = path10.dirname(resolved);
      sendJson(res, 200, {
        dir: resolved,
        parent: parent === resolved ? null : parent,
        dirs
      });
      return;
    }
    if (req.method === "POST" && parts[1] === "fs" && parts[2] === "native-pick" && parts.length === 3) {
      const body = await readBody(req).catch(() => ({}));
      const rawStart = typeof body.cwd === "string" && body.cwd.trim() ? body.cwd : opts2.defaultCwd;
      const startDir = rawStart ? path10.resolve(rawStart) : void 0;
      if (nativePickInFlight) throw new HttpError(409, "\u5DF2\u6709\u76EE\u5F55\u9009\u62E9\u5BF9\u8BDD\u6846\u6253\u5F00");
      nativePickInFlight = true;
      try {
        if (opts2.host?.pickDirectory) {
          const picked = await opts2.host.pickDirectory(startDir);
          log(`[native-pick] \u5BBF\u4E3B\u5BF9\u8BDD\u6846\u9009\u62E9: ${picked ?? "(\u5DF2\u53D6\u6D88)"}`);
          sendJson(res, 200, { path: picked ?? null });
          return;
        }
        if (process.platform !== "win32") throw new HttpError(400, "\u539F\u751F\u76EE\u5F55\u9009\u62E9\u5668\u4EC5\u652F\u6301 Windows");
        const script = "Add-Type -AssemblyName System.Windows.Forms;$o = New-Object System.Windows.Forms.Form; $o.TopMost = $true;$f = New-Object System.Windows.Forms.FolderBrowserDialog;$f.Description = '\u9009\u62E9\u8BA8\u8BBA\u7684\u9879\u76EE\u76EE\u5F55';[void]$f.ShowDialog($o);Write-Output $f.SelectedPath";
        log("[native-pick] \u5F39\u51FA\u7CFB\u7EDF\u76EE\u5F55\u9009\u62E9\u5BF9\u8BDD\u6846\uFF0C\u7B49\u5F85\u7528\u6237\u64CD\u4F5C\u2026");
        const out = await new Promise((resolve7, reject) => {
          const child = spawn2("powershell.exe", ["-NoProfile", "-STA", "-Command", script], {
            windowsHide: true
          });
          let buf = "";
          child.stdout.on("data", (c) => buf += c.toString());
          child.on("error", reject);
          child.on("exit", () => resolve7(buf.trim()));
          setTimeout(() => {
            try {
              child.kill();
            } catch {
            }
            reject(new Error("\u9009\u62E9\u8D85\u65F6\uFF0810 \u5206\u949F\u672A\u64CD\u4F5C\uFF09"));
          }, 6e5).unref();
        });
        log(`[native-pick] \u7528\u6237\u9009\u62E9: ${out || "(\u5DF2\u53D6\u6D88)"}`);
        sendJson(res, 200, { path: out || null });
      } finally {
        nativePickInFlight = false;
      }
      return;
    }
    if (req.method === "POST" && parts[1] === "discussions" && parts.length === 2) {
      if (active) throw new HttpError(409, "\u5DF2\u6709\u8FDB\u884C\u4E2D\u7684\u8BA8\u8BBA\uFF08\xA76.1 \u5355\u573A\u9650\u5236\uFF09");
      const body = await readBody(req);
      const requirementText = String(body.requirement ?? "").trim();
      if (!requirementText) throw new HttpError(400, "\u7F3A\u5C11\u9700\u6C42\u6587\u672C");
      const cwd = path10.resolve(
        String(body.cwd ?? opts2.defaultCwd ?? path10.join(process.cwd(), "stage0", "proj"))
      );
      const hits = scanSensitive(requirementText);
      if (hits.length > 0 && body.allowSensitive !== true) {
        sendJson(res, 400, { error: "\u9700\u6C42\u6587\u672C\u7591\u4F3C\u5305\u542B\u654F\u611F\u6837\u4F8B\uFF08AC-23\uFF09", sensitiveHits: hits });
        return;
      }
      const rawKinds = Array.isArray(body.participants) ? body.participants.map((s) => String(s).trim()).filter(Boolean) : null;
      let kinds;
      if (rawKinds) {
        if (rawKinds.length < 1 || rawKinds.length > 5) {
          throw new HttpError(400, "participants \u9700\u8981 1\u20135 \u6B3E\u5E94\u7528");
        }
        for (const k of rawKinds) {
          if (!(k in REAL_AGENT_PACKAGES) && k !== "mock") {
            throw new HttpError(400, `\u672A\u77E5\u5E94\u7528\u7C7B\u578B\uFF1A${k}\uFF08\u53EF\u7528\uFF1A${Object.keys(REAL_AGENT_PACKAGES).join("\u3001")}\uFF09`);
          }
        }
        kinds = rawKinds;
      } else {
        kinds = opts2.participants.map((p) => p.kind);
      }
      const rawRoles = Array.isArray(body.roles) ? body.roles : [];
      const roles = kinds.map((_, i) => {
        const raw = typeof rawRoles[i] === "string" ? rawRoles[i].trim() : "";
        return raw ? raw.slice(0, 2e3) : null;
      });
      const disc = createDiscussionRecord({
        requirementText,
        cwd,
        participants: kinds.map((kind, i) => ({
          participantId: `participant-${String.fromCharCode(65 + i)}`,
          kind,
          role: roles[i]
        })),
        runMode: body.runMode === "step" ? "step" : "auto",
        maxRounds: Number(body.rounds ?? 1)
      });
      const runner = new DiscussionRunner(opts2.dataDir, disc, log);
      runners.set(disc.id, runner);
      try {
        await runner.checkAccess();
      } catch (err) {
        runner.closeAll();
        runners.delete(disc.id);
        await fs6.rm(path10.join(opts2.dataDir, "discussions", disc.id), {
          recursive: true,
          force: true
        }).catch(() => {
        });
        const raw = String(err);
        const hint = /codex/i.test(raw) && /(sqlite state runtime|arg0|拒绝访问|access is denied)/i.test(raw) ? "\uFF08Codex \u542F\u52A8\u5931\u8D25\uFF1A\u8BF7\u5148\u7ED3\u675F Codex computer-use \u7684 cua_node/node_repl \u540E\u53F0\u8FDB\u7A0B\uFF1B\u672C\u673A\u5E94\u4F7F\u7528 LocalAppData\\SuperAgent\\apps\\codex-acp \u5B89\u88C5\uFF0C\u907F\u514D Documents \u4E0B\u7684 CFA/\u6740\u8F6F\u9650\u5236\u3002\u540C\u5E94\u7528\u591A\u5B9E\u4F8B\u5171\u4EAB ~/.codex\uFF0C\u5FC5\u8981\u65F6\u6539\u7528\u4E0D\u540C\u5E94\u7528\uFF09" : "";
        throw new HttpError(
          400,
          `\u63A5\u5165\u68C0\u67E5\u5931\u8D25\uFF08${disc.participants.map((p) => p.kind).join(" + ")}\uFF09\uFF1A${raw.slice(0, 200)}${hint}`
        );
      }
      sendJson(res, 200, {
        record: disc,
        sensitiveHits: hits,
        configs: runner.getDiscoveredConfigs()
      });
      return;
    }
    if (parts[1] === "discussions" && typeof parts[2] === "string") {
      const id = parts[2];
      if (!/^[A-Za-z0-9._-]+$/.test(id)) throw new HttpError(400, "\u975E\u6CD5\u8BA8\u8BBA ID");
      const action = parts[3];
      if (req.method === "GET" && !action) {
        const record2 = runners.get(id)?.disc ?? await loadDiscussion(opts2.dataDir, id);
        const dir = path10.join(opts2.dataDir, "discussions", id, "artifacts");
        const artifactNames = (await fs6.readdir(dir).catch(() => [])).filter((n) => !n.startsWith("."));
        sendJson(res, 200, {
          record: record2,
          artifactNames,
          active: active?.id === id,
          activeStages: [...ACTIVE_STAGE_SET]
        });
        return;
      }
      if (req.method === "GET" && action === "export") {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        const target = await exportMarkdown(opts2.dataDir, record2);
        const md2 = await fs6.readFile(target, "utf8");
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${id}-export.md"`
        });
        res.end(md2);
        return;
      }
      if (req.method === "GET" && action === "brief-path") {
        const briefPath = path10.resolve(
          opts2.dataDir,
          "discussions",
          id,
          "artifacts",
          "final-brief.md"
        );
        const st = await fs6.stat(briefPath).catch(() => null);
        if (!st) throw new HttpError(404, "\u6267\u884C\u8F93\u5165\u5C1A\u672A\u751F\u6210\uFF08\u5E94\u7528\u51B3\u7B56\u540E\u81EA\u52A8\u751F\u6210\uFF09");
        sendJson(res, 200, { path: briefPath });
        return;
      }
      if (req.method === "GET" && action === "brief") {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        const briefPath = path10.join(
          opts2.dataDir,
          "discussions",
          id,
          "artifacts",
          "final-brief.md"
        );
        const md2 = await fs6.readFile(briefPath, "utf8").catch(() => {
          throw new HttpError(404, "\u6267\u884C\u8F93\u5165\u5C1A\u672A\u751F\u6210\uFF08\u5E94\u7528\u51B3\u7B56\u540E\u81EA\u52A8\u751F\u6210\uFF09");
        });
        res.writeHead(200, {
          "content-type": "text/markdown; charset=utf-8",
          "content-disposition": `attachment; filename="${id}-brief.md"`
        });
        res.end(md2);
        return;
      }
      if (req.method === "GET" && action === "artifact") {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        sendJson(res, 200, await artifactPayload(record2, url2.searchParams.get("name") ?? ""));
        return;
      }
      if (req.method !== "POST") throw new HttpError(405, "\u65B9\u6CD5\u4E0D\u5141\u8BB8");
      const body = await readBody(req);
      if (action === "confirm" || action === "resume") {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        try {
          assertResumable(record2.stage);
        } catch (err) {
          throw new HttpError(409, err instanceof Error ? err.message : String(err));
        }
        if (active && active.id !== id) throw new HttpError(409, "\u5DF2\u6709\u8FDB\u884C\u4E2D\u7684\u8BA8\u8BBA\uFF08\xA76.1 \u5355\u573A\u9650\u5236\uFF09");
        if (active?.id === id) {
          sendJson(res, 200, { started: true, alreadyRunning: true });
          return;
        }
        const runner = getOrCreateRunner(record2);
        if (action === "confirm") {
          if (runner.disc.stage === "paused" || isRunningStage(runner.disc.stage)) {
            throw new HttpError(409, `\u5F53\u524D\u9636\u6BB5 ${runner.disc.stage} \u4E0D\u80FD\u76F4\u63A5\u786E\u8BA4\u542F\u52A8\uFF1B\u8BF7\u7528\u6062\u590D`);
          }
          try {
            await runner.connect();
          } catch (err) {
            throw new HttpError(400, `\u63A5\u5165\u68C0\u67E5\u5931\u8D25\uFF1A${String(err).slice(0, 200)}`);
          }
          if (body.runMode === "step" || body.runMode === "auto") {
            runner.disc.runMode = body.runMode;
          }
          if (body.participantConfigs && typeof body.participantConfigs === "object" && !Array.isArray(body.participantConfigs)) {
            try {
              runner.applyParticipantConfigs(
                body.participantConfigs
              );
              await persistDiscussion(opts2.dataDir, runner.disc);
            } catch (err) {
              throw new HttpError(400, `\u6863\u4F4D\u914D\u7F6E\u65E0\u6548\uFF1A${String(err).slice(0, 240)}`);
            }
          }
          startBackground(id, runner);
          sendJson(res, 200, { started: true });
          return;
        }
        if (isRunningStage(runner.disc.stage)) {
          await runner.markRestartPaused();
          sendJson(res, 400, {
            error: "\u670D\u52A1\u91CD\u542F\u540E\u5148\u6682\u505C\u6838\u5BF9\uFF08\xA712.3\uFF09",
            needsRestartReview: true,
            pauseReason: runner.disc.pauseReason
          });
          return;
        }
        const gate = await runner.prepareResume({
          recoveryConfirmed: body.recoveryConfirmed === true,
          voidGhosts: body.voidGhosts === true
        }).catch((err) => {
          throw new HttpError(
            400,
            `\u6062\u590D\u5931\u8D25\uFF08\u91CD\u8FDE/\u6838\u5BF9\uFF09\uFF1A${String(err).slice(0, 240)}`
          );
        });
        if (!gate.ok) {
          if (gate.kind === "restart_review") {
            sendJson(res, 400, {
              error: "\u670D\u52A1\u91CD\u542F\u540E\u5148\u6682\u505C\u6838\u5BF9\uFF08\xA712.3\uFF09",
              needsRestartReview: true,
              pauseReason: gate.pauseReason
            });
          } else if (gate.kind === "ledger") {
            sendJson(res, 400, {
              error: "\u5B58\u5728\u5E7D\u7075\u8D26\uFF1A\u6709\u9884\u7B97\u8BB0\u8D26\u3001\u65E0 attempt \u8BB0\u5F55\uFF1B\u786E\u8BA4\u672A\u63D0\u4EA4\u540E\u53EF\u4F5C\u5E9F",
              needsLedgerReview: gate.entries
            });
          } else {
            sendJson(res, 400, {
              error: "\u5B58\u5728\u65E0\u786E\u5B9A\u7EC8\u6001\u7684\u5C1D\u8BD5\uFF0C\u8BF7\u5148\u5728\u539F\u5E94\u7528\u6838\u5BF9\uFF08AC-13\uFF09",
              needsRecovery: gate.attempts
            });
          }
          return;
        }
        if (body.extraBudget !== void 0) {
          const n = Number(body.extraBudget);
          if (!Number.isInteger(n) || n < 1 || n > 50) {
            throw new HttpError(400, `extraBudget \u987B\u4E3A 1-50 \u7684\u6574\u6570\uFF0C\u6536\u5230 ${String(body.extraBudget)}`);
          }
          try {
            await runner.grantExtraBudget(n);
          } catch (err) {
            throw new HttpError(409, err instanceof Error ? err.message : String(err));
          }
        }
        if (body.forceSynthesis === true) {
          try {
            await runner.requestSynthesis();
          } catch (err) {
            throw new HttpError(409, err instanceof Error ? err.message : String(err));
          }
        }
        if (body.nextRound === true) {
          try {
            await runner.armNextRound();
          } catch (err) {
            throw new HttpError(409, err instanceof Error ? err.message : String(err));
          }
        }
        if (gate.shouldRun) {
          startBackground(id, runner);
          sendJson(res, 200, { started: true, stage: gate.stage });
        } else {
          sendJson(res, 200, {
            started: false,
            stage: gate.stage,
            awaitingConfirmation: gate.stage === "awaiting_confirmation"
          });
        }
        return;
      }
      if (action === "synthesize") {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        const runner = getOrCreateRunner(record2);
        try {
          await runner.requestSynthesis();
        } catch (err) {
          throw new HttpError(409, err instanceof Error ? err.message : String(err));
        }
        sendJson(res, 200, { scheduled: true });
        return;
      }
      if (action === "pause") {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        const runner = getOrCreateRunner(record2);
        const result = await runner.interruptAndCancel("\u7528\u6237\u6682\u505C\uFF08\u5DE5\u4F5C\u53F0\uFF09");
        sendJson(res, 200, { paused: true, ...result });
        return;
      }
      if (action === "mode") {
        const mode = body.runMode === "step" ? "step" : "auto";
        const record2 = await loadDiscussion(opts2.dataDir, id);
        const runner = getOrCreateRunner(record2);
        try {
          await runner.setRunMode(mode);
        } catch (err) {
          throw new HttpError(409, err instanceof Error ? err.message : String(err));
        }
        sendJson(res, 200, { runMode: mode });
        return;
      }
      if (action === "message") {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        const runner = getOrCreateRunner(record2);
        const participantId = String(body.participantId ?? "");
        const text = String(body.text ?? "");
        if (!participantId || !text.trim()) {
          throw new HttpError(400, "\u9700\u8981 participantId \u4E0E\u975E\u7A7A text");
        }
        try {
          if (body.mode === "direct") {
            if (participantId === "all") {
              const results = await runner.directMessageAll(text);
              if (body.sticky === true) {
                for (const r of results) {
                  if (r.ok) runner.attachUserDirective(r.participantId, text, { sticky: true });
                }
              }
              sendJson(res, 200, { broadcast: true, carried: body.sticky === true, results });
            } else {
              const r = await runner.directMessage(participantId, text);
              if (body.sticky === true) {
                runner.attachUserDirective(participantId, text, { sticky: true });
              }
              sendJson(res, 200, { sent: true, carried: body.sticky === true, ...r });
            }
          } else {
            runner.attachUserDirective(participantId, text, { sticky: body.sticky === true });
            sendJson(res, 200, { attached: true });
          }
        } catch (err) {
          throw new HttpError(409, err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (action === "stop") {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        const runner = getOrCreateRunner(record2);
        try {
          const result = await runner.stopAndCancel("\u7528\u6237\u7ED3\u675F\uFF08\u5DE5\u4F5C\u53F0\uFF09");
          sendJson(res, 200, { stopped: true, ...result });
        } catch (err) {
          throw new HttpError(409, err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (action === "final-review") {
        const record2 = await loadDiscussion(opts2.dataDir, id);
        const runner = getOrCreateRunner(record2);
        try {
          const r = await runner.finalReview(
            typeof body.reviewerId === "string" && body.reviewerId ? body.reviewerId : void 0
          );
          sendJson(res, 200, { reviewed: true, ...r });
        } catch (err) {
          throw new HttpError(409, err instanceof Error ? err.message : String(err));
        }
        return;
      }
      if (action === "open-folder") {
        const dir = path10.resolve(opts2.dataDir, "discussions", id);
        const st = await fs6.stat(dir).catch(() => null);
        if (!st || !st.isDirectory()) throw new HttpError(404, "\u8BA8\u8BBA\u76EE\u5F55\u4E0D\u5B58\u5728");
        if (opts2.host?.openPath) {
          await opts2.host.openPath(dir);
          log(`[open-folder] \u5BBF\u4E3B\u6253\u5F00: ${dir}`);
          sendJson(res, 200, { opened: true, dir });
          return;
        }
        const child = spawn2("explorer.exe", [dir], { detached: true, stdio: "ignore" });
        child.unref();
        log(`[open-folder] \u6253\u5F00\u8D44\u6E90\u7BA1\u7406\u5668: ${dir}`);
        sendJson(res, 200, { opened: true, dir });
        return;
      }
      if (action === "decisions") {
        if (active?.id === id) throw new HttpError(409, "\u8BA8\u8BBA\u8FD0\u884C\u4E2D\uFF0C\u65E0\u6CD5\u51B3\u7B56");
        const runner = getOrCreateRunner(await loadDiscussion(opts2.dataDir, id));
        const inputs = Array.isArray(body.decisions) ? body.decisions : [];
        const applied = applyDecisions(runner.disc, inputs);
        if (body.finalize === true) finalizeDiscussion(runner.disc);
        await persistDiscussion(opts2.dataDir, runner.disc);
        const briefPath = await regenerateFinalBrief(opts2.dataDir, runner.disc);
        sendJson(res, 200, {
          applied,
          grade: runner.disc.grade ?? null,
          stage: runner.disc.stage,
          briefPath
        });
        return;
      }
    }
    throw new HttpError(404, "not found");
  }
  const server = createServer((req, res) => {
    log(`[req] ${req.method} ${req.url} (Host: ${req.headers.host ?? "\u65E0"})`);
    if (!securityCheck(req, res)) return;
    route(req, res).then(() => log(`[done] ${req.method} ${req.url}`)).catch((err) => {
      if (err instanceof HttpError) {
        log(`[http ${err.status}] ${req.method} ${req.url}: ${err.message}`);
        sendJson(res, err.status, { error: err.message, ...err.extra !== void 0 ? { extra: err.extra } : {} });
        return;
      }
      log(`[\u670D\u52A1\u5668\u9519\u8BEF] ${req.method} ${req.url}: ${String(err).slice(0, 300)}`);
      if (!res.headersSent) sendJson(res, 500, { error: "\u5185\u90E8\u9519\u8BEF" });
      else res.end();
    });
  });
  return {
    server,
    get port() {
      return boundPort;
    },
    close() {
      for (const runner of runners.values()) runner.closeAll();
      for (const runner of groupRunners.values()) runner.closeAll();
      void fs6.readFile(portfile, "utf8").then((t) => {
        const cur = t.trim();
        if (cur === String(boundPort)) return fs6.rm(portfile, { force: true });
        try {
          const j = JSON.parse(cur);
          if (j.pid === process.pid && j.port === boundPort) return fs6.rm(portfile, { force: true });
        } catch {
        }
        return void 0;
      }).catch(() => {
      });
      return new Promise((resolve7) => server.close(() => resolve7()));
    },
    async listen() {
      await fs6.mkdir(opts2.dataDir, { recursive: true });
      await recoverInterruptedDiscussions();
      await new Promise((resolve7, reject) => {
        server.once("error", reject);
        server.listen(boundPort, "127.0.0.1", () => resolve7());
      });
      const addr = server.address();
      boundPort = typeof addr === "object" && addr ? addr.port : boundPort;
      await fs6.writeFile(
        portfile,
        JSON.stringify({ port: boundPort, pid: process.pid, startedAt: (/* @__PURE__ */ new Date()).toISOString() }),
        "utf8"
      ).catch(() => {
      });
      return boundPort;
    }
  };
}
function withTimeout(p, ms) {
  return Promise.race([
    p,
    new Promise(
      (_, rej) => setTimeout(() => rej(new Error(`IO \u8D85\u65F6\uFF08${ms}ms\uFF09\u2014\u2014\u76EE\u6807\u76D8\u53EF\u80FD\u79BB\u7EBF\u6216\u4F11\u7720`)), ms)
    )
  ]);
}
async function listDrives() {
  if (process.platform !== "win32") return ["/"];
  const probe = async (letter) => {
    const drive = `${letter}:\\`;
    try {
      await withTimeout(fs6.access(drive), 500);
      return drive;
    } catch {
      return null;
    }
  };
  const results = await Promise.all(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map(probe)
  );
  return results.filter((x) => x !== null);
}
function defaultParticipants() {
  return [
    { participantId: "participant-A", kind: "codex-acp" },
    { participantId: "participant-B", kind: "dsh" }
  ];
}
function workbenchOptionsFromEnv(repoRoot3) {
  const dataDir = resolveDataDir();
  const publicDir = path10.join(repoRoot3, "packages", "workbench", "public");
  const participantsEnv = process.env.SUPER_WORKBENCH_PARTICIPANTS;
  const participants = participantsEnv ? JSON.parse(participantsEnv) : defaultParticipants();
  return {
    dataDir,
    publicDir,
    participants,
    port: Number(process.env.SUPER_WORKBENCH_PORT ?? "7980"),
    log: (m) => console.log(m)
  };
}

// ../../super-agent-zcode/packages/workbench/src/engine-entry.ts
function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return err?.code === "EPERM";
  }
}
try {
  const raw = fs7.readFileSync(path11.join(resolveDataDir(), "workbench.port"), "utf8").trim();
  try {
    const j = JSON.parse(raw);
    if (typeof j.pid === "number" && pidAlive(j.pid)) {
      console.log(`[\u5F15\u64CE] \u68C0\u6D4B\u5230\u5B58\u6D3B\u5B9E\u4F8B\uFF08pid ${j.pid}\uFF0C\u7AEF\u53E3 ${j.port}\uFF09\u2014\u2014\u8BA9\u4F4D\u9000\u51FA`);
      process.exit(0);
    }
  } catch {
  }
} catch {
}
var opts = workbenchOptionsFromEnv(path11.resolve(import.meta.dirname ?? ".", "..", "..", ".."));
if (process.env.SUPER_WORKBENCH_PUBLIC_DIR) opts.publicDir = process.env.SUPER_WORKBENCH_PUBLIC_DIR;
if (!process.env.SUPER_WORKBENCH_PORT) opts.port = 0;
var wb = createWorkbenchServer(opts);
try {
  const port = await wb.listen();
  console.log(`[\u5F15\u64CE] \u5DF2\u542F\u52A8\uFF1Ahttp://127.0.0.1:${port}\uFF08\u6570\u636E\u76EE\u5F55 ${opts.dataDir}\uFF09`);
  process.on("SIGTERM", () => {
    void Promise.race([wb.close(), new Promise((r) => setTimeout(r, 3e3))]).finally(() => process.exit(0));
  });
} catch (err) {
  console.error(`[\u5F15\u64CE] \u76D1\u542C\u5931\u8D25\uFF1A${String(err)}`);
  process.exitCode = 1;
}
