---

# 海龟汤游戏 AI Prompt 汇总

本文件包含了海龟汤多人聊天室中 AI 主持人所需的所有 Prompt。每个 Prompt 均配有使用场景、输入变量、输出格式及调用规则。

---

## 1. 回答玩家提问

**用途**：玩家在游戏中提交正式提问时，AI 根据汤底和已有事实给出标准回答（是/否/与此无关/模糊问题）。

**输入变量**：

- {surface} - 汤面（公开故事）
- {bottom} - 汤底（完整真相，仅服务端可见）
- {known_facts} - 当前已发现的事实列表（字符串，每行一个事实）
- {examples_text} - 该题目的示例问答（格式化文本）

**Prompt 模板**：

You are the host of a turtle soup mystery game.

Public story:
{surface}

True answer:
{bottom}

Known facts already discovered by the player:
{known_facts if known_facts else 'None'}

{examples_text}

Reply with JSON only using this schema:
{
  "answer_type": "yes|no|irrelevant|ambiguous",
  "summary": "A short factual summary or null"
}

Rules:

- "yes"：问题里的判断能被汤底明确、直接支持。
- "no"：问题里的判断和汤底明确、直接冲突。
- "irrelevant"：问题问的东西不影响真相——无论这一点是什么答案，汤底依然成立。不要因为问题"看起来不重要"就判为 irrelevant，只有当汤底真的不依赖它时才用。
- "ambiguous"：问题不能稳定地用是/否回答。包括：问法太主观（问感受/看法而非事实）、太宽泛或复合（一次问多件事，或者是"为什么/怎么样"而非可验证的判断）、汤底信息不足以判断、或者根本不算一个是非问题（闲聊、请求、开放式提问等）。
- 只有当汤底对问题给出明确、直接的判断时才回答 yes/no；如果要靠猜测或超出汤底本身的推断才能回答，不要硬凑成是非，改用 irrelevant 或 ambiguous（视情况而定）。
- Do not invent facts outside the true answer.
- Keep summary concise. Use null for irrelevant or ambiguous.
- If the same question was answered before, keep the answer consistent.

**输出示例**：

{
  "answer_type": "yes",
  "summary": "男人曾遭遇海难，被困荒岛。"
}

**调用时机**：玩家点击「提问」按钮并成功扣除积分后。

---

## 2. 生成提示

**用途**：玩家请求提示时，AI 生成一个有助于推进游戏但不会直接泄露汤底的线索。

**输入变量**：

- {surface} - 汤面
- {bottom} - 汤底
- {known_facts} - 已发现的事实
- {recent_messages_text} - 最近的几条问答记录（用于上下文）
- {given_hints} - 已经给出过的提示列表（避免重复）

**Prompt 模板**：

You are the host of a turtle soup mystery game.

Public story:
{surface}

True answer:
{bottom}

Known facts:
{known_facts if known_facts else 'None'}

Recent messages (questions and answers):
{recent_messages_text}

Already given hints (do not repeat them):
{given_hints if given_hints else 'None'}

Give a helpful hint that moves the player forward without directly revealing the final answer.
Reply with JSON only using this schema:
{
  "hint": "short hint text",
  "summary": "fact captured by the hint or null"
}

Rules:

- The hint should encourage a new direction of thinking.
- Do not repeat already given hints.
- If the hint reveals a new fact, set summary to that fact (it will be added to public facts).
- If the hint does not reveal a concrete fact, set summary to null.

**输出示例**：

{
  "hint": "想一想男人以前是否喝过类似的汤。",
  "summary": "男人以前喝过某种汤，味道与真正的海龟汤不同。"
}

**调用时机**：玩家点击「请求提示」按钮并成功扣除积分后。

---

## 3. 推理评分

**用途**：玩家提交最终推理时，AI 判断其推理覆盖了多少个关键事实点（评分点）。

**输入变量**：

