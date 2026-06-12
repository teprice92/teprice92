/* ════════════════════════════════════════════════════════════════
   Strata · Visual GitLab CI/CD Pipeline Builder
   Drag & drop pipeline builder with event simulation, includes
   visualization, variable awareness and rules building.
   ════════════════════════════════════════════════════════════════ */
"use strict";

/* ── Constants ─────────────────────────────────────────────────── */

const STORAGE_KEY = "strata-state-v1";
const STORAGE_KEY_LEGACY = "rocketpipe-state-v1";

const TRIGGERS = {
  push: {
    icon: "☄️",
    title: "Commit pushed to main",
    desc: "A branch pipeline: CI_COMMIT_BRANCH is set, no tag, no merge request context.",
  },
  merge_request: {
    icon: "🛸",
    title: "Merge request opened / updated",
    desc: "A merge request pipeline: CI_PIPELINE_SOURCE is \"merge_request_event\", CI_COMMIT_BRANCH is NOT set.",
  },
  tag: {
    icon: "🪐",
    title: "Tag v1.0.0 pushed",
    desc: "A tag pipeline: CI_COMMIT_TAG is set, CI_COMMIT_BRANCH is NOT set.",
  },
};

/* Predefined GitLab variables with simulated values per trigger event.
   `undefined` means the variable is not set for that pipeline type. */
const PREDEFINED_VARS = [
  { key: "CI_PIPELINE_SOURCE", desc: "How the pipeline was triggered (push, merge_request_event, schedule…)",
    values: { push: "push", merge_request: "merge_request_event", tag: "push" } },
  { key: "CI_COMMIT_BRANCH", desc: "Branch name — set only for branch pipelines (not MRs, not tags)",
    values: { push: "main", merge_request: undefined, tag: undefined } },
  { key: "CI_COMMIT_TAG", desc: "Tag name — set only for tag pipelines",
    values: { push: undefined, merge_request: undefined, tag: "v1.0.0" } },
  { key: "CI_DEFAULT_BRANCH", desc: "The project's default branch",
    values: { push: "main", merge_request: "main", tag: "main" } },
  { key: "CI_MERGE_REQUEST_IID", desc: "Merge request IID — set only in MR pipelines",
    values: { push: undefined, merge_request: "42", tag: undefined } },
  { key: "CI_MERGE_REQUEST_TARGET_BRANCH_NAME", desc: "MR target branch — set only in MR pipelines",
    values: { push: undefined, merge_request: "main", tag: undefined } },
  { key: "CI_MERGE_REQUEST_SOURCE_BRANCH_NAME", desc: "MR source branch — set only in MR pipelines",
    values: { push: undefined, merge_request: "feature/booster", tag: undefined } },
  { key: "CI_COMMIT_SHA", desc: "Full commit SHA",
    values: { push: "a1b2c3d4e5f60718", merge_request: "a1b2c3d4e5f60718", tag: "a1b2c3d4e5f60718" } },
  { key: "CI_COMMIT_SHORT_SHA", desc: "First 8 characters of the commit SHA",
    values: { push: "a1b2c3d4", merge_request: "a1b2c3d4", tag: "a1b2c3d4" } },
  { key: "CI_PROJECT_NAME", desc: "Project name",
    values: { push: "rocketpipe", merge_request: "rocketpipe", tag: "rocketpipe" } },
  { key: "CI_PROJECT_PATH", desc: "Namespace/project path",
    values: { push: "astro/rocketpipe", merge_request: "astro/rocketpipe", tag: "astro/rocketpipe" } },
  { key: "CI_REGISTRY_IMAGE", desc: "Container registry address for the project",
    values: { push: "registry.gitlab.com/astro/rocketpipe", merge_request: "registry.gitlab.com/astro/rocketpipe", tag: "registry.gitlab.com/astro/rocketpipe" } },
  { key: "GITLAB_USER_LOGIN", desc: "Username of the user who started the pipeline",
    values: { push: "astronaut", merge_request: "astronaut", tag: "astronaut" } },
];

/* Job templates for the drag & drop launch pad */
const PALETTE = [
  { id: "build",    icon: "🔧", name: "Build",            desc: "compile / bundle",
    job: { name: "build-rocket", image: "node:20-alpine", script: ["npm ci", "npm run build"], rules: [] } },
  { id: "test",     icon: "🧪", name: "Unit Tests",       desc: "run the test suite",
    job: { name: "unit-tests", image: "node:20-alpine", script: ["npm ci", "npm test"], rules: [] } },
  { id: "lint",     icon: "🧹", name: "Lint",             desc: "static analysis",
    job: { name: "lint", image: "node:20-alpine", script: ["npm ci", "npm run lint"], rules: [] } },
  { id: "security", icon: "🛡️", name: "Security Scan",    desc: "dependency audit",
    job: { name: "security-scan", image: "node:20-alpine", script: ["npm audit --audit-level=high"],
      rules: [{ if: '$CI_PIPELINE_SOURCE == "merge_request_event"', when: "on_success", allow_failure: true }] } },
  { id: "docker",   icon: "🐳", name: "Docker Build",     desc: "build & push image",
    job: { name: "docker-build", image: "docker:24", script: ["docker build -t $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA .", "docker push $CI_REGISTRY_IMAGE:$CI_COMMIT_SHORT_SHA"],
      rules: [{ if: "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH", when: "on_success" }, { if: "$CI_COMMIT_TAG", when: "on_success" }] } },
  { id: "staging",  icon: "🛰️", name: "Deploy Staging",   desc: "ship to orbit (staging)",
    job: { name: "deploy-staging", script: ["./deploy.sh staging"],
      rules: [{ if: "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH", when: "on_success" }] } },
  { id: "prod",     icon: "🚀", name: "Deploy Production", desc: "full launch (manual)",
    job: { name: "deploy-production", script: ["./deploy.sh production"],
      rules: [{ if: "$CI_COMMIT_TAG", when: "manual" }] } },
  { id: "custom",   icon: "⚙️", name: "Custom Job",       desc: "blank module",
    job: { name: "custom-job", script: ["echo 'hello space'"], rules: [] } },
];

const INCLUDE_COLORS = ["#38c8f0", "#f0a838", "#e85ce0", "#6ee7a0", "#ff8a65", "#a78bfa"];

const RESERVED_KEYS = new Set([
  "stages", "variables", "include", "default", "workflow", "image",
  "services", "before_script", "after_script", "cache", "types",
]);

/* ── State ─────────────────────────────────────────────────────── */

let state = null;
let editingJobId = null;     // job id open in the modal, or null = creating
let pendingNewJob = null;    // template snapshot while creating
let draftRules = [];         // rules being edited in the modal
let lastFocusedRuleInput = null;

const uid = () => Math.random().toString(36).slice(2, 10);

