# AGENTS.md

本文件用于指导在此仓库中工作的 AI 编程助手。除非用户明确提出不同要求，否则遵守以下约定。

## 沟通方式

- 默认使用简体中文回复。
- 用户有编程基础，但经验有限。先给结论，再用简单语言说明原因。
- 遇到 RLS、RPC、Cookie、事务等概念时，可以用简短类比解释。例如：RLS 像数据库门卫，RPC 像只能从指定窗口办理的业务。
- 不要只给方案。只要风险可控，应完成代码修改、数据库迁移和验证。
- 不确定的信息先检查代码、迁移或实际数据库，不凭印象猜测。
- 本项目由 Codex 和 Claude Code 共同开发，用户提到的“同事”通常指 Claude Code。

## 项目概览

OnlineSoup（汤局）是一个多人在线海龟汤房间应用。

主要技术：

- Next.js 16 App Router
- React 19
- TypeScript 严格模式
- Supabase Auth、Postgres、Realtime
- `@supabase/ssr`
- Zod 表单验证
- DeepSeek AI 主持、GLM/Zhipu 辅助事实摘要和问答等价判断
- Resend 管理端邮件发送

功能和业务细节可能变化。处理具体任务时，以当前代码、`supabase/migrations`、`文档索引.md` 指向的文档和实际数据库为准，不把本文件当作完整功能清单。

## 常用入口

- `文档索引.md`：仓库文档地图。不熟悉业务或不确定该看哪份说明时，先读它。
- `src/app`：页面、路由、Server Actions 和 API Route。
- `src/components`：客户端组件及通用界面组件。
- `src/lib`：验证、类型、管理员判断和 Supabase 客户端。
- `src/lib/supabase/server.ts`：服务端普通用户客户端。
- `src/lib/supabase/client.ts`：浏览器客户端。
- `src/lib/supabase/admin.ts`：仅服务端可用的管理客户端。
- `src/lib/deepseek.ts`：AI 主持 prompt、DeepSeek 调用、GLM/DeepSeek 事实摘要和 ask 双路判定。
- `src/lib/qa-cache.ts`：问答缓存归一化、相似度和 GLM 等价判断。
- `src/lib/admin-verification.ts`：管理端二次验证和可信设备 Cookie。
- `src/lib/types.ts`：共享类型定义。
- `src/app/rooms/[code]/ask/route.ts`：AI 询问、提示、推理的服务端入口。
- `src/app/rooms/[code]/messages/route.ts`：成员聊天消息读写入口。
- `src/app/feedback/page.tsx`、`src/app/feedback/actions.ts`、`src/components/feedback-form.tsx`：用户反馈页面、提交 Server Action 和表单组件。
- `src/components/room-chat.tsx`、`src/components/live-room-seats.tsx`、`src/components/puzzle-panel.tsx`：房间页核心客户端组件。
- `src/app/admin/page.tsx`、`src/app/admin/actions.ts`、`src/components/admin-*.tsx`：管理后台页面、Server Actions 和后台组件。
- `supabase/migrations`：数据库迁移，按文件名顺序执行。
- `proxy.ts`：刷新 Supabase 登录会话。

使用 `@/*` 导入 `src/*` 下的模块。

## 环境与部署

本地开发将 `.env.example` 复制为 `.env.local` 并填写。变量以 `.env.example` 为准，常见包括：

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

- 缺少 Supabase 环境变量时，`src/lib/env.ts` 会让应用优雅降级，但房间相关功能不可用。
- `DEEPSEEK_BASE_URL`、`ZHIPU_API_KEY`、`ZHIPU_MODEL` 是代码支持的可选变量；没有 `ZHIPU_API_KEY` 时，问答缓存等价判断和 GLM 事实摘要会降级或跳过。
- 线上主域名：`https://onlinesoup.ai0506.com`。
- GitHub 仓库：`https://github.com/ai0506/OnlineSoup`，生产分支：`main`。
- Vercel 项目：`asw0506/online-soup`。本地 `.vercel/` 是部署元数据，不提交仓库。
- 用户说“上传到 GitHub”或“创建 PR”时，默认推送后继续合并到 `main` 并推送，除非用户明确要求不要合并。
- 检查线上环境变量时只确认变量名是否存在，不打印变量值。
- 不在日志、回复或仓库中暴露 secret key、token、数据库密码或完整连接串。

## 测试账号

- 普通用户流程可使用测试账号：用户名 `test`，密码 `123456`。
- 该账号不能作为管理员权限或安全边界验证依据。

## 开发原则

