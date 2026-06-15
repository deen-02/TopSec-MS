const API = "/api";

// ── Token ──────────────────────────────────────────────────────────────────────

function getToken() {
  const url = new URLSearchParams(window.location.search).get("token");
  if (url) { localStorage.setItem("topsec_token", url); return url; }
  return localStorage.getItem("topsec_token") || "";
}
let TOKEN = getToken();

function promptToken() {
  const t = window.prompt("Enter your TopSec approval token:");
  if (t) { localStorage.setItem("topsec_token", t); TOKEN = t; location.reload(); }
}
function showTokenBanner() {
  const b = document.getElementById("token-banner");
  if (b) b.style.display = "flex";
}

async function apiFetch(path, options = {}) {
  const controller = new AbortController();
  const tid = setTimeout(() => controller.abort(), 8000);
  try {
    const headers = { "Content-Type": "application/json", "x-secret-token": TOKEN, ...(options.headers || {}) };
    const res = await fetch(API + path, { ...options, headers, signal: controller.signal });
    clearTimeout(tid);
    if (res.status === 401) { localStorage.removeItem("topsec_token"); showTokenBanner(); throw new Error("Invalid token"); }
    if (!res.ok) throw new Error(`${res.status}: ${await res.text()}`);
    return res.json();
  } catch(e) {
    clearTimeout(tid);
    if (e.name === "AbortError") throw new Error("Request timed out");
    throw e;
  }
}

// ── Toast notifications ────────────────────────────────────────────────────────

