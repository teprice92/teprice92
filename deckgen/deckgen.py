#!/usr/bin/env python3
"""
deckgen - generate a PowerPoint deck from a template + a JSON/YAML slide spec.

Pure Python (python-pptx). No Office, COM, Graph API or M365 permissions needed.

Commands
  deckgen.py inspect TEMPLATE.pptx [--json]
      List the template's slide layouts and their placeholders, so a human or an
      LLM agent knows which layout names / placeholder slots it can target.

  deckgen.py build SPEC.json|SPEC.yaml -t TEMPLATE.pptx -o OUT.pptx [--keep-template-slides]
      Build a deck. Spec format is documented in README.md and spec.schema.json.

  deckgen.py validate SPEC.json -t TEMPLATE.pptx
      Check a spec against a template without writing anything (good as an agent
      tool: it returns problems the LLM can fix before building).

Exit codes: 0 ok, 1 spec/template problem, 2 usage error.
"""
from __future__ import annotations

import argparse
import copy
import json
import os
import sys
from typing import Any

from pptx import Presentation
from pptx.chart.data import CategoryChartData
from pptx.enum.chart import XL_CHART_TYPE, XL_LEGEND_POSITION
from pptx.enum.shapes import PP_PLACEHOLDER
from pptx.util import Emu, Inches, Pt

# ----------------------------------------------------------------------------
# Template inspection
# ----------------------------------------------------------------------------

PH_KIND = {
    PP_PLACEHOLDER.TITLE: "title",
    PP_PLACEHOLDER.CENTER_TITLE: "title",
    PP_PLACEHOLDER.SUBTITLE: "subtitle",
    PP_PLACEHOLDER.BODY: "body",
    PP_PLACEHOLDER.OBJECT: "body",
    PP_PLACEHOLDER.PICTURE: "picture",
    PP_PLACEHOLDER.CHART: "chart",
    PP_PLACEHOLDER.TABLE: "table",
    PP_PLACEHOLDER.DATE: "footer",
    PP_PLACEHOLDER.FOOTER: "footer",
    PP_PLACEHOLDER.SLIDE_NUMBER: "footer",
}


def _kind(ph) -> str:
    try:
        return PH_KIND.get(ph.placeholder_format.type, "other")
    except Exception:
        return "other"


def describe_template(prs: Presentation) -> dict:
    layouts = []
    for i, layout in enumerate(prs.slide_layouts):
        phs = []
        for ph in layout.placeholders:
            k = _kind(ph)
            if k == "footer":
                continue
            phs.append({
                "idx": ph.placeholder_format.idx,
                "name": ph.name,
                "kind": k,
                "left_in": round(Emu(ph.left).inches, 2) if ph.left is not None else None,
                "top_in": round(Emu(ph.top).inches, 2) if ph.top is not None else None,
                "width_in": round(Emu(ph.width).inches, 2) if ph.width is not None else None,
                "height_in": round(Emu(ph.height).inches, 2) if ph.height is not None else None,
            })
        layouts.append({"index": i, "name": layout.name, "placeholders": phs})
    return {
        "slide_width_in": round(Emu(prs.slide_width).inches, 2),
        "slide_height_in": round(Emu(prs.slide_height).inches, 2),
        "existing_slides": len(prs.slides),
        "layouts": layouts,
    }


def print_template(info: dict) -> None:
    print(f"Slide size: {info['slide_width_in']} x {info['slide_height_in']} in; "
          f"{info['existing_slides']} existing slide(s)\n")
    for L in info["layouts"]:
        print(f"[{L['index']}] {L['name']}")
        if not L["placeholders"]:
            print("      (no content placeholders)")
        for p in L["placeholders"]:
            print(f"      idx={p['idx']:<3} {p['kind']:<9} '{p['name']}'  "
                  f"@({p['left_in']},{p['top_in']}) {p['width_in']}x{p['height_in']} in")
    print()


# ----------------------------------------------------------------------------
# Spec loading
# ----------------------------------------------------------------------------

