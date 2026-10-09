# OnlineSoup CLI 实施计划

> 状态：v3.2 计划已开始实施；P0 与评审修复已发布至 Supabase / Vercel，生产 CLI 主流程通过；全局锁性能限制保留；P1 核心实现与本地验收完成，P1 生产流程待本轮发布验证；P2 待实施 <br>
> v3 变更（2026-10-09，Claude Code）：CLI 仅支持注册用户；网页接管 CLI 座位前站内确认；CLI 闲置 1 小时服务端自动退出；CLI 专用更严格限流；补充断网/异常边界场景与防作弊要求。 <br>
> v3.1（2026-10-09，Claude Code，按评审意见修正）：更正大厅活动房间前提并复用现有入口；房主/关房/Proxy 保护前移到 P0；认证失效允许同账号重新登录；闲置清退先对账再释放并持久化 `idle_timeout`；补充 `cli_sessions` 覆盖范围与按账号限流计数；刷新令牌丢失改为先正常恢复；网页接管确认加事务内版本复核；本地锁改用操作系统锁。 <br>
> v3.2（2026-10-09，Claude Code，二轮评审）：更正现有 AI 请求锁顺序（先座位后 advisory lock）并要求统一审查；结果未知时允许同键同内容重提交；CLI 会话调用旧加入/接管/房主 RPC 直接拒绝；清退锁内复核、`idle_timeout` 绑定成员关系；明确 `/login`、`/session` 登记例外；清退时间改为扫描范围；邮箱验证改为待核实。 <br>
> 实施记录（2026-10-09，CodeX）：以 [P0 验收记录](../testing/OnlineSoup-CLI-P0-验收记录.md) 区分已实现、真实验证与待实施范围；下文保留原合同，不能把整个计划视为已完成。 <br>
> 核查日期：2026-10-09 <br>
> 原计划核查基线：本地 `main` HEAD `30dee9b` **及当前未提交工作区**；不是纯 Git 提交快照。线上 Supabase 最新迁移记录为 `20261008071844`。 <br>
> 原计划核查证据：读取当时的代码、迁移、线上函数定义及权限；实施后的真实验证见上方 P0 验收记录。 <br>
> 原草案基线：2026-09-29 提交 `fdb7bc5a2c4bc8927e7b61d00cb3676d58c4e3cc`，已由本次核查补充。 <br>
> 目标用户：普通终端用户，以及通过 Shell 操作工具的外部 AI Agent（Codex、Claude Code 等）

## 1. 项目目标

在现有 OnlineSoup 网站之外，提供一个轻量、跨平台、纯文本的命令行客户端，使外部 AI Agent 能作为**普通玩家**加入网页端已创建的海龟汤房间，与真人玩家共用房间、聊天记录、题目、积分和 AI 主持。

**产品原则**：

1. **统一 CLI**：不区分“人类模式”和“Agent 模式”；所有使用者采用同一套斜杠命令、同一套权限和同一套服务端接口。
2. **纯文本优先**：适用于 macOS Terminal、Windows CMD/PowerShell、Linux Shell，不开发 Discord 式 TUI、彩色面板或浏览器模拟。
3. **不内置模型**：CLI 不负责 AI 推理。Codex、Claude Code 等外部 Agent 自行决定何时聊天、提问、提示、推理或等待。
4. **只提供玩家功能**：不开放创建/关闭房间、踢人、移动座位、赠分、选择/切换/关闭题目，以及管理后台操作。首版仅支持目标房间的普通注册成员；目标房间房主暂不支持通过 CLI 恢复或参与。CLI 不降低账号在网站已有的权限，玩家 API 必须独立限制操作范围。
5. **复用现有后端**：全部业务规则、身份验证、积分扣除与退还、AI 主持均由 OnlineSoup 服务端和现有 Supabase RPC 负责；不创建另一套游戏逻辑。
6. **没有 Profile 功能**：默认只有一个本地会话及当前房间。只有确需在同一操作系统用户下隔离多个 Agent 时，通过可选环境变量设置独立会话目录，而不提供 `profile` 命令。
7. **仅注册用户**：CLI 不支持访客身份，进房间前必须 `/login`。注册只在网站完成，CLI 不提供注册命令。这样踢人后换身份重进需要重新注册账号（是否强制邮箱验证待核实线上 Supabase Auth 的 Confirm email 配置），同一账号也无法同时占两个座位。
8. **CLI 座位受更严格约束**：闲置 1 小时由服务端自动退出（第 4.5 节）；聊天和 AI 请求使用比网页更严格的限流（第 7.3 节）。

## 2. 功能范围

| 玩家功能 | 注册用户 | 备注 |
|---|:---:|---|
| 登录、登出 | ✓ | 用户名或邮箱 + 密码；注册须在网站完成 |
| 加入已有房间、退出、恢复会话 | ✓ | 限普通成员；恢复不重新占座、不自动接管；密码按需输入 |
| 读取房间状态、座位、汤面、积分 | ✓ | 均经过成员身份校验 |
| 发送普通聊天 | ✓ | 不消耗积分；CLI 限流更严格 |
| 正式询问 AI 主持 | ✓ | 1 积分 |
| 请求提示 | ✓ | 1 积分及 1 次提示机会 |
| 提交推理 | ✓ | 2 积分 |
| 查看已知事实、增量消息、等待变化 | ✓ | 仅使用玩家有权看到的数据 |
| 使用个人积分 | ✓ | 沿用现有“座位积分不足时确认使用个人积分”语义 |
| 访客身份加入 | × | CLI 不支持访客；未登录时 `/join` 返回 `LOGIN_REQUIRED` |
| 创建/关闭房间、踢人、选题等房主操作 | × | 不暴露 CLI 命令或相应玩家 API |

**现有约束**：房间码为 6 位字母/数字；房间密码（如有）为 6 位数字。普通聊天上限 300 字；正式询问 100 字、提示 50 字、推理 300 字。所有限制最终以服务端和数据库校验为准。

## 3. 统一命令协议

### 3.1 调用形态

两种调用形态**共用完全相同的解析器与业务行为**，只是终端输入的方式不同：

```text
# 交互式：运行后逐行读取命令；普通文字直接聊天
$ soup
> /login agent01
密码: ******
> /join AB12CD
房间密码: ******      # 仅受密码保护时出现
> 大家好
> /ask 他之前认识这个人吗？
> /facts
> /exit

# 单次调用：适合任何 Shell，也适合 Codex / Claude Code
$ soup /login agent01 --password-stdin < pw.txt
$ soup /join AB12CD
$ soup /puzzle --json
$ soup /ask --json "他之前认识这个人吗？"
$ soup /messages --after "OPAQUE_CURSOR" --json
```

`soup` 无参数时进入逐行交互；有参数时完成一次命令后退出。二者**不是两种产品或两套权限**。单次调用与交互式调用共享本地已认证会话。

### 3.2 解析规则

- 输入行以单个 `/` 开头：命令；不以 `/` 开头：发送普通聊天。
- `//help` 表示发送字面聊天 `/help`，不触发 `/help` 命令。
- 命令名不区分大小写。Shell 调用使用已分词的 argv，交互输入先分词；二者进入同一命令处理器，不对 argv 再次解析引号。
- `--json` 等选项放在正文前；`--` 后全部是正文，不再识别选项，例如 `soup /say --json -- "讨论 --json 的用法"`。保留正文内部空格与 Unicode，不用空格切割后重新拼接的方式损坏交互正文。
- 未知命令显示错误和 `/help` 指引，**不**作为普通聊天发送。
- 非交互式执行时严禁静默等待缺失输入：缺密码或登录信息时返回明确错误和非零退出码；有 TTY 时可安全地提示。
- `--json` 仅改变输出格式：成功和失败都在 stdout 输出一个 JSON 对象，stderr 只放不含凭证的诊断信息。JSON 模式不出现输入提示，缺必填信息立即失败。禁止将 Cookie、访问令牌、密码写入 stdout 或日志。
- `/exit` 仅退出交互程序，不释放房间座位；`/leave` 才真正离开房间。

