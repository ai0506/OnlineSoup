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

## 线上删除必须先生成并验证恢复点

Project: OnlineSoup / 汤局
Date: 2026-09-19

Area:
- Database
- Operations
- Testing

Problem Type:
- 生产数据删除前缺少显式恢复点

Incident:

在清空线上题库前，虽然已只读核对待删题目数量、房间引用、进度、缓存和在途 AI 请求，并确认删除函数的副作用，但没有先导出这批题目的完整本地备份。删除后只能依靠旧本地快照和 `ai_error_cases` 中不完整的题目快照尝试恢复，关键评分点与示例问答未被保证保留。

Initial Assumption:

把“用户明确要求删除”“当前没有聊天或在途 AI 请求引用”错误地当作可以直接执行删除的充分条件，忽略了历史进度、缓存、题目配置和未来回滚本身也是需要保护的资产。

Root Cause:

删除前检查只验证了数据库约束、级联关系和即时运行风险，没有把“已创建且可读回验证的恢复副本”设为删除操作的前置条件。

Resolution:

将本规则写入项目经验库。后续任何线上删除先执行只读影响盘点，再在本地受控目录生成带时间戳的导出文件，验证文件可解析、记录数与目标一致、必要字段完整，并明确恢复命令或恢复入口；仅在这些事实和用户确认均完成后执行删除。

Evidence:

本次删除前线上有 5 道题、53 条进度、7 条缓存和 28 个房间当前题目引用；删除后题目、进度、缓存和引用均为 0。线上 `ai_error_cases` 仍有 5 份不同题目的标题/谜面/汤底快照，但不能证明保留了原始难度、关键评分点和示例问答。

Lesson:

“可以删除”与“可以恢复”是两个独立条件。引用安全、事务成功和用户授权都不能替代经过验证的恢复点。

Rule:

任何线上删除、全量替换、批量改写或不可逆迁移必须严格按以下顺序执行：

1. 只读列出精确目标、记录数、依赖引用、级联/置空行为与仍在使用的对象。
2. 在本地创建一次最小但完整的备份；文件不得覆盖旧备份，名称包含时间戳和目标范围。
3. 读回验证备份：可解析、记录数匹配、关键字段完整，并记录恢复方式。
4. 向用户报告影响与备份位置，取得针对该精确目标的确认。
5. 执行删除或替换，并立即独立回读验证结果。

若任一步不能完成，停止删除；不得以“用户已说删除”“存在部分历史快照”或“当前没有活跃请求”跳过。

Preventability:

可以提前避免

Origin:

OnlineSoup + 2026-09-19 + `updates.md` [CodeX][260919204023]

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

## 房间公开信息与加入表单的字段契约

Project: OnlineSoup
Date: 2026-09-29

Area:
- Frontend / UX
- Backend / API
- Testing

Problem Type:
- 跨层字段契约不一致导致访客无法加入房间

Incident:
访客在无密码房间输入名字后收到“请检查房间码和密码”。

Initial Assumption:
页面把公开加入信息强制视为完整的房间对象，因此以为其中包含 code。

Root Cause:
get_room_join_info 只返回最小公开字段，不包含 code；未入座页面将 joinInfo 转为房间对象并把 room.code 传给加入表单，导致隐藏 code 为空，joinRoom 在 RPC 调用前就拒绝请求。

Resolution:
未入座加入表单直接使用已经标准化且经 get_room_join_info 验证的路由 code。

Evidence:
线上无密码房间的 password_hash 为空，join_room_as_guest 仅在哈希存在时抛 wrong_password；本地修复后未登录房间页返回 HTTP 200，隐藏表单字段为对应的六位房间码，typecheck、lint、build 通过。未对线上现有房间做写入式加入测试。

Lesson:
最小公开投影不能被当作完整实体；类型断言不会补齐运行时缺失的字段。

Rule:
表单提交关键标识应取自已验证的路由参数或显式 API 字段，跨层投影要核对实际返回字段，并在真实渲染中检查关键隐藏输入。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-09-29 updates.md [CodeX][260929131304]

## 线上已应用的迁移在本地仓库缺失，阻断后续 db push

Project: OnlineSoup
Date: 2026-10-08

Area:
- Backend / Database
- Tooling / Process

Problem Type:
- 线上数据库迁移历史与仓库文件不同步

Incident:
推送新迁移 `20261008071844_structured_seat_system_messages` 时，`supabase db push` 直接拒绝执行，报 `DbPushMissingLocalError: Remote migration versions not found in local migrations directory`，并建议 `migration repair --status reverted` 或 `db pull`。

Initial Assumption:
以为是本地迁移历史落后，按 CLI 建议 repair 或 pull 即可。

Root Cause:
线上 `supabase_migrations.schema_migrations` 中存在 `20260929083508 fix_chat_message_mode_ambiguity`，而 `supabase/migrations` 下没有对应文件，`updates.md` 没有记录，git 该时间段也没有涉及迁移目录的提交。该变更是绕过「写迁移文件 → db push」的流程直接作用到线上库的（修 `send_room_chat_message` 中 `message_mode` 与 RPC 参数同名导致的 42702）。CLI 要求两边历史一致，因此任何新迁移都被挡住。

Resolution:
没有执行 CLI 建议的 `repair --status reverted`（会把线上真实已应用的记录标成已回滚，与事实不符），也没有 `db pull`（会生成大块 schema 快照，污染迁移历史）。改为从 `supabase_migrations.schema_migrations.statements` 读出该版本的原始 SQL，按原样回写成本地文件 `20260929083508_fix_chat_message_mode_ambiguity.sql` 补档，使两边历史对齐，再正常 push。

