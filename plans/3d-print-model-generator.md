# Plan: AI-Assisted 3D Print Model Generator (working name: "PrintForge")

A self-hosted app on your Windows PC for designing **home and office items** you can print.
You describe what you need ("a hook that clamps under my 25 mm desk for headphones"), and it:

1. Asks clarifying questions until it has a complete, measurable spec.
2. Searches public model sites for existing designs.
3. If nothing fits, generates a model with **your own backend models**, routed by a model handler you configure.
   An orchestrator LLM (Claude by default, swappable) manages the process.
4. Looks up real product and standard dimensions so parts fit (desk thickness, power strips, pegboard spacing, screws).
5. Lets you customize the result, preview it in 3D, and export a printable STL/3MF.

**Goals**
- **Low running cost.** No stack of $20/month AI subscriptions. Everything that can run locally does. Paid APIs are optional plugins you can turn on.
- **You choose the models.** A model handler (router) where you pick which backend does each job.
- **Local first, reachable from anywhere** later without exposing your PC to the internet.

---

## 1. Key design decisions

| Decision | Choice | Why |
|---|---|---|
| Host | **Windows PC** runs the backend, Blender, Fusion, and local AI models | Blender and Fusion are already there, and so is your GPU |
| App shape | Python **FastAPI** backend + **React/TypeScript** frontend (works on desktop and phone browsers) | Fits your Python + web learning; a browser UI makes remote access easy |
| Main engine for home/office items | **Parametric CAD**: template library + LLM-written **build123d** scripts | Most home/office items are precise geometric parts (brackets, bins, clips). Parametric CAD is exact, free, and needs no 3D AI model |
| Organic/decor shapes | **Self-hosted image-to-3D** models (see §4), Blender cleanup | Covers the occasional vase, figurine, or decorative piece without a subscription |
| Orchestrator | **Pluggable LLM**: Claude via API (pay per use, no subscription) or a local model via Ollama | You choose cost vs. quality per task |
| Model routing | **Model handler** with a config file you edit, plus a settings page in the UI | You choose the backend for each task |
| Remote access | **Tailscale** (phase 1) and optionally **Cloudflare Tunnel + Access** (later) | Secure access from anywhere with no open ports on your router |

---

## 2. Focus: home and office items

The first template set targets things people actually print for home and office:

| Category | Examples | Key fit inputs |
|---|---|---|
| Desk organization | Gridfinity bins/baseplates, pen holders, drawer dividers, monitor riser | Drawer inner W×D×H, desk space |
| Cable management | Under-desk cable trays, cable clips, desk grommets, cord wraps | Desk thickness, cable diameter, grommet hole size |
| Hooks & mounts | Under-desk headphone hook, wall hooks, power-strip mount, router/modem mount, controller holder | Desk thickness or wall type, device dimensions, screw size |
| Pegboard | IKEA SKÅDIS-compatible and standard 1" pegboard accessories | Hole spacing and size (standard values) |
| Stands | Phone/tablet stand, laptop stand, book stand | Device dimensions and viewing angle |
| Kitchen/home | Replacement knobs, shelf brackets, furniture feet/levelers, door stops, bag clips, spice rack inserts | Shaft type/diameter, shelf thickness, load |
| Labels & signs | Label holders, name plates, embossed tags | Text, font, size |
| Enclosures | Project boxes, boxes with lids/hinges, battery holders | Inner dimensions, wall, lid type |

**Standards library (built in, no lookup needed):** metric/imperial screws and heat-set inserts, common magnet sizes,
1/4-20 camera thread, Gridfinity spec (42 mm grid, 7 mm height units), SKÅDIS and 1" pegboard spacing,
US/EU outlet and switch plate sizes, common cable diameters (USB-C, HDMI, power cords).