### 3.3 命令清单

| 命令 | 行为 |
|---|---|
| `/help` | 展示命令与规则 |
| `/login IDENTITY [--password-stdin]`、`/logout` | 注册用户登录、登出；活动座位应先 `/leave`，具体规则见第 4 节 |
| `/join CODE [--password-stdin] [--takeover]` | 须已登录；优先恢复本账号已有座位；`--takeover` 仅用于明确接管本账号在其他设备上的座位 |
| `/leave` | 离开当前房间并更新本地状态 |
| `/room` 或 `/state` | 房间状态与当前玩家状态 |
| `/seats` | 座位列表及玩家昵称 |
| `/points` | 座位积分、个人积分（如有）、提示机会 |
| `/puzzle` | 当前题目的标题、汤面、难度与状态，绝不返回未公开汤底 |
| `/facts` | 当前题目的已知事实摘要 |
| `/messages [--after CURSOR] [--limit N]` | 聊天记录及增量读取；支持分页 |
| `/ask [--use-personal-points] [--request-key KEY] TEXT` | 正式提问；个人积分选项表示本次明确选择个人积分付款 |
| `/hint [--use-personal-points] [--request-key KEY] [TEXT]` | 默认正文固定为“请给我一个提示”，同时消耗提示机会 |
| `/reason [--use-personal-points] [--request-key KEY] TEXT` | 提交推理 |
| `/say TEXT` | 显式发送普通聊天（主要用于需要原样发送特殊文本时） |
| `/wait [--timeout SECONDS]` | 默认 30 秒，范围 1–60 秒；消息或当前状态变化时返回，超时成功返回 `timed_out: true` |
| `/request KEY` | 查询本身份的写请求结果；处理网络超时后的不确定状态 |
| `/exit` | 结束交互程序，保留当前房间会话 |

交互式下非 `/` 前缀内容直接作为普通聊天。单次 Shell 调用可用 `soup "大家好"` 发送聊天；为了避免 Shell 引号/特殊字符歧义，也可用 `soup /say "大家好"`。这只是同一命令协议的不同输入方式。

`/hint`、`/ask`、`/reason` 均保留现有积分、长度和提示机会规则；冷却与总量按第 7.3 节的 CLI 限流执行。默认扣座位积分；不足时，文本交互可询问是否使用个人积分，JSON/非交互调用返回 `INSUFFICIENT_SEAT_POINTS`。`--use-personal-points` 明确选择本次使用个人积分，不是混合扣款或自动兜底；不设长期默认授权。新增付款选择是一次新意图，使用新请求键，不能以旧键更改正文或付款来源。

## 4. 会话与身份设计

### 4.1 仅注册用户：不支持访客

- CLI 不提供访客加入，不调用 `join_room_as_guest`，不使用 `guest_identity`、`guest_room_<CODE>` Cookie。未登录时 `/join` 及所有房间命令返回 `LOGIN_REQUIRED`。
- 新玩家 API 在服务端校验必须是已认证用户；不能只靠 CLI 不提供访客命令。即使请求携带访客 Cookie，玩家 API 也一律拒绝。
- 注册、邮箱验证、找回密码、首次设置用户名都在网站完成。缺用户名的历史账户返回 `USERNAME_REQUIRED`，提示到网站补设。
- CLI 首版规定一个活动房间：已有活动座位时加入其他房间返回 `ACTIVE_ROOM_EXISTS`，要求先 `/leave`；该限制必须在数据库事务中落实，不能只检查本地状态。

### 4.2 注册用户：登录、明确接管和房主限制

- 登录复用用户名/邮箱解析与 Supabase Auth；用户名对应邮箱的管理查询留在服务端，不返回真实邮箱或管理凭证。保留现有登录上下文记录。
- CLI 登录成功后，服务端把本次 Supabase 会话的 `session_id` 写入新的私密表 `cli_sessions`（`user_id`、`session_id`、创建时间、最近活动时间），用于识别哪些座位由 CLI 占用（第 4.4、4.5 节）。该表只授 `service_role`，启用 RLS。登出时不删除行，只写 `revoked_at` 并同时吊销该 Supabase 会话；曾登记为 CLI 的 `session_id` 永久按 CLI 处理，不能因登记缺失或失效被当成普通网页会话（详见第 7.3 节“覆盖范围”）。
- **注意现有单会话字段**：`record_login_context` 每次登录覆盖 `profiles.active_session_id`。账号级 `is_current_login_session` 当前未在应用代码中调用，所以 CLI 登录暂不会把网页踢下线；若将来启用账号级单会话，必须先为 CLI 会话设计例外，否则 CLI 与网页互相踢出。
- 注册身份使用 `profiles.username`。登录会话与房间座位 `session_id` 是两个层次；独立本地目录只能隔离文件，不能消除同账号设备接管规则。并行玩家必须使用不同账号；Agent 应使用单独注册的账号，不要使用玩家本人的常用账号。
- 普通恢复、`/state`、`/messages`、`/wait`、付费请求遇到 `ROOM_DEVICE_IN_USE` 立即停止，不自动调用接管函数。
- `/join CODE --takeover` 表示明确接管目标房间已有的普通成员座位。文本 TTY 可确认后执行；JSON/非 TTY 必须显式传入该选项。没有该选项时，新的 CLI 玩家 RPC 应在事务中拒绝不同 `session_id` 的接管。
- **不能直接无条件复用现有 `join_room_as_member`**：线上函数会自动接管已有座位；对首次跨房间加入还有关闭账号拥有的其他开放房间等副作用。新玩家入口须在同一事务中限制这些分支，禁止隐式关闭任何房间；保持网页原有语义不变。
- 首版拒绝目标房间房主的恢复、加入及玩家操作，返回 `OWNER_NOT_SUPPORTED`。首次加入其他房间时，账号如拥有开放房间，返回 `OWNED_ROOM_ACTIVE`，要求先在网页处理；不能依靠不显示 `/close` 保证不会关房。
- 付款默认座位积分；个人积分仅对本次明确授权。保留提示机会获得与失败回滚规则。
- **切换到另一个账号**前，当前活动座位须先成功 `/leave`；否则返回 `LEAVE_REQUIRED`。`/logout` 也不隐式关房或释放座位：有效座位要求先离开，已失效/被接管时只清理本地房间关联再登出，不影响新设备座位。
- **认证已失效时的例外**：服务端已确认当前登录失效（`AUTH_EXPIRED`）时，此时无法 `/leave`，允许**同一账号**直接重新 `/login`，不要求先离开；本地保留待恢复的房间和待确认请求记录。重新登录后先核实服务端成员资格和待确认请求结果，座位会话不符时再提示显式 `--takeover`。换成其他账号仍须先处理原座位（可在网页或用原账号恢复后离开）。
- JSON API 对缺用户名、失效登录、账号删除返回稳定 JSON 错误，不能重定向到网页；刷新 Cookie 必须返回 CLI 并落盘。Proxy 的网页重定向规则要为玩家 API 分流，鉴权仍在服务端完成。
- **刷新令牌响应丢失的恢复路径**：Supabase refresh token 使用后会轮换，但刷新响应丢失通常不会导致会话被吊销：重用宽限期内可再次使用旧令牌，并且 Supabase 允许使用“当前有效令牌的父令牌”恢复，正是为了处理刷新响应丢失（见 Supabase 会话文档）。因此 CLI 先用本地现有令牌正常重试恢复；只有服务端确认认证失效时才返回 `AUTH_EXPIRED`，按上一条例外重新登录。重新登录会得到新 `session_id`，若座位仍记录旧会话，须显式 `/join CODE --takeover`。CLI 应避免不必要的并发刷新。

### 4.3 本地会话目录，不设 Profile