function demoState() {
  return {
    trigger: "push",
    stages: ["build", "test", "deploy"],
    jobs: [
      { id: uid(), name: "build-rocket", stage: "build", image: "node:20-alpine",
        script: ["npm ci", "npm run build"], rules: [], needs: [], source: "local" },
      { id: uid(), name: "unit-tests", stage: "test", image: "node:20-alpine",
        script: ["npm ci", "npm test"], rules: [], needs: [], source: "local" },
      { id: uid(), name: "security-scan", stage: "test", image: "node:20-alpine",
        script: ["npm audit --audit-level=high"],
        rules: [{ if: '$CI_PIPELINE_SOURCE == "merge_request_event"', when: "on_success", allow_failure: true }],
        needs: [], source: "local" },
      { id: uid(), name: "deploy-staging", stage: "deploy", image: "",
        script: ["./deploy.sh staging"],
        rules: [{ if: "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH", when: "on_success" }],
        needs: [], source: "local" },
      { id: uid(), name: "deploy-production", stage: "deploy", image: "",
        script: ["./deploy.sh production"],
        rules: [{ if: "$CI_COMMIT_TAG", when: "manual" }],
        needs: [], source: "local" },
    ],
    includes: [],
    variables: [{ key: "ROCKET_FUEL", value: "hydrogen", desc: "" }],
  };
}

function saveState() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { /* private mode etc. */ }
}

function loadState() {
  try {
    // Try the current key first, then migrate from old RocketPipe key
    const raw = localStorage.getItem(STORAGE_KEY) || localStorage.getItem(STORAGE_KEY_LEGACY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && Array.isArray(s.stages) && Array.isArray(s.jobs)) {
        // Remove legacy key if present
        localStorage.removeItem(STORAGE_KEY_LEGACY);
        return s;
      }
    }
  } catch (e) { /* fall through */ }
  return demoState();
}

/* ── Rules expression engine ───────────────────────────────────────
   Evaluates GitLab CI `rules:if` expressions against simulated
   variables. Supports: $VAR, "str", 'str', null, /regex/flags,
   ==, !=, =~, !~, &&, ||, parentheses, bare-$VAR truthiness.     */

function tokenizeExpr(src) {
  const tokens = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "$") {
      let j = i + 1;
      if (src[j] === "{") { // ${VAR}
        let k = src.indexOf("}", j);
        if (k === -1) throw new Error("Unclosed ${");
        tokens.push({ t: "var", v: src.slice(j + 1, k) }); i = k + 1; continue;
      }
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j])) j++;
      if (j === i + 1) throw new Error("Bare $ in expression");
      tokens.push({ t: "var", v: src.slice(i + 1, j) }); i = j; continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1, out = "";
      while (j < src.length && src[j] !== c) { out += src[j]; j++; }
      if (j >= src.length) throw new Error("Unclosed string");
      tokens.push({ t: "str", v: out }); i = j + 1; continue;
    }
    if (c === "/") {
      let j = i + 1, out = "";
      while (j < src.length && src[j] !== "/") {
        if (src[j] === "\\") { out += src[j] + (src[j + 1] || ""); j += 2; continue; }
        out += src[j]; j++;
      }
      if (j >= src.length) throw new Error("Unclosed regex");
      let k = j + 1, flags = "";
      while (k < src.length && /[a-z]/i.test(src[k])) { flags += src[k]; k++; }
      tokens.push({ t: "regex", v: out, flags }); i = k; continue;
    }
    if (src.startsWith("==", i)) { tokens.push({ t: "op", v: "==" }); i += 2; continue; }
    if (src.startsWith("!=", i)) { tokens.push({ t: "op", v: "!=" }); i += 2; continue; }
    if (src.startsWith("=~", i)) { tokens.push({ t: "op", v: "=~" }); i += 2; continue; }
    if (src.startsWith("!~", i)) { tokens.push({ t: "op", v: "!~" }); i += 2; continue; }
    if (src.startsWith("&&", i)) { tokens.push({ t: "and" }); i += 2; continue; }
    if (src.startsWith("||", i)) { tokens.push({ t: "or" }); i += 2; continue; }
    if (c === "(") { tokens.push({ t: "lp" }); i++; continue; }
    if (c === ")") { tokens.push({ t: "rp" }); i++; continue; }
    if (src.startsWith("null", i)) { tokens.push({ t: "null" }); i += 4; continue; }
    throw new Error(`Unexpected character "${c}"`);
  }
  return tokens;
}

function evalExpr(src, vars) {
  const tokens = tokenizeExpr(src);
  let pos = 0;
  const peek = () => tokens[pos];
  const next = () => tokens[pos++];

  function term() {
    const tk = next();
    if (!tk) throw new Error("Unexpected end of expression");
    if (tk.t === "var") return { kind: "var", value: vars[tk.v] };           // may be undefined
    if (tk.t === "str") return { kind: "str", value: tk.v };
    if (tk.t === "regex") return { kind: "regex", value: tk.v, flags: tk.flags };
    if (tk.t === "null") return { kind: "null", value: null };
    if (tk.t === "lp") { const v = orExpr(); if (!peek() || next().t !== "rp") throw new Error("Missing )"); return { kind: "bool", value: v }; }
    throw new Error("Unexpected token in expression");
  }

  function comparison() {
    const left = term();
    const tk = peek();
    if (tk && tk.t === "op") {
      next();
      const right = term();
      if (tk.v === "=~" || tk.v === "!~") {
        const re = right.kind === "regex"
          ? new RegExp(right.value, right.flags)
          : new RegExp(String(right.value ?? ""));
        const subject = left.value == null ? null : String(left.value);
        const match = subject != null && re.test(subject);
        return tk.v === "=~" ? match : !match;
      }
      const l = left.kind === "null" ? null : left.value ?? null;
      const r = right.kind === "null" ? null : right.value ?? null;
      return tk.v === "==" ? l === r : l !== r;
    }
    if (left.kind === "bool") return left.value;
    // Bare variable: truthy when defined and non-empty (GitLab semantics)
    return left.value != null && left.value !== "";
  }

  function andExpr() {
    let v = comparison();
    while (peek() && peek().t === "and") { next(); const r = comparison(); v = v && r; }
    return v;
  }

  function orExpr() {
    let v = andExpr();
    while (peek() && peek().t === "or") { next(); const r = andExpr(); v = v || r; }
    return v;
  }

  const result = orExpr();
  if (pos < tokens.length) throw new Error("Trailing tokens in expression");
  return result;
}

/* Variables in effect for the current simulated event */
function effectiveVars() {
  const vars = {};
  for (const inc of state.includes) {
    for (const v of inc.variables || []) vars[v.key] = v.value;
  }
  for (const v of state.variables) vars[v.key] = v.value;
  for (const p of PREDEFINED_VARS) {
    const val = p.values[state.trigger];
    if (val !== undefined) vars[p.key] = val; else delete vars[p.key];
  }
  return vars;
}