Evidence:
补档前 dry-run 报 `DbPushMissingLocalError`；补档后 dry-run 输出 `Would push these migrations: 20261008071844_...`，只含新迁移；正式 push 看到 `Applying migration 20261008071844_...` 与 `Finished supabase db push.`；回读 `pg_proc` 确认 `gift_points_to_seat`、`move_seat` 已是 jsonb 版本且执行权限仍只有 `authenticated`。

Lesson:
Supabase 的迁移历史是数据库里的一张表，不是仓库状态的投影。只要有一次变更绕过迁移文件直接落到线上，后续所有 push 都会被挡住，而且故障点出现在下一个动手的人身上，与制造者脱节。CLI 给出的 repair/pull 建议默认「远端是错的」，在远端其实正确、只是本地缺文件的场景下会把问题放大。

Rule:
任何改变线上 schema 或函数的操作都必须有对应的迁移文件并提交到仓库；通过 MCP、控制台 SQL Editor 或 psql 直接改线上后，必须立即补写同版本号的迁移文件。遇到 `DbPushMissingLocalError` 时先查 `supabase_migrations.schema_migrations` 弄清缺失版本的真实内容，优先补档对齐，不要照抄 CLI 的 `repair --status reverted` 或 `db pull`。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-08 updates.md [Claude Code][261008152351]

## 异步 AI 扣费必须先退款再计算关房结算

Project: OnlineSoup
Date: 2026-10-09

Area:
- Backend / Database
- Concurrency / Points

Problem Type:
- 异步请求补偿与房间结算顺序不一致

Incident:
CLI 支持响应丢失后的请求恢复时，核查发现已有 AI 请求先扣座位积分，而 close_room 在设置 closed 之前就汇总座位余额。仅在关闭状态触发器中退款，会发生房主结算已完成、退款才写回座位的顺序错误。

Initial Assumption:
只要关闭房间时最终把 pending 请求退款，余额就一定一致。

Root Cause:
“请求已退款”和“房主结算包含退款”是两个不同条件；结算总额若先读取，后续退款无法自动进入已完成的房主流水。请求、完成、退款、清理之间原有锁顺序也不同。

Resolution:
统一相关房间 RPC 的短事务入口锁；close_room 和管理清理在计算结算总额之前先结清 pending 请求；迟到模型结果只返回已结算状态。闲置清理先退款再释放；成员变化补偿与座位释放在同一持锁事务内提交，禁止其他人先取得座位。

Evidence:
cli/tests/database.mjs 在隔离 PostgreSQL 中验证：进行中请求退款一次，关房后房主最终余额为初始余额减去已完成请求费用；迟到 finish 不再次扣费；闲置/对账/完成并发无重复退款。24 项数据库行为通过。线上公开 key 创建扣费请求后停止题目，原键读回 refunded；两份对应迁移已记录。

Lesson:
补偿必须发生在依赖余额的汇总之前；数据库最终有 refunded 记录本身不足以证明所有资金去向正确。

Rule:
修改异步扣费、退出或关房时，同时测试请求状态、原付款来源、座位后续占用和房主结算总额；不要只断言退款函数成功。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-09 updates.md [CodeX][261009161327]


## 昵称修复不应替换成员关系

Project: OnlineSoup
Date: 2026-10-09

Area:
- Database / Concurrency
- Membership / AI compensation

Problem Type:
- 展示字段与成员身份边界混用

Incident:
CLI 评审发现 admin_set_username 未参与统一锁顺序；补填无用户名的旧账号时会修改座位昵称，原触发器把昵称变化当作换人，清空闲置时间并结算 pending AI。

Initial Assumption:
座位昵称变化等价于旧成员离开、新成员进入。

Root Cause:
注册成员的稳定身份是 user_id，nickname 只是展示字段；基于展示字段重置 membership_id/last_cli_action_at 会破坏闲置清理和请求所属关系。管理员先锁 profile 再触发座位结算也违反事务 gate 顺序。

Resolution:
admin_set_username 首先获取事务 gate；注册用户仅在 user_id 变化时替换成员关系，游客继续按昵称变化识别换人。新成员成功加入时同步清除旧 idle_timeout，包括网页路径。

Evidence:
cli/tests/database.mjs 的 26 项行为测试通过，其中补填管理员昵称后 membership_id 与 last_cli_action_at 不变、pending AI 不退款；网页闲置后重新加入再离开不再误报闲置。线上迁移 20261009085757 已记录，管理员函数 gate 及 service_role-only 权限回读正确；真实 CLI 密码入房、进程恢复、双向聊天、离开与账号切换通过。

Lesson:
展示字段与成员身份要分别判断；补偿触发器应以实际成员更替为依据，所有能到达补偿链的入口都需要相同锁顺序。

Rule:
修改昵称、座位或成员触发器时，同时回归成员代次、闲置时间、进行中扣费请求，以及注册用户/游客两种身份。不要把普通昵称修复当成成员退出。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-09 updates.md [CodeX][261009170056]


## 增量同步不能把自增 ID 当作提交顺序

Project: OnlineSoup
Date: 2026-10-09

Area:
- Database / Concurrency
- CLI / Persistent sync

Problem Type:
- 晚提交消息漏读与持久化边界

Incident:
P0 最近消息窗口不能承担可靠增量；直接以最后一个消息 ID 前进时，较低 ID 事务可能仍未提交，较高 ID 已可见，之后会永久跳过低 ID。

Initial Assumption:
自增 ID 的分配顺序等于事务提交顺序，保存 ID 就足以恢复。

Root Cause:
序列号在提交前分配，回滚和并发事务不按 ID 提交。仅扩大重叠窗口不能给任意长事务提供不漏读保证；持久化游标后才保存正文也会造成崩溃时不可恢复。

Resolution:
所有消息插入统一记录 top-level xid8；只读取 snapshot xmin 以下已结束事务，分页固定上界，按事务号和 ID 前进；历史删除或编辑改变代次，旧签名游标显式失效。客户端原子保存消息正文与游标后输出，提供最近 200 条 cached 恢复。

