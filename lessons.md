# OnlineSoup 项目工程经验总结

来源：`updates.md`
项目：OnlineSoup / 汤局
目标：从多人房间、AI 主持、积分、权限、实时同步和长期运维中真实发生的问题，提炼可复用的工程经验，而不是复述 changelog。

---

# Realtime / State / Concurrency

## 1. 跨多个状态的业务操作应该在数据库中原子完成

**Area**

- Backend / API
- Database
- State / Sync

**Problem Type**

- Atomicity
- Partial Failure
- Race Condition

### Incident

OnlineSoup 的一次 AI 请求会同时影响多种状态：积分、提示机会、提问次数、请求记录、玩家消息、AI 回复以及题目完成状态。管理员删除账户、调整积分、关闭房间时，也会同时修改多张相互关联的表。

早期由应用代码分步骤执行时，任何一步失败都可能留下半完成状态。例如模型请求失败后，积分退回了，但提示机会或提问次数没有一并回滚；删除账户时，关联房间或积分流水又可能令清理中途失败。

### Resolution

把关键操作收进数据库 RPC / transaction：

- AI 请求由开始与结束操作统一管理扣费、完成和退款；
- 管理员积分调整通过专用 RPC 执行并写入流水；
- 账户删除改为事务化清理；
- 开题、关题、房间清理等状态迁移由数据库维护约束。

### Lesson

只要一个用户动作必须“全部发生或全部不发生”，它就不是若干普通 API 调用的组合，而是一个业务事务。

### Rule

> 跨多表、余额或共享房间状态的 mutation，优先在数据库事务边界内完成；不要依赖客户端或 Route Handler 恰好把所有步骤执行完。

---

## 2. 退款不仅要退货币，还要回滚所有衍生额度

**Area**

- Backend / API
- Product Logic
- Reliability

**Problem Type**

- Compensation
- Incomplete Rollback

### Incident

AI 失败时，系统最初主要关注“积分是否退回”，但一次请求还可能消耗提示机会、累计提问次数或改变请求状态。只退积分会让账面看似正确，玩家实际权益仍然损失。

### Resolution

把一次 AI 操作涉及的全部资源列为同一个补偿集合，并让重试重新经过正常的积分与资格检查，而不是跳过业务规则直接重发。

### Lesson

补偿事务的范围必须与原事务的副作用范围一致。

### Rule

> 设计失败补偿时，按“这次操作改变了哪些状态”逐项回滚，不能只恢复最显眼的余额字段。

---

## 3. 进程内锁不能保护分布式部署

**Area**

- Backend / API
- Database
- Concurrency
- Deployment

**Problem Type**

- Distributed Locking
- Duplicate Work
- Stale Operation

### Incident

AI 主持最初通过同房间串行处理避免并发请求。但部署在 Serverless 环境后，不同请求可能落到不同实例；进程内的锁、计时器或内存 Map 无法形成全局边界。请求进程被终止时，还可能留下“已经扣费但永远不会完成或退款”的进行中状态。

### Resolution

后续房间一致性迁移引入了数据库层 AI request lease、stale reconciliation 和受保护状态接口，让“谁拥有本次请求”“租约何时过期”“过期后如何恢复”成为持久化协议。

### Lesson

Serverless 中的实例内状态只能优化单个实例，不能证明全系统互斥。

### Rule

> 需要跨实例唯一性的工作应使用数据库约束、lease 或队列；同时为持有者消失设计超时与 reconciliation。

---

## 4. Realtime 是失效通知，不是唯一真相

**Area**

- State / Sync
- Realtime
- Frontend

**Problem Type**

- Event Loss
- Reconnection
- Stale Client State

### Incident

OnlineSoup 同时使用 Realtime、局部轮询和服务器首屏数据维护聊天、座位、积分、提示机会和在线状态。实际运行中出现过重复订阅、断线重连后 presence 未重新 track、积分更新不同步，以及页面重新可见后状态落后的问题。

### Resolution

- Realtime 负责快速通知；
- 重新连接和页面重新可见时重新订阅 / track；
- 低频轮询承担最终收敛；
- 关键操作完成后主动刷新对应局部状态；
- 删除重复订阅，按聊天、座位、积分拆分刷新节奏。

### Lesson

实时事件可能重复、乱序或丢失，可靠系统必须能从权威数据重建当前状态。

### Rule

> 把 Realtime 当作“可能需要重新读取”的信号。权威状态仍应可通过受保护查询重新获得，并由轮询或显式 refresh 保证最终一致。

---

## 5. Presence 只能表示最近观测到的在线状态

**Area**

- Realtime
- Product / UX

**Problem Type**

- Ephemeral State
- False Offline

### Incident