/* Decide what happens to a job for the current event */
function jobStatus(job, vars) {
  if (!job.rules || job.rules.length === 0) return { status: "run", why: "no rules — always runs" };
  for (const rule of job.rules) {
    let matched = true;
    if (rule.if && rule.if.trim()) {
      try { matched = evalExpr(rule.if, vars); }
      catch (e) { return { status: "skip", why: `rule error: ${e.message}`, error: true }; }
    }
    if (matched) {
      const when = rule.when || "on_success";
      if (when === "never") return { status: "skip", why: `matched: when never (${rule.if || "always"})` };
      if (when === "manual") return { status: "manual", why: `matched: ${rule.if || "always"}` };
      return { status: "run", why: `matched: ${rule.if || "always"}`, allowFailure: !!rule.allow_failure };
    }
  }
  return { status: "skip", why: "no rule matched this event" };
}

/* ── DOM helpers ───────────────────────────────────────────────── */

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (v !== undefined && v !== null) node.setAttribute(k, v);
  }
  for (const child of children) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(child));
  }
  return node;
}

let toastTimer = null;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg;
  t.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.add("hidden"), 2200);
}

function openModal(id) { $("#" + id).classList.remove("hidden"); }
function closeModal(id) { $("#" + id).classList.add("hidden"); }

/* ── Rendering ─────────────────────────────────────────────────── */

function render() {
  renderEventTabs();
  renderEventBanner();
  renderStages();
  renderMissionStatus();
  renderVariables();
  renderIncludes();
  saveState();
}

function renderEventTabs() {
  document.querySelectorAll(".event-tab").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.trigger === state.trigger);
  });
}

function renderEventBanner() {
  const t = TRIGGERS[state.trigger];
  $("#eventBanner").replaceChildren(
    el("span", { class: "eb-icon" }, t.icon),
    el("div", {},
      el("div", { class: "eb-title" }, `Simulating: ${t.title}`),
      el("div", { class: "eb-desc" }, t.desc),
    ),
  );
}

function includeById(id) { return state.includes.find((i) => i.id === id); }
function includeLabel(inc) {
  if (inc.type === "project") return inc.project || "project";
  if (inc.type === "remote") return inc.file;
  if (inc.type === "template") return inc.file;
  return inc.file; // local
}

function renderStages() {
  const wrap = $("#stagesWrap");
  wrap.replaceChildren();
  const vars = effectiveVars();

  state.stages.forEach((stage, idx) => {
    if (idx > 0) wrap.append(el("div", { class: "stage-connector" }, "➤"));

    const jobs = state.jobs.filter((j) => j.stage === stage);
    const body = el("div", { class: "stage-body", dataset: { stage } });

    if (jobs.length === 0) {
      body.append(el("div", { class: "stage-empty" }, "Drop a module here 🛰️"));
    }

    for (const job of jobs) {
      body.append(renderJobCard(job, vars));
    }

    const col = el("div", { class: "stage-col", dataset: { stage } },
      el("div", { class: "stage-head", draggable: "true", title: "Drag to reorder · double-click name to rename" },
        el("span", {}, "𝍢"),
        el("span", { class: "stage-name" }, stage),
        el("span", { class: "stage-count" }, String(jobs.length)),
        el("button", { class: "stage-del", title: "Delete stage", onclick: () => deleteStage(stage) }, "✕"),
      ),
      body,
    );

    // stage drag & drop (reorder + job drop target)
    const head = col.querySelector(".stage-head");
    head.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "stage", stage }));
      e.dataTransfer.effectAllowed = "move";
    });
    head.querySelector(".stage-name").addEventListener("dblclick", () => renameStage(stage));

    col.addEventListener("dragover", (e) => { e.preventDefault(); col.classList.add("drag-over"); });
    col.addEventListener("dragleave", () => col.classList.remove("drag-over"));
    col.addEventListener("drop", (e) => {
      e.preventDefault();
      col.classList.remove("drag-over");
      handleDrop(e, stage);
    });

    wrap.append(col);
  });
}

function renderJobCard(job, vars) {
  const st = jobStatus(job, vars);
  const inc = job.source !== "local" ? includeById(job.source) : null;

  const meta = el("div", { class: "j-meta" });
  meta.append(el("span", { class: `j-status ${st.status}`, title: st.why },
    st.status === "run" ? "🚀 launches" : st.status === "manual" ? "✋ manual" : "⛔ held back"));
  if (st.allowFailure) meta.append(el("span", { class: "j-rules-hint" }, "allow_failure"));
  if (job.rules && job.rules.length) {
    meta.append(el("span", { class: "j-rules-hint", title: job.rules.map((r) => r.if || "(always)").join("\n") },
      `${job.rules.length} rule${job.rules.length > 1 ? "s" : ""}`));
  }
  if (job.needs && job.needs.length) {
    meta.append(el("span", { class: "j-needs-hint" }, `needs: ${job.needs.join(", ")}`));
  }
  if (inc) {
    meta.append(el("span", { class: "j-import-badge", title: `Imported via include: ${includeLabel(inc)}` },
      `📡 ${includeLabel(inc)}`));
  }

  const card = el("div", {
    class: `job-card status-${st.status}${inc ? " imported" : ""}`,
    draggable: "true",
    dataset: { jobId: job.id },
    title: st.why,
  },
    el("div", { class: "j-name" }, job.name),
    meta,
  );
  if (inc) card.style.borderLeftColor = inc.color;

  card.addEventListener("dragstart", (e) => {
    e.stopPropagation();
    e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "job", id: job.id }));
    e.dataTransfer.effectAllowed = "move";
    card.classList.add("dragging");
  });
  card.addEventListener("dragend", () => card.classList.remove("dragging"));
  card.addEventListener("click", () => openJobModal(job.id));
  return card;
}

function renderMissionStatus() {
  const vars = effectiveVars();
  let run = 0, manual = 0, skip = 0;
  for (const job of state.jobs) {
    const s = jobStatus(job, vars).status;
    if (s === "run") run++; else if (s === "manual") manual++; else skip++;
  }
  $("#missionStatus").replaceChildren(
    el("span", { class: "ms-item" }, el("span", { class: "ms-dot run" }), `${run} job${run === 1 ? "" : "s"} launch automatically`),
    el("span", { class: "ms-item" }, el("span", { class: "ms-dot manual" }), `${manual} awaiting manual ignition`),
    el("span", { class: "ms-item" }, el("span", { class: "ms-dot skip" }), `${skip} held back on this event`),
  );
}

