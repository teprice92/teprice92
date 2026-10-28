# deckgen

Generate PowerPoint decks from your own `.pptx` template plus a JSON (or YAML) spec.
It's pure Python on [python-pptx](https://python-pptx.readthedocs.io), so it needs no Office install, COM, Graph API or M365 permissions.
It runs on Windows, macOS or Linux, including a locked-down work laptop or a server.

## Install

```bash
pip install python-pptx pillow        # pyyaml too, if you want YAML specs
```

## Three commands

```bash
# 1. See what your template offers (layout names + placeholder slots)
python deckgen.py inspect corp_template.pptx
python deckgen.py inspect corp_template.pptx --json   # feed this to the LLM

# 2. Check a spec without writing anything
python deckgen.py validate spec.json -t corp_template.pptx

# 3. Build
python deckgen.py build spec.json -t corp_template.pptx -o weekly.pptx
```

`build` and `validate` always print JSON: `{"ok", "output", "errors", "warnings"}`.
The exit code is 0 on success and 1 on any error.
All slides are checked in one pass, so the agent sees every problem at once.

By default the template's existing slides are dropped and only its theme, master and layouts are kept.
Pass `--keep-template-slides` (or `"keep_template_slides": true`) to append after them instead.

## Spec format

Formal schema: `spec.schema.json`. Full worked example: `examples/example_spec.json`.

```json
{
  "slides": [
    {"layout": "Title Slide", "title": "Ops Weekly Review", "subtitle": "Week 43"},

    {"layout": "Title and Content", "title": "Highlights",
     "body": ["Uptime 99.97%",
              {"text": "Backlog down 18%", "bold": true},
              ["Tier 1: 42 → 31", "Tier 2: 17 → 15"]],
     "notes": "Speaker notes go here"},

    {"layout": "Title and Content", "title": "Volume",
     "chart": {"type": "column", "categories": ["W40","W41","W42"],
               "series": {"Opened": [120,135,110], "Closed": [115,140,125]},
               "data_labels": true}},

    {"layout": "Two Content", "title": "Side by side",
     "columns": [ ["left bullets"], {"table": {"header": ["A","B"], "rows": [[1,2]]}} ]}
  ]
}
```

| Field | What it does |
|---|---|
| `layout` | Layout name from `inspect` (exact, then substring match) or index. |
| `title`, `subtitle` | Go into the layout's title and subtitle placeholders. |
| `body` / `bullets` | A string (use `\n` for paragraphs) or a list. A nested list makes sub-bullets. Items can be `{"text","bold","italic","size","color"}`. |
| `columns` | One entry per content placeholder, left to right. Each entry is text or `{chart\|table\|image\|images}`. |
| `chart` | Types: `column`, `bar`, `stacked_column`, `stacked_bar`, `line`, `line_plain`, `pie`, `doughnut`, `area`. These are native, editable PowerPoint charts. |
| `table` | `header` plus `rows`; optional `font_size`, `col_widths_in`. |
| `image` / `images` | See below. |
| `placeholders` | Escape hatch for custom templates: `{"13": "text"}` or `{"14": {"chart": ...}}`, keyed by the `idx` shown in `inspect`. |
| `notes` | Speaker notes. |
| `box` | On any graphic: `{"left","top","width","height"}` in inches, or `"50%"`-style fractions of the slide size. |

Unused placeholders are removed, so no "Click to add text" is left behind.
Set `"remove_empty_placeholders": false` to keep them.

## Images

An image can be any of these:

```json
"image": "charts/latency.png"                              // path, relative to the spec file
"image": "https://intranet/grafana/render/d/abc.png"       // URL
"image": "data:image/png;base64,iVBOR..."                  // data URI
"image": {"base64": "iVBOR...", "fit": "cover", "caption": "Last 7 days"}
"image": {"path": "x.png", "box": {"left": 7, "top": 1.7, "width": 5.6, "height": 4.5}}
```

* `fit: "contain"` (the default) shows the whole image, centred. `fit: "cover"` fills the area and crops the overflow.
* `caption` adds a small centred caption under the image.
* **Text plus an image on a one-content layout:** bullets take the left half and the image takes the right. Set `"graphic_side": "left"` to flip them.
* **A picture placeholder in the template** is filled directly, using the template's own crop and frame.
* **Several images:** `"images": {"columns": 3, "items": [img, img, img]}` lays them out as a grid. Each item takes the same forms as `image` above, and can have its own caption.

URLs are fetched with Python's standard library.
If an intranet source needs authentication, have the agent download the file first and pass a path or base64 instead.

## Using it in an agentic workflow

1. Run `deckgen inspect template.pptx --json` once and put the result in the agent's system prompt or tool description, so it only uses layouts that exist.
2. Give the agent `spec.schema.json` as its structured-output or tool schema.
3. The agent gathers the metrics and screenshots, saves images to a working folder (or inlines them as base64), and writes `spec.json`.
4. Run `deckgen validate`. If `ok` is false, hand the `errors` back to the LLM and let it fix the spec.
5. Run `deckgen build`. It's deterministic: the same spec always produces the same deck.

You can also import it as a library:

```python
from deckgen import build
result = build(spec_dict, "template.pptx", "out.pptx", base_dir="./work")
```

Tip for computed charts (trend lines, annotations, anything native charts can't do): have the agent render a PNG with matplotlib and pass it as an `image`.

## Limits

* No animations or transitions. It won't produce SmartArt, but template SmartArt on kept slides survives.
* Text doesn't auto-shrink when it overflows. Keep bullets short, or set `font_size` per slide.
* Charts and tables use the template theme's colours.
