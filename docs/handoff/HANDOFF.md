# OnlineSoup 项目交接与新电脑迁移说明

生成日期：2026-08-05

> 归档文档：迁移已完成。本文描述 2026-08-05 当时的目录结构，其中 `HANDOFF.md` 与 `FILE_TRANSFER_LIST.md` 已移入 `docs/handoff/`，`logo-archive/` 已移入 `archive/logo-archive/`。当前目录结构以 `文档索引.md` 和仓库实际内容为准。

## 项目简介

OnlineSoup（汤局）是一个多人在线海龟汤房间应用。玩家可以注册或以游客身份加入房间，在房间内聊天、开题、向 AI 主持人提问并共同推理；管理员可以维护用户、题库、消息、反馈和积分。

当前 Git 主分支为 `main`，本文件生成时已与 `origin/main` 同步。项目可在本地启动；数据库、认证和 Realtime 使用现有 Supabase 云端项目，因此新电脑应连接同一个项目，而不是新建一个空项目。

技术栈：Next.js 16 App Router、React 19、TypeScript、Supabase（Auth / PostgreSQL / Realtime / RLS / RPC）、Zod、DeepSeek、GLM/Zhipu、Resend。

## 当前已完成功能

- 邮箱注册、登录、退出、密码重置、用户名补设与全局唯一用户名。
- 用户积分、积分流水、管理员积分管理，以及创建/关闭房间时的积分流转。
- 登录用户和游客的建房、加房、退出、踢人、移动座位、密码房与刷新恢复。
- 房间级单会话设备锁、多设备接管、受保护的状态补拉。
- 成员聊天、系统消息、消息鉴权、速率限制、Supabase Realtime 同步与轮询兜底。
- 题库管理、题目导入导出、房主开题/关题、通关记录和事实白板。
- AI 询问、提示和尝试推理；DeepSeek 主持、GLM 事实摘要与失败降级；扣分、串行请求和失败退分。
- 管理后台：账户、题库、消息审计与 AI 错误案例、聊天备份、房间、积分流水、用户反馈、邮件发送。
- 管理员邮箱二次验证、可信设备 Cookie、移动端房间三标签布局、用户反馈页。

## 未完成内容与下一步建议

源码与迁移中未发现 `TODO`、`FIXME`、`HACK`、`WORKAROUND` 或 `XXX` 标记。以下是 `tasks.md` 明确记录的待办，而不是本次迁移发现的新故障：

- 聊天内容增强：表情快捷输入、Markdown/链接识别。
- 事实白板：房主撤销单条事实、局终回放保留。
- AI 失败/超时：在前端区分退分提示与稍后重试提示。
- 公开房间大厅：列表、筛选和一键加入。
- 管理端：将积分流水按用户名筛选和账户搜索下推到数据库，并补分页/总数；当前内存过滤有上限。
- 积分操作速率限制、Supabase 日志监控/告警、错误边界和用户友好错误页面、房间清理定时任务。

优先建议先完成公开房间大厅、管理端数据库分页筛选和生产运维监控。

## 当前开发环境

| 项目 | 当前信息 |
| --- | --- |
| 语言 | TypeScript（严格模式）、SQL |
| Framework | Next.js 16.2.9（本机锁定依赖实际构建版本；`package.json` 声明 `^16.2.2`）、React 19.2.0 |
| Runtime | Node.js 20.9+；本机检查为 Node.js 24.16.0 |
| 包管理 | npm，锁定文件为 `package-lock.json`；本机 npm 11.13.0 |
| 数据库 | Supabase PostgreSQL；77 个版本化迁移位于 `supabase/migrations/` |
| 身份与实时 | Supabase Auth、Realtime、RLS、RPC |
| 第三方服务 | DeepSeek、GLM/Zhipu、Resend、Vercel、GitHub |
| Supabase CLI | 本机 `npx supabase` 2.111.0（仅部署/检查迁移时需要） |

## 环境变量说明

只复制变量名和用途；实际值只保留在迁移压缩包中的 `.env.local`，不要提交 Git。

