# OnlineSoup CLI Windows 测试清单

目的：完成计划 P1 第 4 项（Windows CMD/PowerShell 的参数、引号、Unicode、安全密码输入、文件权限、非 TTY JSON），并顺带检查 Windows 常见环境问题。测完把结果填在每项的“结果”栏，最后补“测试环境”。

## 0. 准备

### 0.1 安装网站发布的 CLI（主要测试对象）

需要 Node.js 22 或更高版本（`node -v` 确认）。不需要克隆仓库，这就是玩家的真实安装方式：

```powershell
npm install --global https://onlinesoup.ai0506.com/downloads/onlinesoup-cli-0.3.1.tgz
$env:ONLINESOUP_HOME = "$env:TEMP\soup-test"
soup /help
```

CMD 中设置测试目录：`set ONLINESOUP_HOME=%TEMP%\soup-test`。版本号以 [下载页](https://onlinesoup.ai0506.com/cli) 为准。

### 0.2 自动化测试（可选，第 1 项需要）

安装包不含测试代码。只检出 CLI 所需的三个目录（约 2 MB），不拉整个仓库：

```powershell
git clone --filter=blob:none --sparse https://github.com/ai0506/OnlineSoup.git soup-cli-test
cd soup-cli-test
git sparse-checkout set cli src/lib/player-api docs/testing
npm --prefix cli ci
npm --prefix cli test
```

### 0.3 账号与房间

- CLI 玩家：用专门注册的账号（例如 `wintest`），先在网站设置好用户名。不要用 `test`：它名下有开放房间，CLI 加入别人房间会返回 `OWNED_ROOM_ACTIVE`。
- 房主：在另一台设备的网页上用**另一个账号**创建房间、设置 6 位房间密码、每座位积分约 15、开一道题。CLI 不支持房主。
- 账号密码与房间密码由测试者本人在终端输入，或由测试者自己创建临时密码文件：`Set-Content -Path $env:TEMP\pw.txt -Value '你的密码' -NoNewline`。不要写进命令行参数、仓库文件或日志。

## 1. 测试项

| # | 测什么 | 命令 / 操作 | 预期 | 结果 |
|---|---|---|---|---|
| 1 | 自动化测试（可选） | 按 0.2 执行 `npm --prefix cli test` | 全部通过（含 ACL、文件锁、强杀后释放锁） | |
| 1a | 浏览器登录 | `soup /login`：自动打开浏览器，网页确认账号并输入终端显示的验证码 | 终端显示已登录；再试 `soup /login --no-browser` 只显示链接；中途 Ctrl+C 后再次 `/login` 能恢复未过期请求 | |
| 2 | 终端密码登录（PowerShell） | 先 `soup /logout`，再 `soup /login wintest` 后手动输入密码 | 输入不回显；退格能删；回车后显示“已登录：wintest” | |
| 3 | 隐藏密码（CMD） | 新开 CMD，重复第 2 项 | 同上 | |
| 4 | 隐藏密码（Windows Terminal） | 在 Windows Terminal 中重复第 2 项；再试一次中途按 Ctrl+C | 同上；Ctrl+C 取消且终端恢复正常回显 | |
| 5 | stdin 密码（CMD 重定向） | `soup --json --password-stdin /login wintest < %TEMP%\pw.txt` | `"ok":true`，无提示语 | |
| 6 | stdin 密码（PowerShell 管道） | `Get-Content $env:TEMP\pw.txt \| soup --json --password-stdin /login wintest` | 同上（验证全局安装的 soup.ps1 能转发管道输入） | |
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
| 19 | 非交互缺输入 | `'' \| soup --json /login wintest`（非交互且未提供 stdin 密码） | 立即返回错误，不卡住等待输入 | |
| 20 | 输出到文件 | `soup --json /state > out.json`，再 `Get-Content out.json \| ConvertFrom-Json` | 记录文件编码（PowerShell 5.1 为 UTF-16）及能否被解析 | |
| 21 | 等待与中断 | `soup /wait --timeout 30`，期间网页房主发一条消息 | CLI 立即返回该消息 | |
| 22 | 等待中 Ctrl+C | `soup /wait --timeout 60` 中按 Ctrl+C，再运行 `soup /messages` | 不丢消息、不重复报错；游标继续 | |
| 23 | 被网页接管 | 在另一台设备网页用 `wintest` 账号从大厅进入同一房间，然后 CLI 运行 `soup /state` | 网页先显示“CLI 正在使用”的站内确认；取消则 CLI 仍可用；确认后 CLI 返回 `ROOM_DEVICE_IN_USE`，不自动抢回 | |
| 24 | 明确接管 | `soup /join 房间码 --takeover`（密码房按提示输入） | 恢复成功；网页端被挤下线 | |
| 25 | 收尾 | `soup /leave`；`soup /logout` | 均成功；`soup /state` 提示需加入房间 | |

## 2. 测试环境（测完填写）

- Windows 版本（`winver`）：
- CPU 架构（x64 / ARM64）：
- Node.js 版本：
- 测试的终端：PowerShell 版本（`$PSVersionTable.PSVersion`）/ CMD / Windows Terminal / Git Bash
- CLI 版本（安装包文件名）与测试日期：

## 3. 完成后

- 删除测试目录：`Remove-Item -Recurse $env:ONLINESOUP_HOME`，以及 `$env:TEMP\pw.txt`；如做了 0.2，删除 `soup-cli-test` 目录。
- 卸载：`npm uninstall --global @onlinesoup/cli`（包名以 `npm ls --global` 显示为准）。
- 失败项记录完整输出（去掉密码），交给 Claude Code 或 Codex 分析修复。
