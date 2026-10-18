#!/usr/bin/env python3
"""Validate complete OnlineSoup puzzle previews, examples and canonical Facts."""

from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
from collections import Counter
from pathlib import Path
from typing import Any


ANSWERS = {"是", "否", "与此无关", "模糊问题"}
MODELS = {"fact", "inferential"}
DIFFICULTIES = {"简单", "中等", "困难", "抽象"}
BOUNDARY_TYPES = {
    "explicit_fact",
    "direct_contradiction",
    "single_step_implication",
    "irrelevant_detail",
    "ambiguous_reference",
    "subjective_evaluation",
    "identity_inference",
    "motive_inference",
    "causal_inference",
    "wordplay_inference",
}
ALIASES = {
    "海難": "海难",
    "船难": "海难",
    "遇难": "海难",
    "漂流": "海难",
    "自尽": "自杀",
    "轻生": "自杀",
    "去世": "死亡",
    "死了": "死亡",
    "身亡": "死亡",
}
QUESTION_FILLERS = {
    "吗",
    "么",
    "是不是",
    "是否",
    "有没有",
    "有无",
    "曾经",
    "之前",
    "真的",
    "遭遇",
    "经历",
    "遇到",
    "碰到",
    "发生",
    "可以",
    "能够",
    "一个",
    "这个",
    "那个",
    "男人",
    "女人",
    "男孩",
    "女孩",
    "他",
    "她",
    "它",
}


def normalize_text(value: str) -> str:
    value = value.lower()
    for source, target in ALIASES.items():
        value = value.replace(source, target)
    value = re.sub(r"\s+", "", value)
    value = re.sub(r"[？?。.!！,，、；;：:「」『』“”\"'（）()\[\]【】]", "", value)
    for filler in sorted(QUESTION_FILLERS, key=len, reverse=True):
        value = value.replace(filler, "")
    return value


def char_ngrams(value: str, size: int = 2) -> set[str]:
    value = normalize_text(value)
    if len(value) <= size:
        return {value} if value else set()
    return {value[index : index + size] for index in range(len(value) - size + 1)}


def similarity(left: str, right: str) -> float:
    left_set = char_ngrams(left)
    right_set = char_ngrams(right)
    if not left_set or not right_set:
        return 0.0
    return len(left_set & right_set) / len(left_set | right_set)


def load_json(path: Path) -> Any:
    with path.open("r", encoding="utf-8-sig") as handle:
        return json.load(handle)


def key_point_phrases(item: dict[str, Any]) -> list[str]:
    phrases: list[str] = []
    key_points = item.get("key_points", [])
    if not isinstance(key_points, list):
        return phrases

    for point in key_points:
        if not isinstance(point, dict):
            continue
        text = point.get("text")
        if isinstance(text, str) and text.strip():
            phrases.append(text)
        accepts = point.get("accept", [])
        if isinstance(accepts, list):
            phrases.extend(value for value in accepts if isinstance(value, str) and value.strip())
    return phrases


def looks_like_key_point_restatement(question: str, phrases: list[str]) -> bool:
    normalized_question = normalize_text(question)
    for phrase in phrases:
        normalized_phrase = normalize_text(phrase)
        if len(normalized_phrase) >= 2 and normalized_phrase in normalized_question:
            return True
        if similarity(question, phrase) >= 0.62:
            return True
    return False


