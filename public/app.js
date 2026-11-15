/* Super Agent 工作台（零构建原生 JS 单页；仅回环访问，AC-26） */
"use strict";

const $ = (sel) => document.querySelector(sel);
const state = {
  connFail: false,
  retryMs: null,
  list: [],
  currentId: null,
  record: null,
  artifactNames: [],
  active: false,
  activeStages: new Set(),
  tab: null,
  viewMode: "raw", // raw | parsed
  timer: null,
  // 新建表单：参与者与目录选择器状态
  agentList: [],
  defaultPair: [],
  participantKinds: [],
  participantRoles: [],
  templates: [],
  newFormRunMode: null, // D-30：模板带入的运行模式（确认页默认勾选分步）
  newFormCwd: "",
  pickerDir: "",
  pickerParent: null,
  // 防闪烁：指纹与渲染缓存
  lastListFp: null,
  lastDiscFp: null,
  viewerCache: null,
  renderedViewerKey: null,
  renderedDecisionsKey: null,
  renderedHeadKey: null,
  renderedStagebarKey: null,
  renderedTabsKey: null,
  renderedActionsKey: null,
  msgRenderedFor: null,
  // 恢复门禁的已确认项（重启核对 / 幽灵账 / 未确认尝试可叠加）
  resumeFlags: { recoveryConfirmed: false, voidGhosts: false },
};

const STAGE_LABELS = [
  ["proposing", "提案"],
  ["reviewing", "互评"],
  ["responding", "修订"],
  ["rechecking", "复核"],
  ["synthesizing", "综合"],
  ["awaiting_decisions", "决策"],
];

/* 产物标签页流程顺序：提案→互评→修订→复核→综合 */
const PHASE_ORDER = { proposal: 0, review: 1, revision: 2, recheck: 3, synthesis: 4, final: 5 };

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

async function api(path, opts = {}) {
  // 客户端超时：默认 10s；native-pick 等长交互可传 timeoutMs 放宽
  const { timeoutMs = 10_000, ...rest } = opts;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const r = await fetch(path, { ...rest, signal: ctrl.signal });
    const body = await r.json().catch(() => ({}));
    if (!r.ok) {
      const err = new Error(body.error || `HTTP ${r.status}`);
      err.body = body;
      throw err;
    }
    return body;
  } catch (e) {
    if (e.name === "AbortError") {
      throw new Error(`请求超时（${timeoutMs / 1000} 秒）——服务可能已重启或无响应，请刷新页面后重试`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function post(path, data, opts = {}) {
  return api(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data ?? {}),
    ...opts,
  });
}

/* ---------------- 列表 ---------------- */

async function refreshList() {
  const d = await api("/api/discussions");
  // 指纹含 currentId：切换选中卡片必须重画高亮（否则 sel 永远停在首次渲染的那张）
  const fp = JSON.stringify([d, state.currentId]);
  if (fp === state.lastListFp) return; // 列表与选中态均无变化：不动 DOM（防闪烁）
  state.lastListFp = fp;
  state.list = d.discussions;
  const el = $("#disc-list");
  el.innerHTML = state.list
    .map(
      (x) => `
    <div class="disc-item ${x.id === state.currentId ? "sel" : ""}" data-id="${esc(x.id)}">
      <div><strong>${esc(x.requirementPreview)}</strong></div>
      <div class="muted small">${esc(x.id.slice(0, 18))}… · 额度 ${x.budgetUsed}</div>
      <div>${stageBadge(x.stage)} ${x.grade ? `<span class="badge ok">${esc(x.grade)}</span>` : ""}</div>
    </div>`,
    )
    .join("");
  for (const node of el.querySelectorAll(".disc-item")) {
    node.addEventListener("click", () => openDisc(node.dataset.id));
  }
}

function stageBadge(stage) {
  const cls = /proposing|reviewing|responding|rechecking|synthesizing|checking/.test(stage)
    ? "run"
    : stage === "completed"
      ? "ok"
      : stage === "paused" || stage === "interrupted" || stage === "awaiting_decisions"
        ? "warn"
        : stage === "failed" || stage === "stopped" || stage === "closed"
          ? "bad"
          : "";
  const label =
    stage === "interrupted" ? "已中断（可恢复）" : stage === "closed" ? "已关闭" : stage;
  return `<span class="badge ${cls}">${esc(label)}</span>`;
}

/* ---------------- 详情 ---------------- */

async function openDisc(id, { silent = false } = {}) {
  try {
    const d = await api(`/api/discussions/${id}`);
    markConnOk();
    // 无变化轮询：指纹相同就完全不碰 DOM（防内容区闪烁）
    const fp = JSON.stringify([d.record, d.artifactNames, d.active]);
    if (silent && fp === state.lastDiscFp) {
      schedulePoll();
      return;
    }
    state.lastDiscFp = fp;
    state.currentId = id;
    try { sessionStorage.setItem("wbLastDisc", id); } catch {}
    state.record = d.record;
    state.artifactNames = d.artifactNames;
    state.active = d.active;
    state.activeStages = new Set(Array.isArray(d.activeStages) ? d.activeStages : []);
    // 记录/产物变化时使缓存失效
    state.viewerCache = null;
    state.renderedViewerKey = null;
    if (!state.tab || !state.artifactNames.includes(state.tab)) {
      state.tab = state.artifactNames[0] ?? null;
      state.viewMode = "raw";
    }
    if (!silent) {
      $("#empty").hidden = true;
      $("#view").hidden = false;
      $("#confirm-panel").hidden = true;
      $("#new-form").hidden = true;
      state.resumeFlags = { recoveryConfirmed: false, voidGhosts: false };
      // 用户主动打开：强制全量重渲染，避免上一场遗留的按钮状态（如“删除中…”）串场
      state.renderedHeadKey = null;
      state.renderedStagebarKey = null;
      state.renderedActionsKey = null;
      state.renderedTabsKey = null;
      state.renderedDecisionsKey = null;
      state.renderedViewerKey = null;
    }
    render();
    refreshList().catch(() => {});
    schedulePoll();
  } catch (err) {
    // 静默轮询失败：自愈——不清游标、退避重试；只有主动打开失败才提示
    if (!silent) showBanner(`加载失败：${err.message}`);
    else markConnFail();
  }
}

function schedulePoll() {
  clearTimeout(state.timer);
  if (!state.currentId) return;
  const stage = state.record?.stage;
  const busy =
    state.active || (stage && state.activeStages.has(stage)) || stage === "checking";
  // 常驻 iframe 切走（document.hidden）降频 30s；连接故障期退避重试；正常期原节奏
  const delay = state.connFail
    ? (state.retryMs ?? 1000)
    : document.hidden
      ? 30000
      : busy
        ? 1500
        : 6000;
  state.timer = setTimeout(() => openDisc(state.currentId, { silent: true }), delay);
}

// 回到前台立即拉一次并恢复原节奏（keep-alive 下面板切走期间轮询已降频）
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.currentId) {
    clearTimeout(state.timer);
    openDisc(state.currentId, { silent: true });
  }
});

/** 连接故障：只在状态翻转时弹一次横幅；游标保持，schedulePoll 按退避间隔重试 */
function markConnFail() {
  state.retryMs = Math.min((state.retryMs ?? 500) * 2, 15000);
  if (!state.connFail) {
    state.connFail = true;
    showBanner("连接中断，自动重试中……（workbench 可能正在重启）", "warn");
  }
  schedulePoll();
}

function markConnOk() {
  if (state.connFail) {
    state.connFail = false;
    state.retryMs = null;
    showBanner("已重连。", "ok");
  }
}

function showBanner(text, kind) {
  const el = $("#banner");
  el.textContent = text;
  el.className = `banner ${kind === "ok" ? "ok" : kind === "warn" ? "warn" : ""}`.trimEnd();
  el.hidden = false;
}

