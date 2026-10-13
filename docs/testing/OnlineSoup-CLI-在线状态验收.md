# CLI 在线状态修复验收

日期：2026-10-12

## 行为

网页座位的在线绿点合并网页 Realtime Presence 与受保护的 `get_room_member_state` 返回的 `cli_online`。CLI 当前会话未撤销、仍占用该账号座位，且最近 2 分钟内有效加入/发言/AI 操作，或者该座位存在租期内的 pending AI 请求，判为在线。空座位、已撤销会话、网页接管、超时均不因 CLI 活动亮绿点。网页现有 10 秒状态补拉更新标记。

这是近期活动判断，不证明 CLI 进程一直运行；CLI 关闭后可能保留绿点最多约 2 分钟加一次刷新。读取状态、消息与 /wait 不延长活动窗口。闲置清退仍按原规则执行。

## 已验证

- 线上迁移 `20261012112106_cli_seat_online_status` 已记录；同版本 SQL 已保存到仓库本地。
- 函数仍为 SECURITY DEFINER、空 search_path，保留成员与设备检查及 CLI 事务锁；anon/authenticated 仍可调用，未新增私密表授权。
- SQL 回滚夹具覆盖：近期活动、精确 2 分钟边界、过期、无时间戳、会话撤销、网页接管、空座位、有效 pending AI、过期 AI 租期、非成员拒绝、私密字段不外泄。见 `supabase/tests/cli_presence.test.sql`；无 pgTAP 依赖，输出 TAP。
- 本地生产构建连接真实 Supabase：临时房主建房，真实 CLI 登录/入房/发言，房主使用公开 key 的成员 RPC 读取 `cli_online=true`；游客使用公开 key 加入后，带游客 Cookie 请求本地 `/rooms/CODE/state` 返回 true，服务端渲染 HTML 包含在线绿点；无成员凭证请求被拒绝；CLI leave/logout 后座位释放。临时账号、房间、会话文件已清理。
- `npm run typecheck`、`npm run build`、19 项网站单测通过；lint 0 错误、3 条原有警告。

## 验证边界

Supabase CLI dry-run 因直连数据库连接中断失败，改用 MCP 检查现有函数并应用迁移，随后检查迁移记录、函数权限、数据库回归及真实公开 key 流程。

网页组件修改尚未发布到 Vercel，也未提交/推送 GitHub；线上数据库已具备新标记，现有线上旧网页尚不会使用它。未执行浏览器点击、断网重连或真实付费 AI 提问；pending AI 状态由回滚夹具验证。
