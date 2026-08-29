# OnlineSoup 文件迁移清单

生成日期：2026-08-05。GitHub 状态按本次盘点时的 `main` 与 `origin/main` 完全同步记录。

> 归档文档：迁移已完成。本文描述 2026-08-05 当时的目录结构，其中 `HANDOFF.md` 与 `FILE_TRANSFER_LIST.md` 已移入 `docs/handoff/`，`logo-archive/` 已移入 `archive/logo-archive/`。当前目录结构以 `文档索引.md` 和仓库实际内容为准。

| 文件/目录 | GitHub状态 | 是否进入压缩包 | 说明 |
| --- | --- | --- | --- |
| `src/` | 已提交到 GitHub | 是 | 应用页面、组件、路由和业务代码。 |
| `public/` | 已提交到 GitHub | 是 | 运行时静态资源。 |
| `supabase/migrations/` | 已提交到 GitHub | 是 | 77 个数据库结构与 RPC 迁移；新电脑连接同一项目时保留作历史和后续部署依据。 |
| `supabase/.temp/` | 仅本地、被忽略 | 否 | Supabase CLI 临时状态，可重新生成。 |
| `docs/`、`README.md`、`文档索引.md`、`tasks.md`、`AGENTS.md`、`CLAUDE.md` | 已提交到 GitHub | 是 | 项目说明、开发规则与当前待办。 |
| `HANDOFF.md`、`FILE_TRANSFER_LIST.md`、`updates.md` | 本次提交到 GitHub | 是 | 本次交接材料和 AI 更新记录。 |
| `package.json`、`package-lock.json` | 已提交到 GitHub | 是 | 依赖定义和可复现安装锁定。 |
| `.env.example` | 已提交到 GitHub | 是 | 无密钥的环境变量模板。 |
| `.env.local` | 仅本地、被忽略 | 是 | 当前本地服务配置和密钥；仅个人压缩包保存。 |
| `.mcp.json` | 仅本地、被忽略 | 是 | 本地 MCP 连接配置。 |
| `.vercel/` | 仅本地、被忽略 | 是 | 本机到 Vercel 项目的关联元数据；可在新电脑重新 `vercel link`。 |
| `.claude/` | 仅本地、被忽略 | 是 | Claude Code 本地设置。 |
| `.agents/`（排除 `.agents/tmp/`） | 仅本地、被忽略 | 是 | 本地 AI 技能与项目辅助配置；不是应用运行必需，但保留开发环境。 |
| `ai-error/` | 仅本地、被忽略 | 是 | AI 错误案例分析资料。 |
| `data/puzzle-exports/` | 仅本地、被忽略 | 是 | 题库 JSON/TXT 快照，用于参考、导入和恢复。 |
| `outputs/glm-model-eval/` | 仅本地、被忽略 | 是 | GLM 评测结果与预览。 |
| `archive/`、`logo-archive/`、`prototypes/`、`screenshots/` | 两者混合或仅本地 | 是 | 历史资源、设计原型和截图；多数不参与当前运行，但按完整迁移原则保留。 |
| `.git/` | 本地 Git 元数据 | 否 | 新电脑通过 clone 创建；排除以避免覆盖新 clone 的历史和远端配置。 |
| `node_modules/` | 仅本地、被忽略 | 否 | 可由 `npm.cmd ci` 从锁定文件重新安装，体积大且平台相关。 |
| `.next/` | 仅本地、被忽略 | 否 | Next.js 构建缓存与输出，可由启动/构建重新生成。 |
| `.codex-pet-runs/` | 仅本地、被忽略 | 否 | Codex 宠物运行缓存，不属于项目。 |
| `next-env.d.ts`、`tsconfig.tsbuildinfo` | 生成文件、被忽略 | 否 | TypeScript/Next 自动生成。 |
| `*.log`、`npm-debug.log*`、`yarn-debug.log*`、`pnpm-debug.log*` | 生成文件、被忽略 | 否 | 临时日志，不影响恢复。 |
| 云端 Supabase 数据/Auth/Realtime 配置 | 不在仓库文件系统 | 不适用 | 留在原 Supabase 项目；新电脑需使用同一账号/项目和 `.env.local`。 |
| 云端 Vercel 环境变量与部署记录 | 不在仓库文件系统 | 不适用 | 留在原 Vercel 项目；新电脑需拥有项目访问权。 |
| DeepSeek、GLM/Zhipu、Resend、GitHub 账户权限 | 不在仓库文件系统 | 不适用 | API 配置可由 `.env.local` 恢复，账户登录权限需单独保留。 |
