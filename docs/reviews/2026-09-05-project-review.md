# OnlineSoup 全项目评估：保留、修复与补缺

评估日期：2026-09-05。代码基线：本地 `main`，`f73095e`。扫描开始时工作区干净。

## 结论

建议继续使用现有 Next.js + Supabase 的单体架构，保留“房间驱动、游客参与、数据库事务、AI 双路判断、缓存人工审核、聊天优先”的产品方向。当前主要问题是业务规则在不同入口不一致、权限保护没有贯穿所有返回路径，以及失败后的状态恢复不完整。迁移到微服务、更换数据库或重做视觉，不能解决这些问题。

最先处理三件事：注册积分信任用户 metadata、退出/踢人重置座位积分、管理员二次验证调用错误。随后修复聊天脱敏、设备锁、AI 请求结算和资源上限，再开展功能扩展。

这里的“立即补充”主要指保障现有玩法可靠运行所缺少的能力，不等于立刻增加好友、通知、公开大厅或更多 AI 模式。

## 范围、证据与限制

- 对 `src` 的 86 个 TS/TSX/CSS 文件（约 21,606 行）进行入口、依赖和规则扫描，重点通读认证、房间、AI、后台和同步链路。另检查 `proxy.ts`、构建配置、依赖锁文件、项目规范与文档。
- 盘点全部 80 份 SQL 迁移（约 12,757 行），按函数名追踪后续覆盖，关键结论使用最新定义而非已被替换的旧实现。并未在空数据库中完整重放迁移。
- `npm run typecheck`、`npm run lint`、`npm run build` 均通过；生产构建显示 Next.js **16.2.9**。检查通过不等于业务和权限已经通过测试。
- `npm audit --omit=dev --json` 返回 **4 个 high 依赖包项**：next、nanoid、postcss、sharp。这是依赖审计结果，不代表四项都已在本项目中实际利用成功。
- 用本地生产构建实际查看桌面首页、375×812 首页和登录页、手机教程、桌面技术文档。没有登录管理员、创建房间、发送聊天或调用付费模型；房间及后台复杂交互结论以代码为主，未完成全设备视觉验收。
- 使用本地配置指向的 Supabase 和公开 key 做了 `limit=0` 的只读权限探针，没有读取业务记录。rooms、room_seats、room_message_events 的匿名查询被接受；profiles、room_private、guest_sessions、room_messages、puzzles、puzzle_qa_cache、user_feedback 返回 401。对 room_seats 的 `active_session_id` 列选择也返回 200。**零行探针证明入口/列可查询，不证明有多少行能通过 RLS。**
- 没有可直接调用的 Supabase SQL 管理工具，本轮未核对线上全部函数体、迁移记录、Auth 配置、平台 WAF、告警和备份套餐。文中的 SQL 缺陷是当前仓库定义下的结论；除上述探针外，不把本地结论冒充线上漏洞利用结果。
- 报告不含密钥、账号记录或聊天内容。只新增评估文档与更新记录，不修改业务代码、数据库或部署，也不公开发布本报告。

优先级含义：**P0** 为建议立即处理的权限/积分根本问题；**P1** 为扩展用户规模前完成的可靠性、隐私和数据正确性问题；**P2** 为随后完成的体验、维护和效率问题。优先级是本项目处理顺序，不是外部漏洞评级。

## 一、逐功能评估

表内问题编号对应后文证据与验收要求。