def load_spec(path: str) -> dict:
    with open(path, "r", encoding="utf-8") as f:
        text = f.read()
    if path.lower().endswith((".yaml", ".yml")):
        try:
            import yaml  # optional dependency
        except ImportError:
            raise SystemExit("YAML spec needs PyYAML: pip install pyyaml (or use JSON)")
        spec = yaml.safe_load(text)
    else:
        spec = json.loads(text)
    if isinstance(spec, list):
        spec = {"slides": spec}
    if not isinstance(spec, dict) or not isinstance(spec.get("slides"), list):
        raise SpecError("Spec must be an object with a 'slides' list (or a bare list of slides).")
    return spec


class SpecError(Exception):
    pass


# ----------------------------------------------------------------------------
# Layout + placeholder resolution
# ----------------------------------------------------------------------------

def find_layout(prs: Presentation, ref: Any, defaults: dict):
    if ref is None:
        ref = defaults.get("layout")
    layouts = list(prs.slide_layouts)
    if ref is None:
        # sensible default: first layout with a title + body
        for L in layouts:
            kinds = {_kind(p) for p in L.placeholders}
            if "title" in kinds and "body" in kinds:
                return L
        return layouts[min(1, len(layouts) - 1)]
    if isinstance(ref, int):
        if 0 <= ref < len(layouts):
            return layouts[ref]
        raise SpecError(f"Layout index {ref} out of range (0..{len(layouts)-1}).")
    want = str(ref).strip().lower()
    for L in layouts:
        if L.name.strip().lower() == want:
            return L
    for L in layouts:  # loose match
        if want in L.name.strip().lower():
            return L
    names = ", ".join(f"'{L.name}'" for L in layouts)
    raise SpecError(f"No layout named '{ref}'. Available: {names}")


def placeholders_by_kind(slide) -> dict[str, list]:
    out: dict[str, list] = {}
    for ph in sorted(slide.placeholders, key=lambda p: (p.top or 0, p.left or 0)):
        out.setdefault(_kind(ph), []).append(ph)
    return out


def get_placeholder(slide, idx: int):
    for ph in slide.placeholders:
        if ph.placeholder_format.idx == idx:
            return ph
    return None


# ----------------------------------------------------------------------------
# Content writers
# ----------------------------------------------------------------------------

def _apply_run_style(run, style: dict | None):
    if not style:
        return
    f = run.font
    if "bold" in style:
        f.bold = bool(style["bold"])
    if "italic" in style:
        f.italic = bool(style["italic"])
    if "size" in style:
        f.size = Pt(float(style["size"]))
    if "color" in style:
        from pptx.dml.color import RGBColor
        f.color.rgb = RGBColor.from_string(str(style["color"]).lstrip("#"))


def _add_paragraph_text(p, item):
    """item: str | {"text":..., "bold":..., "runs":[...]}"""
    if isinstance(item, str):
        p.text = item
        return
    runs = item.get("runs")
    if runs:
        for r in runs:
            run = p.add_run()
            if isinstance(r, str):
                run.text = r
            else:
                run.text = str(r.get("text", ""))
                _apply_run_style(run, r)
    else:
        run = p.add_run()
        run.text = str(item.get("text", ""))
        _apply_run_style(run, item)


def flatten_bullets(items, level=0):
    """Accept nested lists or {"text":..., "children":[...]} -> [(level, item)]"""
    out = []
    for it in items or []:
        if isinstance(it, list):
            out.extend(flatten_bullets(it, level + 1))
        elif isinstance(it, dict) and "children" in it:
            out.append((min(level, 8), {k: v for k, v in it.items() if k != "children"}))
            out.extend(flatten_bullets(it["children"], level + 1))
        else:
            out.append((min(level, 8), it))
    return out