function renderVariables() {
  const pre = $("#predefinedVars");
  pre.replaceChildren();
  for (const p of PREDEFINED_VARS) {
    const val = p.values[state.trigger];
    pre.append(el("div", { class: "var-row", title: `${p.desc}\nClick to copy $${p.key}`, onclick: () => copyVar(p.key) },
      el("span", { class: "var-key" }, p.key),
      el("span", { class: `var-val${val === undefined ? " unset" : ""}` }, val === undefined ? "not set" : val),
    ));
  }

  const custom = $("#customVars");
  custom.replaceChildren();
  if (state.variables.length === 0) {
    custom.append(el("div", { class: "panel-hint" }, "No custom variables yet."));
  }
  for (const v of state.variables) {
    custom.append(el("div", { class: "var-row", title: `Click to copy $${v.key}`, onclick: () => copyVar(v.key) },
      el("span", { class: "var-key" }, v.key),
      el("span", { class: "var-val" }, v.value),
      el("button", { class: "var-del", title: "Remove variable", onclick: (e) => { e.stopPropagation(); removeVariable(v.key); } }, "✕"),
    ));
  }

  const importedWrap = $("#importedVars");
  importedWrap.replaceChildren();
  const importedRows = [];
  for (const inc of state.includes) {
    for (const v of inc.variables || []) importedRows.push({ ...v, inc });
  }
  if (importedRows.length) {
    importedWrap.append(el("h3", { class: "pane-title" }, "Imported Variables"));
    const list = el("div", { class: "var-list" });
    for (const v of importedRows) {
      const row = el("div", { class: "var-row", title: `From include: ${includeLabel(v.inc)}\nClick to copy $${v.key}`, onclick: () => copyVar(v.key) },
        el("span", { class: "var-key" }, v.key),
        el("span", { class: "var-val" }, v.value),
      );
      row.style.borderLeft = `2px solid ${v.inc.color}`;
      list.append(row);
    }
    importedWrap.append(list);
  }
}

function copyVar(key) {
  const text = "$" + key;
  // If a rule IF input was focused recently, insert there instead
  if (lastFocusedRuleInput && !$("#jobModal").classList.contains("hidden")) {
    insertAtCursor(lastFocusedRuleInput, text);
    toast(`Inserted ${text} into rule`);
    return;
  }
  navigator.clipboard?.writeText(text).then(
    () => toast(`Copied ${text} to clipboard`),
    () => toast(text),
  );
}

function insertAtCursor(input, text) {
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.focus();
  input.selectionStart = input.selectionEnd = start + text.length;
}

function renderIncludes() {
  const list = $("#includeList");
  list.replaceChildren();
  if (state.includes.length === 0) {
    list.append(el("div", { class: "include-empty" }, "No includes yet. Add one to see jobs from other repositories appear in your pipeline."));
    return;
  }
  for (const inc of state.includes) {
    const jobCount = state.jobs.filter((j) => j.source === inc.id).length;
    const varCount = (inc.variables || []).length;

    const statsChildren = [];
    if (inc.noContent) {
      statsChildren.push(el("span", { style: "color:var(--warn)" }, "⚠ Paste YAML content to visualize jobs"));
    } else {
      statsChildren.push(document.createTextNode(
        `${jobCount} job${jobCount === 1 ? "" : "s"}${varCount ? ` · ${varCount} variable${varCount === 1 ? "" : "s"}` : ""}${inc.hiddenJobs ? ` · ${inc.hiddenJobs} hidden template${inc.hiddenJobs === 1 ? "" : "s"}` : ""}`));
    }

    const actions = [el("button", { class: "btn btn-danger", onclick: () => removeInclude(inc.id) }, "Remove")];
    if (inc.noContent) {
      actions.unshift(el("button", { class: "btn btn-ghost", onclick: () => openPasteContentModal(inc.id) }, "📋 Paste content"));
    }

    const card = el("div", { class: "include-card" },
      el("div", { class: "inc-title" }, "📡 ", includeLabel(inc)),
      el("div", { class: "inc-meta" },
        inc.type === "project" ? `${inc.type} · ${inc.file} @ ${inc.ref || "HEAD"}` : `${inc.type} · ${inc.file}`),
      el("div", { class: "inc-stats" }, ...statsChildren),
      el("div", { class: "inc-actions" }, ...actions),
    );
    card.style.borderLeftColor = inc.noContent ? "var(--warn)" : inc.color;
    list.append(card);
  }
}

/* ── Drag & drop ───────────────────────────────────────────────── */

function renderPalette() {
  const list = $("#paletteList");
  list.replaceChildren();
  for (const item of PALETTE) {
    const node = el("div", { class: "palette-item", draggable: "true", title: "Drag onto a stage" },
      el("span", { class: "p-icon" }, item.icon),
      el("div", {},
        el("div", { class: "p-name" }, item.name),
        el("div", { class: "p-desc" }, item.desc),
      ),
    );
    node.addEventListener("dragstart", (e) => {
      e.dataTransfer.setData("text/plain", JSON.stringify({ kind: "palette", id: item.id }));
      e.dataTransfer.effectAllowed = "copy";
    });
    list.append(node);
  }
}

function handleDrop(e, stage) {
  let payload;
  try { payload = JSON.parse(e.dataTransfer.getData("text/plain")); }
  catch { return; }

  if (payload.kind === "palette") {
    const tpl = PALETTE.find((p) => p.id === payload.id);
    if (!tpl) return;
    pendingNewJob = { ...structuredClone(tpl.job), stage };
    openJobModal(null);
    return;
  }

  if (payload.kind === "job") {
    const job = state.jobs.find((j) => j.id === payload.id);
    if (!job) return;
    // reposition within target stage based on drop Y
    job.stage = stage;
    const cards = [...e.currentTarget.querySelectorAll(".job-card")].filter((c) => c.dataset.jobId !== job.id);
    let beforeJobId = null;
    for (const c of cards) {
      const rect = c.getBoundingClientRect();
      if (e.clientY < rect.top + rect.height / 2) { beforeJobId = c.dataset.jobId; break; }
    }
    const others = state.jobs.filter((j) => j.id !== job.id);
    let insertAt = others.length;
    if (beforeJobId) insertAt = others.findIndex((j) => j.id === beforeJobId);
    others.splice(insertAt, 0, job);
    state.jobs = others;
    render();
    return;
  }

  if (payload.kind === "stage") {
    const from = state.stages.indexOf(payload.stage);
    const to = state.stages.indexOf(stage);
    if (from === -1 || to === -1 || from === to) return;
    state.stages.splice(from, 1);
    state.stages.splice(to, 0, payload.stage);
    render();
  }
}

/* ── Stages CRUD ───────────────────────────────────────────────── */

function addStage() {
  const name = prompt("New stage name:", "");
  if (!name) return;
  const clean = name.trim().toLowerCase().replace(/\s+/g, "-");
  if (!clean) return;
  if (state.stages.includes(clean)) { toast(`Stage "${clean}" already exists`); return; }
  state.stages.push(clean);
  render();
}