| 变量 | 用途 |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | 浏览器和服务端访问的 Supabase 项目 URL。 |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | 浏览器 Supabase publishable key；权限仍由 RLS 控制。 |
| `NEXT_PUBLIC_SITE_URL` | 本地站点地址及认证回调基址，通常为 `http://localhost:3000`。 |
| `SUPABASE_SECRET_KEY` | 仅服务端管理操作使用的 Supabase secret key。 |
| `ADMIN_EMAILS` | 管理员邮箱列表，英文逗号分隔。 |
| `RESEND_API_KEY` | 管理端邮件和二次验证邮件发送。 |
| `ADMIN_EMAIL_FROM` | 管理端邮件发件人。 |
| `DEEPSEEK_API_KEY` | AI 主持（询问、提示、推理）的 API key。 |
| `DEEPSEEK_MODEL` | DeepSeek 主模型名称。 |
| `DEEPSEEK_BASE_URL` | DeepSeek API 地址。 |
| `DEEPSEEK_PRIMARY_TIMEOUT_MS` | DeepSeek 主调用超时。 |
| `DEEPSEEK_REASON_TIMEOUT_MS` | DeepSeek 推理调用超时。 |
| `AI_HOST_TOTAL_TIMEOUT_MS` | 单次 AI 主持请求总超时。 |
| `ZHIPU_API_KEY` | GLM 问答等价判断和事实摘要使用的 API key。 |
| `ZHIPU_MODEL` | GLM 主模型名称。 |
| `GLM_FALLBACK_ENABLED` | 是否启用 GLM 备用调用。 |
| `GLM_FALLBACK_API_KEY` | GLM 备用服务 API key。 |
| `GLM_FALLBACK_BASE_URL` | GLM 备用服务地址。 |
| `GLM_ASK_FALLBACK_MODEL` | 询问模式备用模型。 |
| `GLM_HINT_FALLBACK_MODEL` | 提示模式备用模型。 |
| `GLM_REASON_FALLBACK_MODEL` | 推理模式备用模型。 |
| `GLM_FALLBACK_TIMEOUT_MS` | GLM 备用调用超时。 |

## 新电脑迁移步骤

1. 安装 Node.js 20.9 或更高版本、Git；如需部署数据库，再安装或通过 `npx.cmd` 使用 Supabase CLI。
2. 克隆主代码：`git clone https://github.com/ai0506/OnlineSoup.git`，进入目录后执行 `git pull`，确认处于 `main`。
3. 将本机迁移压缩包解压到临时目录，把其内容合并覆盖到 clone 后的项目根目录。压缩包不含 `.git`，因此不会破坏新 clone 的 Git 历史。
4. 运行 `npm.cmd ci`，不要迁移 `node_modules`。
5. 保留解压出的 `.env.local`，并确认它仍指向原有 Supabase 项目；如端口变化，同时更新 `NEXT_PUBLIC_SITE_URL` 和 Supabase Auth 的 Site URL/Redirect URLs。
6. 使用拥有原 Supabase、DeepSeek/GLM、Resend、Vercel 和 GitHub 权限的账号登录。云端 Supabase 数据、Vercel 环境变量和服务商账户不在 Git 或压缩包内，但会继续保留在原云端账号。
7. 运行 `npm.cmd run typecheck`、`npm.cmd run lint`、`npm.cmd run build`，再执行 `npm.cmd run dev` 并打开 `http://localhost:3000`。
8. 按 README 的验收流程测试：登录、建房、游客加入、实时聊天、开题/AI（需要密钥）以及 `/admin`（需要管理员邮箱和邮件配置）。

## 本地补充包说明

补充包保留 `.env.local`、`.mcp.json`、`.vercel/`、`.claude/`、`.agents/`（不含临时目录）、AI 错误分析材料、题库导出快照、评测输出、原型、截图、历史资源和全部项目文档。它排除 `.git`、`node_modules`、`.next`、`supabase/.temp`、`.codex-pet-runs`、日志和 TypeScript/Next 生成文件。

本项目没有发现应随项目文件夹迁移的本地 SQLite/DB 文件；生产和开发使用的是云端 Supabase。迁移后最关键的是保住同一个 Supabase 项目及相关服务账户的访问权。
