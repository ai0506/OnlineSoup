---
name: puzzle-generator
description: 为 OnlineSoup 创作、补全、修改和审核完整海龟汤题目，包括汤面、汤底、推理评分点、ask 2.0 编号 Facts 证据清单与 fact/inferential 示例问答；也支持只改 Facts 或 examples、导出当前题库及准备经审核的发布材料。
---

# Puzzle Generator

将故事整理为能供 OnlineSoup 实际使用、可人工审核的完整 puzzle。原 `puzzle-example-generator` 的示例生成能力保留在本 skill 内。

## 先确定任务与当前合同

- 创作/补全完整题目：一起准备 `title`、`surface`、`bottom`、`difficulty`、`is_active`、`key_points`、`facts`、`examples`。生成顺序为故事 → 原文事实 → 必要推导 → 独立评分点 → 玩家示例 → 交叉审核。
- 只改 examples / Facts / 评分点：保留其他字段、已有编号、题目顺序与数据库标识，不借机重写故事。若发现其他字段矛盾，先在审核说明中指出。
- 用户提供汤面/汤底时以其为准；只给创作主题时可以创作，但未确定的设定先写进可审核的汤底，不能通过 Facts 偷偷补入。编辑已有题目时不补造设定。
- 编辑现有题目且未提供源文件：先只读导出当前题库。纯新题创作无需先查询线上题库。不要从记忆重建现有故事。
- 当前代码优先于历史计划。涉及运行行为或发布时读 [runtime-and-publishing.md](references/runtime-and-publishing.md)，核对其中列出的代码入口和最新迁移，不凭本 skill 宣称生产已启用 v2。

## 三类材料分别负责什么

| 字段 | 作用 | 编写依据 |
| --- | --- | --- |
| `facts` | ask 2.0 私密证据清单，供模型引用 F 编号 | 原文事实 + 经审核的可靠推导 |
| `examples` | 玩家提问的分类示范；v2 的 A 读取，B1 不读 | 当前题目、问法边界、完整命题判断 |
| `key_points` | hint 引导、reason 逐点评分、v1 回退使用 | 解答谜题必须解释的独立关键点 |

三者不能相互冒充。Facts 不只是推导：**汤面/汤底原文也应按独立事实整理并编号**；评分点不能直接批量改名成 Facts。房间公开事实面板由游戏中的回答生成，与私密 `facts` 不同。

## 完整题目的要求

- 汤面呈现玩家可见的谜团，汤底清楚交代真实事件、因果及必要的认知差异；两者不能无解释地矛盾。区别“现实发生”“人物相信”“他人声称”。
- `title` 1–60、`surface` 5–1000、`bottom` 5–2000 字符；`difficulty` 为 `简单|中等|困难|抽象`。新预览默认 `is_active: false`，不表示现有 create RPC 能原子创建未启用题目。
- `key_points` 使用独立的正整数编号与非空 `text`，完整新题至少一个有效评分点；不机械拆成所有细枝末节。`accept` 是可接受的合理变体，非同义词堆砌；`SOI` 只在明确需要蕴含覆盖时使用。详见 [examples.md](references/examples.md)。
- 完整新题必须包含非空的编号 `facts`；这是本生成流程的交付要求，**不是当前 ask 运行的强制条件**。不规定固定数量，覆盖判断所需的主要原文事实与易误读的必要推导，总数不超过现有 Facts RPC 的 60 条限制。
- 新题默认 4 条 fact、4 条 inferential 示例；依据不足时减少并说明，不能凑数。现有 examples-only 请求维持其指定范围。

## Facts 生成与审核

生成/修改 Facts 时必须读 [facts.md](references/facts.md)，按 `src/lib/puzzle-facts.ts` 的真实格式生成。核心要求：

1. 每条一个明确命题，稳定编号 `F1`、`F2`……。先覆盖原文明说事实，再补必要推导；保留人物、时间、因果与认知范围。
2. `explicit` 必须有可定位的原文 `quote`；`derived` 必须有有效 `depends_on`，并用 `note` 写出供人审核的推导链。不把可能性、典型故事套路或人物心理猜测写成事实。
3. 新增或语义变化的事实先设 `draft`。不能自行批量批准；用户审核通过后才将获批条目设 `approved`。引用存在不等于推导成立。
4. 编号不重复、不复用已删除编号；依赖不能缺失、自引用或成环。批准条目的所有依赖也必须批准。编辑事实后检查依赖它的后续条目是否需复核。
5. 优先只陈述成立的内容，避免“是 X，不是 Y”或排除清单。含“不是/而非/并非”会提醒；确有原文明说的否定事实时由审核人判断，不能为躲提醒改写成相反含义。

