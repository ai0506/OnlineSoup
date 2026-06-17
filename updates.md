1	[CodeX][260615] 加快聊天与积分刷新，临时积分改为跟随座位而非玩家；记录 Session Pooler 部署流程到 CLAUDE.md。
2	[CodeX][260616] 新增并持续维护 tasks.md（按阶段拆分项目功能与完成状态）和文档索引.md（汇总仓库 Markdown 用途），随功能进展同步更新。
3	[CodeX][260615] 新增聊天模式标签（聊天/询问/提示/尝试推理），含积分检查、二级确认对话框和实时积分同步。
4	[CodeX][260615] 修复注册玩家移动座位触发唯一索引冲突的问题并部署迁移；同步修复移动座位后的全员座位同步、聊天积分座位跟随、座位菜单展开/关闭和积分不足弹窗等细节。
5	[CodeX][260615-260616] 新增题库系统（puzzles/puzzle_progress 表、种子题目、开题/关题 RPC）及 PuzzlePanel 组件（题库列表、预览确认、切换/停止确认、难度筛选、完成状态标签），Realtime 同步当前题目。
6	[Claude Code][260616] 修复 open_puzzle RPC 多次报错（owner_seat 空值检查缺失、参数名与表列名歧义 42702），最终改为 p_puzzle_id 参数名并重建函数。
7	[CodeX][260616] 修复房间页组合积分（个人+临时）的数据流和 Realtime 补拉问题，确保送分、换座后积分显示同步。
8	[Claude Code][260616] 房间页右侧拆分为"房间管理/海龟汤"标签页，并修复标签切换导致 PuzzlePanel 卸载丢状态、退出/关闭按钮布局错位、CSS 优先级导致 hidden 失效等问题；题目弹窗统一尺寸并改用 Portal 挂载。
9	[Claude Code][260616] 普通聊天新增数据库层速率限制（每秒2条/每分钟40条），并修复因列名与参数名歧义导致的限流报错。
10	[CodeX][260616] 管理端新增题库管理功能并持续迭代：新增/编辑/软删除→硬删除题目、关键点与示例问题逐项编辑、列表/编辑面板布局优化、URL 状态保持。
11	[Claude Code][260616] 修复题目硬删除时的外键冲突（room_ai_requests、rooms.current_puzzle_id、room_messages.puzzle_id 均需处理），删除操作改为弹窗二次确认。
12	[Claude Code][260616] 修复房主关闭房间时被误判为"被踢出"的问题：改用不受 RLS 限制的 get_room_exit_reason RPC 确认真实退出原因。
13	[Claude Code][260616] 修复题库评分点失效问题：AI 评分逻辑误读旧的 points 列，改为读取管理后台实际使用的 key_points 列，并清理废弃列。
14	[CodeX][260616] 接入 DeepSeek AI 主持：新增 /rooms/[code]/ask 路由、积分扣除/退款迁移，聊天区询问/提示/推理改为真实 AI 调用；按官方模型名修正为 deepseek-v4-flash；AI prompt 按询问/提示/推理分别注入示例与评分点，结构化 JSON 落库与前端分块展示。
15	[Claude Code][260616] 补齐 AI 上下文：从历史 AI 消息提炼"已知事实"和"已给提示"注入 prompt；按 puzzle_id 隔离上下文避免切题串题；同房间 AI 请求加锁顺序处理；修复 room_messages 表从未对 service_role grant 导致服务端读取上下文静默失败的问题。
16	[Claude Code][260616] 修复推理判定正确时未回写 puzzle_progress.solved 的问题，及事实总结白板从未读取真实数据（一直显示占位文案）的问题，改为从当前题目 AI 消息提炼并广播。
17	[Claude Code][260616] 修复"尝试推理"偶发 JSON 解析失败：thinking 模式占用输出预算导致 JSON 被截断，调大 max_tokens 并最终关闭 reason 模式的 thinking。
18	[Claude Code][260616] 核对线上题库与 questions.json 一致性（确认无数据丢失），新增题库整体导入/导出功能（admin_replace_all_puzzles RPC + 导出路由 + 导入表单）。
19	[Claude Code][260616] 优化 DeepSeek 询问模式的 yes/no/irrelevant/ambiguous 判断规则，减少误判。
20	[Claude Code][260616] 更新 README.md、本地部署教程.md、tasks.md、AGENTS.md、CLAUDE.md 以同步最新功能进度（题库、AI 主持、积分系统等），修正文档间的过时描述。
21	[Claude Code][260616204854] 新增"已获得提示"实时面板；推理判定正确后自动发送汤底系统消息并关闭题目（同步刷新题库列表完成状态）；AI 消息头部精简为与玩家消息一致；询问/提示/推理改为乐观发送，消息立即显示并在下方展示"回复中.../发送消息失败，已退还积分"状态，不再等待 AI 回复才更新界面。
22	[CodeX][260616215833] 新增 questions_2606162200.json，包含原始两题和三道新海龟汤题目草案。
23	[Claude Code][260616215943] AI 主持回复/提示不再展示行内事实总结，统一归入"事实总结"列表（提示也转为陈述句格式，移除单独的"已获得提示"列表）；推理成功结算拆为系统播报消息（含推理者姓名/座位/身份）+ 与 AI 消息同样式的汤底展示框；询问消息气泡按 AI 判定结果（是/否/与此无关/模糊问题）着色为半透明绿/红/黄/紫。
24	[CodeX][260616221226] 管理后台新增消息审计和房间清理标签，增加管理员清理房间 RPC，可强制关闭 stale 房间并删除聊天记录。
25	[CodeX][260616221548] 已通过 Supabase Session Pooler 推送后台消息审计与房间清理迁移，并验证管理员 RPC 权限。
26	[CodeX][260616222557] 房间清理改为批量全选/多选后直接强制清理，推理结果 AI JSON 增加评分点 coverage 并在后台消息审计展示 true/false。
[CodeX][260616223435] 修复后台标签页 key 警告，并调整房间清理 RPC，清理后的已关闭房间不再立即出现在待清理列表。