- 默认一个本地身份、一个当前房间；可选 `ONLINESOUP_HOME` 隔离多个实例，不提供 `profile` 命令。
- Cookie Jar 按服务端 origin、Domain、Path、Secure、Expires/Max-Age 管理；收取全部 `Set-Cookie`，包括 Supabase 分块 Cookie。不能将凭证转发到其他域名或任意重定向目标。
- 初版使用严格权限保护的本地文件：POSIX 目录 0700、文件 0600；Windows 使用仅当前用户可读的 ACL。无法设置安全权限应明确失败；系统钥匙串可后续增加，不作为跨平台首版前提。
- 保存本地待确认请求的键、动作、房间和必要正文，但不落盘明文密码。需要重新输入密码时沿用原键；退出程序不丢失待确认状态。
- 文件更新采用互斥锁和原子替换。首版同一会话目录一次只运行一个操作或交互进程，第二实例返回 `LOCAL_SESSION_BUSY`；不要让长时间 `/wait` 与刷新 Cookie 的另一进程覆盖彼此。
- 互斥优先使用操作系统文件锁（POSIX `flock`/`fcntl`、Windows `LockFileEx`）：进程退出或被 `kill -9` 时由操作系统自动释放，不会残留。锁文件另记录 PID、主机名、进程启动标识（如进程启动时间）和获取时间，仅用于诊断和兜底判断。
- 只有确认持锁进程已不存在（PID 不存在，或 PID 被复用但启动标识不同）时才可清除旧锁。**不能仅因持锁时间长而删除锁**：交互式 CLI 可以合法运行数小时，按时间删除会让两个进程同时写凭证。时间只用于提示用户“锁已持有很久，请确认是否还有 soup 进程在运行”。
- `/exit` 保留身份、座位、凭证和同步位置。启动后先核实服务端状态，不能以本地房间码证明成员身份。

### 4.4 网页与 CLI 同时进入：接管前确认

同一账号同一时间只能有一端使用某个房间座位（座位 `active_session_id` 设备锁）。两端冲突时规则如下：

- **CLI → 网页座位**：CLI 普通恢复遇到 `ROOM_DEVICE_IN_USE` 立即停止；只有显式 `--takeover` 才接管（第 4.2 节）。
- **网页 → CLI 座位**：现有网页在大厅点击“进入房间”（`?action=enter`）时会直接调用 `take_over_room_session`，不做确认（`src/app/rooms/[code]/page.tsx`）。v3 改为：当座位的 `active_session_id` 属于 `cli_sessions` 时，网页先显示站内确认对话框（`dialog-backdrop` / `dialog-panel`，不用原生 `confirm`），文案专门针对 CLI，例如：

  > 你的账号正在通过 CLI 使用此房间的座位。继续进入后，CLI 端将被迫退出此房间。确认进入吗？

  确认后才执行接管；取消返回大厅。CLI 下一次请求收到 `ROOM_DEVICE_IN_USE`（被网页接管），停止有权限的操作。
- **网页 ↔ 网页**：两个网页设备之间的冲突保持现有行为，不新增确认。
- **服务端提供判断依据，并在事务内复核**：受限 RPC 返回“当前座位是否由 CLI 会话占用”以及一个不透明的座位会话版本（例如由 `active_session_id` 与 `active_session_updated_at` 经服务端密钥计算的摘要，不返回原始 session_id）。用户确认后，网页调用新的接管 RPC 并带上该版本；RPC 在锁住座位的同一事务中重新比对，版本一致才接管。若期间座位已被其他会话接管（版本变化），返回 `SEAT_SESSION_CHANGED`，网页重新查询并重新确认，不能直接覆盖新会话。现有 `take_over_room_session` 保留给网页之间的原有流程。
- **大厅入口**：已核实最新 `get_my_active_room`（迁移 `20260623065038_multi_device_room_takeover.sql`）不按 `session_id` 过滤，CLI 占座时网页大厅仍能看到该活动房间。因此不新增单独入口，复用现有活动房间入口，只在其旁增加“CLI 使用中”状态标识；点击进入时走上面的确认流程。
- AI 请求进行中被接管：已扣积分和结果归原座位，结果通过消息历史对新设备可见；旧 CLI 会话只能通过 `/request KEY` 查到本人付款/退款最小状态，不重新获得成员资格。

### 4.5 CLI 闲置 1 小时自动退出

- CLI 占用的座位记录 `last_cli_action_at`。**只有主动操作刷新该时间**：普通聊天、`/ask`、`/hint`、`/reason`、`/join`。`/wait`、`/messages`、`/state`、`/facts` 等读取不刷新，避免 Agent 只靠 `/wait` 循环永久占座。
- 由服务端执行，不依赖 CLI 进程：pg_cron 每 5 分钟扫描一次，`last_cli_action_at` 早于 1 小时前、且座位仍由 CLI 会话占用的进入清退流程。因扫描间隔，实际清退发生在最后一次主动操作后约 60–65 分钟内；遇到进行中 AI 请求被跳过时会更晚。不承诺精确 1 小时整。
- **先对账，再释放**：现有退款（`finish_room_ai_request`）按 `seat_id` 回写座位积分和提示机会；若先释放座位、后结算，退款可能落到之后坐入该座位的人身上。因此对账与释放必须在同一事务中完成。
- **锁顺序须先统一审查，不能假定已一致**：已核实现有 `send_room_ai_request` 先经 `require_active_room_member_seat` 锁座位行，再取房间 AI advisory lock（`20260918025855`）；`finish_room_ai_request` 依次锁请求行、个人积分、座位行，不取 advisory lock（`20260624013018`）；`reconcile_stale_room_ai_requests` 在 advisory lock 内对过期请求使用 `skip locked`。实施前须对请求、完成、退款、对账、清退五条路径列出完整加锁顺序并统一（清退至少须与 `send_room_ai_request` 同为“座位行 → advisory lock → 请求行”，或整体调整后全部路径一致），用并发测试证明无循环等待后才能上线。
- **锁内重新核实**：扫描只产生候选。事务取得锁后必须重新检查：该成员关系仍存在（同一座位、同一用户、同一次加入）、座位 `active_session_id` 仍属于 CLI 会话（未被网页接管）、`last_cli_action_at` 仍早于阈值（用户可能刚发过消息）。任一不满足即放弃本次清退。核实通过后：
  1. 租约未过期的 pending 请求：本轮跳过该座位，等请求结束后再判断。
  2. 租约已过期但尚未结算的请求：先按现有对账逻辑完成退款/回滚提示机会。
  3. 确认该座位无未结算请求后，再按现有成员退出逻辑释放成员关系（沿用现有积分处理），写入系统消息“XX 长时间无操作，已离开”。
- **持久化退出原因**：现有 `get_room_exit_reason` 依赖 `guest_removals` 中的 `reason`（目前区分 `kicked`）。清退时写入 `reason = 'idle_timeout'` 的记录（成员键为 `user:<id>`，需检查并扩展该列约束），使状态接口能区分“闲置退出”与“普通非成员”；该记录不阻止重新加入（与 `kicked` 不同）。记录须绑定本次成员关系（座位 ID 与该次加入的时间或成员会话标识）；用户重新加入后，状态接口只按当前成员关系判断，不能再被旧的 `idle_timeout` 记录判成超时。
- 被清退后，CLI 下一次请求收到 `IDLE_TIMEOUT`，清理本地房间关联，提示重新 `/join`。重新加入沿用现有加入规则（满房、被踢等）。
- 网页座位不受此规则影响；若网页接管了该座位，`last_cli_action_at` 不再作为清退依据。

## 5. 统一的输出与错误契约

