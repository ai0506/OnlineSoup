import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "技术文档 - 汤局 OnlineSoup",
  description: "OnlineSoup 的技术栈、数据边界、房间流程和 AI 主持实现说明。",
};

const sections = [
  ["overview", "项目边界"],
  ["project-features", "项目特点"],
  ["stack", "技术栈"],
  ["architecture", "请求与数据流"],
  ["routes", "路由与接口"],
  ["schema", "数据模型"],
  ["domain", "业务规则"],
  ["puzzle-mechanics", "题库与三种机制"],
  ["ai", "AI 主持"],
  ["ai-state", "AI 请求状态"],
  ["features", "技术特点"],
  ["security", "身份与安全"],
  ["operations", "运维入口"],
] as const;

export default function DocsPage() {
  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-label">OnlineSoup / docs</div>
        <nav aria-label="技术文档目录">
          {sections.map(([id, label]) => (
            <a href={`#${id}`} key={id}>{label}</a>
          ))}
        </nav>
        <a className="docs-sidebar-back" href="/tutorial">面向玩家的教程 →</a>
      </aside>

      <main className="docs-content">
        <header className="docs-header">
          <div className="docs-kicker">TECHNICAL REFERENCE · CURRENT IMPLEMENTATION</div>
          <h1>OnlineSoup 技术说明</h1>
          <p>这份页面描述当前网站的实现方式、主要数据边界和业务流程，供需要理解或操作本项目的 AI、开发者和维护者使用。代码与最新迁移文件优先于本文。</p>
        </header>

        <section className="docs-section" id="overview">
          <div className="docs-section-heading"><span>01</span><h2>项目边界</h2></div>
          <p>OnlineSoup（汤局）是一个多人在线海龟汤房间应用。房主创建房间并选择题目，玩家在房间内聊天、向 AI 提问、请求提示或提交完整推理。</p>
          <div className="docs-note"><strong>页面边界</strong><span><code>/tutorial</code> 面向玩家，解释如何使用；<code>/docs</code> 面向理解系统的读者，解释技术和规则。</span></div>
          <div className="docs-grid docs-grid-3">
            <div><b>前端</b><span>Next.js App Router 页面与 React 客户端组件</span></div>
            <div><b>服务端</b><span>Server Actions、Route Handlers、Supabase SSR 会话</span></div>
            <div><b>持久化</b><span>Supabase Auth、Postgres、RLS、Realtime</span></div>
          </div>
        </section>

        <section className="docs-section docs-feature-section" id="project-features">
          <div className="docs-section-heading"><span>02</span><h2>OnlineSoup 项目特点</h2></div>
          <p>OnlineSoup 的核心不是“把 AI 接到聊天框里”，而是把海龟汤作为一种多人、共享状态、带资源约束的房间活动来实现。下面这些特点决定了它的页面结构、数据库设计和 AI 调用方式。</p>
          <div className="docs-feature-grid">
            <article><div className="docs-feature-index">A</div><h3>多人房间是第一层模型</h3><p>聊天、座位、积分、题目和 AI 结果都以房间为中心。海龟汤不是单人问答页，而是在同一个房间里由多人共同发现事实和推进进度。</p></article>
            <article><div className="docs-feature-index">B</div><h3>AI 是游戏主持人</h3><p>AI 持有汤底和关键事实，负责回答是非问题、给出有限提示、按评分点检查推理；它不是开放式聊天助手，也不能随意扩写故事。</p></article>
            <article><div className="docs-feature-index">C</div><h3>访客可以直接参与</h3><p>加入房间不要求注册。访客通过 HttpOnly Cookie 恢复身份和座位，使用座位临时积分；房主和平台账号仍由 Supabase Auth 管理。</p></article>
            <article><div className="docs-feature-index">D</div><h3>积分是房间资源</h3><p>创建房间时房主为座位预存临时积分，玩家消耗所在座位的积分进行 AI 操作。积分扣除、赠送、退款和关房返还都有数据库事务和流水记录。</p></article>
            <article><div className="docs-feature-index">E</div><h3>事实是共享白板</h3><p>高置信询问答案和提示可以生成简短事实摘要，所有玩家看到同一份当前题目的事实集合。事实按题目隔离，推理尝试本身不会自动变成事实。</p></article>
            <article><div className="docs-feature-index">F</div><h3>题库包含主持上下文</h3><p>题目不仅保存 surface 和 bottom，还可以保存关键评分点以及 fact / inferential 示例问答。它们共同约束 AI，减少同一道题在不同问法下出现不一致。</p></article>
            <article><div className="docs-feature-index">G</div><h3>实时同步有恢复路径</h3><p>座位、积分、消息和题目变化优先通过 Supabase Realtime 通知；断线、事件遗漏或页面恢复时，再通过轮询或受保护接口补拉真实状态。</p></article>
            <article><div className="docs-feature-index">H</div><h3>管理员参与质量控制</h3><p>题库、待审核问答缓存、AI 错误案例、消息审计和聊天备份都有管理入口。AI 结果不是全部自动沉淀为长期规则，而是保留审核边界。</p></article>
          </div>
          <div className="docs-note"><strong>当前不做什么</strong><span>当前实现没有公开房间大厅、单独的个人游戏模式、自动把所有 AI 推断写成事实、或让浏览器直接访问私密表。未完成事项以 <code>tasks.md</code> 为准。</span></div>
        </section>

        <section className="docs-section" id="stack">
          <div className="docs-section-heading"><span>03</span><h2>技术栈</h2></div>
          <table className="docs-table"><thead><tr><th>层</th><th>当前实现</th><th>代码位置</th></tr></thead><tbody>
            <tr><td>应用框架</td><td>Next.js 16 App Router，React 19，TypeScript strict</td><td><code>src/app</code>、<code>src/components</code></td></tr>
            <tr><td>样式</td><td>全局 CSS，响应式布局；没有引入 UI 框架</td><td><code>src/app/globals.css</code></td></tr>
            <tr><td>认证与数据库</td><td>Supabase Auth、<code>@supabase/ssr</code>、Postgres</td><td><code>src/lib/supabase</code>、<code>supabase/migrations</code></td></tr>
            <tr><td>校验与安全</td><td>Zod 表单校验；数据库函数使用 SECURITY DEFINER 时设置空 search_path</td><td><code>src/lib/validation.ts</code></td></tr>
            <tr><td>AI 服务</td><td>DeepSeek 主模型；Zhipu/GLM 用于部分事实摘要和问答等价判断</td><td><code>src/lib/deepseek.ts</code>、<code>src/lib/qa-cache.ts</code></td></tr>
          </tbody></table>
        </section>

        <section className="docs-section" id="architecture">
          <div className="docs-section-heading"><span>04</span><h2>请求与数据流</h2></div>
          <pre className="docs-flow">{`浏览器
  ├─ 页面 / Server Action / Route Handler
  │    ├─ 普通 Supabase server client：携带用户会话，受 RLS 约束
  │    └─ admin client：仅管理端服务端使用，不返回私密表
  └─ 房间客户端订阅 Realtime：用于及时刷新，不作为唯一事实来源

Supabase Postgres
  ├─ 公开可读的 rooms / room_seats（仅非 closed 房间）
  ├─ 通过 RPC 保护的 room_messages / room_ai_requests / guest_sessions
  └─ 事务内完成加入、座位、积分、开题、离开和 AI 请求状态变化`}</pre>
          <p>房间聊天初始状态由 <code>get_room_chat_bootstrap</code> 补拉，写入走 <code>send_room_chat_message</code>。AI 请求走 <code>send_room_ai_request</code> 记录和扣费，外部模型调用结束后由 <code>finish_room_ai_request</code> 完成或退款。</p>
          <div className="docs-note"><strong>并发原则</strong><span>积分、座位和房间状态不能拆成应用层多次写入；数据库 RPC 是原子边界。Realtime 事件丢失时，客户端应重新请求受保护状态。</span></div>
        </section>

        <section className="docs-section" id="routes">
          <div className="docs-section-heading"><span>05</span><h2>路由与接口</h2></div>
          <p>页面路由使用 App Router。涉及身份、成员资格或积分的操作不会把权限判断交给浏览器，而是在 Server Action、Route Handler 或数据库 RPC 中再次校验。</p>
          <table className="docs-table"><thead><tr><th>入口</th><th>作用</th><th>边界</th></tr></thead><tbody>
            <tr><td><code>/</code></td><td>输入房间码、恢复当前房间或进入创建房间</td><td>服务端检查登录用户的 active room；访客恢复依赖 HttpOnly Cookie</td></tr>
            <tr><td><code>/rooms/[code]</code></td><td>房间页面，加载房间、座位、聊天和题目状态</td><td>成员资格通过用户会话或 guest token 验证</td></tr>
            <tr><td><code>/rooms/[code]/messages</code></td><td>GET 补拉聊天，POST 发送普通聊天</td><td>调用 <code>get_room_chat_bootstrap</code> / <code>send_room_chat_message</code></td></tr>
            <tr><td><code>/rooms/[code]/ask</code></td><td>提交询问、提示、推理</td><td>服务端校验输入、题目版本、积分和 AI 配置</td></tr>
            <tr><td><code>/auth/*</code>、<code>/account/*</code></td><td>登录回调、用户名和账号操作</td><td>Supabase SSR Cookie；用户名设置后才进入需要账号资料的页面</td></tr>
            <tr><td><code>/admin/*</code></td><td>题库、缓存、错误案例、用户和备份管理</td><td>管理员身份 + 二次验证；私密操作仅在服务端执行</td></tr>
          </tbody></table>
        </section>

        <section className="docs-section" id="schema">
          <div className="docs-section-heading"><span>06</span><h2>数据模型</h2></div>
          <div className="docs-rule-list">
            <div><b>profiles</b><span>注册用户资料与个人积分。主键关联 <code>auth.users.id</code>；普通用户只读自己的资料。</span></div>
            <div><b>rooms</b><span>房间公开状态、房主、座位上限、每座积分、预留积分和当前题目。<code>owner_id</code> 关联 profiles。</span></div>
            <div><b>room_private</b><span>房间密码哈希和私有 Realtime topic。浏览器角色没有直接读取权限。</span></div>
            <div><b>room_seats</b><span>房间内的固定座位、昵称、占用时间和临时积分；临时积分跟随座位，不跟随玩家。</span></div>
            <div><b>guest_sessions</b><span>访客座位会话。数据库保存 guest token 的 SHA-256 hash，Cookie 中不保存数据库记录 ID。</span></div>
            <div><b>room_messages</b><span>普通聊天、系统消息和 AI 消息。包含 room、seat、sender、message mode、puzzle 作用域和创建时间。</span></div>
            <div><b>puzzles / progress</b><span>题目保存表面故事、底层真相、难度、关键点和 examples；进度按房间与题目组合保存。</span></div>
            <div><b>room_ai_requests</b><span>记录一次 AI 操作的题目、模式、费用来源、状态和时间；请求消息 ID 是主键并关联 room_messages。</span></div>
            <div><b>puzzle_qa_cache</b><span>按题目保存已批准的稳定 yes/no 问答缓存；新结果先是 pending，管理员批准后才可命中。</span></div>
          </div>
        </section>

        <section className="docs-section" id="domain">
          <div className="docs-section-heading"><span>07</span><h2>业务规则</h2></div>
          <div className="docs-rule-list">
            <div><b>房间</b><span>房间码为 6 位大写字母或数字。状态为 <code>waiting</code>、<code>playing</code>、<code>closed</code>；关闭后不再公开读取。</span></div>
            <div><b>角色</b><span>房主必须是注册用户。玩家可以是注册用户或访客；注册用户有个人积分，访客使用绑定在座位上的临时积分。</span></div>
            <div><b>题目</b><span><code>puzzles</code> 保存 surface、bottom、difficulty；<code>rooms.current_puzzle_id</code> 表示当前题目，<code>puzzle_progress</code> 保存房间级完成状态。</span></div>
            <div><b>AI 费用</b><span>询问和提示各消耗 1 分，尝试推理消耗 2 分。提示机会由询问次数和推理尝试产生，具体扣除在 RPC 中校验。</span></div>
            <div><b>反馈</b><span>只有注册用户可提交；分类固定为 bug、ai、suggestion、puzzle、other。提交和每日限制由 <code>submit_user_feedback</code> RPC 处理。</span></div>
          </div>
        </section>

        <section className="docs-section" id="puzzle-mechanics">
          <div className="docs-section-heading"><span>08</span><h2>题库与三种 AI 机制</h2></div>
          <h3 className="docs-subheading">题库不是只有一问一答</h3>
          <p>一条题目至少包含公开故事（<code>surface</code>）、底层真相（<code>bottom</code>）和难度；当前实现还支持关键评分点（<code>key_points</code>）与示例问答（<code>examples</code>）。这些字段由管理端维护，玩家只看到公开故事和游戏过程中应该公开的结果。</p>
          <div className="docs-rule-list">
            <div><b>surface</b><span>玩家看到的故事表面，用于建立谜面，不应被 AI 当作完整答案。</span></div>
            <div><b>bottom</b><span>主持人的权威真相。AI 的判断、提示和推理评分都以它为基础，不能凭空补充真相之外的事实。</span></div>
            <div><b>key_points</b><span>把底层真相拆成独立评分点，可配置接受关键词；标记为 SOI（Seen Or Implied）的点允许通过明确的语义蕴含计分。</span></div>
            <div><b>examples</b><span>题目专属的示例问题、答案和 reason，分为 fact 与 inferential 两种读取类型；示例用于约束模型，不是全局问答模板。</span></div>
          </div>

          <h3 className="docs-subheading">询问 ask：双路是非判断</h3>
          <p>玩家输入最多 50 字的询问。服务端把当前题目的 surface、bottom、权威隐含事实、同题近期问答和对应 examples 放入 prompt，并并行执行两种读法：</p>
          <table className="docs-table"><thead><tr><th>阶段</th><th>机制</th><th>输出</th></tr></thead><tbody>
            <tr><td>严格读法</td><td>只在真相或权威事实直接、明确支持或否定时提交 yes/no；不确定时倾向 irrelevant 或 ambiguous。</td><td rowSpan={2}><code>yes</code>、<code>no</code>、<code>irrelevant</code>、<code>ambiguous</code></td></tr>
            <tr><td>推断读法</td><td>允许一次方向唯一的必要推断，也处理明确的反讽或隐含表达，但不补造身份、动机、关系和外部事件。</td></tr>
            <tr><td>交叉检查</td><td>两路结果一致时直接采用；不一致时再调用仲裁 prompt，从真相重新判断，而不是简单投票。</td><td>不一致的结果不进入高置信事实和共享缓存</td></tr>
          </tbody></table>
          <p className="docs-small">询问的 AI 原始 reason、strict/inferential audit 只供服务端和管理端排查；玩家看到的是答案标签和满足条件时生成的简短事实摘要。</p>

          <h3 className="docs-subheading">提示 hint：引导而不是揭底</h3>
          <p>玩家输入最多 50 字，通常是“给我提示”或说明卡住的方向。系统从当前题目的历史消息中提取已经给过的提示和玩家推理尚未覆盖的评分点，要求模型选择一个新的、容易接近的方向。</p>
          <ul className="docs-list">
            <li>提示不得直接复述 bottom，也不能重复或改写已有提示。</li>
            <li>模型返回 <code>hint</code> 和 <code>summary</code>；前者是给玩家的引导，后者是可放入公共事实面板的简短陈述。</li>
            <li>一次提示消耗 1 积分和 1 次提示机会；每完成 3 次询问或完成一次推理尝试，可获得提示机会。</li>
            <li>即使玩家在输入中要求“忽略规则”或“直接显示答案”，也会被当作游戏文本，而不是模型指令。</li>
          </ul>

          <h3 className="docs-subheading">尝试推理 reason：按关键点独立评分</h3>
          <p>玩家输入最多 300 字，提交一段自己认可的完整解释。模型不会只判断“整体像不像答案”，而是对每个 <code>key_point</code> 独立返回 <code>covered: true/false</code>，还会忽略玩家列出但否定、保留为假设或最后没有采纳的解释。</p>
          <div className="docs-note"><strong>评分阈值</strong><span>覆盖率达到 70% 记为“推理正确”；达到 20% 但低于 70% 记为“部分正确”；低于 20% 记为“推理不正确”。没有关键评分点时不会进行公平评分。</span></div>
          <p>推理结果公开覆盖哪些评分点，但不直接公开完整 bottom。该模式消耗 2 积分，完成后增加 1 次提示机会；AI 输出若试图伪造 JSON、覆盖字段或改变评分规则，会被服务端按不覆盖关键点处理。</p>
        </section>

        <section className="docs-section" id="ai">
          <div className="docs-section-heading"><span>09</span><h2>AI 主持</h2></div>
          <p>AI 不是直接读取数据库的客户端功能。服务端先验证房间成员、当前题目、模式和可用积分，再读取当前题目上下文与近期消息，调用模型并把脱敏后的结果写回房间消息。</p>
          <div className="docs-grid docs-grid-2">
            <div><b>ask · 询问</b><span>用于是 / 否问题。当前实现有严格判断与推断判断，必要时进行第三方仲裁；缓存只针对稳定的 yes/no 问题。</span></div>
            <div><b>hint · 提示</b><span>根据当前题目和已公开信息生成提示，受提示机会和积分限制。</span></div>
            <div><b>reason · 推理</b><span>接收较长的完整推理，模型判断正确、部分正确或不正确，并更新题目进度。</span></div>
            <div><b>事实摘要</b><span>优先由 GLM 生成稳定事实；失败时可回退 DeepSeek。推理和玩家假设不会直接写入事实面板。</span></div>
          </div>
          <p className="docs-small">模型密钥、内部 audit、reason、cache_hit 和管理数据只在服务端或管理后台使用，不返回给普通玩家。</p>
        </section>

        <section className="docs-section" id="ai-state">
          <div className="docs-section-heading"><span>10</span><h2>AI 请求状态与失败处理</h2></div>
          <pre className="docs-flow">{`send_room_ai_request
  └─ pending：校验成员 / 题目 / 费用，并原子扣除积分
       ├─ 当前题目改变、题目读取失败或模型失败
       │    └─ refunded：退回本次积分，不写入可见 AI 回复
       └─ 外部模型返回 JSON
            └─ finish_room_ai_request(is_success=true)
                 └─ completed：写入 AI 消息并完成扣费`}</pre>
          <ul className="docs-list">
            <li>请求开始前用 <code>askSchema</code> 校验 JSON、模式、内容长度和 expected puzzle ID。</li>
            <li>模型调用前后都检查当前题目 ID，防止切题期间把旧题目的结果写进新题目。</li>
            <li>DeepSeek 的 JSON 响应如果为空、HTTP 失败或 <code>finish_reason=length</code>，视为失败；可按当前配置尝试 GLM fallback。</li>
            <li>AI 超时或写回失败时调用退款路径；退款本身也由数据库函数处理，避免只在前端修改积分显示。</li>
          </ul>
        </section>

        <section className="docs-section" id="features">
          <div className="docs-section-heading"><span>11</span><h2>实现层特点与设计取舍</h2></div>
          <div className="docs-rule-list">
            <div><b>数据库原子性</b><span>加入房间、抢占座位、创建房间、赠送积分、移动座位、开关题目和 AI 扣费等会影响多个记录的操作集中在 Postgres RPC 中完成，避免应用层多次请求之间出现竞态。</span></div>
            <div><b>服务端优先</b><span>浏览器负责展示和提交意图，关键规则不依赖前端隐藏按钮。Server Action、Route Handler 和 RPC 会重复检查登录身份、房间成员、房主关系、题目状态、输入长度和积分。</span></div>
            <div><b>题目作用域隔离</b><span>AI 上下文、房间消息、事实和问答缓存都带有题目范围。切换题目时会再次比较 current_puzzle_id，避免旧题目的信息进入新题目。</span></div>
            <div><b>可恢复状态</b><span>Realtime 只承担低延迟通知；页面首次加载、重新连接或事件遗漏后，通过受保护的 bootstrap 接口补拉事实来源。访客则通过 HttpOnly Cookie 恢复房间身份。</span></div>
            <div><b>渐进式降级</b><span>没有 Supabase 环境变量时，部分页面仍可渲染但房间功能不可用；没有 GLM 时，问答等价判断和部分摘要功能跳过或回退，不把调试信息展示给玩家。</span></div>
            <div><b>缓存有门槛</b><span>缓存不是简单按相似字符串复用。系统排除代词、时间词、复合问题、低价值问题和非 yes/no 结果；字符 bigram 相似筛选后，还可以用 GLM 判断是否严格等价，新结果必须经管理员批准。</span></div>
            <div><b>隐私最小化</b><span>管理数据、模型密钥、内部 AI 审计字段和访客 token 不进入玩家响应。聊天备份、AI 错误案例和缓存管理限定在管理员服务端入口。</span></div>
            <div><b>可审计性</b><span>AI 请求保存模式、费用来源、状态、题目 ID 和完成时间；积分变化保存交易记录；管理后台还提供 AI 错误案例、缓存状态和聊天备份相关入口。</span></div>
          </div>
        </section>

        <section className="docs-section" id="security">
          <div className="docs-section-heading"><span>12</span><h2>身份与安全</h2></div>
          <ul className="docs-list">
            <li>登录态通过 Supabase SSR Cookie 刷新；身份判断使用服务端 claims / <code>auth.uid()</code>，不使用客户端可修改的 metadata。</li>
            <li>访客身份由 HttpOnly Cookie 证明：<code>guest_identity</code> 标识浏览器，<code>guest_room_&lt;CODE&gt;</code> 表示房间成员资格；数据库保存 token hash。</li>
            <li>私密表（如 <code>room_private</code>、<code>guest_sessions</code>、AI 请求）不授予浏览器直接读权限，成员数据由受保护 RPC 返回。</li>
            <li>账号在同一房间有设备会话锁；被其他设备接管后，旧设备应显示只读或跳转提示。</li>
            <li>管理后台需要管理员身份和二次验证；管理端导出、备份、缓存和批量操作只走服务端入口。</li>
          </ul>
        </section>

        <section className="docs-section" id="operations">
          <div className="docs-section-heading"><span>13</span><h2>运维入口</h2></div>
          <div className="docs-ops"><code>npm.cmd run dev</code><span>本地启动开发服务器</span><code>npm.cmd run typecheck</code><span>TypeScript 检查</span><code>npm.cmd run lint</code><span>ESLint 检查</span><code>npm.cmd run build</code><span>生产构建检查</span><code>supabase/migrations</code><span>按文件名顺序维护数据库变化；已部署迁移不修改，新增变化新建迁移</span></div>
          <p className="docs-small">环境变量以 <code>.env.example</code> 为准。密钥只允许服务端读取，不应提交到 Git、日志或页面。</p>
        </section>

        <footer className="docs-footer">文档状态：基于当前仓库代码与迁移整理。实现变化后，以代码、数据库迁移和真实验证结果为准。</footer>
      </main>
    </div>
  );
}
