# OnlineSoup（汤局）功能任务拆分

> 本文件将整个项目按功能模块拆分为独立步骤，标注当前完成状态。

---

## 阶段一：基础用户系统 ✅

**目标**：账户注册、登录、退出、密码重置，以及用户名管理。

- [x] 邮箱注册 / 登录 / 退出（`src/app/auth/`）
- [x] 密码重置流程（`src/app/reset-password/`）
- [x] 历史账户首次补设用户名（`src/app/account/username/`）
- [x] 全局唯一用户名、忽略大小写判重（迁移 `20260615022623`）
- [x] 用户名格式验证：3–8 位字母/数字/下划线（`src/lib/validation.ts`）
- [x] 在活动房间内禁止修改用户名

---

## 阶段二：积分系统 ✅（含聊天积分扣除）

**目标**：个人积分、房间临时积分、创建/关闭房间时的积分流转。

- [x] `profiles.points` 个人积分字段
- [x] `room_seats.remaining_points` 座位临时积分
- [x] 创建房间时扣除积分（`points_per_seat × seat_count`，允许为 0）
- [x] 关闭房间时退还所有座位剩余积分给房主（`close_room` RPC）
- [x] 积分显示格式：`个人积分+房间积分[临]`（`src/components/live-room-seats.tsx`）
- [x] 房主赠送个人积分给指定座位（`gift_points_to_seat` RPC）
- [x] 管理员手动增减用户积分（`src/app/admin/`）
- [x] 积分变动写入 `points_transactions` 表
- [x] 聊天模式（询问/提示/尝试推理）发送时自动扣除座位积分，不足时可切换扣个人积分（`send_room_chat_message` RPC，迁移 `20260615142323`）
- [x] 座位方块角标实时显示临时积分
- [x] 积分不足时弹出站内提示框，显示当前余额

---

## 阶段三：房间核心流程 ✅

**目标**：创建房间、加入/退出/踢人、房间状态同步。

- [x] 创建房间（`create_room` RPC，原子扣积分 + 建房 + 建座位）
- [x] 可选房间密码（`room_private` 表）
- [x] 登录用户加入房间（`join_room_as_member` RPC）
- [x] 游客加入房间（`join_room_as_guest` RPC + HttpOnly Cookie）
- [x] 刷新页面后游客身份恢复（`verify_guest_membership` RPC）
- [x] 加入新房间时自动退出/关闭旧房间（`auto_leave_previous_room`，迁移 `20260614142118`）
- [x] 主动退出房间（`leave_room_as_member` / `leave_room_as_guest` RPC）
- [x] 房主踢出玩家（`kick_guest` RPC + `get_room_exit_reason` RPC）
- [x] 房主关闭房间（`close_room` RPC）
- [x] 房主移动玩家座位（`move_seat` RPC）
- [x] 大厅页面自动恢复当前活动房间（`get_my_active_room` RPC）

---

## 阶段四：实时同步 ✅

**目标**：座位状态、消息、积分的实时推送与轮询兜底。

- [x] Supabase Realtime 订阅 `room-seats:<roomId>`（`src/components/live-room-seats.tsx`）
- [x] Realtime 订阅 `room-messages:<roomId>`（`src/components/room-chat.tsx`）
- [x] Realtime 订阅 `profiles` 表实时更新个人积分
- [x] 轮询兜底：座位每 3 秒同步，消息每 2 秒刷新
- [x] 页面重新可见 / 获焦 / 上线时触发同步
- [x] 订阅断开时自动补拉最新状态

---

## 阶段五：聊天系统 ✅

**目标**：房间内成员聊天，系统消息，消息鉴权。