function showToast(msg, demo = false) {
  const el = document.createElement("div");
  el.style.cssText = "position:fixed;bottom:24px;left:50%;transform:translateX(-50%);z-index:9999;background:var(--surface,#1a1f2e);border:1px solid var(--border,#2a3244);border-radius:8px;padding:10px 18px;font-size:12px;color:var(--text-muted,#8899bb);box-shadow:0 4px 20px rgba(0,0,0,.5);max-width:480px;text-align:center;pointer-events:none;transition:opacity .3s";
  el.textContent = demo
    ? "Demo mode — this requires Azure tenant connectivity. In a live environment it would work automatically."
    : msg;
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; setTimeout(() => el.remove(), 300); }, 3500);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function escHtml(s) {
  return String(s || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}
function timeAgo(iso) {
  if (!iso) return "";
  const ts = !/[Z+]/.test(iso.slice(-6)) ? iso + "Z" : iso;
  const d = Math.floor((Date.now() - new Date(ts)) / 1000);
  if (d <= 0) return "just now";
  if (d < 60) return `${d}s ago`;
  if (d < 3600) return `${Math.floor(d/60)}m ago`;
  return `${Math.floor(d/3600)}h ago`;
}
function severityClass(s) {
  return { Critical:"sev-critical", High:"sev-high", Medium:"sev-medium", Low:"sev-low" }[s] || "";
}
function clsBadgeClass(c) {
  return { TruePositive:"badge-danger", BenignPositive:"badge-warning", FalsePositive:"badge-success", Escalate:"badge-escalate" }[c] || "badge-neutral";
}
function clsLabel(c) {
  return { TruePositive:"Real Attack", BenignPositive:"Low Risk", FalsePositive:"False Alarm", Escalate:"Escalate" }[c] || c || "Unreviewed";
}
function extractSev(item) {
  const s = item.severity || item.severity_assessment || "";
  const m = s.match(/^(Critical|High|Medium|Low|Informational)/i);
  return m ? m[1][0].toUpperCase() + m[1].slice(1).toLowerCase() : "";
}

// ── Clock ──────────────────────────────────────────────────────────────────────

function tickClock() {
  const el = document.getElementById("sidebar-time");
  if (el) el.textContent = new Date().toLocaleTimeString([], { hour:"2-digit", minute:"2-digit", second:"2-digit" });
}
setInterval(tickClock, 1000); tickClock();

// ── Pipeline dots ──────────────────────────────────────────────────────────────

const PIPE_IDS = ["pipe-intake","pipe-enrich","pipe-investigate","pipe-response","pipe-echo"];
const _PHASE_DOT = { Intake:"pipe-intake", Enrichment:"pipe-enrich", Investigation:"pipe-investigate", Response:"pipe-response", ECHO:"pipe-echo" };
const _PHASE_LABEL = { "pipe-intake":"Intake", "pipe-enrich":"Enrichment", "pipe-investigate":"Investigation", "pipe-response":"Response", "pipe-echo":"ECHO" };

function _setSidebarProcessing(active, label) {
  const w = document.getElementById("sidebar-processing");
  const l = document.getElementById("pipeline-phase-label");
  if (w) w.style.display = active ? "flex" : "none";
  if (l) l.textContent = label || "Triaging…";
}
function setPipelineIdle()  { _setSidebarProcessing(false); }
function setPipelineDone()  {
  _setSidebarProcessing(false);
  setTimeout(setPipelineIdle, 2000);
}
function setDotActive(id) {
  const phase = _PHASE_LABEL[id] || "Running";
  _setSidebarProcessing(true, phase + "…");
}
function setDotDone(id) {
  // no-op for sidebar; dots are now in the report view only
}

// ── SSE ────────────────────────────────────────────────────────────────────────

function connectSSE() {
  const es = new EventSource(`${API}/stream`);
  es.onmessage = e => {
    try {
      const ev = JSON.parse(e.data);
      if (ev.type === "pipeline_start") { setPipelineIdle(); setDotActive(_PHASE_DOT.Intake); demoOnPipelineStart(ev); }
      else if (ev.type === "phase_start") { const d = _PHASE_DOT[ev.phase]; setDotActive(d); demoOnPhase(ev.phase); }
      else if (ev.type === "phase_done")  { const d = _PHASE_DOT[ev.phase]; setDotDone(d); }
      else if (ev.type === "pipeline_done") { setPipelineDone(); refresh(); }
    } catch {}
  };
  es.onerror = () => { es.close(); setTimeout(connectSSE, 5000); };
}

// ── Live status ────────────────────────────────────────────────────────────────

function setLiveStatus(ok) {
  const dot = document.getElementById("live-dot");
  const lbl = document.getElementById("live-label");
  if (dot) { dot.className = ok ? "pulse-dot" : "pulse-dot offline"; }
  if (lbl) { lbl.textContent = ok ? "LIVE" : "offline"; lbl.style.color = ok ? "" : "var(--text-muted)"; }
}

function updatePendingBadge(n) {
  const el = document.getElementById("topbar-pending-count");
  const pill = document.getElementById("topbar-pending-badge");
  if (el) el.textContent = n;
  if (pill) pill.classList.toggle("zero", n === 0);
}

// ── Nav / Tabs ─────────────────────────────────────────────────────────────────

let _activeTab = "incidents";
let _prevTab   = "incidents";

function switchTab(tab) {
  _prevTab = _activeTab;
  _activeTab = tab;

  const labels = { overview:"Overview", incidents:"Incident Queue", containment:"Response Actions", history:"History", lab:"Attack Lab", status:"Security Dashboard", report:"Incident Report" };
  const metas  = { overview:"TopSec AI — autonomous SOC analyst powered by Microsoft Foundry IQ and Semantic Kernel", incidents:"AI watches for threats 24/7 — click Triage to investigate", containment:"AI-proposed blocks and account actions — approve to execute", history:"Past investigations and decisions", lab:"Inject a real attack and watch the AI respond live", status:"Live Azure security posture", report:"Full incident analysis and containment decisions" };

  document.querySelectorAll(".nav-item").forEach(b => b.classList.toggle("active", b.id === "nav-" + tab));
  document.querySelectorAll(".tab-panel").forEach(p => p.style.display = p.id === "tab-" + tab ? "" : "none");
  const ps = document.getElementById("page-scroll");
  if (ps) {
    ps.classList.toggle("report-mode", tab === "report");
  }

  const t = document.getElementById("topbar-title"); if (t) t.textContent = labels[tab] || "";
  const m = document.getElementById("topbar-meta");  if (m) m.textContent = metas[tab]  || "";

  if (tab === "history")          loadHistory();
  else if (tab === "status")      loadTenantStatus();
  else if (tab === "containment") loadContainment();
  else if (tab === "lab")         { refresh(); loadHoneypotStats(); }
  else if (tab !== "report")      refresh();

  _refreshDemoRings();
}

// ── Incident cards ─────────────────────────────────────────────────────────────

let _activeSevFilter = "All";

function makeCard(item, btnLabel, onClickFn, opts = {}) {
  const sev   = extractSev(item);
  const ago   = timeAgo(item.generated_at);
  const title = item.title || `Incident #${item.incident_number}`;

  const div = document.createElement("div");
  div.className = "incident-card";
  if (opts.delay) div.style.animationDelay = `${opts.delay}ms`;

  div.innerHTML = `
    <div class="card-stripe ${sev}"></div>
    <div class="card-body">
      <div class="card-top">
        <span class="card-num">#${item.incident_number}</span>
        <span class="card-sev ${severityClass(sev)}">${sev || "?"}</span>
        ${item.reviewer_decision ? `<span class="card-decision card-decision-${item.reviewer_decision}">${item.reviewer_decision}</span>` : ""}
        <span class="card-ago">${ago}</span>
      </div>
      <div class="card-title">${escHtml(title)}</div>
      <div class="card-chips">
        ${item.action_count ? `<span class="chip chip-neutral">${item.action_count} action${item.action_count !== 1 ? "s" : ""} proposed</span>` : ""}
      </div>
      <div class="card-expand-panel" style="display:none">
        <div class="expand-row expand-action-hint">Click "${btnLabel}" to open the full report, MITRE mappings, and containment actions →</div>
      </div>
    </div>
    <div class="card-action-col">
      <button class="card-primary-btn">${escHtml(btnLabel)} <svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg></button>
      ${opts.extraBtns || ""}
      <button class="card-dismiss-btn" data-dismiss="${item.report_id}" title="Dismiss">
        <svg width="9" height="9" viewBox="0 0 12 12" fill="none"><path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
      </button>
    </div>
  `;

  div.querySelector(".card-primary-btn").addEventListener("click", onClickFn);
  div.querySelector(".card-dismiss-btn").addEventListener("click", async e => {
    const id = e.currentTarget.dataset.dismiss;
    try { await apiFetch(`/reports/${id}`, { method:"DELETE" }); div.remove(); refresh(); } catch {}
  });

  if (opts.extraHandlers) opts.extraHandlers.forEach(({ sel, fn }) => div.querySelector(sel)?.addEventListener("click", fn));

  return div;
}

// ── Refresh (pending queue) ────────────────────────────────────────────────────

async function refresh() {
  try {
    const [pending, completed] = await Promise.all([apiFetch("/pending"), apiFetch("/completed")]);
    setLiveStatus(true);

    updatePendingBadge(pending.length);

    const bI = document.getElementById("nav-badge-incidents");
    const bH = document.getElementById("nav-badge-history");
    if (bI) { bI.textContent = pending.length; bI.style.display = pending.length ? "" : "none"; }
    if (bH) { bH.textContent = completed.length; bH.style.display = completed.length ? "" : "none"; }


    if (_activeTab !== "incidents") return;

    const list  = document.getElementById("incidents-list");
    const empty = document.getElementById("incidents-empty");

    const filtered = _activeSevFilter === "All" ? pending : pending.filter(i => extractSev(i) === _activeSevFilter);
    if (!filtered.length) {
      list.innerHTML = "";
      empty.style.display = "";
      if (!pending.length) setPipelineIdle();
    } else {
      empty.style.display = "none";
      filtered.sort((a,b) => new Date(b.generated_at) - new Date(a.generated_at));

      // Keyed reconcile — only add/remove deltas, never touch existing cards
      const existingIds = new Set(
        [...list.querySelectorAll("[data-report-id]")].map(el => el.dataset.reportId)
      );
      const incomingIds = new Set(filtered.map(i => i.report_id));

      // Remove stale cards
      list.querySelectorAll("[data-report-id]").forEach(el => {
        if (!incomingIds.has(el.dataset.reportId)) el.remove();
      });

      // Insert new cards at the correct sorted position; update existing if triage status changed
      const SVG_ARROW = `<svg width="10" height="10" viewBox="0 0 16 16" fill="none"><path d="M6 3l5 5-5 5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>`;
      filtered.forEach((item, idx) => {
        const isTriaged = _triagedReports.has(item.report_id);
        if (existingIds.has(item.report_id)) {
          // Flip "Triage" → "View Report" if pipeline was run since last render
          if (isTriaged) {
            const existingCard = list.querySelector(`[data-report-id="${item.report_id}"]`);
            const btn = existingCard?.querySelector(".card-primary-btn");
            if (btn && btn.textContent.trim().startsWith("Triage")) {
              const newBtn = btn.cloneNode(false);
              newBtn.className = btn.className;
              newBtn.innerHTML = `View Report ${SVG_ARROW}`;
              newBtn.addEventListener("click", () => openReport(item.report_id));
              btn.replaceWith(newBtn);
            }
          }
          return;
        }
        const label   = isTriaged ? "View Report" : "Triage";
        const handler = isTriaged ? () => openReport(item.report_id) : () => startTriageAnimation(item.report_id);
        const card = makeCard(item, label, handler);
        card.dataset.reportId = item.report_id;
        const ref = list.children[idx] || null;
        list.insertBefore(card, ref);
      });
    }
  } catch { setLiveStatus(false); }
}

// ── History ────────────────────────────────────────────────────────────────────

async function loadHistory() {
  try {
    const completed = await apiFetch("/completed");
    const list  = document.getElementById("history-list");
    const empty = document.getElementById("history-empty");
    list.innerHTML = "";

    if (!completed.length) { empty.style.display = ""; return; }
    empty.style.display = "none";
    completed.sort((a,b) => new Date(b.generated_at) - new Date(a.generated_at));
    completed.forEach((item, i) => list.appendChild(makeCard(item, "View", () => openReport(item.report_id, true), {
      delay: i * 40,
      extraBtns: `<button class="card-secondary-btn" data-reopen="${item.report_id}">Reopen</button>`,
      extraHandlers: [{ sel: ".card-secondary-btn", fn: () => reopenReport(item.report_id) }],
    })));
  } catch {}
}

// ── Containment tab ────────────────────────────────────────────────────────────

async function loadContainment() {
  const el = document.getElementById("containment-content");
  el.innerHTML = `<div class="empty-state"><div class="empty-title" style="color:var(--text-muted)">Loading…</div></div>`;
  try {
    const [pending, completed] = await Promise.all([apiFetch("/pending"), apiFetch("/completed")]);
    const all = [...pending, ...completed];
    const withActions = all.filter(r => r.action_count > 0);

    if (!withActions.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-title">No Actions Yet</div><div class="empty-sub">AI-proposed blocks and account actions appear here after a confirmed real attack is triaged.</div></div>`;
      return;
    }

    // Pending action count for badge
    const pendingActionCount = pending.filter(r => r.action_count > 0).length;
    const badge = document.getElementById("nav-badge-containment");
    if (badge) { badge.textContent = pendingActionCount; badge.style.display = pendingActionCount ? "" : "none"; }

    el.innerHTML = `<div class="containment-list" id="containment-list"></div>`;
    const cList = document.getElementById("containment-list");

    for (const item of withActions) {
      const report = await apiFetch(`/reports/${item.report_id}`);
      const effectiveActions = report.recommended_actions.filter(a => a.target || a.reason);
      if (!effectiveActions.length) continue;
      const isPending = !item.reviewer_decision;

      const section = document.createElement("div");
      section.className = "containment-section";
      section.innerHTML = `
        <div class="containment-section-header">
          <span class="cs-num">#${report.incident_number}</span>
          <span class="cs-title">${escHtml(report.title || "Incident #" + report.incident_number)}</span>
          <span class="cs-status ${isPending ? "cs-pending" : "cs-done"}">${isPending ? "Awaiting Review" : report.reviewer_decision}</span>
          <button class="btn btn-sm btn-ghost cs-open-btn">Open Report →</button>
        </div>
        <div class="containment-actions-grid">
          ${(() => {
            const AL = {
              DeviceIsolation:"Device Isolation", RevokeUserSessions:"Revoke Sessions",
              DisableAccount:"Disable Account", BlockIP:"Block IP",
              DeleteInboxRule:"Delete Inbox Rule", Custom:"Custom Action"
            };
            const iconOf = t => ({
              BlockIP:            "🚫",
              DeviceIsolation:    "💻",
              RevokeUserSessions: "🔑",
              DisableAccount:     "👤",
              DeleteInboxRule:    "📧",
              Custom:             "⚙️",
            }[t] || "⚙️");
            const rows = report.recommended_actions.filter(a => a.target || a.reason).map(a => {
              const typeLabel = AL[a.action_type] || a.action_type || "Action";
              const target    = a.target || (a.reason ? a.reason.slice(0, 50) : "—");
              return `
              <div class="ca-card ${a.approved === true ? "ca-approved" : a.approved === false ? "ca-rejected" : ""}">
                <div class="ca-type-row">
                  <span class="ca-icon">${iconOf(a.action_type)}</span>
                  <span class="ca-type">${escHtml(typeLabel)}</span>
                </div>
                <div class="ca-target">${escHtml(target)}</div>
                <div class="ca-reason">${escHtml(a.reason || "")}</div>
                ${a.executed_at ? `<div class="ca-executed">✓ Executed ${timeAgo(a.executed_at)}</div>` : ""}
                ${a.approved === false ? `<div class="ca-rejected-label">Rejected</div>` : ""}
              </div>`;
            }).join("");
            return rows || "<div style='padding:8px;font-size:11px;color:var(--text-muted)'>No actions proposed</div>";
          })()}
        </div>
        ${isPending ? `<div class="cs-cta"><button class="btn btn-primary cs-triage-btn" data-id="${item.report_id}">Review &amp; Approve →</button></div>` : ""}
        ${report.containment_result?.iocs_blocked?.length ? `
          <div class="cs-rollback-row">
            <span class="cs-rollback-label">${report.containment_result.iocs_blocked.length} IP(s) blocked</span>
            ${!report.rollback_result ? `<button class="btn btn-sm btn-reject cs-rollback-btn" data-id="${item.report_id}">↩ Rollback</button>` : `<span class="cs-rolled-back">↩ Rolled back</span>`}
          </div>
        ` : ""}
      `;
      section.querySelector(".cs-open-btn").addEventListener("click", () => openReport(item.report_id, !isPending));
      section.querySelector(".cs-triage-btn")?.addEventListener("click", () => openReport(item.report_id, false));
      section.querySelector(".cs-rollback-btn")?.addEventListener("click", async btn => {
        try { await apiFetch(`/reports/${item.report_id}/rollback`, { method:"POST" }); loadContainment(); } catch(e) { showToast(e.message, true); }
      });
      cList.appendChild(section);
    }
  } catch(e) { el.innerHTML = `<div class="empty-state"><div class="empty-title">Failed to load: ${escHtml(e.message)}</div></div>`; }
}

// ── Report (drawer) ────────────────────────────────────────────────────────────

let _currentReport = null;
const _triagedReports = new Set();

async function openReport(reportId, readOnly = false) {
  const fromTab = _activeTab;
  try {
    const r = await apiFetch(`/reports/${reportId}`);
    _currentReport = r;
    renderReport(r, readOnly);
    animateFoundryIQ(r);
    document.getElementById("drawer-inc-label").textContent = `Incident #${r.incident_number}`;
    _prevTab = fromTab === "report" ? (_prevTab || "incidents") : fromTab;
    switchTab("report");
    document.getElementById("page-scroll").scrollTo(0, 0);
  } catch(e) {
    if (e.message.startsWith("404")) { refresh(); showToast("Incident already processed — queue refreshed", false); }
    else showToast("Could not open report — try injecting a new scenario", false);
  }
}

function closeDrawer() {
  _currentReport = null;
  switchTab(_prevTab || "incidents");
}

async function reopenReport(reportId) {
  try {
    await apiFetch(`/reports/${reportId}/reopen`, { method:"POST" });
    loadHistory();
  } catch(e) { showToast(e.message, true); }
}

// ── Report rendering ───────────────────────────────────────────────────────────

function renderReportPipeline(r) {
  // Stages 1-4 are always done (they ran for the report to exist)
  // ECHO stage: done only if TruePositive + echo_rule was generated
  const echoId = document.getElementById("rpt-pipe-echo");
  if (!echoId) return;
  const echoDone = r.classification === "TruePositive" && r.echo_rule && !r.echo_rule?.skipped;
  echoId.className = "rpt-pipe-stage" + (echoDone ? " rpt-pipe-done rpt-pipe-echo-done" : " rpt-pipe-skipped");
  // Update ECHO dot label hint
  const lbl = echoId.querySelector(".rpt-pipe-lbl");
  if (lbl) lbl.textContent = echoDone ? "ECHO ✓" : "ECHO";
}

function renderReport(r, readOnly = false) {
  document.getElementById("rpt-title").textContent  = r.title || `Incident #${r.incident_number}`;
  const _sevWord = (r.severity_assessment || "").match(/^(Critical|High|Medium|Low|Informational)/i);
  document.getElementById("rpt-sev").textContent = _sevWord ? _sevWord[1] : (r.severity_assessment || "—");
  document.getElementById("rpt-summary").textContent = r.summary || "";

  const notes = document.getElementById("rpt-analyst-notes");
  const notesCard = document.getElementById("rpt-notes-card");
  if (r.analyst_notes) { notes.textContent = r.analyst_notes; notesCard.style.display = ""; }
  else notesCard.style.display = "none";

  renderPicerlTrack(r);
  // Reset to Report tab on each new report
  const firstTab = document.querySelector(".rpt-tab-btn");
  if (firstTab) switchRptTab("report", firstTab);

  renderReportPipeline(r);
  renderTimeline(r.timeline || r.attack_timeline || []);
  renderMitre(r.mitre_mappings || []);
  renderIocs(r.ioc_list || []);
  renderEnrichment(r.entity_enrichments || []);
  renderActions(r.recommended_actions || [], readOnly);
  renderPicerlCard(r);
  renderEcho(r.echo_rule);
  renderRollback(r, readOnly);
  renderExecResults(r);

  document.getElementById("submit-result").style.display = "none";
  document.getElementById("reviewer-notes").value = r.reviewer_notes || "";

  const apCard = document.getElementById("approval-card");
  if (apCard) apCard.style.display = readOnly ? "none" : "";
}

// PICERL track bar
const PICERL_ICONS = {
  Identification:`<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><circle cx="6.5" cy="6.5" r="4" stroke="currentColor" stroke-width="1.4"/><path d="M10 10l3 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`,
  Containment:`<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M8 2l5 2.5v4C13 11.5 10.8 13.8 8 14.5 5.2 13.8 3 11.5 3 8.5v-4L8 2z" stroke="currentColor" stroke-width="1.4"/></svg>`,
  Eradication:`<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M4 5h8M6 5V3h4v2M5 5l.7 8h4.6L11 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  Recovery:`<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M2.5 8a5.5 5.5 0 1 1 1.5 3.8" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><path d="M2.5 12V8.5H6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
  "Lessons / ECHO":`<svg width="12" height="12" viewBox="0 0 16 16" fill="none"><path d="M9 2L4 9h4l-1 5 5-7H8l1-5z" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`,
};

function renderPicerlTrack(r) {
  const isTP = r.classification === "TruePositive";
  const steps = [
    { label:"Identification", done:true },
    { label:"Containment",    done:isTP && !!r.containment_result },
    { label:"Eradication",    done:isTP && !!r.eradication_result },
    { label:"Recovery",       done:isTP && !!r.recovery_result },
    { label:"Lessons / ECHO", done:isTP && !!r.echo_rule && !r.echo_rule?.skipped, echo:true },
  ];
  document.getElementById("picerl-track").innerHTML = steps.map(s => `
    <div class="picerl-step ${s.done?"done":""} ${s.echo?"echo-step":""}">
      ${s.done ? `<span class="ps-check">✓</span>` : ""}
      <span class="ps-icon">${PICERL_ICONS[s.label]||""}</span>
      <span class="ps-label">${s.label}</span>
    </div>
  `).join("");
}

function renderTimeline(evts) {
  const el = document.getElementById("rpt-timeline");
  if (!evts.length) { el.innerHTML = `<li class="tl-empty">No timeline data.</li>`; return; }
  el.innerHTML = evts.map(e => {
    if (typeof e === "string") {
      const m = e.match(/^(\S+)\s+[—\-–]\s+(.+)$/);
      return m ? `<li><span class="tl-time">${escHtml(m[1])}</span><span class="tl-event">${escHtml(m[2])}</span></li>`
               : `<li><span class="tl-event">${escHtml(e)}</span></li>`;
    }
    return `<li><span class="tl-time">${escHtml(e.timestamp||"")}</span><span class="tl-event">${escHtml(e.event||e.description||"")}</span></li>`;
  }).join("");
}

function renderMitre(mappings) {
  const badge = document.getElementById("rpt-mitre-badge");
  if (badge) { badge.textContent = mappings.length; badge.style.display = mappings.length ? "" : "none"; }
  const tbody = document.querySelector("#rpt-mitre tbody");
  tbody.innerHTML = mappings.length
    ? mappings.map(m => `<tr>
        <td><span class="mitre-id">${escHtml(m.technique_id)}</span> <span class="mitre-name">${escHtml(m.technique_name)}</span></td>
        <td><span class="chip chip-neutral" style="font-size:10px">${escHtml(m.tactic)}</span></td>
        <td class="mitre-evidence">${escHtml(m.evidence||"—")}</td>
      </tr>`).join("")
    : `<tr><td colspan="3" style="color:var(--text-muted)">No mappings.</td></tr>`;
}

function renderIocs(iocs) {
  const el = document.getElementById("rpt-iocs");
  if (!iocs.length) {
    el.innerHTML = `<li style="color:var(--text-muted)">No IOCs extracted.</li>`;
    return;
  }
  const SHOW = 5;
  const visible = iocs.slice(0, SHOW);
  const rest = iocs.slice(SHOW);
  const moreHtml = rest.length ? `
    <li class="ioc-more-row">
      <button class="ioc-expand-btn" onclick="
        var m=this.closest('ul').querySelector('.ioc-more-list');
        var open=m.style.display!=='none';
        m.style.display=open?'none':'block';
        this.textContent=open?'▾ Show ${rest.length} more IPs':'▴ Hide';
      ">▾ Show ${rest.length} more IPs</button>
      <ul class="ioc-more-list ioc-list" style="display:none;margin:4px 0 0;padding:0">
        ${rest.map(i => `<li><code class="ioc-val">${escHtml(i)}</code></li>`).join("")}
      </ul>
    </li>` : "";
  el.innerHTML = visible.map(i => `<li><code class="ioc-val">${escHtml(i)}</code></li>`).join("") + moreHtml;
}

function renderEnrichment(enrichments) {
  const card = document.getElementById("rpt-enrich-card");
  const grid = document.getElementById("rpt-enrichments");
  if (!card || !grid) return;
  if (!enrichments || !enrichments.length) { card.style.display = "none"; return; }
  card.style.display = "";

  function inferType(name, entityType) {
    const t = (entityType || "").toLowerCase();
    if (t === "ip") return "IP";
    if (t === "user" || t === "account") return "USR";
    if (t === "hash") return "HASH";
    if (t === "host" || t === "hostname" || t === "device") return "DEVICE";
    const n = name || "";
    if (/^(\d{1,3}\.){3}\d{1,3}$/.test(n)) return "IP";
    if (/@/.test(n)) return "USR";
    if (/^(DESKTOP|WORKSTATION|CORP|SERVER|VM|PC)-/i.test(n)) return "DEVICE";
    return t.toUpperCase() || "ENT";
  }

  // Sort users + devices first, then IPs — cap at 8 for readability
  const TYPE_ORDER = { USR: 0, DEVICE: 1, IP: 2, HASH: 3, ENT: 4 };
  const sorted = [...enrichments].sort((a, b) => {
    const na = a.entity || a.value || a.ip || a.user || a.hash || "";
    const nb = b.entity || b.value || b.ip || b.user || b.hash || "";
    return (TYPE_ORDER[inferType(na, a.entity_type)] ?? 4) - (TYPE_ORDER[inferType(nb, b.entity_type)] ?? 4);
  }).slice(0, 8);

  grid.innerHTML = sorted.map(e => {
    // Support three formats: flat live agent, nested ip_data/identity_data (demo fixture), enrich_ip (live agent)
    const ipData    = e.ip_data || {};
    const idData    = e.identity_data || {};
    const enrich_ip = e.enrich_ip || {};
    const name      = e.entity || e.value || e.ip || e.user || e.hash || "Unknown";
    const typeLabel = inferType(name, e.entity_type);
    let badges = "";

    // GreyNoise
    const gn = e.greynoise || ipData.greynoise || enrich_ip.greynoise;
    if (gn && gn.noise !== undefined) {
      if (gn.riot) badges += `<span class="enrich-badge badge-safe">GN: Legitimate</span>`;
      else if (gn.noise) badges += `<span class="enrich-badge badge-warn">GN: Scanner</span>`;
      else if (gn.classification === "malicious") badges += `<span class="enrich-badge badge-mal">GN: Malicious</span>`;
      else badges += `<span class="enrich-badge badge-neutral">GN: ${escHtml(gn.classification || "unknown")}</span>`;
    }

    // VirusTotal
    const vt = e.virustotal || ipData.virustotal || enrich_ip.virustotal;
    if (vt && vt.malicious !== undefined) {
      const cls = vt.malicious > 0 ? "badge-mal" : "badge-safe";
      const total = vt.total || vt.harmless + vt.malicious + (vt.suspicious || 0) || "?";
      badges += `<span class="enrich-badge ${cls}">VT: ${vt.malicious}/${total} detections</span>`;
    }

    // AbuseIPDB
    const ab      = e.abuseipdb || ipData.abuseipdb || enrich_ip.abuseipdb;
    const abScore = ab?.score ?? ab?.abuse_confidence;
    if (ab && abScore !== undefined) {
      const cls = abScore >= 50 ? "badge-mal" : abScore >= 20 ? "badge-warn" : "badge-safe";
      badges += `<span class="enrich-badge ${cls}">Abuse: ${abScore}%</span>`;
    }

    // Identity / Entra risk (demo fixture identity_data OR live user_risk)
    const riskState = e.risk_state || idData.risk_state || e.user_risk?.riskState;
    const riskLevel = e.risk_level || idData.risk_level || e.user_risk?.riskLevel;
    if (riskState === "atRisk" || riskLevel === "high") {
      badges += `<span class="enrich-badge badge-mal">Entra: atRisk</span>`;
      if (!idData.mfa_registered && idData.mfa_registered !== undefined)
        badges += `<span class="enrich-badge badge-warn">No MFA</span>`;
    } else if (riskLevel === "medium") {
      badges += `<span class="enrich-badge badge-warn">Entra: medium risk</span>`;
    } else if ((riskState && riskState !== "none") || (riskLevel && riskLevel !== "none")) {
      badges += `<span class="enrich-badge badge-safe">Entra: ${escHtml(riskLevel || riskState)}</span>`;
    }

    // UEBA (demo flat e.ueba OR live e.user_behavior_ueba)
    const ueba = e.ueba || (e.user_behavior_ueba?.ueba_available !== false ? e.user_behavior_ueba : null);
    if (ueba && ueba.investigation_priority !== undefined) {
      const prio = ueba.investigation_priority;
      const uebaClass = prio >= 7 ? "badge-mal" : prio >= 4 ? "badge-warn" : "badge-safe";
      badges += `<span class="enrich-badge ${uebaClass}">UEBA: ${prio}/10${ueba.risk_level ? ` · ${escHtml(ueba.risk_level)}` : ""}</span>`;
      if (ueba.anomaly_categories && ueba.anomaly_categories.length)
        badges += `<span class="enrich-badge badge-neutral">${escHtml(ueba.anomaly_categories.slice(0, 2).join(", "))}</span>`;
    }

    // Device compliance (live e.device_compliance)
    const complianceState = e.device_compliance?.complianceState;
    if (complianceState) {
      const cls = complianceState === "compliant" ? "badge-safe" : complianceState === "noncompliant" ? "badge-mal" : "badge-warn";
      badges += `<span class="enrich-badge ${cls}">Compliance: ${escHtml(complianceState)}</span>`;
    }

    if (!badges) return null;

    return `<div class="enrich-entity">
      <div class="enrich-entity-hdr">
        <span class="enrich-type-tag">${typeLabel}</span>
        <code class="enrich-name">${escHtml(name)}</code>
      </div>
      <div class="enrich-badges">${badges}</div>
    </div>`;
  }).filter(Boolean).join("");

  if (!grid.innerHTML) {
    card.style.display = "none";
    return;
  }
}

function renderActions(actions, readOnly) {
  const el = document.getElementById("action-list");
  const btns = document.getElementById("approval-btns");
  // Update Response tab badge with pending action count
  const badge = document.getElementById("rpt-action-badge");
  if (badge) {
    const pending = actions.filter(a => a.approved !== true && a.approved !== false).length;
    badge.textContent = pending;
    badge.style.display = pending > 0 ? "" : "none";
  }
  if (!actions.length) { el.innerHTML = `<p style="font-size:12px;color:var(--text-muted)">No containment actions proposed.</p>`; if (btns) btns.style.display = "none"; return; }
  if (btns) btns.style.display = readOnly ? "none" : "";

  const ACTION_LABELS = { DeviceIsolation:"Device Isolation", RevokeUserSessions:"Revoke Sessions", DisableAccount:"Disable Account", BlockIP:"Block IP", DeleteInboxRule:"Delete Inbox Rule", Custom:"Custom Action" };
  const ACTION_ICONS = { BlockIP:"🚫", DeviceIsolation:"💻", RevokeUserSessions:"🔑", DisableAccount:"👤", DeleteInboxRule:"📧", Custom:"⚙️" };
  el.innerHTML = actions.map(a => {
    const typeLabel = ACTION_LABELS[a.action_type] || a.action_type || "Action";
    const target    = a.target || (a.reason ? a.reason.slice(0, 60) : "—");
    return `
    <div class="action-item ${a.approved===true?"approved":a.approved===false?"rejected":""}" data-id="${a.action_id}">
      <div class="action-type-badge">${ACTION_ICONS[a.action_type] || "⚙️"} ${escHtml(typeLabel)}</div>
      <div class="action-target">${escHtml(target)}</div>
      <div class="action-reason">${escHtml(a.reason||"")}</div>
      ${!readOnly ? `<div class="action-btns">
        <button class="action-btn approve-btn ${a.approved===true?"active":""}" data-action="${a.action_id}" data-approved="true">✓ Approve</button>
        <button class="action-btn reject-btn  ${a.approved===false?"active":""}" data-action="${a.action_id}" data-approved="false">✕ Reject</button>
      </div>` : a.approved===true ? `<div class="action-executed">✓ Approved</div>` : a.approved===false ? `<div class="action-rejected">✕ Rejected</div>` : ""}
      ${a.executed_at ? `<div class="action-exec-time">Executed ${timeAgo(a.executed_at)}</div>` : ""}
    </div>
  `;
  }).join("");
}

function renderPicerlCard(r) {
  const card = document.getElementById("picerl-card");
  const phases = [];
  if (r.containment_result) {
    const blocked = r.containment_result.iocs_blocked || [];
    phases.push({ label:"Containment", detail:`${blocked.length} IP(s) blocked${blocked.length ? ": " + blocked.slice(0,2).join(", ") : ""}` });
  }
  if (r.eradication_result) {
    const n = (r.eradication_result.actions_taken||[]).length;
    phases.push({ label:"Eradication", detail:`${n} cleanup action(s)` });
  }
  if (r.recovery_result) {
    const n = (r.recovery_result.checks_passed||[]).length;
    phases.push({ label:"Recovery", detail:`${r.recovery_result.status||""} (${n} checks passed)` });
  }
  if (!phases.length) { card.style.display = "none"; return; }
  card.style.display = "";
  document.getElementById("picerl-phases").innerHTML = phases.map(p => `
    <div class="phase-row">
      <span class="phase-check">✓</span>
      <span class="phase-label">${p.label}</span>
      <span class="phase-detail">${escHtml(p.detail)}</span>
    </div>
  `).join("");
}

function renderEcho(echo) {
  const card = document.getElementById("echo-card");
  if (!echo || echo.skipped) { card.style.display = "none"; return; }
  card.style.display = "";
  const gap  = echo.detection_gap_minutes || 0;
  const save = echo.estimated_gap_reduction_minutes || 0;
  const after = Math.max(0, gap - save);
  const kql  = echo.kql_query || "";
  const pushed = echo.pushed_to_sentinel || echo.sentinel_push?.pushed;

  document.getElementById("echo-content").innerHTML = `
    <div class="echo-rule-name">${escHtml(echo.rule_name||"ECHO Rule")}</div>
    ${echo.earliest_signal ? `<div class="echo-signal">Earliest signal: ${escHtml(echo.earliest_signal)}</div>` : ""}
    ${gap > 0 ? `
    <div class="gap-row">
      <span class="gap-before">${gap}m</span>
      <span class="gap-arrow">→</span>
      <span class="gap-after">${after}m</span>
      <span class="gap-save">saves ${save} min</span>
    </div>` : ""}
    ${pushed ? `<div class="echo-pushed">✓ Draft pushed to Sentinel Analytics</div>` : ""}
    ${kql ? `<button class="btn-link" id="kql-toggle">View detection rule →</button><pre class="kql-block" id="kql-block" style="display:none">${escHtml(kql)}</pre>` : ""}
  `;
  document.getElementById("kql-toggle")?.addEventListener("click", () => {
    const b = document.getElementById("kql-block");
    if (b) b.style.display = b.style.display === "none" ? "" : "none";
  });
}

function renderRollback(r, readOnly) {
  const card = document.getElementById("rollback-card");
  if (!r.containment_result?.iocs_blocked?.length || readOnly) { card.style.display = "none"; return; }
  card.style.display = "";
  const btn = document.getElementById("rollback-btn");
  if (r.rollback_result) {
    btn.disabled = true; btn.textContent = "Rolled Back";
    const d = document.getElementById("rollback-detail");
    if (d) d.innerHTML = `<span style="color:var(--success);font-size:12px">✓ ${escHtml(r.rollback_result.note||"Rollback complete")}</span>`;
  } else {
    btn.disabled = false; btn.textContent = "↩ Rollback";
    const newBtn = btn.cloneNode(true);
    btn.replaceWith(newBtn);
    document.getElementById("rollback-btn").addEventListener("click", () => doRollback(r.report_id));
  }
}

function renderExecResults(r) {
  const card = document.getElementById("exec-results-card");
  const executed = (r.recommended_actions||[]).filter(a => a.executed_at);
  if (!executed.length) { card.style.display = "none"; return; }
  card.style.display = "";
  document.getElementById("exec-results-list").innerHTML = executed.map(a => `
    <div class="exec-row">
      <span class="exec-type">${escHtml(a.action_type)}</span>
      <span class="exec-target">${escHtml(a.target||"")}</span>
      <span class="exec-result">${escHtml(a.execution_result||"")}</span>
    </div>
  `).join("");
}

// ── Foundry IQ live animation ──────────────────────────────────────────────────

async function animateFoundryIQ(r) {
  const card   = document.getElementById("rpt-iq-card");
  const steps  = document.getElementById("iq-steps");
  const status = document.getElementById("iq-status");
  const techs  = r.mitre_mappings || [];
  if (!card || !techs.length) { card && (card.style.display = "none"); return; }

  card.style.display = "";
  steps.innerHTML = "";
  if (status) { status.textContent = "Querying 3 indexes…"; status.className = "iq-live-status searching"; }

  // Show all 3 Foundry IQ sources querying in sequence
  const sources = [
    { label: `mitre-attack — ${techs.length} ATT&CK technique${techs.length!==1?"s":""}`, color: "var(--iq)" },
    { label: "asset-context — asset inventory & expected behaviour", color: "var(--success)" },
    { label: "response-playbooks — grounded containment procedures", color: "var(--echo)" },
  ];
  for (const src of sources) {
    const q = document.createElement("div");
    q.className = "iq-step iq-step-query";
    q.innerHTML = `<span class="iq-cursor" style="background:${src.color}"></span> <span style="color:${src.color};font-size:10px;font-weight:600;font-style:normal">Foundry IQ /</span> ${src.label}`;
    steps.appendChild(q);
    await new Promise(res => setTimeout(res, 340));
    q.querySelector(".iq-cursor")?.remove();
    q.innerHTML = `<span class="iq-tick" style="color:${src.color}">✓</span> <span style="color:${src.color};font-size:10px;font-weight:600">Foundry IQ /</span> ${src.label}`;
    await new Promise(res => setTimeout(res, 120));
  }

  const total = sources.length;
  if (status) { status.textContent = `${total} results across 3 indexes`; status.className = "iq-live-status done"; }
  techs.forEach(t => demoOnIQResult(t));
}

// ── Submit decision ────────────────────────────────────────────────────────────

async function submitDecision(approveAll, rejectAll) {
  if (!_currentReport) return;
  const actions = Array.from(document.querySelectorAll(".action-item"));
  let approved_ids = [], rejected_ids = [];

  if (approveAll) {
    approved_ids = ((_currentReport.recommended_actions||[]).map(a=>a.action_id));
  } else if (rejectAll) {
    rejected_ids = ((_currentReport.recommended_actions||[]).map(a=>a.action_id));
  } else {
    actions.forEach(el => {
      const id = el.dataset.id;
      if (el.dataset.approved === "true") approved_ids.push(id);
      else if (el.dataset.approved === "false") rejected_ids.push(id);
    });
  }

  const notes = document.getElementById("reviewer-notes")?.value || "";
  try {
    const res = await apiFetch(`/reports/${_currentReport.report_id}/approve`, {
      method:"POST",
      body: JSON.stringify({ approved_action_ids:approved_ids, rejected_action_ids:rejected_ids, reviewer_notes:notes, execute_now:true }),
    });
    const el = document.getElementById("submit-result");
    const btns = document.getElementById("approval-btns");
    if (btns) btns.style.display = "none";
    if (el) { el.style.display = ""; el.textContent = `✓ ${res.reviewer_decision} — ${res.approved_actions} action(s) approved and queued for execution`; el.className = "submit-result submit-success"; }
    setTimeout(() => { _currentReport = null; switchTab("history"); setTimeout(refresh, 300); }, 4000);
  } catch(e) {
    setTimeout(() => { refresh(); closeDrawer(); }, 400);
  }
}

async function doRollback(reportId) {
  try {
    await apiFetch(`/reports/${reportId}/rollback`, { method:"POST" });
    setTimeout(async () => {
      const r = await apiFetch(`/reports/${reportId}`);
      if (r.rollback_result) renderRollback(r, true);
    }, 3000);
  } catch(e) { showToast(e.message, true); }
}

// ── Honeypot Live Feed ─────────────────────────────────────────────────────────

async function loadHoneypotStats() {
  try {
    const d = await apiFetch("/honeypot/stats").catch(() => ({ last_run: null, seen_count: 0, triaged_count: 0, recent_incidents: [] }));

    const tEl = document.getElementById("hp-triaged-count");
    const sEl = document.getElementById("hp-seen-count");
    const lEl = document.getElementById("hp-last-run");
    if (tEl) tEl.textContent = d.triaged_count ?? "0";
    if (sEl) sEl.textContent = d.seen_count ?? "0";
    if (lEl) lEl.textContent = d.last_run ? timeAgo(d.last_run) : "never";

    const feed = document.getElementById("hp-recent");
    if (!feed) return;
    const items = d.recent_incidents || [];
    if (!items.length) {
      feed.innerHTML = `<div class="hp-empty">No honeypot incidents triaged yet — click "Detect Now" to run a detection scan.</div>`;
      return;
    }
    feed.innerHTML = items.map(inc => `
      <div class="hp-incident-row">
        <span class="hp-incident-badge ${clsBadgeClass(inc.classification)}">${clsLabel(inc.classification)}</span>
        <span class="hp-incident-title">${escHtml(inc.title.replace("[Honeypot] ",""))}</span>
        <span class="hp-incident-time">${timeAgo(inc.generated_at)}</span>
      </div>
    `).join("");
  } catch(e) {
    const feed = document.getElementById("hp-recent");
    if (feed) feed.innerHTML = `<div class="hp-empty" style="color:var(--text-muted)">Stats unavailable — server may not be running honeypot mode.</div>`;
  }
}

async function runHoneypotDetection() {
  const btn = document.getElementById("hp-detect-btn");
  const status = document.getElementById("hp-detect-status");
  const msg    = document.getElementById("hp-detect-msg");
  if (btn)    btn.disabled = true;
  if (status) status.style.display = "flex";
  if (msg)    msg.textContent = "Running detection queries against Log Analytics…";

  try {
    await apiFetch("/honeypot/trigger", { method: "POST" });
    if (msg) msg.textContent = "Detection complete — new Sentinel incidents queued for triage. Switching to Incident Queue…";
    setTimeout(() => {
      if (status) status.style.display = "none";
      if (btn)    btn.disabled = false;
      loadHoneypotStats();
      switchTab("incidents");
      // Poll aggressively — pipeline takes ~37s
      let polls = 0;
      const iv = setInterval(() => { polls++; refresh(); if (polls >= 15) clearInterval(iv); }, 8000);
    }, 3000);
  } catch(e) {
    if (msg)    msg.textContent = "Detection failed: " + e.message;
    if (status) status.style.display = "flex";
    if (btn)    btn.disabled = false;
    setTimeout(() => { if (status) status.style.display = "none"; }, 4000);
  }
}

// ── Attack Lab triggers ────────────────────────────────────────────────────────

async function triggerScenario(scenario, btn) {
  const existing = await apiFetch("/pending").catch(() => []);
  if (existing.length > 0) {
    switchTab("incidents");
    await refresh();
    return;
  }
  document.querySelectorAll(".lab-trigger-btn").forEach(b => { b.disabled = true; });
  if (btn) { btn.textContent = "Injecting…"; }
  try {
    await apiFetch(`/demo/trigger?scenario=${encodeURIComponent(scenario)}`, { method:"POST" });
    document.querySelectorAll(".lab-trigger-btn").forEach(b => { b.disabled = false; b.textContent = "Inject →"; });
    switchTab("incidents");
    await refresh();
  } catch(e) {
    document.querySelectorAll(".lab-trigger-btn").forEach(b => { b.disabled = false; b.textContent = "Inject →"; });
    showToast(e.message, true);
  }
}

// ── Tenant Status ──────────────────────────────────────────────────────────────

async function loadTenantStatus() {
  const el = document.getElementById("status-content");
  el.innerHTML = `<div class="empty-state"><div class="empty-title" style="color:var(--text-muted)">Loading…</div></div>`;
  try {
    const [d, pending, completed] = await Promise.all([apiFetch("/tenant/status"), apiFetch("/pending"), apiFetch("/completed")]);
    if (d.error) { el.innerHTML = `<div class="status-error" style="padding:14px;font-size:12px;color:var(--text-muted)">Azure connectivity required — configure your Sentinel workspace credentials in <code>.env</code> to load live NSG rules, Defender posture, and identity risk data.</div>`; return; }

    const allReports = [...pending, ...completed];
    const findReport = incNum => allReports.find(r => r.incident_number === incNum);

    const sevCls = s => ({ High:"badge-danger",Medium:"badge-warning",Low:"badge-neutral",Informational:"badge-neutral" }[s]||"badge-neutral");
    const stsCls = s => ({ Active:"badge-danger",Closed:"badge-success",New:"badge-warning" }[s]||"badge-neutral");
    const openInc  = (d.incidents||[]).filter(i=>i.status==="Active"||i.status==="New").length;

    const totalClosed = d.local_completed || 0;
    const totalPending = d.local_pending || 0;
    const nsgCount = d.nsg_blocks?.length || 0;
    const incList = d.incidents || [];

    el.innerHTML = `
      <div class="soc-dashboard">
        <!-- Header -->
        <div class="soc-hdr">
          <div>
            <div class="soc-hdr-title">Security Operations Center</div>
            <div class="soc-hdr-sub">Microsoft Sentinel · Azure AI · GPT-4.1-mini · Foundry IQ (MITRE ATT&amp;CK)</div>
          </div>
          <div class="soc-hdr-live">
            <span class="pulse-dot"></span>
            <span style="font-size:11px;color:var(--text-muted)">Live</span>
          </div>
        </div>

        <!-- KPI row -->
        <div class="soc-kpi-row">
          <button class="soc-kpi" data-nav="incidents">
            <div class="soc-kpi-icon soc-kpi-icon-warn">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="2" y="4" width="20" height="16" rx="2" stroke="currentColor" stroke-width="1.5"/><path d="M7 9h10M7 13h6" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>
            </div>
            <div class="soc-kpi-val">${totalPending}</div>
            <div class="soc-kpi-lbl">Awaiting Review</div>
          </button>
          <button class="soc-kpi" data-nav="history">
            <div class="soc-kpi-icon soc-kpi-icon-ok">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div class="soc-kpi-val">${totalClosed}</div>
            <div class="soc-kpi-lbl">Cases Closed</div>
          </button>
          <button class="soc-kpi" data-nav="containment">
            <div class="soc-kpi-icon soc-kpi-icon-danger">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M8 11l2.5 2.5L15 9" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
            </div>
            <div class="soc-kpi-val">${nsgCount}</div>
            <div class="soc-kpi-lbl">IPs Blocked</div>
          </button>
          <button class="soc-kpi" data-nav="incidents">
            <div class="soc-kpi-icon soc-kpi-icon-blue">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l7 4v5c0 4.5-3 8.5-7 10C8 20.5 5 16.5 5 12V7l7-4z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>
            </div>
            <div class="soc-kpi-val">${openInc}</div>
            <div class="soc-kpi-lbl">Open in Sentinel</div>
          </button>
        </div>

        <!-- Two-col content -->
        <div class="soc-body">
          <!-- Sentinel incidents -->
          <div class="report-card soc-incidents-card">
            <div class="report-card-title">
              Sentinel — Live Incident Feed
              <span class="rc-title-sub">Click row to open triage report</span>
            </div>
            <table class="status-table status-table-hover">
              <thead><tr><th>#</th><th>Incident</th><th>Sev</th><th>Status</th><th>Created</th><th></th></tr></thead>
              <tbody id="sentinel-inc-tbody">
                ${incList.length ? incList.map(inc => {
                  const rpt = findReport(inc.number);
                  return `<tr class="status-row ${rpt ? 'status-row-linked' : ''}" data-num="${inc.number}" data-rpt="${rpt ? rpt.report_id : ''}">
                    <td class="mono-sm" style="color:var(--text-muted)">#${inc.number}</td>
                    <td class="inc-title-cell">${escHtml(inc.title)}</td>
                    <td><span class="badge ${sevCls(inc.severity)}" style="font-size:10px">${inc.severity}</span></td>
                    <td><span class="badge ${stsCls(inc.status)}" style="font-size:10px">${inc.status}</span></td>
                    <td class="muted-sm">${new Date(inc.created).toLocaleDateString()}</td>
                    <td>${rpt ? `<button class="status-open-btn" data-rpt="${rpt.report_id}" data-done="${!!rpt.reviewer_decision}">Report →</button>` : `<span style="font-size:10px;color:var(--text-muted)">No report</span>`}</td>
                  </tr>`;
                }).join("") : `<tr><td colspan="6" style="color:var(--text-muted);text-align:center;padding:24px">No recent incidents from Sentinel.</td></tr>`}
              </tbody>
            </table>
          </div>

          <!-- Firewall blocks -->
          <div class="report-card soc-nsg-card">
            <div class="report-card-title">
              Active Firewall Blocks
              <span class="rc-title-sub">Containment rules created by TopSec</span>
            </div>
            ${nsgCount ? `<table class="status-table" id="nsg-table">
              <thead><tr><th>Blocked IP</th><th>Rule</th><th>NSG</th><th></th></tr></thead>
              <tbody>${(d.nsg_blocks||[]).map(b=>`
                <tr>
                  <td><code style="color:var(--danger);font-size:11px">${escHtml(b.ip)}</code></td>
                  <td class="muted-sm" style="font-size:11px">${escHtml(b.name)}</td>
                  <td class="muted-sm" style="font-size:11px">${escHtml(b.nsg)}</td>
                  <td><button class="nsg-del-btn" data-nsg="${escHtml(b.nsg)}" data-rule="${escHtml(b.name)}" style="font-size:10px">Remove</button></td>
                </tr>`).join("")}
              </tbody>
            </table>` : `<div style="padding:24px;text-align:center;color:var(--text-muted);font-size:12px">No active blocks — containment actions will appear here after triage approvals.</div>`}
          </div>
        </div>
      </div>
    `;

    // Stat card nav
    el.querySelectorAll(".stat-card-btn").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.nav));
    });

    // KPI tile nav
    el.querySelectorAll(".soc-kpi[data-nav]").forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.nav));
    });

    // Open report buttons
    el.querySelectorAll(".status-open-btn").forEach(btn => {
      btn.addEventListener("click", e => {
        e.stopPropagation();
        openReport(btn.dataset.rpt, btn.dataset.done === "true");
      });
    });
    el.querySelectorAll(".status-queue-btn").forEach(btn => {
      btn.addEventListener("click", e => { e.stopPropagation(); switchTab("incidents"); });
    });

    // Clickable rows
    el.querySelectorAll(".status-row-linked").forEach(row => {
      row.addEventListener("click", e => {
        if (e.target.closest("button")) return;
        const rpt = row.dataset.rpt;
        if (rpt) openReport(rpt);
      });
    });

    // NSG delete buttons
    el.querySelectorAll(".nsg-del-btn").forEach(btn => {
      btn.addEventListener("click", async () => {
        if (!confirm(`Delete firewall rule "${btn.dataset.rule}"?`)) return;
        btn.disabled = true; btn.textContent = "…";
        try {
          await apiFetch(`/nsg/${encodeURIComponent(btn.dataset.nsg)}/rules/${encodeURIComponent(btn.dataset.rule)}`, { method:"DELETE" });
          btn.closest("tr").style.opacity = "0.3";
          setTimeout(() => loadTenantStatus(), 800);
        } catch(e) { btn.disabled = false; btn.textContent = "Remove rule"; showToast(e.message, true); }
      });
    });
  } catch(e) { el.innerHTML = `<div class="status-error">Failed: ${escHtml(e.message)}</div>`; }
}

