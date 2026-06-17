# AGENTS.md

本文件用于指导在此仓库中工作的 AI 编程助手。除非用户明确提出不同要求，否则应遵守以下约定。

## 沟通方式

- 默认使用简体中文回复。
- 用户有编程基础，但经验有限。解释专业问题时先说结论，再用简单语言说明原因。
- 遇到 RLS、RPC、Cookie、事务等概念时，可以使用简短类比。例如：RLS 像数据库门卫，RPC 像只能从指定窗口办理的业务。
- 不要只给方案。只要风险可控，就应完成代码修改、数据库迁移和验证。
- 不确定的信息先检查代码、迁移或实际数据库，不要凭印象猜测。

## 项目概览

OnlineSoup（汤局）是一个多人在线海龟汤房间应用。

主要技术：

- Next.js 16 App Router
- React 19
- TypeScript 严格模式
- Supabase Auth、Postgres、Realtime
- `@supabase/ssr`
- Zod 表单验证

当前主要功能：

- 邮箱注册、登录、退出和密码重置
- 全局唯一用户名、历史账户补设和用户改名
- 用户积分与管理员管理
- 创建、关闭房间
- 可选房间密码
- 游客加入、退出、被踢和刷新后恢复身份
- 自动恢复当前活动房间，加入新房间时清理旧房间身份
- 房间座位、成员聊天与 Realtime 状态同步
- 房主赠送积分、移动玩家座位
- 海龟汤题库（房主选题/关题，管理端新增、编辑、软删除、整体导入导出）
- 聊天区询问 / 提示 / 尝试推理三种模式，接入 DeepSeek AI 主持作答与积分扣除

## 环境配置