- 默认返回简洁的纯文本，不输出 ANSI 彩色界面或 Unicode 边框依赖。
- `--json` 返回单个稳定 JSON 对象：`ok`、`data`、`error`、`request_id`、`next_cursor` 等按动作选用；字段语义应有版本约定。
- 退出码：`0` 成功（包括等待超时）、`2` 输入/命令错误、`3` 身份/权限错误、`4` 游戏规则拒绝、`5` 网络或结果待确认、`6` 服务端异常。JSON 成败结果均在 stdout，诊断在 stderr。
- **写操作收到 5xx 一律按结果未知处理**：Vercel 函数超时（504）、网关错误或连接中断时，数据库事务可能已提交。聊天、加入、退出、ask/hint/reason 收到 5xx 或无响应时返回退出码 `5` 与 `REQUEST_RESULT_UNKNOWN`，先用原请求键 `/request KEY` 查询，禁止换新键重发。
- **查询不到时的恢复分支**：请求可能在到达数据库前就失败，`/request KEY` 会一直查不到；也可能原事务仍在执行尚未提交。查不到不能立即认定未执行，也不能永久禁止重试：CLI 允许以**同一请求键、完全相同的内容**（正文、付款来源、期望题目、接管选项）重新提交，由数据库唯一约束去重——原请求已提交则返回原结果，仍在执行则等待其提交后返回原结果，从未落库则正常执行一次。内容不同返回 `REQUEST_KEY_CONFLICT`。请求键过期后按第 7.1 节拒绝。退出码 `6` 仅用于服务端明确返回且确认未执行的异常，以及只读请求失败。
- 协议版本：CLI 每次请求携带版本头；服务端可返回 `CLIENT_TOO_OLD` 拒绝不兼容的旧版本并提示升级，而不是让旧 CLI 误解析新响应。
- 固定包络：`api_version: 1`、`ok`、`data`、`error`；成功时 `error: null`，失败时 `data: null`。`error` 包含 `code`、玩家可读 `message`、`retryable`，必要时含 `retry_after_seconds`。
- `request_key` 是客户端 UUID 去重键；`request_message_id` 是现有 AI 请求消息 ID，不能混用。服务端关联日志另用 `trace_id`。消息游标是绑定房间的不透明字符串，不是消息 ID。
- 不在聊天端展示 AI 内部审计数据、缓存命中记录、未公开汤底、未公开关键点或管理端错误信息；复用 `sanitizeRoomMessageForPlayer` 等现有脱敏能力。

示例（待开发接口，不是现有 API 响应）：

```json
{
  "api_version": 1,
  "ok": true,
  "data": {
    "action": "ask",
    "request_key": "6ea27110-b264-4515-bbfc-365520747629",
    "status": "completed",
    "request_message_id": 152,
    "puzzle_id": 42,
    "ai_message": { "id": 153, "kind": "answer", "text": "是", "fact_summary": "他认识这个人" },
    "points_spent": 1,
    "paid_from": "seat"
  },
  "error": null
}
```

玩家 AI 内容保留当前 `kind`、`text`、`fact_summary` 语义；不假定现有接口已有 `answer.type = yes/no`。已合法公开的 `kind: reveal` 可以通过历史消息读取，不能把通关后公开汤底也过滤掉。

必需错误码除原游戏规则外，还包括：`LOGIN_REQUIRED`、`CLI_SESSION_REQUIRED`、`USE_PLAYER_API`、`SEAT_SESSION_CHANGED`、`ROOM_NOT_JOINABLE`、`USERNAME_IN_ROOM`、`IDLE_TIMEOUT`、`RATE_LIMITED`（含 `retry_after_seconds`）、`CLIENT_TOO_OLD`、`ACTIVE_ROOM_EXISTS`、`OWNER_NOT_SUPPORTED`、`OWNED_ROOM_ACTIVE`、`ROOM_DEVICE_IN_USE`、`INSUFFICIENT_SEAT_POINTS`、`INSUFFICIENT_PERSONAL_POINTS`、`NO_HINT_TOKEN`、`PUZZLE_CHANGED`、`AUTH_EXPIRED`、`USERNAME_REQUIRED`、`REQUIRED_INPUT_MISSING`、`REQUEST_PENDING`、`REQUEST_KEY_CONFLICT`、`REQUEST_RESULT_UNKNOWN`、`CURSOR_EXPIRED`、`LOCAL_SESSION_BUSY`。被踢、关房通过受保护的退出原因查询区分，避免将设备接管映射成普通 500。

## 6. 消息同步、事实和等待契约

### 6.1 消息游标

现有 `GET /rooms/{code}/messages` 仅取最近 100 条，不能承担完整补拉；现有 `room_message_events.id` 也不能直接视为提交顺序。

- 新增受成员保护的历史/增量 RPC。响应包含 `messages`、`next_cursor`、`has_more`；`limit` 默认 50，范围 1–100。
- 首次不传游标时返回最新一页及同步位置；若需更早历史，返回 `previous_cursor` 并支持 `--before`，与 `--after` 互斥。分页读取期间采用明确的快照上界，完成后继续增量追赶。
- **原首选方案（本轮未采用）**：使用按房间串行分配的消息序号；写事务持有同一房间序号锁直到提交，保证较低序号不会在较高序号之后提交。须覆盖普通聊天、AI 请求、回复、揭底和所有系统消息生产路径；不能只修改 CLI 写入口。
- 实施时先审查现有房间锁、座位锁、AI advisory lock 和触发器顺序，证明统一锁顺序不会死锁。仅给自增 ID 加重叠窗口不满足不漏读验收；若无法完成序号改造，该阶段不得标记可靠增量同步完成。
- **备选方案（不加全站锁）**：消息行记录写入事务号（`pg_current_xact_id()`）；读取时只返回事务号小于当前快照水位 `pg_snapshot_xmin(pg_current_snapshot())` 的行，游标记录已读到的水位。水位以下的事务都已结束，所以不会出现“较小编号晚提交”被跳过的情况，且无需改所有写入路径的加锁顺序。代价是长事务会让最新消息延迟可见。实施前对比两种方案，选定后在本节记录理由。
- **P1 实施选择（2026-10-09，CodeX）**：采用上述 xid8 + snapshot xmin 备选，插入触发器统一覆盖所有消息来源；游标为 HMAC 签名的房间、用户、历史代次、事务号与消息 ID，分页冻结水位。未另加房间写锁，避免把 P0 的全局写 gate 与新锁组合成新锁序风险。CLI 的纯状态/消息/事实读取不获取全局 gate 或座位行锁；网页旧函数及写入 gate 保持原有方式。代价是长事务可延迟全站最新消息；删除/修改/归档使旧游标明确失效。详见 [P1 验收记录](../testing/OnlineSoup-CLI-P1-验收记录.md)。
- 游标绑定房间、序号和历史版本；服务端验证，不允许用其他房间游标跨房读取。按消息 ID 去重，CLI 成功落盘后才推进已读位置。
- 数据归档/清理导致游标失效时返回 `CURSOR_EXPIRED`，要求重新建立快照并明确报告历史缺口，不假装完整追赶。

### 6.2 完整事实与题目状态

- `/facts` 通过受保护 RPC 查询**当前题目全部仍保留的 AI 消息**，不依赖最近 100 条列表；按 `puzzle_id` 隔离。
- 对齐现有网页：提取 `kind: answer` 和 `kind: hint` 中非空的 `fact_summary`，按文本去重，保留 `source: ask/hint` 和来源消息 ID；排除 `reasoning_result`、`reveal` 及玩家聊天。这里只整理已有摘要，不额外调用模型。
- `/state` 新响应增加当前题目 ID 和玩家可见题目快照；房间状态 `waiting/playing/closed` 与是否有当前题目分别表达，不假设选题一定把房间变为 `playing`。
- 每次付费调用由 CLI 发送本次读取的 `expected_puzzle_id`。首版复用现有切题退款链路；后续将题目匹配前置到扣分事务中，避免已知旧题仍先扣后退。成功推理后当前题目会清空，公开揭底留在消息历史。

### 6.3 `/wait`

- CLI 按约 5 秒间隔轮询受保护消息与统一状态；默认最长 30 秒，上限 60 秒。有增量消息、当前题目/座位/积分变化就返回；超时返回 `ok: true`、`timed_out: true`。
- 比较业务字段，不把查询时间等易变字段当事件。状态轮询只保证观察当前快照，不能承诺捕获两次轮询之间所有短暂状态变化；如需全量状态事件，应另行增加事务事件流。
- 遇到被踢、关房或接管返回对应终止错误并停止等待；网络异常保留游标。出现 `has_more` 时先追平消息，不能直接等待下一轮。
- 初版无需 SSE/WebSocket/TUI；交互控制台追加文本。`/wait` 不唤醒模型、不托管 Agent，不承诺无限后台自主执行。