| 功能 | 好的：继续保持 | 不好的：修复或收敛 | 空缺：下一步补充 |
|---|---|---|---|
| 注册与初始积分 | Supabase Auth、用户名规则、忽略大小写唯一约束 | 注册奖励读取可控 metadata（R01） | 固定公开注册奖励；管理员赠分独立受保护入口及审计 |
| 邮箱/用户名登录 | 两种身份输入、失败提示不直接返回邮箱 | `ilike` 将合法用户名里的下划线当通配符（R24） | 用户名精确匹配；应用侧限流，并核对平台 Auth 限制 |
| 密码恢复 | 有重置页、邮箱回调、密码确认 | 登录页没有自助“忘记密码”；客户端与未使用 Server Action 两套实现 | 自助恢复、重发验证邮件、失败保留输入（R24） |
| 用户名维护 | 注册用户名字来自 profile；在活动房间限制改名 | 多处规则和错误映射分散 | 前端与数据库契约测试；清晰区分名字冲突与服务失败 |
| 管理员认证 | 服务端统一 `requireAdmin()`；HttpOnly Cookie；不靠前端隐藏按钮授权 | 邮箱 nonce 未真正验证（R03）；默认十年设备信任且不可单独撤销（R23） | 真正的二次验证、设备撤销、独立签名密钥、默认不长期记住 |
| 首页/加入房间入口 | 房间码是明确主操作；受邀访客无需注册 | 游客恢复只相信残留 Cookie 是否存在（R24） | 校验当前成员状态；无效房间恢复为可重新加入的首页 |
| 创建房间 | 费用预览；建房、扣费、建座位在一个 RPC 中 | 数据库不限制最多 20 座，密码/名称规则也不同（R07） | 数据库上限、创建速率限制；零积分时解释访客不能使用 AI |
| 游客身份 | 随机 token、数据库只存 hash、HttpOnly Cookie | 座位、身份、积分、请求绑定混在一起（R02/R10） | 稳定的成员记录与明确过期状态；身份不依赖可复用座位 |
| 注册用户加入 | 使用真实 profile 名称；事务校验密码、占位和重名 | 直连加入其他房间可自动关旧房但未退款（R10） | 所有离开/换房入口复用同一结算规则 |
| 设备接管 | 明确进入才接管；旧页面主动检测并提示 | 消息 RPC 不校验 active session；移座不迁移锁（R05） | 在读写权限边界统一校验，并覆盖房主操作和移座 |
| 座位与在线状态 | 临时积分属于座位的规则可以保留；在线状态辅助展示 | 会话、提示次数与历史身份跟随座位残留；网络错误可能被当关房（R05/R11/R15） | 人、座位、参与历史分离；离线状态和恢复提示 |
| 赠分/退出/踢人/关房 | 赠分和关房有积分流水及事务入口 | 退出/踢人无来源补满或抹去赠分；在途 AI 与关房不统一结算（R02/R10） | 积分守恒、统一加锁顺序、退出确认、失败结算规则 |
| 普通聊天 | 受保护接口、发送限流、稳定排序、乐观发送 | 聊天入口仍接受付费 AI 模式；失败丢草稿；只保留 100 条（R06/R16/R12） | 只接受 chat、消息幂等键、草稿恢复、历史分页 |
| AI 询问 | 严格/推断分工、分歧仲裁、非稳定结果不自动进缓存 | 20 秒占用窗口过短；存在脱敏旁路（R04/R08） | 完整请求状态、统一截止时间、按阶段记录结果与成本 |
| AI 提示 | 机会限制、已给提示去重、关注未覆盖点 | 历史窗口会遗忘；提示摘要与确认事实的含义不同（R12） | 持久化提示记录、来源标识、可撤销摘要 |
| 推理与通关 | 服务端按评分点算覆盖率，不让模型自报最终分数 | 返回未覆盖关键点正文会泄露解谜内容；70% 通关只按等权数量（R18） | 玩家结果白名单；按题目决定关键点是否必需，做离线评测后再改阈值 |
| AI 失败与退款 | 已有 pending/completed/refunded 和退款 RPC | 忽略退款错误、无崩溃恢复/重试幂等、终态不在事务中校验房间（R08/R09/R10） | 可恢复任务、对账、重试幂等、事务内终态条件 |
| 事实白板 | 同题共享、区分提示来源、推理不直接成为事实 | 从最近 100 条消息重建；会遗忘；重开同一道题复用旧上下文（R12/R13） | 每局持久化事实及来源；失效/撤销；独立读取接口 |
| 题目选择/切题 | 预览、难度筛选、房主权限、切题确认 | 断线漏事件后题目可能不恢复；只用 puzzle_id 标识一局（R13/R15） | 对局 ID、版本、恢复时补拉题目与事实 |
| 题库编辑 | 汤面/汤底/评分点/examples 结构；fact 与 inferential 示例分离 | 改题不失效缓存；缺少评分点仍可开题、收费（R13/R18） | 题目版本、发布校验、修改预览、运行中题目快照 |
| 题库删除/全量导入 | 管理员入口、格式验证、破坏性提示 | 全量删除遇历史外键会失败；单题删除会删除未结算请求（R14） | 默认增量导入/停用；版本化发布；先处理 pending 再执行删除 |
| 问答缓存 | 仅 yes/no、限制代词/复合问题、人工批准、待审过期 | 无版本；模糊等价最多串行 5 次；清理在查询热路径（R08/R13/R25） | 精确命中独立工作、等价判断总预算、版本失效、后台清理 |
| 管理消息审计/AI 错误案例 | 关联问题、保存题目快照、分类状态及导出 | 单路失败被填成双路相同；没有固定回归集（R19） | 失败/来源明确记录；修正错误案例后自动进入评测集 |
| 管理账户/积分/房间列表 | 按 tab 加载、并行查询、编辑时暂停刷新 | 取前 N 条后筛选导致漏查；日期筛选与北京时间备份不一致（R17） | 数据库筛选/分页/总数、统一时间边界、导出完整性 |
| 个人资料/通关记录 | 个人只读本人；摘要与完整积分页分离 | 历史统计依赖当前座位，换人后会归错；reveal 可能重复计推理（R11） | 不变的参与者身份、请求级统计、通关参与记录 |
| 用户反馈/投稿 | 独立页面，不碰房间会话；验证、每日限额和写入同一事务 | 处理结果对提交者不可见；通用文字难关联具体 AI 请求 | 后续补“我的反馈”；AI 反馈引用消息/请求；保留内部备注私密 |
| 管理邮件 | 服务端 Resend、发送人白名单、收件人数及正文限制 | 多收件人直接放 to；无发送幂等、状态记录和超时（R25） | 按用途选单发/BCC、发送回执、失败恢复与重复保护 |
| 备份/清理 | 清理前归档，保护仍被引用的消息；按日合并历史来源 | 事件不回收使新消息无法清理；活动判断只看可删消息；导出重复和公式风险（R20/R21） | 保留策略、全房间活动时间、去重与快照水位、完整数据库恢复演练 |
| 教程/技术文档/运维工具 | 玩家与维护者文档分开；教程可放大图；独立网络探针 | tasks 中轮询、删除等状态已过时；规范并未被测试执行（R22/R25） | 从当前实现维护契约/文档；诊断入口设生命周期；生产监控 |

## 二、架构与设计评估

