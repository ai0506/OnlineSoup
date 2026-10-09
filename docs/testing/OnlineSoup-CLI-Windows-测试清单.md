# OnlineSoup CLI Windows 测试清单

目的：完成计划 P1 第 4 项（Windows CMD/PowerShell 的参数、引号、Unicode、安全密码输入、文件权限、非 TTY JSON），并顺带检查 Windows 常见环境问题。测完把结果填在每项的“结果”栏，最后补“测试环境”。

## 0. 准备

### 0.1 获取代码（二选一）

CLI 提交目前尚未推送到 GitHub，`git clone` 拿不到。

- **方式 A：推送后克隆**：在 Mac 上确认并推送 `main`，Windows 上执行 `git clone https://github.com/ai0506/OnlineSoup.git`。
- **方式 B：打包拷贝**：在 Mac 项目目录执行下面命令（只打包已提交内容，不含未提交改动），把 zip 拷到 Windows 解压：

  ```bash
  git archive --format=zip -o ~/Desktop/onlinesoup-cli.zip HEAD
  ```

### 0.2 安装与构建（PowerShell）

需要 Node.js 22 或更高版本（`node -v` 确认）。

```powershell
cd OnlineSoup
npm --prefix cli ci
npm --prefix cli test          # 自动化测试，预期 11 项全部通过
npm --prefix cli run build
cd cli; npm link; cd ..        # 之后可直接用 soup
$env:ONLINESOUP_HOME = "$env:TEMP\soup-test"
soup /help
```

CMD 中设置测试目录：`set ONLINESOUP_HOME=%TEMP%\soup-test`

### 0.3 账号与房间

- CLI 玩家：用 `test` 账号（普通用户测试账号）。
- 房主：在 Mac 或手机网页上用**另一个账号**创建房间、设置 6 位房间密码、开一道题。CLI 不支持房主，不能用同一个账号。
- 准备一个密码文件（只放密码，一行）：`Set-Content -Path $env:TEMP\pw.txt -Value '123456' -NoNewline`

## 1. 测试项

| # | 测什么 | 命令 / 操作 | 预期 | 结果 |
|---|---|---|---|---|
| 1 | 自动化测试 | `npm --prefix cli test` | 11 项通过（含 ACL、文件锁、强杀后释放锁） | |
| 2 | 隐藏密码（PowerShell） | `soup /login test` 后手动输入密码 | 输入不回显；退格能删；回车后显示“已登录：test” | |
| 3 | 隐藏密码（CMD） | 新开 CMD，重复第 2 项 | 同上 | |
| 4 | 隐藏密码（Windows Terminal） | 在 Windows Terminal 中重复第 2 项；再试一次中途按 Ctrl+C | 同上；Ctrl+C 取消且终端恢复正常回显 | |
| 5 | stdin 密码（CMD 重定向） | `soup --json --password-stdin /login test < %TEMP%\pw.txt` | `"ok":true`，无提示语 | |
| 6 | stdin 密码（PowerShell 管道） | `Get-Content $env:TEMP\pw.txt \| soup --json --password-stdin /login test` | 同上（验证 npm 的 soup.ps1 能转发管道输入） | |
| 7 | 带 BOM 的密码文件 | 用记事本把密码另存为“UTF-8 带 BOM”，重复第 5 项 | 记录是否成功；若失败说明需要去除 BOM | |
| 8 | 密码房加入 | `soup /join 房间码`，手动输入房间密码；自动化：`Get-Content $env:TEMP\pw.txt \| soup --json --password-stdin /join 房间码` | 加入成功；`%ONLINESOUP_HOME%\session.json` 中搜不到房间密码 | |
| 9 | 中文与空格 | `soup /say "大家好 你好"`；`soup /ask "他认识她吗？"` | 网页上看到完整中文，无乱码、未被截断 | |
| 10 | 中文显示（CMD 代码页） | CMD 默认代码页下 `soup /messages`；再 `chcp 65001` 后重复 | 记录两种代码页下是否乱码 | |
| 11 | 引号与特殊文本 | PowerShell：`soup /say '他说"你好"'`；`soup /say -- '--json 不是选项'`；`soup //help` | 网页分别看到 `他说"你好"`、`--json 不是选项`、`/help` | |
| 12 | Shell 变量展开 | CMD：`soup /say "%PATH%"`；PowerShell：`soup /say "$HOME"` 和 `soup /say '$HOME'` | 记录实际发出的文本（双引号会被 Shell 展开属于 Shell 行为，用于确认文档需要提醒） | |
| 13 | Git Bash | 在 Git Bash 中 `soup /state`；再 `MSYS_NO_PATHCONV=1 soup /state` | 记录第一条是否被改写成路径而失败；第二条应成功 | |
| 14 | 文件权限 | `icacls $env:ONLINESOUP_HOME` 和 `icacls $env:ONLINESOUP_HOME\session.json` | 只有当前用户有权限，无继承项（无 Users/Everyone） | |
| 15 | 特殊用户名路径 | 若有中文或带空格的 Windows 用户，用该用户重复 0.2 和第 2、14 项 | 正常运行，ACL 正确 | |
| 16 | 进程锁 | 窗口 A 运行 `soup` 进入交互模式；窗口 B 运行 `soup /state` | 窗口 B 返回 `LOCAL_SESSION_BUSY` | |
| 17 | 强杀后释放 | 直接点 X 关闭窗口 A（或任务管理器结束 node.exe），窗口 B 再运行 `soup /state` | 正常返回，不再报忙 | |
| 18 | JSON 与退出码 | `soup --json /state \| ConvertFrom-Json`；`soup --json /join ZZZZZZ; $LASTEXITCODE` | 前者正常解析为对象；后者输出 JSON 错误且退出码非 0 | |
| 19 | 非交互缺输入 | `soup --json /login test`（不提供 stdin 密码，管道为空：`'' \| soup --json /login test`） | 立即返回错误，不卡住等待输入 | |
| 20 | 输出到文件 | `soup --json /state > out.json`，再 `Get-Content out.json \| ConvertFrom-Json` | 记录文件编码（PowerShell 5.1 为 UTF-16）及能否被解析 | |
| 21 | 等待与中断 | `soup /wait --timeout 30`，期间网页房主发一条消息 | CLI 立即返回该消息 | |
| 22 | 等待中 Ctrl+C | `soup /wait --timeout 60` 中按 Ctrl+C，再运行 `soup /messages` | 不丢消息、不重复报错；游标继续 | |
| 23 | 被网页接管 | 在另一台设备网页用 `test` 账号从大厅进入同一房间，然后 CLI 运行 `soup /state` | 返回 `ROOM_DEVICE_IN_USE`，CLI 不自动抢回 | |
| 24 | 明确接管 | `soup /join 房间码 --takeover`（密码房按提示输入） | 恢复成功；网页端被挤下线 | |
| 25 | 收尾 | `soup /leave`；`soup /logout` | 均成功；`soup /state` 提示需加入房间 | |

## 2. 测试环境（测完填写）

- Windows 版本（`winver`）：
- CPU 架构（x64 / ARM64）：
- Node.js 版本：
- 测试的终端：PowerShell 版本（`$PSVersionTable.PSVersion`）/ CMD / Windows Terminal / Git Bash
- 测试日期与提交号（`git rev-parse --short HEAD` 或 zip 来源提交）：

## 3. 完成后

- 删除测试目录：`Remove-Item -Recurse $env:ONLINESOUP_HOME`，以及 `$env:TEMP\pw.txt`。
- 失败项记录完整输出（去掉密码），交给 Claude Code 或 Codex 分析修复。