// ── Demo Mode ──────────────────────────────────────────────────────────────────

const DEMO_POINTS = [
  // ── Sidebar nav ──────────────────────────────────────────────────────────────
  {
    id: "incidents-nav",
    getEl: () => document.getElementById("nav-incidents"),
    hint: "Live incident queue",
    agent: "Intake Agent",
    title: "Live Sentinel Incident Queue",
    body: "Incidents in the queue come from the 5-agent pipeline. In live mode, the Intake Agent reads from Microsoft Sentinel, extracts entities (IPs, hosts, users), and classifies severity. In demo mode, inject a scenario from the Attack Lab to watch the pipeline fire end-to-end.",
    note: null,
  },
  {
    id: "lab",
    getEl: () => document.getElementById("nav-lab"),
    condition: () => _activeTab !== "lab",
    hint: "Inject a live attack",
    agent: "Attack Lab",
    title: "Attack Lab — Inject a Real Attack Scenario",
    body: "The queue is empty — inject a pre-built attack scenario to fire the pipeline. Choose any of the six scenarios: credential stuffing, ransomware precursor, MFA bypass, lateral movement, insider threat, or AI prompt injection. Click Inject → and watch the AI respond.",
    note: null,
  },
  {
    id: "incidents",
    getEl: () => document.querySelector("#incidents-list .card-primary-btn"),
    hint: "Click to triage",
    agent: "Orchestrator",
    title: "Fire the 5-Agent Pipeline",
    body: "Triage runs the full Semantic Kernel reasoning chain: Intake → Enrichment → Investigation → Response → ECHO. Each agent consumes the typed Pydantic output of the previous. ECHO synthesizes a new KQL detection rule from the confirmed attack.",
    note: null,
  },
  // ── Inside report — Intelligence tab ─────────────────────────────────────────
  {
    id: "intel-tab",
    getEl: () => [...document.querySelectorAll(".rpt-tab-btn")].find(b => b.textContent.includes("Intelligence")),
    hint: null,
    pad: 2,
    agent: "Investigation Agent",
    title: "Intelligence — MITRE ATT&CK via Foundry IQ",
    body: "Click the Intelligence tab to see how the Investigation Agent maps every tactic and technique against MITRE ATT&CK using Foundry IQ — Azure AI Search grounded lookups, not model memory. Zero hallucination: if a technique isn't in the index, it doesn't appear.",
    note: "47 techniques indexed across Reconnaissance, Execution, Persistence, Lateral Movement, and more",
  },
  {
    id: "foundry-iq",
    getEl: () => document.getElementById("rpt-iq-card"),
    hint: "Grounded MITRE lookup",
    agent: "Investigation Agent",
    title: "Foundry IQ — Real-Time Technique Retrieval",
    body: "Each entry here was retrieved live from the Foundry IQ index during triage — not generated from model memory. Grounding via Azure AI Search means every hit has a source document behind it. This is what zero hallucination looks like in practice.",
    note: "47 MITRE ATT&CK techniques indexed across Reconnaissance, Execution, Persistence, Lateral Movement, and more",
  },
  // ── Inside report — Response & Actions tab ────────────────────────────────────
  {
    id: "response-tab",
    getEl: () => document.getElementById("rpt-response-tab-btn"),
    hint: null,
    pad: 2,
    agent: "Response Agent",
    title: "Response & Actions — Review Before Executing",
    body: "Click Response & Actions to see the ECHO detection rule and containment actions proposed by the Response Agent. Nothing executes until you explicitly approve — the AI reasons, the analyst decides.",
    note: null,
  },
  {
    id: "echo",
    getEl: () => document.getElementById("echo-card"),
    hint: "Auto-generated KQL rule",
    agent: "ECHO Agent",
    title: "ECHO — Synthesized Detection Rule",
    body: "For every confirmed TruePositive, ECHO synthesizes a KQL detection rule tailored to this specific attack pattern. In live mode it pushes to Sentinel automatically — the next occurrence triggers an alert before any analyst investigates.",
    note: "ECHO closes the loop: investigation → detection rule → prevention, fully automated",
  },
  {
    id: "approval",
    getEl: () => document.getElementById("approval-card"),
    hint: "Approve or reject",
    agent: "Response Agent",
    title: "Submit Your Decision",
    body: "Approve or reject each containment action individually, then click Submit. In a live environment: BlockIP creates an Azure NSG deny rule, DisableAccount calls Microsoft Graph, RevokeUserSessions terminates all active tokens immediately.",
    note: "Try Approve All → Submit to complete the demo flow",
  },
  // ── Post-submission: History tab ─────────────────────────────────────────────
  {
    id: "history",
    getEl: () => document.getElementById("nav-history"),
    condition: () => _demoVisited.has("approval"),
    hint: null,
    pad: 5,
    agent: "History",
    title: "History — Full Investigation Archive",
    body: "Every completed investigation lands here — AI analysis, your approval decision, and execution timestamps all in one place. Click View on any incident to reopen the full report, compare outcomes across scenarios, or reopen for re-review. In a live environment this feeds your compliance audit trail.",
    note: "Try clicking View on the incident you just closed",
  },
];

