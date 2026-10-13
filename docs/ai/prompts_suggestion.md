---

# 海龟汤游戏 AI Prompt 汇总

本文件包含了海龟汤多人聊天室中 AI 主持人所需的所有 Prompt。每个 Prompt 均配有使用场景、输入变量、输出格式及调用规则。

---

## 1. 回答玩家提问

当前实际实现以 `src/lib/deepseek.ts` 的 `buildAskPrompt`、`buildAskArbitrationPrompt` 和 `askWithCrossCheck` 为准。以下描述 2026-10-11 的本地修改；是否上线需结合部署记录确认。

- 两路都读取汤面、汤底、关键点和最近 5 个正式提问；strict 只读取 fact examples，inferential 只读取 inferential examples。两路与仲裁都不接收历史主持判定；历史问题只帮助理解指代，其中的猜测和前提不能作为事实。
- strict 保持严格字面标准：明确、无歧义的事实才回答是／否。
- inferential 允许有事实依据的多步常识推理、语义概括、比喻、因果链，以及行为明确传达的动机和情绪。原文未使用相同词语，不构成回避判断的理由。
- 明令禁止添加题目未给出的具体身份、关系、承诺、经历、身体状况、事件或心理动机；每一步须有真相或不新增故事事实的普通常识依据。仅仅“可能如此”或“类似故事通常如此”不够。
- 如果同样符合真相、同样有依据的合理推理方向会产生不同答案，不能擅选一个：命题清楚但信息不足用“与此无关”，问法或独立命题无法统一用“模糊问题”。不要求排除所有凭空设想的例外。
- 判断须保留玩家所问的对象、前提和原因。不能用“发现朋友有手”的证据，认可“发现朋友能看见”；理由也必须支持实际命题。
- 区分客观事实、人物认知与他人陈述。现实中某事为假，不等于人物没有误以为它为真；否定认知必须有该人物当时认知的证据。只描述一种欺骗或认知，不代表排除了其他认知；未交代的认知及其原因回答“与此无关”。仍允许从明确的发现、感知和行为推导认知。
- “否”必须有与完整命题不能同时成立的依据；“未提及／没有该设定／实际是另一回事”本身不是反证。仲裁也遵守这一边界，命题清楚但事实不明不能改判“模糊问题”。
- 本题 examples 仅在完整命题等价时优先：对象、认知范围、原因、前提都须一致；新增具体条件的窄命题不能套用宽泛示例答案。
- 不注入跨题目的通用故事或示例；examples 仅来自当前题目并按 fact/inferential 分路。通用推理边界用规则表达，其他故事只留在离线回归测试中。此前通用示范方案已撤回，历史记录见 `ai-error/10-10/ask-boundary-examples.md`。
- ask 两路与仲裁显式发送 `thinking: { type: "disabled" }`，避免提供方默认思考耗尽 320 token 的短 JSON 预算；这不删除 prompt 中的推理规则，hint/reason 的调用参数保持原状。
- 两路答案类别一致直接采用；不同则仲裁。仲裁同样允许稳定、有依据的多步推理，不能仅因 strict 缺少直接原文而否决。当前仍无独立的“两路一致但都错”校验器。
- 单路失败使用另一路，不允许缓存；GLM 是整条调用失败后的可选降级，不是另一条独立常驻路线。

模型先输出简短 `reason` 说明完整命题的证据，再输出 `answer_type: yes|no|irrelevant|ambiguous`；证据仅说明未知时应为 irrelevant。两个字段的存储和玩家脱敏格式保持原状。`ask_audit` 保留两路与可选仲裁结果，玩家侧沿用现有脱敏流程，不展示内部理由。一致的 yes/no 仍可能生成共享事实和缓存候选，因此双路一致不能当作独立正确性证明。

真实模型回归工具：`node scripts/evaluate-ask-inference.mjs --live --fixtures <本地用例JSON路径> --output <报告JSON路径>`。用例数组每项包含 `id`、`question`、`expected`（答案类型数组）、`puzzle`（含汤面/汤底，可含 key_points/examples）及 `history`（消息数组）；线上题目快照仅保存在 Git 忽略的 `ai-error/fixtures/ask-inference-cases.json`，不进入公开仓库。省略 `--fixtures` 时读取该本地文件。（Node 24 或支持 TypeScript type stripping 的版本）。只有显式 `--live` 才调用付费 AI，读取本机环境配置但不输出密钥，不写房间、题库或积分。可用 `--filter <ID片段>` 单独复查；测试共 36 项，覆盖本次 Doubao 原问、错误历史干扰及独立的离线故事，包含指代、主观／开放／选择问法、动机、反讽、谐音、职责、因果链和认知范围回归。

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