- 优先沿用现有 App Router、Server Action、Zod、Supabase RPC 和样式模式。
- Next.js 16 的动态路由参数和部分请求 API 是异步形态；修改路由时先看同目录现有写法。
- 页面负责展示和收集输入，关键业务规则放在数据库事务或受保护的服务端入口中。
- Server Action 收到的 `FormData` 必须先验证，再访问数据库。
- 前端文案面向用户任务，不展示迁移名、阶段名、内部同步细节等开发信息。
- 不使用浏览器原生 `alert`、`confirm` 或 `prompt`；提示和二次确认使用站内样式一致的组件。
- 新功能不要直接挤进已有主界面。复杂信息优先放到按钮、弹层、抽屉、折叠面板或详情面板中。
- 聊天输入框附近不要新增会撑高布局的提示文字；错误、积分不足、发送太频繁等提示使用现有浮层对话框样式。
- 房间页优先突出聊天和房间码；座位、积分、房主操作等次要信息默认收进“房间详情”。
- 表单尽量提供合理默认值并减少重复步骤，但前后端验证必须一致。
- 保持修改范围小，不顺手重构无关代码。
- 中文界面文本使用 UTF-8，不引入乱码。
- 不添加无意义注释；复杂事务或安全边界可以写简短说明。

## 管理后台约束

- 管理端入口在 `/admin`，访问前需要管理员身份和二次验证；可信设备通过 HttpOnly HMAC Cookie 记住，不把验证码或设备信任状态暴露给前端脚本。
- 管理后台现有主标签包括账户、题库、消息与案例、房间、积分流水、用户反馈、邮件发送；消息下有审计、AI 错误案例和聊天备份子标签。
- 后台新增复杂操作优先使用按钮进入弹窗、二级界面或子标签，不直接把大表单塞进列表。
- 后台筛选和写操作应尽量保留原 tab、子 tab 和筛选参数；避免用户操作后被带回默认页面。
- 消息、房间等会自动刷新；输入框聚焦或弹窗打开时不要强制刷新打断管理员操作。
- 管理端导出、备份、批量操作和缓存管理只能走服务端管理员入口，不能给普通用户或浏览器开放私密表权限。

## Supabase 与数据安全

