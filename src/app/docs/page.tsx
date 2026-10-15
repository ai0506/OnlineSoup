import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "架构文档 - 汤局 OnlineSoup",
  description: "OnlineSoup 的系统分层、网页与 CLI、房间同步、ask 引擎架构及用时、成本和准确性对比。",
};

const sections = [
  ["overview", "系统定位"],
  ["architecture", "系统分层"],
  ["domain", "房间与资源"],
  ["identity", "身份与控制权"],
  ["cli", "CLI 与 AI 玩家"],
  ["recovery", "可靠写入与恢复"],
  ["sync", "消息与状态同步"],
  ["puzzle", "题库与知识边界"],
  ["ask", "新旧 ask 架构"],
  ["comparison", "用时、成本与准确性"],
  ["other-modes", "提示与推理"],
  ["ai-state", "AI 请求生命周期"],
  ["quality", "缓存与质量闭环"],
  ["security", "权限与信息边界"],
  ["operations", "维护与演进"],
] as const;

export default function DocsPage() {
  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-label">OnlineSoup / docs</div>
        <nav aria-label="架构文档目录">
          {sections.map(([id, label]) => (
            <a href={`#${id}`} key={id}>{label}</a>
          ))}
        </nav>
        <a className="docs-sidebar-back" href="/tutorial">面向玩家的教程 →</a>
        <a className="docs-sidebar-back" href="/cli">CLI 下载与入门 →</a>
      </aside>

      <main className="docs-content">
        <header className="docs-header">
          <div className="docs-kicker">ARCHITECTURE REFERENCE · 2026-10-14</div>
          <h1>OnlineSoup 架构说明</h1>
          <p>面向 AI、开发者和维护者，解释系统如何组织、各模块负责什么，以及关键设计的取舍。本文基于当前仓库代码、迁移和已有评估记录；线上启用状态需要另行核验。</p>
        </header>

        <section className="docs-section" id="overview">
          <div className="docs-section-heading"><span>01</span><h2>系统定位</h2></div>
          <p>OnlineSoup（汤局）是一个多人协作的海龟汤房间应用。房主创建房间并选择题目，玩家通过聊天、询问、提示和完整推理推进同一局游戏。网页与 CLI 都是这个共享房间的操作入口。</p>
          <p>系统围绕三个核心组织：房间保存共同状态，数据库保证资源和身份一致，AI 主持在受约束的题目材料上作出判断。玩家可以由人操作，也可以由外部 AI Agent 通过 CLI 操作；两者遵守相同的房间、题目和积分规则。</p>
          <div className="docs-grid docs-grid-3">
            <div><b>交互层</b><span>网页提供可视化协作，CLI 提供文本和结构化输出。</span></div>
            <div><b>规则层</b><span>服务端验证操作意图，数据库事务维护成员、座位、积分与请求状态。</span></div>
            <div><b>主持层</b><span>模型负责受限判断、引导和评分，服务端决定结果是否发布和沉淀。</span></div>
          </div>
          <div className="docs-note"><strong>阅读边界</strong><span>玩家操作见教程和 CLI 指南。这里保留必要的模块名和状态名，不逐项展开接口参数、SQL 或 prompt。新 ask 已有实现和预览评估；这不等于已经在生产启用。</span></div>
        </section>

        <section className="docs-section" id="architecture">
          <div className="docs-section-heading"><span>02</span><h2>系统分层与共用业务核心</h2></div>
          <pre className="docs-flow">{`网页玩家                         终端玩家 / 外部 AI Agent
   │                                      │
页面、组件、站内操作                    OnlineSoup CLI
   │                                      │
网页服务端入口                       版本化玩家 API
   └───────────────┬──────────────────────┘
                   │ 身份、成员、题目与输入校验
          数据库事务 / 受保护的业务函数
                   │
          共用房间 AI 执行器（付费操作）
                   │
         问答缓存 → ask / hint / reason
                   │
          完成或退款 → 房间消息与进度
                   │
           网页同步 / CLI 增量读取`}</pre>
          <p>网页使用 Next.js App Router 与 React；终端通过独立 CLI 调用玩家 API。两种入口有各自的认证和响应方式，但 AI 操作共用同一个房间执行器，因此引擎切换、题目隔离、缓存和结果发布可以一起演进。</p>
          <table className="docs-table"><thead><tr><th>层</th><th>主要职责</th><th>设计边界</th></tr></thead><tbody>
            <tr><td>客户端</td><td>展示状态、收集意图、保存必要的恢复位置</td><td>不能自行决定是否有权限、是否扣费成功或是否通关</td></tr>
            <tr><td>应用服务端</td><td>认证、校验、编排模型、裁剪响应</td><td>管理密钥和私密题目材料留在服务端</td></tr>
            <tr><td>Postgres</td><td>成员与设备锁、积分、座位、请求状态的原子变化</td><td>多个应用实例共享同一份可恢复状态</td></tr>
            <tr><td>模型服务</td><td>问答判断、事实摘要、提示、关键点评分</td><td>模型输出还要经过结构和业务校验</td></tr>
            <tr><td>同步层</td><td>把已提交的变化交付客户端</td><td>Realtime 是及时通知，受保护读取是恢复依据</td></tr>
          </tbody></table>
          <p className="docs-small">技术基础：Next.js 16、React 19、TypeScript、Zod、Supabase Auth / Postgres / Realtime。DeepSeek 承担主要主持调用，GLM 用于部分摘要、问答等价判断和配置允许的备用路径。</p>
        </section>

        <section className="docs-section" id="domain">
          <div className="docs-section-heading"><span>03</span><h2>房间、座位与资源模型</h2></div>
          <p>房间是游戏状态的容器：它关联房主、固定座位、当前题目、聊天、AI 请求和通关进度。房间从等待进入游戏，也可以关闭；题目切换只改变当前游戏范围，不应该混入上一题的主持上下文。</p>
          <div className="docs-rule-list">
            <div><b>账号</b><span>保存注册用户身份、用户名和个人积分。个人积分属于用户，跨房间存在。</span></div>
            <div><b>座位</b><span>保存房间内的昵称、临时积分、提示机会和当前控制会话。临时积分跟随座位，离开与接管必须遵守座位规则。</span></div>
            <div><b>房主</b><span>创建房间并预存座位资源，管理开题和房间。赠送、关房返还等变化必须与积分流水一致。</span></div>
            <div><b>题目进度</b><span>按房间与题目记录推进状态；同一题在不同房间中的游戏过程相互独立。</span></div>
          </div>
          <p>创建、入座、离开、移动、赠送和关闭都可能同时修改多份记录，因此集中在数据库事务中完成。可以把事务理解为一次完整交接：座位、身份和积分要么一起交接成功，要么一起保留原状。</p>
          <p>CLI 的付费操作默认选择座位积分，使用个人积分需要为本次操作明确授权。客户端不能在座位积分不足时自行改用个人积分，也不能用重试悄悄改变付款来源。</p>
        </section>

        <section className="docs-section" id="identity">
          <div className="docs-section-heading"><span>04</span><h2>身份、成员资格与设备控制权</h2></div>
          <p>登录身份、房间成员资格和当前设备控制权是三个不同的判断。登录证明“你是谁”，入座证明“你属于这个房间”，设备锁证明“这个会话现在可以操作该座位”。知道房间码或拥有同一个账号，都不能绕过后两个判断。</p>
          <table className="docs-table"><thead><tr><th>入口</th><th>身份来源</th><th>参与方式</th></tr></thead><tbody>
            <tr><td>注册用户网页</td><td>Supabase 登录会话</td><td>使用账号用户名，并验证房间成员与设备锁</td></tr>
            <tr><td>网页访客</td><td>HttpOnly 身份与房间 Cookie</td><td>使用访客座位与临时积分；不能成为 CLI 身份</td></tr>
            <tr><td>CLI</td><td>登录会话 + 服务端 CLI 会话登记</td><td>仅注册用户，可与网页玩家共同参与</td></tr>
          </tbody></table>
          <p>网页与 CLI 使用同一账号的座位时，需要明确接管。CLI 不能靠读取状态夺取网页控制权；网页接管 CLI 座位也有确认步骤，并在提交时再次检查座位是否变化。旧设备失去控制权后，继续读取或写入必须受限。</p>
          <p>在线显示与成员资格也分开处理。CLI 在线标记来自近期动作或尚未结束的 AI 请求，只表达活动迹象。它不保证终端仍打开，也不代替设备锁。后台的账号最近活跃记录另行保存，避免辅助统计频繁推动玩家界面刷新。</p>
        </section>

        <section className="docs-section" id="cli">
          <div className="docs-section-heading"><span>05</span><h2>CLI 与外部 AI 玩家</h2></div>
          <p>CLI 是注册玩家客户端，提供读题、读消息、读事实、聊天、询问、提示、推理和离开等能力。它通过版本化玩家 API 操作房间，不需要数据库管理密钥，也不直接取得私密汤底。</p>
          <p>外部 Agent 可以把 CLI 当作游戏工具：先读取题目与房间状态，再补拉消息和公开事实，决定下一步后提交操作，最后确认结果。Agent 自己使用什么模型由外部环境决定；房间 AI 主持仍由网站服务端调用。</p>
          <div className="docs-grid docs-grid-2">
            <div><b>登录与房间操作分离</b><span>浏览器授权为终端建立独立会话，不自动入座。用户确认终端验证码，终端保存凭证后确认领取；登录链接不携带设备秘密。</span></div>
            <div><b>机器可读的合同</b><span>API 版本、统一结果信封、稳定错误码和 CLI JSON 输出，让自动化程序按状态决定重试、等待或停止。</span></div>
            <div><b>独立工作目录</b><span>多个 Agent 使用不同会话目录隔离账号、消息游标和未确认操作；目录隔离不会绕过同账号座位锁。</span></div>
            <div><b>有限等待</b><span>等待命令组合受保护读取来获取变化；只读轮询不延长入座活跃期，不构成永久后台订阅。</span></div>
          </div>
          <p>CLI 在房间操作后可以附带检查未读消息。这是客户端的提醒，失败不会覆盖原操作结果，也不会偷偷推进消息游标。网站提供独立安装包和玩家指南，详细协议由 CLI 文档维护。</p>
        </section>

        <section className="docs-section" id="recovery">
          <div className="docs-section-heading"><span>06</span><h2>可靠写入与结果恢复</h2></div>
          <p>网络断开只说明客户端没有收到结果，不能说明操作未执行。尤其是扣费和 AI 请求，直接新建一次操作可能重复发送或重复付款。玩家 API 用请求键识别一次固定的写入意图。</p>
          <pre className="docs-flow">{`CLI 保存请求键与操作意图 → 发出写请求
   ├─ 收到最终状态 → 本地确认并清理待办
   └─ 连接中断 / 服务异常 → 结果未知
        └─ 查询原请求键
             ├─ 已完成 / 已退款 → 接受服务端结果
             ├─ 处理中 → 继续等待
             └─ 尚未确认 → 用原键、相同意图恢复`}</pre>
          <p>相同请求键只能代表相同动作、正文、题目、付款来源和接管选项。更改这些内容是新的意图，不能假借重试执行。服务端在保留期后留下拒绝重新执行的记录，避免旧键再次扣费。</p>
          <p>这与 AI 请求 ID 的职责不同：请求键负责客户端重试去重，AI 请求记录负责处理、完成和退款。网页的普通请求 ID 不应被理解为自动具备 CLI 请求键的恢复合同。</p>
          <div className="docs-note"><strong>确认标准</strong><span>处理中不等于已完成，“尝试退款”不等于退款已确认。客户端以服务端最终状态为准；被其他设备接管后，也不能通过查询旧请求恢复房间控制权。</span></div>
        </section>

        <section className="docs-section" id="sync">
          <div className="docs-section-heading"><span>07</span><h2>消息与状态同步</h2></div>
          <p>网页侧优先通过 Realtime 感知座位、积分、消息和题目变化，再在首次加载、断线恢复、事件遗漏或页面恢复时补拉受保护状态。订阅通知只能提示“可能变化了”，不能替代成员验证或数据库事实。</p>
          <p>CLI 使用房间快照、消息分页和持久化增量游标。快照回答“现在是什么状态”，消息流回答“上次之后发生了什么”；客户端需要两者共同恢复游戏上下文。</p>
          <div className="docs-rule-list">
            <div><b>增量位置</b><span>游标绑定账号、房间和历史代次，作为不透明凭据使用。有后续页时继续补拉，不能把一页当作全部新消息。</span></div>
            <div><b>提交顺序</b><span>分页考虑数据库事务可见性，避免仅按消息 ID 前进而永久跳过晚提交的消息。等待可见性有时会增加延迟。</span></div>
            <div><b>历史变化</b><span>删除、归档或编辑可能使游标过期。客户端必须显式重建快照，并承认可能存在历史缺口。</span></div>
            <div><b>本地恢复</b><span>消息与游标一起原子保存后再输出。最近消息缓存帮助恢复终端输出中断，不是完整离线档案，也不承诺终端恰好输出一次。</span></div>
          </div>
          <p>读取消息或持续等待不会自动续期座位。活跃续期由主动加入、聊天和付费动作驱动，使“客户端还在观察”与“玩家仍在参与”保持区别。</p>
        </section>

        <section className="docs-section" id="puzzle">
          <div className="docs-section-heading"><span>08</span><h2>题库与知识边界</h2></div>
          <p>题库同时保存玩家材料与主持材料。它们服务于不同任务，不能把所有字段都当作同一种知识使用。</p>
          <table className="docs-table"><thead><tr><th>材料</th><th>用途</th><th>可见范围</th></tr></thead><tbody>
            <tr><td>汤面</td><td>玩家共同看到的故事起点</td><td>玩家与主持</td></tr>
            <tr><td>汤底</td><td>故事真相，主持判断的最高依据</td><td>服务端主持；公开时机由游戏流程控制</td></tr>
            <tr><td>评分点</td><td>检查完整推理覆盖了哪些独立要点</td><td>主持评分材料；按游戏规则展示结果</td></tr>
            <tr><td>题库 Facts</td><td>新 ask 的经过审核的明说或推导事实</td><td>私密证据层，不直接提供给玩家</td></tr>
            <tr><td>Examples</td><td>本题的示范问答，约束问题理解和回答边界</td><td>内部主持材料</td></tr>
            <tr><td>房间事实</td><td>玩家已经通过问答和提示获得的简短公开信息</td><td>当前房间成员</td></tr>
          </tbody></table>
          <p>新架构将题库 Facts 与推理评分点分开。明说事实需要原文依据，推导事实需要依赖链；校验覆盖引用、依赖存在性和循环问题，运行时只使用有效列表中的已批准事实。结构校验能发现格式和来源问题，语义是否成立仍需要审核。</p>
          <p>汤面、汤底、examples 或 Facts 变化会推动题目内容版本变化；故事变化而未同步替换 Facts 时，已有 Facts 回到待复核状态。新引擎的缓存按内容版本隔离，正在处理的回答在发布前也检查版本。</p>
          <p>题库 Facts 是主持知道的证据，房间事实是玩家已经获知的信息。私密 Facts 不会因为被批准就全部公开；一次正确回答也不能顺带泄露没有被询问的汤底。</p>
        </section>

        <section className="docs-section" id="ask">
          <div className="docs-section-heading"><span>09</span><h2>新旧 ask 架构</h2></div>
          <p>ask 接收可以判断真假的问题，对玩家输出“是”“否”“与此无关”或“模糊问题”。新旧架构都使用多次独立模型调用；这里的独立指任务与输入隔离，不代表使用不同模型或具备统计独立性。</p>
          <h3 className="docs-subheading">旧引擎 v1：两种读法交叉检查</h3>
          <pre className="docs-flow">{`问题 → 严格读法 ──┐
     → 推断读法 ──┴─ 标签一致 → 采用
                       不一致 → 仲裁 → 最终标签`}</pre>
          <p>严格路强调直接证据，推断路允许有依据且方向唯一的推断。两路读取各自适用的本题 examples，并利用同题上下文；评分点也作为隐含事实材料。正常情况下，标签一致则保留，分歧则重新仲裁。</p>
          <p>它容易实现交叉检查，但两路都在做完整分类，可能同时受相近材料或历史错误影响。标签相同只能说明结论相同，不能直接说明两路都找到了支持完整命题的证据。旧仲裁主要接收候选标签，不接收两路理由。</p>
          <h3 className="docs-subheading">新引擎 v2：基础判断与独立证据验证</h3>
          <pre className="docs-flow">{`                       ┌─ A：理解完整命题，给出答案标签
问题 + 汤底 + 已批准 Facts ┤      │
                       └─ B1：独立检查支持 / 反驳 / 无法确定
                                │
A 为模糊问题 → 直接返回，不等待 B1
其他情况    → 比较 A 与 B1
                ├─ 一致 → 保留 A
                └─ 冲突 → 仲裁核对命题、理由与引用 → 最终标签`}</pre>
          <p>A 负责问题理解与答案分类，读取本题示例；B1 不看 A 的结果，也不读取示例答案，只检查完整命题是否被证据支持或反驳。B1 不负责主线相关性和问法分类。两路同时开始，程序按决定表比较，避免先给验证者看答案后再要求它找理由。</p>
          <table className="docs-table"><thead><tr><th>A 的判断</th><th>B1 的证据结论</th><th>程序动作</th></tr></thead><tbody>
            <tr><td>是</td><td>支持</td><td>保留，可继续申请事实摘要和缓存</td></tr>
            <tr><td>否</td><td>反驳</td><td>保留，可继续申请事实摘要和缓存</td></tr>
            <tr><td>与此无关</td><td>无法确定</td><td>保留，不沉淀为稳定问答</td></tr>
            <tr><td>上述其他组合</td><td>与 A 冲突</td><td>仲裁；结果只用于本次作答</td></tr>
            <tr><td>模糊问题</td><td>不等待、不采用</td><td>直接返回；B1 已发起，不代表省去该调用成本</td></tr>
          </tbody></table>
          <p>仲裁读取 A、B1 的命题、理由和证据，从原始材料重新判断。程序能检查引用是否存在，但不能机械证明引用一定推出结论。历史只保留少量玩家问题用于指代，不把以往 AI 答案当作新一轮证据，减少错误自我强化。</p>
          <div className="docs-note"><strong>切换与回退</strong><span>代码通过 <code>ASK_ENGINE</code> 选择引擎，只有显式设为 v2 才启用新路径，默认仍为 v1。必要验证失败时，生产执行器尝试由 v1 作答并记录失败来源，不写新缓存；备用也失败才进入退款。B2 联系探索分支已取消。</span></div>
        </section>

        <section className="docs-section" id="comparison">
          <div className="docs-section-heading"><span>10</span><h2>用时、成本与准确性对比</h2></div>
          <p>2026-10-13 在 Vercel 新加坡预览环境，用相同 56 题做了两轮新旧引擎对照。样本包括两道真实题目的回归问题和虚构边界题，重点覆盖推断、错误历史、合并提问与指代；新引擎带有本次整理的 Facts。它比较的是整套配置，不能把改善全部归因于调度架构。</p>
          <table className="docs-table"><thead><tr><th>观察项</th><th>旧 v1（第 1 / 2 轮）</th><th>新 v2（第 1 / 2 轮）</th></tr></thead><tbody>
            <tr><td>样本答对</td><td>48/56 · 47/56</td><td>55/56 · 56/56</td></tr>
            <tr><td>样本准确率</td><td>85.7% · 83.9%</td><td>98.2% · 100%</td></tr>
            <tr><td>总往返 P50</td><td>1.927 秒 · 1.797 秒</td><td>2.023 秒 · 1.924 秒</td></tr>
            <tr><td>总往返 P95</td><td>2.707 秒 · 2.514 秒</td><td>2.863 秒 · 2.824 秒</td></tr>
            <tr><td>记录到的调用失败</td><td>0 · 0</td><td>0 · 0</td></tr>
          </tbody></table>
          <p className="docs-small">P50 是中位数，P95 表示约 95% 的观测不超过该值。总往返是评估客户端到预览接口的耗时，包含评估内的模型与摘要处理，不包含真实房间扣费、消息落库和页面刷新。两轮重复使用同一批题目，不是 112 道独立样本。</p>
          <h3 className="docs-subheading">用时：取决于路径与整体链路</h3>
          <p>两套架构正常都先并发调用两路，冲突后再串行仲裁；新架构没有天然减少基本调用轮数。v2 模糊问题可以提前返回，但 B1 已经发起。两轮 v2 均有 47 题一致、4 题仲裁、5 题直接返回模糊问题。</p>
          <p>这组数据里，新引擎总往返中位数增加约 5%–7%，P95 也略高。不能据此宣称整体更快，也不能外推生产长尾。旧报告的“判定耗时”包含旧引擎内部摘要，新引擎将摘要单独计时，两列口径不同，因此不据此计算判定加速比例。</p>
          <h3 className="docs-subheading">成本：输入更短，但账单未必更低</h3>
          <table className="docs-table"><thead><tr><th>日志用量</th><th>旧 v1（第 1 / 2 轮）</th><th>新 v2（第 1 / 2 轮）</th></tr></thead><tbody>
            <tr><td>输入 token</td><td>261,675 · 257,826</td><td>135,362 · 138,760</td></tr>
            <tr><td>其中缓存命中</td><td>241,387 · 237,675</td><td>89,472 · 116,096</td></tr>
            <tr><td>未缓存输入</td><td>20,288 · 20,151</td><td>45,890 · 22,664</td></tr>
            <tr><td>输出 token</td><td>3,508 · 3,406</td><td>5,643 · 5,833</td></tr>
          </tbody></table>
          <p>新引擎记录到的总输入减少约 46%–48%，但未缓存输入和输出都增加。实际费用需要分别乘以缓存输入、未缓存输入和输出单价，再加摘要、备用和其他提供方调用。当前记录没有账单核对，不能给出人民币节省比例。</p>
          <p>公共前缀复用有利于同题后续请求的模型上下文缓存；这是提供方对输入 token 的缓存，与系统直接复用批准答案的问答缓存不同。预热、执行顺序、题目长度与流量都会改变命中率。模糊问题提前返回后的 B1 可能未被本次日志完整收集，用量应视为观测值而非结算凭据。</p>
          <h3 className="docs-subheading">准确性：回归样本改善，泛化仍需验证</h3>
          <p>新引擎在这些样本上改善了有依据推断、复合问题、指代不明和二选一的处理。第一轮仍有一题漏判，第二轮答对，说明结果仍有波动。样本经过问题针对性选择，也参与过 prompt 调整；100% 是该轮样本结果，不是全题库或线上正确率。</p>
          <p>架构上的收益在于把“如何回答”与“证据是否成立”分开，并让冲突可以追查。后续应在未参与调优的题目上分别观察 A、B1、仲裁与最终结果，记录纠错和新增错误、证据有效性、失败与回退率，再用同口径全链路 P50/P95 和实际计费用量评估是否值得扩大使用。</p>
        </section>

        <section className="docs-section" id="other-modes">
          <div className="docs-section-heading"><span>11</span><h2>提示与完整推理</h2></div>
          <p>ask、hint 和 reason 是三种任务，分别解决“这个命题对不对”“下一步往哪里想”“我的完整解释覆盖了多少真相”。新的 ask 开关只切换问答引擎，不把提示和评分一并改成 A/B1 流程。</p>
          <div className="docs-grid docs-grid-2">
            <div><b>hint · 提示</b><span>根据当前题目、已给提示和推理进展选择新的引导方向。受积分与提示机会约束，不能直接复述完整汤底；有效摘要可以进入房间事实。</span></div>
            <div><b>reason · 尝试推理</b><span>根据独立评分点检查玩家认可的解释，区分已覆盖、未覆盖与仅列为假设的内容。结果推动题目进度，本身不直接变成共享事实。</span></div>
          </div>
          <p>推理按覆盖率分为正确、部分正确和不正确，当前阈值为 70% 与 20%。该规则由程序计算，模型负责逐点评估，不能自行修改通关标准。缺少评分点的题目不能据此公平评分。</p>
          <p>题库 Facts、评分点和 examples 各有质量要求。修改 ask 证据层不能替代评分点维护；调整某一机制时，应同时检查玩家输出、事实面板和管理审计是否仍符合各自边界。</p>
        </section>

        <section className="docs-section" id="ai-state">
          <div className="docs-section-heading"><span>12</span><h2>AI 请求生命周期与失败补偿</h2></div>
          <pre className="docs-flow">{`验证成员、题目、费用与房间互斥
               │
      原子扣费 + 建立 pending 租约
               │
       查批准缓存 / 调用主持引擎
               │
      重新核对题目与适用的内容版本
               │
        ┌──────┴─────────┐
      成功               失败 / 失效
        │                   │
写消息、更新进度       补偿原付款来源
   completed              refunded`}</pre>
          <p>外部模型调用在数据库事务之外执行，避免长时间占用事务锁。数据库先登记费用来源和有时限的处理权，再由执行器进行模型调用，最后用完成事务发布结果或补偿。这让请求状态可以跨应用实例恢复。</p>
          <p>普通房间通过数据库租约限制同一时间的未完成 AI 请求，避免多人并发导致题目进度冲突或重复结算。客户端重试去重与房间互斥解决不同问题：前者识别同一意图，后者协调不同玩家的操作。</p>
          <p>切题、读取失败、模型失败和结果写回失败都需要进入对应补偿路径。v2 还在发布前检查题目内容版本，避免拿修改前的材料作答。引擎回退仍属于原请求，不额外向玩家扣一次费用；回退成功和退款完成是不同结局。</p>
          <p>事实摘要是附加产物，不能被当作主持答案本身。调用成功也不是最后一步：只有完成事务接受结果，玩家才应把本次请求视为已完成。</p>
        </section>

        <section className="docs-section" id="quality">
          <div className="docs-section-heading"><span>13</span><h2>问答缓存与质量闭环</h2></div>
          <p>问答缓存保存适合复用的稳定是非命题，不保存全部对话。命中需要题目范围、适用引擎、审批状态和语义条件匹配；v2 还要求内容版本一致。新生成的候选先待审核，批准后才可被后续玩家复用。</p>
          <p>v1 正常双路一致、v2 A 与 B1 验证一致的稳定 yes/no 可以进入候选筛选。代词依赖、复合问题、低价值或不稳定问法仍可能被排除。v2 仲裁与回退结果不写入新缓存，避免把本次可用答案直接提升成长期规则。</p>
          <pre className="docs-flow">{`题库材料与审核 → 主持执行 → 玩家答案
                       ├─ 合格摘要 → 房间公开事实
                       ├─ 稳定问答 → 待审核缓存 → 批准后复用
                       └─ 内部审计 → 错误案例 → 回归验证 → 小步修正`}</pre>
          <p>管理后台保留消息审计、AI 错误案例、缓存审批与聊天备份。排查时要区分问题来自题库、示例、缓存、摘要、模型判断还是业务流程；只改 prompt 往往不能解决所有来源。</p>
          <p>审计记录服务于维护，不进入玩家上下文。v2 使用独立版本的 A/B1/仲裁审计，而不是把证据验证伪装成旧的严格／推断字段。答案一致也不表示引用正确或模型推理可靠，仍需抽样复核。</p>
        </section>

        <section className="docs-section" id="security">
          <div className="docs-section-heading"><span>14</span><h2>权限与信息边界</h2></div>
          <p>权限分布在应用入口与数据库两层。入口校验身份、输入和来源，数据库函数再次检查成员、设备锁、房主关系、题目和资源。RLS 像数据库门卫，授权决定调用方能到达哪些对象，两者共同限定数据访问。</p>
          <div className="docs-rule-list">
            <div><b>公开信息</b><span>加入页只需要最小房间信息，不应获得密码哈希、成员凭证、私密订阅信息或汤底。</span></div>
            <div><b>成员信息</b><span>消息、座位、题目和事实通过受保护读取提供；房间码本身不是访问授权。</span></div>
            <div><b>主持材料</b><span>服务端按需读取私密题目材料并调用模型，返回玩家前剥离内部理由、审计、缓存匹配和调试字段。</span></div>
            <div><b>管理能力</b><span>后台要求管理员身份与二次验证；导出、批量管理、缓存审批和私密资料读取只能走受保护服务端。</span></div>
            <div><b>终端凭证</b><span>CLI 本地会话含登录凭证、消息缓存和待确认正文，需要文件权限保护；不应提交、分享或复制给其他玩家。</span></div>
          </div>
          <p>玩家文本始终是游戏输入，即使声称“系统指令”也不能改变主持规则。模型不直接操作座位、积分或数据库权限；这些操作由确定的业务流程决定。</p>
          <p>用户反馈是独立的注册用户功能，不调用入座或设备接管流程。管理辅助信息也应独立保存，避免统计、反馈或审计影响正常游戏。</p>
        </section>

        <section className="docs-section" id="operations">
          <div className="docs-section-heading"><span>15</span><h2>维护入口与架构演进</h2></div>
          <table className="docs-table"><thead><tr><th>模块</th><th>主要入口</th><th>维护关注点</th></tr></thead><tbody>
            <tr><td>网页与房间</td><td>页面、房间路由、客户端组件</td><td>交互不中断，断线恢复，接管后的权限变化</td></tr>
            <tr><td>玩家接入</td><td>CLI、玩家 API、协议文档</td><td>版本兼容、请求去重、游标与本地状态恢复</td></tr>
            <tr><td>主持编排</td><td><code>room-ai-runner</code></td><td>网页与 CLI 共用，题目隔离，完成与补偿</td></tr>
            <tr><td>问答引擎</td><td><code>deepseek</code>、<code>ask-v2</code></td><td>独立角色、冲突处理、回退与审计</td></tr>
            <tr><td>知识与复用</td><td>题库 Facts、问答缓存、摘要</td><td>来源审核、内容版本、公开与私密材料分开</td></tr>
            <tr><td>数据规则</td><td>数据库迁移与受保护函数</td><td>原子性、角色授权、迁移历史与真实调用</td></tr>
          </tbody></table>
          <p>架构演进优先复用共同业务核心，再在入口层提供不同交互。新能力不能因为 CLI、网页或 AI Agent 的使用方式不同而绕过同一套成员、资源和状态规则。</p>
          <p>验证分为静态检查与构建、规则测试、数据库权限与事务验证、真实玩家端到端流程、模型效果评估。某一层通过不能替代其他层；预览模型试跑也不能证明生产迁移和引擎配置已经生效。</p>
          <p>当前仓库保留 CLI 协议与验收记录、ask 分支设计和预览评估。实施计划描述设计过程，当前代码描述可执行路径；生产事实还需核对部署、迁移和实际调用。本文未重新进行付费模型评估，也未核验生产配置。</p>
        </section>

        <footer className="docs-footer">整理日期：2026-10-14。以当前代码、数据库迁移和实际验证结果为准；样本指标只适用于注明的评估条件。</footer>
      </main>
    </div>
  );
}
