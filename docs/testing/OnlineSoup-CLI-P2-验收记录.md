# OnlineSoup CLI P2 验收记录

日期：2026-10-09。状态：网页互通核心实现、本地验收、Supabase 迁移完成，生产部署与浏览器/令牌/外部 Agent 验证进行中。

## 实现

大厅为本账号当前房间显示“CLI 使用中”；明确进入被 CLI 占用的座位时显示站内确认弹窗，取消返回大厅且不接管。确认通过 Server Action 提交，仅接受 6 位房间码与 64 位十六进制版本，服务端再次 getUser；不用原生 confirm。

`get_room_takeover_status(text)` 仅返回当前用户座位的 cli_in_use 和不透明 session_version，不返回原始 session_id。版本由私有 HMAC 密钥绑定座位、房间、用户、membership_id、active_session_id、active_session_updated_at。`confirm_cli_room_takeover(text,text)` 先获取既有事务 gate，再锁房间/座位并验证真实 Auth 会话及版本；版本变化返回 SEAT_SESSION_CHANGED，网页重新读取并要求再次确认。若已变为网页会话，用户需再次点击重新进入，不复用旧同意。

旧 take_over_room_session 和 join_room_as_member 也在 gate 内拒绝无确认的 CLI 接管，防止直接调用旧 RPC 绕过 UI；CLI 会话依旧 USE_PLAYER_API。网页之间的接管与游客语义保留。新私有 helper 不向公开角色授权，两项公开 RPC 仅授 authenticated、SECURITY DEFINER 设置空 search_path 并自行鉴权，不增加公开表权限。

部署迁移：`20261009112650_cli_web_takeover_confirmation`，已通过 MCP 应用并以真实线上版本补档；旧迁移未修改。

## 本地证据

- 空白 PostgreSQL 18.4 全量迁移重放成功；Auth/Realtime 替身、pg_cron 排除，不替代生产云端证据。
- P0 26 项 + P1 12 项 + P2 11 项数据库行为通过。P2 覆盖只返回本人不透明版本、旧入口绕过拒绝、缺失/篡改/过期版本、并发只有一胜、网页之间接管、退出重进、其他座位版本、CLI/匿名/私有函数权限、个人积分显式扣款与同来源退款、座位不足不自动扣个人、撤销会话与非成员拒绝。
- CLI 11 项行为通过；根项目 typecheck、lint（0 错误/3 条旧警告）、build 通过。

## 生产、浏览器与外部 Agent

待填写实际结果；Shell 脚本不视为外部 Agent 自主游玩，普通网页 RPC 不视为浏览器 UI 验收。

## 验收限制

- 本机未发现 Claude Code 可执行文件，不能宣称 Codex/Claude 两种客户端都实测。
- 尚未进行真人参与的长期混合游玩，不把浏览器自动化当作真人。
- Windows/Linux 实测仍未完成；已有 Windows 手工检查清单只代表测试步骤。