玩家在线圆点受浏览器后台、网络切换、频道重连和页面可见性影响。即使用户仍在房间里，短暂断线也可能显示离线；反过来，旧 presence 也可能暂时残留。

### Resolution

重连和恢复可见时重新 track，并把本机座位纳入在线判断；同时不让 presence 决定积分、座位所有权或访问权限。

### Rule

> Presence 是 UX 提示，不是 authorization 或业务事实。关键规则应依赖持久化会话与数据库状态。

---

## 6. 多设备策略必须明确“身份、会话、房间”的作用域

**Area**

- Auth / User System
- State / Sync
- Product Logic

**Problem Type**

- Session Ownership
- Device Takeover

### Incident

简单限制“一个账号只能有一个会话”与真实需求不匹配：用户可能在多设备登录，但同一时刻只应由一个设备控制某个房间座位。过度收紧会影响普通登录，过度放松又会让两个设备同时发送消息或消费积分。

### Resolution

系统将限制收缩为房间级 session ownership，并加入显式接管：

- 查询账号当前所在房间不再依赖旧 session；
- 进入房间时可接管控制权；
- 旧设备通过 RPC、Realtime 和定时自检发现失效后退出；
- 只读检查与接管操作分开。

### Lesson

安全约束的粒度应该与被保护资源一致。

### Rule

> 设计多设备限制前，先明确锁定的是账号、设备、会话还是某个业务资源；不要用全局单会话替代局部所有权模型。

---

# AI / LLM Engineering

## 7. 一个模型调用不应同时承担判定、解释和展示

**Area**

- AI / LLM
- Architecture

**Problem Type**

- Responsibility Coupling
- Output Instability

### Incident

询问模式既要判断 yes / no / irrelevant / ambiguous，又要生成可加入事实板的简洁总结。将两者放在同一输出中时，事实总结可能引入额外推断，也会增加 JSON 长度、截断风险和判断任务的干扰。

### Resolution

OnlineSoup 将职责拆开：

- DeepSeek 主要负责回答类型判断；
- yes / no 后再由独立模型生成 `fact_summary`；
- 总结只接收玩家问题、最终回答和已知事实；
- 复杂复合问题可以直接不生成总结。

### Lesson

共享输入不代表任务应该共享一次 generation。

### Rule

> 将“决定业务状态”和“生成用户可读文本”拆成独立阶段，并分别验证、降级和审计。

---

## 8. 不同判断范式需要真正隔离的证据与提示词

**Area**

- AI / LLM
- Experiment Design

**Problem Type**

- Anchoring
- Prompt Contamination

### Incident

OnlineSoup 同时使用严格事实判断与推断判断。早期如果两路模型看到同一批示例或公共规则的位置覆盖了变体规则，两条路径表面上独立，实际会受到相同锚定，交叉判断失去意义。

### Resolution

- 题库示例拆为 fact 与 inferential 两组；
- 两路只读取各自示例；
- 变体专属规则放到公共规则之后，确保能够覆盖；
- 仲裁与两路原始判断分别保留。

### Rule

> 多路 LLM 判断的价值来自真正不同的决策条件。模型名字不同、temperature 不同或并发调用本身不等于独立证据。

---

## 9. Prompt 中的顺序具有程序语义

**Area**

- AI / LLM

**Problem Type**

- Instruction Precedence
- Hidden Override

### Incident

推断模式的专属规则一度写在公共 ambiguous 规则之前，后者在 prompt 中再次定义边界，实际覆盖了前者。问题不是规则缺失，而是最终拼装顺序改变了有效语义。

### Rule

> Prompt builder 应像代码生成器一样测试：检查最终字符串、规则顺序和各变体差异，而不能只确认某段文字存在于源码中。

---

## 10. AI 上下文必须按业务对象隔离并限制历史长度

**Area**

- AI / LLM
- Data Model
- Privacy

**Problem Type**

- Context Leakage
- Token Growth
- Cross-entity Contamination

### Incident

房间可能连续更换题目，同一房间也会积累大量询问、提示和推理。如果按房间无边界地回放历史，旧题信息会污染新题，事实总结也可能反过来成为下一轮的错误证据。

### Resolution

- 上下文按 `puzzle_id` 隔离；
- recent context 只保留有限数量的玩家询问；
- 未覆盖评分点只合并最近几次推理结果；
- 事实总结后来从模型判定上下文中移除；
- 静态题目资料与动态对话分层组织。

### Rule

> LLM memory 应围绕稳定业务实体分区，并设置明确的历史窗口；不要把“同一个聊天房间”误当成永远同一个任务。

---

## 11. 输出预算还会被隐藏推理消耗

**Area**

- AI / LLM
- Reliability
- Performance