- [x] 发送聊天消息（`send_room_chat_message` RPC，1–500 字符）
- [x] 读取近 100 条历史消息（`get_room_chat_bootstrap` RPC）
- [x] 消息读写经过 `/rooms/[code]/messages` 服务端路由鉴权
- [x] 系统消息（加入/退出/踢人/赠分/移座 等事件）
- [x] 消息按创建时间 + ID 稳定排序
- [x] 聊天模式标签：聊天 / 询问（1pt）/ 提示（1pt）/ 尝试推理（2pt），含二级确认对话框（`src/components/room-chat.tsx`）
- [x] 不同模式消息在聊天气泡上有样式区分
- [x] 多行消息展示与输入换行（`Shift+Enter`）支持（`src/components/room-chat.tsx`）
- [x] 发送失败、积分不足、发送太频繁等提示使用站内弹窗，不使用浏览器原生弹窗
- [ ] **待做**：消息内容增强（表情快捷输入、Markdown/链接识别等）
- [ ] **待做**：未开题时聊天输入区下方仍有提示文字，建议改为按钮禁用态 `title` 或详情区提示，避免撑高聊天框布局

---

## 阶段六：题库与 AI 查询 🔄 进行中

**目标**：海龟汤题库管理，房主开题/切题，玩家向 AI 提问消耗积分。

> 数据来源：`questions.json`（9 道题）
> 每道题字段：`title`、`surface`（题面）、`bottom`（汤底，仅 AI/房主可见）、`difficulty`（简单/中等/困难/抽象）、`points`（关键线索 + 触发关键词）、`examples`（示例问答，用于 AI few-shot）
> `examples` 的 `answer` 类型：`"是"` / `"否"` / `"与此无关"` / `"模糊问题"`

### 6-A：数据库与题库导入 ✅

- [x] 创建迁移：`puzzles` 表（`id`, `title`, `surface`, `bottom`, `difficulty`, `is_active`，迁移 `20260615153259_puzzle_system.sql`）
- [x] 创建迁移：`puzzle_progress` 表，记录房间题目完成状态（迁移 `20260615153259_puzzle_system.sql`）
- [x] 创建种子迁移：将 `questions.json` 的 9 道题导入数据库
- [x] RLS：题库相关表不允许客户端直接读写，通过最小权限 RPC 暴露必要信息
- [x] RPC `get_puzzle_list`：返回可选题目列表，不暴露汤底
- [x] RPC `get_room_current_puzzle`：按成员身份返回当前题目，房主可见汤底
- [x] 管理员页面：查看、新增、编辑、软删除题目（`is_active` 开关）
- [x] 管理员 RPC：`admin_create_puzzle` / `admin_update_puzzle` / `admin_delete_puzzle`，仅 `service_role` 可调用
- [x] 补充 AI 上下文字段：`puzzles.points` / `puzzles.examples` JSONB，并从 `questions.json` 为 9 道题填充

### 6-B：房间开题流程 ✅

- [x] `rooms` 表新增 `current_puzzle_id`（外键 → `puzzles.id`，可为 null）
- [x] RPC `open_puzzle(room_code, puzzle_id)`：房主开题，写入 `current_puzzle_id`，发系统消息
- [x] RPC `close_puzzle(room_code)`：房主关闭当前题目，`current_puzzle_id` 置 null，发系统消息
- [x] 房间详情区展示当前题面（`surface`），汤底仅房主本地可见
- [x] 房主操作区：选题弹窗、题目预览确认、难度筛选、关闭/切换题目二次确认
- [x] Realtime 订阅 `rooms` 表 `current_puzzle_id` 变化，实时推送题目切换
- [x] 房间页右侧拆分为"房间管理"和"海龟汤"标签页，切换标签不卸载题目面板
- [x] 未选择题目时禁用询问/提示/尝试推理标签，并在开题/停题后实时同步聊天区状态
- [x] 题目弹窗使用 React Portal 挂载到 `document.body`，避免被详情容器裁切

### 6-C：AI 问答（DeepSeek 接入） ✅