function render() {
  const r = state.record;
  if (!r) return;

  /* 头部（无变化不重建，防轮询闪烁） */
  const gradeHtml = r.grade
    ? ` <span class="badge ok">产物等级：${esc(r.grade)}</span>`
    : "";
  const voided = r.budget.voidedEntries?.length ?? 0;
  const usedExtra = (r.budget.entries ?? []).filter((e) => e.kind === "extra").length;
  const extraTotal = r.budget.extraTotal ?? 0;
  const headHtml = `
    <div>${reqBlock(r)}
      ${stageBadge(r.stage)}${gradeHtml}</div>
    <div class="muted small">${esc(r.id)} · 需求 ${esc(r.requirementVersion)} · cwd ${esc(r.cwd)}</div>
    <div class="muted small">
      ${r.participants.map((p) => participantLabel(p, r.synthesizerId)).join(" ｜ ")}
      ｜ 预算 ${r.budget.entries.length}/${r.budget.normalTotal}（保留综合 1）· 修复 ${r.budget.fixTotal}${extraTotal > 0 ? ` · 追加 ${usedExtra}/${extraTotal}` : ""}${voided ? ` · 作废 ${voided}` : ""} · 轮 ${r.roundsCompleted ?? 0}/${r.maxRounds ?? 1}${r.synthesisForced ? " · 用户跳过部分阶段直接综合" : ""}
    </div>
    ${r.pauseReason ? `<div class="banner">${r.pauseKind === "restart" ? "服务重启待核对：" : r.stage === "interrupted" ? "已中断（在途任务已取消，可恢复）：" : r.pauseKind === "budget" ? "额度耗尽（可追加后继续）：" : r.pauseKind === "round" ? "轮次边界（可开启下一轮或直接综合）：" : "暂停/结束原因："}${esc(r.pauseReason)}</div>` : ""}`;
  const headKey = JSON.stringify([r.stage, r.grade, r.pauseReason, r.pauseKind, r.budget.entries.length, voided, extraTotal, state.active]);
  if (state.renderedHeadKey !== headKey) {
    $("#head").innerHTML = headHtml;
    state.renderedHeadKey = headKey;
  }

  /* 阶段进度 */
  const counts = stageCounts(r);
  const curIdx = STAGE_LABELS.findIndex(([s]) => s === r.stage);
  const stageHtml = STAGE_LABELS.map(([s, label], i) => {
    const c = counts[s];
    const done = curIdx > i || (s === "awaiting_decisions" && r.stage === "completed");
    const cur = s === r.stage;
    return `<span class="stage ${done ? "done" : ""} ${cur ? "cur" : ""}">${label}${c ? ` ${c}` : ""}</span>`;
  }).join("");
  if (state.renderedStagebarKey !== stageHtml) {
    $("#stagebar").innerHTML = stageHtml;
    state.renderedStagebarKey = stageHtml;
  }

  /* 操作按钮 */
  const busy = state.active || state.activeStages.has(r.stage);
  const terminalStages = ["completed", "stopped", "closed", "failed", "reviewed"];
  const btns = [];
  if (r.stage === "awaiting_confirmation") {
    btns.push(`<button class="primary" id="btn-confirm">确认启动（消耗额度）</button>`);
  }
  if (r.stage === "paused") {
    const done = r.roundsCompleted ?? 0;
    // D-29：一轮跑完（roundsCompleted≥1）且未达 3 轮上限 → 任意暂停处都可加一轮（动态抬高计划）
    const canAddRound = done >= 1 && done < 3 && !r.synthesis;
    if (r.pauseKind === "round") {
      // 轮次门：普通“继续”在门上是幂等空转，用加轮按钮替代
      if (canAddRound) {
        btns.push(`<button class="primary" id="btn-next-round">开启第 ${done + 1} 轮互评</button>`);
      }
    } else {
      const stepHint = r.runMode === "step" ? "下一步" : "只调度未完成任务";
      const budgetHint = r.pauseKind === "budget" ? "需追加额度…" : stepHint;
      btns.push(`<button class="primary" id="btn-resume">继续（${budgetHint}）</button>`);
      if (canAddRound) {
        btns.push(`<button id="btn-next-round">开启第 ${done + 1} 轮互评</button>`);
      }
    }
  }
  if (r.stage === "interrupted") {
    const budgetHint = r.pauseKind === "budget" ? "需追加额度…" : "重调度未完成任务";
    btns.push(`<button class="primary" id="btn-resume">恢复执行（${budgetHint}）</button>`);
  }
  // 服务重启等导致执行中断（非终态且无活跃运行）→ 提供接续入口
  const executableStages = ["proposing", "reviewing", "responding", "rechecking", "synthesizing"];
  if (!busy && !r.stage.startsWith("awaiting") && executableStages.includes(r.stage)) {
    btns.push(`<button class="primary" id="btn-resume">继续（接续未完成的执行）</button>`);
  }
  if (busy && !terminalStages.includes(r.stage)) {
    btns.push(`<button id="btn-pause">暂停</button>`);
    btns.push(`<button class="danger" id="btn-stop">结束</button>`);
  }
  // D-27 直接综合：全部提案完成且尚未综合（非终态、非决策页）
  const allProposalsDone = (r.participants ?? []).every(
    (p) => r.proposalVersions?.[p.participantId],
  );
  if (
    !terminalStages.includes(r.stage) &&
    r.stage !== "awaiting_confirmation" &&
    !r.synthesis &&
    allProposalsDone
  ) {
    btns.push(`<button id="btn-synthesize">直接综合…（跳过剩余阶段）</button>`);
  }
  // D-26 运行模式开关（非终态可切换；下一步边界生效）
  if (!terminalStages.includes(r.stage)) {
    btns.push(
      `<label class="mode-switch small">模式
        <select id="mode-select">
          <option value="auto" ${r.runMode !== "step" ? "selected" : ""}>全自动</option>
          <option value="step" ${r.runMode === "step" ? "selected" : ""}>分步（每步后暂停）</option>
        </select>
      </label>`,
    );
  }
  // SYN-09 交叉终审：综合完成且非运行中时可用（手动触发，走修复/追加额度）
  if (r.synthesis && !terminalStages.includes(r.stage) && !busy) {
    btns.push(`<button id="btn-final-review">交叉终审…</button>`);
  }
  btns.push(`<button id="btn-openfolder">打开本地文件夹</button>`);
  btns.push(`<button class="danger" id="btn-delete">删除讨论</button>`);
  const actionsKey = btns.join("|");
  if (state.renderedActionsKey !== actionsKey) {
    $("#actions").innerHTML = btns.join("");
    state.renderedActionsKey = actionsKey;
    // 绑定必须只在 innerHTML 替换后做一次：轮询对同一元素重复 bind 会累积监听器，
    // 点一次按钮发出 N 个请求（真实使用中曾一次“恢复”触发 10 个 POST）
    bindActionButtons(r);
  }
  renderMsgCard(r);

  /* 标签页（按实际发生时间排序：用户中间发的消息插在对应阶段之间；执行输入恒置顶） */
  const times = artifactTimeIndex(r);
  const ordered = [...state.artifactNames].sort((x, y) => {
    if (x.startsWith("final-brief")) return -1;
    if (y.startsWith("final-brief")) return 1;
    const tx = times.get(x);
    const ty = times.get(y);
    if (tx && ty && tx !== ty) return tx < ty ? -1 : 1;
    if (tx !== ty) return tx ? -1 : 1; // 一方无时间戳：有时间戳者按真实发生时间在前
    const pr = phaseRank(x) - phaseRank(y);
    return pr !== 0 ? pr : x < y ? -1 : 1;
  });
  const tabsHtml = ordered
    .map((n) => `<button data-name="${esc(n)}" class="${n === state.tab ? "sel" : ""}">${esc(friendlyName(n))}</button>`)
    .join("");
  const tabsKey = `${state.tab}|${ordered.join(",")}`;
  if (state.renderedTabsKey !== tabsKey) {
    $("#tabs").innerHTML = tabsHtml;
    state.renderedTabsKey = tabsKey;
    for (const b of $("#tabs").querySelectorAll("button")) {
      b.addEventListener("click", () => {
        state.tab = b.dataset.name;
        state.viewMode = "raw";
        render();
      });
    }
  }

  renderViewer();
  renderDecisions();
}

function participantLabel(p, synthesizerId) {
  const kindName =
    p.kind === "codex-acp" ? "codex-acp（适配器）" : p.kind === "dsh" ? "dsh（官方原生）" : p.kind;
  const role = synthesizerId && p.participantId === synthesizerId ? "（综合者）" : "";
  return `${esc(p.participantId)}=${esc(kindName)}${role}`;
}

/** 需求原文：超长时折叠，点击展开（原生 details，轮询不重置展开状态） */
function reqBlock(r) {
  const full = esc(r.requirementText);
  if (r.requirementText.length <= 80) return `<strong>${full}</strong>`;
  return `<details class="req"><summary><strong>${esc(r.requirementText.slice(0, 80))}…</strong>
    <span class="muted small">（点击展开全文，共 ${r.requirementText.length} 字）</span></summary>
    <div class="req-full">${full}</div></details>`;
}

function stageCounts(r) {
  const participants = r.participants.map((p) => p.participantId);
  const n = participants.length;
  const round = Math.min(
    Math.max(1, (r.roundsCompleted ?? 0) + 1),
    r.maxRounds ?? 1,
  );
  const reviews = (r.reviewRelations ?? []).filter(
    (x) => x.phase === "review" && x.round === round,
  );
  const rechecks = (r.recheckRelations ?? []).filter(
    (x) => x.valid && x.round === round,
  );
  const revisions = (r.revisionRelations ?? []).filter(
    (x) => x.valid && x.round === round,
  );
  const revisionCount =
    revisions.length > 0
      ? revisions.length
      : Object.keys(r.responseVersions ?? {}).length;
  return {
    proposing: `${participants.filter((p) => r.proposalVersions[p]).length}/${n}`,
    reviewing: n < 2 ? "—" : `${reviews.length}/${n}`,
    responding: `${Math.min(revisionCount, n)}/${n}`,
    rechecking: n < 2 ? "—" : `${rechecks.length}/${n}`,
    synthesizing: r.synthesis ? "1" : "",
    awaiting_decisions: `${r.decisions.filter((d) => d.status === "接受").length}/${r.decisions.length}`,
  };
}

function phaseRank(name) {
  if (name.startsWith("final-brief")) return -1; // 执行输入置顶
  const prefix = name.split("-")[0];
  return PHASE_ORDER[prefix] ?? 9;
}