**Problem Type**

- Token Budget
- Truncated Structured Output

### Incident

DeepSeek 模型会自行产生内部推理。独立验证发现，线上 `max_tokens=320` 时较难样本有 4/10 被截断；增加一个内部 reason 字段后，JSON 输出空间更加紧张。即使响应还能解析，只要 `finish_reason=length`，结果也可能是不完整的成功。

### Resolution

- 提高必要场景的输出预算；
- 可控实验中关闭 thinking；
- 记录 reasoning tokens 与 finish reason；
- 遇到 length 一律重试，耗尽后标记失败；
- 缩短或拆出非必要自由文本字段。

### Rule

> 结构化输出的容量预算必须包含隐藏推理和自由文本；`JSON.parse` 成功不能替代对 `finish_reason` 的检查。

---

## 12. 超时应该覆盖整条工作流，而不是每个请求各算各的

**Area**

- AI / LLM
- Backend / API
- Reliability

**Problem Type**

- Timeout Budget
- Fallback Amplification

### Incident

一次 ask 可能包含严格判断、推断判断、仲裁和备用模型。若主模型 30 秒后再给备用模型 15 秒，虽然每个请求都“有超时”，整条用户请求仍可能超过平台或交互允许的总时长。

### Resolution

为 AI host 设计 wall-clock 总闸，并为不同阶段分配子预算；fallback 使用显式开关，模型 ID、JSON 模式和 thinking 参数先独立验证。

### Rule

> 多阶段 AI pipeline 先确定端到端延迟上限，再从总预算向各阶段分配时间。备用模型不能无限延长原请求。

---

## 13. 多路判断应该定义“部分成功”语义

**Area**

- AI / LLM
- Reliability

**Problem Type**

- Graceful Degradation
- Partial Result

### Incident

严格与推断两路并发时，如果任一路超时就让整个请求失败，会把可用答案一并丢弃；但无条件退化成单路，又可能改变产品原本追求的双路交叉判断。

### Resolution

系统保留双路作为正常模式，同时明确：一路成功时可以按受限规则返回，全部失败才进入备用模型或退款重试路径。

### Rule

> 并行冗余的系统必须预先定义 2/2、1/2 和 0/2 成功时分别如何处理，不能把容错语义留给异常分支临时决定。

---

## 14. 语义缓存首先是正确性系统，其次才是性能优化

**Area**

- AI / LLM
- Cache
- Data Model

**Problem Type**

- False Cache Hit
- Context-dependent Answer

### Incident

海龟汤中相似问题不一定等价，代词、复合条件、题目上下文和答案类型都会改变含义。若仅按文本相似度复用答案，缓存会以更低成本、更高速度稳定返回错误结果。

### Resolution

OnlineSoup 对可缓存内容设置较高门槛：

- 只缓存 yes / no；
- 排除含代词等不稳定问题；
- 按 `puzzle_id` 隔离；
- 先做规范化和精确命中；
- 语义候选由模型批量判断等价性，而非逐个串行调用；
- 管理后台支持查看、翻转、改写与删除缓存。

### Rule

> 只有答案在目标作用域内稳定、可验证时才进入语义缓存。缓存命中必须比重新推理更保守。

---

## 15. AI 缓存需要可治理性，而不只是命中率

**Area**

- AI / LLM
- Operations
- Admin Tooling

**Problem Type**

- Poisoned Cache
- Observability

### Incident

一条错误缓存可能影响之后所有玩家。仅记录命中次数无法回答“为什么命中”“原问题是什么”“如何纠正”。

### Resolution

后台为每题提供缓存条目、命中次数、最近命中、删除、答案翻转、原文编辑与整题清空；编辑原文时同步重算 normalized key。

### Rule

> 任何会放大 AI 判断的持久化缓存，都必须提供追踪、纠正和失效能力。

---

## 16. 审计信息与玩家可见信息必须分层

**Area**

- AI / LLM
- Security
- Privacy
- API Design

**Problem Type**

- Internal Data Exposure
- Response Projection

### Incident

AI 请求会产生 reason、评分点覆盖、cache hit、候选判断和 `ask_audit` 等内部信息。它们对排错有价值，但可能暴露题目答案、评分结构或安全实现。项目曾出现玩家接口返回审计字段的风险，后续又发现首屏、bootstrap、HTTP 和 AI 响应需要统一剥离。

### Resolution

内部原始记录保留在审计链路，玩家消息只返回完成交互所需的最小投影；多个出口都执行相同过滤，而不是只修一个 Route。

### Rule

> 可观测性数据默认属于内部控制面。对外响应应使用 allowlist projection，并覆盖首屏、Realtime、bootstrap、重试和普通 HTTP 等所有出口。

