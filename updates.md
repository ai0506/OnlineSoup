[Claude Code][260807010000] paper/ 追加 v2 验证（仍不改 deepseek.ts）：logprobs-verify-v2-no-reason.mjs 把 max_tokens 改 640、temperature 改 0.1、去掉 reason 字段后重测，10/10 未再截断；但去掉 reason 并未改变单次调用 ~100% 过度自信的现象，JSD 趋势与 v1 一致，结论写入 verification-summary.md
[Claude Code][260807000000] 新增 paper/ 目录做 DeepSeek logprobs 可行性独立验证（不改 deepseek.ts）：paper/scripts/logprobs-verify.mjs 实测 logprobs.content 可取、token 可定位、strict/inferential 两路 JS 散度可算且随问题清晰度合理变化；paper/verification-summary.md 记录结论，并发现意外坑——deepseek-v4-flash 会自发内部推理挤占 max_tokens，线上 ASK_MAX_TOKENS=320 在较难问题上有截断风险（4/10 命中），已用更大 max_tokens 复测验证根因
[Claude Code][260715134340] 更新过时文档：README.md 补充 RESEND_API_KEY/ADMIN_EMAIL_FROM/ZHIPU_API_KEY/ZHIPU_MODEL 等环境变量说明和 GLM 备用模型/管理端邮件/移动端三标签布局功能点；tasks.md（未纳入 git）勾选已完成的移动端竖屏三标签布局、自动深色模式、管理端筛选状态保留、GLM 备用模型项，更新下一步优先建议
﻿[Claude Code][260709230000] 事实总结展示调整：聊天气泡里提示(hint)和是/否回答(answer)底下用小字(.ai-message-fact)显示各自 fact_summary；题目面板事实板给来源为 hint 的条目加「提示」标签(.puzzle-fact-source)，room-chat 广播的 facts 由 string[] 改为 {text,source}[]，puzzle-panel 同步类型；补浅色/深色 CSS
[Claude Code][260709223000] 在 glm-fallback-model-plan.md 末尾追加「Claude Code 补充提醒」：AI_HOST_TOTAL_TIMEOUT_MS 需做成包住 ask 三次调用(并发两路+仲裁)+GLM fallback 的 wall-clock 总闸，且 15+12=27>25 的超时数字要对齐
[Claude Code][260709220000] 复核 Codex 的 GLM 备用模型拆分计划（ai-error/7-9/glm-fallback-model-plan.md），对照 deepseek.ts 与 ask/route.ts 实际代码，在文档末尾追加“Claude Code 复核意见”一节：指出验证第1条清空 key 会被 route.ts:128 的 503 拦截跑不出 fallback、DeepSeek 30s+GLM 15s 超时叠加、GLM 模型ID/response_format 需先验证等 6 条问题
[Claude Code][260709214500] 手机竖屏三段房间界面（聊天/题目/座位切换+常驻题面条）已提交并推送到 GitHub main（commit 171dfc6），仅 portrait≤760px 生效
[Claude Code][260705200250] ask 模式给严格/推断/仲裁三路判断各加一个内部 reason 字段（DeepSeek 输出，<=40字中文短句，说明依据哪条事实/示例问题下的判断），只写进 ask_audit 供管理端排查用；ask_audit 本就在两处 API 路由对玩家侧剥离，玩家消息不受影响，管理端页面新增展示原因文案，ASK_MAX_TOKENS 由 160 调到 320 以容纳新字段
[Claude Code][260627] 前端9项体验优化：通知自动消失+关闭按钮、弹窗背景点击关闭、聊天时间戳简化（今天只显示时:分）、字数计数器临近上限变红、积分显示tooltip说明、切换聊天模式保留内容（截断而非清空）、全站暗色模式支持
[Claude Code][260624] 细化积分不足提示：访客提示联系房主赠积分，注册用户提示注册送100积分且可邮件申请补充
[Claude Code][260623120000] 管理端发邮件表单新增发件人下拉（noreply/support@ai0506.com），后端校验白名单并传给 sendAdminEmail
[Claude Code][260621-260622] ask 模式 Q&A 缓存最终方案：新增 puzzle_qa_cache 表 + src/lib/qa-cache.ts（归一化/相似度/等价判断），ask route 调 DeepSeek 前先查缓存；只缓存「yes/no 且无代词」稳定问题，按 puzzle_id 全局查询，answer_type 约束收紧为 yes/no，补 RLS/权限，迁移已推送
[Claude Code][260620232648] 压缩 tasks.md：阶段六合并为简洁列表，阶段七补充个人主页/在线追踪/IP隐藏等已完成项，阶段八补充最新迁移，精简下一步建议
[Claude Code][260620191500] 管理端 AI 错误案例重构：整理卡片布局（题面/汤底折叠，AI 回答展示纯文本，状态彩色徽章），新增批量多选更新状态功能，新增导出 CSV（/admin/ai-errors/export），移除冗余函数
[Claude Code][260620175000] 管理端消息审计：询问标记错误按钮内联到摘要行；推理消息新增标记错误（对话框选 true/false）；消息审计和 AI 错误案例改为子标签切换；迁移放宽 ai_content→4000/correct_answer→2000 字符限制；已推送数据库和 GitHub
[Claude Code][260620150500] 减少 AI 上下文 token：recent context 改为最近 5 条玩家询问，uncovered points 合并最近 2 次推理结果
[Claude Code][260620145500] 提示模式：从最近一次推理结果提取未覆盖得分点，注入 hint prompt，让 AI 优先引导玩家朝未命中方向前进
[Claude Code][260620114200] AI 消息失败时在失败提示旁添加重试按钮（↺），点击后重新发送同一条消息并走正常积分判断流程
[Claude Code][260620091527] 管理员积分操作改为赠送/扣除模式：新增 admin_adjust_user_points RPC 和 points_transactions.note 字段，积分调整通过弹窗填写数量和备注，结果写入流水记录。
[Claude Code][260619222330] 修复账号删除后前端仍显示登录状态的问题：proxy.ts 中检测到 profile 行不存在时调用 getUser() 验证，账号已删除则强制登出并跳转登录页
[CodeX][260615] 加快聊天与积分刷新，临时积分改为跟随座位而非玩家；修复移动座位、座位同步、积分弹窗等房间交互问题。
[CodeX][260615-260616] 新增聊天模式（聊天/询问/提示/尝试推理），接入积分检查、二次确认、实时积分同步和数据库层速率限制。
[CodeX][260616] 新增题库系统：puzzles/puzzle_progress 表、开题/关题 RPC、题库面板、难度筛选、完成状态与 Realtime 同步。
[CodeX][260616] 管理端新增题库管理：新增、编辑、删除、关键点与示例问题编辑、整体导入/导出，并修复硬删除相关外键冲突。
[CodeX][260616] 接入 DeepSeek AI 主持：新增 /rooms/[code]/ask，支持询问/提示/推理、积分扣除与退款、结构化 JSON 落库和前端分块展示。
[CodeX][260616] 补齐 AI 上下文与安全边界：按 puzzle_id 隔离上下文、串行处理同房间 AI 请求、修复 service_role 权限、推理正确后回写 solved，并生成事实总结白板。
[CodeX][260616] 多轮优化 AI 判定：修复 JSON 截断、评分点字段读取、yes/no/irrelevant/ambiguous 规则、示例问答复用、事实总结不泄露额外真相等问题。
[CodeX][260616] 优化 AI 消息体验：新增事实/提示面板，推理成功自动播报汤底并关闭题目，询问结果按判定着色，前端改为乐观发送并显示回复状态。
[CodeX][260616] 管理后台新增消息审计和房间清理：支持查看 AI 审计数据、批量强制清理 stale 房间、删除聊天记录，并验证管理员 RPC 权限。
[CodeX][260616-260617] 持续更新 README、本地部署教程、tasks、AGENTS、CLAUDE 和文档索引，同步题库、AI、积分、部署与使用说明。
[CodeX][260617] 重构 DeepSeek prompt：缓存静态前缀，强化已知事实推理、irrelevant/ambiguous 判定、提示安全规则和 prompt 注入防护。
[CodeX][260617] 修复玩家侧接口泄露 ask_audit 的问题，审计数据仅保留给管理后台查看。
[CodeX][260617] 优化房间页移动端/平板体验：房间入口保留主机名，密码验证刷新不丢状态，房间详情与标签布局更适配窄屏和横屏。
[CodeX][260617] 将房间页高频整页刷新改为局部无感同步，降低兜底轮询频率，并把 URL 参数提示改为一次性 flash cookie。
[CodeX][260617] 新增提示机会系统：提问或推理累计获得提示机会，提示额外消耗积分和机会；修复失败消息状态、回复中动画和积分即时刷新。
[CodeX][260617] 修复 get_room_exit_reason 兜底 RPC 调用范围过宽、创建房间数字输入清空回填、推理模式 JSON 注入诱导等问题。
[CodeX][260617] 准备 GitHub/Vercel 部署：清理本地配置、更新 .gitignore/.gitattributes、移除误跟踪文档与 BOM，并记录生产域名和部署检查命令。
[CodeX][260617] 配置 Vercel 生产环境：设置 NEXT_PUBLIC_SITE_URL，修复注册和重置密码邮件跳转 localhost 的问题，完善邮件频率限制提示和失败日志。
[CodeX][260617-260618] 管理端支持无邮箱账户：管理员可创建用户名+密码账户、设置初始积分、修改用户密码；登录页兼容用户名登录。
[CodeX][260618] 修复管理员删除账户失败：捕获删除异常并清理关联房间 points_transactions，删除按钮与积分编辑布局同步优化。
[CodeX][260618] 修复密码重置流程：浏览器端接收 Supabase recovery hash，并改用 Supabase updateUser 更新密码，避免服务端页面提前拦截会话。
[CodeX][260617-260618] 新增并重构网站使用教程，按访客、房主管理、房主开题三类对象说明创建房间、AI 主持、积分和座位管理。
[Claude Code][260618105606] fix: move variantRule after askCommonRules in buildAskPrompt so inferential mode overrides the common ambiguous definition
[CodeX][260618105628] 管理端消息审计增加按当前筛选条件导出 CSV 的下载功能。
[Claude Code][260618111947] 新增 AI 错误案例收集：ai_error_cases 表迁移、createAiErrorCase/updateAiErrorCase server actions、消息审计标记错误表单、独立「AI 错误案例」tab（状态筛选+内联编辑），记录提问/AI 回答/题目故事快照
[CodeX][260618112627] 记录管理后台 UI 偏好：优先按钮进入二级界面，尽量不移动或扩大已有区域，不直接插入大表单
[CodeX][260618222611] 将题库示例问题拆分为事实模型和推断模型，并让 AI 两路判断只读取各自示例。
[CodeX][260618223142] 更新 DeepSeek 询问模式 yes/no/irrelevant/ambiguous 判定定义。
[Claude Code][260618224840] 重写网站使用教程：新增整体流程概览、角色对比表、注册引导（2.0节）、刷新身份恢复说明，修复"提出"错别字，并在7处关键操作标注截图建议。
[Claude Code][260618230800] 重写使用教程.html：改为与网站一致的浅色主题，顶部加 site-header，竖屏/窄屏侧边栏默认收起，点「目录」按钮展开。
[Claude Code][260618234514] 新增 /tutorial 页面：src/app/tutorial/page.tsx（客户端组件，含灯箱和竖屏侧栏收起）、public/screenshots/ 10张截图、globals.css 教程样式、site-header 加「教程」导航链接，已部署至生产环境。
[CodeX][260619151055] 管理端题目编辑支持示例问题上移下移及在事实/推断模型间移动。
[CodeX][260619152034] 在 AGENTS.md 和 CLAUDE.md 追加本地 Supabase 密码读取规则，仅引用 .env.local 变量名不记录密码值
[CodeX][260619-260622] 新增并持续强化 puzzle-example-generator skill：生成题库 fact/inferential 示例预览并校验 JSON，加入 boundary_type、禁止 key point 复读、跨模型近似重复校验、只读题库/缓存导出脚本、问答缓存审查流程、带日期预览命名，明确 examples 仅用于 ask 模式
[Claude Code][260619160121] admin: 新增房间总览标签页（活跃房间列表+强制关闭）、积分流水标签页（300条记录+类型/日期/用户名筛选）；消息审计加日期范围过滤
[CodeX][260619161957] 修复 Vercel 管理后台积分流水读取失败：补充 service_role 对 points_transactions 的权限迁移
[Claude Code][260619164935] 管理端消息审计标记错误改为弹窗交互：新建 AdminAiErrorForm 客户端组件，列表只显示「标记错误」按钮，点击弹出 dialog 填写正确答案和备注；修复 admin page.tsx 弯引号导致的 TS 编译错误
[Claude Code][260619170225] 管理端消息审计新增问答配对展示：room_messages 加 reply_to_id 字段，finish_room_ai_request 写入时填上对应提问消息ID，管理端在AI回复卡片内展示对应玩家提问
[Claude Code][260619180500] 拆分事实总结生成：DeepSeek 判定模型只返回 answer_type，yes/no 判定后独立调用 GLM-4-Flash-250414 生成 fact_summary；移除题库示例中 summary 字段；admin 表单同步清理总结输入框
[CodeX][260619181246] 修复教程页编码损坏导致的 JSX 乱码和页面不可用问题
[CodeX][260619181749] 修复异常游客房间 cookie 可能把 tutorial 等路径误识别为房间的问题
[CodeX][260619-260620] 收紧询问事实总结规则与防注入：GLM 增加玩家输入隔离、失败回退 DeepSeek 并显示来源；prompt 只用玩家问题/是否回答/已知事实，明确正反命题转换、保留主语人称视角、禁止额外推断，复杂复合问题返回 null
[Claude Code][260619184056] deepseek.ts: 在 ambiguous 规则中明确说明包含多个子问题或多个条件的复合问题应判定为模糊问题
[Claude Code][260619204558] AI错误案例编辑改为弹窗；缩小标记错误按钮；移除puzzle示例summary字段遗留引用；admin-ai-error-edit-form新组件。
[Claude Code][260619-260623] 修复 deleteUser、邮件确认/重置登录链路系列问题：deleteUser 各步骤补错误检查并改为 RPC 事务清理、授予 service_role 对 rooms/room_ai_requests 权限；auth callback / 首页 ?code= 转发使邮件确认自动登录生效；管理员重置密码邮件链接直达重置页避免 implicit hash 被服务端误判
[CodeX][260620152946] 设置汤局 logo 为网页 favicon 并加入公开图标资源（透明 logo 加白色圆形底，后改用 logo2.png 生成）
[CodeX][260620181035] 创建 SoupCoder Codex 宠物包并完成 spritesheet 验证
[Claude Code][260620181913] 新增个人主页：solved puzzles、积分流水（分页）、AI 统计；新增 RPC get_my_profile_page 和 get_my_points_history；header 用户名链接到 /profile
[Claude Code][260620182350] soften reason mode scoring rules: covered=true when concept is mentioned/identified as key, lean true when in doubt
[Claude Code][260620184520] 管理端 tab 从 7 个合并为 5 个（消息审计+AI错误案例、房间总览+房间清理各合并），消息卡片原始内容/审计详情/覆盖率改为 details 折叠展示
[CodeX][260620185310] 优化聊天区手机竖屏布局并记录测试账号
[CodeX][260620192331] 增加房间玩家在线/离线圆点、登录设备/IP记录和积分流水登录上下文字段；隐藏普通用户具体登录IP，仅显示登录地点并在管理端保留IP查看
[Claude Code][260620210712] 前端性能优化：room-chat.tsx 提取 memo 消息组件、新增 MODE_COST 常量、useLayoutEffect 实现 stable onRetry；live-room-seats.tsx 将 Intl.DateTimeFormat 提升为模块级常量、删除死 tab DOM；page.tsx 房间页 server 端串行 DB 调用重构为并行批次，减少约 2-3 个 RTT
[CodeX][260620220848] 收紧尝试推理 coverage prompt，按玩家最终明确立场判定关键点覆盖，强调关键词/accept 是重要证据但不能单独给分
[CodeX][260620231058] 优化房间页刷新频率：细化聊天消息、座位和货币单独查询频率，不同消息刷新相关联动，降低兜底轮询频率并同步提示机会
[CodeX][260620231703] 优化管理页 URL，筛选提交时移除空参数，切换后台 Tab 时清理无关筛选参数
[CodeX][260620232250] 修复 AI 失败退款回滚提示机会/提问次数，并将管理员删用户数据库清理改为 RPC 事务
[Claude Code][260622] 管理端问答缓存面板落地：每题「缓存 N」入口弹层，支持查看条目（问题/是否答案/命中次数/最近命中）、删除单条、是↔否翻转答案、编辑原文（同步重算 normalized_question）、清空整题缓存；新增 deleteCacheEntry/updateCacheAnswer/clearPuzzleCache server actions + AdminPuzzleCachePanel 组件 + globals.css 样式；授予 service_role delete 权限，已推送
[CodeX][260622101122] remove fact summaries from AI prompt context and keep recent Q&A only
[Claude Code][260622] CLAUDE.md 新增「AI错误分析与修复规划归档」规则；产出 ai-error/6-22 AI 判定错误修复规划（ClaudeCode/Codex 多版本，合并 ver2/ver3 修正复合句、否/无关边界和 fact_summary 范围），并按 ver3 实施 Phase1：deepseek.ts 收紧 ask/仲裁/reason 判定 + fact_summary 防污染
[Claude Code][260622133506] formatExamples 每组注入上限从 8 提升到 12
[CodeX][260622141002] 收紧 ambiguous 判定规则，修正哥哥示例并重新生成 ask-only 预览
[Claude Code][260622142255] 校验示例预览并上传 examples 到 Supabase（餐厅自杀/怀孕的哥哥/消失的她，仅更新 examples 字段）
[CodeX][260623] 新增单会话/房间级设备锁与管理端邮箱二次验证：单会话强制、多设备改为房间级设备锁、Supabase reauthentication 6→8 位验证码，修复验证回调与页面渲染期 cookie 变更，迁移已部署
[CodeX][260623124920] 新增管理端发邮件面板，基于 Resend 配置
[Claude Code][260623142514] 关闭房间整页跳转立即退出；创建房间后刷新顶部积分；默认房间名改为「房主名(截断5字)的房间」；横屏拆分门槛改为宽比例(min-width:880+aspect:6/5)；房间管理新增复制分享链接
[Claude Code][260623143245] 分享链接按钮移到房间码旁(紧凑样式+可换行)；加固在线状态：presence 重连/重新可见时重新 track，并始终把自己座位算作在线
[Claude Code][260623143652] 管理端二次验证新增「记住此设备」选项：勾选后写入 30 天设备 Cookie（HMAC 签名，只绑定 userId），再次进入管理端时优先检查设备 Cookie 免去重新验证
[Claude Code][260623161112] 多设备同账号房间接管：get_my_active_room 去 session 过滤、新增 take_over_room_session/is_my_seat_session_active RPC、can_use_room_session 改接管/只读检查；首页「返回房间」带 ?action=enter，SSR 收到时调接管 RPC，普通刷新 session 不匹配则以 room_displaced 提示回首页；LiveRoomSeats 定时+Realtime 自检 session，被挤出后跳回首页
[CodeX][260623193914] 上传新海龟汤《转回自己的邮件》到 Supabase 题库，包含评分点和示例问题
[CodeX][260623194949] 适配长汤面阅读体验，当前题目支持展开收起并限制预览弹窗高度
[Claude Code][260624084211] 去掉复制房间号按钮，房间码旁只保留分享链接按钮
[CodeX][260624] 重写并优化题目《回到我手里的邮件》：强化确认链接矛盾、降低邮箱转发技术门槛，合并/缩短 key_points 至 3-4 个核心点（3/4 覆盖即判正确），并适配新题面重做 18 条 examples（上传 Supabase）
[CodeX][260624091032] 调整房间海龟汤题面和事实总结展开收起体验，事实总结收起按钮固定到标题行
[Claude Code][260624092546] 整理 updates.md：删除题库示例迭代/skill 小调整/确认类等极小记录，合并 Q&A 缓存、AI错误案例、邮箱二次验证、多设备接管、回到我手里的邮件等同类簇，从 153 行压到约 84 行
[CodeX][260624093336] 放宽 AI 回复消息长度限制，修复 DeepSeek 推理回复写入超过 500 字导致 500 的问题
[Claude Code][260624093530] 房间聊天字数上限调整：普通聊天 500->300、询问 50->100、推理 200->300（提示仍 50），同步前端 room-chat、ask 路由与 send_room_chat_message/send_room_ai_request RPC
[Claude Code][260624102447] 项目体检修正过时内容：CLAUDE/AGENTS/tasks 字数上限同步为各模式（普通300/询问100/提示50/推理300），messages route schema 500→300 及报错文案改为模式无关，删除 tasks 已完成的“管理员积分改RPC”待办，CLAUDE/AGENTS RPC 表补全 open_puzzle/close_puzzle/send_room_ai_request/finish_room_ai_request，eslint globalIgnores 增加 .agents/tmp
[Claude Code][260624102816] 添加 ZHIPU_API_KEY 到 .env.local，启用 GLM-4-Flash 事实摘要提取
[Claude Code][260625140149] 修复多设备接管边界：leaveRoom 收到 room_device_in_use 时触发 room_displaced，修复 joinRoom 在 active_room_exists 和 room_device_in_use 的处理顺序
[Claude Code][260625222614] 精简 CLAUDE.md：删除重复内容、合并相关章节、去除过时实现细节
[CodeX][260625222415] 简化 AGENTS.md，移除易过时长清单并同步环境变量说明
[Claude Code][260626] deepseek.ts: 新增 SOI（Seen Or Implied）宽松判定机制；formatPoints 识别 accept 含 soi/seen or implied 时输出 [SOI] 标注，推理模式 prompt 新增对应规则；管理员在 Accept 字段输入 SOI 即可标记
[CodeX][260626111517] created id14 puzzle examples preview
[CodeX][260626111820] uploaded id14 puzzle examples to Supabase
[Claude Code][260626112006] 管理端消息审计新增「全量备份 JSON」按钮，新增 /admin/messages/backup 路由，忽略筛选导出全部房间元数据与聊天记录为结构化 JSON
[Claude Code][260626113121] 管理端「消息 & 案例」新增「聊天备份」子标签：按自然日(Asia/Shanghai)分组列出聊天记录，显示每天消息数与是否已下载，点击按日下载 CSV；新增 chat_backup_downloads 表与 admin_list_chat_backup_days / admin_mark_chat_backup_downloaded 两个 RPC，/admin/messages/backup 改为按 date 下载并标记
[Claude Code][260626115043] 修复5项真实代码问题：1.messageKey加30s时间桶防相同内容消息互相抵消；2.ask路由和messages路由同时剥离cache_hit内部字段不暴露给玩家；3.删除room-chat.tsx重复的profiles Realtime订阅改为监听personal-points-changed事件；4.管理端按activeTab按需加载listUsers/puzzles/cache/aiErrors/ptTxns五类数据；5.删除get_room_exit_reason旧签名兼容回退代码
[Claude Code][260626213931] fix: 管理端切换标签无法查看内容——在 selectTab 中为非 messages/rooms 的标签调用 router.refresh()，触发服务端按新 tab 重取数据
[CodeX][260627204016] 分析 6.26 AI error 案例，归档修复规划，并补充 reason 模式忽略清单自评标签的判定规则
[CodeX][260627204514] 为《绝望的题目》生成纯 fact 类型 examples 预览，覆盖“只写了最后一题”双模型误判为否的问题
[CodeX][260627205052] 已替换 Supabase《绝望的题目》fact examples，保留原 inferential examples，并验证线上题库为 7 fact + 4 inferential
[Claude Code][260627212006] 房间右侧面板整理：房间码加标签+居中复制/分享图标按钮，座位列表区分房主/注册/访客身份，去掉返回大厅按钮，切换标签锁定侧栏宽度
[Claude Code][260627213605] 深色模式去蓝：--navy 改为石板灰、按钮改为 slate-700、AI/标签等元素全面去除蓝色调；创建房间表单改为紧凑布局（500px 居中、座位数×积分双列、去掉冗余帮助文字）
[Claude Code][260627214510] 深色模式题目面板加深色背景覆盖；座位菜单操作按钮统一为 seat-menu-action-btn 样式并用 seat-menu-actions 分组，增加间距和分割线
[Claude Code][260627215537] 座位列表独立滚动：room-details-content 改为 overflow:hidden，room-manage-tab flex:1 撑满，seat-grid flex:1 + overflow-y:auto 独立滚动；puzzle-tab 同理
[CodeX][260627220316] 房间消息时间显示到秒，稳定消息排序，并新增轻量 Realtime 消息事件与积分 Realtime 迁移
[CodeX][260702162401] 修复 AI 主持请求因 DeepSeek thinking 参数卡住、超时过短和 ask 输出预算过低导致 502 的问题
[CodeX][260702163013] 固定房间聊天时间格式化为北京时间，修复生产环境 React hydration text mismatch 418 报错
[CodeX][260702163716] AI 询问改为 DeepSeek 双路判断部分成功即可返回，并降低 ask 输出预算，减少 30 秒超时导致的 502
[CodeX][260702164416] DeepSeek 503 过载时将 AI 询问降级为默认单路调用，失败再备用，减少并发请求导致的 502
[CodeX][260702164737] 按用户要求恢复 AI 询问两路并发交叉判断，保留一路成功可返回的容错逻辑

