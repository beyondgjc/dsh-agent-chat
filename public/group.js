/**
 * 群聊室前端（D-33 预研，零构建原生 JS）。
 * 模式与 app.js 一致：指纹轮询防闪烁、innerHTML 替换后一次性绑定、uiConfirm 替代原生 confirm。
 */
const $ = (sel) => document.querySelector(sel);

const state = {
  connFail: false,
  retryMs: null,
  groups: [],
  currentId: null,
  record: null,
  board: [],
  inFlight: [],
  boardAfter: 0, // Tier 0 增量轮询游标：本地已收到的最大 seq
  memberConfigs: [],
  lastListFp: null,
  lastBoardKey: null,
  lastRosterKey: null,
  lastHeadKey: null,
  timer: null,
  agents: [],
  newForm: { cwd: "", members: [] },
  pickerDir: "",
  pickerParent: null,
};

/* 布局折叠：左侧群聊列表 / 右侧成员栏。群聊列表默认恒展开（DSH 面板天然窄，
   不再按窄窗口默认收起——用户手动折叠才记 sessionStorage）；成员栏窄窗口仍默认收起。 */
let asideFolded = "0";
let rosterFolded = "0";

function applyAsideFold() {
  document.body.classList.toggle("aside-folded", asideFolded === "1");
  const b = $("#btn-aside");
  if (b) b.setAttribute("aria-expanded", asideFolded === "1" ? "false" : "true");
}

function applyRosterFold() {
  const view = $("#view");
  if (view) view.classList.toggle("roster-folded", rosterFolded === "1");
  const b = $("#btn-roster");
  if (b) b.setAttribute("aria-expanded", rosterFolded === "1" ? "false" : "true");
}

