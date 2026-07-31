# OnlineSoup（汤局）功能任务拆分

> 本文件按当前代码和已提交迁移维护功能状态；最近核对：2026-07-26。设计稿、线上数据库和部署配置与本文件冲突时，以实际代码、迁移和实测结果为准。

---

## 阶段一：基础用户系统 ✅

**目标**：账户注册、登录、退出、密码重置，以及用户名管理。

- [x] 邮箱注册 / 登录 / 退出（`src/app/auth/`）
- [x] 密码重置流程（`src/app/reset-password/`）
- [x] 历史账户首次补设用户名（`src/app/account/username/`）
- [x] 全局唯一用户名、忽略大小写判重（迁移 `20260615022623`）
- [x] 用户名格式验证：3–8 位字母/数字/下划线（`src/lib/validation.ts`）
- [x] 在活动房间内禁止修改用户名

---

## 阶段二：积分系统 ✅（含聊天积分扣除）

**目标**：个人积分、房间临时积分、创建/关闭房间时的积分流转。

- [x] `profiles.points` 个人积分字段
- [x] `room_seats.remaining_points` 座位临时积分
- [x] 创建房间时扣除积分（`points_per_seat × seat_count`，允许为 0）
- [x] 关闭房间时退还所有座位剩余积分给房主（`close_room` RPC）
- [x] 积分显示格式：`个人积分+房间积分[临]`（`src/components/live-room-seats.tsx`）
- [x] 房主赠送个人积分给指定座位（`gift_points_to_seat` RPC）
- [x] 管理员手动增减用户积分（`src/app/admin/`）
- [x] 积分变动写入 `points_transactions` 表
- [x] 聊天模式（询问/提示/尝试推理）发送时自动扣除座位积分，不足时可切换扣个人积分（`send_room_chat_message` RPC，迁移 `20260615142323`）
- [x] 座位方块角标实时显示临时积分
- [x] 积分不足时弹出站内提示框，显示当前余额

---

## 阶段三：房间核心流程 ✅

**目标**：创建房间、加入/退出/踢人、房间状态同步。

- [x] 创建房间（`create_room` RPC，原子扣积分 + 建房 + 建座位）
- [x] 可选房间密码（`room_private` 表）
- [x] 登录用户加入房间（`join_room_as_member` RPC）
- [x] 游客加入房间（`join_room_as_guest` RPC + HttpOnly Cookie）
- [x] 刷新页面后游客身份恢复（`verify_guest_membership` RPC）
- [x] 加入新房间时自动退出/关闭旧房间（`auto_leave_previous_room`，迁移 `20260614142118`）
- [x] 主动退出房间（`leave_room_as_member` / `leave_room_as_guest` RPC）
- [x] 房主踢出玩家（`kick_guest` RPC + `get_room_exit_reason` RPC）
- [x] 房主关闭房间（`close_room` RPC）
- [x] 房主移动玩家座位（`move_seat` RPC）
- [x] 大厅页面自动恢复当前活动房间（`get_my_active_room` RPC）

---

## 阶段四：实时同步 ✅

**目标**：座位状态、消息、积分的实时推送与轮询兜底。

- [x] Supabase Realtime 订阅 `room-seats:<roomId>`（`src/components/live-room-seats.tsx`）
- [x] Realtime 订阅 `room-messages:<roomId>`（`src/components/room-chat.tsx`）
- [x] Realtime 订阅 `profiles` 表实时更新个人积分
- [x] 轮询兜底：座位每 3 秒同步，消息每 2 秒刷新
- [x] 页面重新可见 / 获焦 / 上线时触发同步
- [x] 订阅断开时自动补拉最新状态

---

## 阶段五：聊天系统 ✅

**目标**：房间内成员聊天，系统消息，消息鉴权。

- [x] 发送聊天消息（`send_room_chat_message` RPC，各模式字数上限：普通 300 / 询问 100 / 提示 50 / 推理 300）
- [x] 读取近 100 条历史消息（`get_room_chat_bootstrap` RPC）
- [x] 消息读写经过 `/rooms/[code]/messages` 服务端路由鉴权
- [x] 系统消息（加入/退出/踢人/赠分/移座 等事件）
- [x] 消息按创建时间 + ID 稳定排序
- [x] 聊天模式标签：聊天 / 询问（1pt）/ 提示（1pt）/ 尝试推理（2pt），含二级确认对话框（`src/components/room-chat.tsx`）
- [x] 不同模式消息在聊天气泡上有样式区分
- [x] 多行消息展示与输入换行（`Shift+Enter`）支持（`src/components/room-chat.tsx`）
- [x] 发送失败、积分不足、发送太频繁等提示使用站内弹窗，不使用浏览器原生弹窗
- [ ] **待做**：消息内容增强（表情快捷输入、Markdown/链接识别等）
- [x] 未开题时 AI 模式按钮使用禁用态 `title`，提示文字在已开题时隐藏，避免持续撑高聊天框布局

---

## 阶段六：题库与 AI 查询 ✅

**目标**：海龟汤题库管理，房主开题/切题，玩家向 AI 提问消耗积分。

