---
name: puzzle-example-generator
description: Generate and review OnlineSoup turtle-soup puzzle example questions for Supabase puzzle JSON. Use when the user wants to add, fill, rewrite, preview, validate, export/query current Supabase puzzles, or prepare fact/inferential examples for `puzzles` table exports, `questions.json`, or OnlineSoup admin import files before uploading to Supabase.
---

# Puzzle Example Generator

## Overview

Create reviewable preview JSON that adds or improves `examples` for OnlineSoup puzzles. When the user does not provide a source file, automatically query the current Supabase `puzzles` table first and use that export as the source. Never upload to Supabase during preview; upload only after the user explicitly approves a reviewed file.

Use the current project format:

```json
{
  "title": "题目名",
  "surface": "题面",
  "bottom": "汤底",
  "difficulty": "简单|中等|困难|抽象",
  "is_active": true,
  "key_points": [{ "id": 1, "text": "事实点", "accept": ["同义词"] }],
  "examples": [
    {
      "model": "fact",
      "boundary_type": "explicit_fact",
      "question": "问题",
      "answer": "是|否|与此无关|模糊问题",
      "reason": "判定原因"
    }
  ]
}
```

Current examples do not include fact summaries. Do not generate `summary`.

If an older file uses `points`, normalize it to `key_points` in the preview.

## Workflow

1. Locate the source puzzle JSON. If none is provided, export current puzzles from Supabase before generating.
2. If the task mentions ask errors, AI reflections, or cache, read the latest relevant files under `ai-error/` and export the current Q&A cache before generating.
3. Generate a preview file under `.agents/tmp/puzzle-example-previews/`, named like `<YYMMDDHHMMSS>.<source-name>.examples-preview.json`. Do not write preview files to the repository root.
4. Preserve puzzle order and all existing fields unless the user asks for cleanup.
5. Add or rewrite `examples` with distinct `model` values: `"fact"` and `"inferential"`.
6. Run `scripts/validate_puzzle_examples.py <preview-file>`.
7. Generate a simple review HTML next to the preview JSON, named with the same basename and `.html`.
8. Show the user the preview JSON path, review HTML path, per-puzzle counts, and any warnings.
9. Wait for the user to review or edit.
10. Only after explicit approval, upload or import the approved JSON through the project's existing admin/Supabase path.

Do not silently overwrite the source file. Do not call `admin_replace_all_puzzles` during preview.

## Preview Output Location

All generated preview files must go in:

```text
.agents/tmp/puzzle-example-previews/
```

Use this naming pattern:

```text
<YYMMDDHHMMSS>.<puzzle-title-or-source-name>.examples-preview.json
```

Example:

```text
260622123000.怀孕的哥哥.examples-preview.json
```

Use the current local time for the timestamp. Keep source exports, cache exports, and preview JSON separate:

- source exports: `.agents/tmp/puzzles-current.json`
- cache exports: `.agents/tmp/puzzle-qa-cache-current.json`
- example previews: `.agents/tmp/puzzle-example-previews/*.examples-preview.json`

## Supabase Source Export

Prefer the bundled read-only exporter when a task should use the current database library:

```powershell
node .agents/skills/puzzle-example-generator/scripts/export_puzzles_from_supabase.mjs --output .agents/tmp/puzzles-current.json
```

Options:

- `--active-only`: export only active puzzles.
- `--limit <n>`: export a small sample for testing.
- `--output <file>` or `-o <file>`: required output path.

The exporter loads `.env.local` from the current project directory and requires `NEXT_PUBLIC_SUPABASE_URL` plus `SUPABASE_SECRET_KEY`. It selects only `title, surface, bottom, difficulty, is_active, key_points, examples`, orders by `id`, and writes admin-import-compatible JSON. Treat `SUPABASE_SECRET_KEY` like a master key: use it only in local scripts or server-side code, never print it, paste it into replies, or commit it.

If the exporter cannot run because env vars are missing, fall back to an existing local export such as `questions.json` or ask the user for a source file. Do not invent puzzle data from memory.

