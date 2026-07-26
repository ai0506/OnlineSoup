# CLAUDE.md

本文件用于指导在此仓库中工作的 AI 编程助手。除非用户明确提出不同要求，否则应遵守以下约定。

## 沟通方式

- 默认使用简体中文回复。
- 用户有编程基础，但经验有限。解释专业问题时先说结论，再用简单语言说明原因。
- 遇到 RLS、RPC、Cookie、事务等概念时，可以使用简短类比。
- 不要只给方案。只要风险可控，就应完成代码修改、数据库迁移和验证。
- 不确定的信息先检查代码、迁移或实际数据库，不要凭印象猜测。
- 该项目由 Codex 和 Claude Code 共同开发，用户提到的同事指 Codex。

## 项目概览

OnlineSoup（汤局）是一个多人在线海龟汤房间应用。

已部署网址：https://onlinesoup.ai0506.com/（Vercel 托管）。

主要技术：Next.js 16 App Router、React 19、TypeScript 严格模式、Supabase Auth/Postgres/Realtime、`@supabase/ssr`、Zod 表单验证、DeepSeek AI 主持、GLM/Zhipu 辅助事实摘要和问答等价判断、Resend 管理端邮件发送。

功能和业务细节可能变化。处理具体任务时，以当前代码、`supabase/migrations`、`文档索引.md` 指向的文档和实际数据库为准，不把本文件当作完整功能清单。

## 环境配置

将 `.env.example` 复制为 `.env.local` 并填写。变量以 `.env.example` 为准，常见包括：

```env
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
NEXT_PUBLIC_SITE_URL=
SUPABASE_SECRET_KEY=
ADMIN_EMAILS=
RESEND_API_KEY=
ADMIN_EMAIL_FROM=
DEEPSEEK_API_KEY=
DEEPSEEK_MODEL=
DEEPSEEK_BASE_URL=
ZHIPU_API_KEY=
ZHIPU_MODEL=
```

缺少 Supabase 环境变量时，`src/lib/env.ts` 会让应用优雅降级，但房间相关功能不可用。`DEEPSEEK_BASE_URL`、`ZHIPU_API_KEY`、`ZHIPU_MODEL` 是代码支持的可选变量；没有 `ZHIPU_API_KEY` 时，问答缓存等价判断和 GLM 事实摘要会降级或跳过。

## 目录说明

- `文档索引.md`：仓库文档地图，开始不熟悉的任务时先读此文件
- `src/app`：页面、路由、Server Actions 和 API Route
- `src/components`：客户端组件及通用界面组件
- `src/lib`：验证、类型、管理员判断和 Supabase 客户端
  - `src/lib/supabase/server.ts`：服务端普通用户客户端（Server Actions/组件）
  - `src/lib/supabase/client.ts`：浏览器客户端
  - `src/lib/supabase/admin.ts`：仅服务端可用的管理客户端
  - `src/lib/deepseek.ts`：AI 主持 prompt、DeepSeek 调用、GLM/DeepSeek 事实摘要和 ask 双路判定
  - `src/lib/qa-cache.ts`：问答缓存归一化、相似度和 GLM 等价判断
  - `src/lib/admin-verification.ts`：管理端二次验证和可信设备 Cookie
  - `src/lib/types.ts`：共享类型（`Profile`、`Room`、`RoomSeat`、`RoomMessage` 等）
- `supabase/migrations`：按文件名顺序执行的数据库迁移
- `src/app/rooms/[code]/ask/route.ts`：AI 询问、提示、推理的服务端入口
- `src/app/rooms/[code]/messages/route.ts`：成员聊天消息的服务端读写入口
- `src/app/admin/page.tsx`、`src/app/admin/actions.ts`、`src/components/admin-*.tsx`：管理后台页面、Server Actions 和后台组件

使用 `@/*` 导入 `src/*` 下的模块。

## 数据层 — Supabase RPC

所有涉及多个表、积分、座位、房间状态、AI 请求或并发抢占的写操作必须通过 **Supabase RPC 函数** 原子完成，不能在应用层拆成多次读写。可以把 RPC 理解成“数据库里的办事窗口”：一次提交材料，窗口内部把检查、扣费、写流水、改座位一起办完，避免办到一半被别人插队。