/** 产物名 → 实际发生时间（记账 committedAt / 直发消息 at），用于标签页按时间插值排序 */
function artifactTimeIndex(r) {
  const m = new Map();
  const base = (p) => String(p ?? "").split(/[\\/]/).pop();
  const byAttempt = new Map((r.budget?.entries ?? []).map((e) => [e.attemptId, e]));
  const timeOf = (attemptId) => byAttempt.get(attemptId)?.committedAt;
  for (const rel of r.reviewRelations ?? []) {
    const t = timeOf(rel.attemptId);
    if (t && rel.artifactPath) m.set(base(rel.artifactPath), t);
  }
  for (const rel of r.recheckRelations ?? []) {
    const t = timeOf(rel.attemptId);
    if (t && rel.artifactPath) m.set(base(rel.artifactPath), t);
  }
  for (const rel of r.revisionRelations ?? []) {
    const t = timeOf(rel.attemptId);
    if (t && rel.artifactPath) m.set(base(rel.artifactPath), t);
  }
  for (const e of r.budget?.entries ?? []) {
    if (e.phase === "proposal") m.set(`proposal-${e.participantId}-v1.md`, e.committedAt);
    if (e.phase === "synthesis") m.set("synthesis-v1.md", e.committedAt);
  }
  for (const dm of r.directMessages ?? []) m.set(base(dm.artifactPath), dm.at);
  return m;
}

function friendlyName(name) {
  return name
    .replace(/\.md$/, "")
    .replace(/^final-brief/, "⭐ 执行输入")
    .replace(/^user-message-participant-([A-E])/, "用户消息 $1")
    .replace(/^final-review-participant-([A-E])/, "终审 $1")
    .replace(/^synthesis/, "综合")
    .replace(/^proposal-participant-([A-E])/, "提案 $1")
    .replace(/^revision-participant-([A-E])/, "修订 $1")
    .replace(/^review-participant-([A-E])-on-participant-([A-E])/, "互评 $1→$2")
    .replace(/^recheck-participant-([A-E])-on-participant-([A-E])/, "复核 $1→$2");
}

async function renderViewer() {
  const el = $("#viewer");
  if (!state.tab) {
    el.innerHTML = `<p class="muted">（尚无产物）</p>`;
    state.renderedViewerKey = "";
    return;
  }
  // 渲染键：同名产物 + 同视图模式 + 记录未变 → 完全不动 DOM（轮询不闪烁、滚动位置不丢）
  const key = `${state.currentId}|${state.tab}|${state.viewMode}|${state.record.updatedAt}`;
  if (state.renderedViewerKey === key) return;

  // 内容缓存：同一产物只请求一次
  if (!state.viewerCache || state.viewerCache.name !== state.tab || state.viewerCache.updatedAt !== state.record.updatedAt) {
    el.innerHTML = `<p class="muted">加载中……</p>`;
    try {
      const d = await api(`/api/discussions/${state.currentId}/artifact?name=${encodeURIComponent(state.tab)}`);
      state.viewerCache = { name: state.tab, updatedAt: state.record.updatedAt, raw: d.raw, parsed: d.parsed };
    } catch (err) {
      el.innerHTML = `<p class="muted">产物加载失败：${esc(err.message)}</p>`;
      state.renderedViewerKey = key;
      return;
    }
  }
  const cached = state.viewerCache;
  const toggle = cached.parsed
    ? `<div style="margin:6px 0"><button id="btn-viewmode" class="ghost">当前：${state.viewMode === "raw" ? "原文" : "解析视图"}（点击切换）</button></div>`
    : "";
  const content =
    cached.parsed && state.viewMode === "parsed"
      ? parsedTable(cached.parsed)
      : `<pre>${esc(cached.raw)}</pre>`;
  el.innerHTML = `${toggle}${content}`;
  state.renderedViewerKey = key;
  bind("#btn-viewmode", () => {
    state.viewMode = state.viewMode === "raw" ? "parsed" : "raw";
    renderViewer();
  });
}

function parsedTable(parsed) {
  const table = (head, rows) =>
    `<table class="parsed"><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${
      rows.length ? rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join("")}</tr>`).join("") : `<tr><td colspan="${head.length}" class="muted">（无）</td></tr>`
    }</tbody></table>`;
  if (parsed.kind === "review") {
    return (
      `<p>${esc(parsed.overallVerdict ?? "")}</p>` +
      table(["级别", "类型", "描述", "证据", "建议"], parsed.issues.map((i) => [i.level, i.type, i.description, i.evidence, i.suggestion]))
    );
  }
  if (parsed.kind === "recheck") {
    return (
      table(["意见", "结论", "说明"], parsed.conclusions.map((c) => [c.issueIndex, c.conclusion, c.note])) +
      `<h3>新意见</h3>` +
      table(["级别", "类型", "描述", "建议"], parsed.newIssues.map((i) => [i.level, i.type, i.description, i.suggestion]))
    );
  }
  if (parsed.kind === "responses") {
    return table(["意见", "处置", "说明"], parsed.responses.map((x) => [x.issueIndex, x.disposition, x.note]));
  }
  if (parsed.kind === "decisions") {
    return table(["ID", "内容", "备选", "理由", "来源"], parsed.decisions.map((x) => [x.id, x.content, x.alternatives, x.rationale, x.source]));
  }
  return `<pre>${esc(parsed)}</pre>`;
}

/** 备选方案解析：按 ；/分号/"空格斜杠空格" 切分（不切 、和全角／——它们常在选项内部）；≥2 个才出 chips */
function parseAlternatives(alt) {
  if (!alt) return [];
  const parts = alt
    .replace(/。\s*$/, "")
    .split(/；|;|\s+\/\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  return parts.length >= 2 ? parts : [];
}

function renderDecisions() {
  const r = state.record;
  const el = $("#decisions");
  // 防闪烁：决策/待办无变化不重建（用户正在输入的备注也不会被打断）
  const dkey = JSON.stringify([r.stage, state.active, r.decisions, r.openIssues]);
  if (state.renderedDecisionsKey === dkey) return;
  state.renderedDecisionsKey = dkey;
  const briefReady = r.synthesis && state.artifactNames.includes("final-brief.md");
  const briefCard = briefReady
    ? `<div class="brief-card">
         <strong>⭐ 执行输入已生成</strong> —— 给执行方的最终方案（已并入你的决策，过程材料已剥离）。
         内容见上方「⭐ 执行输入」标签；<button id="brief-copy">复制文件路径</button>
       </div>`
    : "";
  if (!r.decisions || r.decisions.length === 0) {
    el.innerHTML =
      briefCard +
      (r.openIssues && r.openIssues.length
        ? `<h3>待办问题（${r.openIssues.length}）</h3>` +
          `<ul class="small">${r.openIssues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
        : "");
    bindBriefButtons(r);
    return;
  }
  const undecided = r.decisions.filter((d) => d.status === "待决定").length;
  const editable = r.stage === "awaiting_decisions" && !state.active;
  el.innerHTML =
    briefCard +
    `<h3>待决策项（${undecided ? `${undecided} 项未决` : "全部已决"}）</h3>` +
    r.decisions
      .map((d) => {
        const opts = parseAlternatives(d.alternatives);
        const chips =
          editable && opts.length >= 2
            ? `<span class="opts" data-role="opts">` +
              opts
                .map(
                  (o) =>
                    `<button type="button" class="opt-chip ${d.chosenOption === o ? "sel" : ""}" data-opt="${esc(o)}" title="点击接受此备选">${esc(o)}</button>`,
                )
                .join("") +
              `</span>`
            : d.chosenOption
              ? `<span class="badge ok">选定：${esc(d.chosenOption)}</span>`
              : "";
        return `
      <div class="dec-row" data-id="${esc(d.id)}">
        <span class="badge">${esc(d.id)}</span>
        <span class="content">${esc(d.content)}<span class="muted small">　来源：${esc(d.source ?? "")}</span></span>
        ${chips}
        <select data-role="status" ${editable ? "" : "disabled"}>
          ${["待决定", "接受", "修改", "拒绝", "暂缓"].map((s) => `<option ${s === d.status ? "selected" : ""}>${s}</option>`).join("")}
        </select>
        <input type="text" class="note" placeholder="备注（可选）" value="${esc(d.note ?? "")}" ${editable ? "" : "disabled"} />
      </div>`;
      })
      .join("") +
    (editable
      ? `<div class="muted small" style="margin-top:4px">提示：点击备选方案 = 直接以「接受」处置该项；也可用下拉选「修改/拒绝/暂缓」。可分多次应用，随时改了再点。</div>
         <div style="margin-top:8px">
           <button class="primary" id="dec-apply">应用决策</button>
           <button class="ghost" id="dec-finalize-btn" style="margin-left:12px">标记完成（终态，不可重开）</button>
         </div>`
      : "") +
    (r.openIssues && r.openIssues.length
      ? `<h3>待办问题（${r.openIssues.length}，完成不隐藏）</h3>` +
        `<ul class="small">${r.openIssues.map((i) => `<li>${esc(i)}</li>`).join("")}</ul>`
      : "");
  bindBriefButtons(r); // 查看/下载按钮在所有分支都要绑定（此前只在无决策分支绑定导致失灵）
  if (!editable) return;

  // 备选 chips：单选；点选即把状态置为「接受」；状态下拉离开「接受」时清除点选
  for (const row of el.querySelectorAll(".dec-row")) {
    const select = row.querySelector("[data-role=status]");
    const chosen = () => row.dataset.chosen ?? "";
    const syncChips = () => {
      for (const chip of row.querySelectorAll(".opt-chip")) {
        chip.classList.toggle("sel", chip.dataset.opt === chosen());
      }
    };
    syncChips();
    for (const chip of row.querySelectorAll(".opt-chip")) {
      chip.addEventListener("click", () => {
        row.dataset.chosen = chip.dataset.opt;
        select.value = "接受";
        syncChips();
      });
    }
    select.addEventListener("change", () => {
      if (select.value !== "接受") {
        row.dataset.chosen = "";
        syncChips();
      }
    });
  }

  const collectDecisions = () =>
    [...el.querySelectorAll(".dec-row")].map((row) => {
      const status = row.querySelector("[data-role=status]").value;
      const option = status === "接受" ? row.dataset.chosen || undefined : undefined;
      return {
        id: row.dataset.id,
        status,
        option,
        note: row.querySelector(".note").value || undefined,
      };
    });

  bind("#dec-apply", async () => {
    try {
      const resp = await post(`/api/discussions/${r.id}/decisions`, {
        decisions: collectDecisions(),
      });
      showBanner(`已应用 ${resp.applied} 项，产物等级：${resp.grade ?? "未评级"}（可继续修改后再应用）`);
      openDisc(r.id, { silent: true });
    } catch (e) {
      showBanner(`决策失败：${e.message}`);
    }
  });

  // 标记完成是独立动作 + 二次确认（§12.1：终态不可重开；此前勾选框紧挨应用按钮极易误点）
  bind("#dec-finalize-btn", async () => {
    if (
      !(await uiConfirm(
        "标记完成？完成后讨论进入终态（不可原地重开），流程不再推进；当前填写的所有决策会一并应用；需至少 1 项已接受。",
      ))
    )
      return;
    try {
      const resp = await post(`/api/discussions/${r.id}/decisions`, {
        decisions: collectDecisions(),
        finalize: true,
      });
      showBanner(`讨论已完成，产物等级：${resp.grade ?? "未评级"}`);
      openDisc(r.id, { silent: true });
    } catch (e) {
      showBanner(`标记完成失败：${e.message}`);
    }
  });
}

