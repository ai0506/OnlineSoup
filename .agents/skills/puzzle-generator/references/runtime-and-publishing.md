# 当前运行合同与发布边界

以下基于 2026-10-16 本地代码核对；执行任务时再检查当前代码和后续迁移。这里只说明本地支持，不证明线上配置、迁移或题库状态。

## 核对入口

- `src/lib/room-ai-runner.ts`：读取题目、缓存优先、模型调用、版本复核、失败退款。
- `src/lib/ask-v2-host.ts`：`ASK_ENGINE=v2` 开关、v1 回退、事实摘要。
- `src/lib/ask-v2.ts` / `ask-v2-prompts.ts`：A/B1/仲裁、引用检查。
- `src/lib/puzzle-facts.ts`：Facts 格式、依赖与运行选择。
- `src/lib/deepseek.ts`：v1 examples 分类、hint、reason、`accept` / SOI。
- `src/app/admin/actions.ts`：后台创建/编辑与 JSON 导入 Zod 字段。
- `supabase/migrations`：查最新 `admin_create_puzzle`、`admin_update_puzzle`、`admin_replace_all_puzzles`、`admin_set_puzzle_facts` 以及版本触发器。

## ask 的实际过程

1. 成员请求经受保护入口扣费/排队；执行器按当前 puzzle 读取私密材料与同题历史。v2 读取 `facts`、`content_version`。
2. 先查当前引擎/内容版本的已批准问答缓存；命中后不运行 A/B1。
3. 未命中时 A 与 B1 并发：共用汤面、完整汤底、已批准 Facts；历史只含最近最多 5 条玩家正式 ask，用于指代，不给历史 AI 标签。
4. A 负责问法与四分类（yes/no/irrelevant/ambiguous），合并读取前 20 条 examples，不把 key_points 当作 v2 权威事实。
5. B1 不看 A 输出，也不看 examples；只核对完整命题是否 supported/rejected/undetermined，不裁定主线相关性或问法类别。支持/反驳至少一条证据，最多三条。
6. A 为 ambiguous 时直接返回；A yes+B1 supported、A no+B1 rejected、A irrelevant+B1 undetermined 保留 A；其余进入仲裁。仲裁核对原问题与证据，可返回四类，不强制选择 A/B1 之一。
7. 只有 A 的 yes/no 经 B1 一致验证才具有新缓存/公开事实摘要的准入资格，还受缓存价值规则约束；仲裁结果不进入共享事实/新缓存。
8. v2 调用失败、结构无效或引用无效时尝试 v1 回退，回退不产生新缓存；整体失败走现有退款路径。发布回答前核对题目及内容版本，防止旧依据污染新题。

**引用现状**：prompt 允许已批准 Fact ID 或汤面/汤底的短原文片段（要求 <=30 字符）；实现还接受已提供 Fact 原话的匹配片段。schema 单条上限是 80，不等于 prompt 放宽到 80。不存在的编号/无法匹配的引文视为调用失败，不能伪装为证据不足。新生成器要求预览示例用 `evidence_ids` 连接编号 Facts，但没有修改这个运行协议；不要称 B1 已经“只能引用编号”。

**无 Facts**：当前可从汤面/汤底原文判断；完整题目生成仍必须准备编号证据，便于审核。quote/依赖匹配只证明引用有效，不证明其支持完整命题。

**hint / reason / v1 回退**：继续使用 `deepseek.ts` 的 key_points；reason 逐点评覆盖，SOI 允许清楚蕴含。不要因 v2 不读评分点就省略 key_points；也不要假定 hint/reason 会读新 facts。

## 源文件和只读工具

```bash
node .agents/skills/puzzle-generator/scripts/export_puzzles_from_supabase.mjs --output .agents/tmp/puzzles-current.json
node .agents/skills/puzzle-generator/scripts/export_puzzle_qa_cache.mjs --puzzle-title "题目名" --output .agents/tmp/puzzle-qa-cache-current.json
```

题库导出包含 `id,title,surface,bottom,difficulty,is_active,key_points,examples,facts,content_version`。`id` 是更新目标，`content_version` 是回读/变更检查信息，由数据库管理，不能当作新题输入或覆盖。导出读取 `.env.local`，只用服务端 key；缺少环境时用用户提供的源文件并说明未核对线上。

缓存只是一份待核实的历史答案记录，不是生成真相。发现冲突、跨版本、模糊指代、复合命题或过宽等价时单独列问题，不自动删改。AI 错误材料按仓库规范放 `ai-error/M-D/`。

## 当前发布路径的缺口

- 后台 JSON 导入的 Zod schema **没有 `facts`**，未知字段被剥离；`admin_replace_all_puzzles` 的 INSERT 也没有 Facts。全库导入会清空/重建题库，不可用作单题修改或完整 Facts 导入。
- `admin_create_puzzle(p_title,p_surface,p_bottom,p_difficulty,p_key_points,p_examples)` 返回 void，默认新题启用；不接收 Facts，也不接收 `is_active`。不要虚构 `p_facts` 参数或宣称预览 false 已生效。
- `admin_update_puzzle` 支持 `p_puzzle_id` 与 `p_is_active`，但不接收 Facts。
- Facts 独立 RPC 为 `admin_set_puzzle_facts(p_puzzle_id integer,p_facts jsonb)`，仅 service_role；返回内容版本。数据库只检查数组/最多60条，调用前必须运行生产同源的 Facts 校验。
- 当前后台 Facts 面板只读。生成 JSON/HTML 并不自动保存或批准证据。

## 经授权发布

1. 重新读获批文件和当前目标行，核对目标 ID、源版本与修改范围，保留回滚备份。新题确认标题唯一；若数据已变化，重核差异而非覆盖。
2. 保存发布副本，删除 examples 中 `boundary_type`、`evidence_ids`；保留原审核文件。把用户实际批准的 Facts 改为 approved，完整校验通过；未批准依赖不能被间接批准。
3. 运行 `validate_puzzles.py <发布副本> --allow-missing-boundary-type --allow-missing-evidence-ids --require-approved-facts`。仍需要语义审核，不能靠 flag 跳过结构或依赖检查。
4. 使用实际存在的管理员入口处理选中题目的基础字段，再通过 Facts RPC 保存已校验内容。新题 create 返回 void 后按唯一标题取得 ID；更新已有题目用原 ID。不绕过受保护入口直接扩大表权限。
5. 当前两次 RPC **不是整体原子发布**。授权必须涵盖基础字段与 Facts；准备备份并说明中间状态。如果使用中题目要求原子/不中断发布，应先单独实现并审核原子 RPC，不能声称既有调用有该能力。不擅自改其他房间或增加发布 schema。
6. 改汤面/汤底且未在同一 UPDATE 替换 Facts 会令旧 Facts needs_review；Facts 再次保存后以回读状态为准。内容版本由触发器增长，v2 缓存按版本隔离；不硬编码期望增量或复用旧版本缓存。
7. 回读 `surface,bottom,key_points,examples,facts,is_active,content_version`，对所有改动字段做结构比较（JSONB 对象键顺序无意义，数组顺序有意义）。验证 approved 内容能通过运行选择。失败时先查最终状态；不要因比较失败重复 create 导致重复题目。
8. 明确报告基础题目、Facts、批准状态、回读、真实 ask 验证各自完成情况。真实收费 AI/E2E 与静态验证分开；未经运行不能声称效果提升。若 Facts 写入失败，不把部分成功当作完整发布。

本 skill 本身不提供自动上传脚本，避免预览任务顺手写线上。权限/RLS/调用角色检查遵循项目 AGENTS 与 Supabase skill。