Evidence:
全量迁移在空白本地 PostgreSQL 重放成功；P1 11 项数据库行为验证系统低 ID 事务晚于网页高 ID 提交后两条均可补拉、500 条跨页无重漏且分页期间写入留待下一轮、删除/编辑失效、公开揭底与私密输出边界。CLI 10 项测试包含重启恢复与正文/游标共同落盘、失败不重置、wait 积压及时限。线上迁移 20261009102525 的权限与 STABLE 配置已回读。

Lesson:
可靠游标需要明确事务可见水位、历史代次和本地正文保存边界；自增 ID、有限重叠窗口或单独保存游标都不足以保证恢复。

Rule:
消息同步必须构造低编号晚提交及分页期间写入的行为测试；采用 xmin 方案时公开长事务延迟限制，保存后输出前崩溃以有限本地缓存恢复，不宣称终端恰好一次输出。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-09 updates.md [CodeX][261009182750]


## 等待预算到期与网络故障需要分别表达

Project: OnlineSoup
Date: 2026-10-09

Area:
- CLI / Polling
- Protocol / Timeout

Problem Type:
- 客户端等待时限被误报连接失败

Incident:
生产 P1 验收中，/wait --timeout 3 在整体预算耗尽时中止正在进行的读取，返回 NETWORK_ERROR，违背正常等待到期的合同。

Initial Assumption:
所有被 AbortSignal 取消的读取都属于网络错误。

Root Cause:
同一取消机制既实现等待预算，也承载网络超时；底层统一错误未表达是哪种边界，短时限和真实跨区网络延迟使问题在生产出现。

Resolution:
wait 检查错误类型与绝对截止时间，预算耗尽返回正常 timed_out，最后一轮未完成时明确 poll_incomplete，保留已保存的游标；预算前的实际连接失败继续返回 NETWORK_ERROR。网络请求也计入整体时限。

Evidence:
本地测试慢响应 1.5 秒、等待预算 1 秒，按时正常结束并标记未完成；立即断开连接仍返回 NETWORK_ERROR；生产默认域名 3 秒空等待复测成功。CLI 全部 11 项通过。

Lesson:
主动取消与连接失败使用同一个底层错误时，上层必须结合业务截止时间区分；正常到期也不能伪装成已完整确认没有消息。

Rule:
有轮询预算的命令同时测试空等待、最后一轮未完成、慢网络、提前连接失败和已有分页进度，明确下一轮恢复位置。
## 聊天 RPC 重写后恢复了已修复的字段歧义

Project: OnlineSoup
Date: 2026-09-29

Area:
- Database
- Backend / API
- Testing

Problem Type:
- 后续函数重写引入已修复过的回归

Incident:
注册用户和访客发送普通聊天时收到“聊天服务暂时不可用”。

Initial Assumption:
此前的速率限制迁移已经修复 message_mode 歧义，后续聊天 RPC 会保留这个约束。

Root Cause:
20260918025855 重写 send_room_chat_message 时，速率限制查询重新使用未限定的 message_mode 列名；它与同名函数参数冲突，Postgres 抛出 42702，消息插入前事务终止。

Resolution:
新迁移在两处速率限制查询中为 room_messages 设置 rm 别名并限定 rm.seat_id、rm.message_mode、rm.created_at，保留原有成员校验和执行授权。

Evidence:
线上 Postgres 日志记录 column reference "message_mode" is ambiguous；迁移 dry run 只列出本次新文件，应用后回读迁移记录与 anon/authenticated EXECUTE 权限；注册账号网页消息刷新后仍在，匿名访客公开 key 发送成功且退出后座位清空。

Lesson:
重写 SECURITY DEFINER RPC 可能悄悄恢复旧缺陷；仅验证新安全逻辑不足以覆盖旧业务路径。

Rule:
替换已有 RPC 时，先审查该函数后续修复迁移中的具体防回归约束，再用真实调用角色运行一条成功路径及关键错误路径。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-09 updates.md [CodeX][261009183552]
OnlineSoup 2026-09-29 updates.md [CodeX][260929164111]


## 确认共享座位接管时须绑定成员关系并封住旧入口

Project: OnlineSoup
Date: 2026-10-09

Area:
- Database / Concurrency
- Auth / Session

Problem Type:
- 过期同意与兼容入口绕过

Incident:
网页接管 CLI 座位需要确认，但确认期间 CLI 可能刷新占座或退出重进；旧 take_over_room_session 与 join_room_as_member 仍可能不经确认覆盖 CLI。

Initial Assumption:
只在网页加一次确认，或只对当前 session_id 做判断，就能表达用户对当前座位的同意。

Root Cause:
确认是跨请求动作；同一 Auth 会话可刷新占座或生成新的成员关系，而旧 RPC 也是实际可调用的业务入口。

Resolution:
以私有 HMAC 绑定座位、房间、用户、membership_id、active_session_id 和更新时间；确认事务锁内比较版本，不一致重新读状态并要求再次点击。旧接管与自动加入在同一 gate 下拒绝 CLI 占座的未确认接管，保留网页之间语义。

Evidence:
P2 11 项数据库行为验证并发确认只有一胜、缺失/篡改/更新/退出重进版本失效、旧 RPC 绕过拒绝、本人和角色边界。生产普通公开 key 实测拒绝旧入口；真实浏览器在 CLI 更新版本后拒绝旧确认，第二次明确确认成功且旧 CLI 收到 ROOM_DEVICE_IN_USE。

Lesson:
用户确认必须对应特定业务状态与成员关系；安全边界需要覆盖全部可调用入口，不能只依赖新增界面。

Rule:
新增共享状态确认时列出所有旧写入口，在原子事务内比较不透明版本，并测试等待期间更新、退出重进和两个确认者竞争；版本变化不得静默继承旧同意。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-09 updates.md [CodeX][261009194230]