**Product lookup** (for name-brand items like power strips, routers, monitors, phones, appliances):
1. Manufacturer spec pages / datasheets / manuals (PDF)
2. Manufacturer accessory guidelines when published (e.g. Apple's Accessory Design Guidelines)
3. Spec databases and retailer listings
4. Community reference models
5. Patents for overall shape and feature layout only (rarely dimensioned)
6. **User measurement fallback**: guided caliper prompts ("measure desk thickness at the edge")

Every value stores its **source + confidence**. Low-confidence values must be confirmed before generation, and the app
offers to print a quick **test-fit piece** (a thin slice of the critical section) before the full print.

---

## 3. User flow

```
 Describe ─▶ Clarify (Q&A → spec) ─▶ Search existing sites ─▶ Pick match / "Generate"
                                                                    │
 Export STL/3MF ◀─ Printability checks ◀─ Customize ◀─ Generate (router picks backend)
```

Clarifying questions come from the category's **spec schema**. The orchestrator asks only for missing required fields,
and always asks about **material + printer** because they drive the tolerances.

---

## 4. Model handler (router)

The core of the app's cost control. Each **task** is mapped to a **provider**, and you can change any mapping.

### 4.1 Tasks
| Task | What it does | Suggested default |
|---|---|---|
| `orchestrate` | Conversation, clarifying questions, planning, tool calls | Claude Sonnet 5.5 (`claude-sonnet-5-5`), or a local model to save money |
| `cad_codegen` | Writes/edits build123d, Blender (bpy), or Fusion scripts | Claude (best at code), with local fallback |
| `vision_check` | Looks at rendered previews and verifies the geometry matches the spec | Claude, or a local vision model |
| `spec_extract` | Pulls dimensions from web pages/PDFs | Small/cheap model (local or Claude Haiku 5.5 `claude-haiku-5-5`) |
| `search_rank` | Ranks existing models against the spec | Small/cheap model |
| `text_to_image` | Concept image for organic shapes | Local: SDXL / FLUX via ComfyUI |
| `image_to_3d` | Mesh from image | Local: TRELLIS, Hunyuan3D-2 (mini), TripoSR, or Stable Fast 3D |
| `mesh_cleanup` | Repair, remesh, scale, add base | Blender (headless) |

### 4.2 Config example (`models.yaml`)
```yaml
providers:
  claude:     { type: anthropic, api_key_env: ANTHROPIC_API_KEY }
  ollama:     { type: openai_compatible, base_url: http://localhost:11434/v1 }
  comfyui:    { type: comfyui, base_url: http://localhost:8188 }
  trellis:    { type: local_worker, cmd: "workers/trellis/run.py", gpu: true }
  meshy:      { type: http_api, enabled: false }   # optional paid plugin, off by default

routes:
  orchestrate:   { provider: claude, model: claude-sonnet-5-5, fallback: { provider: ollama, model: qwen-coder } }
  cad_codegen:   { provider: claude, model: claude-sonnet-5-5 }
  spec_extract:  { provider: ollama, model: llama-small }
  search_rank:   { provider: ollama, model: llama-small }
  text_to_image: { provider: comfyui, workflow: flux_product_concept.json }
  image_to_3d:   { provider: trellis }

budget:
  monthly_usd_cap: 10          # hard stop for paid providers
  warn_at_usd: 7
```
(Local model names are placeholders. Choose them based on your GPU.)

### 4.3 How it works
- **One interface per task type** (`chat`, `generate_image`, `image_to_3d`, …). Providers are adapters, so adding a new model
  is a new adapter plus a line in the config.
- LLM calls go through a provider layer such as **LiteLLM** or a thin custom wrapper, so Claude, Ollama, and any
  OpenAI-compatible server are interchangeable.
- **Per-request override** in the UI ("use local only for this one").
- **Fallback chain** if a provider fails or the budget is hit.
- **Usage dashboard**: tokens, cost per job, and GPU time per provider, so you see where the money goes.
- **Local workers** for GPU models run as separate processes with a job queue, one GPU job at a time, and models
  are unloaded when idle to free VRAM for other things.

### 4.4 Self-hosted 3D model options (verify licenses and VRAM before choosing)
| Model | Type | Notes |
|---|---|---|
| TRELLIS (Microsoft) | Image→3D | Good quality; needs a high-VRAM GPU |
| Hunyuan3D-2 / 2-mini (Tencent) | Image→3D with texture | Mini version is lighter; license has regional/usage restrictions |
| TripoSR | Image→3D | Fast, low VRAM, lower detail |
| Stable Fast 3D / SPAR3D (Stability) | Image→3D | Fast; community license terms apply |

"Text-to-3D" locally = text→image (FLUX/SDXL in ComfyUI) → image→3D. ComfyUI has community nodes for several of these,
so it can act as one runtime for both steps.
**For home/office items this path is rarely needed.** The parametric path handles most of them, so a paid 3D service
mostly isn't required.

---

## 5. Generation backends

Common interface:
```python
class CadBackend(Protocol):
    def generate(self, template: str, params: dict) -> ModelResult: ...
    def run_script(self, code: str) -> ModelResult: ...
    def export(self, model_id: str, fmt: Literal["stl", "3mf", "step"]) -> Path: ...
```

1. **Template library** (build first): hand-written parametric build123d templates for the categories in §2.
   The orchestrator only picks a template and fills parameters, which is reliable and cheap.
2. **LLM code generation**: for new items, `cad_codegen` writes a build123d script. It runs in a sandboxed subprocess, a preview
   is rendered, and `vision_check` compares it to the spec. **Dimension assertions** are written into the script
   (e.g. `assert clamp_gap == desk_thickness + tolerance`). It retries up to N times, and successful scripts become new templates.
3. **Blender (headless)**: `blender.exe -b --python script.py`, or a persistent Blender process with a local RPC server.
   Used for importing and remixing STLs from model sites, mesh cleanup, embossing text/logos, and preview renders.
4. **Fusion (optional pro mode)**: a Python add-in installed in Fusion's AddIns folder on Windows. It opens a localhost
   listener and builds models using **User Parameters**, then exports STEP/STL. Fusion must be open and signed in,
   and API calls must be handed to the main thread via a custom event.
5. **Image→3D** (organic/decor only) via the router, then Blender cleanup.

---

## 6. Existing model search
Adapters for Thingiverse (official API), Printables, Cults3D (official API), and MyMiniFactory (official API).
The router's `search_rank` model scores each result against the spec. License shown on every result,
and **"Use as base"** imports the STL into Blender for changes (scale, add text, add mounting holes).

---

## 7. Customization
- Template/script parameters (typed, with ranges and units) become UI sliders/fields automatically.
- Universal add-ons: text/logo emboss or engrave, fillets, mounting holes (screw-size dropdown), magnet pockets,
  heat-set insert holes, split into printable parts.
- Natural-language edits ("2 mm thicker, add a slot for a 6 mm cable") become parameter changes or script edits.
- **Printer profile**: printer, nozzle, layer height, material, and a measured fit tolerance. Also a one-time **tolerance
  calibration print** (peg-in-hole test) so the app knows your printer's real clearance.

---

## 8. Printability checks
Watertight/manifold check + repair (trimesh / Blender 3D-Print Toolbox), minimum wall vs. nozzle, overhang analysis + suggested
orientation, build-volume fit, and optional slicing with the **OrcaSlicer / PrusaSlicer CLI** for time and filament estimates.
Later: send the file straight to the printer (Bambu, OctoPrint, Moonraker/Klipper) depending on your printer.

---

## 9. Architecture (Windows host)

```
 Phone / laptop browser ──(Tailscale or Cloudflare Tunnel)──┐
 Local browser ─────────────────────────────────────────────┤
                                                            ▼
 Windows PC
  FastAPI backend (Python, runs as a Windows service)
   ├── Auth (required once remote access is on)
   ├── Orchestrator ──▶ Model handler/router ──┬── Claude API (pay per use)
   │                                           ├── Ollama (local LLMs)
   │                                           ├── ComfyUI (local image gen)
   │                                           ├── Local 3D workers (TRELLIS / Hunyuan3D / TripoSR)
   │                                           └── Optional paid plugins (off by default)
   ├── Spec schemas + standards library + product lookup cache (SQLite)
   ├── Model-site search adapters
   ├── Job queue (one GPU job at a time; long jobs keep running when you close the browser)
   ├── CAD workers: build123d │ Blender (blender.exe -b) │ Fusion add-in bridge (localhost)
   ├── Printability checks + slicer CLI
   └── Storage: SQLite + files\ (STL, 3MF, STEP, previews)
```

**Windows notes**
- Install the Python backend in a venv. GPU models can run natively with CUDA or inside **WSL2** (CUDA is supported there)
  if a model's setup is Linux-only.
- Run the backend at startup as a service (e.g. NSSM or Task Scheduler).
- Paths configured in settings: Blender install, Fusion AddIns folder, slicer CLI, ComfyUI URL.
- Bind the backend to `localhost` / the Tailscale interface only. Never port-forward on your router.

**Remote access, in two steps**
1. **Tailscale** (free personal plan): install on the PC and your phone/laptop, then open `http://<pc-name>:8000` from anywhere.
   Nothing is exposed to the public internet.
2. **Cloudflare Tunnel + Cloudflare Access** (optional): a normal HTTPS URL without installing a client. Access adds login
   (email one-time code / Google) in front of the app.
   Either way, add app-level auth and a budget cap so a leaked link can't run up API costs.

---

## 10. Roadmap

**Phase 0: Spike (1 week)**
- build123d under-desk hook template → STL; headless Blender render of it.
- Model handler skeleton: same prompt routed to Claude or Ollama based on `models.yaml`.
- Minimal Fusion add-in that receives a JSON command and extrudes a sketch.

**Phase 1: Local MVP (3–4 weeks)**
- FastAPI + React app, 3D viewer, STL/3MF export, printer profile.
- 5 templates: Gridfinity bin, under-desk hook, cable clip, box with lid, wall/power-strip mount.
- Schema-driven clarifying questions; standards library.
- Router settings page + usage/cost dashboard + budget cap.
- Tailscale access from your phone.

**Phase 2: Search, lookup, and remix (2–3 weeks)**
- Model-site search + ranking + licenses; "Use as base" in Blender.
- Product dimension lookup (spec pages/PDFs) with source + confidence; test-fit prints.

**Phase 3: AI generation (3–4 weeks)**
- `cad_codegen` loop with sandbox, render, vision check, and dimension asserts; promote good scripts to templates.
- Local ComfyUI + one image→3D worker, with Blender cleanup.

**Phase 4: Pro + polish**
- Full Fusion bridge (User Parameters, STEP, open in Fusion for manual edits).
- Slicer CLI + optional send-to-printer.
- Cloudflare Tunnel option; installer for the Windows service.

---

## 11. Risks

| Risk | Mitigation |
|---|---|
| Local LLMs worse at CAD code than Claude | Templates do the heavy lifting; route `cad_codegen` to Claude only (cost is small per job); local fallback |
| GPU VRAM limits | Lighter models (TripoSR, Hunyuan3D-mini), one GPU job at a time, unload idle models |
| API costs creep | Budget cap with hard stop, per-job cost display, cheap models for extraction/ranking |
| Remote access exposure | Tailscale/Cloudflare Access only, app auth, no router port-forwarding |
| Open-model licenses | Check each model's license; keep the router able to swap them |
| Wrong dimensions | Source + confidence, user confirmation, test-fit prints, tolerance calibration |

---

## 12. Open questions
1. What GPU (and VRAM) does the Windows PC have? This decides which local 3D and LLM models are practical.
2. What is "Astra"? Is it a specific model/agent you already use? If so, the orchestrator slot can get an adapter for it.
3. Which printer(s) and materials? This sets tolerances, build volume, and the send-to-printer option.
4. Top 5 items you'd print first? These become the first templates.
