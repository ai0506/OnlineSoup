# 汤局 OnlineSoup

多人在线海龟汤房间应用，当前已实现：

- Supabase 邮箱注册、登录、退出和密码重置
- 全局唯一用户名（忽略大小写判重）、历史账户补设用户名
- 用户积分、积分流水与管理员后台管理
- 创建 / 关闭房间，可选房间密码，`points_per_seat` 可设为 0
- 登录用户和游客加入、退出、被踢，刷新后恢复身份
- 自动恢复当前活动房间，加入新房间时清理旧房间身份
- 房主赠送积分、移动玩家座位
- 房间座位、成员聊天与 Realtime 状态同步（轮询兜底）
- 海龟汤题库：房主选题/关题，管理端新增、编辑、软删除、整体导入导出题目
- 聊天区询问 / 提示 / 尝试推理三种模式，接入 DeepSeek AI 主持作答与积分扣除
- 普通聊天消息和 AI 请求均有速率限制

更详细的功能拆分和当前进度见 [`tasks.md`](tasks.md)；最近的改动记录见 [`updates.md`](updates.md)。

## 1. 安装

需要 Node.js 20.9 或更高版本。

```bash
npm install
```

## 2. 创建 Supabase 项目并部署数据库

1. 在 Supabase 创建一个项目。
2. 使用 Supabase CLI 关联项目并部署 `supabase/migrations` 目录下的全部迁移（按文件名顺序执行，数量较多，不建议手动逐个粘贴到 SQL Editor）：

   ```powershell
   npx.cmd supabase login
   npx.cmd supabase link --project-ref your-project-ref
   npx.cmd supabase db push --linked
   ```

3. 在 Authentication 的 URL Configuration 中加入：
   `http://localhost:3000/auth/callback`

详细步骤、常见报错和 Windows 环境下的排查方法见 [`本地部署教程.md`](本地部署教程.md)。

## 3. 配置环境变量

复制 `.env.example` 为 `.env.local`，填写 Supabase 项目 Connect
页面中的值：

```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=sb_publishable_xxx
NEXT_PUBLIC_SITE_URL=http://localhost:3000
SUPABASE_SECRET_KEY=sb_secret_xxx
ADMIN_EMAILS=admin@example.com
DEEPSEEK_API_KEY=sk-xxx
DEEPSEEK_MODEL=deepseek-v4-flash
```

Publishable key 是供网页使用的公开项目密钥；数据库访问仍受 RLS
和函数权限保护。`SUPABASE_SECRET_KEY` 只供服务端使用，不能添加
`NEXT_PUBLIC_` 前缀，也不能提交到公开仓库。`ADMIN_EMAILS` 支持多个管理员邮箱，
使用英文逗号分隔。`DEEPSEEK_API_KEY` / `DEEPSEEK_MODEL` 用于房间内 AI 问答（询问、
提示、尝试推理），缺省时该功能不可用，但不影响其他功能。

配置完成并重启项目后，管理员登录即可从顶部导航进入 `/admin`，管理账户积分和题库。

## 4. 启动

```bash
npm run dev
```

打开 `http://localhost:3000`。

## 5. 基础功能验收

1. 注册并通过邮箱验证，登录后首页显示初始积分。
2. 创建一个房间（座位数和每座积分自定义，`points_per_seat` 可填 0）。
3. 在无登录状态的浏览器中输入房间码（和可选密码）加入房间。
4. 房主在"海龟汤"标签中选择题目，玩家在聊天区使用询问 / 提示 / 尝试推理。
5. 刷新页面后身份和座位状态应保持一致。

代码自检命令（详见 `CLAUDE.md` / `AGENTS.md`）：

```powershell
npm.cmd run typecheck
npm.cmd run lint
npm.cmd run build
```