def validate_puzzle(
    item: Any,
    index: int,
    require_boundary_type: bool,
    duplicate_threshold: float,
    complete: bool = True,
    require_evidence_ids: bool = True,
) -> tuple[list[str], list[str], Counter[str], Counter[str]]:
    errors: list[str] = []
    warnings: list[str] = []
    model_counts: Counter[str] = Counter()
    boundary_counts: Counter[str] = Counter()

    if not isinstance(item, dict):
        return [f"[{index}] puzzle must be an object"], warnings, model_counts, boundary_counts

    title = item.get("title")
    label = title if isinstance(title, str) and title.strip() else f"#{index + 1}"

    for field in ("title", "surface", "bottom", "difficulty"):
        if not isinstance(item.get(field), str) or not item[field].strip():
            errors.append(f"[{label}] missing or invalid `{field}`")

    for field, minimum, maximum in (("title", 1, 60), ("surface", 5, 1000), ("bottom", 5, 2000)):
        value = item.get(field)
        if isinstance(value, str):
            # Zod/JavaScript length uses UTF-16 code units, including emoji.
            length = len(value.strip().encode("utf-16-le", errors="surrogatepass")) // 2
            if not minimum <= length <= maximum:
                errors.append(f"[{label}] `{field}` length must be {minimum}–{maximum}")
    if complete and "is_active" not in item:
        errors.append(f"[{label}] missing `is_active`")
    if "is_active" in item and not isinstance(item["is_active"], bool):
        errors.append(f"[{label}] `is_active` must be a boolean")

    if isinstance(item.get("difficulty"), str) and item["difficulty"] not in DIFFICULTIES:
        errors.append(f"[{label}] invalid difficulty: {item['difficulty']}")

    if "points" in item and "key_points" not in item:
        errors.append(f"[{label}] uses legacy `points`; preview should normalize to `key_points`")

    key_points = item.get("key_points", [])
    if not isinstance(key_points, list):
        errors.append(f"[{label}] `key_points` must be an array")
    else:
        if complete and not key_points:
            errors.append(f"[{label}] complete puzzle needs at least one key point")
        point_ids: set[int] = set()
        for point_index, point in enumerate(key_points):
            prefix = f"[{label} key_points[{point_index}]]"
            if not isinstance(point, dict):
                errors.append(f"{prefix} must be an object")
                continue
            point_id = point.get("id")
            if type(point_id) is not int or point_id < 1:
                errors.append(f"{prefix} id must be a positive integer")
            elif point_id in point_ids:
                errors.append(f"{prefix} duplicate id: {point_id}")
            else:
                point_ids.add(point_id)
            if not isinstance(point.get("text"), str) or not point["text"].strip():
                errors.append(f"{prefix} missing text")
            accepts = point.get("accept", [])
            if not isinstance(accepts, list) or any(not isinstance(value, str) for value in accepts):
                errors.append(f"{prefix} accept must be an array of strings")

    facts = item.get("facts")
    if complete and (not isinstance(facts, list) or not facts):
        errors.append(f"[{label}] complete puzzle needs a non-empty `facts` array")
    elif not facts:
        warnings.append(f"[{label}] no Facts; runtime can use source quotes, but evidence coverage is incomplete")
    fact_ids = {
        fact["id"] for fact in (facts if isinstance(facts, list) else [])
        if isinstance(fact, dict) and isinstance(fact.get("id"), str)
    }
    for fact in facts if isinstance(facts, list) else []:
        if isinstance(fact, dict) and fact.get("kind") == "derived":
            if not isinstance(fact.get("note"), str) or not fact["note"].strip():
                warnings.append(f"[{label}] {fact.get('id')}: derived Fact needs a review note explaining its inference")

    for field in ("id", "content_version"):
        if field in item and (type(item[field]) is not int or item[field] < 1):
            errors.append(f"[{label}] optional source metadata `{field}` must be a positive integer")

    examples = item.get("examples", [])
    if not isinstance(examples, list):
        errors.append(f"[{label}] `examples` must be an array")
        return errors, warnings, model_counts, boundary_counts
    if complete and not examples:
        errors.append(f"[{label}] complete puzzle needs non-empty `examples`")
    if len(examples) > 20:
        warnings.append(f"[{label}] v2 A reads only the first 20 examples")

    phrases = key_point_phrases(item)
    questions: list[tuple[int, str, str]] = []
    restatement_count = 0

    for example_index, example in enumerate(examples):
        prefix = f"[{label} examples[{example_index}]]"
        if not isinstance(example, dict):
            errors.append(f"{prefix} must be an object")
            continue

        model = example.get("model", "fact")
        answer = example.get("answer")
        boundary_type = example.get("boundary_type")
        question = example.get("question")
        reason = example.get("reason", "")

        if not isinstance(model, str) or model not in MODELS:
            errors.append(f"{prefix} invalid model: {model}")
        else:
            model_counts[model] += 1

        if require_boundary_type or boundary_type is not None:
            if not isinstance(boundary_type, str) or boundary_type not in BOUNDARY_TYPES:
                errors.append(f"{prefix} invalid or missing boundary_type: {boundary_type}")
            else:
                boundary_counts[boundary_type] += 1

        if not isinstance(question, str) or not question.strip():
            errors.append(f"{prefix} missing question")
        else:
            normalized = normalize_text(question)
            questions.append((example_index, model if isinstance(model, str) else "", question))
            if looks_like_key_point_restatement(question, phrases):
                restatement_count += 1
                warnings.append(f"{prefix} may merely restate a key point: {question}")

            for previous_index, previous_model, previous_question in questions[:-1]:
                near_duplicate = normalized == normalize_text(previous_question)
                near_duplicate = near_duplicate or similarity(question, previous_question) >= duplicate_threshold
                if near_duplicate:
                    cross_model = previous_model != model
                    kind = "cross-model duplicate boundary" if cross_model else "duplicate boundary"
                    warnings.append(
                        f"{prefix} possible {kind} with examples[{previous_index}]: {question}"
                    )
                    break

        if not isinstance(answer, str) or answer not in ANSWERS:
            errors.append(f"{prefix} invalid answer: {answer}")

        if not isinstance(reason, str):
            errors.append(f"{prefix} reason must be a string")
        elif complete and not reason.strip():
            errors.append(f"{prefix} needs a non-empty review reason")

        evidence = example.get("evidence_ids")
        if evidence is None and require_evidence_ids:
            errors.append(f"{prefix} missing review `evidence_ids`")
        elif "evidence_ids" in example:
            if not isinstance(evidence, list) or any(not isinstance(value, str) for value in evidence):
                errors.append(f"{prefix} evidence_ids must be an array of Fact IDs")
            else:
                if len(evidence) > 3 or len(set(evidence)) != len(evidence):
                    errors.append(f"{prefix} evidence_ids must contain at most 3 unique Fact IDs")
                for fact_id in evidence:
                    if fact_id not in fact_ids:
                        errors.append(f"{prefix} references missing Fact {fact_id}")
                if answer in ("是", "否") and not evidence:
                    errors.append(f"{prefix} yes/no needs at least one review Fact ID")

        if "summary" in example:
            errors.append(f"{prefix} must not include legacy `summary`; remove it from examples")

    if examples:
        restatement_ratio = restatement_count / len(examples)
        if restatement_ratio > 0.30:
            warnings.append(
                f"[{label}] key-point restatement ratio {restatement_ratio:.0%} > 30%; "
                "at least 70% should require classification reasoning"
            )

    if boundary_counts:
        most_common_type, most_common_count = boundary_counts.most_common(1)[0]
        if sum(boundary_counts.values()) >= 4 and most_common_count / sum(boundary_counts.values()) > 0.50:
            warnings.append(
                f"[{label}] boundary_type `{most_common_type}` dominates "
                f"{most_common_count}/{sum(boundary_counts.values())} examples"
            )

    return errors, warnings, model_counts, boundary_counts


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("json_file", type=Path)
    parser.add_argument("--min-fact", type=int, default=1)
    parser.add_argument("--min-inferential", type=int, default=1)
    parser.add_argument("--mode", choices=("complete", "partial", "examples"), default="complete",
                        help="complete requires Facts/key points/evidence; partial (examples alias) preserves legacy gaps.")
    parser.add_argument("--allow-missing-evidence-ids", action="store_true",
                        help="For a reviewed production copy after removing preview-only evidence_ids.")
    parser.add_argument("--require-approved-facts", action="store_true",
                        help="Reject any Fact not approved; use for the final reviewed publishing copy.")
    parser.add_argument(
        "--allow-missing-boundary-type",
        action="store_true",
        help="Use after manual review if boundary_type was intentionally stripped before upload.",
    )
    parser.add_argument("--duplicate-threshold", type=float, default=0.58)
    args = parser.parse_args()

    try:
        data = load_json(args.json_file)
    except Exception as exc:  # noqa: BLE001
        print(f"ERROR: failed to read JSON: {exc}", file=sys.stderr)
        return 2

    if not isinstance(data, list) or not data:
        print("ERROR: root JSON must be a non-empty array", file=sys.stderr)
        return 2

    all_errors: list[str] = []
    all_warnings: list[str] = []
    total_model_counts: Counter[str] = Counter()
    total_boundary_counts: Counter[str] = Counter()
    total_fact_counts: Counter[str] = Counter()

    repo = Path(__file__).resolve().parents[4]
    runner = repo / "node_modules" / ".bin" / ("vite-node.cmd" if sys.platform == "win32" else "vite-node")
    try:
        check = subprocess.run(
            [str(runner), str(Path(__file__).with_name("validate_puzzle_facts.ts")), str(args.json_file.resolve())],
            cwd=repo, capture_output=True, text=True, encoding="utf-8", timeout=60, check=False,
        )
        if check.returncode:
            raise RuntimeError("canonical Facts validator failed; check local Node/vite-node installation")
        fact_checks = json.loads(check.stdout)
        if not isinstance(fact_checks, list) or len(fact_checks) != len(data):
            raise RuntimeError("canonical Facts validator returned an invalid report")
    except (OSError, ValueError, RuntimeError, subprocess.TimeoutExpired) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2

    titles: set[str] = set()

    for index, item in enumerate(data):
        errors, warnings, model_counts, boundary_counts = validate_puzzle(
            item,
            index,
            require_boundary_type=not args.allow_missing_boundary_type,
            duplicate_threshold=args.duplicate_threshold,
            complete=args.mode == "complete",
            require_evidence_ids=args.mode == "complete" and not args.allow_missing_evidence_ids,
        )
        all_errors.extend(errors)
        all_warnings.extend(warnings)
        total_model_counts.update(model_counts)
        total_boundary_counts.update(boundary_counts)

        title = item.get("title", f"#{index + 1}") if isinstance(item, dict) else f"#{index + 1}"
        if isinstance(title, str):
            if title.strip() in titles:
                all_errors.append(f"[{title}] duplicate puzzle title")
            titles.add(title.strip())
        fact_check = fact_checks[index]
        all_errors.extend(f"[{title}] {error}" for error in fact_check["errors"])
        all_warnings.extend(f"[{title}] {warning}" for warning in fact_check["warnings"])
        for fact in fact_check["facts"]:
            total_fact_counts[fact["kind"]] += 1
            total_fact_counts[fact["status"]] += 1
            if args.require_approved_facts and fact["status"] != "approved":
                all_errors.append(f"[{title}] {fact['id']} is not approved")
        if args.require_approved_facts and not fact_check["facts"]:
            all_errors.append(f"[{title}] no approved Facts")
        if model_counts["fact"] < args.min_fact:
            all_warnings.append(f"{title}: fact examples {model_counts['fact']} < {args.min_fact}")
        if model_counts["inferential"] < args.min_inferential:
            all_warnings.append(
                f"{title}: inferential examples {model_counts['inferential']} < {args.min_inferential}"
            )

    print(f"puzzles: {len(data)}")
    print(f"Facts: explicit={total_fact_counts['explicit']}, derived={total_fact_counts['derived']}; "
          f"draft={total_fact_counts['draft']}, approved={total_fact_counts['approved']}, "
          f"needs_review={total_fact_counts['needs_review']}")
    print(f"fact examples: {total_model_counts['fact']}")
    print(f"inferential examples: {total_model_counts['inferential']}")
    if total_boundary_counts:
        print("boundary types:")
        for boundary_type, count in sorted(total_boundary_counts.items()):
            print(f"- {boundary_type}: {count}")

    if all_warnings:
        print("warnings:")
        for warning in all_warnings:
            print(f"- {warning}")

    if all_errors:
        print("errors:", file=sys.stderr)
        for error in all_errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