function bindBriefButtons(r) {
  bind("#brief-copy", async () => {
    const btn = $("#brief-copy");
    try {
      const d = await api(`/api/discussions/${r.id}/brief-path`);
      try {
        await navigator.clipboard.writeText(d.path);
      } catch {
        // 剪贴板 API 不可用时兜底
        const ta = document.createElement("textarea");
        ta.value = d.path;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand("copy");
        ta.remove();
      }
      btn.textContent = "✓ 已复制";
      setTimeout(() => (btn.textContent = "复制文件路径"), 1500);
    } catch (e) {
      showBanner(`复制失败：${e.message}`);
    }
  });
}

function bind(sel, fn) {
  const el = document.querySelector(sel);
  if (el) el.addEventListener("click", fn);
}

/** 动作栏按钮绑定：只在 innerHTML 替换后调用一次（轮询对同一元素重复 bind 会累积监听器） */
function bindActionButtons(r) {
  bind("#btn-confirm", () => startRun({}));
  bind("#btn-resume", () => {
    // BUD-08：额度耗尽暂停 → 人主动继续时先弹超额授权，不放行无人值守式自动重试
    if (r.pauseKind === "budget") {
      showExtraBudgetPanel(r);
      return;
    }
    startRun({ resume: true });
  });
  bind("#btn-next-round", () => {
    // D-29：默认预算只覆盖计划轮数——动态加轮若额度不够，直接弹追加面板（提交时携带开启下一轮）
    const entries = r.budget.entries ?? [];
    const usedNormal = entries.filter((e) => e.kind === "normal").length;
    const extraRemaining = (r.budget.extraTotal ?? 0) - entries.filter((e) => e.kind === "extra").length;
    const cost = r.participants.length === 1 ? 1 : r.participants.length * 4;
    const canCover = r.budget.normalTotal - 1 - usedNormal >= cost || extraRemaining >= cost;
    if (!canCover) {
      showExtraBudgetPanel(r, { nextRound: true });
      return;
    }
    startRun({ resume: true, nextRound: true });
  });
  bind("#btn-synthesize", async () => {
    if (
      !(await uiConfirm(
        "跳过剩余阶段（修订/复核/后续轮次），直接用当前产物综合？在途任务会先完成并归档（已记账）；评审意见可能未被回应，综合者会如实标注。",
      ))
    )
      return;
    try {
      if (state.active) {
        await post(`/api/discussions/${r.id}/synthesize`);
        showBanner("已请求直接综合：在途任务完成后于下一阶段边界生效。");
        openDisc(r.id, { silent: true });
      } else {
        await startRun({ resume: true, forceSynthesis: true });
      }
    } catch (e) {
      showBanner(e.message);
    }
  });
  const modeSel = $("#mode-select");
  if (modeSel) {
    modeSel.addEventListener("change", async () => {
      const mode = modeSel.value;
      try {
        await post(`/api/discussions/${r.id}/mode`, { runMode: mode });
        showBanner(
          mode === "step" ? "已切换为分步模式：当前步骤完成后自动暂停。" : "已切换为全自动模式。",
        );
      } catch (e) {
        showBanner(e.message);
      }
      openDisc(r.id, { silent: true });
    });
  }
  bind("#btn-pause", async () => {
    if (
      !(await uiConfirm(
        "暂停并取消在途任务？会立即向在途任务发送 ACP cancel（已消耗额度保留，重试走修复额度）；讨论不结束，可恢复执行。",
      ))
    )
      return;
    const pauseBtn = $("#btn-pause");
    if (pauseBtn) { pauseBtn.disabled = true; pauseBtn.textContent = "取消中…"; }
    try {
      const d = await post(`/api/discussions/${r.id}/pause`);
      showBanner(
        `已中断：在途 ${d.active ?? 0}，取消确认 ${d.cancelled ?? 0}，未确认 ${d.unconfirmed ?? 0}。可点击“恢复执行”重调度未完成任务。`,
      );
    } catch (e) {
      showBanner(e.message);
    }
    openDisc(r.id, { silent: true });
  });
  bind("#btn-stop", async () => {
    if (
      !(await uiConfirm(
        "结束本场讨论？会先向在途任务发送取消并等待终止确认，然后关闭讨论；外部任务仍可能继续运行，终态不能原地重开。",
      ))
    )
      return;
    const stopBtn = $("#btn-stop");
    if (stopBtn) { stopBtn.disabled = true; stopBtn.textContent = "取消中…"; }
    try {
      const d = await api(`/api/discussions/${r.id}/stop`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
        timeoutMs: 60_000,
      });
      showBanner(
        `已关闭：在途 ${d.active ?? 0}，取消确认 ${d.cancelled ?? 0}，未确认 ${d.unconfirmed ?? 0}。外部任务可能仍在运行。`,
      );
    } catch (e) {
      showBanner(e.message);
    }
    openDisc(r.id, { silent: true });
  });
  bind("#btn-delete", async () => {
    if (
      !(await uiConfirm(
        "删除这场讨论？本地记录与产物将一并删除，不可恢复。",
      ))
    )
      return;
    clearTimeout(state.timer); // 停掉在途轮询，避免与删除竞态
    const delBtn = $("#btn-delete");
    delBtn.disabled = true;
    delBtn.textContent = "删除中…";
    // 乐观更新：立即从界面移除，删除请求后台进行
    state.currentId = null;
    try { sessionStorage.removeItem("wbLastDisc"); } catch {}
    state.record = null;
    state.tab = null;
    state.lastDiscFp = null;
    state.renderedViewerKey = null;
    state.renderedDecisionsKey = null;
    $("#view").hidden = true;
    $("#empty").hidden = false;
    try {
      await api(`/api/discussions/${r.id}`, { method: "DELETE" });
      await refreshList();
    } catch (e) {
      showBanner(`删除失败：${e.message}（列表已恢复，可重试）`);
      await refreshList();
    } finally {
      delBtn.disabled = false;
      delBtn.textContent = "删除讨论";
    }
  });
  bind("#btn-final-review", async () => {
    const reviewer =
      r.participants.find((p) => p.participantId !== r.synthesizerId)?.participantId ??
      r.synthesizerId;
    if (
      !(await uiConfirm(
        `交叉终审：由 ${reviewer}（非综合者）对综合方案做一次独立审查？1 次调用，走修复/追加额度；结论归档为「终审」产物。`,
      ))
    )
      return;
    const fbBtn = $("#btn-final-review");
    const orig = fbBtn ? fbBtn.textContent : "";
    if (fbBtn) { fbBtn.disabled = true; fbBtn.classList.add("loading"); fbBtn.innerHTML = `<span class="spinner"></span>终审中… 0s`; }
    // 真实调用（自动重连 + 完整一轮），单任务上限 10 分钟——前端超时放宽到 620s，并显示已等待秒数
    const frTimer = setInterval(() => {
      if (!fbBtn) return;
      const m = fbBtn.textContent.match(/(\d+)s/);
      const sec = m ? Number(m[1]) + 1 : 1;
      fbBtn.innerHTML = `<span class="spinner"></span>终审中… ${sec}s`;
    }, 1000);
    try {
      const resp = await post(`/api/discussions/${r.id}/final-review`, {}, { timeoutMs: 620_000 });
      showBanner(`终审完成（${resp.reviewer}）：${resp.verdict}，见产物区「终审」`);
    } catch (e) {
      showBanner(`终审失败：${e.message}`);
    }
    // 无论成败都恢复按钮（此前成功路径漏恢复，spinner 永久留在动作栏）
    clearInterval(frTimer);
    if (fbBtn) { fbBtn.disabled = false; fbBtn.classList.remove("loading"); fbBtn.textContent = orig; }
    if (resp) openDisc(r.id, { silent: true });
  });
  bind("#btn-openfolder", async () => {
    try {
      const d = await post(`/api/discussions/${r.id}/open-folder`);
      showBanner(`已在资源管理器打开：${d.dir}`);
    } catch (e) {
      showBanner(`打开失败：${e.message}`);
    }
  });
}

