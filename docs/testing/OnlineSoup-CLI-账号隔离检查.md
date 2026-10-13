# CLI 账号隔离检查

日期：2026-10-12。范围：网页／CLI 登录、浏览器授权、退出、客户端 Cookie、身份与缓存保存、多个 Agent 的本地隔离。结论基于当前代码、自动化测试、本地及生产真实 Supabase 验证；0.3.2 已发布。

## 发现及修复

1. “使用其他账号”先通过网页 Cookie 客户端登录，覆盖网页身份。此前已改为非持久化 Auth 客户端以真实账号调用授权 RPC，密码及终端验证码在同一表单确认；不写网页 Cookie。
2. CLI API 客户端先保存响应 Cookie，主命令随后才保存 user_id、username 及缓存清理。成功切换的两次保存之间退出进程，或收到携带新 Cookie 的损坏响应时，可能留下新凭证配旧身份／旧缓存。现在 `/login`、浏览器 `/poll` 收取和 `/logout` 先验证响应，再将 Cookie、账号身份及缓存边界一起保存。账号变化清理旧 sync/room；无效或失败登录响应不安装 Cookie。浏览器证明保留至主流程确认保存，仍支持原证明恢复。

## 其他检查结果

| 路径 | 当前证据与边界 |
| --- | --- |
| 网页普通退出 | `src/app/auth/actions.ts` 显式 `scope: local`，不主动全局退出 CLI；代码检查，未新增同账号两端真实退出实测。 |
| CLI 密码切换／退出 | 服务端退出旧 Auth session 使用 `scope: local`，先由 RPC 校验座位及撤销 CLI 登记。客户端凭证只保存在自身 CookieJar。 |
| 浏览器授权／收取 | 批准 RPC 仅 authenticated，校验真实 session、认证 user.id、原 CLI 账号约束及终端码；发行 RPC 仅 service_role；新 CLI session 单独登记。真实网页 A／CLI B 流程通过。 |
| 多 Agent 本地目录 | `ONLINESOUP_HOME` 决定 session 文件；OS 文件锁阻止同目录并发进程，origin 不符拒绝读取。共用目录仍会串用同一登录状态，必须固定各自 home；两个独立进程／账号文件测试通过。 |
| 请求键与缓存 | pending 写意图带 user_id，重提交时拒绝别的账号的本地请求键；缓存按 user_id+room 分组，账号切换清理 sync；服务端仍校验请求归属及房间成员身份。 |
| 密码恢复 | 当前密码重置使用默认全局退出，是账号安全相关路径，不能据此承诺 CLI 登录保留；本次未修改其策略或执行邮件恢复测试。 |

未在上述检查范围内发现其他确认的网页／CLI 账号串用问题；此结论不是所有 Auth 场景的全面安全审计。

## 文件登录

0.3.2 新增 `/login --credentials-file ./account.json`，JSON 仅含 `identity`（用户名或邮箱）和 `password`。不与用户名参数、浏览器选项或 `--password-stdin` 混用。保留原终端及标准输入登录方式。

文件读取限制为普通文件、最多 16 KiB，兼容 UTF-8 BOM；POSIX 检查当前所有者与私有权限，拒绝文件符号链接。错误消息不会包含 JSON 源文，密码不进入命令参数、日志或 session.json。Windows 不提供 POSIX 权限校验，应使用系统私有目录权限，尚未实机验收。每个 Agent 都要固定独立 `ONLINESOUP_HOME`，账号文件也需从各自仓库中忽略。

## 验证

- CLI 24 项测试通过，其中新增凭证／身份原子保存、失败响应不安装 Cookie、文件 BOM／格式／权限／符号链接、双进程独立账号及输出不含密码等覆盖。
- 网站 19 项测试、typecheck、build 通过；lint 0 错误、3 条旧警告。
- 本地 Next.js 生产构建 + 真实 Supabase 公开 key 的 Auth/RPC：两个实际 CLI 从不同文件登录，核对持久化 user_id、username 与 CookieJar；故意错误密码后文件内原身份及 Cookie 完整保留；网页测试账号仍有效；两个 CLI logout 成功。
- 临时用户经既有 `admin_cleanup_user_before_delete` 后 Auth 删除；临时密码文件及 session 目录已删除。未加入房间、未修改 schema/权限。
- 2026-10-12 生产部署 `dpl_AQbxRWDcag4JsUDdvUabPSSi9Tku` READY，别名 `https://onlinesoup.ai0506.com`。0.3.2 生产清单、tgz、SHA-256 与 Markdown 指南均与本地一致，生产下载包离线安装通过。网页 A／CLI B 的密码+终端码授权、CLI ack/logout、两个实际 CLI 私有账号文件登录、错误密码保留原身份及 Cookie 均通过。临时用户与凭证文件已清理，未创建房间或修改数据库。Arena 六工作区共享运行时已升级0.3.2，17个原入口/私密会话文件哈希保留。未推送GitHub；Windows/Linux实机及真实房间付费流程未重测。 未重测密码恢复邮件、真实座位接管或长时间运行。