## 示例与证据一起审核

生成 examples 时读 [examples.md](references/examples.md)，保留玩家视角、边界类型、近似重复与评分点复读检查。v2 的 A 合并读取前 20 条示例；`model` 分类保留以兼容 v1 回退。

完整题目的每条 example 预览增加 `evidence_ids` 数组：

- “是/否”至少引用一个当前题目的 Fact 编号，并由 `reason` 解释它如何支持或反驳**完整命题**。若支持依据尚无编号，先补有来源的 Fact，不能编造编号。
- “与此无关/模糊问题”可用空数组，由理由说明缺失信息或问法问题；不为了无关答案生成“未提及某事”的伪事实。
- `boundary_type`、`evidence_ids` 仅供审核，发布 examples 副本时删除。这个预览规则不表示当前 B1 仅接受编号；当前 B1 还允许原文片段，见运行合同。

## 本地预览与校验

新输出放 `.agents/tmp/puzzle-previews/<YYMMDDHHMMSS>.<题目名>.puzzle-preview.json`，使用当前本地时间、UTF-8、非空 puzzle 数组。预览只包含本次受影响题目，按原顺序；全库源导出独立保留，不覆盖源文件。老预览目录保留，读取旧文件无需搬迁。`points` 旧字段规范为 `key_points`，不要丢掉已有 `facts`、`id` 或 `content_version`。

在仓库根目录运行：

```bash
# 只读导出，包含 id / facts / content_version；文件含私密汤底
node .agents/skills/puzzle-generator/scripts/export_puzzles_from_supabase.mjs --output .agents/tmp/puzzles-current.json

# 完整题目：结构、示例、审核证据与生产同源 Facts 校验
python3 .agents/skills/puzzle-generator/scripts/validate_puzzles.py <preview.json>

# 只编辑旧题示例时，允许尚未补全 Facts；缺失会提示
python3 .agents/skills/puzzle-generator/scripts/validate_puzzles.py <preview.json> --mode examples

# 只改 Facts，保留旧 examples 未带审核字段的原状
python3 .agents/skills/puzzle-generator/scripts/validate_puzzles.py <preview.json> --mode partial --allow-missing-boundary-type

# 每个受影响题目单独生成静态审核页
python3 .agents/skills/puzzle-generator/scripts/render_puzzle_review.py <preview.json> --title "题目名"
```

校验器通过仓库已有 `vite-node` 调用 `src/lib/puzzle-facts.ts`，不要另写一套原文匹配/依赖规则。报告结构错误与语义审核提醒，不能把机器通过当成内容正确。审核页展示汤面、汤底、评分点、Facts 内容/来源/依赖/备注/状态以及示例与证据编号。所有文本转义，页面无上传操作。

维护工具后运行 `python3 .agents/skills/puzzle-generator/scripts/test_puzzle_tools.py`。该检查使用虚构材料及本机模拟 HTTP 服务，不访问线上题库。

反馈包含 JSON/HTML 绝对路径、修改范围、Facts 类型和状态数量、示例数量、缺失/弱推导/冲突提醒。逐题核对核心事实覆盖、推导可靠性、人物认知范围、示例完整命题和玩家视角。涉及错误修复时读取相关 `ai-error/` 与当前问答缓存，另行指出缓存问题，不自动修改缓存。

## 发布是独立阶段

当前请求若仅为生成/预览，交付审核文件后等待用户明确批准该文件再上传；已经明确批准的范围不重复请求许可。授权升级 skill 不等于授权写线上题库。

发布前必须读 [runtime-and-publishing.md](references/runtime-and-publishing.md)。**当前后台 JSON 导入和 create/update RPC 不接收 Facts，完整预览不能直接当作可无损导入文件。** Facts 必须经校验后走 `admin_set_puzzle_facts`，并逐字段回读确认；未完成这一步不能报告完整发布成功。不得为单题使用全库替换。

私密源文件、预览、汤底、Facts 与凭证不入 Git；skill 与通用脚本可入 Git。只记录变量是否存在，不输出 key、token 或连接串。