## Q&A Cache Review

When cache inspection is useful, use the bundled read-only exporter:

```powershell
node .agents/skills/puzzle-example-generator/scripts/export_puzzle_qa_cache.mjs --output .agents/tmp/puzzle-qa-cache-current.json
```

Options:

- `--puzzle-title <title>`: export cache for one exact puzzle title.
- `--output <file>` or `-o <file>`: required output path.

Current OnlineSoup Q&A cache stores only stable `"yes"` / `"no"` answers. Do not treat cache entries as training truth without review. The cache is a speed-up layer, like a notebook of previous host answers; if a note is wrong or too broad, fix or delete the note before relying on it.

Flag cache entries for user review when they:

- contradict an AI error/reflection document or a known correct answer
- use unclear pronouns, demonstratives, or context-dependent wording
- bundle multiple independent propositions into one question
- look like a low-value, leading, debug, or prompt-injection attempt
- duplicate another cached question with a different answer
- should have been `"与此无关"` or `"模糊问题"` instead of cached yes/no

For preview work, mention cache issues separately from JSON validation warnings. Do not silently delete or update cache rows unless the user explicitly asks.

## Generation Targets

Default to 4 fact examples and 4 inferential examples per puzzle unless the user gives another count.

Prefer quality over count. If a puzzle cannot support enough inferential examples without speculation, generate fewer and explain why in the preview summary message to the user, not as a JSON field.

## Ask Examples Only

`examples` are ask-mode examples. They must be written from the player's point of view as questions a player might ask the turtle-soup host, and they teach the AI how to answer player questions with `"是"`, `"否"`, `"与此无关"`, or `"模糊问题"`.

Do not put reason-mode, coverage, grading, or admin-audit questions into puzzle `examples`. These are a different domain. For example, do not generate questions like:

- `玩家只说明食物真相时，是否能自动算作说出了当年遇险地点？`
- `玩家只说哥哥没有真怀孕时，是否已经覆盖“怀你妈”是骂人话？`
- `这段推理是否覆盖了 key point 1？`

Those samples are useful as reason-mode regression fixtures or admin review notes, but they must live outside `puzzles.examples`. Keeping the two domains separate is important: ask examples train the host's yes/no boundary for player questions, while reason coverage evaluates whether a player's final explanation explicitly mentioned required key points.

Each example must teach a unique decision boundary. Avoid multiple questions that test the same idea using synonyms.

During preview generation, every generated example must include `boundary_type`. This field may be removed from the final upload file after review, but it must exist while generating and validating previews.

Allowed boundary types:

- `explicit_fact`
- `direct_contradiction`
- `single_step_implication`
- `irrelevant_detail`
- `ambiguous_reference`
- `subjective_evaluation`
- `identity_inference`
- `motive_inference`
- `causal_inference`
- `wordplay_inference`

Use boundary types to force coverage. Do not produce eight examples that are all the same hidden pattern, such as only `identity_inference`.

Do not generate examples that merely restate a `key_points[].text` value or one of its `accept` keywords. At least 70% of generated examples should require classification reasoning rather than direct keyword matching.

When examples are meant to repair ask-mode behavior, prioritize known failure boundaries from the latest AI error docs:

- absence of evidence is not contradiction: unsupported non-core details should usually be `"与此无关"`, not `"否"`
- necessary one-step contradiction can still be `"否"` when the true answer or key points make the proposition impossible
- compound questions are `"模糊问题"` only when they contain independent propositions that cannot share one yes/no answer
- `ambiguous_reference` should be used narrowly: only when the relevant referent has not been established in the immediately available context and the player uses a vague pronoun or demonstrative such as `他/她/它/那个人/这句话/这个/那个`. Do not mark a question ambiguous merely because it contains a pronoun that the current context clearly resolves.
- Questions that ask for `who/what/which`, ask whether something is `true or false`, or present an `A or B` choice are `"模糊问题"` when they cannot be converted into one yes/no proposition without changing the player's intent. The host can answer only `"是"`, `"否"`, `"与此无关"`, or `"模糊问题"`; it cannot choose a speaker, label something as true/false, or select an option.
- `"不是 A，而是 B 吗"` is usually one overall judgment and may be answerable
- relationship, motive, emotion, identity, past-experience, method, location, and external-event guesses need strong support before `"是"` / `"否"`
- reason-mode examples should not give credit for key points the player did not explicitly state