---

## 17. AI 质量需要“发现—归档—修复—回归”的闭环

**Area**

- AI / LLM
- Testing
- Operations

**Problem Type**

- Error Triage
- Regression Management

### Incident

单次修改 prompt 很难判断是否真正提升整体质量。OnlineSoup 因此逐步建立消息审计、错误标记、正确答案、备注、题目快照、状态流转、CSV 导出和专项修复归档。

### Resolution

错误案例不再只是聊天记录中的偶发现象，而成为可筛选、可复核、可进入测试集的产品数据；问答通过 `reply_to_id` 明确配对，避免靠时间或内容猜测对应关系。

### Rule

> 生产 AI 系统应把错误反馈做成持续流程：保留当时上下文、人工结论和修复状态，并能转化为回归样本。

---

## 18. 单次模型自信不等于系统不确定性

**Area**

- AI / LLM
- Research / Experimentation

**Problem Type**

- Overconfidence
- Uncertainty Estimation

### Incident

独立 logprobs 验证发现，单次调用对答案接近 100% 自信，即使案例本身存在歧义；删除 reason 字段没有改变这种过度自信。相比之下，严格与推断两路分布的 Jensen–Shannon divergence 会随问题清晰度变化，更能反映判断边界。

### Rule

> 不要把一个模型、一次调用的最高概率直接展示为“可信度”。优先使用模型间分歧、重复稳定性和任务级校准结果。

---

# Auth / Security / Privacy

## 19. RLS 与 service role 不是二选一的安全方案

**Area**

- Auth / User System
- Security
- Database

**Problem Type**

- Privilege Boundary
- RLS Bypass

### Incident

普通用户访问主要依赖 RLS，而管理、退款、账户删除等操作需要 service role。项目多次遇到“功能上线但 service role 缺少表权限”或“service role 绕过 RLS 后应用层检查不足”的问题。

### Resolution

- 普通路径继续以 RLS 作为数据边界；
- 高权限操作通过受控 server action / RPC 暴露；
- service role 权限按所需表补齐；
- API 层仍验证管理员身份、参数白名单和业务约束；
- 使用公开权限零行探针检查匿名访问面。

### Rule

> RLS 保护低权限客户端；service role 路径则必须由服务端重新建立 authorization 与 validation。绕过 RLS 不代表绕过业务权限。

---

## 20. 对外数据接口应该返回受保护投影，而不是底表

**Area**

- Security
- Backend / API
- Privacy

**Problem Type**

- Data Enumeration
- Excessive Exposure

### Incident

早期匿名用户可直接读取较多 rooms / room_seats 数据，房间码、座位和状态可能被批量枚举。后续评估还发现聊天首屏与 bootstrap 可能携带内部审计字段。

### Resolution

收缩匿名直读权限，改用只返回当前交互所需字段的受保护房间状态 RPC；聊天与 AI 响应统一做字段投影。

### Rule

> 即使某些房间信息最终会展示，也不应因此开放整张表。对外读取应围绕具体 use case 建立最小投影。

---

## 21. Auth 用户存在不代表业务账户仍然存在

**Area**

- Auth / User System
- State

**Problem Type**

- Split Identity
- Ghost Session

### Incident

删除账户后，浏览器仍可能保有 Supabase Auth session，但对应 profile 已不存在，前端继续显示登录状态。反过来，用户名账户、邮箱账户和管理员创建账户也有不同生命周期。

### Resolution

中间层发现 profile 缺失时进一步调用权威 Auth 检查；确认账户已经删除后强制登出，而不是只相信现有 Cookie。

### Rule

> 当身份系统与业务 profile 分表时，登录态必须定义为两者的合法组合，并明确任一侧缺失时如何恢复。

---

## 22. 邮件验证与密码恢复必须尊重浏览器回调边界

**Area**

- Auth / User System
- Deployment

**Problem Type**

- Callback Semantics
- Client / Server Boundary

### Incident

Supabase recovery 信息可能位于 URL fragment，而 fragment 不会发送给服务器。若服务端页面在浏览器处理前就判断“没有会话”并重定向，恢复流程会被提前截断；生产站点 URL 未配置时，邮件又会跳回 localhost。

### Resolution

由浏览器端接收 recovery hash 并调用 Auth SDK 更新密码；服务端 callback 只处理自己真正能看到的参数；生产环境显式配置 canonical site URL，并测试确认、重置、重定向整条链路。

### Rule

> OAuth / 邮件回调要逐段确认参数由谁可见：邮件服务、浏览器、服务端和 Auth SDK 的边界不能凭 URL 外观推断。

---

## 23. 管理员二次认证必须真正消费一次性凭证