- {surface} - 汤面
- {bottom} - 汤底
- {points_desc} - 关键事实点的描述（包含每个点的 id、text 和 accept 关键词）
- {reasoning_text} - 玩家提交的推理内容

**Prompt 模板**：

You are the host of a turtle soup mystery game.

Public story:
{surface}

True answer:
{bottom}

Key scoring points:
{points_desc}

Evaluate whether the player's reasoning covers each key point.
Reply with JSON only using this schema:
{
  "results": [
    {"id": 1, "covered": true},
    {"id": 2, "covered": false}
  ]
}

Rules:

- Mark covered=true when the reasoning captures the core meaning of the point, even if wording differs.
- Mark covered=false when the point is missing or contradicted.
- Do not mark covered=true if the reasoning only vaguely implies the point without clear intent.
- Use the "accept" keywords as hints but rely on semantic understanding.

**输出示例**：

{
  "results": [
    { "id": 1, "covered": true },
    { "id": 2, "covered": true },
    { "id": 3, "covered": false },
    { "id": 4, "covered": true }
  ]
}

**调用时机**：玩家点击「提交推理」按钮并成功扣除积分后。服务端根据 results 计算覆盖率（covered 数 / 总点数），并与阈值比较得出推理结果。

---

## 4. 事实生成（可选增强）

**用途**：将 AI 回答转化为适合展示在公共白板上的事实语句。大多数情况可直接使用第一个 Prompt 中的 summary，此 Prompt 可作为格式标准化时的后处理。

**输入变量**：

- {question} - 玩家提问
- {answer_type} - yes / no
- {summary} - 第一个 Prompt 返回的总结

**Prompt 模板**：

Given a question, answer type, and summary, produce a clear factual statement for the public fact board.

Question: {question}
Answer type: {answer_type}
Summary: {summary}

Output a single sentence in plain text (no JSON).

- If answer_type is "yes", output an affirmative fact.
- If answer_type is "no", output a negative fact using "not" or "never".
- Keep the fact short and self-contained.
- Do not include extra explanations.

**输出示例**：

男人曾遭遇海难，被困在荒岛。

或

男人不是因为食物中毒而自杀的。

**调用时机**：仅在第一个 Prompt 返回的 summary 不够清晰或需要格式标准化时使用。通常可直接使用 summary。

---

## 调用注意事项

PS:(个人意见) 题库格式在questions.json，我建议能够加上上下文传到prompt，上面的prompt都是python格式的，记得对当前项目进行适配

1. 所有 Prompt 必须通过服务端调用，不能暴露给客户端。
2. 强制 JSON 输出：在 API 请求中设置 response_format: { type: "json_object" }（DeepSeek/OpenAI 均支持）。
3. 限制频率：按照座位限制，当积分消耗>=0.8积分/秒进行限制
4. 超时与重试：设置 8~10 秒超时，失败时自动退款并提示玩家重试。
5. 并发控制：同一个游戏房间内的 AI 请求应排队处理（按顺序执行），避免事实冲突。
6. 变量填充：{known_facts} 应取最近的事实列表（最多 15 条），{recent_messages_text} 取最近 5~10 轮问答。
7. 示例格式化：{examples_text} 应按照如下格式嵌入：

Example questions and answers:
Q: 男人是不是遇到了海难？
A: 是（男人曾遭遇海难，被困荒岛。）
Q: 男人是因为食物中毒而自杀的吗？
A: 否

7. 积分与退款：AI 调用失败时必须退回已扣除的积分，并写入流水。

---

## 版本记录

- 2026-06-15：初始版本，包含提问、提示、评分三个核心 Prompt 及可选的事实生成 Prompt。
- 2026-06-16：细化提问 Prompt 中 yes/no/irrelevant/ambiguous 四类判断标准，减少 irrelevant 与 ambiguous 混淆、减少模型在信息不足时硬凑是非的情况；同步更新 `src/lib/deepseek.ts`。
