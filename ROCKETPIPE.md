# 🚀 RocketPipe — Mission Control for GitLab CI/CD

A space-themed, drag-and-drop GitLab CI/CD pipeline builder that runs entirely in the browser.
No build step, no server, no dependencies to install.

## Running it

Open `index.html` directly in a browser, or serve the folder:

```bash
python3 -m http.server 8000
# then visit http://localhost:8000
```

It also works out of the box on GitHub Pages (Settings → Pages → deploy from branch).

## Features

### 🧰 Drag & drop building
Drag job modules (Build, Unit Tests, Lint, Security Scan, Docker Build, Deploy Staging,
Deploy Production, Custom Job) from the Launch Pad onto stage columns. Drag job cards
between stages to move them, drag stage headers to reorder stages, double-click a stage
name to rename it.

### ☄️ Event simulation — commit, merge request, tag
The tabs at the top simulate the three major pipeline triggers:

- **Commit Push** — branch pipeline (`CI_COMMIT_BRANCH=main`, no tag, no MR)
- **Merge Request** — MR pipeline (`CI_PIPELINE_SOURCE=merge_request_event`, branch unset)
- **Tag** — tag pipeline (`CI_COMMIT_TAG=v1.0.0`, branch unset)

Each job's `rules:` are evaluated against the simulated variables and every card shows
whether it 🚀 launches, ✋ waits for manual ignition, or ⛔ is held back for that event.
The mission status bar totals it up.

### 📡 Imported pipelines (`include:`)
Add includes from other repositories (`project`/`remote`/`template`/`local`), paste the
included file's YAML, and its jobs appear in the pipeline color-coded with a source badge.
Imported stages and variables are merged in; imported jobs are read-only (edit them in
their source repo). Legacy `only:` keywords are approximated as rules so the simulator
still works on older files.

### 🛰 Variable awareness
The Variables panel lists GitLab's predefined CI variables with their simulated value for
the currently selected event (including which ones are *not set* — the most common rules
gotcha). Add custom variables, and see variables contributed by included files. Clicking
a variable copies `$NAME` — or inserts it straight into the rule you're editing if the
job editor is open.

### 🧭 Rules builder
Per-job rules editor with:
- ordered rule rows (`if` expression, `when:`, `allow_failure`) — first match wins, like GitLab
- one-click presets: *default branch*, *merge requests*, *tags*, *manual gate*
- a condition helper that builds expressions (`==`, `!=`, `=~`, is set / not set) from
  dropdowns of known variables

The expression engine supports `$VAR`, strings, `null`, regex (`=~`, `!~`), `&&`, `||`,
and parentheses.

### ⬇ Export
One click generates the complete `.gitlab-ci.yml` (includes, stages, variables, jobs and
rules) to copy or download.

Everything is auto-saved to `localStorage`; **Reset Demo** restores the sample mission.

## Tech

Vanilla HTML/CSS/JS plus a vendored copy of [js-yaml](https://github.com/nodeca/js-yaml)
(MIT) for parsing pasted include files and emitting the exported YAML.