let _demoActive      = false;
let _demoRings       = [];
let _demoVisited     = new Set();
let _demoTipEl       = null;
let _demoRafId       = null;
let _demoTipPoint    = null;
let _demoTipAnchorEl = null;
let _demoPendingFn   = null;

function startDemo() {
  _demoActive = true;
  _demoVisited.clear();
  _triagedReports.clear();
  apiFetch("/demo/reset", { method: "POST" }).catch(() => {});
  switchTab("incidents");
  document.getElementById("demo-toggle-btn").classList.add("demo-active");
  _renderDemoRings();
  _demoRafId = requestAnimationFrame(_demoRafLoop);
}

function stopDemo() {
  _demoActive = false;
  document.getElementById("demo-toggle-btn").classList.remove("demo-active");
  _clearDemoRings();
  hideDemoTip();
  if (_demoRafId) { cancelAnimationFrame(_demoRafId); _demoRafId = null; }
}

function _demoRafLoop() {
  if (!_demoActive) return;
  _updateDemoRingPositions();
  _demoRafId = requestAnimationFrame(_demoRafLoop);
}

function _renderDemoRings() {
  _clearDemoRings();
  // Show only the first unvisited point to avoid rings stacking on adjacent sidebar buttons
  const nextPoints = DEMO_POINTS.filter(p => !_demoVisited.has(p.id));
  for (const point of nextPoints) {
    const el = point.getEl();
    if (!el || !_isElVisible(el)) continue;
    if (point.condition && !point.condition()) continue;

    const ring = document.createElement("div");
    ring.className = "demo-ring";
    document.body.appendChild(ring);

    let label = null;
    if (point.hint) {
      label = document.createElement("div");
      label.className = "demo-hint-label";
      label.textContent = point.hint;
      document.body.appendChild(label);
    }

    _positionDemoRing(ring, label, el, point.pad ?? 5);

    // "incidents" point (triage button): intercept in capture phase before openReport fires
    if (point.id === "incidents") {
      el.addEventListener("click", function _demoCaptureClick(e) {
        e.stopImmediatePropagation();
        _demoPendingFn = () => { el.click(); };
        _onDemoPointClick(point, el);
        el.removeEventListener("click", _demoCaptureClick, true);
      }, true);
    } else {
      el.addEventListener("click", function _demoClick() {
        _onDemoPointClick(point, el);
        el.removeEventListener("click", _demoClick);
      });
    }

    _demoRings.push({ ring, label, point });
    break; // one ring at a time — no overlap
  }
}