- 所有涉及多个表、积分、座位、房间状态或并发抢占的写操作必须通过 Supabase RPC 原子完成，不能在应用层拆成多次读写。
- 浏览器不直接写私密表或核心业务表。需要写入时走 Server Action、Route Handler 或最小权限 RPC。
- Supabase 相关改动必须同时检查 RLS、函数权限、调用角色和实际调用路径。
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` 可以在浏览器使用，但仍必须受 RLS 和函数权限保护。
- `SUPABASE_SECRET_KEY` 只能在服务端使用，绝不能添加 `NEXT_PUBLIC_` 前缀、写入日志或提交仓库。
- `createAdminClient()` 只能用于确实需要管理权限的服务端功能。
- 不要假设 secret key 自动拥有所有表权限；遇到权限问题要检查 grant、RLS 和函数 owner。
- 私密数据（如密码哈希、游客 token、私密 Realtime topic、`room_private`、`guest_sessions` 等）不能返回给非成员或浏览器。
- 身份判断优先使用 `auth.getUser()`、`auth.uid()` 或经过验证的服务端上下文，不使用用户可改的 metadata。
- `SECURITY DEFINER` 函数必须设置空 `search_path`，函数体使用完整 schema 名。
- 新函数应先 `revoke ... from public`，再只向需要的 `anon`、`authenticated` 或 `service_role` 授权。
- 管理端读取私密表通常使用 `createAdminClient()`，但仍要确认 `service_role` 的表权限和 RPC 权限；不要把权限错误修成公开读写。

## 房间、游客与聊天约束

- 房间码统一转大写，格式为 6 位字母或数字。
- 注册用户名和访客名统一为 3 到 8 位，仅允许英文字母、数字和下划线。
- 注册用户名全局忽略大小写判重，但展示时保留用户输入的大小写。
- 登录用户进入房间使用 `profiles.username`，不能再由客户端提交临时昵称。
- 游客身份依赖 HttpOnly Cookie：`guest_identity` 标识浏览器，`guest_room_<CODE>` 证明房间成员身份。不要改成前端 JavaScript 可读存储。
- 加入、退出、踢人、关闭房间、移动座位、赠送积分等流程必须保持 Cookie、座位、游客会话和积分状态一致。
- 当前实现包含单会话、房间级设备锁和同账号房间接管；修改进入、返回房间、刷新恢复或离开流程时，必须同时考虑被其他设备接管后的只读/跳转提示。
- 同一房间的名字唯一性、座位占用、密码校验和被踢校验必须在数据库事务中完成。
- 房间消息读写必须验证成员身份，不能只凭房间码访问。
- Realtime 只用于及时刷新界面，不能作为唯一事实来源；页面恢复、订阅断开或事件遗漏时要通过受保护接口补拉状态。
- 修改房间流程时，至少考虑有密码/无密码、登录用户/游客、大小写重名、刷新恢复、多设备接管、并发加入和被踢/关房场景。

## 用户反馈

- 反馈入口是独立页面 `/feedback`，从站点头部新标签打开；它不调用任何房间 RPC，不能影响房间座位、设备锁或会话状态。
- 只有注册用户可提交，访客不可；页面和 Server Action 都要各自校验登录态，不能只靠前端隐藏入口。
- 分类固定为 `bug`/`ai`/`suggestion`/`puzzle`/`other`，正文统一 1–2000 字，前端和数据库都要验证。
- 每账号每天（`Asia/Shanghai` 自然日）限 3 条，判定在 `submit_user_feedback` RPC 内配合 advisory lock 完成；超限只对玩家提示“发送太频繁”，不暴露具体额度。
- `user_feedback` 表只授 `service_role`；玩家侧走 `submit_user_feedback`（`authenticated`），管理端状态流转走 `admin_update_feedback`（`service_role`）。
- 内部备注、来源页面、设备和地点标签只在管理端展示，不返回给玩家；不记录原始 IP。

## 积分、题库与 AI 主持

- 积分扣除、退还和交易记录必须由数据库事务保证一致性。
- 房间临时积分和个人积分的显示、扣除优先级以当前代码和 RPC 为准；改动时同时检查前端展示和数据库逻辑。
- 题库、当前题目、通关状态和 AI 消息结构以当前表结构和迁移为准。
- 聊天模式当前为普通聊天、询问、提示、尝试推理；字数、积分消耗、提示机会和前后端验证必须保持一致。
- AI 上下文必须按当前题目隔离，避免旧题目的事实、提示或缓存串入新题目。
- 同一房间的 AI 请求需要顺序处理，避免并发调用导致事实冲突或重复扣费。
- AI 调用失败或超时时，应通过既有补偿逻辑退回本次扣费。
- ask 模式使用严格/推断双路判断，必要时仲裁；内部 `ask_audit`、`reason`、`cache_hit` 只供管理后台排查，返回玩家前必须剥离。
- 问答缓存 `puzzle_qa_cache` 只缓存稳定的 yes/no 问题。新缓存先进入 pending，管理员批准后才能命中；代词、复合问题、低价值问题和非 yes/no 不应缓存。
- 事实摘要优先由 GLM 生成，失败时可回退 DeepSeek；只把确认稳定的 yes/no 事实写入全房间事实面板，不把推理结果、玩家假设或调试信息污染为事实。
- 修改 AI prompt、examples、缓存或判定规则时，应同步检查管理端消息审计、AI 错误案例、缓存面板和玩家侧输出脱敏。

## 题库 Examples 与 AI 错误

- 题目 examples 当前区分 fact 和 inferential 两类；ask 模式两路判断只读取各自模型适用的 examples。
- 生成或修改 examples 时，优先使用项目内 `puzzle-example-generator` skill，并做预览、边界类型、近似重复、key point 复读和线上回读验证。
- 分析 AI 错误案例时，应先判断问题来自 prompt、examples、问答缓存、事实摘要还是代码流程，再制定小步修复和回归验证。
- 涉及 AI 错误分析或修复规划的材料应归档到 `ai-error/M-D/`，包含错误分类、根因、修复方案、验证条目和实施顺序。

## 数据库迁移

- 已部署的迁移文件不可修改。数据库变化必须创建新的迁移。
- 使用 Supabase CLI 创建迁移文件：

```powershell
npx.cmd supabase migration new descriptive_name
```

- 迁移名称使用简短英文 snake_case。
- SQL 尽量可重复执行，合理使用 `create or replace`、`if exists`、`if not exists`。
- 修改 RPC 时处理旧签名，避免 PostgREST 因函数重载产生歧义。
- 新增或修改函数后执行 `notify pgrst, 'reload schema';`。
- 部署前先预览迁移，部署后检查迁移记录、函数签名、权限和真实 RPC 调用。
- 如果直连 Supabase 数据库出现 `tls error (EOF)`，不要反复重试；优先按项目现有方式使用 Session Pooler（IPv4）。
- 需要数据库密码时，允许从本机 `.env.local` 读取 `SUPABASE_DB_PASSWORD`，但只能放在当前 PowerShell 会话临时变量中使用，不能写入仓库、日志或回复。

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

涉及页面、路由、Server Action、数据库或构建配置时，再运行：

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

- 每次完成任何改动后，在与 `AGENTS.md` 相同目录下查找 `updates.md`，不存在则创建，并追加一行：

```text
[CodeX][YYMMDDHHMMSS] the updates
```

- 时间戳使用当前时间，`the updates` 替换为本次改动的简短说明。
- 当用户要求查看更新记录时，读取 `updates.md` 并展示内容。

## 禁止事项

- 不提交 `.env.local`、token、密码或 secret key。
- 不在客户端导入 `src/lib/supabase/admin.ts`。
- 不通过开放 RLS 或滥用 `SECURITY DEFINER` 绕过权限错误。
- 不直接把私密表改成公开可读来修复页面问题。
- 不把关键业务事务拆成容易产生竞态条件的多次请求。
- 不删除或覆盖用户已有的无关改动。
- 不在未验证的情况下宣称数据库迁移或功能已经上线。