RPC 清单会随迁移变化，不在本文件维护完整表。处理具体任务时查看最新 `supabase/migrations`、调用路径和实际数据库函数签名。修改 RPC 时要同时检查旧签名、函数权限、RLS、`service_role` 权限和 PostgREST schema reload。

## 认证与游客身份

注册用户通过 Supabase Auth 认证。游客身份依赖两个 HttpOnly Cookie（`sameSite: lax`，生产环境 `secure`）：

1. **`guest_identity`** — 持久化随机 hex（1 年），稳定识别浏览器
2. **`guest_room_<CODE>`** — `join_room_as_guest` 返回的 per-room token，退出或被踢时清除

不要将这两个 Cookie 改成可被前端 JavaScript 读取的存储。

## 积分系统

房主创建房间时消耗积分（`points_per_seat × seat_count`，`points_per_seat` 允许为 0，数据库约束 `0–100`）。每个座位有 `remaining_points`，AI 查询费优先扣座位积分，不足时再扣个人积分。

- **关闭房间**：`close_room` RPC 必须汇总所有座位 `remaining_points` 退还给房主并写入 `points_transactions`。
- **积分显示**：`个人积分+房间积分[临]`（如 `999+14[临]`），无房间积分时只显示个人积分。
- **赠送积分**：必须使用房主的个人积分（`profiles.points`），不能挪用自己座位的 `remaining_points`。
- **前端更新**：房间页由座位和聊天组件协作刷新。个人积分通过 `live-room-seats` 的唯一 `profiles` Realtime 订阅广播给聊天区；房间临时积分和提示机会从 `room_seats` 状态派生，并有轮询兜底。

## 开发原则

- 优先沿用现有 App Router、Server Action、Zod 和 Supabase RPC 模式。
- Next.js 16 的动态路由参数和部分请求 API 是异步形态；修改路由时先看同目录现有写法。
- 前端文案面向用户任务，不展示迁移名称、自动同步等开发实现细节。
- 不使用浏览器原生 `alert`、`confirm` 或 `prompt`；提示和确认使用站内样式一致的组件。
- 新功能不要直接挤进已有主界面区域；补充信息、表单或复杂操作优先使用明确按钮入口，点击后进入二级界面、抽屉或弹层。
- 聊天框区域不新增会撑高布局的文字提示；错误、积分不足、频率超限等提示统一用浮层对话框（`dialog-backdrop` / `dialog-panel`）。
- 房间页优先突出聊天和房间码；座位、积分、房主操作等次要信息默认收进"房间详情"。
- 涉及多个表、积分、座位或并发抢占时，必须使用数据库 RPC，不能在应用层分多步读写。
- Server Action 收到的 `FormData` 必须先验证，再访问数据库。
- 保持修改范围小，不顺手重构无关代码；不添加无意义注释。

## 管理后台约束

- 管理端入口在 `/admin`，访问前需要管理员身份和二次验证；可信设备通过 HttpOnly HMAC Cookie 记住，不把验证码或设备信任状态暴露给前端脚本。
- 管理后台现有主标签包括账户、题库、消息与案例、房间、积分流水、邮件发送；消息下有审计、AI 错误案例和聊天备份子标签。
- 后台新增复杂操作优先使用按钮进入弹窗、二级界面或子标签，不直接把大表单塞进列表。
- 后台筛选和写操作应尽量保留原 tab、子 tab 和筛选参数；避免用户操作后被带回默认页面。
- 消息、房间等会自动刷新；输入框聚焦或弹窗打开时不要强制刷新打断管理员操作。
- 管理端导出、备份、批量操作和缓存管理只能走服务端管理员入口，不能给普通用户或浏览器开放私密表权限。

## Supabase 与安全边界

- 任何 Supabase 相关改动都要同时检查 RLS、函数权限和调用角色。
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 可在浏览器使用，但必须受 RLS 和函数权限保护。
- `SUPABASE_SECRET_KEY` 只能在服务端使用，绝不能加 `NEXT_PUBLIC_` 前缀、写入日志或提交仓库。
- `createAdminClient()` 只用于确实需要管理权限的服务端功能。
- 不要假设 secret key 自动拥有表权限——曾因 `room_messages` 只 revoke 未 grant `service_role` 导致服务端读取静默失败。
- `room_private`、`guest_sessions` 等私密数据不能直接暴露给浏览器；公开页面所需信息应通过最小权限 RPC 返回。
- 不要把密码哈希、游客 token 或 Realtime 私密 topic 返回给非成员。
- 身份和授权判断使用 `auth.getUser()` 或经过验证的 claims，不使用用户可修改的 metadata。
- `SECURITY DEFINER` 函数必须设置空 `search_path`，并在函数体中使用完整 schema 名。
- 新函数先 `revoke ... from public`，再只向需要的角色（`anon`/`authenticated`/`service_role`）授权。
- 管理端读取私密表通常使用 `createAdminClient()`，但仍要确认 `service_role` 的表权限和 RPC 权限；不要把权限错误修成公开读写。