function _clearDemoRings() {
  for (const { ring, label } of _demoRings) {
    ring.remove();
    if (label) label.remove();
  }
  _demoRings = [];
}

function _updateDemoRingPositions() {
  for (const { ring, label, point } of _demoRings) {
    const el = point.getEl();
    if (el && _isElVisible(el)) {
      ring.style.display = "";
      if (label) label.style.display = "";
      _positionDemoRing(ring, label, el, point.pad ?? 5);
    } else {
      ring.style.display = "none";
      if (label) label.style.display = "none";
    }
  }
}

function _positionDemoRing(ring, label, el, pad = 5) {
  const r = el.getBoundingClientRect();
  ring.style.cssText = `left:${r.left-pad}px;top:${r.top-pad}px;width:${r.width+pad*2}px;height:${r.height+pad*2}px;`;
  if (label) {
    label.style.left = (r.left + r.width / 2) + "px";
    label.style.top  = (r.bottom + 7) + "px";
  }
}

function _isElVisible(el) {
  const r = el.getBoundingClientRect();
  if (r.width <= 0 || r.height <= 0 || r.top >= window.innerHeight || r.bottom <= 0) return false;
  let p = el.parentElement;
  while (p && p !== document.body) {
    const ov = getComputedStyle(p).overflowY;
    if (ov === "auto" || ov === "scroll") {
      const pr = p.getBoundingClientRect();
      const midY = (r.top + r.bottom) / 2;
      if (midY < pr.top || midY > pr.bottom) return false;
      break;
    }
    p = p.parentElement;
  }
  return true;
}