/** D-27 消息卡片：给特定 agent 发消息（附着=随下次任务携带；直发=立即对话）。
 *  整卡只在切换讨论时重建一次（轮询只更新按钮可用态），避免输入框内容被轮询清空。 */
function renderMsgCard(r) {
  const area = $("#msg-area");
  if (!area) return;
  const terminal = ["completed", "stopped", "closed", "failed", "reviewed"].includes(r.stage);
  area.hidden = terminal || !r.participants?.length;
  if (area.hidden) return;
  if (state.msgRenderedFor !== r.id) {
    area.innerHTML = `
      <div class="msg-card">
        <div class="muted small">给参与者发消息（全文留痕，不占额度）。所有消息持续进入目标之后的所有任务上下文，直到讨论结束（会话复用开启时直发内容同时自然入会话历史；持续携带另防“任务失败重置会话/综合独立新会话”）</div>
        <div class="msg-row">
          <select id="msg-target">
            <option value="all">全部参与者（广播）</option>
            ${r.participants
              .map(
                (p, i) =>
                  `<option value="${esc(p.participantId)}">参与者 ${String.fromCharCode(65 + i)}（${esc(p.kind)}）</option>`,
              )
              .join("")}
          </select>
          <textarea id="msg-text" rows="2" placeholder="输入要发给 agent 的消息……（改需求建议：广播 + 持续携带）"></textarea>
        </div>
        <div class="msg-actions">
          <button id="msg-attach">带给后续任务</button>
          <button id="msg-direct">立即对话</button>
        </div>
        <div id="msg-status" class="small muted" hidden></div>
      </div>`;
    const pidLabel = Object.fromEntries(
      r.participants.map((p, i) => [p.participantId, `参与者 ${String.fromCharCode(65 + i)}（${p.kind}）`]),
    );
    const send = async (mode) => {
      const participantId = $("#msg-target").value;
      const text = $("#msg-text").value;
      const sticky = true; // D-28：所有用户消息一律持续携带（产品决策，勾选框已移除）
      if (!text.trim()) {
        setStatus("消息内容不能为空", "warn");
        return;
      }
      const btn = $(`#msg-${mode === "direct" ? "direct" : "attach"}`);
      const originalText = btn ? btn.textContent : "";
      if (btn) {
        btn.disabled = true;
        btn.classList.add("loading");
        btn.innerHTML = `<span class="spinner"></span>${
          mode === "direct" ? "发送中…（自动重连并等待回复）" : "记录中…"
        }`;
      }
      setStatus(
        mode === "direct"
          ? participantId === "all"
            ? `已广播给全部 ${r.participants.length} 位参与者，并行等待各自回复（最长 10 分钟）……`
            : "已发出，等待对方回复（最长 10 分钟），成功后输入框会清空。"
          : "记录中……",
        "muted",
      );
      try {
        if (mode === "direct") {
          const resp = await post(
            `/api/discussions/${r.id}/message`,
            { participantId, text, mode: "direct", sticky },
            { timeoutMs: 620_000 },
          );
          if (resp.broadcast) {
            const results = resp.results ?? [];
            const parts = results
              .map((x) =>
                `${pidLabel[x.participantId] ?? x.participantId} ${x.ok ? `✓（${(x.reply ?? "").length} 字）` : `✗（${x.error}）`}`,
              )
              .join("、");
            const oks = results.filter((x) => x.ok).length;
            if (oks === results.length) $("#msg-text").value = "";
            setStatus(
              `已广播 ${oks}/${results.length} 位并归档回复：${parts}${
                oks < results.length ? "。失败的可把左侧目标切到该参与者后单独重发" : ""
              }`,
              oks === results.length ? "ok" : "warn",
            );
          } else {
            $("#msg-text").value = "";
            setStatus(
              `已送达并归档回复（${(resp.reply ?? "").length} 字），见产物区“用户消息”${
                sticky ? "；内容将持续携带到其后续任务" : ""
              }`,
              "ok",
            );
          }
        } else {
          await post(`/api/discussions/${r.id}/message`, {
            participantId,
            text,
            mode: "attach",
            sticky,
          });
          $("#msg-text").value = "";
          setStatus(
            participantId === "all"
              ? "已广播给全部参与者（持续携带到各自后续所有任务）"
              : "已记录：将持续携带到该参与者的所有后续任务",
            "ok",
          );
        }
        openDisc(r.id, { silent: true });
      } catch (e) {
        setStatus(`发送失败：${e.message}（消息已保留，可重试）`, "warn");
      } finally {
        if (btn) {
          btn.disabled = false;
          btn.classList.remove("loading");
          btn.textContent = originalText;
        }
      }
    };
    const setStatus = (text, kind) => {
      const el = $("#msg-status");
      if (!el) return;
      el.textContent = text;
      el.className = `small ${kind === "ok" ? "hint-ok" : kind === "warn" ? "hint-warn" : "muted"}`;
      el.hidden = !text;
    };
    const isSending = () => {
      const b = $("#msg-direct");
      return !!(b && b.classList.contains("loading"));
    };
    $("#msg-target").addEventListener("change", () => {
      if (!isSending()) setStatus("", "muted");
    });
    bind("#msg-attach", () => send("attach"));
    bind("#msg-direct", () => send("direct"));
    state.msgRenderedFor = r.id;
  }
  // 轮询只更新可用态：讨论运行中/该阶段执行中时，“立即对话”不可用（参与者在途任务互斥）
  // 发送中（spinner 转动）不覆盖禁用态，否则轮询会把按钮提前解禁导致重复发送
  const busy = state.active || state.activeStages.has(r.stage);
  const directBtn = $("#msg-direct");
  if (directBtn) directBtn.disabled = busy || directBtn.classList.contains("loading");
  const attachBtn = $("#msg-attach");
  if (attachBtn) attachBtn.disabled = attachBtn.classList.contains("loading");
}

/* ---------------- 新建与启动 ---------------- */

function showNewForm({ keepParticipants = false } = {}) {
  const wasHidden = $("#new-form").hidden;
  $("#empty").hidden = true;
  $("#view").hidden = true;
  $("#confirm-panel").hidden = true;
  $("#new-form").hidden = false;
  $("#nf-warn").hidden = true;
  $("#nf-allow").hidden = true;
  $("#nf-allow-box").checked = false;
  setCwdDisplay();
  if (wasHidden && !keepParticipants) resetParticipantKinds();
  renderParticipantRows();
}

/** 目录选择：优先弹 Windows 原生对话框（系统自带组件）；失败回退网页目录选择器 */
async function pickNative() {
  showBanner("已弹出系统目录选择窗口——请在屏幕上的窗口中选择，确定后这里会自动填入路径。");
  try {
    const d = await api("/api/fs/native-pick", { method: "POST", timeoutMs: 600_000 });
    if (d.path) {
      state.newFormCwd = d.path;
      setCwdDisplay();
      showBanner(`已选择目录：${d.path}`);
    } else {
      showBanner("未选择目录（已取消）。");
    }
  } catch (err) {
    showBanner(`系统选择器不可用（${err.message}），已改用网页目录选择器。`);
    openPicker();
  }
}

function setCwdDisplay() {
  $("#nf-cwd").value = state.newFormCwd;
}

/* ---------------- 目录选择器（服务端目录浏览，浏览器拿不到绝对路径） ---------------- */

async function renderPicker() {
  const list = $("#pk-list");
  list.innerHTML = `<p class="muted">加载中……</p>`;
  try {
    const q = state.pickerDir ? `?dir=${encodeURIComponent(state.pickerDir)}` : "";
    const d = await api(`/api/fs/list${q}`);
    state.pickerParent = d.parent;
    $("#pk-path").textContent = d.dir || "此电脑（选择盘符）";
    $("#pk-up").disabled = !d.parent;
    list.innerHTML =
      d.dirs.length
        ? d.dirs
            .map(
              (x) =>
                `<button type="button" class="pk-item" data-go="${esc(x.path)}">📁 ${esc(x.name)}</button>`,
            )
            .join("")
        : `<p class="muted" style="padding:8px 12px">（没有子目录）</p>`;
    for (const b of list.querySelectorAll("[data-go]")) {
      b.addEventListener("click", () => {
        state.pickerDir = b.dataset.go;
        renderPicker();
      });
    }
    $("#pk-ok").disabled = !state.pickerDir;
  } catch (err) {
    list.innerHTML = `<p class="muted">目录读取失败：${esc(err.message)}</p>`;
    $("#pk-up").disabled = true;
    $("#pk-ok").disabled = true;
  }
}