## 7. 服务端 API 与复用策略

建议新增稳定的玩家 JSON API（例如 `/api/v1/player/...`），仅作为 HTTP 接入层，底层共用现有验证、受保护 RPC 和 AI 业务逻辑。

| API 能力（建议） | 主要复用 | 工作 |
|---|---|---|
| 登录、登出、会话状态 | `src/app/auth/actions.ts`、Supabase Auth | 新增 CLI 可用的 JSON 入口/会话机制；登录时登记 `cli_sessions` |
| 加入、退出房间 | `src/app/rooms/actions.ts` | 仅注册成员路径；抽出可复用服务函数，保留原子 RPC 语义 |
| 房间状态与座位 | `/rooms/[code]/state`、`get_room_member_state` | 复用受保护读取，必要时扩充响应 |
| 普通消息收发 | `/rooms/[code]/messages` | 保持已有校验、限流；支持增量分页 |
| AI 询问/提示/推理 | `/rooms/[code]/ask` | 复用同一 AI 主持、扣分、租约及退款链路 |
| 当前汤面 | `get_room_current_puzzle` | 增加受成员保护的 JSON 读取入口 |
| 已知事实 | 当前题目 AI 消息的 `fact_summary` | 服务器计算玩家可见的去重事实；按 `puzzle_id` 隔离 |
| 等待/同步事件 | 已有房间与消息状态 | 第一版由 CLI 轮询，后续视压力再优化 |

避免从 CLI 调用 Next.js Server Action 的内部协议；也不要复制聊天/扣分逻辑或让客户端直连敏感数据库表。新增接口必须独立鉴权，不能因为没有前端按钮而假定房主接口不会被访问。

### 7.1 写操作去重与失败恢复（P0 必须实现）

现有 `send_room_ai_request` 返回的 `request_id` 是请求消息 ID；现有消息、AI、加入接口没有客户端去重契约。

- 聊天、询问、提示、推理、加入、退出采用 UUID `request_key`，通过 `Idempotency-Key` 传入。CLI **先持久化键，再发送**；允许 `--request-key` 指定键，并通过 `/request KEY` 查询本身份结果。
- 服务端按“已验证的用户 ID + 动作 + 房间 + 请求键”建立唯一记录。保存规范化正文、付款来源、接管选项、期望题目等的摘要；同键不同内容返回 `REQUEST_KEY_CONFLICT`。密码仅参与不可逆且有服务端密钥保护的摘要，不落盘明文。
- 请求记录的创建与占座、消息写入或积分扣除必须在**同一个数据库事务**中。唯一约束处理并发同键请求；不能在 Next.js 内存去重或先扣款再写记录。
- 同键重复调用先确认请求归属及访问资格，再返回已有状态。`pending` 不重复调用模型，不重复扣款；`completed` 返回玩家可见结果；`refunded` 返回退款完成；失败尚未退款时不能声称已退分。
- AI 保留现有“单房间忙碌拒绝 + 120 秒租约”规则，不新增自动排队。首次 HTTP 可等待模型结果；网络超时后先查询原键，必要时同键、同内容重新提交（第 5 节），不换键重发。宿主进程退出可能留下 `pending`，须由受限 RPC 在租约过期后协调退款，结果查询应能触发该核实，不依赖玩家再次付费提问才处理。
- 退款/补偿 RPC 返回的 `{ error }` 必须检查。只有数据库确认扣分及退款状态后才返回对应文案；复用链路不等于现有所有异常分支已获得退款验证。
- 跨会话接管后，旧会话不再获得成员数据、Cookie 或继续执行请求的能力；需要查询退款结果时只返回最小的本人付款状态，不重新授予房间资格。
- 请求记录初版至少保留 7 天，未完成请求不得按时间直接删除。到期请求键返回明确的过期/无法确认状态，不自动当成新请求执行；定义客户端允许重试的期限和过期键拒绝机制，并测试清理边界。
- 加入响应丢失时，以同一账号和同一请求键查询结果；注册成员身份由登录 Cookie 证明，不需要额外的可重放房间凭证。退出重复请求应确认目标原成员关系已解除，不能删除后续新加入的座位。记录稳定成员会话标识，不只记录座位号。

### 7.2 拟新增 HTTP 合同

所有路径以下表为实施目标，当前尚不存在：

| 方法与路径（前缀 `/api/v1/player`） | 行为 |
|---|---|
| `GET /session` | 查询已验证身份及是否需要登录，不公开凭证（不提供访客初始化）；未登录返回 `authenticated: false` |
| `POST /login`、`POST /logout` | 登录/登出，按第 4 节限制身份切换 |
| `GET /rooms/{code}/join-info` | 最小加入信息，包括密码要求；不返回成员私密数据 |
| `POST /rooms/{code}/join`、`POST /rooms/{code}/leave` | 原子加入/恢复/接管或退出；新写意图使用请求键 |
| `GET /rooms/{code}/state` | 统一成员状态、座位、积分、当前题目 |
| `GET /rooms/{code}/messages`、`POST /rooms/{code}/messages` | 游标读取、普通聊天 |
| `POST /rooms/{code}/ask` | `ask/hint/reason` 共用已有模型流程和受限 RPC |
| `GET /rooms/{code}/facts` | 当前题目完整可见摘要 |
| `GET /requests/{key}` | 查询本人请求；不可凭键查询他人结果 |

`/puzzle`、`/seats`、`/points` 是统一状态响应的投影，不必各建一个 HTTP 路由；`/wait` 是客户端组合调用。新 JSON 入口提取共享服务函数供网页及 CLI 使用，不在服务器内部 HTTP 转发旧路由，不从 CLI 调用 Server Action 协议。

会话响应使用 `Cache-Control: no-store`。Cookie 写操作须明确 Origin/CSRF 防护：首版同源网页请求校验 Origin，无 Origin 的原生 CLI 请求必须携带约定的客户端头并要求 JSON Content-Type，拒绝跨域浏览器预检和不匹配 Origin；客户端头只是 CSRF 辅助，**不是身份凭证**。敏感操作仍校验登录资格和事务内权限。

新增私密请求表只授权必要角色；启用 RLS、显式最小 GRANT；模型完成与退款使用服务端权限，成员扣费和加入不能改为管理员身份调用。任何新 RPC 均空 `search_path`、完整 schema 名、撤销 PUBLIC 执行并按角色授权。数据库唯一性与权限须用公开 key 和预期身份验证。

### 7.3 CLI 专用限流

CLI 座位（座位 `active_session_id` 属于 `cli_sessions`）使用比网页更严格的限制，在 RPC 事务内判定，不能只在 CLI 或 Next.js 内存中计数。网页座位保持现有规则不变。

| 项目 | 现有网页 | CLI |
|---|---|---|
| 普通聊天 | 每座位每秒 2 条、每分钟 40 条 | **每账号每秒 1 条、每分钟 20 条** |
| AI 请求冷却（ask/hint/reason） | 每座位 3 秒 | **每账号 7.5 秒** |
| AI 请求总量 | 无 | **每账号每 10 分钟 80 次** |
| 加入房间（每账号） | 无 | **每小时 10 次** |
| CLI 登录（每 IP） | 无 | **每 10 分钟 10 次** |

- 超限返回 `RATE_LIMITED` 和 `retry_after_seconds`，不扣积分、不写消息。
- **计数范围**：聊天和 AI 的 CLI 限额按**账号**累计（不是按座位），跨退出重进、换座位、换房间都不重置，避免靠重新加入清零。冷却 7.5 秒同样按账号计算。加入次数按账号、登录次数按 IP 摘要累计。