**Area**

- Security
- Auth / User System
- Admin Tooling

**Problem Type**

- Weak Reauthentication
- Trusted Device

### Incident

管理后台从邮件二次验证逐步演化到 8 位验证码与可信设备。后续安全评估发现，若验证链接或签名存在由公开 key 回退的路径，形式上的“二次认证”仍可能缺少真正的服务器证明；可信设备默认勾选也会扩大授权时间。

### Resolution

- 二次认证改为消费邮箱 OTP 或受控 callback 的验证结果；
- 移除公开 key 签名回退；
- 可信设备默认不勾选；
- 设备凭证明确 30 天有效并绑定用户。

### Rule

> 二次认证的核心是服务器验证一个新的、短期的、不可重放的证明。增加验证码输入框本身不构成更强认证。

---

## 24. 隐私最小化也适用于日志、IP 和管理界面

**Area**

- Privacy
- Security
- Operations

**Problem Type**

- Metadata Exposure
- Operational Access

### Incident

为了排查多设备和积分问题，系统记录了登录设备、IP 与积分操作上下文。这些数据对管理员有用，但不应向普通玩家暴露完整 IP，也不应无边界扩散到前端响应和导出文件。

### Resolution

普通用户只看到粗粒度登录地点，具体 IP 留在受控管理面；AI 审计和研究输出同样与公开仓库、玩家响应分离。

### Rule

> 先定义排错所需的最小元数据、保留位置和可见角色，再开始记录；“管理员可能有用”不是无限采集的理由。

---

# Data Lifecycle / Operations

## 25. 删除前要检查引用关系，而不只是外键是否允许

**Area**

- Database
- Operations
- Data Lifecycle

**Problem Type**

- Destructive Cleanup
- Referential Integrity

### Incident

房间清理需要删除大量聊天，但部分消息仍被 AI request 或 message event 引用。直接级联删除可能连带移除仍有审计价值的数据；硬删除题目和账户也曾因关联表产生冲突。

### Resolution

安全清理迁移在删除前识别仍被引用的消息，只删除真正可安全移除的记录，并返回保留数量；房间强制清理改为先归档消息，再删除活动表数据。

### Rule

> 清理任务应建立“可删除集合”，而不是从目标父记录向下盲目级联。审计、事件和异步请求引用要单独盘点。

---

## 26. 归档状态必须进入清理决策

**Area**

- Operations
- Database
- Admin Tooling

**Problem Type**

- Backup-before-delete
- Cleanup Loop

### Incident

旧清理列表会让没有消息的房间反复上榜，也可能默认勾选尚未备份的房间。单纯按创建时间判断 stale，无法反映房间是否仍有实际活动。

### Resolution

- 以最后消息时间判断活跃度；
- 已关闭与未关闭房间使用不同阈值；
- 排除零消息房间，避免无意义循环；
- 增加 `backup_pending`；
- 未备份房间默认不选中；
- 归档记录纳入 CSV 与备份统计。

### Rule

> 自动清理规则应同时考虑业务活动、备份状态和恢复需求；“够老”不是充分删除条件。

---

## 27. 需要长期追踪的关系应保存显式 ID

**Area**

- Data Model
- Observability

**Problem Type**

- Stable Relationship
- Ambiguous Matching

### Incident

管理端最初难以稳定判断某条 AI 回复对应哪一条玩家问题。按时间临近或内容相似匹配，在并发、重试和重复文本下都会出错。

### Resolution

`room_messages` 增加 `reply_to_id`，AI 完成请求时写入对应问题 ID，审计界面直接按关系展示问答对。

### Rule

> 如果两个对象的对应关系对审计、重试或业务逻辑重要，就持久化关系 ID，不要事后从时间和文本推断。

---

## 28. 管理后台是生产系统的控制面

**Area**

- Operations
- Admin Tooling
- Product / UX

**Problem Type**

- Operational Safety
- Control Plane Design

### Incident

OnlineSoup 后台逐渐承担 AI 错误、题库、缓存、积分流水、活跃房间、强制关闭、聊天备份、用户反馈和账户管理。若所有数据在进入页面时一起加载，会造成慢查询、错误的 0 徽章和频繁轮询；若危险操作混在大表单中，又容易误触或丢失筛选上下文。

### Resolution

- 数据按 tab / sub-tab 按需加载；
- 独立查询并行执行；
- 后台筛选转为服务端处理；
- 写操作保留原 tab 与筛选参数；
- 聚焦输入或打开弹窗时暂停轮询；
- 高风险动作进入二级界面或确认流程；
- 结果上限到达时明确提示，而不是伪装成完整结果。

### Rule

> 管理后台要按控制面设计：延迟、权限、可追踪性、防误操作和状态保持都属于业务正确性。