function _onDemoPointClick(point, el) {
  _demoVisited.add(point.id);
  const idx = _demoRings.findIndex(r => r.point.id === point.id);
  if (idx >= 0) { _demoRings[idx].ring.remove(); _demoRings[idx].label?.remove(); _demoRings.splice(idx, 1); }
  showDemoTip(point, el);
  _refreshDemoRings(); // queue next ring while tip is visible
}

function _renderDemoTip() {
  if (!_demoTipEl || !_demoTipPoint) return;
  const p = _demoTipPoint;
  _demoTipEl.innerHTML = `
    <div class="demo-tip-hdr">
      <div class="demo-tip-dot"></div>
      <div class="demo-tip-title">${escHtml(p.title)}</div>
      <button class="demo-tip-close" onclick="hideDemoTip()">×</button>
    </div>
    ${p.agent ? `<div class="demo-tip-agent">${escHtml(p.agent)}</div>` : ""}
    <div class="demo-tip-body">
      <div class="demo-tip-text">${escHtml(p.body)}</div>
      ${p.note ? `<div class="demo-tip-note">${escHtml(p.note)}</div>` : ""}
    </div>
    ${_demoPendingFn ? `<button class="demo-tip-cta" onclick="_fireDemoPipeline()">Start Pipeline →</button>` : ""}`;
  if (_demoTipAnchorEl) _positionTip(_demoTipEl, _demoTipAnchorEl);
}

function _positionTip(tip, el) {
  const tw = 360, th = tip.offsetHeight || 200;
  const r  = el.getBoundingClientRect();
  let left = r.right + 14, top = r.top + r.height / 2 - th / 2;
  if (left + tw > window.innerWidth - 16) left = r.left - tw - 14;
  top  = Math.max(10, Math.min(top, window.innerHeight - th - 10));
  left = Math.max(10, left);
  tip.style.left = left + "px";
  tip.style.top  = top  + "px";
}

function showDemoTip(point, el) {
  const savedPending = _demoPendingFn;  // preserve pending set by caller before hideDemoTip clears it
  hideDemoTip();
  _demoPendingFn   = savedPending;
  _demoTipPoint    = point;
  _demoTipAnchorEl = el;
  const overlay = document.createElement("div");
  overlay.className = "demo-overlay";
  overlay.id = "demo-tip-overlay";
  if (!_demoPendingFn) overlay.addEventListener("click", hideDemoTip);
  document.body.appendChild(overlay);
  const tip = document.createElement("div");
  tip.className = "demo-tip";
  _demoTipEl = tip;
  document.body.appendChild(tip);
  _renderDemoTip();
}

function hideDemoTip() {
  if (_demoTipEl) { _demoTipEl.remove(); _demoTipEl = null; }
  document.getElementById("demo-tip-overlay")?.remove();
  _demoTipPoint = null; _demoTipAnchorEl = null;
  _demoPendingFn = null;
}