## 浏览器授权给终端时需要独立会话和收取确认

Project: OnlineSoup
Date: 2026-10-09

Area:
- Auth / Session
- CLI / Recovery

Problem Type:
- 跨客户端会话与网络结果未知

Incident:
生产验收故意不保存第一次发行响应的 Set-Cookie，客户端需要恢复已创建的登录；同时替换 CLI 登录后，网页仍需保留原会话。

Initial Assumption:
设计审查中需要验证：服务端成功发行，是否足以代表终端已成功登录。

Root Cause:
共用 session_id 会混淆网页与 CLI 身份及设备锁；一次性返回在响应丢失后无法确认登录是否创建，重试又可能重复发行。

Resolution:
用独立设备秘密和验证器绑定短期授权；网页实名确认后单发行者创建独立 CLI Auth session，暂存与请求 id 绑定的加密会话。重复 poll 交付同一会话，CLI 原子保存 Cookie/账号后 ack 清空密文。替换旧 CLI 仍通过原事务撤销，保留网页会话。

Evidence:
8 项新增 DB 行为包含两个独立连接竞争仅一个发行者、错误 proof/验证码/过期/撤销会话拒绝及 ack 后清空；生产故意不保存首次 Set-Cookie 后真实 CLI 用原授权重试成功。回读网页 session 保留、替换后活动 CLI 1 个/撤销旧登记 1 个、consumed 且密文为空；CLI 测试验证保存后才确认收取，秘密不输出。

Lesson:
跨客户端授权既需要明确的会话隔离，也需要可恢复的交付协议；数据库发行一次不等于客户端成功保存凭证。

Rule:
授权登录不把网页登录 Cookie 转交终端；分别测试确认、发行、响应丢失、持久化和收取确认，凭证不得出现在 URL/stdout，重试不能重复发行。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-09 updates.md [CodeX][261009231852]


## 清理身份 Cookie 后的跳转不能依赖原页面组件

Project: OnlineSoup
Date: 2026-10-10

Area:
- Auth / User System
- Frontend / UX

Problem Type:
- Server Action 重渲染与客户端跳转生命周期

Incident:
访客点击退出后仍停留在 /rooms/<code>，页面变成输入访客名字的加入界面。

Initial Assumption:
退出操作返回 navigateTo 后，GuestRoomPanel 的 useEffect 会跳转首页。

Root Cause:
退出成功清除 guest_room_<code> Cookie 后，房间页不再满足成员条件，从 room-layout 切换为 join-landing；原组件可能被替换，返回状态驱动的 effect 无法可靠承担必要跳转。

Resolution:
leaveRoom 在退出 RPC 成功和 Cookie 清理后通过 setFlashMessage 写入短期 HttpOnly 提示 Cookie，再调用 Next.js redirect，以 replace 返回纯 /；失败仍返回错误并保留 Cookie。

Evidence:
3 项回归测试验证访客 Cookie 清理后抛出框架重定向、注册成员跳转及 RPC 失败保留 Cookie。typecheck、build、7 项测试通过，lint 无错误（3 条已有警告）。本地生产构建连接真实房间 35WE8U，临时访客 exit1010 加入后点击退出，浏览器实际返回首页；切换 Flash Cookie 后再次验证最终地址为纯 /，不含查询参数。未部署线上。

Lesson:
改变身份凭证可能同时改变服务端渲染树，必要导航应由完成状态变更的服务端操作发起；提示传递应沿用项目已有的 Flash Cookie 机制，避免沿用残留 URL 参数。

Rule:
Server Action 清理身份 Cookie 且必须离开当前页时，在成功写入后执行 redirect，不依赖当前组件存活后的 effect；同时验证失败不误清理凭证。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-10 updates.md [CodeX][261010140747]


## 短 JSON 判定必须显式控制提供方思考模式，双路审计一致不代表独立成功

Project: OnlineSoup
Date: 2026-10-10

Area:
- AI / LLM
- Backend / API
- Testing

Problem Type:
- 提供方默认思考、输出预算截断与单路降级的审计误读

Incident:
放宽 inferential prompt 后，用房间 35WE8U 的 Doubao 原问回归；1413 两路调用 HTTP 200 但 content 为空，finish_reason 为 length。提高 ask 预算到 1024 后仍出现单路截断，但返回的两份 audit 完全一致，看上去像双路一致成功。

Initial Assumption:
只返回 answer_type 和简短 reason，320 token 应足够；两份 audit 相同可以代表两次独立调用都成功。

Root Cause:
当前 DeepSeek 文档说明默认启用思考，原 DeepSeek ask 调用未显式设置 thinking，短预算可能先耗在 reasoning_content，尚未产出最终 content 就被截断。GLM 原调用已显式关闭思考，不能据此推断 DeepSeek 也关闭。另一个独立因素是 askWithCrossCheck 单路失败时会复制成功路线填充两份 audit，虽然 cacheEligible=false，但外部查看一致 audit 容易误认。

Resolution:
仅对 ask 的 strict、inferential 与仲裁显式传入 thinking={type: "disabled"}，维持原 320 token 输出预算及多步推理 prompt；hint/reason 和摘要参数保持原状。真实回归工具同时记录各请求 status、finish_reason、contentLength 和 thinking，要求各判定调用都完整返回才通过，不能只检查最终答案或 audit 标签。另用 strict/仲裁不读取历史主持判定的方式降低错误历史锚定。

Evidence:
ai-error/10-10/inference-recheck-1413.json 记录 strict/inferential 均 status=200、finishReason=length、contentLength=0；inference-budget-1024.json 记录4项即使最终正确仍因单路未完整返回判失败。最终 inference-regression-final.json 为19/19，所有判定请求 thinking=disabled 且完整返回；新增单测检查双路/仲裁非思考参数、历史隔离、单路失败 cacheEligible=false 与玩家脱敏，共9/9测试通过，typecheck/lint/build通过。官方依据 https://api-docs.deepseek.com/guides/thinking_mode/ 。仅本地连接真实模型验证，未部署。