function initLayoutToggles() {
  let narrow = false;
  try { narrow = window.matchMedia("(max-width: 1020px)").matches; } catch {}
  let a = null, r = null;
  try { a = sessionStorage.getItem("wbAsideFold"); r = sessionStorage.getItem("wbRosterFold"); } catch {}
  asideFolded = a ?? "0"; // 默认展开：只有用户手动折叠过才收起
  rosterFolded = r ?? (narrow ? "1" : "0");
  applyAsideFold();
  const asideBtn = $("#btn-aside");
  if (asideBtn) {
    asideBtn.addEventListener("click", () => {
      asideFolded = asideFolded === "1" ? "0" : "1";
      try { sessionStorage.setItem("wbAsideFold", asideFolded); } catch {}
      applyAsideFold();
    });
  }
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/* 结构性图标统一走内联 SVG（零依赖，不用 emoji 充当图标） */
const FOLDER_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><path d="M1.8 4.6a1.8 1.8 0 0 1 1.8-1.8h3.1l1.7 1.9h4a1.8 1.8 0 0 1 1.8 1.8v5.9a1.8 1.8 0 0 1-1.8 1.8H3.6a1.8 1.8 0 0 1-1.8-1.8z" stroke-linejoin="round"/></svg>`;

async function api(path, opts = {}) {
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
    if (e.name === "AbortError") throw new Error(`请求超时（${timeoutMs / 1000} 秒），请稍后重试`);
    throw e;
  } finally {
    clearTimeout(timer);
  }
}

function post(path, data, opts = {}) {
  return api(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(data ?? {}), ...opts });
}

function showBanner(msg, kind = "warn") {
  const el = $("#banner");
  el.textContent = msg;
  el.className = `banner ${kind}`;
  el.hidden = false;
  clearTimeout(showBanner.timer);
  showBanner.timer = setTimeout(() => { el.hidden = true; }, 6000);
}

function uiConfirm(message) {
  return new Promise((resolve) => {
    const overlay = document.createElement("div");
    overlay.className = "uiconfirm-overlay";
    overlay.innerHTML = `
      <div class="uiconfirm-panel">
        <div class="uiconfirm-msg">${esc(message)}</div>
        <div class="pk-actions">
          <span style="flex:1"></span>
          <button class="ghost" data-no>取消</button>
          <button class="primary" data-yes>确定</button>
        </div>
      </div>`;
    overlay.querySelector("[data-no]").addEventListener("click", () => { overlay.remove(); resolve(false); });
    overlay.querySelector("[data-yes]").addEventListener("click", () => { overlay.remove(); resolve(true); });
    document.body.appendChild(overlay);
  });
}

function fmtTime(iso) {
  try { return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }); } catch { return ""; }
}

/* 成员身份色：显示名哈希 → 固定调色板（全环分布，避开主强调靛青区）；同名恒同色，两主题共用 */
const MEMBER_HUES = [35, 85, 150, 200, 255, 290, 330, 5];
function hueOf(label) {
  let h = 0;
  for (const c of String(label ?? "?")) h = (h * 31 + c.codePointAt(0)) >>> 0;
  return MEMBER_HUES[h % MEMBER_HUES.length];
}
function firstChar(label) {
  return esc([...String(label ?? "?")][0] ?? "?");
}

/* ---------------- 群列表 ---------------- */

async function refreshList() {
  const d = await api("/api/groups");
  const fp = JSON.stringify([d.groups, state.currentId]);
  if (fp === state.lastListFp) return;
  state.lastListFp = fp;
  state.groups = d.groups;
  const el = $("#group-list");
  el.innerHTML = state.groups
    .map(
      (g) => `
    <div class="disc-item ${g.id === state.currentId ? "sel" : ""}${g.closedAt ? " closed" : ""}" data-id="${esc(g.id)}">
      <div><strong>${esc(g.name)}</strong></div>
      <div class="muted small">成员 ${g.activeMembers} · 消息 ${g.messageSeq}${g.closedAt ? " · 已关闭" : ""}</div>
    </div>`,
    )
    .join("");
  for (const node of el.querySelectorAll(".disc-item")) {
    node.addEventListener("click", async () => {
      await openGroup(node.dataset.id);
      $("#composer")?.focus();
    });
  }
}

/* ---------------- 群详情 ---------------- */

async function openGroup(id, { silent = false } = {}) {
  try {
    // Tier 0 增量轮询：静默轮询只拉 seq>游标 的增量（冷开/切换全量）；缺口或回档时全量重拉兜底
    if (!silent) state.boardAfter = 0;
    const afterQ = silent && state.boardAfter > 0 ? `?after=${state.boardAfter}` : "";
    let d = await api(`/api/groups/${id}${afterQ}`);
    let full = !silent;
    if (silent) {
      const top = Number.isFinite(d.topSeq) ? d.topSeq : state.boardAfter + d.board.length;
      if (top !== state.boardAfter + d.board.length) {
        d = await api(`/api/groups/${id}`);
        full = true;
      }
    }
    const c = await api(`/api/groups/${id}/configs`).catch(() => ({ configs: [] }));
    markConnOk();
    state.memberConfigs = c.configs ?? [];
    if (full) {
      state.board = d.board;
      state.boardAfter = d.topSeq ?? d.board.reduce((m, x) => Math.max(m, x.seq), 0);
    } else if (d.board.length) {
      const merged = state.board.concat(d.board);
      merged.sort((a, b) => a.seq - b.seq);
      state.board = merged;
      state.boardAfter = Math.max(state.boardAfter, d.topSeq ?? 0);
    }
    const boardKey = `${state.board.length}:${state.board.map((m) => m.seq).join(",")}`;
    const rosterKey = JSON.stringify([d.record.members, d.inFlight]);
    const headKey = JSON.stringify([d.record.name, d.record.cwd, d.record.closedAt]);
    if (!silent) {
      $("#empty").hidden = true;
      $("#view").hidden = false;
      $("#new-form").hidden = true;
      state.currentId = id;
      try { sessionStorage.setItem("wbLastGroup", id); } catch {}
      state.lastBoardKey = null;
      state.lastRosterKey = null;
      state.lastHeadKey = null;
    }
    state.record = d.record;
    state.inFlight = d.inFlight;
    if (headKey !== state.lastHeadKey) {
      state.lastHeadKey = headKey;
      renderHead();
    }
    if (boardKey !== state.lastBoardKey) {
      state.lastBoardKey = boardKey;
      renderBoard();
    }
    if (rosterKey !== state.lastRosterKey) {
      state.lastRosterKey = rosterKey;
      renderRoster();
      renderMentionChips(); // @chips 的可点名对象 = 在群成员，随成员变化刷新（拉人/踢出后）
    }
    refreshList().catch(() => {});
    schedulePoll();
  } catch (err) {
    if (!silent) showBanner(`加载失败：${err.message}`);
    else markConnFail(); // 自愈：不清游标、退避重试（恢复后原样回到当前群）
  }
}

function schedulePoll() {
  clearTimeout(state.timer);
  if (!state.currentId) return;
  // 常驻 iframe 切走（document.hidden）降频 30s；连接故障期退避重试；正常期原节奏
  const delay = state.connFail
    ? (state.retryMs ?? 1000)
    : document.hidden
      ? 30000
      : state.inFlight.length > 0
        ? 1500
        : 5000;
  state.timer = setTimeout(() => openGroup(state.currentId, { silent: true }), delay);
}

// 回到前台立即拉一次并恢复原节奏（keep-alive 下面板切走期间轮询已降频）
document.addEventListener("visibilitychange", () => {
  if (!document.hidden && state.currentId) {
    clearTimeout(state.timer);
    openGroup(state.currentId, { silent: true });
  }
});

/** 连接故障：只在状态翻转时弹一次横幅；游标保持，schedulePoll 按退避间隔重试 */
function markConnFail() {
  state.retryMs = Math.min((state.retryMs ?? 500) * 2, 15000);
  if (!state.connFail) {
    state.connFail = true;
    showBanner("连接中断，自动重试中……（workbench 可能正在重启）");
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

function renderHead() {
  const r = state.record;
  const active = r.members.filter((m) => !m.leftAt).length;
  $("#head").innerHTML = `
    <div class="group-head-row">
      <h2>${esc(r.name)}</h2>
      <span class="badge ${r.closedAt ? "bad" : "ok"}">${r.closedAt ? "已关闭" : "进行中"}</span>
      <span class="muted small">目录：${esc(r.cwd)}</span>
      <span class="muted small">成员 ${active}</span>
      <span class="spacer"></span>
      <button id="btn-roster" class="ghost" aria-expanded="true" title="折叠/展开成员栏">成员 <span id="btn-roster-label"></span><span class="chev" aria-hidden="true">›</span></button>
    </div>`;
  const rosterBtn = $("#btn-roster");
  if (rosterBtn) {
    rosterBtn.addEventListener("click", () => {
      rosterFolded = rosterFolded === "1" ? "0" : "1";
      try { sessionStorage.setItem("wbRosterFold", rosterFolded); } catch {}
      applyRosterFold();
    });
  }
  applyRosterFold();
}

function renderMentionChips() {
  const el = $("#mention-chips");
  const active = state.record.members.filter((m) => !m.leftAt);
  el.innerHTML = active
    .map(
      (m) =>
        `<button type="button" class="opt-chip" style="--mh:${hueOf(m.label)}" data-mention="${esc(m.label)}" aria-label="插入点名 @${esc(m.label)}">@${esc(m.label)}</button>`,
    )
    .join("");
  for (const b of el.querySelectorAll("[data-mention]")) {
    b.addEventListener("click", () => {
      const ta = $("#composer");
      ta.value = `${ta.value}${ta.value && !ta.value.endsWith(" ") ? " " : ""}@${b.dataset.mention} `;
      ta.focus();
    });
  }
}

const STALE_ICON = `<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M8 2.6 14.6 13.4H1.4z" stroke-linejoin="round"/><path d="M8 6.6v3" stroke-linecap="round"/><circle cx="8" cy="11.6" r="0.9" fill="currentColor" stroke="none"/></svg>`;

/* 在途回合的"正在回复"提示：谁在打字一眼可见 */
function typingHtml() {
  const labels = state.record.members
    .filter((m) => !m.leftAt && state.inFlight.includes(m.episodeId))
    .map((m) => esc(m.label));
  if (!labels.length) return "";
  return `<div class="typing" role="status"><span class="typing-dots" aria-hidden="true"><i></i><i></i><i></i></span>${labels.join("、")} 正在回复…</div>`;
}

function renderBoard() {
  const el = $("#board");
  const activeLabels = state.record.members.filter((m) => !m.leftAt).map((m) => m.label);
  /* 仅当用户本就贴近底部时才跟随滚动，避免轮询渲染打断回看历史 */
  const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 90;
  el.innerHTML = state.board.length
    ? state.board
        .map((m) => {
          const isUser = m.author.kind === "user";
          const isSys = m.author.kind === "system";
          const who =
            isUser
              ? m.author.via
                ? `用户（经 ${esc(m.author.via)}）`
                : "用户"
              : isSys
                ? "系统"
                : esc(m.author.label ?? m.author.episodeId ?? "?");
          let text = esc(m.text);
          for (const label of activeLabels) {
            text = text.split(`@${esc(label)}`).join(`<span class="at">@${esc(label)}</span>`);
          }
          const staleTag = m.stale
            ? `<div class="stale-tag">${STALE_ICON}<span>基于旧版面：发送时版面已有新消息</span></div>`
            : "";
          const avatar = isSys ? "" : avatarHtmlFor(m, isUser);
          const hueStyle = !isSys && !isUser ? ` style="--mh:${hueOf(m.author.label)}"` : "";
          return `<div class="bubble ${esc(m.author.kind)}"${hueStyle}>${avatar}<div class="body"><div class="who">${who}<span class="meta">#${m.seq} · ${fmtTime(m.at)}</span></div><div class="txt">${text}</div>${staleTag}</div></div>`;
        })
        .join("") + typingHtml()
    : `<div class="board-empty">尚无消息——发布第一条需求，全体成员将各回一合。</div>`;
  if (nearBottom) el.scrollTop = el.scrollHeight;
}

function avatarHtmlFor(m, isUser) {
  if (isUser) return `<span class="avatar user" aria-hidden="true">我</span>`;
  return `<span class="avatar" aria-hidden="true">${firstChar(m.author.label)}</span>`;
}

function renderRoster() {
  const el = $("#roster");
  const active = state.record.members.filter((m) => !m.leftAt).length;
  const count = $("#roster-count");
  if (count) count.textContent = `${active}/${state.record.members.length} 在群`;
  const toggleLabel = $("#btn-roster-label");
  if (toggleLabel) toggleLabel.textContent = `${active}/${state.record.members.length}`;
  el.innerHTML = state.record.members
    .map((m) => {
      const inFlight = state.inFlight.includes(m.episodeId);
      const status = m.leftAt
        ? `<span class="badge ${m.needsReview ? "warn" : ""}"${m.needsReview ? ' title="在途回合取消未确认，待核对"' : ""}>${m.needsReview ? "已移出·待核对" : "已移出"}</span>`
        : inFlight
          ? `<span class="badge run">回合中…</span>`
          : `<span class="badge ok">在群</span>`;
      const kick = !m.leftAt && !state.record.closedAt
        ? `<button type="button" class="ghost" data-kick="${esc(m.episodeId)}" data-label="${esc(m.label)}">踢出</button>`
        : "";
      // 归队：已移出的成员可原样复活（保留会话记忆）；needsReview 的归队走强制新会话
      const readd = m.leftAt && !state.record.closedAt
        ? `<button type="button" class="ghost" data-readd="${esc(m.episodeId)}" data-label="${esc(m.label)}" data-fresh="${m.needsReview ? "1" : ""}">${m.needsReview ? "归队（新会话）" : "归队"}</button>`
        : "";
      // 档位行：非 mock、且本机发现过会话档位的成员可随时改模型/思考强度（下一回合生效）
      const cfgEntry = (state.memberConfigs || []).find((x) => x.episodeId === m.episodeId);
      const cfg = cfgEntry && cfgEntry.config;
      let tierRow = "";
      if (!m.leftAt && m.appId !== "mock" && cfg && cfg.modelConfigId) {
        const mOpts = [`<option value="">应用默认</option>`].concat(
          (cfg.modelOptions || []).map((o) => `<option value="${esc(o.value)}" ${m.config?.model === o.value ? "selected" : ""}>${esc(o.name)}</option>`)
        ).join("");
        const rOpts = [`<option value="">应用默认</option>`].concat(
          (cfg.reasoningOptions || []).map((o) => `<option value="${esc(o.value)}" ${m.config?.reasoning === o.value ? "selected" : ""}>${esc(o.name)}</option>`)
        ).join("");
        tierRow = `<div style="display:flex;gap:4px;margin-top:4px">
          <select class="tier" data-ep="${esc(m.episodeId)}" data-kind="model" style="font-size:11.5px;flex:1;min-width:0">${mOpts}</select>
          <select class="tier" data-ep="${esc(m.episodeId)}" data-kind="reasoning" style="font-size:11.5px;flex:1;min-width:0">${rOpts}</select>
        </div>`;
      }
      return `<div class="member-row${m.leftAt ? " left" : ""}" style="--mh:${hueOf(m.label)}">
        <span class="avatar sm" aria-hidden="true">${firstChar(m.label)}</span>
        <div class="grow">
          <div class="mr-top"><strong>${esc(m.label)}</strong>${status}</div>
          <div class="muted small">${esc(m.episodeId)} · ${esc(m.appId)}</div>
          ${tierRow}
        </div>
        ${kick}
        ${readd}
      </div>`;
    })
    .join("");
  for (const sel of el.querySelectorAll("select.tier")) {
    sel.addEventListener("change", async () => {
      const ep = sel.dataset.ep;
      const model = el.querySelector(`select.tier[data-ep="${ep}"][data-kind="model"]`)?.value ?? "";
      const reasoning = el.querySelector(`select.tier[data-ep="${ep}"][data-kind="reasoning"]`)?.value ?? "";
      try {
        await post(`/api/groups/${state.record.id}/member-config`, { episodeId: ep, model: model || undefined, reasoning: reasoning || undefined });
        showBanner("档位已更新——下一回合提交前应用。", "ok");
      } catch (err) { showBanner(`档位设置失败：${err.message}`); }
    });
  }
  for (const b of el.querySelectorAll("[data-kick]")) {
    b.addEventListener("click", async () => {
      if (!(await uiConfirm(`把「${b.dataset.label}」移出群聊？在途回合会被取消并等待核对。`))) return;
      try {
        const r = await post(`/api/groups/${state.record.id}/kick`, { episodeId: b.dataset.kick });
        showBanner(r.needsReview ? "已移出，但在途回合取消未获确认——标记待核对。" : "已移出群聊。", r.needsReview ? "warn" : "ok");
        await openGroup(state.record.id, { silent: true });
      } catch (err) { showBanner(`踢出失败：${err.message}`); }
    });
  }
  for (const b of el.querySelectorAll("[data-readd]")) {
    b.addEventListener("click", async () => {
      const fresh = b.dataset.fresh === "1";
      if (!(await uiConfirm(fresh
        ? `让「${b.dataset.label}」以新会话归队？（旧会话不可信，会丢失记忆但能看到全量板面）`
        : `让「${b.dataset.label}」归队？将保留会话记忆，只收归队后的新消息。`))) return;
      try {
        const r = await post(`/api/groups/${state.record.id}/readd`, { episodeId: b.dataset.readd });
        showBanner(r.sessionReused ? `「${b.dataset.label}」已归队——会话记忆保留。` : `「${b.dataset.label}」已归队（新会话）。`, "ok");
        await openGroup(state.record.id, { silent: true });
      } catch (err) { showBanner(`归队失败：${err.message}`); }
    });
  }
}

/* ---------------- 发消息 ---------------- */

async function sendComposer() {
  const ta = $("#composer");
  const text = ta.value.trim();
  if (!text) { showBanner("消息不能为空"); return; }
  try {
    ta.disabled = true;
    await post(`/api/groups/${state.currentId}/messages`, { text });
    ta.value = "";
    await openGroup(state.currentId, { silent: true });
  } catch (err) {
    showBanner(`发送失败：${err.message}`);
  } finally {
    ta.disabled = false;
    ta.focus();
  }
}

/* ---------------- 拉人 ---------------- */

async function loadAgentKinds() {
  try {
    const d = await api("/api/agents");
    state.agents = [{ kind: "mock", label: "mock（模拟，零模型调用）" }].concat(
      (d.agents ?? []).map((a) => ({ kind: a.kind, label: `${a.kind}（${a.version}）` })),
    );
  } catch {
    state.agents = [{ kind: "mock", label: "mock（模拟，零模型调用）" }];
  }
  const sel = $("#am-app");
  sel.innerHTML = state.agents.map((a) => `<option value="${esc(a.kind)}">${esc(a.label)}</option>`).join("");
}

async function addMember() {
  const appId = $("#am-app").value;
  const label = $("#am-label").value.trim();
  const envRaw = $("#am-env").value.trim();
  let env;
  if (envRaw) {
    try { env = JSON.parse(envRaw); } catch { showBanner("env 不是合法 JSON"); return; }
  }
  try {
    const r = await post(`/api/groups/${state.currentId}/members`, { appId, label: label || undefined, env });
    showBanner(`已拉入：${r.member.label}（${r.member.episodeId}）`, "ok");
    $("#am-label").value = "";
    $("#am-env").value = "";
    await openGroup(state.currentId, { silent: true });
  } catch (err) { showBanner(`拉人失败：${err.message}`); }
}

/* ---------------- 新建群 ---------------- */

function renderNewFormMembers() {
  const el = $("#gf-members");
  el.innerHTML = state.newForm.members
    .map(
      (m, i) => `
    <div class="participant-row">
      <span class="participant-index">成员 ${i + 1}</span>
      <select data-idx="${i}" data-field="appId">
        ${state.agents.map((a) => `<option value="${esc(a.kind)}" ${a.kind === m.appId ? "selected" : ""}>${esc(a.label)}</option>`).join("")}
      </select>
      <input data-idx="${i}" data-field="label" type="text" class="member-label" placeholder="显示名（可空）" value="${esc(m.label ?? "")}" />
      <input data-idx="${i}" data-field="env" type="text" class="member-env" placeholder='env JSON（可空）' value="${esc(m.envRaw ?? "")}" />
      <button type="button" class="ghost" data-remove="${i}">移除</button>
    </div>`,
    )
    .join("");
  for (const sel of el.querySelectorAll("select[data-field]")) {
    sel.addEventListener("change", () => { state.newForm.members[Number(sel.dataset.idx)].appId = sel.value; });
  }
  for (const inp of el.querySelectorAll("input[data-field]")) {
    inp.addEventListener("input", () => {
      state.newForm.members[Number(inp.dataset.idx)][inp.dataset.field] = inp.value;
    });
  }
  for (const b of el.querySelectorAll("[data-remove]")) {
    b.addEventListener("click", () => {
      state.newForm.members.splice(Number(b.dataset.remove), 1);
      renderNewFormMembers();
    });
  }
}

function showNewForm() {
  $("#empty").hidden = true;
  $("#view").hidden = true;
  $("#new-form").hidden = false;
  if (state.newForm.members.length === 0) {
    state.newForm.members.push({ appId: "mock", label: "", envRaw: "" });
    state.newForm.members.push({ appId: "mock", label: "", envRaw: "" });
  }
  renderNewFormMembers();
}

async function pickDirectory() {
  try {
    const d = await api("/api/fs/native-pick", { method: "POST", timeoutMs: 600_000 });
    if (d.path) { state.newForm.cwd = d.path; $("#gf-cwd").value = d.path; return; }
  } catch { /* 原生选择器不可用 → 网页选择器 */ }
  state.pickerDir = state.newForm.cwd || "";
  $("#pk-overlay").hidden = false;
  renderPicker();
}

async function renderPicker() {
  const list = $("#pk-list");
  list.innerHTML = `<p class="muted">加载中……</p>`;
  try {
    const q = state.pickerDir ? `?dir=${encodeURIComponent(state.pickerDir)}` : "";
    const d = await api(`/api/fs/list${q}`);
    state.pickerParent = d.parent;
    $("#pk-path").textContent = d.dir || "此电脑（选择盘符）";
    $("#pk-up").disabled = !d.parent;
    list.innerHTML = d.dirs.length
      ? d.dirs.map((x) => `<button type="button" class="pk-item" data-go="${esc(x.path)}">${FOLDER_ICON}<span>${esc(x.name)}</span></button>`).join("")
      : `<p class="muted" style="padding:8px 12px">（没有子目录）</p>`;
    for (const b of list.querySelectorAll("[data-go]")) {
      b.addEventListener("click", () => { state.pickerDir = b.dataset.go; renderPicker(); });
    }
    $("#pk-ok").disabled = !state.pickerDir;
  } catch (err) {
    list.innerHTML = `<p class="muted">目录读取失败：${esc(err.message)}</p>`;
    $("#pk-up").disabled = true;
    $("#pk-ok").disabled = true;
  }
}

async function createGroup() {
  const name = $("#gf-name").value.trim();
  const cwd = state.newForm.cwd.trim();
  if (!name) { showBanner("群名称不能为空"); return; }
  if (!cwd) { showBanner("请先选择工作目录"); return; }
  const members = [];
  for (const m of state.newForm.members) {
    let env;
    if (m.envRaw && m.envRaw.trim()) {
      try { env = JSON.parse(m.envRaw); } catch { showBanner(`成员 ${m.label || m.appId} 的 env 不是合法 JSON`); return; }
    }
    members.push({ appId: m.appId, label: m.label?.trim() || undefined, env });
  }
  try {
    // 创建含接入检查（成员连接立即建立），真适配器冷启动可超 10s——放宽到 90s
    const r = await post("/api/groups", { name, cwd, members }, { timeoutMs: 90_000 });
    showBanner(`群「${name}」已创建并完成接入检查。`, "ok");
    state.newForm = { cwd: "", members: [] };
    $("#gf-name").value = "";
    $("#gf-cwd").value = "";
    await refreshList();
    await openGroup(r.record.id);
    $("#composer")?.focus();
  } catch (err) { showBanner(`创建失败：${err.message}`); }
}

/* ---------------- 启动 ---------------- */

async function main() {
  $("#btn-new").addEventListener("click", showNewForm);
  $("#gf-cancel").addEventListener("click", () => {
    $("#new-form").hidden = true;
    $("#empty").hidden = state.currentId ? true : false;
    $("#view").hidden = state.currentId ? false : true;
  });
  $("#gf-pick").addEventListener("click", pickDirectory);
  $("#pk-cancel").addEventListener("click", () => { $("#pk-overlay").hidden = true; });
  $("#pk-up").addEventListener("click", () => { if (state.pickerParent) { state.pickerDir = state.pickerParent; renderPicker(); } });
  $("#pk-ok").addEventListener("click", () => {
    if (!state.pickerDir) return;
    state.newForm.cwd = state.pickerDir;
    $("#gf-cwd").value = state.pickerDir;
    $("#pk-overlay").hidden = true;
  });
  $("#gf-add-member").addEventListener("click", () => {
    state.newForm.members.push({ appId: "mock", label: "", envRaw: "" });
    renderNewFormMembers();
  });
  $("#gf-create").addEventListener("click", createGroup);
  $("#btn-send").addEventListener("click", sendComposer);
  $("#composer").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendComposer(); }
  });
  $("#am-add").addEventListener("click", addMember);
  // 解散群组：静态元素只在启动时绑一次（头部旧位置已移除，动作归入成员侧栏底部）
  $("#btn-del-group").addEventListener("click", async () => {
    const r = state.record;
    if (!r) return;
    if (!(await uiConfirm(`解散群组「${r.name}」？本地记录与板面一并删除。`))) return;
    try {
      await api(`/api/groups/${r.id}`, { method: "DELETE" });
      state.currentId = null;
      try { sessionStorage.removeItem("wbLastGroup"); } catch {}
      $("#view").hidden = true;
      $("#empty").hidden = false;
      refreshList().catch(() => {});
    } catch (err) { showBanner(`删除失败：${err.message}`); }
  });
  initLayoutToggles();
  await loadAgentKinds();
  await refreshList();
  // 支持 /groups?id=... 直达；否则恢复上次查看的群（已删则不恢复）
  const wanted = new URLSearchParams(location.search).get("id");
  if (wanted && state.groups.some((g) => g.id === wanted)) await openGroup(wanted);
  else {
    let last = null;
    try { last = sessionStorage.getItem("wbLastGroup"); } catch {}
    if (last && state.groups.some((g) => g.id === last)) await openGroup(last);
  }
  setInterval(() => {
    if (!state.currentId && !document.hidden) refreshList().catch(() => {});
  }, 5000);
}

main().catch((err) => {
  showBanner(`初始化失败：${err.message}（10 秒后自动重试）`);
  setTimeout(() => location.reload(), 10_000);
});