def write_text(shape, content, font_size=None):
    """content: str | list (bullets) | {"bullets": [...]} | {"text": ...}"""
    tf = shape.text_frame
    tf.clear()
    if isinstance(content, dict) and "bullets" in content:
        content = content["bullets"]
    if isinstance(content, list):
        pairs = flatten_bullets(content)
    else:
        pairs = [(0, line) for line in str(content if not isinstance(content, dict)
                                            else content.get("text", "")).split("\n")]
    first = True
    for level, item in pairs:
        p = tf.paragraphs[0] if first else tf.add_paragraph()
        first = False
        p.level = level
        _add_paragraph_text(p, item)
        if font_size:
            for r in p.runs:
                if r.font.size is None:
                    r.font.size = Pt(font_size)


def _box(spec_box, slide_w, slide_h, fallback):
    """Resolve a {"left","top","width","height"} box in inches (or fractions <=1)."""
    if not spec_box:
        return fallback

    def conv(v, total):
        # numbers are inches; strings like "50%" are a fraction of the slide size
        if isinstance(v, str) and v.strip().endswith("%"):
            return Emu(int(float(v.strip()[:-1]) / 100 * total))
        return Emu(int(Inches(float(v))))

    return (conv(spec_box.get("left", 0.5), slide_w), conv(spec_box.get("top", 1.5), slide_h),
            conv(spec_box.get("width", 9), slide_w), conv(spec_box.get("height", 5), slide_h))


def _target_area(slide, ph, prs, box):
    """Return (left, top, width, height) for a graphic: explicit box > placeholder > body area."""
    if box:
        return _box(box, prs.slide_width, prs.slide_height, None)
    w, h = prs.slide_width, prs.slide_height
    if ph is not None and ph.width and ph.height:
        return ph.left, ph.top, ph.width, ph.height
    return int(w * 0.06), int(h * 0.22), int(w * 0.88), int(h * 0.70)


def _remove_shape(shape):
    el = shape._element
    el.getparent().remove(el)


def add_table(slide, prs, data: dict, ph=None):
    rows = data.get("rows") or []
    header = data.get("header")
    all_rows = ([header] if header else []) + rows
    if not all_rows:
        raise SpecError("table needs 'header' and/or 'rows'")
    ncols = max(len(r) for r in all_rows)
    left, top, width, height = _target_area(slide, ph, prs, data.get("box"))
    row_h = Inches(float(data.get("row_height_in", 0.4)))
    height = min(height, row_h * len(all_rows))
    if ph is not None and _kind(ph) == "table":
        gf = ph.insert_table(len(all_rows), ncols)
        table = gf.table
    else:
        if ph is not None:
            _remove_shape(ph)
        gf = slide.shapes.add_table(len(all_rows), ncols, left, top, width, height)
        table = gf.table
    fs = data.get("font_size", 12)
    for r_i, row in enumerate(all_rows):
        for c_i in range(ncols):
            val = row[c_i] if c_i < len(row) else ""
            cell = table.cell(r_i, c_i)
            cell.text = "" if val is None else str(val)
            for p in cell.text_frame.paragraphs:
                for run in p.runs:
                    run.font.size = Pt(fs)
                    if header and r_i == 0:
                        run.font.bold = True
    if data.get("col_widths_in"):
        for i, w in enumerate(data["col_widths_in"][:ncols]):
            table.columns[i].width = Inches(float(w))
    return gf


CHART_TYPES = {
    "bar": XL_CHART_TYPE.BAR_CLUSTERED,
    "column": XL_CHART_TYPE.COLUMN_CLUSTERED,
    "stacked_column": XL_CHART_TYPE.COLUMN_STACKED,
    "stacked_bar": XL_CHART_TYPE.BAR_STACKED,
    "line": XL_CHART_TYPE.LINE_MARKERS,
    "line_plain": XL_CHART_TYPE.LINE,
    "pie": XL_CHART_TYPE.PIE,
    "doughnut": XL_CHART_TYPE.DOUGHNUT,
    "area": XL_CHART_TYPE.AREA,
}