- [x] `puzzles` 表 + `puzzle_progress` 表 + 9 道题种子数据
- [x] RPC：`get_puzzle_list`、`get_room_current_puzzle`、`open_puzzle`、`close_puzzle`
- [x] 管理员题库：新增、编辑、软删除、整体导入/导出（`admin_replace_all_puzzles`）
- [x] 房间开题：选题弹窗、难度筛选、切题/关题二次确认，Realtime 实时推送
- [x] AI 问答：Route Handler `/rooms/[code]/ask`，鉴权→扣积分→DeepSeek→写消息
- [x] 推理评分：AI 返回关键点 `covered: true/false`，服务端计算正确/部分/不正确
- [x] 推理正确时自动公布汤底、停题、写通关记录（`puzzle_progress.solved`）
- [x] 事实总结公共白板：从本题 AI 消息提取去重后的 `fact_summary`，广播给题目面板实时展示
- [x] AI 调用失败/超时时退回积分（`finish_room_ai_request` RPC）
- [x] 同房间 AI 请求严格顺序处理（`pg_advisory_xact_lock`）
- [x] 提示功能聚焦于未覆盖评分点
- [x] 管理端消息审计：查看最近 200 条消息，解析推理覆盖点和询问信息，支持标记 AI 错误案例
- [x] 管理端：批量更新消息状态、导出 CSV
- [x] AI 询问严格/推断双路判断与必要时仲裁，内部审计字段不返回玩家
- [x] 问答缓存按题目上下文隔离，待审核缓存不会直接命中
- [x] GLM 事实摘要和 DeepSeek/GLM 备用调用按配置降级
- [ ] **待做**：事实白板房主撤销单条、局终回放保留
- [ ] **待做**：AI 解析失败/超时前端文案细分（退分提示 vs 稍后重试）

---

## 阶段七：UI 优化与体验打磨 🔄 进行中

**目标**：页面布局、移动端适配、交互细节。

- [x] 房间详情默认收起（座位、积分、房主操作）
- [x] 房间码旁复制按钮
- [x] 危险操作使用站内确认组件
- [x] 全局 Header
- [x] 移动端基础响应式样式
- [x] 用户个人主页（历史房间、积分流水、当前活动房间、题目通关记录）
- [x] 隐藏用户可见的登录 IP
- [x] 房间在线人数/在线状态追踪
- [x] 移动端竖屏房间页三标签全屏布局（聊天/题库/座位，`live-room-seats.tsx` + `puzzle-panel.tsx`，仅作用于 `(orientation: portrait) and (max-width: 760px)`）
- [x] 自动深色模式（`prefers-color-scheme`，`globals.css`，无手动切换开关）
- [x] 用户反馈页面 `/feedback`（仅注册用户，5 类含投稿汤，2000 字，每账号每天 3 条限流；后台「用户反馈」tab 支持状态流转、内部备注和筛选）
- [ ] **待做**：后台题库编辑表单、弹窗在窄屏下的进一步验证
- [ ] **待做**：公开房间大厅（展示公开房间列表，含筛选和一键加入）

---

## 阶段八：安全与运维 🔄 持续关注

**目标**：权限模型完整、无泄漏、可观测。

- [x] RLS 覆盖所有用户可读表，`SECURITY DEFINER` 函数使用空 `search_path`
- [x] 私密数据不暴露给浏览器，`SUPABASE_SECRET_KEY` 只用于服务端
- [x] 普通聊天消息速率限制（每秒 2 条、每分钟 40 条）
- [x] 管理端房间清理：列出僵尸房间，可强制关闭、退还临时积分、删除聊天记录
- [x] AI 退分与用户删除清理迁移（`20260620152020`）
- [x] 管理员积分增减改为 RPC 并写流水（`admin_adjust_user_points`，迁移 `20260620091527`）
- [x] 管理端操作保留筛选/标签状态，编辑聚焦时暂停轮询（账户/消息/房间/积分流水标签）
- [x] AI 主持接入 GLM 作为 DeepSeek 超时/失败时的备用模型（`src/lib/deepseek.ts`）
- [x] 管理端邮箱二次验证和可信设备 Cookie
- [x] 房间级设备锁、多设备接管和只读/跳转边界
- [x] Realtime 事件顺序修复与断线后的受保护接口补拉
- [ ] **待做**：积分操作速率限制
- [ ] **待做**：Supabase 日志监控 / 告警
- [ ] **待做**：错误边界与用户友好错误页面
- [ ] **待做**：房间清理接入定时任务

---

## 下一步优先建议

1. **公开房间大厅**：首页目前偏”输入房间码”入口，可补公开房间列表、筛选和一键加入。
2. **事实白板管理**：房主撤销单条事实、局终回放保留。
3. **生产运维**：Supabase 日志/告警、AI 调用失败率统计、房间清理定时任务。
4. **移动端精修**：房间页竖屏三标签布局已上线，仍需检查后台题库编辑表单、弹窗在窄屏下的表现。

## 快速参考：关键文件

| 文件 | 作用 |
|------|------|
| `src/lib/types.ts` | 共享类型 |
| `src/lib/validation.ts` | Zod 表单验证 |
| `src/app/rooms/actions.ts` | 房间 Server Actions |
| `src/components/live-room-seats.tsx` | 座位实时展示 |
| `src/components/room-chat.tsx` | 聊天组件 |
| `src/app/rooms/[code]/messages/route.ts` | 消息服务端路由 |
| `src/app/feedback/page.tsx` | 用户反馈页面与提交 Action |
| `supabase/migrations/` | 全部数据库迁移（按文件名顺序） |