### 架构

| 架构选择 | 判断 | 建议 |
|---|---|---|
| Next.js App Router 单体 | 保留 | 当前模块规模适合；不需要为修业务错误拆微服务。按领域拆文件即可。 |
| Supabase 托管 Auth/Postgres/Realtime | 保留 | 继续用其事务与权限能力；本次没有证据支持迁移自建数据库能改善上述缺陷。 |
| 业务写入集中到 RPC | 强烈保留，但补齐契约 | “一次 RPC 原子执行”并不自动保证积分守恒，也不保证两个不同 RPC 之间不会竞态。 |
| 普通服务端客户端与管理员客户端分开 | 保留并加固 | 补 `server-only` 边界、管理员动作审计；玩家输入校验不能成为唯一权限防线。 |
| 服务端页面 + 客户端交互 | 保留 | 首屏必须先脱敏再传 Client Component；不把隐藏 UI 当作保密措施。 |
| Realtime 提醒 + 补拉真实状态 | 保留 | 统一房间状态来源，补上题目恢复；区分断线、无权限、空结果和已关房。 |
| HTTP 请求内完成全部 AI 流程 | 修复 | 小规模可以保留同步响应，但必须补幂等、完整超时、过期请求恢复；确有长任务时再引入持久任务执行器。 |
| 全部事实从聊天 JSON 推导 | 应替换 | 聊天显示窗口可以截断，持久事实和业务历史不能随之截断。 |
| 多组件通过 window CustomEvent 协作 | 收敛 | room-chat、live-room-seats、puzzle-panel 使用类型化房间状态 Provider/hook，减少订阅遗漏、重复请求和事件次序依赖。 |
| 可复用 seat_id 作为历史身份 | 应替换 | seat 表示位置；member/participant 表示参与者；request/round 表示本次行为及对局。 |
| 迁移逐次追加 | 保留 | 不修改已经部署的迁移；新增空库重放测试、生成数据库 TS 类型和有效 RPC 签名清单。 |
| 全局 CSS + 超大组件 | 渐进整理 | globals.css 5,699 行、admin/page 1,656 行、deepseek 1,117 行、room-chat 1,032 行、live-room-seats 1,022 行。先按认证、请求状态、同步、展示拆分，不一次重写。 |

### 交互与视觉

| 设计 | 好的部分 | 应修复或补充 |
|---|---|---|
| 整体视觉 | 简洁、统一、中性色、阅读优先 | 保留；无需为此轮问题重做品牌、引入复杂动效或大型组件库。 |
| 首页 | 房间码和继续操作清楚；受邀使用路径短 | 可加一句“如何获得房间码/无需注册加入”；不必立刻变成公开社交大厅。 |
| 房间信息层级 | 聊天主区、详情收纳、手机三段导航符合任务 | 保证输入、返回聊天位置和状态不被刷新打断；这轮没有在线房间的实机验证。 |
| 创建房间 | 积分成本预览有价值；零积分适合纯聊天 | 0 积分默认值对访客 AI 局有陷阱；在建房选项旁解释或提供“纯聊天/含 AI 预算”预设。 |
| 聊天输入 | 四种意图有明确价格和字数 | 中文输入法保护、各模式草稿独立、失败可恢复（R16）；禁用按钮的 title 不能作为手机唯一说明。 |
| 破坏性操作 | 切题、部分删除已有站内确认 | 关闭房间、退出房间等仍直接提交；统一确认组件，展示影响及退款含义。 |
| 弹窗 | 有 aria-modal 和站内样式 | 多个弹窗没有焦点圈定、焦点返回或统一 Escape；不只是补 aria 属性。 |
| 登录/注册切换 | 两个模式易懂 | 条件卸载表单使输入丢失，页面高度变化；错误返回会回到登录模式。保存表单状态与明确重试路径。 |
| 教程/文档 | 手机目录折叠；桌面技术文档层级清楚 | 手机教程首屏表格列过窄，存在字词纵向碎裂；改摘要卡片/横向内部滚动。教程较长，增加短版入门入口。 |
| 错误与加载 | 已有发送中、乐观消息和浮层提示 | 缺少应用/房间错误边界；部分查询失败显示空数据或直接跳走。用明确的可重试状态，避免把错误当“没有记录”。 |

## 三、问题证据与验收标准

### R01 · P0 · 普通注册可以影响初始积分

