# OnlineSoup CLI（P0）

注册用户通过文本命令与网页玩家在同一房间聊天、提问。CLI 本身不调用玩家的语言模型；AI 主持继续由网站服务端处理。P0 仅有最近 100 条消息，没有可靠增量同步。

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
soup /login 用户名
soup /join ABCDEF
soup /puzzle
soup /say "大家好"
soup /ask "故事发生在室内吗？"
soup /leave
soup /logout
```

`/login` 和密码房 `/join` 在 TTY 隐藏输入密码。自动化调用使用 `soup --json --password-stdin /login USERNAME`，由安全输入源提供 stdin；不要把密码写入命令行、脚本或日志。交互模式直接运行 `soup`。`/exit` 保留座位和登录，下次运行按服务端实际状态恢复。

默认服务器为 `https://onlinesoup.ai0506.com`。本地开发需设置 `ONLINESOUP_URL=http://localhost:3105`，并启动本地 Next.js 网站。生产 API 已于 2026-10-09 发布，默认域名的登录、密码入房、真实 AI 询问、退出和登出已验证。

`ONLINESOUP_HOME` 默认为 `~/.onlinesoup`。同一目录一次只允许运行一个进程；独立目录可隔离不同身份，同账号仍只有一个有效房间座位。目录/文件在 POSIX 为 0700/0600，Windows 使用 ACL。已验证 macOS；Windows/Linux 尚未实际验收。

## 命令与恢复

使用 `/help` 查看当前命令。`/hint`、`/reason` 已复用同一付费路径；`/facts`、`/wait`、历史分页、网页接管确认属于后续阶段，尚未实现。

- 普通文字直接聊天，`//help` 发出字面 `/help`；未知命令报错，不发送给房间。`/say -- TEXT` 可发送以选项开头的原文。
- `/join CODE` 遇到密码房时隐藏输入；自动化使用 `soup --json --password-stdin /join CODE`。不接受明文密码参数，房间密码不写入会话文件。`--takeover` 明确接管自己的旧座位，普通读取不会接管。
- 付费指令默认使用座位积分；`--use-personal-points` 仅授权本次使用个人积分。
- 写命令支持 `--request-key UUID`。键、动作和必要正文在发送前保存。网络中断或 5xx 返回 `REQUEST_RESULT_UNKNOWN`，先 `/request UUID`，必要时用原键、原内容重新执行。密码房重试需重新输入相同密码。
- 同键并发、重复 AI 请求不会重复写入、调用模型或扣费。同键更改内容会冲突。键至少保留 7 天，到期保留墓碑，不能重新执行；本地待确认正文保留 7 天，服务端拒绝已到期的原请求键；应在 7 天内恢复未知结果。
- 仅主动加入、聊天和付费指令续期；读取不续期。闲置约 60–65 分钟被服务端清退，未到期的 AI 请求会延迟清退。
- JSON 成败都写 stdout，诊断写 stderr。退出码 0 成功、2 输入、3 身份、4 规则、5 网络/结果未知、6 服务异常。

已确认完成、退款或到期的本地请求立即清理；未确认记录保留 7 天，超期由服务端键墓碑阻止重执行。

会话文件含登录凭证及待确认正文，应视为私密文件；不要提交、分享或复制给其他玩家。

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
```

初始化器不删除已有表；Auth/Realtime 使用最小本地替身，不安装 pg_cron。该测试不能替代真实 Supabase 登录、公开 key 权限验证或网页验收。线上 Cron 配置与真实 AI 流程另行检查。