function openPicker() {
  state.pickerDir = state.newFormCwd || "";
  $("#pk-overlay").hidden = false;
  renderPicker();
}

function closePicker() {
  $("#pk-overlay").hidden = true;
}

/** 页面内确认框（替代原生 confirm：内嵌浏览器的原生对话框存在确定无响应的兼容问题） */
function uiConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "uiconfirm-overlay";
    overlay.innerHTML = `
      <div class="uiconfirm-panel">
        <div class="uiconfirm-msg">${esc(message)}</div>
        <div class="uiconfirm-actions">
          <button class="primary" data-r="ok">确定</button>
          <button class="ghost" data-r="cancel">取消</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    const done = (v) => {
      overlay.remove();
      resolve(v);
    };
    overlay.querySelector('[data-r="ok"]').addEventListener("click", () => done(true));
    overlay.querySelector('[data-r="cancel"]').addEventListener("click", () => done(false));
  });
}

async function createDiscussion() {
  const requirement = $("#nf-req").value.trim();
  const cwd = state.newFormCwd || undefined;
  const allowSensitive = $("#nf-allow-box").checked;
  const rounds = Number($("#nf-rounds")?.value ?? "1");
  const kinds = [...document.querySelectorAll('#nf-participants select[data-role="kind"]')]
    .map((s) => s.value)
    .filter(Boolean);
  const warn = $("#nf-warn");
  if (!state.newFormCwd) {
    warn.textContent = "请先选择项目目录（cwd）：不再使用默认目录，必须由你选定";
    warn.hidden = false;
    return;
  }
  if (kinds.length < 1 || kinds.length > 5) {
    warn.textContent = "参与者需要 1–5 位应用";
    warn.hidden = false;
    return;
  }
  // 防连点：创建期间禁用按钮（此前连点会堆积多场 awaiting_confirmation 记录）
  const createBtn = $("#nf-create");
  if (createBtn.disabled) return;
  createBtn.disabled = true;
  const originalText = createBtn.textContent;
  createBtn.classList.add("loading");
  createBtn.innerHTML = `<span class="spinner"></span>接入检查中…（拉起 ${esc(
    kinds.join(" + "),
  )}，冷启动可能较慢）`;
  try {
    const d = await api("/api/discussions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        requirement,
        cwd,
        allowSensitive,
        participants: kinds,
        roles: state.participantRoles,
        runMode: state.newFormRunMode ?? undefined,
        rounds,
      }),
      timeoutMs: 120_000,
    });
    $("#new-form").hidden = true;
    state.record = d.record;
    state.currentId = d.record.id;
    state.lastDiscFp = null;
    renderConfirmPanel(d.record, d.sensitiveHits ?? [], d.configs ?? {});
    await refreshList();
  } catch (err) {
    if (err.body?.sensitiveHits) {
      const warn = $("#nf-warn");
      warn.innerHTML =
        `敏感样例警告（扫描不保证找全）：<br>` +
        err.body.sensitiveHits.map((h) => `· ${esc(h)}`).join("<br>");
      warn.hidden = false;
      $("#nf-allow").hidden = false;
    } else {
      showNewForm({ keepParticipants: true });
      const warn = $("#nf-warn");
      warn.textContent = `创建失败：${err.message}`;
      warn.hidden = false;
      $("#new-form").hidden = false;
    }
  } finally {
    createBtn.disabled = false; // 无论成败都恢复按钮（防连点期间禁用）
    createBtn.classList.remove("loading");
    createBtn.textContent = originalText;
  }
}

function renderConfirmPanel(record, sensitiveHits, configs = {}) {
  const panel = $("#confirm-panel");
  panel.hidden = false;
  const n = record.participants.length;
  const total = record.budget?.normalTotal ?? 0;
  const fix = record.budget?.fixTotal ?? 2;
  const maxRounds = record.maxRounds ?? 1;
  const composition =
    n === 1
      ? `提案 1 + 计划 ${maxRounds} 轮自评修订 + 综合 1`
      : `提案 ${n} + 计划 ${maxRounds} 轮 × (互评/修订/复核 各 ${n}) + 综合 1；计划跑完后可在轮次边界加一轮（总上限 3）或直接综合`;
  const kinds = record.participants.map((p) => p.kind).join(" + ");
  const configRows = record.participants
    .map((p, i) => {
      const cfg = configs[p.participantId] ?? {};
      const modelOptions = Array.isArray(cfg.modelOptions) ? cfg.modelOptions : [];
      const reasoningOptions = Array.isArray(cfg.reasoningOptions) ? cfg.reasoningOptions : [];
      const hasConfig = modelOptions.length > 0 || reasoningOptions.length > 0;
      const select = (field, label, options, preferred) => {
        if (options.length === 0) return "";
        return `<label>${label}
          <select data-config="${field}" data-pid="${esc(p.participantId)}">
            <option value="">默认档</option>
            ${options
              .map(
                (o) =>
                  `<option value="${esc(o.value)}" ${o.value === preferred ? "selected" : ""}>${esc(o.name)}</option>`,
              )
              .join("")}
          </select>
        </label>`;
      };
      return `<div class="participant-config" data-pid="${esc(p.participantId)}">
        <div><b>参与者 ${i + 1}</b>：${esc(p.participantId)} = ${esc(p.kind)}</div>
        ${
          hasConfig
            ? `<div class="config-row">${select("model", "模型", modelOptions, cfg.flashModelValueId ?? "")}${select("reasoning", "思考强度", reasoningOptions, cfg.reasoningLowValueId ?? "")}</div>`
            : `<div class="muted small">该应用未暴露模型/思考强度档位（按应用默认档）</div>`
        }
      </div>`;
    })
    .join("");
  panel.innerHTML = `
    <h2>确认启动（消耗额度）</h2>
    <div>讨论 ${esc(record.id)} · 接入检查已完成（免费）</div>
    <div class="muted small" style="margin:6px 0">
      参与者：${esc(kinds)}（${n} 位；第一位默认兼任综合者）。<br>
      预算：正常 ${total} 次（${composition}）+ 修复 ${fix}；单任务 10 分钟。<br>
      数据流向：需求文本与目录上下文发给以上应用；同行产物按阶段分发。<br>
      并发：全局上限=参与者数；同应用多实例会并行，可能触发账户限流，失败会暂停并消耗额度。<br>
      保证边界：各应用能力不同（codex 可设 read-only；其他应用按实测能力如实展示）；隔离未验证。<br>
      ${sensitiveHits.length ? `⚠️ 你已确认发送含敏感样例的需求。<br>` : ""}费用：金额未知，走已登录账户计费。
    </div>
    <h3>模型与思考强度</h3>
    <div class="muted small">默认档 = 应用默认/低成本守卫；显式选择会覆盖默认档（codex read-only 模式不变）。</div>
    ${configRows || `<div class="muted small">所有参与者均未暴露模型/思考强度档位。</div>`}
    <h3>运行模式</h3>
    <label class="small"><input type="checkbox" id="cp-step" ${record.runMode === "step" ? "checked" : ""}> 分步执行——每个阶段（提案/互评/修订/复核/综合）完成后自动暂停，点“继续”跑下一步；启动后可在详情页随时切换</label>
    <button class="ghost" id="cp-back">← 返回上一步</button>
    <button class="primary" id="cp-confirm">确认启动</button>
    <button class="ghost" id="cp-cancel">取消</button>`;
  bind("#cp-confirm", () =>
    startRun({
      participantConfigs: collectConfirmedConfigs(),
      runMode: $("#cp-step")?.checked ? "step" : "auto",
    }),
  );
  bind("#cp-back", () => discardPending(record.id, { goBack: true }));
  bind("#cp-cancel", () => discardPending(record.id, { goBack: false }));
}

async function discardPending(id, { goBack }) {
  try {
    await api(`/api/discussions/${id}`, { method: "DELETE" });
  } catch (err) {
    showBanner(`无法返回：${err.message}`);
    return;
  }
  state.record = null;
  state.currentId = null;
  try { sessionStorage.removeItem("wbLastDisc"); } catch {}
  state.lastDiscFp = null;
  state.renderedHeadKey = null;
  state.renderedStagebarKey = null;
  state.renderedActionsKey = null;
  state.renderedTabsKey = null;
  state.renderedDecisionsKey = null;
  state.renderedViewerKey = null;
  $("#confirm-panel").hidden = true;
  if (goBack) {
    showNewForm({ keepParticipants: true });
  } else {
    $("#new-form").hidden = true;
    $("#view").hidden = true;
    $("#empty").hidden = false;
    await refreshList().catch(() => {});
  }
}

function collectConfirmedConfigs() {
  const out = {};
  for (const box of document.querySelectorAll(
    "#confirm-panel .participant-config[data-pid]",
  )) {
    const pid = box.dataset.pid;
    const model = box.querySelector('select[data-config="model"]');
    const reasoning = box.querySelector('select[data-config="reasoning"]');
    if (!model && !reasoning) continue;
    out[pid] = {
      model: model ? model.value : "",
      reasoning: reasoning ? reasoning.value : "",
    };
  }
  return out;
}

/** BUD-08 额度追加面板：默认池耗尽后人主动继续时，显式授权超额支出 */
function showExtraBudgetPanel(r, { nextRound = false } = {}) {
  const panel = $("#confirm-panel");
  const entries = r.budget.entries ?? [];
  const usedExtra = entries.filter((e) => e.kind === "extra").length;
  const extraTotal = r.budget.extraTotal ?? 0;
  const n = r.participants.length;
  const cost = n === 1 ? 1 : n * 4; // D-29：与后端 roundCost 同口径（够一轮开销）
  panel.hidden = false;
  panel.innerHTML = `
    <h3>${nextRound ? "开启下一轮需要追加额度" : "默认额度已耗尽"}</h3>
    <div class="muted small" style="margin:6px 0">
      正常额度 ${entries.filter((e) => e.kind === "normal").length}/${r.budget.normalTotal} ·
      修复 ${entries.filter((e) => e.kind === "fix").length}/${r.budget.fixTotal} ·
      已追加 ${usedExtra}/${extraTotal}<br>
      ${nextRound ? `开启第 ${(r.roundsCompleted ?? 0) + 1} 轮约需 ${cost} 次额度。<br>` : ""}暂停原因：${esc(r.pauseReason ?? "")}<br>
      继续执行需要额外消耗额度（每次 = 1 次应用任务提交尝试，费用走已登录账户计费）。
      额度限制用于防止无人值守时空转重试；你主动点继续时可按需追加。
    </div>
    <label>追加次数（1–50）
      <input type="number" id="eb-amount" value="${nextRound ? cost : 2}" min="1" max="50" style="width:90px" />
    </label>
    <button class="primary" id="eb-go">${nextRound ? "追加并开启下一轮" : "追加并继续"}</button>
    <button class="ghost" id="eb-cancel">取消</button>`;
  bind("#eb-go", () => {
    const amount = Number($("#eb-amount").value);
    if (!Number.isInteger(amount) || amount < 1 || amount > 50) {
      showBanner("追加次数须为 1–50 的整数。");
      return;
    }
    startRun({ resume: true, extraBudget: amount, ...(nextRound ? { nextRound: true } : {}) });
  });
  bind("#eb-cancel", () => {
    panel.hidden = true;
    openDisc(r.id); // 回到详情视图
  });
}

async function startRun({
  resume = false,
  recoveryConfirmed = false,
  voidGhosts = false,
  participantConfigs = null,
  runMode = null,
  extraBudget = null,
  forceSynthesis = false,
  nextRound = false,
} = {}) {
  const r = state.record;
  state.resumeFlags = { recoveryConfirmed, voidGhosts };
  showBanner(
    nextRound
      ? `已开启第 ${(r.roundsCompleted ?? 0) + 1} 轮互评——只调度该轮任务，进度见阶段条。`
      : resume
        ? "已恢复——只调度未完成的任务，进度见阶段条。"
        : "已确认启动——两方提案开始生成（首次调用较慢），进度见阶段条。",
  );
  try {
    // 恢复/确认可能包含拉起 Agent 与配置发现，放宽超时
    const d = await api(`/api/discussions/${r.id}/${resume ? "resume" : "confirm"}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        recoveryConfirmed,
        voidGhosts,
        ...(participantConfigs ? { participantConfigs } : {}),
        ...(runMode ? { runMode } : {}),
        ...(extraBudget ? { extraBudget } : {}),
        ...(forceSynthesis ? { forceSynthesis: true } : {}),
        ...(nextRound ? { nextRound: true } : {}),
      }),
      timeoutMs: 120_000,
    });
    if (d.alreadyRunning) showBanner("该讨论已在运行中。");
    if (d.started === false) {
      showBanner(
        d.awaitingConfirmation
          ? "已恢复接入检查：请点击“确认启动”。"
          : `已恢复到阶段 ${d.stage}，无需继续调度。`,
      );
    }
    state.resumeFlags = { recoveryConfirmed: false, voidGhosts: false };
    $("#confirm-panel").hidden = true;
    openDisc(r.id); // 非静默：取消隐藏主视图——确认启动/恢复后直接展示本场详情
  } catch (err) {
    if (err.body?.needsRestartReview) {
      showRestartReviewPanel(err.body);
      return;
    }
    if (err.body?.needsLedgerReview) {
      showLedgerReviewPanel(err.body);
      return;
    }
    if (err.body?.needsRecovery) {
      showRecoveryPanel(err.body);
      return;
    }
    showBanner(`启动失败：${err.message}`);
  }
}