function renameStage(stage) {
  const name = prompt(`Rename stage "${stage}" to:`, stage);
  if (!name) return;
  const clean = name.trim().toLowerCase().replace(/\s+/g, "-");
  if (!clean || clean === stage) return;
  if (state.stages.includes(clean)) { toast(`Stage "${clean}" already exists`); return; }
  state.stages[state.stages.indexOf(stage)] = clean;
  for (const job of state.jobs) if (job.stage === stage) job.stage = clean;
  render();
}

function deleteStage(stage) {
  const jobs = state.jobs.filter((j) => j.stage === stage);
  if (jobs.length && !confirm(`Stage "${stage}" contains ${jobs.length} job(s). Delete the stage and its jobs?`)) return;
  state.stages = state.stages.filter((s) => s !== stage);
  state.jobs = state.jobs.filter((j) => j.stage !== stage);
  render();
}

/* ── Job modal ─────────────────────────────────────────────────── */

function openJobModal(jobId) {
  editingJobId = jobId;
  const job = jobId ? state.jobs.find((j) => j.id === jobId) : pendingNewJob;
  if (!job) return;
  const imported = jobId && job.source !== "local";

  $("#jobModalTitle").textContent = jobId ? (imported ? "Imported Job" : "Edit Job") : "New Job";
  $("#jobName").value = job.name || "";
  $("#jobImage").value = job.image || "";
  $("#jobScript").value = (job.script || []).join("\n");

  const stageSel = $("#jobStage");
  stageSel.replaceChildren(...state.stages.map((s) => el("option", { value: s }, s)));
  stageSel.value = job.stage;

  draftRules = structuredClone(job.rules || []);
  renderRulesList(imported);

  // needs checkboxes — any other job
  const needsWrap = $("#jobNeeds");
  needsWrap.replaceChildren();
  const others = state.jobs.filter((j) => j.id !== jobId);
  if (!others.length) needsWrap.append(el("span", { class: "muted" }, "No other jobs yet."));
  for (const other of others) {
    const cb = el("input", { type: "checkbox", value: other.name });
    cb.checked = (job.needs || []).includes(other.name);
    needsWrap.append(el("label", {}, cb, other.name));
  }

  // imported = read-only
  const note = $("#jobImportedNote");
  if (imported) {
    const inc = includeById(job.source);
    note.textContent = `📡 This job is imported from "${includeLabel(inc)}". Edit it in the source repository — here it's read-only.`;
    note.classList.remove("hidden");
  } else {
    note.classList.add("hidden");
  }
  for (const input of document.querySelectorAll("#jobModal input, #jobModal select, #jobModal textarea, #jobModal .chip, #rbAdd, #btnAddRule")) {
    input.disabled = !!imported;
  }
  $("#btnSaveJob").disabled = !!imported;
  $("#btnDeleteJob").classList.toggle("hidden", !jobId || !!imported);

  populateRuleBuilderVars();
  openModal("jobModal");
}

function renderRulesList(readOnly = false) {
  const list = $("#rulesList");
  list.replaceChildren();
  if (!draftRules.length) {
    list.append(el("div", { class: "panel-hint" }, "No rules — this job runs on every pipeline."));
  }
  draftRules.forEach((rule, idx) => {
    const ifInput = el("input", {
      type: "text",
      placeholder: 'IF e.g. $CI_COMMIT_BRANCH == "main" (empty = always)',
      value: rule.if || "",
      oninput: (e) => { rule.if = e.target.value; },
      onfocus: (e) => { lastFocusedRuleInput = e.target; },
    });
    const whenSel = el("select", { onchange: (e) => { rule.when = e.target.value; } },
      ...["on_success", "manual", "always", "never", "delayed"].map((w) => el("option", { value: w }, "when: " + w)));
    whenSel.value = rule.when || "on_success";
    const afCb = el("input", { type: "checkbox", onchange: (e) => { rule.allow_failure = e.target.checked; } });
    afCb.checked = !!rule.allow_failure;

    const row = el("div", { class: "rule-row" },
      ifInput,
      whenSel,
      el("label", { class: "rule-af" }, afCb, "allow fail"),
      el("button", { class: "rule-del", title: "Remove rule", onclick: () => { draftRules.splice(idx, 1); renderRulesList(readOnly); } }, "✕"),
    );
    if (readOnly) row.querySelectorAll("input,select,button").forEach((n) => { n.disabled = true; });
    list.append(row);
  });
}

function populateRuleBuilderVars() {
  const sel = $("#rbVar");
  const keys = [
    ...PREDEFINED_VARS.map((p) => p.key),
    ...state.variables.map((v) => v.key),
  ];
  sel.replaceChildren(...keys.map((k) => el("option", { value: k }, "$" + k)));
}

function applyRulePreset(preset) {
  const presets = {
    branch: { if: "$CI_COMMIT_BRANCH == $CI_DEFAULT_BRANCH", when: "on_success" },
    mr: { if: '$CI_PIPELINE_SOURCE == "merge_request_event"', when: "on_success" },
    tag: { if: "$CI_COMMIT_TAG", when: "on_success" },
    manual: { if: "", when: "manual" },
  };
  const p = presets[preset];
  if (!p) return;
  draftRules.push({ ...p });
  renderRulesList();
}

function ruleBuilderInsert() {
  const v = $("#rbVar").value;
  const op = $("#rbOp").value;
  let valRaw = $("#rbVal").value.trim();
  let cond;
  if (op === "exists") cond = `$${v}`;
  else if (op === "missing") cond = `$${v} == null`;
  else {
    if (!valRaw) { toast("Enter a value for the condition"); return; }
    let val = valRaw;
    if (op === "=~") {
      if (!val.startsWith("/")) val = `/${val}/`;
    } else if (!val.startsWith('"') && !val.startsWith("'") && !val.startsWith("$") && val !== "null") {
      val = `"${val}"`;
    }
    cond = `$${v} ${op} ${val}`;
  }
  if (!draftRules.length) draftRules.push({ if: "", when: "on_success" });
  const last = draftRules[draftRules.length - 1];
  last.if = last.if && last.if.trim() ? `${last.if} && ${cond}` : cond;
  renderRulesList();
  $("#rbVal").value = "";
}

function saveJob() {
  const name = $("#jobName").value.trim();
  if (!name) { toast("Job needs a name"); return; }
  const dup = state.jobs.find((j) => j.name === name && j.id !== editingJobId);
  if (dup) { toast(`A job named "${name}" already exists`); return; }

  const needs = [...document.querySelectorAll("#jobNeeds input:checked")].map((c) => c.value);
  const data = {
    name,
    stage: $("#jobStage").value,
    image: $("#jobImage").value.trim(),
    script: $("#jobScript").value.split("\n").map((s) => s.trim()).filter(Boolean),
    rules: draftRules.filter((r) => (r.if && r.if.trim()) || r.when !== "on_success" || r.allow_failure),
    needs,
  };

  if (editingJobId) {
    const job = state.jobs.find((j) => j.id === editingJobId);
    const oldName = job.name;
    Object.assign(job, data);
    if (oldName !== name) {
      for (const j of state.jobs) {
        j.needs = (j.needs || []).map((n) => (n === oldName ? name : n));
      }
    }
  } else {
    state.jobs.push({ id: uid(), source: "local", ...data });
  }
  pendingNewJob = null;
  closeModal("jobModal");
  render();
}