---

# Frontend / UX / Performance

## 29. 乐观 UI 必须保留失败后的恢复路径

**Area**

- Frontend
- State / Sync
- UX

**Problem Type**

- Optimistic Update
- Failure Recovery

### Incident

聊天改为乐观发送后，玩家可以立即看到自己的消息，但 AI 超时、普通聊天失败或 session 被接管时，前端仍需要恢复草稿、标记失败、提供重试并同步积分。只追求“先显示”会让失败状态更加混乱。

### Resolution

消息具有发送中、失败和完成状态；失败旁提供重试；普通聊天失败恢复输入草稿；重试重新经过权限和积分检查；服务端结果回来后再以权威状态收敛。

### Rule

> 每个 optimistic action 在实现成功动画前，先定义失败状态、草稿恢复、重复提交和服务端 reconciliation。

---

## 30. 弹出层不能受业务滚动容器的裁剪边界控制

**Area**

- Frontend
- UX

**Problem Type**

- Overflow Clipping
- Layering

### Incident

题目菜单与座位操作菜单放在独立滚动面板中时，会被父容器的 `overflow` 裁剪或遮挡。继续提高 `z-index` 无法跨越裁剪上下文。

### Resolution

通过 Portal 将菜单挂到页面顶层，并使用固定定位；滚动面板只负责内容滚动，浮层的几何与生命周期独立处理。

### Rule

> Dropdown、context menu 和 dialog 若可能越过滚动边界，应渲染到独立 overlay root；`z-index` 不能修复 ancestor overflow clipping。

---

## 31. 多人房间的移动端布局可以是独立交互模型

**Area**

- Frontend
- Responsive Design
- Product / UX

**Problem Type**

- Information Density
- Device Assumption

### Incident

桌面端同时展示聊天、题目和座位很自然，但直接压缩到手机会让聊天高度不足、触控目标过小、右侧面板难以阅读。单纯缩小字号无法保留任务优先级。

### Resolution

先用多套静态预览和交互原型比较，再落地手机竖屏三段导航：聊天 / 题目 / 座位切换，并保留常驻题面条。规则只对 `portrait≤760px` 生效，横屏、平板和桌面不被连带改变；后续继续扩大触控目标、折叠全局头部。

### Rule

> 当同屏并列信息在小屏上失去可用性时，允许移动端采用不同的信息架构，而不是把桌面布局等比缩小。

---

## 32. UI 稳定性在实时应用中属于功能要求

**Area**

- Frontend
- UX
- Accessibility

**Problem Type**

- Layout Shift
- Focus Stability

### Incident

标签切换、轮询更新、空状态、筛选和展开层曾造成面板尺寸变化、按钮移动或焦点丢失。聊天应用中，这些位移会直接打断阅读和输入。

### Resolution

项目后来把稳定性写进专属 Frontend Spec：固定关键区域尺寸、独立滚动、关闭层移出 Tab 顺序、账户菜单补焦点管理与 Escape 返回、减少动画模式下禁用不必要运动，并避免后台刷新覆盖正在编辑的界面。

### Rule

> 实时 UI 的验收不只看最终内容是否正确，还要检查更新期间滚动位置、输入内容、焦点和操作目标是否保持稳定。

---

## 33. 性能优化先处理查询结构，再处理微小渲染

**Area**

- Performance
- Backend / API
- Frontend

**Problem Type**

- Network Waterfall
- Unnecessary Work

### Incident

房间页和管理后台的主要等待来自多次数据库往返、隐藏 tab 也加载数据以及过密轮询。单纯 memo 化组件无法抵消服务器端 2–3 个额外 RTT。

### Resolution

- 独立数据库调用并行化；
- 只加载当前 tab 需要的数据；
- 不同实时数据使用不同刷新频率；
- 降低兜底轮询；
- 之后才做 memo、稳定 callback、复用 formatter 和删除死 DOM。

### Rule

> 全栈页面性能应按“网络往返 → 查询范围 → 重复请求 → DOM/render”顺序排查，优先消除更高层级的等待。

---

## 34. SSR 与客户端必须共享确定的时间语义

**Area**

- Frontend
- Time / Date
- Deployment

**Problem Type**

- Hydration Mismatch
- Environment Dependence

### Incident

生产服务器和用户浏览器使用不同默认时区时，同一聊天时间在 SSR 与 hydration 阶段生成不同文本，触发 React hydration mismatch。

### Resolution

聊天时间显式固定为业务使用的时区与格式，而不是依赖运行环境默认值。

### Rule

> 会同时在服务器和客户端渲染的 locale/time 输出，必须显式指定时区、locale 和格式选项。

---