function _fireDemoPipeline() {
  const fn = _demoPendingFn;
  _demoPendingFn = null;
  if (_demoTipEl) { _demoTipEl.remove(); _demoTipEl = null; }
  document.getElementById("demo-tip-overlay")?.remove();
  _demoTipPoint = null; _demoTipAnchorEl = null;
  if (fn) setTimeout(fn, 600);
}

let _refreshDemoTimer = null;
function _refreshDemoRings() {
  if (!_demoActive) return;
  clearTimeout(_refreshDemoTimer);
  _refreshDemoTimer = setTimeout(_renderDemoRings, 80);
}

function demoOnPipelineStart() {}
function demoOnPhase()         {}
function demoOnIQResult()      {}

// ── AI Analyst Panel ───────────────────────────────────────────────────────────

let _analystOpen = false;

function toggleAnalyst() {
  _analystOpen ? closeAnalyst() : openAnalyst();
}

function openAnalyst() {
  _analystOpen = true;
  document.getElementById("analyst-panel").classList.add("analyst-panel-open");
  document.getElementById("analyst-backdrop").classList.add("analyst-backdrop-visible");
  document.getElementById("analyst-launch-btn").classList.add("analyst-active");
  document.getElementById("analyst-input")?.focus();
}

function closeAnalyst() {
  _analystOpen = false;
  document.getElementById("analyst-panel").classList.remove("analyst-panel-open");
  document.getElementById("analyst-backdrop").classList.remove("analyst-backdrop-visible");
  document.getElementById("analyst-launch-btn").classList.remove("analyst-active");
}

function _analystAddMsg(role, body, sources = []) {
  const hist = document.getElementById("analyst-chat-history");
  if (!hist) return;

  const div = document.createElement("div");
  div.className = `analyst-msg analyst-msg-${role}`;

  const bodyDiv = document.createElement("div");
  bodyDiv.className = "analyst-msg-body";
  // simple markdown: bold, code, newlines
  bodyDiv.innerHTML = escHtml(body)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\n/g, "<br>");
  div.appendChild(bodyDiv);

  if (sources && sources.length) {
    const srcDiv = document.createElement("div");
    srcDiv.className = "analyst-msg-sources";
    srcDiv.innerHTML = `<span class="analyst-src-label">Foundry IQ sources:</span> ` +
      sources.map(s => `<span class="analyst-src-item">${escHtml(s.technique_id)} ${escHtml(s.name)}</span>`).join(" ");
    div.appendChild(srcDiv);
  }

  hist.appendChild(div);
  hist.scrollTop = hist.scrollHeight;
}

function _analystAddTyping() {
  const hist = document.getElementById("analyst-chat-history");
  if (!hist) return null;
  const div = document.createElement("div");
  div.className = "analyst-msg analyst-msg-ai analyst-typing";
  div.innerHTML = `<div class="analyst-msg-body"><span class="analyst-dots"><span></span><span></span><span></span></span></div>`;
  hist.appendChild(div);
  hist.scrollTop = hist.scrollHeight;
  return div;
}

async function sendAnalystMessage(msg) {
  if (!msg.trim()) return;
  document.getElementById("analyst-input").value = "";
  _analystAddMsg("user", msg);
  const typing = _analystAddTyping();

  const incCtx = _currentReport ? {
    incident_number: _currentReport.incident_number,
    title: _currentReport.title,
    classification: _currentReport.classification,
    summary: _currentReport.summary,
    ioc_list: _currentReport.ioc_list || [],
  } : {};

  try {
    const data = await apiFetch("/analyst/chat", {
      method: "POST",
      body: JSON.stringify({ message: msg, incident_context: incCtx }),
    });
    typing?.remove();
    _analystAddMsg("ai", data.response || "No response.", data.sources);
  } catch(e) {
    typing?.remove();
    _analystAddMsg("ai", `Error: ${e.message}`);
  }
}

// ── Threat Hunting ─────────────────────────────────────────────────────────────

let _iocFilter = "all";
let _allIocs   = [];

function _iocType(val) {
  if (/^\d{1,3}(\.\d{1,3}){3}(\/\d+)?$/.test(val)) return "ip";
  if (/^[0-9a-f]{32,64}$/i.test(val)) return "hash";
  if (/\.[a-z]{2,}/.test(val) && !val.includes(" ")) return "domain";
  return "other";
}

async function loadHunt() {
  const listEl  = document.getElementById("hunt-ioc-list");
  const badge   = document.getElementById("ioc-count-badge");
  if (!listEl) return;

  listEl.innerHTML = `<div class="hunt-loading">Loading IOCs from all reports…</div>`;

  try {
    _allIocs = await apiFetch("/iocs");
    if (badge) badge.textContent = _allIocs.length;
    _renderIocList();
  } catch(e) {
    listEl.innerHTML = `<div class="hunt-loading" style="color:var(--danger)">Failed: ${escHtml(e.message)}</div>`;
  }
}

function _renderIocList() {
  const listEl = document.getElementById("hunt-ioc-list");
  if (!listEl) return;
  const filtered = _iocFilter === "all" ? _allIocs : _allIocs.filter(i => _iocType(i.value) === _iocFilter);
  if (!filtered.length) {
    listEl.innerHTML = `<div class="hunt-loading">No IOCs of this type found.</div>`;
    return;
  }
  listEl.innerHTML = filtered.map(ioc => `
    <div class="hunt-ioc-row">
      <span class="hunt-ioc-type hunt-ioc-${_iocType(ioc.value)}">${_iocType(ioc.value).toUpperCase()}</span>
      <code class="hunt-ioc-val">${escHtml(ioc.value)}</code>
      <span class="hunt-ioc-src">
        <button class="hunt-ioc-link" data-rpt="${escHtml(ioc.report_id)}" data-cls="${escHtml(ioc.classification||"")}">
          #${ioc.incident_number} ${escHtml((ioc.title||"").slice(0,40))}
        </button>
      </span>
      <span class="hunt-ioc-cls ${clsBadgeClass(ioc.classification)}" style="font-size:9px;padding:1px 4px;border-radius:3px">${clsLabel(ioc.classification)}</span>
    </div>
  `).join("");
  listEl.querySelectorAll(".hunt-ioc-link").forEach(btn => {
    btn.addEventListener("click", () => openReport(btn.dataset.rpt));
  });
}

async function runHuntQuery(q) {
  const resultsEl = document.getElementById("hunt-iq-results");
  const emptyEl   = document.getElementById("hunt-iq-empty");
  const loadEl    = document.getElementById("hunt-iq-loading");
  if (!resultsEl) return;

  resultsEl.style.display = "none";
  emptyEl.style.display = "none";
  loadEl.style.display = "";

  try {
    const data = await apiFetch("/hunt/query", {
      method: "POST",
      body: JSON.stringify({ query: q }),
    });
    loadEl.style.display = "none";

    const results = data.results || [];
    if (!results.length) { emptyEl.style.display = ""; return; }

    resultsEl.style.display = "";
    resultsEl.innerHTML = `
      <div class="hunt-iq-source">
        <svg width="9" height="9" viewBox="0 0 16 16" fill="none"><circle cx="8" cy="8" r="7" stroke="#0ea5e9" stroke-width="1.5"/><path d="M5 8h6M8 5v6" stroke="#0ea5e9" stroke-width="1.5" stroke-linecap="round"/></svg>
        ${results.length} result${results.length !== 1 ? "s" : ""} from Foundry IQ (${data.source || "Azure AI Search"})
      </div>
      ${results.map(r => `
        <div class="hunt-iq-result">
          <div class="hunt-iq-result-hdr">
            <span class="hunt-iq-tid">${escHtml(r.technique_id)}</span>
            <span class="hunt-iq-tname">${escHtml(r.name)}</span>
            <span class="chip chip-neutral" style="font-size:10px">${escHtml(r.tactic||"")}</span>
            ${r.score ? `<span style="font-size:10px;color:var(--text-muted);margin-left:auto">${(r.score*100).toFixed(0)}% match</span>` : ""}
          </div>
          ${r.description ? `<div class="hunt-iq-desc-text">${escHtml(r.description.slice(0,200))}${r.description.length>200?"…":""}</div>` : ""}
          ${r.detection ? `<div class="hunt-iq-detect"><span class="hunt-iq-detect-lbl">Detection:</span> ${escHtml(r.detection.slice(0,160))}</div>` : ""}
          ${r.threat_actors ? `<div class="hunt-iq-actors"><span class="hunt-iq-detect-lbl">Known actors:</span> ${escHtml(r.threat_actors)}</div>` : ""}
        </div>
      `).join("")}
    `;
  } catch(e) {
    loadEl.style.display = "none";
    emptyEl.style.display = "";
    emptyEl.textContent = `Query failed: ${e.message}`;
  }
}

function switchRptTab(tab, btn) {
  document.querySelectorAll(".rpt-tab-btn").forEach(b => b.classList.remove("rpt-tab-active"));
  btn.classList.add("rpt-tab-active");
  document.querySelectorAll(".rpt-tab-pane").forEach(p => p.style.display = "none");
  document.getElementById("rpt-tab-" + tab).style.display = "";
  _refreshDemoRings();
}

function togglePicerlDropdown() {
  const d = document.getElementById("picerl-dropdown");
  const btn = document.getElementById("picerl-pill-btn");
  const open = d.classList.toggle("picerl-open");
  btn.textContent = open ? "✓ IR Lifecycle ▴" : "✓ IR Lifecycle ▾";
}

// ── Sidebar / layout ───────────────────────────────────────────────────────────

function toggleSidebar() {
  const shell = document.getElementById("app-shell");
  const collapsed = shell.classList.toggle("sidebar-collapsed");
  localStorage.setItem("ts_sidebar_collapsed", collapsed ? "1" : "0");
}

// ── Triage animation ───────────────────────────────────────────────────────────

const TRIAGE_PHASES = [
  { name:"Intake",        label:"Fetching incident data, entities, and raw evidence from Microsoft Sentinel" },
  { name:"Enrichment",    label:"Querying VirusTotal, GreyNoise, and AbuseIPDB for IP reputation and threat context" },
  { name:"Investigation", label:"Grounding MITRE ATT&CK techniques in Foundry IQ — Azure AI Search over 47 indexed techniques" },
  { name:"Response",      label:"Writing full incident report, classifying severity, proposing targeted containment actions" },
  { name:"ECHO",          label:"Synthesizing a new KQL detection rule from confirmed attack pattern to close the coverage gap" },
];