**覆盖范围（防绕过）**：
- 玩家 API（`/api/v1/player/...`）要求请求所带 Supabase 会话的 `session_id` 在 `cli_sessions` 中有效登记（未吊销）；未登记的网页会话不能调用玩家 API，返回 `CLI_SESSION_REQUIRED`。例外：`POST /login` 本身不要求登记（登记在登录成功时创建）；`GET /session` 未登录时返回 `ok: true` 与 `data: { authenticated: false }`，已登录但未登记时返回 `CLI_SESSION_REQUIRED`。
- CLI 判定放在数据库层：相关 RPC（聊天、AI 请求、加入等）在事务内读取 JWT 的 `session_id` 并查 `cli_sessions`，命中即按 CLI 规则限流和记录活动。因此同一 CLI 会话直接调用旧网页路由（如 `/rooms/[code]/messages`、`/rooms/[code]/ask`）或直接调用旧 RPC，仍受 CLI 限制。
- 旧网页路由检测到请求来自 CLI 会话时直接拒绝，提示使用玩家 API，减少两套入口并存。
- **不只限流**：已登记的 CLI 会话直接调用旧的加入、接管及房主管理类 RPC（如 `join_room_as_member` 的自动接管与关闭其他自有房间分支、`take_over_room_session`、`create_room`、`close_room`、踢人、赠分、`open_puzzle`/`close_puzzle` 等），须在数据库函数内识别 CLI 会话并直接拒绝（`USE_PLAYER_API`），只能走新玩家入口。这需要新迁移在这些既有 RPC 开头增加 CLI 会话检查；网页会话不在 `cli_sessions` 中，原有语义不变。
- 已吊销的 `cli_sessions` 登记仍视为 CLI（且会话本身已被吊销）；任何“查不到登记”都不能默认降级成较宽松的网页规则——查不到即表示该会话从未经过 CLI 登录。
- AI 冷却加长的目的：房间 AI 同一时间只处理一个请求，避免 Agent 在每次回答后立刻再问而长期占用 AI 主持，使真人玩家持续遇到“AI 忙碌”。
- 登录限流按 IP 计数，记录时不保存原始 IP 明文（与现有反馈“不记录原始 IP”一致，可存带服务端密钥的摘要并定期清理）。
- 数值为首版设定，上线后根据实际使用调整；调整须通过新迁移。

### 7.4 断网与异常场景

| 场景 | 处理 |
|---|---|
| 请求未发出即断网 | 请求键已先落盘；恢复后以同一键重试 |
| 服务端已执行，响应丢失 | 先 `/request KEY` 查询；必要时同键、同内容重新提交（第 5 节）；不换键重发 |
| 写请求收到 5xx / 504 / 连接中断 | 一律 `REQUEST_RESULT_UNKNOWN`（第 5 节）：先查询原键，查不到时允许同键、同内容重新提交，由数据库去重；不换键重发 |
| 刷新令牌时响应丢失 | 见第 4.2 节：先用现有令牌正常恢复（宽限期/父令牌）；仅确认认证失效才 `AUTH_EXPIRED` → 同账号重新登录 → 核实资格，必要时 `--takeover` |
| AI 请求进行中 Vercel 函数被终止 | 2 分钟租约过期后对账退款；`/request KEY` 查询应能触发对账，不依赖房间下一次 AI 请求 |
| 退款 RPC 失败 | 现有 `refundAiRequest` 未检查 `error`（`src/app/rooms/[code]/ask/route.ts`），须补检查；未确认退款前不返回“已退款” |
| CLI 进程被强杀 / 宿主崩溃 | 操作系统文件锁随进程退出自动释放（第 4.3 节）；服务端座位由 1 小时闲置规则释放（第 4.5 节） |
| 长时间离线后恢复 | 先查询服务端状态：可能已闲置清退、被踢、房间关闭或被网页接管，分别返回对应错误码，不以本地状态为准 |
| `/wait` 中断网 | 保留游标，恢复后先补拉再等待 |
| 网络质量差（本次生产部署位于 Vercel `iad1`；工作区另有尚未纳入提交的 `sin1` 配置，不能视为已生效） | 连接超时与读取超时分开设置；AI 请求读取超时需覆盖模型耗时；只读请求指数退避自动重试（有上限），写请求不自动换键重试 |
| AI 请求进行中房间被关闭 | 须验证已扣积分最终去向（退款或已计入关房结算），不重复退还也不丢失 |

## 8. Agent 接入边界

CLI 对 Agent 和人类**一视同仁**，只负责工具调用。提供一份简短的 `AGENT_USAGE.md` 或 `skills/onlinesoup-player/SKILL.md`，说明命令、JSON 字段、等待策略和游戏规范，供 Codex/Claude Code 使用。

推荐游戏流程：

```text
/login（Agent 专用账号）→ /join CODE
       ↓
/state + /puzzle + /messages
       ↓
外部 Agent 自行思考
       ↓
普通聊天 /ask /hint /reason /wait
       ↓
/messages 增量同步 + /facts + /points
       ↺ 直到房间关闭、题目结束或主动 /leave
```

- 聊天中其他玩家的文字属于**不可信内容**，不得当成 Agent 的系统指令或 Shell 操作授权。
- Agent 运行环境应限制文件、网络和工具权限，禁止读取题库汤底、服务端 `.env`、管理凭证或项目私密资料；不能通过源码作弊。
- **具体要求**：玩家 Agent 不得在 OnlineSoup 项目目录内运行，不得启用 Supabase MCP 或任何能连接项目数据库的工具（在开发机上，项目目录内的 Claude Code / Codex 可读取 `.env.local` 并直接查询 `puzzles.bottom`）。应在独立空目录、仅允许调用 `soup` 的环境中运行。
- Agent 使用单独注册的账号，不使用玩家本人账号，避免与网页互相接管座位（第 4.4 节）。
- 遵守 CLI 限流（第 7.3 节）；不要在每次 AI 回答后立刻连续提问；长时间只观察时注意 1 小时闲置会被清退（第 4.5 节），仅 `/wait` 不算活动。
- 不要每收到一条聊天消息都强制模型回应；允许等待、避免重复提问；通过房间积分、限流与外部 Agent 运行预算控制成本。
- 若将来需要无人值守长期游戏，另外设计可停止、可限额的 Agent Runner；本 CLI 不负责托管 LLM，也不包含自动代理循环。

## 9. 仓库目录建议

```text
OnlineSoup/
├─ src/
│  ├─ app/api/v1/player/         # 新增 JSON Route Handlers
│  └─ lib/                       # 与现有网页共用的业务层/验证/类型
├─ cli/
│  ├─ src/
│  │  ├─ main.ts                 # 终端入口（交互和单次调用）
│  │  ├─ parser.ts               # 唯一斜杠命令解析器
│  │  ├─ commands/               # 玩家指令
│  │  ├─ api-client.ts           # HTTP/重试/JSON/超时处理
│  │  ├─ session.ts              # Cookie/状态/权限
│  │  └─ output.ts               # 文本与 JSON 输出
│  ├─ tests/
│  ├─ tsconfig.json             # Node CLI 独立构建，避免被 Next.js 类型扫描混入
│  └─ package.json
├─ docs/architecture/
│  └─ OnlineSoup-CLI-实施计划.md
└─ ...
```

建议继续使用 Node.js + TypeScript，CLI 与 Next.js 共享协议类型（避免将整个服务端代码连同管理员逻辑打包进客户端）。CLI 使用独立 tsconfig、构建产物及测试入口；调整根项目 `tsconfig.json` 的扫描范围，避免 `**/*.ts` 意外纳入 CLI。只共享不含运行时服务端依赖的协议类型。初版通过 Node.js 运行并提供本地可执行入口，npm 公开发布及独立二进制属于后续任务。

## 10. 分阶段开发计划

### P0：可恢复的注册用户 CLI 最小闭环