将 `.env.example` 复制为 `.env.local` 并填写：

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
```

缺少环境变量时应用会优雅降级（`src/lib/env.ts` 中的 `hasSupabaseEnv()` 守卫所有 Supabase 调用），但房间功能不可用。

## 目录说明

- `文档索引.md`：仓库 Markdown 文档地图，说明各文档的用途、优先级和推荐阅读顺序；开始不熟悉的任务或不确定应查看哪份说明时，先阅读此文件
- `src/app`：页面、路由、Server Actions 和 API Route
- `src/components`：客户端组件及通用界面组件
- `src/lib`：验证、类型、管理员判断和 Supabase 客户端
- `src/lib/supabase/server.ts`：服务端普通用户客户端
- `src/lib/supabase/client.ts`：浏览器客户端
- `src/lib/supabase/admin.ts`：仅服务端可用的管理客户端
- `src/lib/types.ts`：共享类型定义（`Profile`、`Room`、`RoomSeat`、`RoomMessage`、`RoomChatBootstrap`）
- `supabase/migrations`：按文件名顺序执行的数据库迁移
- `proxy.ts`：刷新 Supabase 登录会话
- `src/app/rooms/[code]/messages/route.ts`：成员聊天消息的服务端读写入口

使用 `@/*` 导入 `src/*` 下的模块。

处理具体功能前，建议根据 `文档索引.md` 定位相关业务设计、任务进度或 Supabase/Postgres 参考资料，避免只依据单份可能过时的文档做判断。

## 数据层 — Supabase RPC

所有数据库写操作必须通过 **Supabase RPC 函数**（Postgres 存储过程），不允许从应用层直接写表。主要 RPC：

| RPC                                            | 用途                                  |
| ---------------------------------------------- | ----------------------------------- |
| `create_room`                                  | 房主创建房间，扣除积分（`points_per_seat` 可为 0） |
| `join_room_as_member` / `join_room_as_guest`   | 分配座位                                |
| `leave_room_as_member` / `leave_room_as_guest` | 释放座位                                |
| `kick_guest`                                   | 房主踢出玩家                              |
| `close_room`                                   | 房主关闭房间，退还全部座位剩余积分之和给房主              |
| `gift_points_to_seat`                          | 房主将个人积分赠送给指定座位（不能使用自己的座位积分）         |
| `move_seat`                                    | 房主将玩家从一个座位移动到另一个空座位（房主座位不可移动）       |
| `get_room_exit_reason`                         | 返回 `"closed"` / `"kicked"` / `null` |
| `get_room_chat_bootstrap`                      | 返回 Realtime topic、近期消息和 seat_id     |
| `send_room_chat_message`                       | 插入聊天消息                              |
| `verify_guest_membership`                      | 验证游客 token 是否仍有效                    |
| `get_my_active_room`                           | 返回登录用户当前活动房间码                       |

两个 Supabase 客户端：

- `src/lib/supabase/server.ts` — 服务端组件和 Server Actions（`createServerClient` from `@supabase/ssr`）
- `src/lib/supabase/client.ts` — 客户端组件（`createBrowserClient` from `@supabase/ssr`）

## 认证与游客身份

注册用户通过 Supabase Auth 认证。游客身份依赖两个 HttpOnly Cookie：

1. **`guest_identity`** — 持久化随机 hex 字符串（1 年），标识浏览器
2. **`guest_room_<CODE>`** — `join_room_as_guest` 返回的 per-room token，退出或被踢时清除

两个 Cookie 均为 `httpOnly`、`sameSite: lax`，生产环境设置 `secure`。

## 实时更新

房间页面并行使用两种策略以保证可靠性：

- **Supabase Realtime**（`postgres_changes`）频道 — `room-seats:<roomId>` 和 `room-messages:<roomId>`
- **轮询兜底** — `LiveRoomSeats` 每 3 秒 `syncSeats`，`RoomChat` 每 2 秒刷新消息，页面重新可见/获焦/上线时同步

## Server Actions 模式

所有写操作使用 Next.js Server Actions（`"use server"`）。需要渐进表单状态的 Action 使用 `useActionState` 模式，配合 `RoomActionState`（`{ status, message, navigateTo, seatId }`）。简单跳转类 Action（如 `createRoom`）直接调用 `redirect()`。

`RoomActionForm`（`src/components/room-action-form.tsx`）是薄客户端包装，通过 `useActionState` 调用任意 Server Action，并在成功后处理 `navigateTo` 跳转。

## 积分系统

房主创建房间时消耗积分（`points_per_seat × seat_count`）。每个座位有 `remaining_points`。聊天区询问/提示/尝试推理已接入真实积分扣除（询问/提示 1 pt，推理 2 pt），优先扣座位 `remaining_points`，不足时再扣个人积分。

积分系统行为规范：

- `points_per_seat` 允许为 0，表示本场不预留积分；数据库约束为 `0 到 100`。
- 关闭房间时，`close_room` RPC 必须汇总所有座位的 `remaining_points` 并退还给房主（`profiles.points`），同时写入 `points_transactions`。
- 积分显示格式：`个人积分+房间积分[临]`（例如 `999+14[临]`）；无房间积分时只显示个人积分。个人积分来自 `profiles.points`，房间积分来自当前座位的 `remaining_points`。
- 前端在房间页通过 Realtime 订阅 `profiles` 表实时更新个人积分；房间积分从 `room_seats` 状态派生，无需单独订阅。
- 赠送积分必须使用房主的**个人积分**（`profiles.points`），不能挪用自己座位的 `remaining_points`。赠送目标为其他座位的 `remaining_points`。
- AI 查询费扣除优先消耗座位的 `remaining_points`，不足时再扣个人积分，由 `send_room_chat_message` RPC 在数据库层面实现。

## 开发原则

- 优先沿用现有 App Router、Server Action、Zod 和 Supabase RPC 模式。
- 前端文案面向用户任务，不展示 `Phase 1`、迁移名称、自动同步等开发实现或进度标记。
- 不使用浏览器原生 `alert`、`confirm` 或 `prompt`；提示和二次确认使用站内样式一致的组件。
- 聊天框（输入框及其下方区域）不要新增会撑高/挤动布局的文字提示，错误、积分不足、发送太频繁等提示统一用浮层对话框（`dialog-backdrop` / `dialog-panel`），不要在聊天输入框下方插入说明文字或错误文案。
- 房间页优先突出聊天和房间码；座位、积分、房主操作等次要信息默认收进"房间详情"。
- 表单尽量提供合理默认值并减少重复步骤，但必填、格式和安全规则必须在前后端保持一致。
- 常用结果应提供直接操作，例如房间码旁提供复制按钮；危险操作应放在次要区域并明确标注。
- 页面负责展示和收集输入，关键业务规则交给数据库事务处理。
- 涉及多个表、积分、座位或并发抢占时，必须使用数据库 RPC，不能在应用层分多步读写。
- Server Action 收到的 `FormData` 必须先验证，再访问数据库。
- 保持修改范围小，不顺手重构无关代码。
- 中文界面文本使用 UTF-8，不要引入乱码。
- 不要添加无意义注释；复杂事务或安全边界可以写简短说明。

## Supabase 与安全边界

- 任何 Supabase 相关改动都要同时检查 RLS、函数权限和调用角色。
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 可以在浏览器使用，但仍必须受 RLS 和函数权限保护。
- `SUPABASE_SECRET_KEY` 只能在服务端使用，绝不能添加 `NEXT_PUBLIC_` 前缀、写入日志或提交仓库。
- `createAdminClient()` 只能用于确实需要管理权限的服务端管理功能。
- 不要假设 secret key 自动拥有表权限。当前项目曾因直接读取 `room_private` 失败而误判房间无密码，也曾因 `room_messages` 表只 revoke 未 grant `service_role` 导致服务端读取上下文静默失败。
- `room_private`、`guest_sessions` 等私密数据不能直接暴露给浏览器。公开页面需要的信息应通过最小权限 RPC 返回，例如只返回"是否需要密码"。
- 不要把密码哈希、游客 token 或 Realtime 私密 topic 返回给非成员。
- 游客身份依赖 HttpOnly Cookie：
  - `guest_identity` 用于稳定识别浏览器。
  - `guest_room_<CODE>` 用于证明房间成员身份。
  - 不要改成可被前端 JavaScript 读取的存储。
- 身份和授权判断优先使用 `auth.getUser()` 或经过验证的 claims，不使用用户可修改的 metadata 作为权限依据。
- `SECURITY DEFINER` 函数必须设置空 `search_path`，并在函数体中使用完整 schema 名。
- 新函数应先 `revoke ... from public`，再只向需要的 `anon`、`authenticated` 或 `service_role` 角色授权。

## 房间业务约束

- 房间码统一转换为大写，格式为 6 位字母或数字。
- 注册用户名和访客名统一为 3 到 8 位，仅允许英文字母、数字和下划线。
- 注册用户名在整个项目中忽略英文大小写判重，但展示时保留用户输入的大小写。
- 登录用户进入房间时必须使用 `profiles.username`，不能再由客户端提交临时昵称。
- 匿名访客加入时必须输入名字；访客名不能与任何注册用户名重复，也不能与当前房间任意成员重名。
- 其他房间已有同名访客时，不阻止注册或改名；注册用户进入该访客所在房间时应拒绝加入，并提示联系房主处理。
- 用户处于自己创建或加入的活动房间时不能修改已有用户名；历史账户首次补设用户名可以同步当前注册成员座位。
- 缺少用户名的历史账户只能进入用户名设置流程，不能创建、加入或操作房间。
- 新房间状态必须明确为 `waiting`，不要仅依赖可能漂移的数据库默认值。
- 游客只有在房间状态为 `waiting` 时可以加入。
- 房间密码流程是：先判断是否需要密码，验证成功后再让访客填写名字；登录用户直接使用用户名加入。
- 加入房间时必须由 RPC 原子完成：
  - 检查房间状态和密码
  - 检查是否被踢
  - 检查用户名或访客名冲突
  - 锁定并占用空座位
  - 注册成员写入 `room_seats.user_id`，匿名访客创建会话和 token
- 加入新房间时，应在同一 RPC 事务中退出旧成员座位；登录用户若仍拥有自己创建的活动房间，则关闭旧房间后再加入新房间。
- 积分扣除、房间创建、座位创建必须在同一个数据库事务中完成。
- 关闭、退出、踢人等动作必须保持 Cookie、座位和游客会话状态一致。
- 注册成员身份以经过验证的 `auth.uid()` 和 `room_seats.user_id` 为准，不依赖游客 Cookie；匿名访客继续使用 HttpOnly Cookie。
- 同一房间的名字唯一性检查必须在锁住房间的数据库事务中完成，不能只做前端可用性检查。
- 大厅进入房间时，登录成员或已有游客身份应优先恢复当前活动房间，避免同一浏览器同时停留在多个身份冲突的房间。
- 修改房间流程时，同时检查有密码、无密码、登录用户、匿名游客、大小写重名、刷新页面和并发加入场景。

## 聊天与 Realtime

- 聊天内容长度为 1 到 500 个字符，前端和数据库 RPC 都必须验证。
- 房间消息只允许当前房主或持有有效房间 Cookie 的游客读取和发送；不能只凭房间码访问。
- 浏览器不直接写入 `room_messages`。消息读写统一经过 `/rooms/[code]/messages`，再由最小权限 RPC 验证成员身份。
- `room_messages` 不向 `anon` 或 `authenticated` 开放直接表权限；私密 Realtime topic 也不能返回给非成员。
- 初次进入房间只加载最近 100 条消息，并按创建时间和消息 ID 稳定排序。
- Realtime 只用于及时刷新界面，不能作为唯一事实来源。页面重新可见、订阅断开或事件遗漏时，应通过受保护的服务端接口补拉最新状态。
- 座位变化、踢出和房间关闭需要同时处理 Realtime 事件与页面恢复后的状态检查，避免后台标签页错过事件后仍显示旧成员状态。
- 普通聊天消息（chat 模式）有数据库层速率限制（每秒最多 2 条、每分钟最多 40 条）；积分消息（ask/hint/reason）不额外限速，但同房间的 AI 请求需顺序处理（见下）。

## 海龟汤题库与 AI 主持

- 题目数据存于 `puzzles` 表（`title`/`surface`/`bottom`/`difficulty`/`key_points`/`examples`），房间当前题目记录在 `rooms.current_puzzle_id`，通关状态记录在 `puzzle_progress`。
- 房主通过 `open_puzzle` / `close_puzzle` RPC 切题，玩家只能看到 `surface`，房主额外能看到 `bottom`。
- 聊天区询问 / 提示 / 尝试推理通过 `/rooms/[code]/ask` 路由调用 DeepSeek：鉴权 → 扣积分 → 调用 AI → 写消息；失败或超时时通过 `finish_room_ai_request` RPC 退回本次积分。
- AI 上下文按 `puzzle_id` 过滤，避免切题后旧题目的事实/提示串入新题目；已知事实和已给提示从历史 AI 消息的 `fact_summary`/提示文本中提炼，不能只依赖最近若干条原始聊天记录。
- 同一房间的 AI 请求必须严格按顺序处理（`pg_advisory_xact_lock` + 短时间窗口内只允许一个未完成请求），避免并发调用导致事实冲突。
- AI 消息以结构化 JSON（`kind`/`text`/`fact_summary`）存入 `room_messages.content`，前端负责解析展示；旧版纯文本消息需要保持兼容。
- 事实总结作为全房间共享的白板：从当前题目的 AI 消息中提取去重后的 `fact_summary`，通过前端事件广播展示，不能只挂在单条消息下面。
- 推理判定为"推理正确"时必须把 `puzzle_progress.solved` 置为 `true`，否则通关徽章和题库列表状态不会更新。

## 数据库迁移

- 已部署的迁移文件不可修改。数据库变化必须创建新的迁移。
- 使用 Supabase CLI 创建迁移文件：

```powershell
npx.cmd supabase migration new descriptive_name
```

- 迁移名称使用简短英文 snake_case。
- SQL 应尽量可重复执行，合理使用 `create or replace`、`if exists` 或 `if not exists`。
- 迁移中修改 RPC 后，应正确处理旧签名，避免 PostgREST 因函数重载产生歧义。
- 新增或修改函数后执行 `notify pgrst, 'reload schema';`。
- 部署前先预览迁移，部署后检查迁移记录、函数签名、权限和实际 RPC 调用。
- 如果 `npx.cmd supabase db push --linked` 连接 `db.<project-ref>.supabase.co` 时出现 `tls error (EOF)`：
  - 先检查 DNS 是否被 Clash/Mihomo Fake-IP 解析到 `198.18.0.0/15`，以及当前网络是否缺少可用 IPv6。
  - 不要反复重试直连；改用 Supabase 控制台提供的 Session Pooler（IPv4）连接。
  - 从 `supabase/.temp/pooler-url` 获取项目已生成的 Pooler 地址，或从 Supabase 控制台的 Database/Connect 页面复制 Session Pooler URI。
  - Database password 只放入当前 PowerShell 会话的临时环境变量，不写入 `.env.local`、命令历史文档或仓库：

```powershell
$env:SUPABASE_DB_PASSWORD = "数据库密码"
$password = [Uri]::EscapeDataString($env:SUPABASE_DB_PASSWORD)
$dbUrl = "postgresql://postgres.<project-ref>:${password}@<session-pooler-host>:5432/postgres?sslmode=require"
npx.cmd supabase db push --db-url $dbUrl
Remove-Item Env:SUPABASE_DB_PASSWORD
Remove-Variable password, dbUrl
```

  - 执行完成后必须看到具体迁移文件的 `Applying migration ...` 和 `Finished supabase db push.`，再确认迁移已部署。
  - 不要在回复、日志或仓库文件中记录实际数据库密码或包含密码的完整连接字符串。
- 不要把临时排错 SQL、访问令牌或数据库密码写入仓库。

## 常用命令

PowerShell 可能禁止执行 `npm.ps1` 或 `npx.ps1`，因此优先使用 `.cmd`：

```powershell
npm.cmd install
npm.cmd run dev
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
npx.cmd supabase migration list --linked
npx.cmd supabase db push --linked --dry-run
npx.cmd supabase db push --linked
```

## 完成前验证

代码修改后至少运行：

```powershell
npm.cmd run typecheck
npm.cmd run lint
```

涉及页面、路由、Server Action 或构建配置时，再运行：

```powershell
npm.cmd run build
```

涉及数据库时，还必须：

- 确认迁移已记录。
- 确认 RPC 可由预期角色调用。
- 使用公开 key 验证公开 RPC，不能只用管理员权限验证。
- 对本次修改对应的真实流程做一次端到端检查。
- 明确告诉用户哪些检查已通过，哪些因环境限制未执行。

## CodeX 更新记录

- 每次完成任何改动后，在**与 AGENTS.md 相同目录**下查找 `updates.md`（不存在则创建），并追加一行：

  ```
  [CodeX][YYMMDDHHMMSS] the updates
  ```

  时间戳使用当前时间，`the updates` 替换为本次改动的简短说明。
- 当用户要求查看更新记录时，读取该 `updates.md` 文件并展示内容。

## 禁止事项

- 不提交 `.env.local`、token、密码或 secret key。
- 不在客户端导入 `src/lib/supabase/admin.ts`。
- 不通过开放 RLS 或滥用 `SECURITY DEFINER` 来绕过权限错误。
- 不直接把私密表改成公开可读来修复页面问题。
- 不将关键业务事务拆成容易产生竞态条件的多次请求。
- 不删除或覆盖用户已有的无关改动。
- 不在未验证的情况下宣称数据库迁移或功能已经上线。