- [x] 环境变量：`.env.example` 增加 `DEEPSEEK_API_KEY`（服务端，不加 `NEXT_PUBLIC_`）与 `DEEPSEEK_MODEL`
- [x] Route Handler：`/rooms/[code]/ask`（POST），鉴权 → 扣积分 → 调 DeepSeek → 写消息
- [x] 新迁移：`20260616040118_deepseek_ai_hosting.sql`，新增 `room_ai_requests`、`send_room_ai_request`、`finish_room_ai_request`
- [x] AI 调用失败/超时时通过 RPC 退回本次积分
- [x] 积分规则底层已接入聊天消息 RPC：询问/提示扣 1 pt，推理模式扣 2 pt；优先扣座位 `remaining_points`，不足扣个人积分
- [x] Prompt 构造：system 包含 `surface` + `bottom` + 最近上下文；询问包含 `examples` few-shot；推理包含 `points` 评分点
- [x] 推理评分改为 AI 返回每个关键点 `covered: true/false`，服务端按 true 数量计算正确/部分正确/不正确
- [x] 询问回复限制为 `"是"` / `"否"` / `"与此无关"` / `"模糊问题"` + 可选一句话提示
- [x] 回复以 AI 消息类型写入 `room_messages`（`message_type = 'ai'`）
- [x] 积分不足时前端使用站内弹窗提示当前余额
- [x] 聊天界面已区分聊天 / 询问 / 提示 / 尝试推理消息样式
- [x] 将聊天区询问/提示/尝试推理从本地消息模式接入真实 AI 调用结果
- [x] DeepSeek AI 数据库迁移已部署到远程 Supabase
- [x] 推理判定为"推理正确"时，`finish_room_ai_request` 把 `puzzle_progress.solved` 置为 `true`（迁移 `20260616062746_fix_reasoning_solved_writeback.sql`，修复此前推理通关后徽章和题库列表状态永远不更新的问题）
- [x] DeepSeek 本地环境变量已配置（`.env.local` 含 `DEEPSEEK_API_KEY`、`DEEPSEEK_MODEL=deepseek-v4-flash`）；生产环境配置仍需用户自行确认
- [x] "回答提问"和"生成提示"补齐 few-shot/已知事实上下文：`extractKnownFacts`/`extractGivenHints` 从本题历史 AI 消息提炼已知事实和已给提示，按 `puzzle_id` 过滤上下文，避免切题后串题
- [x] 同房间 AI 请求改为严格顺序处理（`pg_advisory_xact_lock` + 20 秒内未完成请求即拒绝），避免并发调用导致事实冲突
- [x] 事实总结公共白板：`get_room_chat_bootstrap` 返回 `room_messages.puzzle_id`，`room-chat.tsx` 从当前题目的 AI 消息提取去重后的 `fact_summary`，通过 `room-facts-request`/`room-facts-changed` 事件广播给 `puzzle-panel.tsx` 实时展示（迁移 `20260616114310_puzzle_facts_bootstrap_and_reason_tokens.sql`）；房主撤销事实、局终回放保留仍未实现
- [x] 题库整体导入 / 导出（`admin_replace_all_puzzles` RPC + 管理端下载/导入 JSON 按钮）
- [x] 推理正确后自动公布汤底并停止当前题目：先写入推理成功系统消息，再用 AI 消息样式展示汤底（迁移 `20260616123252_reasoning_solved_reveal_and_close.sql`、`20260616135145_ai_reasoning_messages_revamp.sql`）
- [x] 管理端消息审计支持查看最近 200 条消息，并解析推理覆盖点和询问审计信息（`src/app/admin/page.tsx`）
- [ ] **待做**：事实总结白板的房主撤销单条事实、局终在回放中保留的能力（当前只做到全房间共享展示和去重）
- [ ] **待做**：AI 输出 JSON 解析失败、DeepSeek 超时、模型输出截断时的前端文案还可以更细分，方便玩家理解是“退分了”还是“稍后重试”
- [ ] **待做**：管理员消息审计里的 AI JSON 仍以原文为主，可增加按题目/模式筛选和更友好的结构化展示

---

## 阶段七：UI 优化与体验打磨 🔄 进行中

**目标**：页面布局、移动端适配、交互细节。