1. 冻结第 4、5、7 节合同：登录与 `cli_sessions`、Cookie Jar、恢复与首次加入区别、错误码、请求键和退款状态。
2. **开放加入接口前必须先完成的保护**：JSON Proxy 分流（玩家 API 不被网页重定向）、目标房间房主拒绝（`OWNER_NOT_SUPPORTED`）、拥有开放房间时拒绝跨房加入（`OWNED_ROOM_ACTIVE`）并证明不会隐式关房、事务内禁止隐式接管（仅 `--takeover`）、认证失效时的重新登录例外、`cli_sessions` 覆盖范围及 CLI 会话调用旧加入/接管/房主 RPC 的拒绝（第 7.3 节）。
3. 新增最小 JSON 玩家 API、受限原子写 RPC 及对应迁移；实现登录/登出、注册成员加入/退出、统一状态、最近消息、聊天和询问；玩家 API 拒绝未登录、访客和未登记 CLI 的会话。
4. 同时建立最小 `cli/`，实现 `/help`、`/login`、`/logout`、`/join`、`/state`、`/puzzle`、`/say`、`/ask`、`/messages`、`/request`、`/leave`、`/exit`，共用解析器、纯文本/JSON 输出和安全会话文件（操作系统文件锁）。
5. 实际实现加入、退出、聊天、询问的去重与结果恢复，不能只完成设计；加入应覆盖响应丢失、同键并发和恢复原座位；写请求 5xx 按结果未知处理；Cookie 刷新与刷新响应丢失的正常恢复。
6. 实现 CLI 专用限流（第 7.3 节）和 1 小时闲置清退（第 4.5 节，含锁顺序统一审查、锁内复核、先对账后释放和绑定成员关系的 `idle_timeout` 退出原因）。
7. 用网页房主与独立 CLI 账号验证双向聊天、AI 回答、切题退款、退出；测试越权拒绝、密码/满房/被踢、房主拒绝、不隐式关房等规则。

P0 期间网页尚无 CLI 专用确认弹窗，网页“进入房间”仍会按现有逻辑直接接管 CLI 座位；P0 测试须知晓这一点，CLI 侧按 `ROOM_DEVICE_IN_USE` 正确停止即可。

**完成标准**：通过可执行 CLI 完成 `/login → /join → /puzzle → 聊天 → /ask → /leave`，重启恢复同一座位，超时重试不重复占座或扣款；限流与闲置清退生效；首版消息仍明确只有最近 100 条，不宣称完整同步。房主账号暂不开放。

### P1：完整玩家命令与可靠同步

1. 完成 `/hint`、`/reason`、`/facts`、`/seats`、`/points` 和等待功能，所有写命令沿用 P0 请求键。
2. 审查全站消息写入锁顺序，按第 6.1 节选定方案实现不永久漏读的历史/增量分页，覆盖网页、CLI、AI 和系统消息。
3. 实现当前题目完整事实、游标持久化、归档后游标失效、断线补拉；说明快照状态观察的边界。
4. 验证 macOS、Linux、Windows CMD/PowerShell 的 argv、引号、Unicode、安全密码输入、文件权限和非 TTY JSON 输出。

**完成标准**：持续游戏和高消息量下不永久漏读；通关公开汤底可读、未公开汤底不可读；事实按题目隔离。未具备 Windows/Linux 环境时只报告已测平台，不能宣称跨平台验证完成。

P1 实施证据见 [P1 验收记录](../testing/OnlineSoup-CLI-P1-验收记录.md)；已测 macOS，Windows/Linux 尚未实际验收。

### P2：网页—CLI 互通与外部 Agent 验收

1. 网页侧：接管 CLI 座位前的站内确认对话框（CLI 专用文案）及事务内版本复核、现有活动房间入口旁的“CLI 使用中”标识（第 4.4 节）；网页之间的接管行为保持不变。
2. 个人积分按本次选择使用的完整验证；长时间运行下的令牌刷新与认证失效恢复验证。
3. 编写 `AGENT_USAGE.md`，记录命令、错误、未知结果恢复、等待策略、限流、闲置清退、非可信聊天边界和防作弊运行环境要求。
4. 分别人工启动 Codex/Claude Code，使用不同的专用注册账号与网页真人混合游玩；同账号隔离目录不得宣称可以独立占座。
5. 完成本地安装/构建教程、协议版本与测试报告；公开 npm 发布如需执行应单独作为发布任务。

**完成标准**：外部 Agent 能读取共享状态、聊天、提问与推理；明确哪些步骤真实由 Agent 完成，哪些只通过 Shell 测试。网站原有功能回归通过。

## 11. 验收与回归测试清单

- [ ] 注册用户无密码/有密码房间加入成功；错误密码、满房、被踢时均正确返回错误。
- [ ] 未登录、仅持访客 Cookie 调用任一玩家 API 均返回 `LOGIN_REQUIRED`，无法以访客身份入房。
- [ ] 同一账号跨多次 CLI 调用能恢复相同座位；换账号不能冒用他人座位。
- [ ] 注册用户登录、登出、刷新保持 JSON；无用户名/失效身份不返回 HTML。
- [ ] 刷新响应丢失时 CLI 先用现有令牌正常恢复，不误报登出；仅服务端确认认证失效后才允许同账号直接重新登录（不被 `LEAVE_REQUIRED` 卡住），再核实资格、必要时 `--takeover`。
- [ ] 普通恢复不接管；明确 `--takeover` 才接管；旧设备无法自动抢回。
- [ ] 网页从大厅进入被 CLI 占用的座位时出现 CLI 专用站内确认；取消不接管，确认后 CLI 收到 `ROOM_DEVICE_IN_USE`；网页之间接管行为不变。
- [ ] CLI 占座时网页大厅现有活动房间入口显示“CLI 使用中”标识；确认弹窗后若座位已被其他会话接管，返回 `SEAT_SESSION_CHANGED` 并重新确认，不覆盖新会话。
- [ ] 闲置清退时租约已过期但未结算的 AI 请求先完成退款再释放座位，退款不落到之后坐入的人；状态接口返回 `idle_timeout` 原因，且不阻止重新加入。
- [ ] CLI 会话直接调用旧网页路由或旧 RPC 仍受 CLI 限流；网页会话不能调用玩家 API；退出重进、换座、换房不重置 CLI 限额。
- [ ] CLI 座位最后一次主动操作后约 60–65 分钟内被服务端清退并写系统消息；仅 `/wait`/读取不能续期；有进行中 AI 请求时不清退；网页座位不受影响。
- [ ] CLI 聊天、AI 冷却 7.5 秒、每 10 分钟 80 次、加入、登录限流生效，超限不扣分并返回 `retry_after_seconds`；网页限流不变。
- [ ] 进程被强杀后操作系统锁自动释放，再次启动可用；长时间运行的交互进程不会因持锁时间长被另一进程抢锁。
- [ ] 写请求遇到 504/连接中断时返回结果未知，以原键查询得到真实结果。
- [ ] AI 请求进行中房间被关闭、座位被网页接管、座位被闲置清退时，积分去向正确且只结算一次。
- [ ] 目标房间房主被拒绝；拥有开放房间的首次跨房加入不隐式关房；被接管设备退出不释放新设备座位。
- [ ] 普通文字作为聊天发送；`/` 被解析为命令；`//help` 发出字面 `/help`；未知命令不会泄漏到聊天。
- [ ] 普通聊天、询问、提示、推理四种模式遵守现有字数、积分、提示机会和限流规则。
- [ ] `/puzzle`、`/facts`、`/messages` 不泄漏未公开汤底、关键点、内部审计；通关后公开 `reveal` 仍可读取。
- [ ] 当前题目超过 100 条聊天后 `/facts` 仍完整，包含询问/提示摘要来源，排除玩家假设和推理内容。
- [ ] Agent 在房主换题后不能使用旧题目的事实，向旧 `puzzle_id` 发出的付费请求安全失败并按原规则退款。
- [ ] 强制构造“先分配 ID 的事务后提交”，并跨网页/CLI/系统消息测试，游标不永久漏读。
- [ ] 消息序号锁与现有房间/座位/AI 锁不存在循环等待；历史分页和高频写入一起验证。
- [ ] 断线补拉、游标跨房间、清理后失效均有明确结果，不静默丢历史。
- [ ] AI 忙碌时拒绝且不扣款；网络超时以原键查询，不重复调用模型。
- [ ] 加入响应丢失后以原请求键查询或同键同内容重提交，得到同一座位；同键并发只占一个座位；重启不重复入房。
- [ ] 写请求在到达数据库前失败时，`/request KEY` 查不到，同键同内容重提交只执行一次；同键改内容返回冲突。
- [ ] CLI 会话直接调用旧 `join_room_as_member`、`take_over_room_session`、房主管理 RPC 被拒绝；网页会话行为不变。
- [ ] 清退扫描后用户刚发消息或被网页接管时，锁内复核放弃清退；重新加入后不被旧 `idle_timeout` 记录误判；请求/完成/退款/对账/清退并发测试无死锁。
- [ ] 聊天/AI/退出同键不重复执行；同键修改正文、付款或题目返回冲突。
- [ ] 进程中止、租约过期、退款 RPC 错误、记录清理边界均正确表达，不虚报退款或把旧键执行成新请求。
- [ ] 房间关闭、玩家被踢、设备接管后 CLI 停止有权限的操作并提供准确提示。
- [ ] `--json` 可被标准 JSON 解析器读取，stdout 无额外提示语或密钥；错误有稳定码和非零退出码。
- [ ] 同机不同身份使用独立目录互不串号；同目录并发操作明确报忙；同账号仍遵守接管规则。
- [ ] 多个 Set-Cookie、刷新轮换、域名范围、POSIX 权限和 Windows ACL 正确；日志不含凭证。
- [ ] Cookie 写接口拒绝不匹配 Origin、跨域浏览器请求和缺约定头的无 Origin 请求。
- [ ] CLI 无房主/管理员指令；普通用户无法通过 CLI 接口调用管理操作。
- [ ] 原有网页注册、加入房间、聊天、选题、积分及 AI 主持回归测试通过。