[Claude Code][260705185055] 清理本地目录冗余文件：删除根目录重复的 ai-errors CSV、questions.json 副本、过期 next-dev 日志、tsbuildinfo 缓存、重复 logo.png（与 public/ 内容一致的文件均已确认不被代码引用）

[Claude Code][260705185700] 提交清理：删除重复 logo.png，logo2.png 和旧版汤碗龟壳 logo 草稿移入新建 logo-archive/ 目录
[CodeX][260706013601] 新增静态宣传房间演示 HTML
[CodeX][260706014057] 调整静态房间 HTML：移除宣传文案，仅保留网站风格房间界面
[CodeX][260706014557] 将静态房间 HTML 改为引用项目全局样式并按真实房间组件结构复刻
[CodeX][260706014823] 按项目真实 AI 消息结构调整静态房间 HTML 的 AI 回复展示
[CodeX][260706015000] 按真实 AI 主持输出规则调整静态房间 HTML 的 AI 回复内容
[CodeX][260706144401] 将静态房间 HTML 内置项目 CSS 并移除暗色模式规则
[ClaudeCode][260708124622] file updated
[ClaudeCode][260708124629] file updated
[ClaudeCode][260708124642] file updated
[ClaudeCode][260708124651] file updated
[ClaudeCode][260708124656] file updated
[ClaudeCode][260708124706] file updated
[ClaudeCode][260708124713] file updated
[ClaudeCode][260708124725] file updated
[ClaudeCode][260708124731] file updated
[ClaudeCode][260708124745] file updated
[ClaudeCode][260708124757] file updated
[ClaudeCode][260708124805] file updated
[ClaudeCode][260708124811] file updated
[ClaudeCode][260708124819] file updated
[ClaudeCode][260708124831] file updated
[ClaudeCode][260708124845] file updated
[ClaudeCode][260708124851] file updated
[ClaudeCode][260708124910] file updated
[ClaudeCode][260708125039] file updated
[ClaudeCode][260708125045] file updated
[Claude Code][260708125145] 管理端体验优化(review项2/3/4/5)：筛选表单改用 router.push 避免整页刷新；写操作 redirect 改为保留操作前 URL(referer)的 tab/筛选参数不再丢失；消息/房间 tab 5秒轮询在输入框聚焦或弹窗打开时跳过；账户管理用户名/积分调整加乐观本地更新；账户/消息/AI错误案例/积分流水命中查询上限(1000/200/500/300)时显示提示文案
[CodeX][260709203952] 更新 AGENTS.md 和 CLAUDE.md，同步当前项目技术栈、AI 问答缓存、管理后台、多设备房间和 AI 错误归档规则
[ClaudeCode][260709204213] file updated
[ClaudeCode][260709204224] file updated
[ClaudeCode][260709204244] file updated
[ClaudeCode][260709204251] file updated
[ClaudeCode][260709204256] file updated
[ClaudeCode][260709210000] 修复房间页题目菜单弹出层被详情面板 overflow 裁剪/遮挡的问题，改为 Portal + 固定定位
[ClaudeCode][260709205624] file updated
[Claude Code][260709205634] 生成手机端房间 UI 4 套静态预览方案 onlinesoup_room_mobile_previews.html（未改动源码）
[ClaudeCode][260709210229] file updated
[Claude Code][260709210242] 生成方案 B 手机端房间可交互静态原型 onlinesoup_room_mobile_B_prototype.html（纯前端，无数据库）
[ClaudeCode][260709211039] file updated
[ClaudeCode][260709211058] file updated
[ClaudeCode][260709211107] file updated
[ClaudeCode][260709211114] file updated
[ClaudeCode][260709211142] file updated
[ClaudeCode][260709211149] file updated
[Claude Code][260709211213] B 原型细节修正：手机尺寸不随标签切换抖动、题库弹层固定高度、赠送积分/调整位置/移出房间改为二级弹窗
[ClaudeCode][260709212238] file updated
[ClaudeCode][260709212448] file updated
[ClaudeCode][260709212500] file updated
[ClaudeCode][260709212518] file updated
[ClaudeCode][260709212531] file updated
[ClaudeCode][260709212652] file updated
[Claude Code][260709213604] 落地方案 B 手机竖屏三段房间界面（信息栏+聊天/题目/座位导航+常驻题面条），仅 portrait≤760px 生效，横屏/平板/桌面零改动；改 live-room-seats/puzzle-panel/globals.css
[ClaudeCode][260709213813] file updated
[CodeX][260709215247] 生成 GLM 备用模型测试 Excel 表，包含真实 AI 错误案例和可填写评估列
[CodeX][260709215810] 生成带复制按钮的 GLM prompt 测试 HTML 页面，便于官网模型测试
[CodeX][260709220218] 生成竖版 GLM 测试 Excel，移除判定列并按模型逐行填写回答耗时和 token
[CodeX][260709220425] 生成横向分列 GLM 测试 Excel，每个模型拆分回答耗时和 token 三列
[CodeX][260709220635] 生成块状 GLM 测试 Excel，每个模型一列且回答耗时和 token 从上到下填写
[CodeX][260709223005] 新增 GLM 备用模型拆分计划文档，记录测试表现价格来源和代码改造方案
[CodeX][260709223941] 处理 Claude 对 GLM 备用模型计划的复核意见，补充超时预算API预检缓存策略和采纳结论
[CodeX][260709224436] 采纳 Claude 关于 ask 全链路 wall-clock 总超时的补充建议并更新 GLM fallback 计划
[CodeX][260709224620] 复查 GLM fallback 计划超时配置并标注 Claude 原提醒中的旧数字为修正前背景
[ClaudeCode][260709223630] file updated
[ClaudeCode][260709223640] file updated
[ClaudeCode][260709224224] file updated
[ClaudeCode][260709224240] file updated
[CodeX][260709230338] 实现 DeepSeek 主持问答/提示/推理失败时的 GLM fallback，并补充相关环境变量示例
[ClaudeCode][260709231732] file updated
[ClaudeCode][260709231745] file updated
[ClaudeCode][260709231755] file updated
[ClaudeCode][260709231800] file updated
[ClaudeCode][260709231805] file updated
[ClaudeCode][260709231812] file updated
[ClaudeCode][260709231823] file updated
[ClaudeCode][260709231828] file updated
[ClaudeCode][260709231834] file updated
[ClaudeCode][260709231954] file updated
[CodeX][260709232737] 修正 GLM fallback 为显式开关启用并为 reason 单独设置 DeepSeek 主超时
[CodeX][260709234910] 验证 Vercel GLM fallback 环境并为 GLM 请求关闭 thinking 模式
[ClaudeCode][260710000655] file updated
[ClaudeCode][260710000656] file updated
[ClaudeCode][260710000726] file updated
[ClaudeCode][260715134241] file updated
[ClaudeCode][260715134252] file updated
[ClaudeCode][260715134301] file updated
[ClaudeCode][260715134307] file updated
[ClaudeCode][260715134311] file updated
[ClaudeCode][260715141733] file updated
[ClaudeCode][260715141737] file updated
[ClaudeCode][260715141744] file updated
[ClaudeCode][260715141749] file updated
[ClaudeCode][260715141800] file updated
[ClaudeCode][260715142350] file updated
[Claude Code][260715142447] 移动端竖屏交互优化：房间页折叠全局站点头把顶部空间还给聊天区（消息区高度大幅增加）、放大聊天模式/发送/座位段触摸目标至40px、首页加入房间卡片竖屏垂直居中
[CodeX][260726135420] 整理工作区目录：归类文档、房间原型、题库快照和重复截图，并更新文档索引链接
[CodeX][260726135549] 补充整理后的项目资料索引，并修正迁移文档中的相对路径
[CodeX][260726140331] 核对教程截图引用并按当前移动端、AI、环境变量和安全功能更新项目文档
[CodeX][260726142417] 修复座位操作菜单被滚动容器裁剪的问题：通过 Portal 固定定位显示赠送积分、调整位置和移出房间
[ClaudeCode][260731190041] file updated
[ClaudeCode][260731190045] file updated
[ClaudeCode][260731190056] file updated
[ClaudeCode][260731190116] file updated
[ClaudeCode][260731190127] file updated
[ClaudeCode][260731190132] file updated
[ClaudeCode][260731190141] file updated
[ClaudeCode][260731190145] file updated
[ClaudeCode][260731190155] file updated
[ClaudeCode][260731190214] file updated
[ClaudeCode][260731190218] file updated
[ClaudeCode][260731190222] file updated
[ClaudeCode][260731190226] file updated
[ClaudeCode][260731190230] file updated
[ClaudeCode][260731190234] file updated
[ClaudeCode][260731190239] file updated
[ClaudeCode][260731190243] file updated
[ClaudeCode][260731190247] file updated
[ClaudeCode][260731190250] file updated
[ClaudeCode][260731190256] file updated
[ClaudeCode][260731190300] file updated
[ClaudeCode][260731190303] file updated
[ClaudeCode][260731190310] file updated
[ClaudeCode][260731190314] file updated
[ClaudeCode][260731190319] file updated
[ClaudeCode][260731190325] file updated
[ClaudeCode][260731190331] file updated
[ClaudeCode][260731190335] file updated
[ClaudeCode][260731190338] file updated
[ClaudeCode][260731190343] file updated
[ClaudeCode][260731190354] file updated
[ClaudeCode][260731190357] file updated
[ClaudeCode][260731190402] file updated
[ClaudeCode][260731190523] file updated
[ClaudeCode][260731190530] file updated
[Claude Code][260731191500] 新增用户反馈功能：独立 /feedback 页面（仅注册用户，5 类含投稿汤，2000 字，每账号每天 3 条限流），user_feedback 表与 submit_user_feedback/admin_update_feedback RPC，后台新增用户反馈 tab 支持状态流转与筛选
[ClaudeCode][260731191156] file updated
[ClaudeCode][260731191200] file updated
[ClaudeCode][260731191212] file updated
[ClaudeCode][260731191223] file updated
[ClaudeCode][260731191244] file updated
[ClaudeCode][260731191254] file updated
[ClaudeCode][260731191311] file updated
[Claude Code][260731193000] 教程补充意见反馈与投稿汤章节：/tutorial 页面新增第 7 节和 2 条 FAQ，常见问题改为第 8 节，同步更新 docs/guides/网站使用教程.md 和 使用教程.html
[ClaudeCode][260731191841] file updated
[ClaudeCode][260731191845] file updated
[ClaudeCode][260731191849] file updated
[ClaudeCode][260731192010] file updated
[ClaudeCode][260731192015] file updated
[ClaudeCode][260731192019] file updated
[ClaudeCode][260731192024] file updated
[ClaudeCode][260731192046] file updated
[ClaudeCode][260731192059] file updated
[ClaudeCode][260731192104] file updated
[ClaudeCode][260731192108] file updated
[ClaudeCode][260731192117] file updated
[Claude Code][260731194500] 修正未登录进入 /feedback 时误显示创建房间提示（新增 login_required_feedback 文案），并同步更新 CLAUDE.md、AGENTS.md、tasks.md、README.md 中的用户反馈说明
[ClaudeCode][260731192252] file updated
[ClaudeCode][260731192255] file updated
[ClaudeCode][260731192259] file updated
[Claude Code][260731195500] 修正未登录访问 /account/username 时误显示创建房间提示（新增 login_required_username 文案）
[ClaudeCode][260731205447] file updated
[ClaudeCode][260731205453] file updated
[ClaudeCode][260731205458] file updated
[ClaudeCode][260731205513] file updated
[ClaudeCode][260731205525] file updated
[Claude Code][260731205656] 管理端性能与排版优化：消息/清理房间/活跃房间查询补上 tab 判断，未加载 tab 不再显示错误的 0 徽章，新增后台响应式样式
[ClaudeCode][260731210140] file updated
[ClaudeCode][260731210151] file updated
[ClaudeCode][260731210717] file updated
[ClaudeCode][260731210823] file updated
[Claude Code][260731211551] 新增仅本地生效的开发用管理员账号（凭据不入库），并修复管理端移动端横向溢出：admin-tabs-shell 子 section 加 min-width:0、长邮箱换行、账户卡片操作区窄屏改单列
[ClaudeCode][260731211607] file updated
[ClaudeCode][260731211616] file updated
[ClaudeCode][260731212013] file updated
[ClaudeCode][260731212022] file updated
[ClaudeCode][260731212028] file updated
[CodeX][260805150642] added computer-migration handoff and file transfer inventory
[CodeX][260805151000] corrected handoff framework version from verified production build
[Claude Code][260806123600] 管理后台：切 tab/子 tab 显示加载状态而非空结果，消息 tab 按子 tab 收紧取数，AI 错误案例改服务端筛选，账户 profiles 并行查询，轮询降到 10 秒
[Claude Code][260806190751] 房间清理改为先归档再删除：新增 room_messages_archive 表，admin_force_close_and_clear_room 归档后删消息，聊天备份统计与 CSV 导出合并归档数据
[Claude Code][260806205755] 待清理房间规则重做：改以最后消息时间为基准（已关闭 3 天 / 未关闭 7 天），排除 0 消息房间以消除反复上榜的死循环，新增 backup_pending 标记且未备份房间默认不勾选
[CodeX][260814202119] 通过 Homebrew 安装 Python 3.14.7，并确认 python3 与 pip3 已指向 /opt/homebrew/bin
[CodeX][260814202352] 通过 Homebrew 安装 PyCharm 2026.2.1 到 /Applications/PyCharm.app，并启用 pycharm 命令行启动器
[CodeX][260814204050] 为 OnlineSoup 创建独立 Python 3.14.7 虚拟环境 /Users/shuwenai/Desktop/Projects/OnlineSoup/.venv，待 PyCharm 窗口恢复焦点后选择该解释器
[CodeX][260814204950] 在 paper/runner.py 新增独立 DeepSeek 受控实验跑批脚本：支持 test 或按 G1/G2/G3 选择 API key、两阶段串行调用、断点续跑、重试、JSONL 原始结果、prompt 留痕、manifest 和 summary；新增 paper/README.md 与敏感输出忽略规则
[CodeX][260814205300] 按 DeepSeek 官方文档将 paper/runner.py 的 HTTP 调用改为 OpenAI Python SDK，保留 JSON Output、usage/cache tokens、finish reason 和完整 SDK 响应留痕；确认 paper/questions_v8.tsv 101 行、paper/puzzles.json 5 个谜面可读取
[CodeX][260814205500] 新增被 git 忽略的 paper/api_keys.env 本地 key 文件，runner.py 自动读取并按 test 或 G1/G2/G3 profile 选择 key，环境变量优先且 key 不写入日志或 manifest
[CodeX][260814230000] 将受控实验默认 thinking 设置为 disabled，通过 OpenAI SDK extra_body 传入；保留 max_tokens=640，并把 thinking 配置写入 manifest 与调用记录
[CodeX][260814231500] 新增 paper/score_results.py，按 QA/QB/QC/QD/QE 分类规则离线判定 calls.jsonl，输出逐条 score_details.jsonl 与分组 score_summary.json
[CodeX][260814232000] 修正 G2 neutral_a/neutral_b 仲裁 prompt 标签，区分 G2 与 G3 仲裁样本文件，并在判分汇总中增加 group|variant 维度
[CodeX][260814233000] 加强跑批截断防护：finish_reason=length 无论 JSON 是否可解析都触发重试，耗尽后记 failed，并记录 reasoning_tokens 与截断计数
[CodeX][260814234000] 为 runner.py 增加 PyCharm Terminal 实时进度输出、重试提示和结束汇总，所有 stdout 输出即时 flush
[CodeX][260814234500] 统一论文分析入口为已有的 paper/analyze_results.py，使用题目级预注册指标 UER/CDR/OIR/RFR、divergence 与数据完整性报告，不再将旧 score_results.py 作为主分析
[CodeX][260815001000] 将 DoubleAgent 最新 analyze_results.py 的 system_fingerprint 完整性检查与成本分析移植到 OnlineSoup paper/analyze_results.py，新增实际成本、独立部署成本和暖缓存下界
[CodeX][260815083000] 按 DoubleAgent 当前版本补齐 blind/anchored 按 divergent 子集分层、McNemar 配对检验和正式分析输出；已重新生成 formal-v1/analysis.json
[CodeX][260815001500] 将实验配置统一为所有正式与 pilot run 使用 DEEPSEEK_API_KEY_TEST，README 更新正式实验命令与 token 成本计算说明
[CodeX][260815003000] 按最新确认将正式实验 key profile 改为 G1，保留 pilot 使用 test key；未启动任何实验调用
[CodeX][260815091149] 新增 paper/anchoring_divergence.html 静态分歧展示页，内嵌 10 道题与 32 个分歧轮次的原题、expected answer、各组答案及 reason，无需上传实验数据
[CodeX][260815091451] 将分歧展示页改为简洁可读样式，移除深色渐变、大面积装饰和阴影，改用白底、低饱和标记与清晰分组
[CodeX][260815132553] 将 questions_v8.tsv 的 P3-QD4 expected 从 no 修正为 yes，并重新生成 formal-v1 的 analysis.json、item_metrics.jsonl 与 anchoring_stability.json
[CodeX][260826232713] 新增 /docs 技术说明页，补充技术栈、数据流、房间规则、AI 主持、身份安全和运维入口；新增站点导航并允许无用户名登录用户访问
[CodeX][260826232713] 按要求移除站点导航中的技术文档入口，避免提供跳转到 /docs 的 href；扩充路由、数据模型、AI 状态机和失败补偿技术细节
[CodeX][260826232713] 扩充技术特点与设计取舍说明，增加数据库原子性、服务端优先、题目隔离、可恢复性、渐进式降级、缓存门槛、隐私最小化和可审计性；/docs 强制浅色模式
[CodeX][260826232713] 将浅色模式变量提升到包含站点头部的 docs 页面 body 范围，确保系统深色模式下导航、背景和文档内容均保持浅色
[CodeX][260826232713] 详细补充题库字段、key_points/examples 作用，以及 ask 双路判断、hint 引导机制、reason 关键点评分和对应的积分与失败处理规则
[CodeX][260828171932] 将项目特点前置并扩充为独立章节，说明多人房间、AI 主持、访客参与、房间积分、共享事实白板、题库上下文、实时恢复和管理员质量控制；保留实现层技术取舍说明
[CodeX][260829213257] 新增站内通知功能计划，明确管理员全体或指定注册用户通知、主页已读状态、私有表与受保护 RPC、验收项，以及不涉及邮件、推送和访客离线通知
[CodeX][260829214319] 新增用户档案与好友功能计划，基于现有 profiles、房间成员、通知和账户删除流程规划预设头像、最小公开档案及分阶段好友申请
[CodeX][260829214745] 更新用户档案与好友计划：好友改为顶部图标打开的同页二级抽屉，并规划全局头部的图标化、可访问性和服务端数据加载边界
[Claude Code][260829214954] 修复深色模式 24 处未覆盖样式：新增 color-scheme 与 ::placeholder 规则；补齐竖屏房间页、教程页、题库徽章、积分语义色与后台浅底区块的深色覆盖；tutorial 页三处内联颜色改为 class
[Claude Code][260829215630] 顶部菜单栏改为线性描边图标：新增 src/components/icons.tsx，site-header 与 logout-button 换用图标（积分/用户名保留文字），globals.css 补 .nav-icon/.nav-account 样式与 44px 点击区和窄屏收缩
[Claude Code][260829220107] 顶部菜单栏窄屏修复：品牌禁止折行，520px 以下隐藏首页图标与积分币图标并收紧间距，解决登录态在 375px 下溢出裁切；登录图标箭头方向修正为指向门内
[Claude Code][260829221704] 顶部栏交互重做：退出登录移入账户悬停菜单（含用户名与积分），nav 拆为客户端组件 site-nav.tsx，用自定义悬停面板替换原生 title 提示（普通项 100ms 展开/80ms 关闭，账户项 600ms 关闭），窄屏积分改在账户菜单显示并保留首页图标
[Claude Code][260829222522] 顶部栏展开层修正：展开状态提升到 SiteNav 统一管理，同时只允许一个展开层；积分移出账户容器（悬停积分不再展开或维持账户菜单），改用独立分隔线；账户菜单拆为"个人资料"和"积分流水"两个按钮，暂均指向 /profile
[CodeX][260829222918] 修订 /tutorial 玩家教程文字：补全全站唯一用户名和邮箱验证、推理正确后的公布汤底与自动结束、AI 请求不排队且需重试的真实行为；统一手机端「题目」命名，优化角色积分说明、移动座位、姓名冲突和事实总结表述
[CodeX][260829223444] 个人资料页积分流水改为固定 292px 的最近 5 条预览并新增“查看全部”入口；新增 /points-history 完整分页页面，账户菜单同步指向该页面
[CodeX][260829224324] 新增仅适用于 OnlineSoup 的 FRONTEND_SPEC.md，明确聊天不中断、稳定布局、房间横竖屏、积分列表、管理端刷新与可访问性要求，并加入文档索引
[CodeX][260829224853] 将 FRONTEND_SPEC.md 的界面稳定原则扩展为全站约束，明确标签、筛选、选项、空加载错误态和滚动容器切换均不得造成大幅变形、位移或跳转
[Claude Code][260829225154] 顶部栏对齐 FRONTEND_SPEC：窄屏触控区恢复 44x44，展开面板关闭态改 visibility 隐藏移出 Tab 顺序，账户菜单补焦点管理（点击打开进入首项、Escape 回到触发按钮、悬停不抢焦点），补 prefers-reduced-motion 降级与 user-select/focus-visible，清理窄屏重复的 .user-points 与失效的 .nav-account 规则
[Claude Code][260829225827] 顶部栏新增房间态图标：SiteHeader 调用 get_my_active_room，存在未关闭房间时把"创建房间"加号换成门图标并直达 /rooms/{code}，提示显示房间码；icons.tsx 新增 IconDoor
[Claude Code][260829231941] 整理根目录：HANDOFF.md 与 FILE_TRANSFER_LIST.md 移入 docs/handoff/ 并加归档说明，logo-archive/ 移入 archive/logo-archive/；文档索引补登两处新位置并修复两份规划文档脱离主表的表格格式；.agents/skills 与 dev.ps1 保留
[Claude Code][260830001606] 修正 /docs 技术说明页：询问字数上限 50 改为实际的 100（对齐 ask/route.ts 与数据库 max_length），路由表补齐 /profile、/points-history、/feedback、/tutorial、/docs 五条，运维命令去掉 Windows 专用的 .cmd 后缀
[CodeX][260903122210] 新增临时 /debug/network-test 网络性能测试页及 no-store Route Handler：并行测量 Next.js 往返、Supabase REST SELECT、只读 is_username_available RPC、Auth 用户请求和 Realtime 建连，提供 Run once/Run 20 tests、latest/average/min/max/p95/failures 统计及 JSON 复制导出；Realtime 不写业务数据。
[CodeX][260904122549] 新增安全房间清理迁移：清理前保留仍被 room_ai_requests 或 room_message_events 引用的消息，避免级联删除其它引用；清理候选只统计实际可删除的消息，并返回保留消息数量；不恢复历史数据、不修改个人资料统计。
