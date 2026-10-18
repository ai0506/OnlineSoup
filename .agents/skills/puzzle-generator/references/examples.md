# Ask 示例与推理评分写作规则

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

### Player Perspective and Question Wording

- Write `question` as a natural question a player would ask the host while seeing the puzzle's `surface`. Do not write from the perspective of an examiner, evaluator, admin, or someone who has already read the `bottom`.
- Ground the question in the surface's presented people, actions, and unexplained details. Do not put bottom-only facts into the question as if the player already knew them (for example, do not ask whether the protagonist is blind if blindness never appears in the surface). The answer and `reason` may use the authoritative bottom to teach the correct boundary.
- Prefer one clear yes/no proposition. The examples teach the host how to answer player questions, not what facts a player must mention in a final explanation.
- A natural `why`, `how`, `who`, `what`, or `which` question is not answerable with the supported yes/no response set when it asks for an explanation, identity, method, or selection. Label it `"模糊问题"` and explain that the question form cannot be answered by yes/no; do not call it ambiguous merely because it contains a pronoun.
- When an open-ended question is useful for teaching this boundary, keep it in the player's natural voice (for example, `他为什么要把朋友都杀了？`) and make the reason identify the answer-format problem. Do not rewrite it into an artificial yes/no question just to fit the answer set.
- Question wording should arise from the surface. Do not use a hidden solution detail to make a question sound more specific or sophisticated than a player could naturally ask from the presented puzzle.

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
- necessary one-step contradiction can still be `"否"` when the true answer or reviewed Facts make the proposition impossible
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

### `key_points[].accept` Scoring Tolerance

- `accept` is optional. Do not add it to every key point by default.
- It is a scoring tolerance for reasonable, logical answers that express a similar relevant idea without matching the canonical solution's exact detail. It is not a list of synonyms or alternate phrasings that mean exactly the same thing.
- Add it only when a key point is specific enough that a reasonable variation could otherwise be marked wrong too strictly. If the key point is already broad and unambiguous, omit `accept`.
- Describe the boundary of what should count, not a pile of sample phrases. For example: `玩家合理说明一群人在探险中遇险并因此缺粮即可，具体地点或事故可以不同。`
- A useful `accept` preserves the key point's essential logic while allowing a plausible variation in setting, circumstance, evidence, or causal path. Keep the tolerance broad enough to avoid brittle grading, but do not accept a contradiction or an unrelated claim unless the user explicitly asks for that.
- Read `accept` as guidance to the reason-mode scorer, not player-facing copy. It should help the scorer avoid over-penalizing a logically compatible answer; it does not require players to use any listed wording.
- `SOI` / `Seen Or Implied` is a reserved marker inside `accept`, not an acceptance phrase. It tells reason mode that a point may count when the player's explanation clearly implies or presupposes it without stating it word-for-word. It can coexist with actual acceptance guidance in the same array; render it separately from reasonable-variation guidance.

预览保留 `boundary_type` 和 `evidence_ids`；发布副本删除这两个审核字段，原始审核文件不变。不要生成 `summary`。仅改 examples 时不擅自重写既有 key_points 或 Facts。