Lesson:
提供方默认模式会变化，短 JSON 输出预算必须结合思考模式设计；HTTP 200 不代表最终答案生成成功。两份相同审计记录也未必是独立证据，必须核对降级路径和原始请求完成状态。

Rule:
为短判定显式指定 thinking 策略，验证 finish_reason 和 content，而非只看 HTTP 状态。需要思考模式时，单独设计思考/输出预算和超时，不能靠盲目扩大 max_tokens。双路回归记录实际请求状态，不把单路回退复制的 audit 计为双路一致；历史主持判定不作为真相依据。此次未新增模型级两路一致结果校验器，也未改变原审计 schema。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-10 updates.md [CodeX][261010154539]

## 双路判定必须分开统计单路正确率和仲裁后的正确率

Project: OnlineSoup
Date: 2026-10-11

Area:
- AI / LLM
- Testing

Problem Type:
- 回归指标混淆与单轮成绩误读

Incident:
评估 inferential 调整时，最终答案的通过数容易被误读成推断路通过数；重复修改 prompt 后，不同版本的一轮高分也不能代表最终版本稳定。

Initial Assumption:
原问题经仲裁后全部正确，就足以说明推断路的问题解决了。

Root Cause:
仲裁可以纠正 inferential，也可能改坏正确候选。两路同模型同真相会相关犯错，且不同历史、题目 examples 与采样轮次都可能改变结果。

Resolution:
在本次分析中分别统计 strict、inferential 和最终答案，明确评分集合、排除项、源快照与源码哈希；各次修改的报告保留独立文件，最新版本同时报告原问重放及独立回归的失败，不用早先最好的一轮替代最终结果。

Evidence:
ai-error/10-11/fourth-fresh_history-results.json 与 fourth-original_history-results.json 中，最终均15/15，但 inferential 均14/15，1421由仲裁纠正。最终源码的两种原问重放 inferential 均15/15；独立36项中 inferential 29/36、最终31/36，仍有失败。详见 inferential-cognitive-boundary-review.md。本条解决的是评估口径，不能当作所有模型判定错误已经修复的证据。

Lesson:
最终正确率衡量整条决策链，单路正确率衡量该路能力；原问回归和独立边界回归是不同证据，不可替换。

Rule:
问“某一路对了吗”时直接统计该路 audit；先确认两个请求都完整成功，避免降级复制审计被算作独立判断。模型改动同时报告最新版本的通过、失败和未评分项，并保留每轮版本边界。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-11 updates.md [CodeX][261011111807]

## CLI 选择其他账号授权不能复用网页 Cookie 登录客户端

Project: OnlineSoup
Date: 2026-10-12

Area:
- Auth / User System
- Backend / API
- Testing

Problem Type:
- 跨客户端身份覆盖

Incident:
CLI 网页授权选择其他账号后，CLI 和原网页都切换成了新账号，无法分别使用不同账号。

Initial Assumption:
CLI 最终会生成独立会话，因此授权前先用普通网页客户端登录另一个账号似乎不会影响隔离。

Root Cause:
signInForCli 使用 createServerClient 包装的 Cookie 客户端执行 signInWithPassword，在 CLI 发行之前就替换了网页 Auth Cookie；独立发行 CLI session 不能撤回这一副作用。

Resolution:
其他账号表单一次收集账号、密码和终端验证码，由服务端公开 key 非持久化 Auth 客户端验证并调用原 authenticated 授权 RPC。既有网页确认仍用网页 session。失败只退出新建临时 session；成功保留批准 session，避免后续发行检查失效，不把其令牌返回客户端或写入 Cookie。

Evidence:
tests/cli-browser-login.test.ts 10项通过，全部19项单测、typecheck/build通过，lint无错误。实际本地生产构建 Server Action 表单配合真实Supabase：网页A保持原Cookie及身份、授权响应无Auth Set-Cookie、CLI收取B并核对/session、ack/logout成功；临时用户按admin_cleanup_user_before_delete后Auth删除。见docs/testing/OnlineSoup-CLI-浏览器登录验收.md的2026-10-12记录。未部署，未做浏览器点击验收。

Lesson:
会话隔离必须覆盖验证密码、批准、发行和收取整条路径，不能只验证最终两份session不同。清理临时session前还要检查下游是否依赖它存在。

Rule:
为其他客户端验证账号时使用不读写网页Cookie的Auth客户端；授权必须绑定服务端认证出的user.id及终端证明。回归同时断言原网页身份、授权响应Cookie和CLI最终身份，并分别标注本地与生产证据。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-12 updates.md [CodeX][261012141316]

## 身份切换时凭证与账号缓存必须一起保存

Project: OnlineSoup
Date: 2026-10-12

Area:
- Auth / User System
- Security / Privacy
- Testing

Problem Type:
- 客户端认证状态持久化不一致

Incident:
账号隔离审查发现，CLI api() 收到 Set-Cookie 后先 save()，登录主命令随后才写 user_id/username 并清理旧缓存。若两次保存之间退出或响应损坏，本地可能留下新凭证与旧账号标识。

Initial Assumption:
本地会话文件采用原子 rename，即可保证登录状态整体一致。

Root Cause:
原子文件写只能保证单次保存完整；认证 Cookie 与身份边界分属两次保存，中间状态本身就不一致。缓存按旧 user_id 分组也无法纠正错误的本地身份。

Resolution:
登录、浏览器收取和退出响应先验证，再在同一次 save() 保存 Cookie、身份与缓存边界；账号变化清空 sync/room，损坏或失败的登录响应不安装新 Cookie。普通业务请求仍按既有方式保存刷新Cookie，浏览器待收取证明仍可恢复。

