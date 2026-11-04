# Plan: AI-Assisted 3D Print Model Generator (working name: "PrintForge")

A local app where you describe what you want to print ("a slim case for my iPhone 16 Pro
with a kickstand"), and it:

1. Asks clarifying questions until it has a complete, measurable spec.
2. Looks up existing models on public repositories and shows matches.
3. If nothing fits, generates a new model with Blender and/or Fusion.
4. Pulls real product dimensions for name-brand items so parts fit.
5. Lets you customize the result with sliders/fields, preview it in 3D, and export a printable STL/3MF.

---

## 1. Key design decisions

| Decision | Recommendation | Why |
|---|---|---|
| App shape | **Local web app**: Python backend (FastAPI) + TypeScript/React frontend, opened in the browser or wrapped later with Tauri/Electron | Blender and Fusion run on your machine, so the backend must too. Fits your Python + learning-TS/web goals. |
| Main parametric engine | **build123d (or CadQuery)**, a headless Python CAD library, for mechanical parts. Fusion as an optional "pro" backend | Fusion has no headless mode; it must be open with an add-in running. A headless engine makes the MVP reliable and testable. |
| Mesh / organic engine | **Blender** run headless (`blender -b --python script.py`) | Good for sculpted/organic shapes, mesh repair, booleans on meshes, text embossing, and rendering previews. |
| AI brain | An LLM with tool use (e.g. Claude Sonnet 5.5, `claude-sonnet-5-5`; Opus 5.5 for hard designs) | Handles the conversation, fills the spec, picks a template, and writes/edits CAD scripts. |
| AI shape generation (organic) | Text/image-to-3D service or open model (e.g. Meshy, Tripo, TRELLIS, Hunyuan3D) | For figurines and decor. These meshes are **not dimensionally accurate**, so don't use them for parts that must fit. |
| Output | STL + 3MF, optional STEP for parametric parts | 3MF keeps units and multiple parts. STEP lets you edit the part in Fusion. |

---

## 2. User flow

```
 ┌────────────┐   ┌───────────────┐   ┌─────────────────┐   ┌───────────────┐
 │ Describe   │──▶│ Clarify (Q&A) │──▶│ Search existing │──▶│ Pick a match  │──┐
 │ the object │   │ build a spec  │   │ model sites     │   │ or "generate" │  │
 └────────────┘   └───────────────┘   └─────────────────┘   └───────────────┘  │
                                                                               ▼
 ┌────────────┐   ┌───────────────┐   ┌─────────────────┐   ┌───────────────┐
 │ Export     │◀──│ Printability  │◀──│ Customize with  │◀──│ Generate via  │
 │ STL / 3MF  │   │ checks        │   │ sliders / text  │   │ Blender/Fusion│
 └────────────┘   └───────────────┘   └─────────────────┘   └───────────────┘
```

---

## 3. Components

### 3.1 Conversation and spec builder
- The LLM converts free text into a **typed spec** (a JSON schema per object category), for example:
  ```json
  {
    "category": "phone_case",
    "target_device": {"brand": "Apple", "model": "iPhone 16 Pro"},
    "device_dims_mm": {"h": 149.6, "w": 71.5, "d": 8.25, "source": "apple.com/specs", "confidence": "high"},
    "features": ["camera_cutout", "button_cutouts", "kickstand"],
    "wall_mm": 1.6, "lip_mm": 1.0,
    "material": "TPU", "printer": "Bambu P1S, 0.4mm nozzle"
  }
  ```
- It asks only for the **missing required fields** in that schema, so the questions stay short and relevant:
  - "Which exact model? (iPhone 16 Pro vs 16 Pro Max differ by ~13 mm)"
  - "What material: TPU (flexible) or PLA/PETG (rigid)?"
  - "Do you want a raised lip to protect the screen?"
- It always asks about **material and printer**, because they change the tolerances (TPU needs a tighter fit, PLA needs clearance).
- Show the spec to the user as an editable form, not just chat, so they can correct things directly.

### 3.2 Product dimension lookup ("make it fit the product")
Patents are a weak source. Design patent drawings show the shape but are usually not to scale
and rarely give dimensions. Use this source order instead, and record the source and a confidence level for every number:

1. **Manufacturer spec pages** for overall dimensions (Apple, Samsung, Google publish height/width/depth/weight).
2. **Manufacturer accessory guidelines**. Apple publishes *Accessory Design Guidelines* with dimensioned drawings
   (camera bump, button positions, corner radii) for accessory makers. This is the best source when it exists.
3. **Spec databases** (e.g. GSMArena for phones; product datasheets/manuals for tools, appliances, consoles).
4. **Community CAD/reference models** of the product (e.g. existing "iPhone 16 Pro dummy" models on GrabCAD/Printables).
5. **Patents** (Google Patents) for overall shape and feature *layout* only.
6. **User measurement fallback**: guided caliper prompts ("measure the camera bump width"), or a photo next to a
   known reference (credit card or coin) for rough values.

Implementation: a `dimension_lookup` tool the LLM can call that runs a web search, fetches the page, and extracts
numbers into the schema. Cache results in a local `products` table so lookups are only done once.
Make the user confirm low-confidence values before generating anything.

### 3.3 Existing model search
Query several repositories in parallel, then rank the results with the LLM against the spec:

| Source | Access | Notes |
|---|---|---|
| Thingiverse | Official REST API (app token) | Large catalog, mixed quality |
| Printables | GraphQL used by their site (unofficial) | High quality; check terms of use |
| Cults3D | Official GraphQL API (API key) | Free and paid models |
| MyMiniFactory | Official API | Good for figurines |
| Thangs | Search engine across sites | Check API availability |

- Show license, thumbnail, and a "fit score" (e.g. "case for iPhone 15 Pro, not 16 Pro: likely won't fit").
- Respect licenses: show them, and block remixing when the license forbids derivatives.
- Allow "use this as a base": import the STL into Blender and modify it (add text, scale, add a mount, etc.).

### 3.4 Generation backends
Use a common interface so the rest of the app doesn't care which engine runs:

```python
class CadBackend(Protocol):
    def generate(self, template: str, params: dict) -> ModelResult: ...
    def run_script(self, code: str) -> ModelResult: ...
    def export(self, model_id: str, fmt: Literal["stl", "3mf", "step"]) -> Path: ...
```

**A. Template library (most reliable, build first).** Hand-written parametric templates for common categories:
phone case, tablet stand, wall mount/bracket, box with lid, cable clip, controller holder, gridfinity bin, knob, spacer.
The LLM only picks a template and fills in the parameters. It doesn't write geometry code.

**B. LLM code generation (flexible).** For things with no template, the LLM writes a build123d / bpy / Fusion script.
Run it in a sandboxed subprocess, render preview images, and let the LLM check the images and fix the script
(up to N retries). Save successful scripts as new templates.

**C. AI mesh generation (organic).** Text/image-to-3D for figurines and decor, then Blender cleans it up:
make it watertight, decimate, scale to the requested size, add a flat base.

**Blender integration:** a headless subprocess, `blender -b --python-expr ...`, or a persistent Blender process
running a small socket/RPC server so it doesn't have to start up for every request.

**Fusion integration:** a Fusion **add-in** (Python, using the `adsk.core`/`adsk.fusion` API) that starts a local
HTTP/socket listener inside Fusion. The app sends it commands ("create sketch", "extrude", "set user parameter",
"export STEP/STL"). Use Fusion **User Parameters** so customization edits the real parametric model.
Note: Fusion must be running and signed in. Its API calls need to run on the main thread (use a custom event to
hand work from the listener thread to the main thread).

### 3.5 Customization
- Every template/script exposes **named parameters** with types, ranges, and units. The UI turns these into
  sliders, number fields, toggles, and dropdowns automatically.
- Common add-ons for any model: embossed/engraved text, logo from an SVG, fillet radius, scale, split into
  printable parts, mounting holes, magnets (with pocket sizes for common magnet sizes).
- Natural-language edits: "make the walls thicker and add my name on the back" becomes parameter changes or a script edit.
- A **printer profile** (nozzle, layer height, fit tolerance, material) is applied to every model.

### 3.6 Printability checks
Before export:
- Watertight/manifold check and auto-repair (trimesh or Blender 3D-Print Toolbox).
- Minimum wall thickness vs. nozzle size.
- Overhang analysis, plus a suggested orientation.
- Fits the build volume (from the printer profile).
- Optional: slice with the PrusaSlicer/OrcaSlicer CLI to estimate print time and filament use.

### 3.7 Frontend
- React + TypeScript + Vite, three.js (via react-three-fiber) for the 3D viewer.
- Layout: chat panel on the left, 3D viewer in the center, spec/parameters panel on the right, and a results gallery for search.
- Show dimension sources inline ("149.6 mm, from apple.com, high confidence").
- Real-time updates over WebSocket while generation runs.

---

## 4. Architecture

```
 Browser (React + three.js)
        │  REST + WebSocket
        ▼
 FastAPI backend (Python)
   ├── Conversation service ── LLM API (tool use)
   ├── Spec schemas (pydantic)
   ├── Dimension lookup ── web search / fetch / cache (SQLite)
   ├── Model search ── Thingiverse / Printables / Cults3D / MyMiniFactory
   ├── Job queue (asyncio or RQ) ──┬── build123d worker (headless)
   │                               ├── Blender worker (headless subprocess/RPC)
   │                               ├── Fusion add-in bridge (localhost socket)
   │                               └── Text/image-to-3D API
   ├── Printability checks (trimesh, slicer CLI)
   └── Storage: SQLite (projects, specs, products) + files/ (STL, 3MF, STEP, previews)
```

---

## 5. Phased roadmap

**Phase 0: Spike (1 week)**
- Headless Blender script that builds a parametric box and exports an STL.
- build123d phone case template driven by a hard-coded iPhone dimension spec.
- Minimal Fusion add-in that receives a JSON command over localhost and extrudes a sketch.

**Phase 1: MVP (3–4 weeks)**
- FastAPI + React skeleton, 3D viewer, STL export.
- Chat → spec for 3 categories (phone case, box with lid, wall bracket).
- Clarifying questions driven by the schemas.
- Dimension lookup for phones (manufacturer specs + user confirmation).
- Parameter panel with live regeneration.

**Phase 2: Search and reuse (2 weeks)**
- Thingiverse + one or two more sources, LLM ranking, license display.
- "Use as base": import an STL into Blender and add text or mounts.

**Phase 3: AI generation (3 weeks)**
- LLM code-gen loop with sandbox + render-and-check.
- Text/image-to-3D for organic models with Blender cleanup.
- Save successful generations as reusable templates.

**Phase 4: Fusion pro mode + polish**
- Full Fusion bridge using User Parameters, STEP export, opening the result in Fusion for manual edits.
- Printability checks, slicer CLI integration, printer profiles.
- Package as a desktop app (Tauri/Electron) if wanted.

---

## 6. Risks and how to handle them

| Risk | Mitigation |
|---|---|
| LLM-written CAD code fails or makes wrong geometry | Templates first; sandbox + render-and-check retry loop; dimension assertions in code (e.g. inner width == device width + 2×tolerance) |
| Dimensions wrong or missing | Source + confidence on every number; user confirms low-confidence values; caliper fallback; print a quick test-fit slice (e.g. a 5 mm ring) before the full print |
| Fusion has no headless mode and its API is thread-sensitive | Make Fusion optional; build123d covers the same parametric needs headlessly |
| Model site APIs change or have terms limits | Adapter per source; respect terms and licenses; cache results |
| AI meshes not printable | Automatic repair + printability checks; only for non-fit-critical objects |
| Cost of AI calls | Cache lookups; use a smaller model for search ranking and a stronger one for code generation |

---

## 7. Open questions
1. Which printer and materials do you use most? (sets the default tolerances and build volume)
2. Windows or macOS? (Fusion runs on both; this affects packaging and the add-in setup)
3. Is a local-only app fine, or do you want it hosted so you can use it from your phone?
4. Which object categories matter most for the first templates?
5. Is a paid text-to-3D API OK, or prefer a self-hosted open model (needs a decent GPU)?