def add_chart(slide, prs, data: dict, ph=None):
    ctype = str(data.get("type", "column")).lower()
    if ctype not in CHART_TYPES:
        raise SpecError(f"chart type '{ctype}' not supported. Use one of: {', '.join(CHART_TYPES)}")
    cats = data.get("categories")
    series = data.get("series")
    if not cats or not series:
        raise SpecError("chart needs 'categories' and 'series'")
    cd = CategoryChartData()
    cd.categories = [str(c) for c in cats]
    if isinstance(series, dict):  # {"Revenue": [..], "Cost": [..]}
        series = [{"name": k, "values": v} for k, v in series.items()]
    for s in series:
        vals = s["values"]
        if len(vals) != len(cats):
            raise SpecError(f"series '{s.get('name')}' has {len(vals)} values for {len(cats)} categories")
        cd.add_series(str(s.get("name", "")), [None if v is None else float(v) for v in vals])
    left, top, width, height = _target_area(slide, ph, prs, data.get("box"))
    if ph is not None and _kind(ph) == "chart":
        gf = ph.insert_chart(CHART_TYPES[ctype], cd)
    else:
        if ph is not None:
            _remove_shape(ph)
        gf = slide.shapes.add_chart(CHART_TYPES[ctype], left, top, width, height, cd)
    chart = gf.chart
    multi = len(series) > 1 or ctype in ("pie", "doughnut")
    chart.has_legend = bool(data.get("legend", multi))
    if chart.has_legend:
        chart.legend.position = XL_LEGEND_POSITION.BOTTOM
        chart.legend.include_in_layout = False
    if data.get("data_labels"):
        plot = chart.plots[0]
        plot.has_data_labels = True
        if data.get("number_format"):
            plot.data_labels.number_format = data["number_format"]
            plot.data_labels.number_format_is_linked = False
    if data.get("title"):
        chart.has_title = True
        chart.chart_title.text_frame.text = str(data["title"])
    else:
        chart.has_title = False
    return gf


def resolve_image(data, base_dir):
    """Return a file-like object for an image given as:
       "path.png" | {"path": ...} | {"url": "https://..."} | {"base64": "...", } | {"data_uri": "data:image/png;base64,..."}
    """
    import base64
    import io
    if isinstance(data, str):
        data = {"url": data} if data.startswith(("http://", "https://")) else \
               {"data_uri": data} if data.startswith("data:") else {"path": data}
    if "path" in data:
        path = data["path"]
        if not os.path.isabs(path):
            path = os.path.join(base_dir, path)
        if not os.path.exists(path):
            raise SpecError(f"image not found: {path}")
        with open(path, "rb") as f:
            return io.BytesIO(f.read())
    if "base64" in data or "data_uri" in data:
        raw = data.get("base64") or data["data_uri"].split(",", 1)[-1]
        try:
            return io.BytesIO(base64.b64decode(raw))
        except Exception as e:
            raise SpecError(f"bad base64 image data: {e}")
    if "url" in data:
        import urllib.request
        try:
            req = urllib.request.Request(data["url"], headers={"User-Agent": "deckgen"})
            with urllib.request.urlopen(req, timeout=float(data.get("timeout", 20))) as r:
                return io.BytesIO(r.read())
        except Exception as e:
            raise SpecError(f"could not fetch image {data['url']}: {e}")
    raise SpecError("image needs one of: path, url, base64, data_uri")


def _image_size(stream):
    from PIL import Image
    stream.seek(0)
    with Image.open(stream) as im:
        size = im.size
    stream.seek(0)
    return size