## 房间业务约束

- 房间码统一为大写 6 位字母或数字。
- 用户名和访客名：3–8 位，仅允许英文字母、数字和下划线；用户名全局忽略大小写判重，展示时保留原输入。
- 登录用户进入房间时使用 `profiles.username`，不能由客户端提交临时昵称。
- 访客名不能与任何注册用户名重复，也不能与当前房间任意成员重名（唯一性检查必须在锁住房间的事务中完成）。
- 缺少用户名的历史账户只能进入用户名设置流程，不能创建或加入房间。
- 用户在活动房间时不能修改用户名；历史账户首次补设用户名可同步当前注册座位。
- 新房间状态必须明确设为 `waiting`，不能只依赖数据库默认值。
- 游客只能在房间状态为 `waiting` 时加入。
- 加入房间时，RPC 必须原子完成校验（状态/密码/被踢/名字冲突）和座位分配，同时在同一事务中退出旧座位。
- 登录用户若拥有自己创建的活动房间，须先关闭旧房间再加入新房间。
- 积分扣除、房间创建、座位创建必须在同一个数据库事务中完成。
- 关闭、退出、踢人等动作必须保持 Cookie、座位和游客会话状态一致。
- 大厅进入房间时，应优先恢复当前活动房间，避免同一浏览器停留在多个冲突房间。
- 当前实现包含单会话、房间级设备锁和同账号房间接管；修改进入、返回房间、刷新恢复或离开流程时，必须同时考虑被其他设备接管后的只读/跳转提示。

## 聊天与 Realtime

- 聊天各模式输入字数上限：普通聊天 300、询问 100、提示 50、尝试推理 300，前端和数据库 RPC 都必须验证。
- 普通聊天有速率限制（每秒最多 2 条、每分钟最多 40 条）；AI 请求（ask/hint/reason）同房间必须顺序处理（`pg_advisory_xact_lock`，同一时间只允许一个未完成请求）。
- 房间消息只允许当前房主或持有有效 Cookie 的成员读写；消息读写统一经过 `/rooms/[code]/messages` 路由，`room_messages` 不向 `anon`/`authenticated` 开放直接表权限。
- Realtime 用于及时刷新界面，不能作为唯一事实来源；页面重新可见、订阅断开时，应通过服务端接口补拉最新状态。
- 房间页并行使用 Supabase Realtime（`postgres_changes`）和轮询兜底，保证状态可靠性。

## 海龟汤题库与 AI 主持

- 题目数据存于 `puzzles` 表（`title`/`surface`/`bottom`/`difficulty`/`key_points`/`examples`），当前题目记录在 `rooms.current_puzzle_id`，通关状态记录在 `puzzle_progress`。
- 玩家只能看到 `surface`，房主额外能看到 `bottom`；房主通过 `open_puzzle` / `close_puzzle` RPC 切题。
- AI 上下文按 `puzzle_id` 过滤，避免切题后旧题目的事实、提示或缓存串入。
- AI 消息以结构化 JSON（`kind`/`text`/`fact_summary`）存入 `room_messages.content`，前端解析展示；旧版纯文本消息需保持兼容。
- ask 模式使用严格/推断双路判断，必要时仲裁；内部 `ask_audit`、`reason`、`cache_hit` 只供管理后台排查，返回玩家前必须剥离。
- 问答缓存 `puzzle_qa_cache` 只缓存稳定的 yes/no 问题。新缓存先进入 pending，管理员批准后才能命中；代词、复合问题、低价值问题和非 yes/no 不应缓存。
- 事实摘要优先由 GLM 生成，失败时可回退 DeepSeek；只把确认稳定的 yes/no 事实写入全房间事实面板，不把推理结果、玩家假设或调试信息污染为事实。
- 事实总结（`fact_summary`）去重后广播给全房间展示，不能只挂在单条消息下。
- 推理判定"正确"时必须将 `puzzle_progress.solved` 置为 `true`。
- 修改 AI prompt、examples、缓存或判定规则时，应同步检查管理端消息审计、AI 错误案例、缓存面板和玩家侧输出脱敏。