async function startTriageAnimation(reportId) {
  _triagedReports.add(reportId);
  const overlay  = document.getElementById("triage-overlay");
  const phasesEl = document.getElementById("triage-phases");
  if (!overlay || !phasesEl) { openReport(reportId); return; }

  phasesEl.innerHTML = TRIAGE_PHASES.map((p, i) => `
    <div class="triage-phase tp-pending" id="tp-phase-${i}">
      <span class="tp-dot"></span>
      <span class="tp-name">${p.name}</span>
      <span class="tp-label">${p.label}</span>
    </div>
  `).join("");

  overlay.style.display = "";

  for (let i = 0; i < TRIAGE_PHASES.length; i++) {
    const row = document.getElementById(`tp-phase-${i}`);
    if (row) row.className = "triage-phase tp-active";
    await new Promise(r => setTimeout(r, 1600));
    if (row) row.className = "triage-phase tp-done";
    await new Promise(r => setTimeout(r, 100));
  }

  const titleEl = overlay.querySelector(".triage-title");
  if (titleEl) titleEl.textContent = "Analysis complete";

  // Always show "View Report →" so the user controls when to proceed
  const box = overlay.querySelector(".triage-box");
  if (box) {
    const btn = document.createElement("button");
    btn.className = "triage-view-btn";
    btn.textContent = "View Report →";
    btn.onclick = () => {
      btn.remove();
      overlay.style.display = "none";
      openReport(reportId);
    };
    box.appendChild(btn);
  } else {
    // Fallback: auto-advance if overlay structure is missing
    await new Promise(r => setTimeout(r, 1400));
    overlay.style.display = "none";
    openReport(reportId);
  }
}

// ── Init ───────────────────────────────────────────────────────────────────────

document.addEventListener("DOMContentLoaded", () => {

  // Move analyst panel + backdrop outside app-shell so position:fixed is
  // viewport-anchored, not clipped by the grid container's overflow:hidden
  document.body.appendChild(document.getElementById("analyst-panel"));
  document.body.appendChild(document.getElementById("analyst-backdrop"));

  // Ensure incidents tab is visible and highlighted on load
  switchTab("incidents");

  // Restore sidebar
  if (localStorage.getItem("ts_sidebar_collapsed") === "1")
    document.getElementById("app-shell").classList.add("sidebar-collapsed");

  // Token banner
  if (!TOKEN) showTokenBanner();
  document.getElementById("token-banner-btn")?.addEventListener("click", promptToken);

  // Sidebar toggle
  document.getElementById("sidebar-toggle-btn").addEventListener("click", toggleSidebar);

  // Nav items
  document.querySelectorAll(".nav-item[data-tab]").forEach(btn => {
    btn.addEventListener("click", () => switchTab(btn.dataset.tab));
  });

  // Drawer back (legacy) + new report page back
  document.getElementById("drawer-back-btn")?.addEventListener("click", closeDrawer);
  document.getElementById("rpt-back-btn")?.addEventListener("click", closeDrawer);

  // Severity chips
  document.getElementById("severity-filters")?.addEventListener("click", e => {
    const chip = e.target.closest(".sev-chip");
    if (!chip) return;
    document.querySelectorAll(".sev-chip").forEach(c => c.classList.remove("active"));
    chip.classList.add("active");
    _activeSevFilter = chip.dataset.sev;
    refresh();
  });

  // Action approve/reject delegation
  document.getElementById("action-list").addEventListener("click", e => {
    const btn = e.target.closest(".action-btn");
    if (!btn) return;
    const item = document.querySelector(`.action-item[data-id="${btn.dataset.action}"]`);
    if (!item) return;
    item.dataset.approved = btn.dataset.approved;
    item.querySelectorAll(".action-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    item.className = `action-item ${btn.dataset.approved === "true" ? "approved" : "rejected"}`;
  });

  // Approval buttons
  document.getElementById("approve-all-btn").addEventListener("click", () => {
    document.querySelectorAll(".action-item").forEach(item => {
      item.dataset.approved = "true";
      item.className = "action-item approved";
      item.querySelectorAll(".action-btn").forEach(b => b.classList.toggle("active", b.dataset.approved === "true"));
    });
  });
  document.getElementById("reject-all-btn").addEventListener("click", () => {
    document.querySelectorAll(".action-item").forEach(item => {
      item.dataset.approved = "false";
      item.className = "action-item rejected";
      item.querySelectorAll(".action-btn").forEach(b => b.classList.toggle("active", b.dataset.approved === "false"));
    });
  });
  document.getElementById("submit-btn").addEventListener("click",      () => submitDecision(false, false));

  // Lab triggers
  document.querySelectorAll(".lab-trigger-btn").forEach(btn => {
    btn.addEventListener("click", () => triggerScenario(btn.dataset.scenario, btn));
  });

  // Demo mode toggle
  document.getElementById("demo-toggle-btn").addEventListener("click", () => {
    if (_demoActive) stopDemo(); else startDemo();
  });

  // AI Analyst panel
  document.getElementById("analyst-launch-btn")?.addEventListener("click", toggleAnalyst);
  document.getElementById("analyst-send-btn")?.addEventListener("click", () => {
    const q = document.getElementById("analyst-input")?.value.trim();
    if (q) sendAnalystMessage(q);
  });
  document.getElementById("analyst-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const q = e.target.value.trim();
      if (q) sendAnalystMessage(q);
    }
  });
  const _CANNED = {
    "What attack techniques are most common in credential stuffing attacks?":
      `**Credential Stuffing — MITRE ATT&CK Mapping (Foundry IQ)**\n\n**T1110.004 — Brute Force: Credential Stuffing** (Credential Access)\nAdversaries use large lists of known username/password pairs from prior breaches. Tor exit nodes and residential proxies are used to evade IP-based rate limiting. A single successful login from 847 failed attempts is the pattern seen in this incident.\n\n**T1528 — Steal Application Access Token** (Credential Access)\nImmediately post-authentication, attackers acquire OAuth tokens to maintain access without needing credentials again. Graph API calls for MailFolders.Read followed.\n\n**T1550.001 — Use Alternate Authentication Material: Application Access Token** (Defense Evasion / Lateral Movement)\nThe stolen OAuth token was then used to bypass re-authentication and access Microsoft Graph resources.\n\n**Recommended mitigations:** MFA enforcement (M1032), account lockout policy (M1036), Conditional Access policies scoped to compliant devices.`,

    "Suggest KQL queries for detecting lateral movement via WMI in Sentinel":
      `**KQL — WMI Lateral Movement Detection**\n\nDetect remote WMI process creation across workstations:\n\`\`\`kql\nSecurityEvent\n| where EventID == 4688\n| where ParentProcessName has "WmiPrvSE.exe"\n| where Computer !has "SERVER"\n| summarize count() by Computer, Account, CommandLine\n| where count_ > 2\n\`\`\`\n\nDetect encoded PowerShell launched via WMI (T1059.001):\n\`\`\`kql\nDeviceProcessEvents\n| where InitiatingProcessFileName =~ "WmiPrvSE.exe"\n| where ProcessCommandLine has_any ("-EncodedCommand", "-enc", "FromBase64String")\n| project Timestamp, DeviceName, AccountName, ProcessCommandLine\n\`\`\`\n\nBoth queries fire on the pattern observed in incident #1042: DESKTOP-JD-001 → WORKSTATION-B → WORKSTATION-C via encoded PowerShell over WMI.`,

    "What are the current IOCs and which incidents are they from?":
      (() => {
        const iocs = (_currentReport?.ioc_list || ["185.220.101.45","91.108.4.200","john.doe@contoso.com","DESKTOP-JD-001","WORKSTATION-B","WORKSTATION-C"]);
        const inc = _currentReport ? `Incident #${_currentReport.incident_number} — ${_currentReport.title}` : "Incident #1042 — Credential Stuffing Attack";
        return `**Current IOCs — ${inc}**\n\n${iocs.map(i => `• \`${i}\``).join("\n")}\n\n**185.220.101.45** — Known Tor exit node. 847 failed login attempts. AbuseIPDB confidence: 97%.\n**91.108.4.200** — Secondary Tor/VPN exit node used post-authentication for token acquisition.\n**john.doe@contoso.com** — Compromised account. Successful auth without MFA, OAuth grant added.\n**DESKTOP-JD-001** — Source of WMI lateral movement commands.\n**WORKSTATION-B / WORKSTATION-C** — Unmanaged target workstations. Encoded PowerShell executed via WMI.`;
      })(),

    "Explain ECHO automatic detection rules and how they reduce detection gaps":
      `**ECHO — Automatic Detection Rule Synthesis**\n\nECHO is the fifth agent in the TopSec pipeline. After the Response agent confirms a TruePositive and produces containment actions, ECHO reads the confirmed attack pattern and synthesizes a new KQL detection rule tailored to that specific incident.\n\n**Why it matters:** The fact that an incident fired means existing Sentinel analytics rules didn't catch it early enough — or at all. ECHO closes that gap by generating a rule from the observed behaviour, not from a generic template.\n\n**Example output** (illustrative — live mode generates this from the actual confirmed attack):\n• Rule: \`TopSec-ECHO: Early Tor Credential Stuffing Detection\`\n• Logic: Alert when >50 failed logins from a known Tor exit node are followed by a successful authentication within 10 minutes, with no MFA claim in the token.\n• Estimated gap reduction: catches the attack ~62 minutes earlier than the existing rules.\n\nIn live mode, the rule is pushed directly to Sentinel for analyst review before deployment.`,
  };

  document.querySelectorAll(".analyst-quick-btn").forEach(btn => {
    btn.addEventListener("click", () => {
      openAnalyst();
      const canned = _CANNED[btn.dataset.q];
      if (canned) {
        _analystAddMsg("user", btn.textContent.trim());
        const typing = _analystAddTyping();
        setTimeout(() => { typing?.remove(); _analystAddMsg("ai", typeof canned === "function" ? canned() : canned); }, 800);
      } else {
        sendAnalystMessage(btn.dataset.q);
      }
    });
  });

  // Threat Hunting: IOC filters
  document.querySelector(".hunt-ioc-filters")?.addEventListener("click", e => {
    const btn = e.target.closest(".hunt-filter-btn");
    if (!btn) return;
    document.querySelectorAll(".hunt-filter-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    _iocFilter = btn.dataset.iocFilter;
    _renderIocList();
  });

  // Threat Hunting: Foundry IQ search
  document.getElementById("hunt-iq-btn")?.addEventListener("click", () => {
    const q = document.getElementById("hunt-iq-input")?.value.trim();
    if (q) runHuntQuery(q);
  });
  document.getElementById("hunt-iq-input")?.addEventListener("keydown", e => {
    if (e.key === "Enter") {
      const q = e.target.value.trim();
      if (q) runHuntQuery(q);
    }
  });
  document.querySelector(".hunt-iq-examples")?.addEventListener("click", e => {
    const btn = e.target.closest(".hunt-example-btn");
    if (!btn) return;
    const q = btn.dataset.q;
    const inp = document.getElementById("hunt-iq-input");
    if (inp) inp.value = q;
    runHuntQuery(q);
  });

  // KQL copy buttons
  document.querySelector("#tab-hunt")?.addEventListener("click", e => {
    const btn = e.target.closest(".kql-copy-btn");
    if (!btn) return;
    const card = btn.closest(".hunt-kql-card");
    const kql = card?.dataset.kql || "";
    navigator.clipboard.writeText(kql).then(() => {
      const orig = btn.textContent;
      btn.textContent = "Copied!";
      setTimeout(() => { btn.textContent = orig; }, 1500);
    }).catch(() => {});
  });

  // SSE + initial load
  connectSSE();
  refresh();
  setInterval(refresh, 15000);

  // Auto-start demo mode to guide first-time visitors
  setTimeout(startDemo, 600);
});