function showRestartReviewPanel(body) {
  const panel = $("#confirm-panel");
  panel.hidden = false;
  panel.innerHTML =
    `<h3>重启后核对</h3>` +
    `<div class="banner">${esc(body.pauseReason || "服务重启，待核对")}——外部任务可能仍在运行，系统不会自动重放。</div>` +
    `<label class="check"><input type="checkbox" id="restart-box" /> 我已在原应用核对过已保存产物与外部任务</label>` +
    `<button class="primary" id="restart-go">核对完成，继续</button>`;
  bind("#restart-go", () => {
    if (!$("#restart-box").checked) {
      showBanner("请先勾选重启核对确认。");
      return;
    }
    startRun({ resume: true, ...state.resumeFlags, recoveryConfirmed: true });
  });
}

function showLedgerReviewPanel(body) {
  const entries = Array.isArray(body.needsLedgerReview) ? body.needsLedgerReview : [];
  const hasCorrupt = entries.some((e) => !e.voidable);
  const panel = $("#confirm-panel");
  panel.hidden = false;
  panel.innerHTML =
    `<h3>幽灵账处置</h3>` +
    `<div class="banner">以下额度有记账、但本地没有 attempt 记录。系统在发出任何外部请求前会先落盘尝试记录，因此通常可判定未提交；仍需你确认后作废并留痕。</div>` +
    `<ul class="small">${entries
      .map(
        (e) =>
          `<li>${esc(e.attemptId.slice(0, 24))}… ${esc(e.participantId)} ${esc(e.phase)} 第${esc(e.round)}轮：${esc(e.detail)}${e.voidable ? "" : "（记录损坏，需人工核对）"}</li>`,
      )
      .join("")}</ul>` +
    (hasCorrupt
      ? `<div class="banner">存在损坏的 attempt 记录，不能确认作废。请先人工核对原应用与磁盘记录。</div>`
      : `<label class="check"><input type="checkbox" id="ledger-box" /> 我确认这些任务从未提交，作废并留痕（不计额）</label>` +
        `<button class="primary" id="ledger-go">作废并继续</button>`);
  if (hasCorrupt) return;
  bind("#ledger-go", () => {
    if (!$("#ledger-box").checked) {
      showBanner("请先勾选幽灵账作废确认。");
      return;
    }
    startRun({ resume: true, ...state.resumeFlags, voidGhosts: true });
  });
}

function showRecoveryPanel(body) {
  const attempts = Array.isArray(body.needsRecovery) ? body.needsRecovery : [];
  showBanner(
    `存在无确定终态的尝试，请先在原应用核对：` +
      attempts.map((u) => `${u.attemptId.slice(0, 20)}…(${u.status})`).join("、") +
      `。核对后勾选恢复确认。`,
  );
  const panel = $("#confirm-panel");
  panel.hidden = false;
  panel.innerHTML =
    `<h3>恢复核对</h3><div class="banner">请在原应用核对上述尝试是否已执行（不自动重放、不自动退额）。</div>` +
    `<label class="check"><input type="checkbox" id="rec-box" /> 我已完成核对（--recovery-confirmed）</label>` +
    `<button class="primary" id="rec-go">继续</button>`;
  bind("#rec-go", () => {
    if (!$("#rec-box").checked) {
      showBanner("请先勾选恢复核对确认。");
      return;
    }
    startRun({ resume: true, ...state.resumeFlags, recoveryConfirmed: true });
  });
}

/* ---------------- 启动 ---------------- */

bind("#btn-new", () => showNewForm());
const tplSel = $("#nf-template");
if (tplSel) tplSel.addEventListener("change", () => applyTemplate(tplSel.value));
bind("#nf-add-participant", () => {
  if (state.participantKinds.length >= 5) return;
  const used = new Set(state.participantKinds);
  // 优先补未用过的应用；都用了就追加一个重复实例（允许同应用多实例）
  const next = state.agentList.find((a) => !used.has(a.kind)) ?? state.agentList[0];
  if (!next) return;
  state.participantKinds.push(next.kind);
  state.participantRoles.push("");
  renderParticipantRows();
});
bind("#nf-create", createDiscussion);
bind("#nf-cancel", () => {
  $("#new-form").hidden = true;
  if (state.currentId) $("#view").hidden = false;
  else $("#empty").hidden = false;
});
bind("#nf-pick", pickNative);
bind("#pk-cancel", closePicker);
bind("#pk-up", () => {
  if (state.pickerParent) {
    state.pickerDir = state.pickerParent;
    renderPicker();
  }
});
bind("#pk-ok", () => {
  if (!state.pickerDir) return;
  state.newFormCwd = state.pickerDir;
  setCwdDisplay();
  closePicker();
});

const installUiState = {};

