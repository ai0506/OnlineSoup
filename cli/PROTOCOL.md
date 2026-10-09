# OnlineSoup 玩家 API v1

生产入口：`https://onlinesoup.ai0506.com/api/v1/player`。当前服务端与 CLI 使用协议版本 1；P2 网页接管确认没有改变玩家 HTTP 合同。

## 认证与请求头

每次请求必须携带 `X-OnlineSoup-Version: 1`，缺失或不兼容返回 HTTP 426 / `CLIENT_TOO_OLD`。身份依赖 Supabase Cookie 与服务端登记的 CLI 会话，不能用自报用户 ID 或客户端头代替认证。网页会话不能直接使用玩家业务接口，游客不能加入。

POST 使用 `Content-Type: application/json`。原生 CLI 无 Origin 时还须携带 `X-OnlineSoup-Client: cli`；有 Origin 时必须与请求地址同源。客户端头只是请求格式约定，不授予身份或权限。响应 `Cache-Control: no-store`；Cookie 必须按域名、安全属性和作用路径保存，接收全部 Set-Cookie，并将刷新后的 Cookie 原子落盘。

## 路由

以下路径均相对于上述入口；CODE 是大写 6 位字母或数字。房间业务写入须携带 UUID `Idempotency-Key`，登录、浏览器登录和登出不使用该键。浏览器登录凭 id/设备秘密/验证器去重，不能用 /request 查询。

| 方法与路径 | 输入与结果 |
| --- | --- |
| POST `/browser-login/start` | `{secret,challenge,previous_user_id?}`；secret 为随机 32 字节 base64url，challenge 为独立随机验证器的 SHA256 十六进制。返回 id、user_code、5 分钟期限；服务端仅保存哈希。复用登录尝试限流。 |
| POST `/browser-login/poll` | `{id,secret,verifier}`；pending/issuing 等待；网页批准后仅一个发行者创建独立 CLI 会话，完成时只通过 Set-Cookie 交付，不返回令牌。未知网络结果可重复相同 poll，不新建授权。 |
| POST `/browser-login/ack` | 同 poll 输入；CLI 原子保存 Cookie 与账号后确认，服务端清空加密暂存凭证。 |
| POST `/login` | `{identity,password}`，identity 为用户名或邮箱；认证失效后恢复原账号时可带 `previous_user_id` 防止误换账号。成功安装并登记 CLI 会话。密码只通过安全 stdin 或 TTY 提供。 |
| GET `/session` | 登录与 CLI 会话状态；无登录可返回 authenticated=false。 |
| POST `/logout` | 吊销当前 CLI 登记及 Auth 会话；仍有有效座位则先离开。 |
| GET `/rooms/CODE/join-info` | 受限加入信息，不返回密码或私密成员凭证。 |
| GET `/rooms/CODE/state` | 当前房间、座位、本人积分和可公开题目；成员和设备锁校验。 |
| GET `/rooms/CODE/puzzle` | 当前题目投影，不包含未公开汤底、关键点或内部审计。 |
| GET `/rooms/CODE/facts` | 当前题目保留历史的稳定事实及来源。 |
| GET `/rooms/CODE/messages` | `limit` 1–100，默认 50；可选 after 或 before 不透明游标，两者互斥。 |
| POST `/rooms/CODE/join` | 可选 `{password,takeover}`；password 为 6 位数字；只有显式 takeover=true 才接管本人旧座位。 |
| POST `/rooms/CODE/leave` | `{}`；原子释放本人有权操作的座位，不释放接管者的座位。 |
| POST `/rooms/CODE/messages` | `{content}` 普通聊天，1–300 字。 |
| POST `/rooms/CODE/ask` | `{content,message_mode,expected_puzzle_id,use_personal_points}`；模式 ask/hint/reason，长度上限 100/50/300；必须指定当前题目，默认 ask 和座位积分。 |
| GET `/requests/UUID` | 当前用户原请求结果；设备被接管后仅返回本人付款/退款最小状态，不恢复房间权限。 |

`/seats`、`/points`、`/room` 为 CLI 对 state 的投影，`/wait` 为客户端组合轮询，没有独立 HTTP 路由。网页确认使用网页专用 RPC 与 Server Action，不是玩家 API；状态只提供本人的不透明版本，确认在事务内比较版本。

## 响应与错误

成功与失败均使用 JSON 信封：

```json
{"api_version":1,"ok":true,"data":{},"error":null}
```

```json
{"api_version":1,"ok":false,"data":null,"error":{"code":"RATE_LIMITED","message":"发送太频繁，请稍后重试","retryable":true,"retry_after_seconds":8}}
```

按 error.code 判断行为，不解析中文文案。`ROOM_DEVICE_IN_USE` / `KICKED` / `ROOM_CLOSED` / `IDLE_TIMEOUT` 停止有权限的操作；认证确认失效后原账号重新登录；`PUZZLE_CHANGED` 重新读题；`RATE_LIMITED` 遵守等待；`INSUFFICIENT_SEAT_POINTS` 不能自动动用个人积分。CLI 退出码及完整操作说明见 [README.md](README.md)。

CLI 0.3.0 会在房间操作后通过同一个受保护的 messages GET 附带检查，并在终端 JSON 顶层添加可选 `message_check`（详见 README）。它不是 HTTP 响应的新字段，不改变本节的服务端合同；提醒不推进同步游标，检查失败不替换原操作结果。

## 写意图与同步

发送前保存 UUID、动作与必要正文。结果未知（含写请求 5xx、504 或连接中断）先 GET 原请求键；查不到不代表未执行，可使用原键、相同动作/正文/题目/付款来源/接管选项重提交。改内容返回 `REQUEST_KEY_CONFLICT`。原键至少保留 7 天，到期留下拒绝重执行的墓碑；密码不落盘，密码房重试重新输入相同密码。

AI pending 不代表完成；refunded 才确认退款。默认仅扣座位积分；`use_personal_points:true` 是本次新的明确付款意图，即使座位尚有积分也选择个人积分，不能拿旧键更改付款来源。退款回原来源且只结算一次。

消息 ID 按十进制字符串处理。游标按账号、房间和历史代次签名，不能解析或跨房间使用；has_more 时继续补拉。历史删除、归档或编辑使旧游标 `CURSOR_EXPIRED`，显式 reset 建立最新快照且承认可能缺失历史。数据库长事务会延迟可见水位；正文与游标共同原子落盘，保存后输出前崩溃可用最近 200 条 cached 恢复。详细边界及 wait 时限见 [README.md](README.md)。

浏览器授权页 `/auth/cli?id=UUID` 不携带设备秘密或验证器；用户必须输入终端 8 位验证码并明确确认。错误码 5 次拒绝，网页账号变化拒绝旧确认。公开 key 只能以有效网页会话调用受限批准 RPC；发行 RPC 仅 service_role。临时凭证使用 AES-256-GCM 和请求 id 关联加密，确认/过期处理时清空；后续新请求清理过期行。Server secret 轮换会使尚未收取的暂存凭证失效，需重新授权。