# Testing / Research / Deployment

## 35. 生产约束需要分层测试，不能由 typecheck 代替

**Area**

- Testing
- Database
- Security
- CI

**Problem Type**

- Integration Gap
- Contract Testing

### Incident

项目长期拥有 typecheck、lint 和 build，但共享房间真正的关键约束位于数据库 RPC、RLS、迁移和并发流程中。前端编译成功无法证明匿名用户读不到底表、失效 session 不能发消息或 AI 请求能从 stale 状态恢复。

### Resolution

后续建立最小测试分层：

- Vitest 覆盖 QA cache 等纯逻辑；
- pgTAP 验证房间数据库契约；
- GitHub CI 运行离线测试；
- migration dry-run 与远端记录确认数据库状态；
- typecheck、lint、build 继续覆盖静态和构建问题；
- 公开权限使用真实探针验证。

### Rule

> 测试层级要对应 invariant 所在层：前端规则测前端，数据库权限和事务必须在数据库环境中验证。

---

## 36. 网络性能应该拆成可观测的组成部分

**Area**

- Performance
- Diagnostics
- Infrastructure

**Problem Type**

- Black-box Latency
- Misdiagnosis

### Incident

用户感受到“房间慢”时，原因可能来自 Next.js 往返、Supabase REST、RPC、Auth 或 Realtime 建连。只测整个页面无法知道优化哪一层。

### Resolution

项目建立临时只读网络测试页，分别测量各链路，并提供单次与 20 次测试、average / min / max / p95 / failures 和 JSON 导出；Realtime 测试不写业务数据。

### Rule

> 端到端慢时，应把链路拆成独立可重复测量的阶段，并同时记录分位数和失败率，而不是只看一次平均值。

---

## 37. LLM 实验必须能重放和审计

**Area**

- Research / Experimentation
- AI / LLM
- Tooling

**Problem Type**

- Reproducibility
- Incomplete Evidence

### Incident

论文实验涉及多组 prompt、两阶段调用、重试、模型配置和 100 余条问题。若只保留最终汇总，无法确认某个差异来自 prompt、模型版本、截断、缓存还是评分数据错误。

### Resolution

独立 runner 保存：

- 原始 JSONL；
- prompt 留痕；
- manifest 与配置；
- usage、cache token、finish reason、reasoning token；
- system fingerprint；
- 中断续跑与重试记录；
- 题目级指标、分层分析、McNemar 检验和成本分析。

一次 expected answer 修正后，所有正式派生结果重新生成，而不是手改汇总。

### Rule

> LLM 实验的最小可复现单位应包含输入、配置、原始响应、模型标识、失败状态和评分规则；图表与汇总都应由这些原始记录生成。

---

## 38. 生产修复与研究验证需要隔离

**Area**

- AI / LLM
- Research / Experimentation
- Change Management

**Problem Type**

- Experimental Contamination
- Unsafe Rollout

### Incident

logprobs、JSD、max token 和 reason 字段的验证首先在 `paper/` 下独立进行，并明确“不改 `deepseek.ts`”。这样可以观察模型特性，而不会在证据尚不充分时改变线上主持逻辑。

### Rule

> 对生产 AI 行为的研究先在独立 harness 中验证；只有指标、失败模式和回滚方案明确后，再进入线上路径。

---

## 39. 文档中的数字与真实契约同样会漂移

**Area**

- Documentation
- Tooling
- Product / UX

**Problem Type**

- Documentation Drift
- Duplicate Contract

### Incident

聊天字数上限同时存在于前端、Route schema、数据库 RPC、教程、README 和 agent 文档中。修改某一处后，技术说明仍曾把询问上限写成旧值。GLM fallback、移动端布局和环境变量也多次出现实现已变、文档滞后的情况。

### Resolution

项目体检时对照实际代码、迁移和生产构建修正文档，并减少容易过时的长清单；关键规则尽量引用真实实现或由共享常量驱动。

### Rule

> 同一约束若必须出现在多层，先确定一个机器可验证的 source of truth，再检查文档、客户端和数据库是否一致。

---

## 40. 高风险线上操作应有独立确认与可验证的完成条件

**Area**

- Deployment
- Database
- Security
- Tooling

**Problem Type**

- Change Risk
- Incomplete Verification

### Incident

OnlineSoup 的迁移、RLS 调整、数据清理和生产环境配置会直接改变真实用户状态。记录中既出现过“代码已写但迁移未应用”，也出现远端连接中断使 dry-run / pgTAP 尚未执行的情况。

### Resolution

后续工作规则要求线上迁移、RLS 权限和删数据单独确认；应用迁移后检查远端 migration 记录，并分别报告哪些验证已完成、哪些因环境原因尚未完成。