function deleteJob() {
  if (!editingJobId) return;
  const job = state.jobs.find((j) => j.id === editingJobId);
  state.jobs = state.jobs.filter((j) => j.id !== editingJobId);
  for (const j of state.jobs) j.needs = (j.needs || []).filter((n) => n !== job.name);
  closeModal("jobModal");
  render();
}

/* ── Includes ──────────────────────────────────────────────────── */

function parseRules(raw) {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      if: typeof r.if === "string" ? r.if : "",
      when: typeof r.when === "string" ? r.when : "on_success",
      allow_failure: !!r.allow_failure,
    }));
}

/* legacy only:/except: → approximate rules so the simulator still works */
function onlyExceptToRules(jobDef) {
  const rules = [];
  const only = jobDef.only;
  if (Array.isArray(only)) {
    for (const o of only) {
      if (o === "tags") rules.push({ if: "$CI_COMMIT_TAG", when: "on_success" });
      else if (o === "merge_requests") rules.push({ if: '$CI_PIPELINE_SOURCE == "merge_request_event"', when: "on_success" });
      else if (o === "branches") rules.push({ if: "$CI_COMMIT_BRANCH", when: "on_success" });
      else if (typeof o === "string") rules.push({ if: `$CI_COMMIT_BRANCH == "${o}"`, when: "on_success" });
    }
  }
  return rules;
}

function saveInclude() {
  const errBox = $("#incError");
  errBox.classList.add("hidden");

  const type = $("#incType").value;
  const project = $("#incProject").value.trim();
  const ref = $("#incRef").value.trim();
  const file = $("#incFile").value.trim();
  const raw = $("#incYaml").value;

  if (type === "project" && !project) { showIncError("Project path is required for project includes."); return; }
  if (!file) { showIncError("File path / URL / template name is required."); return; }
  if (!raw.trim()) { showIncError("Paste the YAML content of the included file so its jobs can be visualized."); return; }

  let doc;
  try { doc = jsyaml.load(raw); }
  catch (e) { showIncError("YAML parse error:\n" + e.message); return; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    showIncError("The YAML must be a mapping of job definitions."); return;
  }

  const inc = {
    id: uid(),
    type, project, ref, file, raw,
    color: INCLUDE_COLORS[state.includes.length % INCLUDE_COLORS.length],
    variables: [],
    hiddenJobs: 0,
  };

  // imported variables
  if (doc.variables && typeof doc.variables === "object") {
    for (const [k, v] of Object.entries(doc.variables)) {
      const value = (v && typeof v === "object" && "value" in v) ? v.value : v;
      inc.variables.push({ key: k, value: String(value ?? "") });
    }
  }

  // imported stages — merge unknown ones into the pipeline
  const incStages = Array.isArray(doc.stages) ? doc.stages.map(String) : [];
  for (const s of incStages) if (!state.stages.includes(s)) state.stages.push(s);

  // imported jobs
  const newJobs = [];
  for (const [key, def] of Object.entries(doc)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (key.startsWith(".")) { inc.hiddenJobs++; continue; }
    if (!def || typeof def !== "object" || Array.isArray(def)) continue;

    let stage = typeof def.stage === "string" ? def.stage : "test";
    if (!state.stages.includes(stage)) state.stages.push(stage);

    let script = [];
    if (Array.isArray(def.script)) script = def.script.map(String);
    else if (typeof def.script === "string") script = [def.script];

    let rules = parseRules(def.rules);
    if (!rules.length && (def.only || def.except)) rules = onlyExceptToRules(def);

    if (state.jobs.some((j) => j.name === key)) {
      showIncError(`A job named "${key}" already exists in the pipeline. GitLab would merge/override it; rename one of them to visualize both.`);
      return;
    }

    newJobs.push({
      id: uid(), name: key, stage,
      image: typeof def.image === "string" ? def.image : "",
      script, rules,
      needs: Array.isArray(def.needs) ? def.needs.map((n) => (typeof n === "string" ? n : n.job)).filter(Boolean) : [],
      source: inc.id,
    });
  }

  if (!newJobs.length && !inc.variables.length) {
    showIncError("No visible jobs or variables found in this YAML (hidden \".job\" templates are counted but not shown).");
    return;
  }

  const replacingId = $("#includeModal").dataset.replacingId;
  if (replacingId) {
    // Replace the no-content stub that was detected during YAML import
    const stubIdx = state.includes.findIndex((i) => i.id === replacingId);
    if (stubIdx !== -1) {
      inc.id = replacingId; // keep the same id
      inc.color = state.includes[stubIdx].color;
      state.includes[stubIdx] = inc;
    } else {
      state.includes.push(inc);
    }
    delete $("#includeModal").dataset.replacingId;
  } else {
    state.includes.push(inc);
  }
  state.jobs.push(...newJobs);
  closeModal("includeModal");
  toast(`📡 Imported ${newJobs.length} job(s) from ${includeLabel(inc)}`);
  render();
}

function showIncError(msg) {
  const errBox = $("#incError");
  errBox.textContent = msg;
  errBox.classList.remove("hidden");
}

function openPasteContentModal(incId) {
  const inc = includeById(incId);
  if (!inc) return;
  // Pre-fill the include modal with the detected metadata
  $("#incType").value = inc.type;
  $("#incType").dispatchEvent(new Event("change"));
  $("#incProject").value = inc.project || "";
  $("#incRef").value = inc.ref || "";
  $("#incFile").value = inc.file || "";
  $("#incYaml").value = "";
  $("#incError").classList.add("hidden");
  // Store the id so saveInclude can replace rather than add
  $("#includeModal").dataset.replacingId = incId;
  openModal("includeModal");
}

function removeInclude(id) {
  const inc = includeById(id);
  const count = state.jobs.filter((j) => j.source === id).length;
  if (!confirm(`Remove include "${includeLabel(inc)}" and its ${count} imported job(s)?`)) return;
  state.includes = state.includes.filter((i) => i.id !== id);
  state.jobs = state.jobs.filter((j) => j.source !== id);
  render();
}

/* ── Variables CRUD ────────────────────────────────────────────── */