Evidence:
cli/tests/auth-isolation.test.mjs 在 API save 时断言 Cookie/身份一致、旧缓存已清除，以及损坏/失败登录不安装Cookie、退出同步清理。24项CLI/19项网站测试、typecheck/build通过，lint无错误。真实Supabase双CLI账号文件登录、故意错密码后session文件原样保留、网页账号保持和logout通过；临时账号/文件已清理。详见docs/testing/OnlineSoup-CLI-账号隔离检查.md，未发布。

Lesson:
原子写入不能代替跨字段的一致性设计，必须先定义一个完整的账号状态，再一起提交。

Rule:
身份切换涉及的凭证、账号标识和缓存可见边界在单次持久化提交中完成；无效响应不能提前安装凭证。回归在持久化边界检查中间快照，不只检查命令最终输出。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-12 updates.md [CodeX][261012142719]

## 多种客户端的在线状态不能只依赖网页 Presence

Project: OnlineSoup
Date: 2026-10-12

Area:
- Realtime / Shared State
- Database
- Frontend / UX
- Testing

Problem Type:
- 多客户端活动状态与在线展示不一致

Incident:
CLI 玩家正在提问，但网页座位显示离线。

Initial Assumption:
网页 Realtime Presence 可以代表所有占座玩家是否在线。

Root Cause:
网页只通过浏览器 Presence 频道计算绿点；CLI 走 HTTP，已有 last_cli_action_at 却未参与展示。另经线上权限检查确认 service_role 不能直接 SELECT room_seats，不能假设管理客户端可读所有表。

Resolution:
在已有成员状态 RPC 内根据当前未撤销CLI会话、最近2分钟有效活动或有效pending AI租期计算cli_online，保留成员/设备校验，仅返回布尔标记；网页将其与Presence合并，沿用10秒受保护状态补拉及原闲置清退规则。

Evidence:
线上11场景回滚SQL检查通过；临时真实CLI登录、入房、发言，公开key房主RPC和游客Cookie本地状态路由均返回在线，SSR显示在线绿点，非成员拒绝，leave/logout释放座位；typecheck/build/19项单测通过，lint无错误。数据库迁移已记录，网页尚未发布；未做真实付费AI或浏览器点击验收。

Lesson:
Presence只代表接入该传输频道的客户端；多端产品需定义统一且可过期的活动信号。近期活动与持续连接的含义应明确区分，不能把占座直接当作在线。

Rule:
新增客户端时同步核对在线展示、活动来源、过期及正在处理请求的边界；身份细节在既有受保护接口内归约为展示标记，不为在线状态扩大私密表权限。验证同时覆盖正常活动、失效会话和非成员访问，并分别说明数据库与网页发布状态。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-12 updates.md [CodeX][261012192650]

## AI 输出不可用时仍须保留已返回的 token 用量

Project: OnlineSoup
Date: 2026-10-13

Area:
- AI / LLM
- Backend / API
- Testing

Problem Type:
- AI 用量观测缺失

Incident:
DeepSeek 统一调用入口只提取 choices.content，丢弃响应 usage，无法从服务端日志核对各次调用消耗。

Initial Assumption:
原调用入口仅关注可用的业务 JSON，没有采集响应中的 token 统计。

Root Cause:
传输层用量未被提取；如果在业务内容解析成功之后才记录，空内容、截断和非法 JSON 路径仍会漏记供应商已经返回的 usage。

Resolution:
在解析模型输出前对白名单 usage 字段做校验并保留，在 finally 中输出各次 DeepSeek 调用的用途、状态、耗时及用量。缺失或非法统计记 null，避免把未知用量伪装成零消耗。

Evidence:
9 项 mock usage 测试覆盖并发双路与仲裁、空内容、非法 JSON、截断、缺失/非法 usage、事实摘要、HTTP/网络错误及日志字段脱敏；连同既有 ask 测试共 11 项通过，typecheck 通过，lint 零错误。未进行真实计费核对或部署。

Lesson:
模型输出是否可用与供应商是否产生 token 消耗是不同维度；失败的业务响应也可能带有可记录的用量。

Rule:
在供应商响应层采集 usage，并覆盖内容解析失败路径；只保留明确允许的统计字段，未知值保持 null，不将 prompt、凭据或原始响应写入用量日志。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-13 updates.md [CodeX][261013190741]

## 中文短标签在可收缩容器里会被压成每字一行

Project: OnlineSoup
Date: 2026-10-15

Area:
- Frontend / UX

Problem Type:
- 布局压缩导致短标签折行

Incident:
房间标题栏的“1/2 人”徽标在桌面端被挤成两行（2026-10-12 修复）；管理端题库 Facts 表中“原文”“已审核”等两三个字的列又被拆成每字一行，而长文本列却仍有余量。

Initial Assumption:
两三个字的标签足够短，不会换行；表格让所有单元格都能换行，可以避免长内容撑宽表格。

Root Cause:
中文没有词边界，每个字之间都是合法断点，其最小内容宽度只有一个字。flex 子项默认 flex-shrink: 1，自动表格布局会优先压缩可换行列，所以只要容器空间不足，短标签会先被压到最窄。Facts 表把整张表的 td 都设为 white-space: normal，自动列宽便把多余空间分给长文本列，短列被压成一个字宽。

Resolution:
房间徽标加 flex-shrink: 0 与 white-space: nowrap。管理端表格保持默认不换行，只给内容、依据等长文本列加 admin-table-text 开启换行并设置最小宽度；状态标签 admin-pill、主/子 tab 统一 nowrap。

Evidence:
本地组件预览载入线上题目 #21 的 13 条 Facts，在 716px 宽的窄面板中截图确认类型和状态列均为单行；房间徽标修复见对应 updates 记录。

