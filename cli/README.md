# OnlineSoup CLI

注册用户通过文本命令与网页玩家在同一房间聊天、提问。CLI 本身不调用玩家的语言模型；AI 主持继续由网站服务端处理。P1 支持当前题目完整事实、历史分页、持久化增量游标和有限时长等待。

## 安装与运行

需要 Node.js 22 或更高版本。在项目目录执行：

```sh
npm --prefix cli ci
npm --prefix cli run build
node cli/dist/cli/src/main.js /help
```

可在 `cli` 目录执行 `npm link`，之后使用 `soup`。源码仍依赖本项目的无服务端依赖协议模块；首次不单独发布 npm 包。

在网站注册、设置用户名后运行：

```sh
soup /login
soup /join ABCDEF
soup /puzzle
soup /say "大家好"
soup /ask "故事发生在室内吗？"
soup /leave
soup /logout
```

`/login` 自动打开浏览器，网页已登录时可确认当前账号，也可选择其他账号登录；输入终端显示的验证码后完成授权。没有自动打开时，手动打开显示的链接；链接 5 分钟有效，`/login --no-browser` 仅显示链接。按 Ctrl+C 后再次 `/login` 可恢复未过期请求。登录不会加入房间或接管座位。

`/login 用户名` 保留终端密码登录；密码房 `/join` 与该方式在 TTY 隐藏输入密码。自动化调用使用 `soup --json --password-stdin /login USERNAME`，由安全输入源提供 stdin；不要把密码写入命令行、脚本或日志。交互模式直接运行 `soup`。`/exit` 保留座位和登录，下次运行按服务端实际状态恢复。

默认服务器为 `https://onlinesoup.ai0506.com`。本地开发需设置 `ONLINESOUP_URL=http://localhost:3105`，并启动本地 Next.js 网站。生产 API 已于 2026-10-09 发布，默认域名的登录、密码入房、真实 AI 询问、退出和登出已验证。

`ONLINESOUP_HOME` 默认为 `~/.onlinesoup`。同一目录一次只允许运行一个进程；独立目录可隔离不同身份，同账号仍只有一个有效房间座位。目录/文件在 POSIX 为 0700/0600，Windows 使用 ACL。已验证 macOS；Windows/Linux 尚未实际验收。

## 命令与恢复

使用 `/help` 查看当前命令。`/hint`、`/reason` 沿用 P0 付费与请求键路径；`/facts`、`/seats`、`/points`、`/room`（`/state` 别名）和 `/wait` 已实现。网页进入 CLI 占用的座位前会要求确认；取消保留 CLI 使用权，确认时座位已变化则须重新确认。

- 普通文字直接聊天，`//help` 发出字面 `/help`；未知命令报错，不发送给房间。`/say -- TEXT` 可发送以选项开头的原文。
- `/join CODE` 遇到密码房时隐藏输入；自动化使用 `soup --json --password-stdin /join CODE`。不接受明文密码参数，房间密码不写入会话文件。`--takeover` 明确接管自己的旧座位，普通读取不会接管。
- 付费指令默认使用座位积分；`--use-personal-points` 仅授权本次使用个人积分。
- 写命令支持 `--request-key UUID`。键、动作和必要正文在发送前保存。网络中断或 5xx 返回 `REQUEST_RESULT_UNKNOWN`，先 `/request UUID`，必要时用原键、原内容重新执行。密码房重试需重新输入相同密码。
- 同键并发、重复 AI 请求不会重复写入、调用模型或扣费。同键更改内容会冲突。键至少保留 7 天，到期保留墓碑，不能重新执行；本地待确认正文保留 7 天，服务端拒绝已到期的原请求键；应在 7 天内恢复未知结果。
- 仅主动加入、聊天和付费指令续期；读取不续期。闲置约 60–65 分钟被服务端清退，未到期的 AI 请求会延迟清退。
- JSON 成败都写 stdout，诊断写 stderr。退出码 0 成功、2 输入、3 身份、4 规则、5 网络/结果未知、6 服务异常。

已确认完成、退款或到期的本地请求立即清理；未确认记录保留 7 天，超期由服务端键墓碑阻止重执行。

会话文件含登录凭证、最近收到的 200 条消息及待确认正文，应视为私密文件；不要提交、分享或复制给其他玩家。

## 消息、事实与等待

```sh
soup --json /messages
soup --json /messages --limit 100
soup --json /messages --before PREVIOUS_CURSOR
soup --json /facts
soup --json /seats
soup --json /points
soup --json /wait --timeout 30
```

