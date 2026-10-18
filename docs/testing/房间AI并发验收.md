# 房间 AI 动态并发

2026-10-16 实施。人数采用实际占用座位数（含房主、注册用户和游客），不是最大容量或 Realtime 在线连接数。

| 实际人数 | 总请求 | ask | reason | hint | 每位玩家 |
| --- | --- | --- | --- | --- | --- |
| 1–3 | 2 | 2 | 1 | 1 | 1 |
| 4–6 | 4 | 3 | 2 | 1 | 1 |
| 7 及以上 | 6 | 4 | 3 | 1 | 1 |

全部条件同时满足才接受请求。不排队；拒绝复用 `room_ai_busy`，不会扣积分或提示机会。本次没有全站并发硬上限。人数减少时，已接受请求继续执行，新请求按新额度判断。

网页 `send_room_ai_request` 和 CLI `player_write` 共用 `soup_cli.send_room_ai_request`。保留既有事务锁、3 秒网页冷却、CLI 限流、2 分钟租约、超时退款和切题/关房迟到保护。事务锁仅保护短暂准入/结算，模型网络请求在事务外执行。清理超时租约后重新读取座位计费快照。

聊天等待、答案颜色和 v1 历史上下文按 `reply_to_id` 配对。AI 回复旁显示对应玩家；模型历史只读当前题目、当前请求 ID 及以前的消息。揭底消息没有请求关联，不会错误终结其他问题的等待状态。

## 验证证据

- `npm run typecheck`、`npm run build` 通过。
- `npm run lint` 无错误；3 条既有导航警告位于 auth-hash-handler/reset-password-form。
- `npm test`：10 个文件、86 项通过。新增乱序回复、提示/揭底不串问、超时/旧题/失败占位排除和实际 hint prompt 的配对回归。
- 迁移 `20261016102145_dynamic_room_ai_concurrency.sql` 已应用到 OnlineSoup，并回读版本、函数签名、空 search_path、RPC 授权和请求表 RLS；不新增公开表权限。
- `supabase/tests/room_ai_concurrency.test.sql` 在部署前临时应用迁移后回滚、部署后再次回滚执行均通过。覆盖 3/4/6/7 人边界、公开角色、计费、个人积分、模式与总额度、同玩家、退款幂等、过期回收、人数缩小、乱序结算及切题迟到退款。
- 真实 Data API 公开 key 同时发送六名游客请求：ask 接受 3 个、混合 ask/reason 接受 4 个、reason 接受 2 个、hint 接受 1 个；同玩家并发仅接受 1 个。验证精确退款、保护接口回读和审计脱敏。隔离测试账号/房间已清理。
- 以上公开接口验收直接调用准入与结算 RPC，没有执行收费模型请求，不等同于多浏览器真人全流程验收。

## 重跑公开接口并发验收

1. `node --env-file=.env.local scripts/check-room-ai-concurrency.mjs --prepare` 在系统临时目录写入权限为 0600 的隔离 fixture JSON，并返回路径、setupSql、cleanupSql。输出 SQL 仅含游客 token 哈希，不能打印 fixture 内的原始 token 或环境密钥。
2. 由数据库 SQL runner 执行 setupSql；现有 service_role 没有直接写入房间/座位的权限，不为测试扩大权限。
3. `node --env-file=.env.local scripts/check-room-ai-concurrency.mjs /private/path/fixture.json` 使用公开 key 发请求，管理结算 RPC 只用于测试退款和模拟回复。
4. 无论成功或失败，都执行对应 cleanupSql，并删除本地 fixture JSON；清理只能针对该次生成的账号与房间。


## 生产发布回执

- 实现提交：`214c17d`，已推送 GitHub `main`，仅包含本次功能及相关文档/测试；其他未提交改动保留在原工作区。
- Vercel CLI 直接部署返回 `Not authorized`，未创建成功部署；改走项目已有的 GitHub 自动部署。
- 生产部署：`dpl_7XSSrA1qFTFtCGr2hiyfQqBV5uEF`，状态 Ready；GitHub 该提交的 Vercel 检查为 success，主域名 `https://onlinesoup.ai0506.com` 已指向本次部署。
- 发布后：首页、`/docs`、`/login` 返回 200；内部评估入口 POST 返回 404。没有执行收费模型或多人浏览器完整游戏验收。
- 临时发布工作树已归档；公开接口测试数据和私密 fixture JSON 已清理。