Lesson:
单个元素“短”并不能保证它不被折行；是否折行取决于容器是否允许压缩它。中文标签对压缩尤其敏感。

Rule:
状态、数量、类型、按钮、tab 等短标签默认 white-space: nowrap，在 flex 中再加 flex-shrink: 0；表格默认不换行，只对明确的长文本列开启换行并给出 min-width，不要整表开启 white-space: normal。新增界面在窄屏宽度下检查短标签是否单行。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-12 updates.md [Claude Code][261012191555]；2026-10-15 updates.md [Claude Code][261015130743]

## 带 transform 的父级会让 fixed 弹窗相对父级定位

Project: OnlineSoup
Date: 2026-10-15

Area:
- Frontend / UX

Problem Type:
- CSS 包含块被祖先 transform 改变，全屏弹窗错位

Incident:
在手机竖屏里，从顶部账户菜单点「退出登录」后，确认弹窗没有铺满屏幕居中，而是从菜单位置向右撑开，超出视口。

Initial Assumption:
弹窗用 dialog-backdrop（position: fixed; inset: 0），fixed 总是相对视口定位，所以放在哪个组件里渲染都一样。

Root Cause:
账户下拉菜单 .nav-pop 为了做展开动画设置了 transform。只要祖先元素有 transform（filter、perspective、contain 等同理），它就会成为 fixed 后代的包含块，fixed 元素改为相对这个祖先定位和计算 inset。LogoutButton 把弹窗直接渲染在菜单内部，于是"全屏"遮罩只相对窄小的菜单定位并向右溢出；菜单收起时还会随菜单一起被 visibility 隐藏。

Resolution:
LogoutButton 用 createPortal 把确认弹窗挂到 document.body，打开时通过 onOpen 回调收起账户菜单。房间页的题目菜单、座位菜单此前已采用同样的 Portal 写法。

Evidence:
本地 375x812 竖屏打开弹窗后读取 DOM：遮罩父元素为 BODY，宽 375、高 812，面板左右居中，页面 scrollWidth 等于视口宽度不再溢出；桌面端面板中心与视口中心一致，取消按钮正常关闭。

Lesson:
position: fixed 并不保证相对视口；它依赖于没有祖先建立新的包含块。下拉菜单、动画容器、details 等常带 transform 或 overflow 的容器里渲染的弹窗都会受影响。

Rule:
全屏遮罩、确认弹窗、浮层菜单一律通过 createPortal 挂到 document.body，不直接渲染在菜单、卡片等可能带 transform/filter/overflow 的容器内部。新增弹窗时在手机竖屏和桌面各检查一次是否居中铺满。

Preventability:
可以提前避免

Origin:
OnlineSoup 2026-10-15 updates.md [Claude Code][261015202236]


## 放宽 AI 并发必须消除顺序配对和退款前的余额快照

Project: OnlineSoup
Date: 2026-10-16

Area:
- AI / LLM
- Database
- Frontend / UX
- Testing

Problem Type:
- 并发回答错配；超时退款后使用旧余额

Incident:
动态并发实施中发现，聊天颜色、等待状态和提示/推理历史依赖“问题之后第一条 AI 消息”的串行假设；准入先读取座位再清理超时请求，退款后仍可能用旧余额判定积分不足。

Initial Assumption:
房间只有一个 pending 请求，消息顺序可代表因果关系；准入期间座位余额不会变化。

Root Cause:
并发回答可能乱序到达，提示/揭底也不是其他问题的回答。reconcile_stale_room_ai_requests 会修改积分和提示机会，已加载的 rowtype 快照不会自动更新。

Resolution:
以数据库已有 reply_to_id 配对回答；模型历史加载 id/reply_to_id，限制 id 不超过当前请求；每条问题独立维护等待状态。清理租约后重新读取 sender_seat，再检查提示机会、余额并扣费。

Evidence:
86 项 Vitest 通过，覆盖乱序问答、未关联揭底、独立等待、超时/旧题排除和 prompt 配对。SQL 回滚测试覆盖 3/4/6/7 人档位、anon/authenticated、个人积分、拒绝不扣费、重复退款、仅剩 1 分时超时退款后再提交和切题迟到退款。公开 key 同时发请求验证 ask=3、reason=2、hint=1、混合总量=4、同玩家=1、准确退款、bootstrap 关联和审计脱敏。测试数据已清理。

Lesson:
从串行改为并发，要检查读取、展示和上下文中的顺序假设；事务原子性不等于变量始终代表最新行值。

Rule:
回答归属只认显式请求关联；补偿调用后重新读取计费快照。准入须在事务锁内、扣费前同时检查总额度、模式额度和玩家额度，并用公开角色同时发请求验证。

Preventability:
可以提前避免

Origin:
OnlineSoup updates.md [CodeX][261016182544]


## 示例证据编号存在不代表支持其解释命题

Project: OnlineSoup
Date: 2026-10-16

Area:
- AI / LLM
- Testing

Problem Type:
- 内容审核的结构校验与语义证据错配

Incident:
一份未发布题目预览通过结构校验，但其中一条示例引用了存在的证据编号，实际对应另一命题；用户审阅发现引用错位。

Initial Assumption:
引用编号存在且依赖有效，容易被误当成示例依据已充分审核。

Root Cause:
现有校验器只验证编号存在、格式和依赖，不验证证据文本是否支持示例理由及完整问题；结构通过不能替代语义审核。

Resolution:
修正理由文字与evidence_ids，并逐条对照原文、Fact命题及问题；检查理由提到的编号与evidence_ids一致。故事修订时同步追踪评分点、事实和示例，退役的编号不复用。

Evidence:
修订稿生产同源Facts和完整预览校验OK，无错误或警告；10条示例理由编号一致性断言通过，并完成逐条人工命题对照。旧稿与新版均在忽略目录保留；没有将本地审核当作线上AI测试结果。