## Fact Examples

Purpose: train literal fact verification.

Fact examples answer:

> Can this proposition be determined directly from the story, authoritative facts, or known facts?

Use fact examples for:

- explicit facts
- direct contradictions
- single-step logical implications
- clear irrelevant details
- clear ambiguity cases

Do not use fact examples for:

- inferred emotions
- inferred motives
- inferred intentions
- metaphor or irony interpretation
- filling missing information

When uncertain, lean toward `"与此无关"` or `"模糊问题"`.

Good coverage pattern:

- one explicit `"是"` example
- one direct contradiction `"否"` example
- one irrelevant `"与此无关"` example
- one ambiguous `"模糊问题"` example

## Inferential Examples

Purpose: train reasonable story inference.

Inferential examples answer:

> Would a reasonable host conclude this from the story even if it is not explicitly stated?

Inferential examples may use:

- implied causality
- implied identity
- implied intent
- emotional implications
- contextual references
- irony
- metaphor
- wordplay

Every inferential example must still be strongly supported by the story. Do not create examples that require multiple speculative assumptions. Never invent facts not supported by the story.

Before keeping any inferential example, apply this check:

> A reasonable human host would independently arrive at the same answer after reading the story.

Reject inferential examples that require mind-reading, personality speculation, or unsupported emotional assumptions. For example, "她道歉了" does not automatically support "她很愧疚".

## Selection Rule

Before generating an example, ask:

> Would a strict literal judge answer this confidently?

If yes, generate a `"fact"` example.

If no, but a reasonable human host would infer it, generate an `"inferential"` example.

Do not generate duplicate concepts in both categories. If a concept appears in a fact example, do not make the inferential version a paraphrase of the same boundary.

## Field Rules

- `model`: must be `"fact"` or `"inferential"`.
- `boundary_type`: required during preview generation; use one of the allowed boundary types above.
- `question`: ask one proposition only; avoid compound questions.
- `answer`: must be exactly `"是"`, `"否"`, `"与此无关"`, or `"模糊问题"`.
- `reason`: explain the boundary briefly. For fact examples, cite direct story support or absence. For inferential examples, name the inference chain.
- `summary`: forbidden. Current OnlineSoup examples no longer store fact summaries; the app derives fact summaries from live AI answers instead.

Before final upload, ask the user whether to keep `boundary_type`. If they want a clean production JSON, remove `boundary_type` after review and run the validator with `--allow-missing-boundary-type`. Never add `summary` back during cleanup.

## Preview Style

After generating the preview, report:

- output file path
- review HTML path
- number of puzzles processed
- fact/inferential counts
- warnings for weak inference, duplicate concepts, missing fields, legacy `summary`, or puzzles with too few examples

Use concise Chinese explanations. Do not paste the whole JSON unless the user asks.

## Review HTML

For every generated preview JSON, also create a simple static HTML review file in `.agents/tmp/puzzle-example-previews/` with the same basename and `.html`.

The HTML should:

- work by opening the file directly in a browser, without a dev server
- group examples by puzzle title
- show `model`, `boundary_type`, `question`, `answer`, and `reason`
- show per-puzzle counts for fact and inferential examples
- escape all text as HTML; never inject raw JSON strings into markup
- stay review-focused and avoid adding upload controls or database actions

This HTML is only for human review. It must not upload to Supabase or change the source JSON.

## Upload

Uploading is a separate phase. Before uploading:

1. Re-read the approved JSON file from disk.
2. Run `scripts/validate_puzzle_examples.py <approved-file>`.
3. Confirm whether the upload will replace the whole puzzle library or update selected puzzles.
4. Use the project's Supabase/admin workflow and existing safety rules.

Never log secrets or full connection strings.