function addVariable(e) {
  e.preventDefault();
  const key = $("#newVarKey").value.trim();
  const value = $("#newVarValue").value;
  if (!key) return;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) { toast("Variable keys must be letters, digits and _"); return; }
  const existing = state.variables.find((v) => v.key === key);
  if (existing) existing.value = value;
  else state.variables.push({ key, value });
  $("#newVarKey").value = "";
  $("#newVarValue").value = "";
  render();
}

function removeVariable(key) {
  state.variables = state.variables.filter((v) => v.key !== key);
  render();
}

/* ── YAML import ───────────────────────────────────────────────── */

function importYamlDoc(raw) {
  let doc;
  try { doc = jsyaml.load(raw); }
  catch (e) { return { error: "YAML parse error:\n" + e.message }; }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) {
    return { error: "The YAML must be a top-level mapping." };
  }

  const newState = {
    trigger: state.trigger,
    stages: [],
    jobs: [],
    includes: state.includes,   // keep existing includes
    variables: [],
  };

  // stages
  if (Array.isArray(doc.stages)) {
    newState.stages = doc.stages.map(String);
  }

  // top-level variables
  if (doc.variables && typeof doc.variables === "object" && !Array.isArray(doc.variables)) {
    for (const [k, v] of Object.entries(doc.variables)) {
      const value = (v && typeof v === "object" && "value" in v) ? v.value : v;
      newState.variables.push({ key: k, value: String(value ?? "") });
    }
  }

  // include: entries — record them but don't auto-fetch YAML (user must paste content)
  const incList = doc.include ? (Array.isArray(doc.include) ? doc.include : [doc.include]) : [];
  const importedIncludes = [];
  for (const entry of incList) {
    if (!entry || typeof entry !== "object") continue;
    let type, project = "", ref = "", file = "";
    if (entry.project) {
      type = "project";
      project = String(entry.project);
      file = Array.isArray(entry.file) ? entry.file[0] : String(entry.file || "");
      ref = String(entry.ref || "");
    } else if (entry.remote) {
      type = "remote";
      file = String(entry.remote);
    } else if (entry.template) {
      type = "template";
      file = String(entry.template);
    } else if (entry.local) {
      type = "local";
      file = String(entry.local);
    } else {
      continue;
    }
    // Check if this include was already present
    const already = newState.includes.find((i) =>
      i.type === type && i.file === file && i.project === project);
    if (!already) {
      importedIncludes.push({
        id: uid(), type, project, ref, file, raw: "",
        color: INCLUDE_COLORS[newState.includes.length % INCLUDE_COLORS.length],
        variables: [], hiddenJobs: 0, noContent: true,
      });
    }
  }
  newState.includes = [...newState.includes, ...importedIncludes];

  // jobs
  for (const [key, def] of Object.entries(doc)) {
    if (RESERVED_KEYS.has(key)) continue;
    if (key.startsWith(".")) continue; // hidden templates
    if (!def || typeof def !== "object" || Array.isArray(def)) continue;

    let stage = typeof def.stage === "string" ? def.stage : "";
    if (!stage) {
      // GitLab default stage is "test" when none specified
      stage = "test";
    }
    if (!newState.stages.includes(stage)) newState.stages.push(stage);

    let script = [];
    if (Array.isArray(def.script)) script = def.script.map(String);
    else if (typeof def.script === "string") script = [def.script];

    // before_script / after_script folded into script with comments
    if (Array.isArray(def.before_script) && def.before_script.length) {
      script = [...def.before_script.map(String), ...script];
    }
    if (Array.isArray(def.after_script) && def.after_script.length) {
      script = [...script, ...def.after_script.map(String)];
    }

    let rules = parseRules(def.rules);
    if (!rules.length && (def.only || def.except)) rules = onlyExceptToRules(def);

    let needs = [];
    if (Array.isArray(def.needs)) {
      needs = def.needs.map((n) => (typeof n === "string" ? n : n?.job)).filter(Boolean);
    }

    // image may be a string or { name, entrypoint }
    let image = "";
    if (typeof def.image === "string") image = def.image;
    else if (def.image && typeof def.image.name === "string") image = def.image.name;

    newState.jobs.push({
      id: uid(), name: key, stage, image, script, rules, needs, source: "local",
    });
  }

  // if no stages discovered at all, create a sensible default
  if (!newState.stages.length) newState.stages = ["build", "test", "deploy"];

  return { state: newState, importedIncludes };
}

function openImportModal() {
  $("#importYaml").value = "";
  $("#importFile").value = "";
  $("#importError").classList.add("hidden");
  openModal("importModal");
}

function doImport() {
  const raw = $("#importYaml").value.trim();
  const errBox = $("#importError");
  errBox.classList.add("hidden");
  if (!raw) { errBox.textContent = "Paste a .gitlab-ci.yml or drop a file above."; errBox.classList.remove("hidden"); return; }

  const result = importYamlDoc(raw);
  if (result.error) { errBox.textContent = result.error; errBox.classList.remove("hidden"); return; }

  state = result.state;
  closeModal("importModal");

  const inc = result.importedIncludes;
  const msg = `Imported ${state.jobs.length} job(s) across ${state.stages.length} stage(s)` +
    (inc.length ? ` · ${inc.length} include entry(ies) detected — paste their YAML in the Imports panel to visualize` : "");
  toast(msg);

  if (inc.length) {
    // switch sidebar to includes tab so user notices the placeholder entries
    document.querySelectorAll(".sidebar-tab").forEach((b) => b.classList.toggle("active", b.dataset.tab === "includes"));
    $("#pane-vars").classList.add("hidden");
    $("#pane-includes").classList.remove("hidden");
  }
  render();
}

/* ── YAML export ───────────────────────────────────────────────── */

function buildYamlDoc() {
  const doc = {};

  if (state.includes.length) {
    doc.include = state.includes.map((inc) => {
      if (inc.type === "project") {
        const entry = { project: inc.project, file: inc.file };
        if (inc.ref) entry.ref = inc.ref;
        return entry;
      }
      if (inc.type === "remote") return { remote: inc.file };
      if (inc.type === "template") return { template: inc.file };
      return { local: inc.file };
    });
  }

  doc.stages = [...state.stages];

  if (state.variables.length) {
    doc.variables = {};
    for (const v of state.variables) doc.variables[v.key] = v.value;
  }

  for (const job of state.jobs) {
    if (job.source !== "local") continue; // imported jobs come in via include:
    const j = { stage: job.stage };
    if (job.image) j.image = job.image;
    j.script = job.script.length ? [...job.script] : ['echo "TODO"'];
    if (job.needs && job.needs.length) j.needs = [...job.needs];
    if (job.rules && job.rules.length) {
      j.rules = job.rules.map((r) => {
        const rule = {};
        if (r.if && r.if.trim()) rule.if = r.if;
        if (r.when && r.when !== "on_success") rule.when = r.when;
        if (r.allow_failure) rule.allow_failure = true;
        if (!Object.keys(rule).length) rule.when = "on_success";
        return rule;
      });
    }
    doc[job.name] = j;
  }

  return doc;
}