/* 参与者里选中了未安装应用时，给出精确版本一键安装 + 登录窗口（冷启动引导） */
function syncInstallHint() {
  const host = document.getElementById("nf-install-hint");
  if (!host) return;
  const missing = [...new Set(state.participantKinds)].filter((k) => {
    const a = state.agentList.find((x) => x.kind === k);
    return a && a.installed === false;
  });
  if (missing.length === 0) { host.hidden = true; host.innerHTML = ""; return; }
  host.hidden = false;
  host.innerHTML = missing
    .map((k) => {
      const a = state.agentList.find((x) => x.kind === k);
      const st = installUiState[k] ?? {};
      const status = st.running
        ? "安装中…"
        : st.code === 0
          ? "安装完成 ✓"
          : st.code != null && st.code !== 0
            ? "失败（退出码 " + st.code + "）"
            : "";
      const loginBtn =
        a.login && st.code === 0
          ? ' <button type="button" class="ghost" data-login="' + esc(k) + '">打开登录窗口</button>'
          : "";
      return '<div><span class="muted small">' + esc(k) + " 未安装——将精确安装 " + esc(a.pkg) + "@" + esc(a.version) + "（需本机 Node.js/npm）。" + status + '</span> <button type="button" class="ghost" data-install="' + esc(k) + '"' + (st.running ? " disabled" : "") + ">一键安装</button>" + loginBtn + "</div>";
    })
    .join("");
  for (const b of host.querySelectorAll("[data-install]")) {
    b.addEventListener("click", async () => {
      const k = b.dataset.install;
      installUiState[k] = { running: true };
      syncInstallHint();
      try { await post(`/api/agents/${k}/install`); } catch (e) {
        showBanner(`安装启动失败：${e.message}`);
        installUiState[k] = { running: false };
        syncInstallHint();
        return;
      }
      const timer = setInterval(async () => {
        try {
          const st = await api(`/api/agents/${k}/install/status`);
          installUiState[k] = { running: st.running, code: st.code };
          if (!st.running) {
            clearInterval(timer);
            if (st.installed) showBanner(`${k} 安装完成。`, "ok");
            try {
              const d = await api("/api/agents");
              state.agentList = Array.isArray(d.agents) ? d.agents : [];
            } catch {}
            renderParticipantRows();
          } else {
            syncInstallHint();
          }
        } catch { clearInterval(timer); }
      }, 1200);
    });
  }
  for (const b of host.querySelectorAll("[data-login]")) {
    b.addEventListener("click", async () => {
      try {
        const r = await post(`/api/agents/${b.dataset.login}/login`);
        showBanner(`已打开登录终端窗口。${r.note ?? ""}`);
      } catch (e) { showBanner(`打开登录窗口失败：${e.message}`); }
    });
  }
}

function renderParticipantRows() {
  const el = $("#nf-participants");
  if (!el) return;
  const list = state.agentList;
  const kinds = state.participantKinds;
  if (list.length === 0) {
    el.innerHTML = "";
    updateParticipantButtons();
    syncParticipantHints();
    return;
  }
  el.innerHTML = kinds
    .map((kind, i) => {
      const role = state.participantRoles[i] ?? "";
      return `
        <div class="participant-row" data-index="${i}">
          <span class="participant-index">参与者 ${i + 1}${i === 0 ? "（默认综合者）" : ""}</span>
          <select data-role="kind" data-index="${i}">
            ${list
              .map(
                (a) =>
                  `<option value="${esc(a.kind)}" ${a.kind === kind ? "selected" : ""} ${a.installed === false ? "disabled" : ""}>${esc(a.label)}${a.installed === false ? "（未安装）" : ""}</option>`,
              )
              .join("")}
          </select>
          <input type="text" class="role-input" data-role="preset" data-index="${i}"
            placeholder="角色设定（可选）" value="${esc(role)}" maxlength="2000" />
          <button type="button" class="ghost" data-role="remove" data-index="${i}" ${kinds.length <= 1 ? "disabled" : ""}>移除</button>
        </div>`;
    })
    .join("");
  syncInstallHint();
  for (const sel of el.querySelectorAll('select[data-role="kind"]')) {
    sel.addEventListener("change", () => {
      const idx = Number(sel.dataset.index);
      state.participantKinds[idx] = sel.value;
      renderParticipantRows();
    });
  }
  for (const input of el.querySelectorAll('input[data-role="preset"]')) {
    input.addEventListener("input", () => {
      const idx = Number(input.dataset.index);
      state.participantRoles[idx] = input.value;
    });
  }
  for (const btn of el.querySelectorAll('button[data-role="remove"]')) {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.index);
      if (state.participantKinds.length <= 1) return;
      state.participantKinds.splice(idx, 1);
      state.participantRoles.splice(idx, 1);
      renderParticipantRows();
    });
  }
  updateParticipantButtons();
  syncParticipantHints();
}

function updateParticipantButtons() {
  const add = $("#nf-add-participant");
  if (!add) return;
  add.disabled =
    state.agentList.length === 0 || state.participantKinds.length >= 5;
}

function resetParticipantKinds() {
  const available = new Set(state.agentList.map((a) => a.kind));
  const defaults = state.defaultPair.filter((k) => available.has(k));
  state.participantKinds =
    defaults.length > 0
      ? defaults.slice(0, 5)
      : state.agentList.slice(0, 2).map((a) => a.kind);
  state.participantRoles = state.participantKinds.map(() => "");
  state.newFormRunMode = null;
}

function syncParticipantHints() {
  const kinds = state.participantKinds.filter(Boolean);
  const hasDuplicates = new Set(kinds).size < kinds.length;
  const warnEl = $("#nf-hint-warn");
  if (warnEl) warnEl.hidden = !hasDuplicates;
  const infoEl = $("#nf-hint-config");
  if (infoEl) infoEl.hidden = false;
}

async function loadAgentOptions() {
  try {
    const d = await api("/api/agents");
    state.agentList = Array.isArray(d.agents) ? d.agents : [];
    state.defaultPair = Array.isArray(d.defaultPair) ? d.defaultPair : [];
    resetParticipantKinds();
    renderParticipantRows();
    // D-30：内置讨论模板下拉
    const t = await api("/api/templates");
    state.templates = Array.isArray(t.templates) ? t.templates : [];
    const sel = $("#nf-template");
    if (sel) {
      sel.innerHTML =
        `<option value="">不使用模板（自由配置）</option>` +
        state.templates
          .map((x) => `<option value="${esc(x.id)}">${esc(x.name)}</option>`)
          .join("");
    }
  } catch {
    const el = $("#nf-participants");
    if (el) {
      el.innerHTML = `<div class="banner">参与者列表加载失败，请刷新页面</div>`;
    }
  }
}

/** D-30：套用模板——填参与者组合/角色/计划轮数/运行模式（全部仍可改） */
function applyTemplate(id) {
  const t = state.templates.find((x) => x.id === id);
  if (!t) return;
  state.participantKinds = t.participants.map((p) => p.kind);
  state.participantRoles = t.participants.map((p) => p.role ?? "");
  state.newFormRunMode = t.runMode;
  const roundsEl = $("#nf-rounds");
  if (roundsEl) roundsEl.value = String(t.rounds);
  renderParticipantRows();
}

async function restoreLastDisc() {
  if (state.currentId) return;
  let last = null;
  try { last = sessionStorage.getItem("wbLastDisc"); } catch {}
  if (last && (state.list ?? []).some((x) => x.id === last)) await openDisc(last);
}

/* 整页刷新/重新打开后：恢复上次查看的讨论（已删则不恢复）。
   自愈启动：首屏列表失败（workbench 未起/重启中）退避重试，恢复后自动接上 */
function bootOnce() {
  refreshList()
    .then(() => {
      markConnOk();
      return restoreLastDisc();
    })
    .catch(() => {
      markConnFail();
      setTimeout(bootOnce, state.retryMs ?? 1000);
    });
}
bootOnce();
loadAgentOptions();

/* 讨论列表侧栏折叠（ChatGPT 式开关，与群聊页同款；共用 wbAsideFold 状态语义） */
(function () {
  let folded = "0";
  try { folded = sessionStorage.getItem("wbAsideFold") ?? "0"; } catch {}
  const b = document.getElementById("btn-aside");
  if (!b) return;
  const apply = () => {
    document.body.classList.toggle("aside-folded", folded === "1");
    b.setAttribute("aria-expanded", folded === "1" ? "false" : "true");
  };
  apply();
  b.addEventListener("click", () => {
    folded = folded === "1" ? "0" : "1";
    try { sessionStorage.setItem("wbAsideFold", folded); } catch {}
    apply();
  });
})();

/* 面板切换胶囊：嵌入 DSH 面板（shell 容器）时 postMessage 驱动 tab 切换；
   独立运行（桌面版/CLI）时照常页面导航 */
(function () {
  var here = document.body.classList.contains("disc") ? "disc" : "groups";
  document.querySelectorAll(".page-switch button").forEach(function (b) {
    b.addEventListener("click", function () {
      var target = b.dataset.page;
      if (target === here) return;
      if (window.parent !== window) {
        try {
          window.parent.postMessage({ type: "agent-chat-tab", tab: target }, location.origin);
          return;
        } catch (e) { /* 回退导航 */ }
      }
      location.href = target === "groups" ? "/groups" : "/";
    });
  });
})();