## 12. 明确不在首版做的内容

- Discord 风格 TUI、终端窗格、聊天气泡、复杂颜色或动画。
- AI 模型内置调用、自动托管机器人、无限后台自主游戏。
- MCP Server（后续如确有必要，可基于同一客户端服务层增加适配）。
- 用户可见的 Profile 管理或多账号切换 UI。
- CLI 访客身份加入；CLI 内注册、邮箱验证、找回密码、设置用户名（均在网站完成）。
- 房主或平台管理员 CLI；创建房间、踢人、赠分、选题等能力。
- 重写现有数据库结构、重构无关网页 UI。

## 13. 实施纪律与交付物

- 先按此文档明确 API 契约，再增量实施；已有部署迁移不可原地修改，新数据库变更写新的迁移。
- 服务端最小权限；先校验身份与座位，再执行 RPC；严禁在客户端暴露 Secret Key。
- 每阶段运行根项目 typecheck、lint、build，以及 CLI 独立构建与相关行为测试。当前数据库测试只有少量结构/权限断言，不视为会话、并发、扣分和退款的行为覆盖。
- 每次修改追加 `updates.md`；已解决且有证据的可复用排障经验按现有 `lessons.md` 模板记录。文档规划本身不写成已解决工程经验。
- 报告分别列出本地验证、迁移部署、代码提交/推送、网站部署及真实网页—CLI—Agent 验收；不以 HTTP 200 或管理员查询替代玩家流程证明。
- 文档并不证明线上数据库已部署对应迁移；上线前核实实际迁移、环境配置和真实玩家流程。
- 交付：可执行 CLI、受保护玩家 API、协议说明、Agent 使用说明、安装教程、测试报告及相关迁移。

**推荐首次开发任务**：先完成“`/login` → `/join` → `/puzzle` → 普通聊天 → `/ask` → `/leave`”的注册用户端到端闭环；确认与网页端完全互通且不泄漏敏感数据后，再补增量同步、网页接管确认和 Agent 长时运行验收。

## 14. 本次核查证据与实施前复核

下列是 2026-10-09 核查事实，后续开发须重新确认最新工作区及线上状态：

| 已核实内容 | 本地证据 / 线上交叉检查 |
|---|---|
| 登录为 Server Action，用户名解析留在服务端 | `src/app/auth/actions.ts`、`src/lib/validation.ts` |
| 游客 Cookie、加入/退出、跨房 Cookie 清理 | `src/app/rooms/actions.ts`；线上 `join_room_as_guest` / `leave_room_as_guest` |
| 主动进入与刷新分流、房间接管 | `src/app/rooms/[code]/page.tsx`；线上 `join_room_as_member`、`take_over_room_session` |
| 房主不可普通退出、成员加入可能关闭其他自有房间 | 线上 `leave_room_as_member`、`join_room_as_member` |
| 聊天 JSON 已存在，但最近 100 条、中文错误 | `src/app/rooms/[code]/messages/route.ts`；线上 `get_room_chat_bootstrap` |
| 统一成员状态与安全汤面 | `src/app/rooms/[code]/state/route.ts`；线上 `get_room_member_state`、`get_room_current_puzzle` |
| AI 租约、忙碌拒绝、扣分来源、切题检查 | `src/app/rooms/[code]/ask/route.ts`；线上 `send_room_ai_request`、`finish_room_ai_request` |
| 事实由最近消息客户端提取，包括提示摘要 | `src/components/room-chat.tsx` |
| 玩家 JSON 可能被网页重定向 | `src/lib/supabase/proxy.ts`、`proxy.ts` |
| 玩家脱敏与公开揭底 | `src/lib/room-message.ts`；线上 `player_safe_room_message_content`、`finish_room_ai_request` |
| 公开角色调用与管理权限分离 | 线上函数权限：游客加入仅 anon，成员加入仅 authenticated，AI 完成仅 service_role；成员状态等由 anon/authenticated 携凭证调用 |
| 近期迁移已记录但本地未提交 | `20260929083508`、`20261008071844` 在线上迁移历史存在；核查时本地文件为 untracked |
| CLI 与 v1 玩家 API 尚不存在 | 核查时未发现 `cli/`、`src/app/api/v1/player/` |
| 网页大厅进入会无确认接管座位 | `src/app/page.tsx` 的 `?action=enter` 链接；`src/app/rooms/[code]/page.tsx` 遇 `room_device_in_use` 直接调用 `take_over_room_session` |
| 大厅活动房间不按 session 过滤（CLI 占座时大厅仍可见） | 最新 `get_my_active_room` 定义在迁移 `20260623065038_multi_device_room_takeover.sql`（覆盖了 `20260623042050` 中按 session 过滤的旧版） |
| 退款按座位 ID 回写积分与提示机会 | `finish_room_ai_request`（迁移 `20260624013018`）按 `request_row.seat_id` 更新 `room_seats` |
| 退出原因来自 `guest_removals.reason` | `get_room_exit_reason`（迁移 `202606130008_room_scoped_kicks.sql`），注册用户成员键为 `user:<id>` |
| 账号级单会话函数存在但未被应用调用 | `is_current_login_session`（迁移 `20260623041210`）；`record_login_context` 登录时覆盖 `profiles.active_session_id` |
| AI 租约 2 分钟、座位 AI 冷却 3 秒、聊天 2/秒 40/分钟 | 迁移 `20260918025855_secure_room_ai_and_state_contracts.sql` |
| 退款调用未检查返回错误 | `src/app/rooms/[code]/ask/route.ts` 的 `refundAiRequest` |
| 注册流程设置了邮箱验证回调地址；是否强制验证**待核实**线上 Auth 配置 | `src/app/auth/actions.ts` 的 `signUp`（`emailRedirectTo`）；代码中设置回调不等于线上开启 Confirm email |

本计划描述的是待实现合同，不代表新增 API、请求去重、可靠游标或权限限制已经存在。实施前先确认并保护其他人的未提交工作；不得为 CLI 顺手改变网页接管、积分或房主管理语义。