[Claude Code][260616223910] 修复 DeepSeek ask 模式提示词：fact_summary 现在只能复述问题本身的是/否判断，禁止补充问题之外来自真相的额外信息。
[Claude Code][260616223910] 修复 hint/ask/reason 模式的 prompt 注入漏洞：玩家输入统一用 <player_input> 标签包裹并声明绝非指令，防止玩家用「忽略上述提示词」之类的话让 AI 直接吐出完整汤底。
[CodeX][260616224221] 后台消息审计标签增加 5 秒自动刷新，并将管理页标记为动态渲染以避免清理后的旧聊天记录残留显示。
[Claude Code][260616225019] 修复 ask 模式：当玩家问题与题目自带示例问答完全一致或明显改写时，强制复用示例的 answer_type 和 summary，避免 AI 对题库已写明的问题给出不一致的判断（如「哥哥真的怀孕了吗」被误判为与此无关）。
[CodeX][260616230533] 修复切题后 AI 请求可能沿用旧题目的问题：前端发送期望题号，服务端在调用 AI 前后核对当前题目并在错位时退款取消，同时前端主动刷新题目状态
[Claude Code][260616231120] ask 模式判断准确性优化：1) 把 key_points 作为权威隐含事实注入 ask/hint 共享提示词；2) ask 模式改为「严格字面」与「积极推理」两个风格不同的 prompt 并发判断，一致直接采用，不一致再触发仲裁调用决定最终答案，不开 thinking 避免重蹈 max_tokens 截断的旧问题。
[CodeX][260616231554] 后台消息审计展示询问模式的严格模型、推断模型和最终模型回答
[CodeX][260616232104] 巡检项目文档并更新 tasks.md：补齐 AI 推理揭底、后台消息审计、房间清理等已完成功能，新增后续可改进建议
[Claude Code][260617] 重构 DeepSeek prompt 结构：将静态内容（汤面/汤底/评分点/题目示例/规则）前置为可缓存前缀，known facts 和 recent messages 移至末尾，利用 DeepSeek 自动前缀缓存降低重复询问的 token 消耗。
[CodeX][260617124402] 后台消息审计增加询问模式筛选，并结构化展示 AI 询问最终回答、严格/推断/仲裁结果和事实总结。
[CodeX][260617124940] 将本地站点地址改为局域网 IP，方便平板访问开发服务器
[CodeX][260617125207] 修复房间密码验证后刷新会退回密码输入界面的问题
[CodeX][260617125839] 修复房间入口跳转保留当前主机名，并优化平板房间详情与聊天模式布局
[CodeX][260617130114] 调整横屏平板房间布局，默认展开房间详情并仅在更宽桌面使用右侧栏
[CodeX][260617130644] 修正AI询问判定提示，强调存活/死亡状态问题应按事实输出是/否，并让仲裁复用通用判定规则
[CodeX][260617130809] 将AI询问判定从存活死亡特例改为通用事实命题蕴含规则，降低过拟合风险
[Claude Code][260617131507] 修复 AI 推断层（inferential）未利用已知事实做单步逻辑推导的问题：「同伴被吃了」→「同伴死了」→「否」，而非「与此无关」；同时加强 askCommonRules 中已知事实不得被 irrelevant/ambiguous 覆盖的规则
[Claude Code][260617132300] 从根本上重定义 irrelevant 语义：不再是「不影响真实答案」，而是「无法从真实答案、权威隐含事实、已确认已知事实中推出 yes/no，且故事中根本没有涉及该主题」，避免已知事实能推导出的问题被误判为与此无关
[Claude Code][260617142216] 修复 ask_audit 信息泄露：在 GET /messages 和 POST /ask 路由的响应出口处过滤掉 ask_audit 字段，数据库保留完整审计数据供管理后台使用，玩家侧 API 不再暴露内部仲裁过程。
[Claude Code][260617142637] 收紧 summary 规则：禁止在回答中添加括号式角色描述（如「同伴」「医生」）等问题未涉及的额外信息，summary 只能复述玩家问题的最小命题。
[CodeX][260617144204] 修复创建房间数字输入清空自动回填与移动端房间标签滚动问题
[CodeX][260617144448] 将房间管理与海龟汤标签移出详情滚动区以修复竖屏切换不可见
[CodeX][260617145922] 修复推理模式可通过 JSON 输出指令诱导 AI 判定全覆盖的问题，并转义玩家输入防止 prompt 围栏逃逸。
[CodeX][260617150746] Removed BOM from .env.local and expanded Git ignore rules for safe GitHub upload
[CodeX][260617150946] Added Git attributes and prepared repository for GitHub commit
[CodeX][260617151318] Removed accidental TurtleSoup branch and prepared OnlineSoup GitHub upload
