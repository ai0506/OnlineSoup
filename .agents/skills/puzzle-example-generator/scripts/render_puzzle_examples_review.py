#!/usr/bin/env python3
"""Render a human-focused static review page for puzzle example preview JSON."""

from __future__ import annotations

import argparse
import html
import json
from pathlib import Path
from typing import Any


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def load_puzzles(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8-sig") as handle:
        data = json.load(handle)
    if isinstance(data, dict):
        data = [data]
    if not isinstance(data, list) or any(not isinstance(item, dict) for item in data):
        raise ValueError("Preview JSON must be a puzzle object or an array of puzzle objects.")
    return data


def render_key_points(puzzle: dict[str, Any]) -> str:
    points = puzzle.get("key_points", [])
    if not isinstance(points, list) or not points:
        return '<p class="muted">没有 key points。</p>'

    cards = []
    for index, point in enumerate(points, start=1):
        if not isinstance(point, dict):
            continue
        number = point.get("id", index)
        title = esc(point.get("text", ""))
        accepts = point.get("accept")
        tolerance = ""
        if isinstance(accepts, list) and accepts:
            def is_soi(value: Any) -> bool:
                normalized = str(value).strip().lower()
                return normalized == "seen or implied" or "soi" in normalized

            soi = any(is_soi(value) for value in accepts)
            descriptions = "".join(
                f"<li>{esc(value)}</li>" for value in accepts if not is_soi(value)
            )
            soi_note = (
                '<aside class="soi"><strong>SOI · Seen Or Implied</strong>'
                "<span>玩家明确提及、蕴含或预设该评分点时，可计为覆盖。</span></aside>"
                if soi
                else ""
            )
            tolerance_content = (
                f"<ul>{descriptions}</ul>" if descriptions else ""
            )
            tolerance = soi_note
            if tolerance_content:
                tolerance += (
                    '<aside class="tolerance"><strong>可接受的合理变体</strong>'
                    f"{tolerance_content}</aside>"
                )
        cards.append(
            '<article class="point">'
            f'<span class="point-number">{esc(number)}</span>'
            f'<div class="point-content"><h3>{title}</h3>{tolerance}</div>'
            "</article>"
        )
    return '<div class="points">' + "".join(cards) + "</div>"


def render_examples(puzzle: dict[str, Any], model: str, heading: str, description: str) -> str:
    examples = puzzle.get("examples", [])
    if not isinstance(examples, list):
        examples = []
    selected = [item for item in examples if isinstance(item, dict) and item.get("model") == model]
    cards = []
    for index, item in enumerate(selected, start=1):
        boundary = item.get("boundary_type")
        boundary_badge = f'<span class="boundary">{esc(boundary)}</span>' if boundary else ""
        cards.append(
            '<article class="example">'
            f'<div class="example-meta"><span>问题 {index}</span>{boundary_badge}</div>'
            f'<h3>{esc(item.get("question", ""))}</h3>'
            '<div class="answer"><span>答案</span>'
            f'<strong>{esc(item.get("answer", ""))}</strong></div>'
            f'<p class="reason"><strong>理由</strong>{esc(item.get("reason", ""))}</p>'
            "</article>"
        )
    if not cards:
        cards.append('<p class="muted">此类暂无示例。</p>')
    return (
        f'<section class="example-group {model}"><header class="group-heading">'
        f"<div><h2>{heading}</h2><p>{description}</p></div>"
        f'<span class="count">{len(selected)} 条</span></header>'
        f'<div class="example-list">{"".join(cards)}</div></section>'
    )


def render_puzzle(puzzle: dict[str, Any], index: int) -> str:
    examples = puzzle.get("examples", [])
    if not isinstance(examples, list):
        examples = []
    fact_count = sum(isinstance(item, dict) and item.get("model") == "fact" for item in examples)
    inferential_count = sum(isinstance(item, dict) and item.get("model") == "inferential" for item in examples)
    title = esc(puzzle.get("title", f"题目 {index}"))
    surface = esc(puzzle.get("surface", ""))
    bottom = esc(puzzle.get("bottom", ""))
    return f'''<main class="puzzle">
<header class="puzzle-header"><p class="eyebrow">题目审核</p><h1>{title}</h1>
<div class="summary"><span>事实判断 {fact_count} 条</span><span>合理推断 {inferential_count} 条</span></div></header>
<section class="story-grid"><article class="story"><h2>汤面</h2><p>{surface}</p></article>
<article class="story"><h2>汤底</h2><p>{bottom}</p></article></section>
<section class="key-points"><h2>Key points</h2>
<p class="section-note">“可接受的合理变体”是给评分使用的容错标准，只在需要放宽判定的关键点显示。</p>
{render_key_points(puzzle)}</section>
{render_examples(puzzle, "fact", "事实判断", "根据题面可直接判断的事实、矛盾或无关信息。")}
{render_examples(puzzle, "inferential", "合理推断", "从题面线索出发，主持人可以合理判断的内容。")}
</main>'''


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("preview_json", help="Preview JSON file to render")
    parser.add_argument("--output", "-o", help="HTML output path (defaults to the JSON path with .html suffix)")
    parser.add_argument("--title", help="Render only the puzzle with this exact title")
    args = parser.parse_args()

    source = Path(args.preview_json)
    output = Path(args.output) if args.output else source.with_suffix(".html")
    puzzles = load_puzzles(source)
    if len(puzzles) > 1 and not args.title:
        raise SystemExit(
            "Preview HTML is per puzzle. Pass --title to select the one puzzle being designed or reviewed."
        )
    if args.title:
        puzzles = [puzzle for puzzle in puzzles if puzzle.get("title") == args.title]
        if not puzzles:
            raise SystemExit(f"No puzzle titled {args.title!r} was found in {source}.")
    body = "\n".join(render_puzzle(puzzle, index) for index, puzzle in enumerate(puzzles, start=1))
    title = "题库示例审核" if len(puzzles) != 1 else f"《{esc(puzzles[0].get('title', '题目'))}》示例审核"
    document = f'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title><style>
:root{{--ink:#20252d;--muted:#657080;--line:#e3e8ee;--paper:#fff;--bg:#f3f5f8;--blue:#315d9b;--purple:#664b9a;--green:#21745b}}
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--ink);font:16px/1.65 -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}}
.puzzle{{max-width:980px;margin:0 auto;padding:42px 24px 72px}}.puzzle+.puzzle{{border-top:2px solid #d5dce5}}
h1,h2,h3,p{{margin-top:0}}h1{{font-size:36px;margin:0 0 12px}}h2{{font-size:23px;margin:0 0 12px}}h3{{font-size:18px;line-height:1.5;margin:0 0 14px}}.eyebrow{{font-size:12px;letter-spacing:.12em;color:var(--muted);text-transform:uppercase;margin:0 0 4px}}
.puzzle-header{{margin-bottom:24px}}.summary{{display:flex;gap:9px;flex-wrap:wrap}}.summary span,.count{{background:#e8edf3;color:#455366;border-radius:999px;padding:4px 12px;font-size:14px}}
.story-grid{{display:grid;grid-template-columns:1fr 1fr;gap:14px}}.story{{background:var(--paper);border:1px solid var(--line);border-radius:15px;padding:22px}}.story h2{{font-size:18px}}.story p{{white-space:pre-wrap;margin:0;color:#3d4857}}
.key-points,.example-group{{margin-top:38px}}.section-note,.group-heading p{{color:var(--muted);margin:0 0 14px}}.points,.example-list{{display:grid;gap:13px}}.point,.example{{background:var(--paper);border:1px solid var(--line);border-radius:14px;padding:18px 20px}}.point{{display:flex;gap:13px;align-items:flex-start}}.point-number{{display:grid;place-items:center;flex:0 0 29px;height:29px;border-radius:50%;background:#eaf0f8;color:var(--blue);font-weight:700}}.point-content{{min-width:0;flex:1}}.point-content h3{{margin:1px 0 0}}
.tolerance,.soi{{margin-top:13px;border-radius:0 8px 8px 0;padding:10px 14px}}.tolerance{{background:#fff9ec;border-left:3px solid #d0a644;color:#584b2d}}.tolerance strong,.soi strong{{display:block;font-size:14px}}.tolerance ul{{margin:5px 0 0;padding-left:20px}}.soi{{background:#eff6ff;border-left:3px solid #5483c3;color:#304d71}}.soi span{{display:block;margin-top:4px}}
.group-heading{{display:flex;align-items:center;justify-content:space-between;gap:15px;border-bottom:1px solid var(--line);padding-bottom:13px;margin-bottom:15px}}.group-heading h2{{margin-bottom:2px}}.group-heading p{{margin:0}}.example-meta{{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:12px;color:var(--muted);margin-bottom:5px}}.boundary{{background:#f2f4f7;border-radius:999px;padding:2px 8px}}.fact h3{{color:var(--blue)}}.inferential h3{{color:var(--purple)}}.answer{{display:flex;align-items:center;gap:11px;margin-bottom:10px}}.answer span{{font-size:13px;color:var(--muted)}}.answer strong{{background:#e8f3ed;color:var(--green);border-radius:7px;padding:2px 11px}}.reason{{color:#4f5967;margin:0}}.reason strong{{color:#303946;margin-right:9px}}.muted{{color:var(--muted)}}
@media(max-width:680px){{.puzzle{{padding:28px 15px 48px}}h1{{font-size:30px}}.story-grid{{grid-template-columns:1fr}}.story{{padding:18px}}.point,.example{{padding:16px}}}}
</style></head><body>{body}</body></html>'''
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(document, encoding="utf-8")
    print(output.resolve())


if __name__ == "__main__":
    main()