- [x] 房间详情默认收起（座位、积分、房主操作）
- [x] 房间码旁复制按钮（`src/components/copy-room-code.tsx`）
- [x] 危险操作（关闭房间、踢人）使用站内确认组件，不用原生 `alert`
- [x] 全局 Header（`src/components/site-header.tsx`）
- [x] 移动端基础响应式样式：后台表单、房间码、聊天区和管理列表在窄屏下会改为单列或自适应（`src/app/globals.css`）
- [ ] **待做**：移动端真机/窄屏回归，重点检查房间详情、聊天输入区、弹窗和后台题库编辑表单是否有遮挡或滚动不顺
- [ ] **待做**：深色模式
- [ ] **待做**：房间大厅页（展示所有公开房间列表）
- [ ] **待做**：用户个人主页（历史房间、积分记录）
- [ ] **待做**：首页仍偏“输入房间码工具页”，如果想做公开房间大厅，可以把“加入房间”和“公开房间列表”合并成一个更完整的大厅

---

## 阶段八：安全与运维 🔄 持续关注

**目标**：权限模型完整、无泄漏、可观测。

- [x] RLS 覆盖所有用户可读表
- [x] `SECURITY DEFINER` 函数使用空 `search_path`
- [x] 私密数据（密码哈希、游客 token、私有 topic）不暴露给浏览器
- [x] `SUPABASE_SECRET_KEY` 只用于服务端
- [x] 普通聊天消息速率限制（每秒最多 2 条、每分钟最多 40 条，迁移 `20260616030906_chat_message_rate_limit.sql`）
- [x] 管理端房间清理：列出已关闭超过 3 天或超过 1 天无新消息的房间，并可强制关闭、退还临时积分、删除聊天记录（迁移 `20260616140701_admin_room_audit_cleanup.sql`、`20260616142945_hide_empty_cleaned_rooms.sql`，`src/components/admin-room-cleanup-list.tsx`）
- [ ] **待做**：积分相关操作速率限制（防止积分刷取或恶意消耗）
- [ ] **待做**：Supabase 日志监控 / 告警
- [ ] **待做**：错误边界与用户友好的错误页面
- [ ] **待做**：管理员直接改 `profiles.points` 目前走服务端管理员客户端直接更新表，若要完全符合“写操作通过 RPC”的项目边界，建议补一个 `admin_set_user_points` RPC 并写入交易流水
- [ ] **待做**：房间清理是手动操作，可后续接入定时任务或至少增加“仅清消息 / 关闭并清理”的二次确认与结果明细

---

## 本次项目巡检后的优先改进建议

> 这些不是阻塞项，但适合作为下一轮开发入口。优先级按“影响用户体验 / 安全边界 / 后续扩展成本”综合排序。

1. **统一管理员写操作到 RPC**：`updateUserPoints` 仍由服务端管理员客户端直接写 `profiles`，建议改为 RPC，顺便补齐 `points_transactions` 记录。这里像“所有现金收支都走柜台记账”，以后查账更稳。
2. **聊天输入区布局瘦身**：未开题提示目前在输入区下方渲染，会占高度；可改成禁用按钮的 hover 提示或放进“海龟汤”面板。
3. **公开房间大厅**：目前首页更像“凭房间码进入”的入口，适合下一步补公开房间列表、筛选和一键加入。
4. **用户个人主页**：展示历史房间、积分流水、当前活动房间和题目通关记录，能让积分系统更透明。
5. **事实白板管理**：房主撤销单条事实、局终回放保留，是 AI 主持体验的下一块拼图。
6. **生产运维与监控**：补 Supabase 日志/告警、AI 调用失败率统计、房间清理结果记录，方便上线后排查问题。
7. **深色模式与移动端精修**：现有样式已有基础响应式，但还需要按手机宽度逐页检查聊天、题库弹窗、后台编辑表单。

## 快速参考：关键文件

| 文件 | 作用 |
|------|------|
| `src/lib/types.ts` | 共享类型 |
| `src/lib/validation.ts` | Zod 表单验证 |
| `src/app/rooms/actions.ts` | 房间 Server Actions |
| `src/components/live-room-seats.tsx` | 座位实时展示 |
| `src/components/room-chat.tsx` | 聊天组件 |
| `src/app/rooms/[code]/messages/route.ts` | 消息服务端路由 |
| `supabase/migrations/` | 全部数据库迁移（按文件名顺序） |