Lesson:
“证据可找到”和“证据能证明这个命题”是不同的验证层。理由编号检查只能发现部分错配，不能证明语义正确。

Rule:
题目审核分别检查结构、引用原文、依赖和完整命题；发布前人工读每条示例所引用的证据，确认事实/口供/计划假说的范围。不得用机器OK替代人工语义结论。

Preventability:
可以提前避免

Origin:
OnlineSoup updates.md [CodeX][261016192024]


## 作者已知真相不能替代可观察证据与玩家评分依据

Project: OnlineSoup
Date: 2026-10-16

Area:
- AI / LLM
- Testing

Problem Type:
- 事实、可观察证据和评分要求的范围混用

Incident:
未发布题目审核中，人物操作、呈现给另一人物的信息和向调查者提出的说法混在一起；背景信息又被加入必须答出的评分点，用户复核指出因果与公平性问题。

Initial Assumption:
完整汤底已经写出真相，容易顺带把间接记录当作操作者及意图的证明，并把所有合理背景都计入必要评分。

Root Cause:
对输入操作、实际结果、显示信息及不同人物认知没有逐层检查；对观察结果反推原因时跳过了额外前提；没有区分核心解答和可追问背景。

Resolution:
分别写清实际操作、受害者认知、准备说辞和证据能力；明确间接记录不能单独确定操作者及故意程度。移除缺乏公开提示且非核心的背景必答项，为相关推断添加边界示例与回读断言。

Evidence:
新版7个评分点、60条draft Facts、10条示例通过同源校验；保存后确认隐藏背景未进入评分要求，两条新增边界示例区分显示/运行及观察/意图。人工检查说辞不再依赖已恢复的伪装，未宣称线上AI实测通过。

Lesson:
真相成立、证据足以证明真相、玩家必须说出某项信息，是三个不同判断。

Rule:
创作或修订先画清操作与认知的因果链；反推原因逐项核对必要前提。评分只要求解开核心谜团的内容，支撑人物选择的隐含背景保留为可追问依据。

Preventability:
可以提前避免

Origin:
OnlineSoup updates.md [CodeX][261016193005]


## 事实问答示例应避免把证据充分性否定混入真实行为判断

Project: OnlineSoup
Date: 2026-10-16

Area:
- AI / LLM
- Testing

Problem Type:
- 示例问法的答案方向易与故事事实混淆

Incident:
本地未发布题目用“某证据足以证明故意行为吗”作为否定示例，同时引用支持实际故意行为的事实。用户指出该问法接近玩家直接问行为是否故意，存在错误迁移风险。

Initial Assumption:
完整命题在逻辑上回答正确，就适合做玩家问答示例。

Root Cause:
证据够不够和事实是否发生属于不同问题；相似词面的否定样本可能给事实问答制造不必要的边界混淆。该风险没有通过线上模型测试复现，不能报告为已发生的线上错误。

Resolution:
替换为自然的事实判断，肯定行为的示例只引用直接支持该行为的事实；证据充分性讨论保留在审核说明。评分容错区分“不自动补给合谋分”和“不因论证简略扣正确内容的分”。

Evidence:
第四版同源校验OK，保存后确认目标示例为是且仅引用直接事实，另一示例改为实际机关判断；60条Facts与10条示例依赖、引用断言通过。未声称线上AI行为已验证。

Lesson:
形式上正确的边界问法不一定适合用于示范普通玩家事实提问。

Rule:
优先使用自然、单一的事实命题；审核示例答案与证据支持方向，避免用支持真实行为的证据示范近似问法的否定。证据权重不足不应抵消玩家已经说出的正确行为和意图。

Preventability:
可以提前避免

Origin:
OnlineSoup updates.md [CodeX][261016194344]

## 加入房间流程不能顺手关闭用户自己的房间

Project: OnlineSoup
Date: 2026-10-18

Area:
- Database
- Backend / API

Problem Type:
- 绕过既有结算 RPC 的副作用写入

Incident:
线上 join_room_as_member 在登录用户加入新房间时，用一条 update 直接把该用户拥有的未关闭房间置为 closed，不经过 close_room，不退还座位剩余积分、不写 points_transactions，并把房主座位积分重置。已有的 active_room_exists 检查只拦当前会话所在的座位，房主重新登录或换设备后（active_session_id 不同）点开他人分享链接即可触发，界面无任何提示。

Initial Assumption:
加入新房间时自动“清理”旧房间能避免一个账号同时挂在多个房间，且 active_room_exists 已经拦住了同设备场景。

Root Cause:
关闭房间的积分结算只写在 close_room / admin_force_close_and_clear_room 中；加入流程另写了一条关房 update，绕过了结算。会话绑定的检查条件让这条路径在会话变化后仍可达。

Resolution:
新迁移让 join_room_as_member 在用户拥有任何未关闭房间时抛 owned_room_active，并删除直接关房逻辑；前端加入页对已在其他房间的登录用户提前说明并提供“返回原房间”入口。

Evidence:
只读核查现存已关闭房间未发现该缺陷特征（无退款记录且房主座位被清空）；push 后回读函数定义与权限；用 DO 块模拟新/旧 session 调用 RPC 均返回 owned_room_active 且整体回滚；测试账号本地实测被拦截、他人房间与原房间数据不变，关闭后积分不变。

Lesson:
任何改变房间状态的路径都必须复用同一个结算入口，否则积分会在“顺手清理”中静默丢失。

Rule:
除 close_room / 管理端关房外，不在其他 RPC 中直接 update rooms.status='closed'；需要阻止多房间并存时抛错让用户显式关闭。新增或改写房间状态 RPC 时，用 prosrc 搜索 "set status = 'closed'" 复核调用点。

Preventability:
可以提前避免

Origin:
OnlineSoup updates.md [Claude Code][261018230437]