**证据：** [注册触发器](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260617142911_admin_create_emailless_user.sql:14) 读取 `new.raw_user_meta_data.initial_points`，允许 0 到 10 亿，随后写 profile 与注册奖励流水。当前代码把这一字段用于管理员建号，但数据库没有区分其来源。用户能直接向 Supabase 注册接口提交 metadata；网页不提供该字段不能保护它。[Supabase 用户数据文档](https://supabase.com/docs/guides/auth/managing-user-data) 展示了注册时提交 metadata 的接口。

**影响：** 当前迁移定义下，公开注册奖励可被用户操控，破坏积分和 AI 成本限制。未在生产创建账号或修改积分验证。

**处理与验收：** 公开注册固定奖励；管理员初始积分通过独立服务端操作/受保护 RPC 调整并记录操作者。隔离测试中构造额外 metadata，最终仍只能拿到固定奖励；管理员设置必须正常工作。

### R02 · P0 · 退出/踢人会无来源补回积分，也会抹去多余赠分

**证据：** [登录成员退出](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260623042050_room_device_lock.sql:519)、[游客退出](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260615033436_room_system_messages.sql:118) 都把余额设回 `points_per_seat`；同文件 `kick_guest` 也这样处理。自动离开旧房间使用同类逻辑。

**具体后果：** 初始 10 分、用了 7 分后退出，本应剩 3 分，实际回到 10；若赠分后还剩 20，退出反而变成 10。关房又会将当前余额退给房主。这不是单纯的显示误差。

**处理与验收：** 人离开只释放身份，座位预算保留；如业务希望重新发放，必须明确资金来源并写流水。覆盖加入→消耗→退出→重入→踢人→赠分→关房，保证初始投入+后续赠分=已消费+可退余额；不可通过重复进出获得免费 AI 次数。

### R03 · P0 · 管理员邮箱二次验证并未调用真正的验证码校验

**证据：** [verifyAdminEmailCode](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/admin/verify/actions.ts:49) 使用 `auth.updateUser({data:{...}, nonce:token})`，成功后签发管理员验证 Cookie。[Supabase Auth 的官方 UserUpdate 实现](https://raw.githubusercontent.com/supabase/auth/master/internal/api/user.go) 只在密码更新及指定再认证条件下验证 nonce；仅更新 metadata 不进入这段逻辑。

**影响与界限：** 已有管理员登录会话的调用者可能通过格式正确、但未经邮箱验证的输入跨过第二道验证。`requireAdmin` 的管理员身份检查仍存在，**不是普通用户直接成为管理员**。这是代码与上游实现对照所得的高置信结论；未在生产尝试绕过，也未核对托管 Auth 实际版本。

**处理与验收：** 换成真正消费挑战并核验结果的二次认证，例如正确接入 MFA；不要用 metadata 更新充当验证。错误、过期、重放、未发起挑战都必须失败，成功挑战只消费一次，失败不得签发任何信任 Cookie。

### R04 · P1 · 聊天脱敏有首屏和直接 RPC 两条旁路

**证据：** HTTP GET/POST 有删除 `ask_audit`、`cache_hit` 的逻辑，但 [房间首屏](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/rooms/[code]/page.tsx:221) 直接把原始 messages 传给 Client Component；[bootstrap RPC](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260627135935_room_message_realtime_events.sql:155) 原样返回 content，且授予 anon/authenticated 执行权限。

**影响：** 合法房间成员的浏览器可收到内部判定理由和缓存资料；页面只显示标签不能阻止读取网络数据。无需假设匿名非成员能读取聊天。

**处理与验收：** 建立玩家输出白名单，在最底层公开 RPC 和所有首屏/路由一致执行；管理审计走独立路径。验证首屏 RSC、消息 GET、AI POST、直接公开 RPC，均不存在内部审计字段。

### R05 · P1 · 设备锁没有覆盖核心操作，移座也不迁移设备锁

**证据：** 最新 [发送聊天/AI 的 RPC](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260624020000_raise_message_length_limits.sql:8) 校验 user_id 与座位，但没有核对 `active_session_id`。页面校验和 15 秒前端轮询不能替代写入鉴权。[move_seat](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260615144343_fix_move_seat_unique_order.sql:104) 只迁移 nickname、user_id、occupied_at，不迁移或清理 active_session 字段。

**影响：** 被接管设备仍可绕过页面直接发起成员操作；移到曾被占用的空座位时，可能继承残留设备状态。

**处理与验收：** 核对所有用户态读写 RPC 的房间会话检查；迁移成员会话状态时同时清理原座位。双设备接管后，旧设备的发消息、AI、赠分、关房等应按统一规则拒绝；移座不错误登出新设备。

### R06 · P1 · 普通聊天接口还保留旧的付费模式分支

**证据：** [messages schema](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/rooms/[code]/messages/route.ts:26) 接受 chat/ask/hint/reason；[send_room_chat_message](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260624020000_raise_message_length_limits.sql:32) 可扣付费模式积分，但不创建 AI 请求、不调用 AI，也不校验提示机会和当前题目。

**影响：** 直接调用这一接口可扣费却得不到 AI 回复，并绕开正常 AI 请求状态机。普通聊天限流只对 chat 分支执行。

**处理与验收：** 玩家普通聊天入口只接受 chat；AI 三种模式统一走 AI 请求入口。其他模式在任何扣费/插入前被拒绝，删除该运行时重复计费路径。

### R07 · P1 · 创建房间的数据库约束比前端宽松

**证据：** [create_room](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260623042050_room_device_lock.sql:115) 只要求 seat_count≥1，之后 `generate_series(1, seat_count)` 建座位；表约束也没有 20 座上限。前端限制 20 座不能约束直接 RPC。该函数还接受 30 字房名和非 6 位数字密码，与当前 UI 不同。

**影响：** 注册账号可在 0 积分座位模式请求超量创建；部分直接 RPC 创建的密码无法通过正常 UI 输入。

**处理与验收：** 在函数和表约束补齐上限，前后端合同一致，加入创建/密码验证/加入限流。测试 0、21、极大座位数、非法密码和名字长度，必须在分配资源前拒绝。本轮未做压力请求。

### R08 · P1 · AI 的“同房间一个请求”只在 20 秒内成立

**证据：** [send_room_ai_request](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260624020000_raise_message_length_limits.sql:289) 仅统计最近 20 秒 pending。模型主流程默认有 30 秒预算；[缓存等价判断](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/lib/qa-cache.ts:207) 最多串行 5 次，每次最多 6 秒；[事实摘要](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/lib/deepseek.ts:893) 可先 GLM 8 秒，再 DeepSeek 30 秒，且不受主流程 deadline 约束。

**影响：** 请求尚未结束就允许下一条进入，破坏依序上下文；最坏路径可远超过用户和数据库理解的处理时长。超过 20 秒只是不再阻塞新请求，并没有自动退款或取消旧任务。

**处理与验收：** 全流程统一截止时间；房间占用使用请求状态/租约，过期需结算并阻止迟到写回。模拟缓存慢、摘要慢、备用模型慢，仍最多一个有效请求，所有请求最终有完成或退款结果。

### R09 · P1 · 退款成功未确认，失败重试也没有幂等与崩溃恢复

**证据：** [refundAiRequest](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/rooms/[code]/ask/route.ts:98) 没有检查 Supabase 返回的 `error`，后续多处却提示“已退回”。发送请求没有 client_request_id/唯一幂等键；客户端重试发起一笔全新请求。仓库没有处理失联 pending 的恢复任务。

**影响：** 退款 RPC 失败仍提示成功；进程终止会遗留扣款和 pending；已成功但响应丢失时，重试可能再次扣费。

**处理与验收：** 退款结果检查+失败记录；请求幂等键；可恢复的 pending 扫描和账务对账。模拟“提交成功但网络断开”和“模型成功后进程终止”，重试不重复扣款，退款成功与用户提示一致。

### R10 · P1 · 关房、切题、退出和删除没有统一处理在途请求

**证据：** [AI route](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/rooms/[code]/ask/route.ts:293) 先查询 current_puzzle_id，再单独调用 finish；[finish RPC](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260624013018_relax_room_message_ai_content_limit.sql:48) 不在事务里锁定并检查房间状态/对局版本。关闭房间未清除 current_puzzle_id。退款到座位时只按请求记录的旧 seat_id 增加余额。

**其他证据：** `join_room_as_member` 最新迁移只阻止同 session 的跨房加入，另一设备的 session 可进入自动关旧房分支；该分支只更新 status，未复用 close_room 的退款。删除账号先清理业务表，再请求 Auth 删除，两步间也可能失败。

**影响：** 关房后迟到结果仍可能写入；关房退分后 AI 再退到已关闭座位，房主漏收这笔余额；切题检查与写回之间仍有竞态。退出/移座后提示奖励和退款也可能操作新的座位占用者。

**处理与验收：** RPC 内校验房间、对局版本和 pending 终态，统一加锁顺序；关房/切题/删除先终结或转移在途结算。覆盖“请求进行中关闭/移座/退出/改题/删除账号”。Auth 与业务库操作不能假装一个事务，使用可重试的删除状态流程。

### R11 · P1 · 个人历史统计依赖“现在坐在这个座位的人”

**证据：** [get_my_profile_page](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260620113631_login_location_privacy.sql:103) 将历史消息 join 到当前 room_seats.user_id；通关记录也按当前座位或房主筛选。成功推理及汤底揭晓都以 AI/reason 消息入表，会落入同一个 reason_count 计数条件。

**影响：** 离开房间后历史统计消失；后来的玩家可能继承前人的次数；成功推理可能被算两次。这与用户实际完成的行为不一致。

**处理与验收：** 消息/请求保存不可变的参与者标识，通关保存当时参与成员。只按成功请求计数。历史回填需单独评估证据，不从当前座位猜测并覆盖旧历史。

### R12 · P1 · 事实与记忆会随聊天窗口截断而消失

**证据：** [mergeMessages](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/components/room-chat.tsx:89) 截到 100 条；[事实生成](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/components/room-chat.tsx:530) 只遍历这一窗口；AI route 只读同题最近 60 条。摘要调用的 knownFacts 参数传入空数组。

**影响：** 一局聊得足够久，白板丢事实、AI 重复提示；玩家看到的局内“知识”不再完整。刷新也无法恢复已经超出窗口的事实。

**处理与验收：** 事实/提示按对局持久化，记录来源消息与状态；聊天独立分页；上下文根据稳定事实和近期对话构建。在 200 条消息后的刷新、断线恢复中，早期有效事实仍在且不重复。

### R13 · P1 · 缺少对局 ID 与题目版本，修改题目也不失效缓存

**证据：** 目前按 room_id+puzzle_id 取历史，前后只比较 puzzle_id；[admin_update_puzzle](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260616045359_puzzle_examples_admin_ui.sql:108) 更新汤底/评分点/examples，却没有失效旧 cache。缓存只按 puzzle_id 查 approved。

**影响：** A→B→A 后旧请求/事实可能被视为当前；同 ID 改汤底后已批准旧答案继续命中。仅有题目 ID 并不等于“本次游戏”。

**处理与验收：** 每次开题有 round_id；题目发布有 version 或内容指纹；请求、事实、提示、评分绑定对局和版本；缓存绑定题目版本。验证重开同一道题、运行中改题、改题后精确缓存命中。

### R14 · P1 · 全量导入与单题删除不能安全覆盖已有使用记录

**证据：** [全量替换 RPC](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260616081104_admin_replace_all_puzzles.sql:58) 直接 delete puzzles，没有处理 room_messages.puzzle_id 和 room_ai_requests.puzzle_id 的限制型外键；后续没有同名函数修补。[单题删除](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260616112305_admin_delete_puzzle_room_ai_requests.sql:30) 删除全部相关请求，包含 pending。

**影响：** 曾被使用的题库全量替换可能因外键回滚；单题删除则可能让已扣款请求再也无法正常退款。不能简单把外键全部改为级联删除。

**处理与验收：** 日常维护默认停用或按稳定 ID 增量更新；全量替换明确预览影响、保留版本/历史，并拒绝或先结算 pending。在有消息、通关、缓存、在途 AI 的隔离库验证导入和删除。

### R15 · P1 · 题目恢复不完整，网络错误也可能被误判为关房

**证据：** [PuzzlePanel](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/components/puzzle-panel.tsx:126) 订阅 rooms UPDATE，没有恢复可见、重新联网或 SUBSCRIBED 后的题目补拉；[syncSeats](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/components/live-room-seats.tsx:322) 将 `!roomResult.data` 当作需要离开，未先区分 error。会话检查 `checkSeatSessionActive` 已在 RPC 错误时返回 true 避免误驱逐，这一点应保留，但它不能保护前述房间状态分支。订阅每次 SUBSCRIBED 还会新建定时器，只保存最后一个句柄。

**影响：** 漏过切题事件后长期停留旧题；临时网络/数据库错误可能使用户被误踢回首页；多次重连可累积会话检查定时器。

**处理与验收：** 统一恢复流程，题目/座位/身份/积分/事实一次对齐；错误不等于不存在；定时器只保留一个。模拟离线时切题、RPC 短暂失败、连续重连，恢复后状态正确且不额外跳转。

### R16 · P1 · 中文输入、草稿和危险操作存在具体交互缺陷

**证据：** [Enter 发送](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/components/room-chat.tsx:968) 没有检查输入法 composition；[模式切换](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/components/room-chat.tsx:947) 直接 slice 草稿；[开始发送](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/components/room-chat.tsx:602) 先清空输入，普通聊天失败不恢复。关房使用 [RoomActionForm](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/components/room-action-form.tsx:56)，退出在 [GuestRoomPanel](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/components/guest-room-panel.tsx:76) 直接提交。

**处理与验收：** 中文选词 Enter 不发送；普通 Enter 发送、Shift+Enter 换行；四模式分别保存草稿或保留超长输入并提示；失败可一键恢复。关房/退出/踢人逐一确认有二次确认，不只给部分删除加弹窗。复杂弹窗同时验证 Tab、Escape 和焦点返回。

### R17 · P1 · 管理端列表/导出不具备完整数据语义

**证据：** [积分查询](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/admin/page.tsx:721) 先取 300 条，[随后按用户过滤](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/admin/page.tsx:1014)；账户只取前 1000 个 Auth 用户与 profile。错误案例、反馈、房间都有固定截断。部分导出没有分页。日期筛选结束时间拼 `T23:59:59.999Z`，按 UTC；每日备份按北京时间。

**影响：** “没有结果”可能只是记录在上限之外；相同日期在两个界面看见不同记录。缓存后台 limit(2000) 也不能保证看到某题全部缓存。

**处理与验收：** 筛选下推、稳定分页、总数和“最近 N 条”语义明确；统一 Asia/Shanghai 半开时间区间；导出使用完整分页和一致筛选条件。用超出 300/1000 的数据及午夜边界验证。

### R18 · P1 · 推理结果会携带未覆盖评分点，题目发布校验不足

**证据：** [formatReasonContent](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/lib/deepseek.ts:621) 将全部 point.text 放进 coverage；玩家接口只去掉 ask_audit/cache_hit，没有去掉 coverage 正文。技术文档甚至描述了公开评分点，这是当前产品取舍，但对解谜保密不利。没有关键点时返回“无法公平评分”字符串，finish 仍可标记成功，扣费不退；管理员表单允许空评分点数组。

**处理与验收：** 玩家输出只包含允许公开的反馈，不把未发现真相随覆盖列表发送；完整评分依据留在后台。缺评分点不能发布成可收费推理题。70% 规则本身不宜凭感觉替换，先用评测比较“必需关键点+覆盖率”与当前规则。

### R19 · P2 · AI 审计会把单路失败写得像两路一致

**证据：** [askWithCrossCheck](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/lib/deepseek.ts:947) 一路失败时用另一条结果补齐 strict/inferential。虽然这时不缓存，但后台看不到真实失败。fulfilled 后再执行 schema.parse，其中一路非法 JSON 结构也可能让整体切到 fallback，而非保留另一路有效结果。

**处理与验收：** 每一路保存 success/error/timeout、provider/model/version/latency；失败不能伪装成一个答案。固定回归集中覆盖两路一致、分歧、单路失败、非法结构、仲裁失败与摘要失败。AI 专项修复顺序另见本地 `ai-error/9-5/architecture-quality-review.md`。

### R20 · P1 · 清理保护方向正确，但事件生命周期与活动判断有空缺

**证据：** [消息触发器](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260627135935_room_message_realtime_events.sql:56) 为每条新消息创建 event；当前迁移没有独立事件过期清理。[安全清理](/Users/shuwenai/Desktop/Projects/OnlineSoup/supabase/migrations/20260904042317_safe_room_cleanup_preserve_references.sql:167) 只选择没有 event/request 引用的消息。候选房间活动时间只对这些可删消息取 max。

**影响：** 事件长期存在时，新消息一直不具备清理资格；完全没有可删消息的僵尸房间也不会成为候选。更严重的是，若老房间有早期无事件消息，也有最近受保护消息，按“可删消息最后时间”可把近期活跃房间误判为废弃。

**处理与验收：** 保留“不删除仍有引用消息”的安全要求。房间是否废弃必须按全部活动判断，与可删除数量分开。为事件制定独立生命周期或改为无持久外键通知，先证明安全再回收；不要直接取消引用保护。分别验证纯新消息房间、空房间、老消息+新活跃消息和有在途请求的房间。

### R21 · P1 · 备份重复、下载状态过早，CSV 不防公式解释

**证据：** 清理先归档再保留引用，所以同一消息可以同时存在于 live/archive。[备份导出](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/admin/messages/backup/route.ts:154) 直接追加两表，仅排序不按 id 去重；备份日期统计使用 UNION ALL，也会重复计数。[下载标记](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/admin/messages/backup/route.ts:173) 在响应返回前写入；导出过程中产生的新消息可能晚于读取却早于标记。CSV escape 只处理引号和分隔符，未防止玩家文本被电子表格当公式。

**处理与验收：** 按 message_id 去重并保留 reply_to_id，使用固定快照水位/清单/校验值；“服务端已生成”与“客户端已保存”区分。供阅读的表格将文本固定为文本类型，原始无损备份使用独立机器格式。用安全示例 `=1+1` 检查显示为文字；不要执行外连公式。[OWASP CSV Injection](https://owasp.org/www-community/attacks/CSV_Injection) 说明了 CSV 引号转义与公式防护的区别。

同时补完整数据库备份及隔离恢复演练：聊天 CSV 不包含所有身份、积分、权限、请求和约束，不能代替数据库备份。

### R22 · P1 · 有编译检查，缺业务自动化与发布门槛

**证据：** package.json 只有 dev/build/start/lint/typecheck；仓库没有应用单元测试、Playwright/数据库回归配置、supabase/tests 或 GitHub Actions 工作流。研究目录不应被当作应用发布测试。缺少提交的 supabase/config.toml，干净重放与本地数据库配置也未形成可复现流程。

**依赖风险：** 锁文件 Next.js 16.2.9 落在 [Next.js Server Actions DoS 官方公告](https://github.com/vercel/next.js/security/advisories/GHSA-m99w-x7hq-7vfj) 的受影响范围；该项目确实使用 App Router/Server Actions。该公告的 16.x 最低修复版为 16.2.11，但其他审计项仍要逐项处理，不能认为升一个版本就全部修好。

**处理与验收：** 优先给 R01–R10 建隔离数据库/接口回归，再加 CI、迁移重放、依赖审计和目标环境 smoke。生成 Supabase 数据库类型，降低 `as unknown as` 和手写 RPC 返回值的错配。不要先为每个低风险 UI 函数堆测试，也不执行未经评估的 `audit fix --force`。

### R23 · P1 · 可信设备期限和签名回退过于宽松

**证据：** [Cookie 配置](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/lib/admin-verification.ts:8) 有 10 年有效期，不绑定当前会话，没有设备撤销表；页面默认勾选“永久免验证”。[签名密钥](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/lib/admin-verification.ts:26) 缺 secret 时回退 publishable key/固定字符串。当前存在 secret 时不会走这条回退，不能把它描述为已确认线上伪造。

**处理与验收：** 独立必需的服务端签名密钥，缺失即拒绝认证；有限设备有效期；可撤销设备；改密/安全退出规则明确。验证旧设备撤销后失效，普通登出与明确“忘记此设备”各自语义清楚。

### R24 · P2 · 身份入口与恢复还有可复现的边缘错误

- [用户名登录](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/auth/actions.ts:46)：`ilike(identity)` 将 `_` 当任意字符，可能选错记录或多条导致失败。改为忽略大小写的精确比较，并以包含下划线的两个不同用户名验证。
- 首页扫描第一个 guest_room Cookie 就认为用户在房间内，不验证有效性；若旧房已失效，应该清除过期状态、重新显示加入入口。
- 登录页无自助重置入口；重置页本身不负责发送邮件。应补授权用户可自行完成的恢复闭环。
- [flash 跳转校验](/Users/shuwenai/Desktop/Projects/OnlineSoup/src/app/flash/redirect/route.ts:11) 只拦 `//`，未处理反斜杠。用本地 Node URL 解析验证，斜杠+反斜杠开头的路径会被 `new URL` 当成外部主机。应比较解析后 origin 并限制站内路径；这不是读取账号数据的证据。

### R25 · P2 · 维护、性能与运维需建立统一约束

- **重复数据源：** 聊天每 8 秒补拉消息；座位每 10 秒；聊天积分每 15 秒；座位组件个人积分每 30 秒；另有会话 15 秒检查、Realtime 和 window 事件。保留恢复能力，合并共同状态，使用游标增量消息、退避和请求去重。以上是代码周期，不是实测成本/延迟结论。
- **缓存热路径：** 每次取缓存先执行过期清理，又有 cron；精确命中也被 ZHIPU_API_KEY 的存在绑定。把清理移出请求关键路径；精确查找无需模型；等价调用有总预算。`void` 保存/计数和只 catch 异常的写法没有检查 Supabase `.error`，应记录失败，必要后台任务使用宿主支持的完成机制。
- **管理邮件：** 多收件人用 to 可能让地址互相可见；按邮件用途改成逐个发送或 BCC。补幂等 key、超时、发送状态、操作者及重试策略；本轮未发送邮件。
- **错误边界：** 未见 app/global-error、error 或房间级错误边界。数据库失败和超时应有可恢复页面及追踪 ID，不能只返回空数组或跳首页。
- **公共数据面：** 非关闭 rooms/seats/events 可公开查询，room_seats 新增 active_session_id 后仍继承表级 SELECT。拆最小公开房间摘要和成员可见状态。session_id 本身不是登录令牌，不能夸大成仅凭该值可登录。
- **可观测性：** 仓库有 console 日志，没有可验证的请求耗时/失败率/退款失败告警和管理员操作总账；平台外部配置未核查。首先监控 pending 年龄、退款错误、调用阶段耗时和成本、403/429、清理/备份结果。
- **文档和冗余：** tasks.md 仍写消息 2 秒/座位 3 秒、题库软删除等旧事实；部分底层旧函数/字段与未使用 reset-password Action 可以在引用清单和兼容性审查后退役。保留迁移历史，不能因为“旧”就删掉已经部署的迁移。
- **公开诊断：** `/debug/network-test` 可继续作为临时诊断工具，但应记录保留期限/权限/限流。`/docs` 公开不是安全漏洞，安全规则不应靠隐藏文档成立。

## 四、立即补什么，以及哪些先不做

### 立即补充的基础能力

| 顺序 | 交付内容 | 完成标准 |
|---|---|---|
| 1 | 权限与积分契约回归 | 公开注册不能自定奖励；进出/踢人不产生积分；错误验证码不授信任 |
| 2 | 玩家响应白名单、会话写入校验 | 首屏/HTTP/RPC 三路径都安全；旧设备直接请求被拒绝 |
| 3 | AI 请求幂等与恢复 | 网络丢响应不重复扣款；进程中断后 pending 最终结算；退款可确认 |
| 4 | 对局/版本与不可变身份 | 重开同题无旧上下文；改题旧缓存失效；离开/换座不改变历史归属 |
| 5 | 事实/提示持久化、题目恢复 | 长对话和断线恢复后仍有完整事实；提示不因窗口截断重复 |
| 6 | 备份清单/去重与安全清理 | 不误关活跃房；不破坏引用；导出完整且无重复；可在隔离库恢复 |
| 7 | 输入与失败恢复 | 中文选词不发送；切模式不删草稿；发送失败可恢复；危险操作确认 |
| 8 | CI + 依赖升级 + 监控 | 自动执行上述关键回归；记录并告警超时/退款失败；升级后验证真实入口 |

### 应删除/替换的对象

删除的是有问题的运行时路径或错误语义，而不是随意删功能：

1. 普通聊天 RPC 的 ask/hint/reason 付费旧分支。
2. metadata 可控制注册积分的入口。
3. 更新 metadata 即视为完成二次验证的逻辑。
4. 退出/踢人把余额重置到初始值的逻辑。
5. 玩家响应中内部审计和不应提前公开的评分点正文。
6. 仅靠最近 100 条聊天还原持久事实、仅靠当前座位还原历史身份的设计。
7. 题库“日常导入=全删重建”的默认操作路径，改成增量/版本发布；必要全量替换保留独立受控入口。
8. 退款未确认就写“已退回”、列表截断却表现成完整结果的误导语义。

### 可以继续规划，但不应优先于上述修复

- **公开房间大厅：** 邀请制玩法目前不依赖它。真正开放前需先有公开/私有状态、房主同意被发现、最小公开字段、加入限流、举报/治理能力；不要直接展示现有全部非 closed 房间。
- **好友/公开档案/头像：** 有用户留存证据后再做。先把本人历史统计做准确。
- **站内通知：** 管理员通知和处理结果可有价值，但不是当前游戏可用性的前置条件；反馈回执可先做小范围闭环。
- **用户自建题库：** 先完成题目版本、发布验证、预算和内容边界，再开放任意 prompt/examples 输入。
- **Markdown/富文本/表情、公开回放：** 普通文本安全简单，先修草稿和历史分页。回放需明确成员范围与保存期限。
- **VPS、自建 Supabase、微服务：** 无需为上述本地逻辑缺陷引入额外运维复杂度；若网络实测成为主要瓶颈，再单独评估。

## 五、建议实施批次

1. **止损批：** R01、R02、R03；同时 R04、R07 和 Next.js 受影响依赖补丁。分别提交小改动与新迁移，隔离测试后才部署。
2. **核心正确性批：** R05、R06、R08–R10。把会话、并发、结算、幂等作为同一组验收，避免单独加长超时造成另一个竞态。
3. **数据可靠性批：** R11–R14、R17、R20、R21。身份/对局/版本规划在前，历史数据迁移需核对证据和回滚，不擅自恢复或改写旧记录。
4. **体验与维护批：** R15、R16、R18、R19、R23–R25 中尚未完成项。自助恢复、焦点、文档、组件拆分随相关修复完成。
5. **持续门槛：** R22 的自动回归与观测贯穿每批，不应拖到最后才补。

不建议一次性重构全部目录或同时改完所有业务规则。每批以用户可观察行为、数据库约束、负向权限测试和失败恢复证明完成。
