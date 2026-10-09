# OnlineSoup CLI P1 验收记录

日期：2026-10-09。状态：核心实现、本地验证及 Supabase 迁移完成；Vercel 发布与生产玩家流程正在验证。P2 尚未实施。

## 实现与接口

- 完整玩家命令：`/hint`、`/reason` 沿用 P0 幂等扣费路径，新增 `/facts`、`/seats`、`/points`、`/room`（state 别名）和 `/wait`。
- `GET /api/v1/player/rooms/CODE/state|puzzle|facts|messages` 独立验证已登记 CLI 会话及当前成员、设备会话。messages 支持 after/before 二选一和 limit 1–100；拒绝重复、空值、未知查询参数。返回 no-store JSON，不返回私密题库或审计字段。
- 新 RPC：`player_snapshot(text)`、`player_facts(text)`、`player_messages(text,text,text,integer)`。仅 authenticated 可调用，函数内再次验证 CLI 登记及本人房间成员；私有辅助函数不授公开角色执行。SECURITY DEFINER 使用空 search_path。
- 纯读取使用单条语句快照，不获取全局 gate 或座位 FOR UPDATE，不进行扣费对账、不刷新闲置期限。网页旧读函数与写入 gate 的全站串行限制仍存在，P1 没有宣称解决该限制。

## 同步决策与边界

使用计划 6.1 的备选：消息插入触发器记录 top-level xid8；只读取 `cli_ingest_xid < pg_snapshot_xmin(pg_current_snapshot())`，按 `(xid8,id)` 排序。水位以下事务都已结束，因此晚提交的低 ID 不会被永久跳过。分页冻结上界，完成后游标推进到水位；下一轮读取随后提交的消息。既有已提交消息采用 xid 0，避免易变函数逐行回填。

理由：覆盖网页、CLI、AI、揭底及系统消息无需给所有生产路径再添加房间序号锁，避免组合出新锁序。代价：数据库中的长事务可能延迟所有房间的新消息；返回 visibility_delayed 提示，不能保证实时。消息按事务号与 ID 排序，并不声称事务号就是实际提交时刻。

游标为 HMAC 签名，绑定房间、用户、历史代次、方向、事务与 ID。删除、归档、编辑或 truncate 触发历史代次变化，旧游标明确 CURSOR_EXPIRED；客户端仅在显式 --reset 时重建最新快照并返回 history_gap_possible。范围限于仍保留的 room_messages，不读取归档库。

客户端在原子写文件中同时保存消息正文和游标，保存完成才返回给输出层；按消息 ID 去重，最近 200 条可通过 --cached 查看。进程可能在保存后、输出前退出，因此不承诺终端恰好一次输出；200 条之外不是完整离线档案。--before 不修改增量位置。账号切换或登出清理同步缓存。

`/wait` 默认 30 秒、范围 1–60，约每 5 秒读取统一状态和消息；有积压先连续追平，单次最多 1000 条，仍有积压返回 has_more。网络耗时计入时限，网络超时可能返回 NETWORK_ERROR；已成功保存的分页不会回退。只比较业务快照，不能捕获两次轮询间所有短暂状态变化；不续期、不自动接管、不托管外部模型。

事实扫描当前题目全部保留的 AI 消息，安全解析 JSON，提取 answer/hint 的非空字符串 fact_summary；文本去重，返回 ask/hint 来源和字符串消息 ID。排除 reasoning_result/reveal/聊天，不额外调用模型。

依据：[PostgreSQL 17 事务快照水位](https://www.postgresql.org/docs/17/functions-info.html)、[STABLE 函数使用调用语句快照](https://www.postgresql.org/docs/17/xfunc-volatility.html)。

## 已完成验证

| 检查 | 结果与范围 |
| --- | --- |
| CLI 构建与行为 | 10/10：P0 的解析/Cookie/锁/密码/请求恢复，加上游标正文原子持久化与重启、历史与错误保留位置、wait 连续分页/状态/空超时/接管/网络时限 |
| 全量迁移本地重放 | 空白可丢弃 PostgreSQL 18.4 成功；Auth/Realtime 为最小替身，pg_cron 调度排除；生产为 PostgreSQL 17，不把替身当真实云端验收 |
| 数据库回归 | 原 P0 26/26 + P1 11/11 |
| 晚提交与高消息量 | 低 ID 系统事务悬挂，网页消息先提交：先明确延迟，低事务提交后两条均可补拉；500 条跨 73 条分页，期间新写入留待下一水位且无重漏 |
| 历史、事实与公开输出 | before 无重复；删除/编辑使游标失效；事实跨 120 条聊天仍完整，去重/切题/错误 JSON/审计剥离通过；提示扣 1 点/机会，成功推理扣 2 点并公开揭底、清空题目通过 |
| 权限与等待 | 跨房/篡改游标拒绝；普通网页会话、匿名和非成员拒绝；网页接管后所有 P1 读取拒绝；持有全局 gate 时 P1 三种读取仍完成且不刷新闲置时间 |
| 根项目 | typecheck 通过，lint 0 错误/3 条旧警告；build 通过 |
| Supabase 迁移 | `20261009102525_cli_player_sync_and_snapshot` 已应用；签名、STABLE、空 search_path 与 execute 权限回读符合预期 |

Security Advisor 保留既有无 policy 的私密表提示和公开业务 SECDEF 提示；新增三个 RPC 的 authenticated SECDEF 提示为预期受保护业务窗口，已复核函数内成员与设备检查。未新增匿名执行。泄漏密码保护未开启是既有 Auth 配置，未在本阶段修改。参考 [数据库 Advisor 权限提示](https://supabase.com/docs/guides/database/database-linter?lint=0029_authenticated_security_definer_function_executable)。

## 发布与真实玩家流程

待本轮生产发布完成后填写；不得用上述本地测试替代生产默认域名、真实登录 Cookie、公开 key RPC 或真实 AI 主持验收。

## 未完成范围

- Linux、Windows CMD/PowerShell 的密码输入、锁、文件权限及 Unicode 尚未实际验收；本轮只实测 macOS。
- P2：网页接管 CLI 前的站内确认、会话版本复核、CLI 使用中标识，以及隔离目录内真实外部 Agent 游玩。
- npm 公开发布、独立二进制、自动 Agent Runner 不在本阶段范围。