首次 `/messages` 返回最新一页；之后自动用本账号、本房间保存的 `next_cursor` 补拉。`has_more: true` 时继续读取，不先休眠。`--before` 读取更早历史，保持增量位置不变。游标是不透明的签名字符串，不要解析、修改或跨房间使用。消息 ID 是十进制字符串。

服务端按事务号和消息 ID 排序，分页期间固定事务水位。长事务可能让其他房间的新消息延迟出现，返回 `visibility_delayed: true`；事务结束后可继续补拉，不会永久跳过晚提交的低 ID。旧消息被删除、归档或修改时返回 `CURSOR_EXPIRED`，不会静默丢弃旧位置；显式 `/messages --reset` 重建最新快照并报告 `history_gap_possible: true`。分页范围是仍保留的历史，不包括已归档数据。

消息正文和增量位置在同一次原子写文件中保存后才输出。进程在保存后、输出前退出时，可用 `/messages --cached` 查看最近收到的 200 条；这不是完整离线档案，也不承诺终端输出恰好一次。`--cached` 只读取本地文件。

`/facts` 扫描当前题目全部仍保留的 AI 消息，提取 answer/hint 的非空 `fact_summary`，按文本去重并返回 source 和 message_id，不把推理或揭底当事实。切题后按新题重新读取。

`/wait` 默认 30 秒，范围 1–60 秒，约每 5 秒读取状态和增量消息；先追平积压，最多返回 1000 条，仍有积压时返回 `has_more` 供下一次继续。消息或题目、座位、积分快照变化立即返回；正常空等待返回 `timed_out: true`。网络请求也计入时限；等待预算耗尽返回正常超时，若最后一轮读取未完成则返回 `poll_incomplete: true`，下次沿原游标补拉。预算耗尽前发生的网络故障仍返回 `NETWORK_ERROR`。读取不延长闲置时间，不自动接管；被踢、关房或接管立即停止。状态轮询不能捕获轮询之间所有短暂变化。

## 浏览器登录与自动化

浏览器与 CLI 拥有各自独立的 Supabase 会话。网页密码不会传给 CLI；网页确认后，服务端创建登记的 CLI 会话，CLI 保存 Cookie 后确认收取。取消授权保留原 CLI 登录。切换 CLI 账号前仍须先处理原活动座位。

无桌面或 Agent 可用 `soup --json /login` 取得 verification_uri 和 user_code，交给人类在浏览器确认；随后运行 `soup --json /login --wait`。JSON 输出不会包含设备秘密、验证器或登录凭证。未确认、验证码错误、超期或取消时不会登录；不要向他人转发自己未发起的授权请求。

## 网页互通与认证恢复

网页大厅显示“CLI 使用中”。确认网页进入后，旧 CLI 收到 `ROOM_DEVICE_IN_USE` 并停止操作；需要操作者明确 `/join CODE --takeover` 才能接管回来。刷新登录令牌不会自动抢回座位。网页之间的进入规则保留。

CLI 持久化服务端刷新的 Cookie。服务端确认 `LOGIN_REQUIRED` / `AUTH_EXPIRED` 后，用原账号重新登录，再读取或加入核实座位；若旧座位仍绑定旧会话，按需明确接管。不要手动编辑或分享会话文件。

HTTP 合同见 [PROTOCOL.md](PROTOCOL.md)，外部玩家边界见 [AGENT_USAGE.md](AGENT_USAGE.md)，本次实测范围见 [P2 验收记录](../docs/testing/OnlineSoup-CLI-P2-验收记录.md)。

## 测试

```sh
npm --prefix cli test
npm run typecheck
npm run lint
npm run build
npm run test
```

数据库行为测试只接受本机、空白且可丢弃的 PostgreSQL 数据库：

```sh
export ONLINESOUP_TEST_DATABASE_URL='postgresql://postgres:LOCAL_PASSWORD@localhost:5432/soup_cli_test'
node cli/tests/setup-database.mjs
node cli/tests/database.mjs
node cli/tests/sync-database.mjs
node cli/tests/takeover-database.mjs
node cli/tests/browser-auth-database.mjs
```

初始化器不删除已有表；Auth/Realtime 使用最小本地替身，不安装 pg_cron。该测试不能替代真实 Supabase 登录、公开 key 权限验证或网页验收。线上 Cron 配置与真实 AI 流程另行检查。