## 题库 Examples 与 AI 错误

- 题目 examples 当前区分 fact 和 inferential 两类；ask 模式两路判断只读取各自模型适用的 examples。
- 生成或修改 examples 时，优先使用项目内 `puzzle-example-generator` skill，并做预览、边界类型、近似重复、key point 复读和线上回读验证。
- 分析 AI 错误案例时，应先判断问题来自 prompt、examples、问答缓存、事实摘要还是代码流程，再制定小步修复和回归验证。
- 涉及 AI 错误分析或修复规划的材料应归档到 `ai-error/M-D/`，包含错误分类、根因、修复方案、验证条目和实施顺序。

## 数据库迁移

- 已部署的迁移文件不可修改，数据库变化必须创建新迁移。
- 创建迁移：`npx.cmd supabase migration new descriptive_name`（名称用英文 snake_case）。
- SQL 尽量可重复执行（`create or replace`、`if exists`/`if not exists`）。
- 修改 RPC 时正确处理旧签名，避免 PostgREST 函数重载歧义；修改后执行 `notify pgrst, 'reload schema';`。
- 部署前 dry-run 预览，部署后确认看到 `Applying migration ...` 和 `Finished supabase db push.`。

**TLS 错误处理**：`npx.cmd supabase db push --linked` 出现 `tls error (EOF)` 时，改用 Session Pooler（IPv4）连接。从 `supabase/.temp/pooler-url` 或 Supabase 控制台 Database/Connect 页面获取地址：

```powershell
$env:SUPABASE_DB_PASSWORD = "数据库密码"   # 读取 .env.local 中的值
$password = [Uri]::EscapeDataString($env:SUPABASE_DB_PASSWORD)
$dbUrl = "postgresql://postgres.<project-ref>:${password}@<session-pooler-host>:5432/postgres?sslmode=require"
npx.cmd supabase db push --db-url $dbUrl
Remove-Item Env:SUPABASE_DB_PASSWORD
Remove-Variable password, dbUrl
```

需要 db push 时允许读取本机 `.env.local` 中的 `SUPABASE_DB_PASSWORD`，但不能将其实际值写入任何文件、回复或日志。

## 常用命令

PowerShell 优先使用 `.cmd` 后缀：

```powershell
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npx.cmd supabase migration list --linked
npx.cmd supabase db push --linked --dry-run
npx.cmd supabase db push --linked
```

## 完成前验证

代码修改后至少运行 `npm.cmd run typecheck` 和 `npm.cmd run lint`。涉及页面/路由/构建配置时再运行 `npm.cmd run build`。

涉及数据库时还须：确认迁移已记录；确认 RPC 可由预期角色调用；使用公开 key 验证公开 RPC；明确告知用户哪些检查已通过、哪些因环境限制未执行。

## Claude Code 更新记录

每次完成任何改动后，在 CLAUDE.md 相同目录下的 `updates.md`（不存在则创建）追加一行：

```
[Claude Code][YYMMDDHHMMSS] 本次改动的简短说明
```

## AI 错误分析与修复规划归档

当用户要求 Claude Code 分析 AI 错误问题或生成修复规划时，遵守上文“题库 Examples 与 AI 错误”的归档要求。Claude Code 文件名格式为 `[ClaudeCode][CSV文件名]修改规划ver{N}.md`，完成后同样在 `updates.md` 追加记录。

## 禁止事项

- 不提交 `.env.local`、token、密码或 secret key。
- 不在客户端导入 `src/lib/supabase/admin.ts`。
- 不通过开放 RLS 或滥用 `SECURITY DEFINER` 绕过权限错误。
- 不直接把私密表改成公开可读来修复页面问题。
- 不将关键业务事务拆成容易产生竞态条件的多次请求。
- 不删除或覆盖用户已有的无关改动。
- 不在未验证的情况下宣称数据库迁移或功能已上线。

## Test account

- Use username `test` and password `123456` for ordinary user-flow validation.
- This account is only for normal feature testing, not for admin permission or security-boundary verification.