def _fit_picture(slide, stream, left, top, width, height, mode="contain"):
    """contain = whole image visible, centered; cover = fill area, cropped."""
    if not width or not height or width <= 0 or height <= 0:
        raise SpecError("target area for image has zero size (check the layout or pass a 'box')")
    iw, ih = _image_size(stream)
    if mode == "cover":
        pic = slide.shapes.add_picture(stream, left, top, width, height)
        area_r, img_r = width / height, iw / ih
        if img_r > area_r:      # too wide -> crop sides
            c = (1 - area_r / img_r) / 2
            pic.crop_left = pic.crop_right = c
        else:                   # too tall -> crop top/bottom
            c = (1 - img_r / area_r) / 2
            pic.crop_top = pic.crop_bottom = c
        return pic
    scale = min(width / iw, height / ih)
    w, h = int(iw * scale), int(ih * scale)
    return slide.shapes.add_picture(stream, left + (width - w) // 2, top + (height - h) // 2, w, h)


def _add_caption(slide, text, left, top, width):
    tb = slide.shapes.add_textbox(left, top, width, Inches(0.35))
    tb.text_frame.word_wrap = True
    p = tb.text_frame.paragraphs[0]
    p.text = str(text)
    from pptx.enum.text import PP_ALIGN
    p.alignment = PP_ALIGN.CENTER
    for r in p.runs:
        r.font.size = Pt(11)
        r.font.italic = True


def add_image(slide, prs, data, base_dir, ph=None):
    if isinstance(data, str):
        data = {"src": data}
    src = data.get("src", data)
    stream = resolve_image(src if isinstance(src, str) else data, base_dir)
    mode = data.get("fit", "contain") if isinstance(data, dict) else "contain"
    caption = data.get("caption") if isinstance(data, dict) else None
    if ph is not None and _kind(ph) == "picture" and not caption and not data.get("box"):
        return ph.insert_picture(stream)  # template picture placeholders crop-to-fill
    left, top, width, height = _target_area(slide, ph, prs, data.get("box"))
    if ph is not None:
        _remove_shape(ph)
    if caption:
        height -= Inches(0.4)
    pic = _fit_picture(slide, stream, left, top, width, height, mode)
    if caption:
        _add_caption(slide, caption, left, pic.top + pic.height + Inches(0.05), width)
    return pic


def add_images(slide, prs, data, base_dir, ph=None):
    """Grid of images: {"items": [img, img, ...], "columns": 2, "gap_in": 0.2, "fit": "contain"}
    or just a list of images."""
    if isinstance(data, list):
        data = {"items": data}
    items = data.get("items") or []
    if not items:
        raise SpecError("images needs at least one item")
    import math
    cols = int(data.get("columns") or min(len(items), 3))
    rows = math.ceil(len(items) / cols)
    left, top, width, height = _target_area(slide, ph, prs, data.get("box"))
    if ph is not None:
        _remove_shape(ph)
    gap = Inches(float(data.get("gap_in", 0.2)))
    cw = int((width - gap * (cols - 1)) / cols)
    ch = int((height - gap * (rows - 1)) / rows)
    for i, it in enumerate(items):
        r, c = divmod(i, cols)
        it = {"src": it} if isinstance(it, str) else dict(it)
        it.setdefault("fit", data.get("fit", "contain"))
        it["box"] = None
        cell_l, cell_t = left + c * (cw + gap), top + r * (ch + gap)
        stream = resolve_image(it.get("src", it) if isinstance(it.get("src"), str) else it, base_dir)
        h = ch - (Inches(0.4) if it.get("caption") else 0)
        pic = _fit_picture(slide, stream, cell_l, cell_t, cw, h, it["fit"])
        if it.get("caption"):
            _add_caption(slide, it["caption"], cell_l, pic.top + pic.height + Inches(0.05), cw)


# ----------------------------------------------------------------------------
# Slide building
# ----------------------------------------------------------------------------

GRAPHIC_KEYS = ("table", "chart", "image", "images")


def build_slide(prs, sdef: dict, defaults: dict, base_dir: str, warnings: list, n: int):
    layout = find_layout(prs, sdef.get("layout"), defaults)
    slide = prs.slides.add_slide(layout)
    used = set()
    kinds = placeholders_by_kind(slide)

    def take(kind):
        for ph in kinds.get(kind, []):
            if ph.placeholder_format.idx not in used:
                used.add(ph.placeholder_format.idx)
                return ph
        return None

    # 1. explicit placeholder overrides: {"placeholders": {"13": "text", "14": {"chart":...}}}
    for key, val in (sdef.get("placeholders") or {}).items():
        ph = get_placeholder(slide, int(key))
        if ph is None:
            warnings.append(f"slide {n}: layout '{layout.name}' has no placeholder idx={key}")
            continue
        used.add(ph.placeholder_format.idx)
        if isinstance(val, dict) and any(k in val for k in GRAPHIC_KEYS):
            _place_graphic(slide, prs, val, base_dir, ph)
        else:
            write_text(ph, val, sdef.get("font_size"))

    # 2. title / subtitle
    if sdef.get("title") is not None:
        ph = take("title")
        if ph is not None:
            write_text(ph, sdef["title"])
        else:
            warnings.append(f"slide {n}: layout '{layout.name}' has no title placeholder; title added as textbox")
            tb = slide.shapes.add_textbox(Inches(0.5), Inches(0.3), prs.slide_width - Inches(1), Inches(0.9))
            write_text(tb, sdef["title"], 28)
    if sdef.get("subtitle") is not None:
        ph = take("subtitle") or take("body")
        if ph is not None:
            write_text(ph, sdef["subtitle"])
        else:
            warnings.append(f"slide {n}: no subtitle/body placeholder for 'subtitle'")

    # 3. body content: "body" (str/list) or "columns" [left, right] for two-content layouts
    bodies = []
    if "columns" in sdef:
        bodies = list(sdef["columns"])
    elif "body" in sdef or "bullets" in sdef:
        bodies = [sdef.get("body", sdef.get("bullets"))]

    graphic = next((k for k in GRAPHIC_KEYS if k in sdef), None)
    last_text_shape = None
    for content in bodies:
        if isinstance(content, dict) and any(k in content for k in GRAPHIC_KEYS):
            ph = take("body") or take("chart") or take("table") or take("picture")
            _place_graphic(slide, prs, content, base_dir, ph)
            continue
        ph = take("body")
        if ph is None:
            warnings.append(f"slide {n}: not enough body placeholders in '{layout.name}'; text added as textbox")
            ph = slide.shapes.add_textbox(*_box(sdef.get("body_box"), prs.slide_width, prs.slide_height,
                                               (Inches(0.6), Inches(1.6), prs.slide_width - Inches(1.2),
                                                prs.slide_height - Inches(2.2))))
            ph.text_frame.word_wrap = True
        write_text(ph, content, sdef.get("font_size"))
        last_text_shape = ph

    # 4. single graphic at slide level: chart / table / image / images
    if graphic:
        gval = sdef[graphic]
        ph = (take({"chart": "chart", "table": "table", "image": "picture", "images": "picture"}[graphic])
              or take("body") or take("picture"))
        explicit_box = isinstance(gval, dict) and gval.get("box")
        if ph is None and last_text_shape is not None and not explicit_box:
            # Text + graphic but only one content area: split it. Text keeps one side,
            # graphic gets the other ("graphic_side": "right" | "left", default right).
            ts = last_text_shape
            l, t, w, h = ts.left, ts.top, ts.width, ts.height
            gap = Inches(0.3)
            half = int((w - gap) / 2)
            side = sdef.get("graphic_side", "right")
            gl = l + half + gap if side == "right" else l
            ts.left, ts.top, ts.width, ts.height = (l if side == "right" else l + half + gap), t, half, h
            gbox = {"left": Emu(gl).inches, "top": Emu(t).inches,
                    "width": Emu(half).inches, "height": Emu(h).inches}
            gval = {"src": gval} if isinstance(gval, str) else \
                   {"items": gval} if isinstance(gval, list) else dict(gval)
            gval["box"] = gbox
        _place_graphic(slide, prs, {graphic: gval}, base_dir, ph)

    # 5. speaker notes
    if sdef.get("notes"):
        slide.notes_slide.notes_text_frame.text = str(sdef["notes"])

    # 6. remove empty placeholders so "Click to add text" never shows
    if sdef.get("remove_empty_placeholders", defaults.get("remove_empty_placeholders", True)):
        for ph in list(slide.placeholders):
            if ph.placeholder_format.idx in used:
                continue
            if _kind(ph) == "footer":
                continue
            if not (ph.has_text_frame and ph.text_frame.text.strip()):
                _remove_shape(ph)
    return slide


def _place_graphic(slide, prs, val: dict, base_dir, ph):
    if "chart" in val:
        add_chart(slide, prs, val["chart"], ph)
    elif "table" in val:
        add_table(slide, prs, val["table"], ph)
    elif "images" in val:
        add_images(slide, prs, val["images"], base_dir, ph)
    elif "image" in val:
        add_image(slide, prs, val["image"], base_dir, ph)


def delete_all_slides(prs):
    sldIdLst = prs.slides._sldIdLst
    for sldId in list(sldIdLst):
        rId = sldId.rId
        prs.part.drop_rel(rId)
        sldIdLst.remove(sldId)


def build(spec: dict, template: str, out: str, keep_existing=False, base_dir=".", dry_run=False):
    prs = Presentation(template)
    defaults = spec.get("defaults", {}) or {}
    if not keep_existing and not spec.get("keep_template_slides", False):
        delete_all_slides(prs)
    warnings, errors = [], []
    for i, sdef in enumerate(spec["slides"], 1):
        if not isinstance(sdef, dict):
            errors.append(f"slide {i}: must be an object")
            continue
        try:
            build_slide(prs, sdef, defaults, base_dir, warnings, i)
        except SpecError as e:
            errors.append(f"slide {i}: {e}")
        except Exception as e:  # keep going, report everything at once
            errors.append(f"slide {i}: {type(e).__name__}: {e}")
    if spec.get("properties"):
        cp = prs.core_properties
        for k, v in spec["properties"].items():
            if hasattr(cp, k):
                setattr(cp, k, v)
    if not dry_run and not errors:
        os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
        prs.save(out)
    return {"ok": not errors, "output": None if (dry_run or errors) else os.path.abspath(out),
            "slides": len(spec["slides"]), "errors": errors, "warnings": warnings}


# ----------------------------------------------------------------------------
# CLI
# ----------------------------------------------------------------------------

def main(argv=None):
    ap = argparse.ArgumentParser(prog="deckgen", description=__doc__,
                                 formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)

    a = sub.add_parser("inspect", help="list template layouts and placeholders")
    a.add_argument("template")
    a.add_argument("--json", action="store_true", help="machine-readable output for agents")

    b = sub.add_parser("build", help="build a deck from a spec")
    b.add_argument("spec")
    b.add_argument("-t", "--template", required=True)
    b.add_argument("-o", "--output", required=True)
    b.add_argument("--keep-template-slides", action="store_true",
                   help="keep slides already in the template (default: start empty)")

    v = sub.add_parser("validate", help="check a spec against a template without writing")
    v.add_argument("spec")
    v.add_argument("-t", "--template", required=True)

    args = ap.parse_args(argv)

    if args.cmd == "inspect":
        info = describe_template(Presentation(args.template))
        if args.json:
            print(json.dumps(info, indent=2))
        else:
            print_template(info)
        return 0

    try:
        spec = load_spec(args.spec)
    except (SpecError, json.JSONDecodeError) as e:
        print(json.dumps({"ok": False, "errors": [f"spec: {e}"], "warnings": []}, indent=2))
        return 1
    base_dir = os.path.dirname(os.path.abspath(args.spec))
    if args.cmd == "validate":
        res = build(spec, args.template, "", base_dir=base_dir, dry_run=True)
    else:
        res = build(spec, args.template, args.output, args.keep_template_slides, base_dir)
    print(json.dumps(res, indent=2))
    return 0 if res["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