function exportYaml() {
  const doc = buildYamlDoc();
  const header = "# Generated by Strata — Visual GitLab CI/CD Pipeline Builder\n";
  let yaml;
  try {
    yaml = header + jsyaml.dump(doc, { lineWidth: 120, noRefs: true, quotingType: '"' });
  } catch (e) {
    yaml = header + "# dump error: " + e.message;
  }
  $("#exportYaml").textContent = yaml;
  openModal("exportModal");
}

function downloadYaml() {
  const blob = new Blob([$("#exportYaml").textContent], { type: "text/yaml" });
  const a = el("a", { href: URL.createObjectURL(blob), download: ".gitlab-ci.yml" });
  document.body.append(a);
  a.click();
  a.remove();
}

/* ── Starfield background ──────────────────────────────────────── */

function initStarfield() {
  const canvas = $("#starfield");
  const ctx = canvas.getContext("2d");
  let stars = [];
  let shooting = null;

  function resize() {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    stars = Array.from({ length: Math.floor((innerWidth * innerHeight) / 6000) }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.3 + 0.2,
      tw: Math.random() * Math.PI * 2,
      sp: Math.random() * 0.015 + 0.004,
    }));
  }

  function frame() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (const s of stars) {
      s.tw += s.sp;
      const alpha = 0.35 + 0.45 * Math.abs(Math.sin(s.tw));
      ctx.fillStyle = `rgba(221, 228, 255, ${alpha})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2);
      ctx.fill();
    }
    // occasional shooting star
    if (!shooting && Math.random() < 0.004) {
      shooting = { x: Math.random() * canvas.width * 0.7, y: Math.random() * canvas.height * 0.4, life: 1 };
    }
    if (shooting) {
      ctx.strokeStyle = `rgba(124, 92, 255, ${shooting.life})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(shooting.x, shooting.y);
      ctx.lineTo(shooting.x - 60 * (1 - shooting.life + 0.3), shooting.y + 30 * (1 - shooting.life + 0.3));
      ctx.stroke();
      shooting.x += 9;
      shooting.y += 4.5;
      shooting.life -= 0.025;
      if (shooting.life <= 0) shooting = null;
    }
    requestAnimationFrame(frame);
  }

  addEventListener("resize", resize);
  resize();
  frame();
}

/* ── Wiring ────────────────────────────────────────────────────── */

function init() {
  state = loadState();
  initStarfield();
  renderPalette();

  // event tabs
  document.querySelectorAll(".event-tab").forEach((btn) => {
    btn.addEventListener("click", () => { state.trigger = btn.dataset.trigger; render(); });
  });

  // sidebar tabs
  document.querySelectorAll(".sidebar-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      document.querySelectorAll(".sidebar-tab").forEach((b) => b.classList.toggle("active", b === btn));
      $("#pane-vars").classList.toggle("hidden", btn.dataset.tab !== "vars");
      $("#pane-includes").classList.toggle("hidden", btn.dataset.tab !== "includes");
    });
  });

  // modal close buttons + overlay click
  document.querySelectorAll("[data-close]").forEach((btn) => {
    btn.addEventListener("click", () => {
      closeModal(btn.dataset.close);
      pendingNewJob = null;
      delete $("#includeModal").dataset.replacingId;
    });
  });
  document.querySelectorAll(".modal-overlay").forEach((ov) => {
    ov.addEventListener("mousedown", (e) => {
      if (e.target === ov) {
        ov.classList.add("hidden");
        pendingNewJob = null;
        delete $("#includeModal").dataset.replacingId;
      }
    });
  });
  addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      document.querySelectorAll(".modal-overlay").forEach((ov) => ov.classList.add("hidden"));
      pendingNewJob = null;
      delete $("#includeModal").dataset.replacingId;
    }
  });

  $("#btnAddStage").addEventListener("click", addStage);
  $("#btnExport").addEventListener("click", exportYaml);
  $("#btnImport").addEventListener("click", openImportModal);

  // job modal
  $("#btnSaveJob").addEventListener("click", saveJob);
  $("#btnDeleteJob").addEventListener("click", deleteJob);
  $("#btnAddRule").addEventListener("click", () => { draftRules.push({ if: "", when: "on_success" }); renderRulesList(); });
  $("#rulePresets").addEventListener("click", (e) => {
    const preset = e.target.dataset?.preset;
    if (preset) applyRulePreset(preset);
  });
  $("#rbAdd").addEventListener("click", ruleBuilderInsert);

  // include modal
  $("#btnAddInclude").addEventListener("click", () => {
    $("#incError").classList.add("hidden");
    openModal("includeModal");
  });
  $("#btnSaveInclude").addEventListener("click", saveInclude);
  $("#incType").addEventListener("change", () => {
    const type = $("#incType").value;
    $("#incProjectRow").classList.toggle("hidden", type !== "project");
    $("#incFileLabel").firstChild.textContent =
      type === "remote" ? "URL " : type === "template" ? "Template name " : "File path ";
    $("#incFile").placeholder =
      type === "remote" ? "https://example.com/ci/deploy.yml"
      : type === "template" ? "Jobs/SAST.gitlab-ci.yml"
      : "/templates/deploy.yml";
  });

  // import modal
  $("#btnDoImport").addEventListener("click", doImport);

  // file drop on dropzone
  const dropzone = $("#importDropzone");
  dropzone.addEventListener("dragover", (e) => { e.preventDefault(); dropzone.classList.add("drag-over"); });
  dropzone.addEventListener("dragleave", () => dropzone.classList.remove("drag-over"));
  dropzone.addEventListener("drop", (e) => {
    e.preventDefault();
    dropzone.classList.remove("drag-over");
    const file = e.dataTransfer.files[0];
    if (file) readImportFile(file);
  });
  dropzone.addEventListener("click", (e) => {
    // Let the label's <input> handle it; don't double-trigger
    if (e.target.closest(".file-link")) return;
    $("#importFile").click();
  });
  $("#importFile").addEventListener("change", (e) => {
    const file = e.target.files[0];
    if (file) readImportFile(file);
  });

  function readImportFile(file) {
    const reader = new FileReader();
    reader.onload = (e) => {
      $("#importYaml").value = e.target.result;
      $("#importError").classList.add("hidden");
    };
    reader.readAsText(file);
  }

  // export modal
  $("#btnCopyYaml").addEventListener("click", () => {
    navigator.clipboard?.writeText($("#exportYaml").textContent).then(
      () => toast("YAML copied to clipboard"),
      () => toast("Copy failed — select & copy manually"),
    );
  });
  $("#btnDownloadYaml").addEventListener("click", downloadYaml);

  // variables
  $("#addVarForm").addEventListener("submit", addVariable);

  render();
}

document.addEventListener("DOMContentLoaded", init);