### Rule

> 高风险变更的“完成”必须包含目标环境已应用和关键 invariant 已验证；本地代码存在或单元测试通过不等于上线完成。

---

# 当前从 OnlineSoup 得出的高层原则

截至目前，可以把以上经历压缩成这些通用规则：

1. **跨多表、余额和共享状态的 mutation 必须有原子事务边界。**
2. **补偿事务要恢复原操作造成的全部副作用。**
3. **Serverless 并发控制使用持久化 lease / constraint，并处理 stale owner。**
4. **Realtime 负责加速，权威查询与 reconciliation 负责正确。**
5. **Presence 不能承担权限或所有权判断。**
6. **多设备限制的作用域应与被保护的业务资源一致。**
7. **AI 的业务判定、解释和展示文本应分层。**
8. **多路模型必须真正隔离证据，才能提供独立判断。**
9. **Prompt 顺序与拼装结果具有程序语义。**
10. **上下文按业务实体隔离，并设置明确历史窗口。**
11. **结构化输出要检查 finish reason，并计入隐藏推理预算。**
12. **超时预算属于整条工作流，不属于单个模型请求。**
13. **并行冗余必须定义部分成功的产品语义。**
14. **语义缓存首先保证正确性，并必须可审计、可纠正。**
15. **AI 审计信息和玩家可见结果使用不同数据投影。**
16. **生产 AI 错误要进入可持续的反馈与回归闭环。**
17. **单次模型概率不能直接当作可信度。**
18. **RLS 与高权限服务端路径需要各自的权限边界。**
19. **对外 API 返回 use-case projection，而不是开放底表。**
20. **Auth session 与业务 profile 的组合才是完整登录态。**
21. **管理员二次认证必须验证新的短期凭证。**
22. **删除前先定义可安全删除集合，并将备份状态纳入判断。**
23. **重要关系保存显式 ID，不从时间或文本反推。**
24. **管理后台是生产控制面，不是附属 CRUD 页面。**
25. **乐观 UI 必须先设计失败恢复和状态收敛。**
26. **浮层跨越滚动边界时使用独立 overlay root。**
27. **移动端可以采用不同于桌面的信息架构。**
28. **实时界面的滚动、焦点和布局稳定性属于功能正确性。**
29. **性能排查先看网络往返与查询结构，再看渲染微优化。**
30. **SSR 与客户端的时间、locale 语义必须显式一致。**
31. **测试应覆盖 invariant 真正所在的数据库、权限和集成层。**
32. **LLM 实验必须保存足以重放的原始证据。**
33. **研究 harness 与生产路径应隔离。**
34. **重复出现的产品约束需要机器可验证的 source of truth。**
35. **高风险生产变更只有在目标环境验证后才算完成。**

---

## OnlineSoup 特别丰富的经验方向

如果按 Area 统计，这个项目最有价值的经验集中在：

- `Realtime / Shared State`
- `Database Transactions`
- `Concurrency / Serverless Reliability`
- `AI / LLM Orchestration`
- `Semantic Cache`
- `Auth / RLS / Admin Security`
- `Privacy / Audit Projection`
- `Operations / Data Lifecycle`
- `Frontend Stability`
- `Testing / Research Reproducibility`

它与其它项目的侧重点不同：

- **Reminders** 主要验证端侧 LLM、确定性 parser、SwiftUI state 与 prompt regression；
- **Calendar** 主要验证长期数据模型、迁移、外部协议、跨客户端契约与生产部署；
- **OnlineSoup** 主要验证多人共享状态下的原子性、并发、故障补偿、权限、AI 可审计性与实时界面恢复。

三者重复出现的规则，已经可以视为较强的跨项目证据；只在 OnlineSoup 出现的规则，则主要来自它独有的多人、实时和带积分 AI 交互场景。

---

## 后续记录格式

以后 OnlineSoup 出现新的工程经验时，可以继续按下列格式追加：

```text
## 标题

Project:
Date:

Area:
- Realtime / Shared State
- AI / LLM
- Backend / API
- Database
- Auth / User System
- Security / Privacy
- Testing
- Frontend / UX
- Performance
- Deployment / Infrastructure
- Operations
- Research / Experimentation

Problem Type:
- ...

Incident:
发生了什么。

Initial Assumption:
当时为什么觉得原来的设计合理。

Root Cause:
真正原因。

Resolution:
最后怎么处理。

Evidence:
用了什么测试、实验或生产复现确认。

Lesson:
这次经历说明了什么。

Rule:
以后项目可以直接采用的原则。

Preventability:
可以提前避免 / 很难提前避免 / 不值得提前避免

Origin:
项目 + 日期 + 对应 update
```
