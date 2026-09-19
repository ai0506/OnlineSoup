# OnlineSoup 文档与文件保留价值盘点

盘点日期：2026-09-19。范围：当前工作区的代码、迁移、配置、文档目录和 Git 跟踪/忽略状态；未读取任何密钥内容。经用户明确授权，已将指定的非运行资料移入系统废纸篓，未永久删除。

## 当前文档修正

- `tasks.md` 原先停留在 2026-07-26，且把付费 AI 写在普通聊天 RPC 下。本次已更新为当前工作区的受保护状态补拉、120 秒 AI 租约、过期请求结算和自动化回归边界。
- `README.md` 已补充离线测试、数据库契约测试前提和 CI 覆盖范围。
- 站内 `/docs` 页已改为说明最小公开投影、成员受保护状态补拉和 AI 租约；该迁移在提交和部署前仍不得对外宣称已经上线。

## 文件保留建议

| 分类 | 文件或目录 | 判断 | 建议 |
| --- | --- | --- | --- |
| 当前权威 | `AGENTS.md`、`CLAUDE.md`、`.env.example`、`supabase/migrations/`、`src/` | 直接约束实现、配置和安全边界。 | 保留并随功能同步。 |
| 当前导航/说明 | `README.md`、`文档索引.md`、`tasks.md`、`FRONTEND_SPEC.md`、`docs/guides/`、`lessons.md` | 供启动、开发、玩家使用或经验复用。 | 保留；`tasks.md` 每次重大完成项后同步。 |
| 历史但有证据价值 | `updates.md`、`docs/reviews/2026-09-05-project-review.md` | 可解释历史决策、迁移和旧环境，但不是当前事实。 | 保留并明确标为历史；不建议再修改其中的历史结论。 |
| 规划资料 | `docs/architecture/站内通知功能计划.md`、`docs/architecture/用户档案与好友功能计划.md` | 尚未实现的产品设计，后续功能仍可复用。 | 保留；实现对应功能时再审阅和改写。 |
| 早期设计/Prompt 草案 | `docs/architecture/多人在线海龟汤聊天室开发设计.md`、`docs/architecture/多人项目聊天室房间设计.md`、`docs/ai/prompts_suggestion.md` | 多处已被迁移和 `src/lib/deepseek.ts` 覆盖，直接当实现说明会误导。 | 暂不删除；在标题或索引中保持“设计草案”定位，未来可合并为一份经过验证的架构说明。 |
| 非运行产物 | `data/puzzle-exports/`、`paper/` | 不参与 Next.js 构建；分别承担题库恢复参考与研究复现。 | 保留。`paper/` 由用户明确要求保留。 |
| 本地可再生目录 | `.venv/`、`.vercel/`、`supabase/.temp/`、`node_modules/`、`.next/` | 本地依赖、CLI 或构建缓存，不是项目源文件。 | 不提交；只有磁盘清理被明确授权时才清除。 |

## 已执行的可恢复清理

用户要求保留 `paper/`，并允许清理其余上述候选。已将下列目录移入系统废纸篓的专用文件夹 `onlinesoup-document-cleanup-2609191952`，可在废纸篓中恢复：

- `archive/`：旧 logo 草稿与重复公开截图。
- `prototypes/`：不参与构建的静态房间原型。
- `docs/handoff/`：2026-08-05 的迁机快照。
- `outputs/`：GLM 模型评测输出与预览。

随后复核项目目录结构，只移除了未被 Git 跟踪、没有代码引用且没有内容的 `src/lib/ai/` 空目录；未移动运行代码、迁移、测试、题库资料、研究资料或框架配置入口。

`paper/` 保持原状。`paper/api_key.txt`、`paper/api_keys.env` 的名称表明它们可能含敏感配置；它们仍被 `.gitignore` 忽略且未被 Git 跟踪，未被读取、展示或移动。

## 未做的事

- 未永久删除废纸篓中的资料，未清理 `paper/`。
- 未读取或输出 `.env.local`、`paper/api_key.txt`、`paper/api_keys.env` 等可能含凭据的文件内容。
- 未验证生产数据库迁移状态、线上部署或真实用户流程。
