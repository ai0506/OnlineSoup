# OnlineSoup CLI Windows 验收记录（2026-10-11，CLI 0.3.0）

> 本文件是 Windows 实测结果存档，测试对象为网站 CLI 0.3.0 与源码提交 `7323610`。可复用的测试步骤见 [Windows 测试清单](OnlineSoup-CLI-Windows-测试清单.md)；下方“0.3.1 修复跟进”记录失败项处理。

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

- CLI 玩家：用 `aitest` 账号（普通用户测试账号）。
- 房主：在 Mac 或手机网页上用**另一个账号**创建房间、设置 6 位房间密码、开一道题。CLI 不支持房主，不能用同一个账号。
- 临时密码文件只能由操作者自己创建，账号密码与房间密码分开保存；代理不读取或输出文件内容，不把密码放入参数、聊天或日志。

## 1. 测试项

| # | 测什么 | 命令 / 操作 | 预期 | 结果 |
|---|---|---|---|---|
| 1 | 自动化测试 | `npm.cmd --prefix cli test` | 当前源码 18 项全部通过 | 失败：15 通过、3 失败、0 跳过，退出码 1；关键输出见下方记录。 |
| 1a | 浏览器登录确认 | 网站安装版 `soup.cmd --json /login`，操作者浏览器确认后运行 `soup.cmd --json /login --wait` | 登录 aitest 成功 | 通过：操作者完成浏览器确认；CLI 返回 authenticated: true、username: aitest，退出码 0。 |
| 2 | 隐藏密码（PowerShell） | `soup /login aitest` 后手动输入密码 | 输入不回显；退格能删；回车后显示“已登录：aitest” | 通过：操作者确认 PowerShell 密码不回显、退格有效，正确密码可登录、错误密码被拒绝。首次房间未退出时返回 LEAVE_REQUIRED、退出码 4；退房后复测成功。 |
| 3 | 隐藏密码（CMD） | 新开 CMD，重复第 2 项 | 同上 | 通过：操作者确认 CMD 登录成功、密码不回显、退格有效。 |
| 4 | 隐藏密码（Windows Terminal） | 在 Windows Terminal 中重复第 2 项；再试一次中途按 Ctrl+C | 同上；Ctrl+C 取消且终端恢复正常回显 | 通过：操作者确认 Windows Terminal 密码不回显、退格有效；Ctrl+C 取消后回到提示符，echo 输入恢复正常 显示正常。 |
| 5 | stdin 密码（CMD 重定向） | `soup --json --password-stdin /login aitest < %TEMP%\pw.txt` | `"ok":true`，无提示语 | 通过：操作者创建 account-password.txt；CMD 以 < 重定向到网站安装版 soup.cmd --json --password-stdin /login aitest，仅输出一行 JSON，ok=true、authenticated=true、username=aitest，退出码 0，无密码提示语。 |
| 6 | stdin 密码（PowerShell 管道） | `Get-Content $env:TEMP\pw.txt \| soup --json --password-stdin /login aitest` | 同上（验证 npm 的 soup.ps1 能转发管道输入） | 通过：Get-Content 直接管道传给 npm 生成的 soup.ps1，仅输出一行 JSON，ok=true、authenticated=true、username=aitest，退出码 0；未显示或记录密码文件内容。 |
| 7 | 带 BOM 的密码文件 | 用记事本把密码另存为“UTF-8 带 BOM”，重复第 5 项 | 记录是否成功；若失败说明需要去除 BOM | 失败：操作者用记事本另存为 account-password-bom.txt，确认含 UTF-8 BOM；CMD 重定向返回 ok=false、INVALID_CREDENTIALS: 登录失败，请检查凭据后重试，退出码 4。原无 BOM 文件复测登录成功、退出码 0；本版本使用密码文件需去除 BOM。未显示或记录密码内容。 |
| 8 | 密码房加入 | `soup /join 房间码`，手动输入房间密码；自动化：`Get-Content $env:TEMP\pw.txt \| soup --json --password-stdin /join 房间码` | 加入成功；`%ONLINESOUP_HOME%\session.json` 中搜不到房间密码 | 通过（stdin 加入与不落盘）：原 35WE8U 为无密码房；操作者说明房间内不能设置密码，另建密码房 W9ADLZ，并亲自创建 room-password.txt。PowerShell 管道加入返回 ok=true、status=completed、room_code=W9ADLZ、退出码 0；在内存中检查 session.json，包含房间密码=false，未输出密码或会话内容。TTY 手动隐藏输入加入分支未单独验证。 |
| 9 | 中文与空格 | `soup /say "大家好 你好"`；`soup /ask "他认识她吗？"` | 网页上看到完整中文，无乱码、未被截断 | 通过：CLI 中文聊天与提问成功、原文无截断；操作者最终在房主网页 W9ADLZ 确认 大家好 你好、他说"你好"、/help 三条完整显示。补测消息 1486–1488；提问在旧房间 35WE8U 开题后成功。首次未开题返回 NO_ACTIVE_PUZZLE 属前提不足。 |
| 10 | 中文显示（CMD 代码页） | CMD 默认代码页下 `soup /messages`；再 `chcp 65001` 后重复 | 记录两种代码页下是否乱码 | 通过（ConPTY 输出）：临时 CMD 默认代码页 936 与 chcp 65001 下 /messages --cached 均显示完整中文，无乱码；使用同一已保存消息集对比。新消息 /messages 与实体窗口字体显示未单独复核。 |
| 11 | 引号与特殊文本 | PowerShell：`soup /say '他说"你好"'`；`soup /say -- '--json 不是选项'`；`soup //help` | 网页分别看到 `他说"你好"`、`--json 不是选项`、`/help` | 失败（选项文本分支）：PowerShell 7 的 soup /say -- '--json 不是选项' 返回 INVALID_INPUT: 操作未完成，请检查命令、权限或会话目录，退出码 2，未发送该文本。其余引号与转义斜杠通过：W9ADLZ 消息 1487 为 他说"你好"、1488 为 /help，操作者确认网页均完整显示。 |
| 12 | Shell 变量展开 | CMD：`soup /say "%PATH%"`；PowerShell：`soup /say "$HOME"` 和 `soup /say '$HOME'` | 记录实际发出的文本（双引号会被 Shell 展开属于 Shell 行为，用于确认文档需要提醒） | 失败（CMD 部分；PowerShell 通过）：操作者明确授权后执行。CMD 的 PATH 展开长度 1339 字符，返回 INVALID_INPUT: 请求内容格式不正确、退出码 2，服务端无该消息；原因未确认。PowerShell 双引号发送 C:\Users\aishu，单引号发送字面 $HOME，两次退出码 0，服务端原文核对均一致。 |
| 13 | Git Bash | 在 Git Bash 中 `soup /state`；再 `MSYS_NO_PATHCONV=1 soup /state` | 记录第一条是否被改写成路径而失败；第二条应成功 | 跳过：PATH、常见安装目录及工具自带 Git 中均未找到 bash.exe；未另行安装 Git Bash。 |
| 14 | 文件权限 | `icacls $env:ONLINESOUP_HOME` 和 `icacls $env:ONLINESOUP_HOME\session.json` | 只有当前用户有权限，无继承项（无 Users/Everyone） | 通过：目录 ASW\aishu:(OI)(CI)(F)，session.json ASW\aishu:(F)；无 (I)、Users 或 Everyone；icacls 均 1 成功、0 失败。 |
| 15 | 特殊用户名路径 | 若有中文或带空格的 Windows 用户，用该用户重复 0.2 和第 2、14 项 | 正常运行，ACL 正确 | 跳过：操作者表示没有可用的中文或含空格用户名的另一 Windows 用户；未创建新用户，未执行切换用户测试。 |
| 16 | 进程锁 | 窗口 A 运行 `soup` 进入交互模式；窗口 B 运行 `soup /state` | 窗口 B 返回 `LOCAL_SESSION_BUSY` | 通过：交互 CLI 持锁时，另一进程 /state 返回 LOCAL_SESSION_BUSY、退出码 4；随后正常 /exit。第 17 项人工关闭窗口仍待测。 |
| 17 | 强杀后释放 | 直接点 X 关闭窗口 A（或任务管理器结束 node.exe），窗口 B 再运行 `soup /state` | 正常返回，不再报忙 | 通过：关闭前第二进程返回 LOCAL_SESSION_BUSY、退出码 4；操作者亲自点 X 关闭终端窗口，未输入 /exit；关闭后新进程 /state 返回 ok=true、room_code=W9ADLZ、退出码 0，不再报忙。 |
| 18 | JSON 与退出码 | `soup --json /state \| ConvertFrom-Json`；`soup --json /join ZZZZZZ; $LASTEXITCODE` | 前者正常解析为对象；后者输出 JSON 错误且退出码非 0 | 通过：入房后 /state 经 ConvertFrom-Json 解析为 ok=true 对象、room.code=35WE8U，退出码 0；此前 /join ZZZZZZ 返回 ROOM_NOT_FOUND JSON、退出码 4。 |
| 19 | 非交互缺输入 | `soup --json /login aitest`（不提供 stdin 密码，管道为空：`'' \| soup --json /login aitest`） | 立即返回错误，不卡住等待输入 | 通过：空字符串管道返回 REQUIRED_INPUT_MISSING JSON、退出码 2，耗时 243 ms，未挂起。 |
| 20 | 输出到文件 | `soup --json /state > out.json`，再 `Get-Content out.json \| ConvertFrom-Json` | 记录文件编码（PowerShell 5.1 为 UTF-16）及能否被解析 | 通过：入房后 PowerShell 7 与 Windows PowerShell 5.1 的 /state 文件均可 ConvertFrom-Json，ok=true、房间 35WE8U、退出码 0；PS7 无 BOM（7B-22-61-70），PS5.1 UTF-16 LE（FF-FE-7B-00）。 |
| 21 | 等待与中断 | `soup /wait --timeout 30`，期间网页房主发一条消息 | CLI 立即返回该消息 | 通过（操作者终端实测）：网页房主 asw 发 win测试21 与 windows等待测试21 -消息2，/wait 返回两条完整消息，CLI exit=0、elapsed ms=3024。首轮无新消息正常超时（30979 ms、timed_out=true），复测收到消息成功。 |
| 22 | 等待中 Ctrl+C | `soup /wait --timeout 60` 中按 Ctrl+C，再运行 `soup /messages` | 不丢消息、不重复报错；游标继续 | 通过：操作者在 /wait --timeout 60 等待中按 Ctrl+C，正常回到提示符；随后网页 asw 发送 win测试22，第一次 /messages 完整收到，第二次返回 暂无新消息，未重复或丢失。期间误输入 /message 返回 INVALID_COMMAND，修正为 /messages 后正常，非产品缺陷。 |
| 23 | 被网页接管 | 在另一台设备网页用 `aitest` 账号从大厅进入同一房间，然后 CLI 运行 `soup /state` | 返回 `ROOM_DEVICE_IN_USE`，CLI 不自动抢回 | 通过：操作者用网页 aitest 从 返回当前房间 入口确认接管；CLI 两次 /state 均返回 ROOM_DEVICE_IN_USE: 座位已由其他设备使用；只有明确接管才能恢复，退出码均 4，未自动抢回。 |
| 24 | 明确接管 | `soup /join 房间码 --takeover`（密码房按提示输入） | 恢复成功；网页端被挤下线 | 通过：stdin 房间密码执行 /join W9ADLZ --takeover 返回 ok=true、status=completed、退出码 0；/state 恢复成功。操作者说明网页未再次确认接管，最终显示 你已在房间中 / CLI 使用中 / 请先返回当前房间，或退出后再加入其他房间；网页回到大厅拦截状态，未自动取得 CLI 座位。 |
| 25 | 收尾 | `soup /leave`；`soup /logout` | 均成功；`soup /state` 提示需加入房间 | 通过：/leave 返回 left=true、退出码 0；/logout 返回 authenticated=false、退出码 0；退房后及注销后的 /state 均返回 ROOM_MEMBERSHIP_REQUIRED: 请先 /join CODE、退出码 4。 |

### 本轮 Windows 实测记录（2026-10-11，功能验收及清理完成）

- 稀疏检出源码提交：`7323610`；目录仅 `cli`、`src/lib/player-api`、`docs/testing`（含 Git 默认根文件）。原清单 0.1/0.2 未包含网站安装流程、缺少 1a、旧测试数为 11；本轮按操作者要求使用网站包，补充 1a，不执行 `npm link`。
- 0.1 通过：从 `https://onlinesoup.ai0506.com/downloads/onlinesoup-cli-0.3.0.tgz` 安装，独立前缀 `D:\Desktop\Projects\OnlineSoup\.cli-windows-test\installed`；包名 `@onlinesoup/cli`，版本 `0.3.0`，`soup.cmd /help` 退出码 0。
- 0.2 已运行：官方 Node.js 便携版 `22.23.3` / npm `10.9.9`；Node zip SHA-256 与官方清单一致。`npm.cmd --prefix cli ci` 成功，27 packages，0 vulnerabilities；构建成功。未运行任何数据库测试、未调用管理功能。
- 第 1 项最终结果来自普通 Windows 用户环境：沙箱首跑有 ACL `EPERM`，已排除沙箱干扰重跑。
- 第 1a 项通过：操作者明确将测试账号从 wintest 改为 aitest，并亲自完成浏览器确认；网站安装版 CLI 领取授权成功，返回 `authenticated: true`、`username: aitest`，退出码 0。不在清单保存授权链接、确认码或会话凭证。
- 按操作者要求先执行独立测试，再完成人工配合项目；原房间 35WE8U 用于中文/提问/积分，新密码房 W9ADLZ 用于密码加入、等待、网页接管。清单 26 项（含 1a）：20 通过、4 失败、2 跳过；部分通过项的分支限制见对应结果。第 8 项已验证 stdin 与不落盘，未单独复测 TTY 房间密码输入；第 10 项使用 ConPTY 缓存消息对比代码页。

第 1 项失败关键输出（没有真实密码）：

```text
npm.cmd --prefix cli test
> npm run build && node --test tests/*.test.mjs
> tsc -p tsconfig.json
not ok 2 - JSON device flow persists private proof, resumes after unknown response and acknowledges only after local save
  error: 'Unexpected end of JSON input'
  at cli (cli/tests/browser-login.test.mjs:11:406)
not ok 8 - password room reads stdin without argv or local secret and completed requests are cleared
  error: 'Unexpected end of JSON input'
  at TestContext.<anonymous> (cli/tests/cli.test.mjs:55:118)
not ok 9 - real CLI ask/reason/chat and room reads append one JSON check without consuming messages or changing unknown-write exit
  error: 'Unexpected end of JSON input'
  at run (cli/tests/message-notice.test.mjs:37:35)
# tests 18
# pass 15
# fail 3
# cancelled 0
# skipped 0
Exit code: 1
```

只读复现确认上述三个测试用 `new URL(...).pathname` 启动 Node 子进程时，在 Windows 传入 `/D:/...`，Node 错误解析为 `D:\D:\Desktop\Projects\OnlineSoup\soup-cli-test\cli\dist\cli\src\main.js`，返回 MODULE_NOT_FOUND、退出码 1、stdout 0 字节，随后测试 JSON.parse 空输出失败。未改测试或 CLI 代码。网站安装版 /help 可正常执行，不能将测试启动器缺陷直接认定为安装版登录功能失败。

### 积分补充验收与变量测试（操作者追加授权）

- 操作者开启题目并提供 2 点座位积分，明确允许测试个人积分；未修改房间设置、未调用管理功能。
- 初始 `/points`：seat_points=2、personal_points=100。
- 默认 `/ask "他认识她吗？"`：ok=true、paid_from=seat、points_spent=1、退出码 0；之后 seat_points=1、personal_points=100。
- `/ask --use-personal-points "故事发生在室内吗？"`：ok=true、paid_from=personal、points_spent=1、退出码 0；之后 seat_points=1、personal_points=99。
- 结论：座位积分与显式个人积分支付均通过；实际合计消耗 1 点座位积分、1 点个人积分。
- 第 12 项最初被自动审批拒绝；操作者随后明确允许外发 PATH/HOME 后才执行。CMD 关键输出：`INVALID_INPUT: 请求内容格式不正确`，退出码 2；展开的 PATH 长度 1339，未被服务器接受，不在清单复制完整 PATH。PowerShell 两条实际消息原文分别为 `C:\Users\aishu` 与 `$HOME`，服务端一致性核对为 true。
- 第 4 项前已退出 35WE8U，避免 LEAVE_REQUIRED；随后使用操作者新建的密码房 W9ADLZ 完成互通验收，最终已退房、注销。

## 2. 测试环境（测完填写）

- Windows 版本：Win32_OperatingSystem 确认 Microsoft Windows 11 家庭中文版，10.0.26200；注册表 DisplayVersion 25H2、UBR 9457，即 Build 26200.9457。未使用 winver 人工查看；旧注册表 ProductName 为 Windows 10，未以其认定系统版本。
- CPU 架构（x64 / ARM64）：x64
- Node.js 版本：官方便携版 v22.23.3；npm 10.9.9
- 测试的终端：PowerShell 7.6.5；Windows PowerShell 5.1.26100.9444（文件重定向）；CMD 默认代码页 936（登录由操作者完成）；Windows Terminal（操作者实测隐藏输入、Ctrl+C、关闭窗口、等待与消息游标）；Git Bash 未找到、跳过
- 测试日期与提交号（`git rev-parse --short HEAD` 或 zip 来源提交）：2026-10-11 / 7323610；主要对象为网站 CLI 0.3.0

## 3. 完成后

- 已完成：CLI `/leave`、`/logout`；两者退出码均为 0。保留稀疏检出和本清单，不关闭操作者房间、不删除账号。
- 已完成：确认并停止本轮 Node.js 便携运行时中残留的 3 个自动化测试进程；未结束 Codex 或其他用户进程。
- 已完成：操作者亲自执行清理并确认完成；代理随后检查下列三个目录均不存在（Test-Path=false），确认临时密码文件、会话、独立安装、缓存和构建产物随目录删除。此前代理删除曾被执行策略以 blocked by policy 拒绝，未通过其他工具绕过限制。
- 操作者已在 PowerShell 执行下列清理命令（保留稀疏仓库及清单）：

```powershell
Remove-Item -LiteralPath 'D:\Desktop\Projects\OnlineSoup\.cli-windows-test' -Recurse -Force
Remove-Item -LiteralPath 'D:\Desktop\Projects\OnlineSoup\soup-cli-test\cli\dist' -Recurse -Force
Remove-Item -LiteralPath 'D:\Desktop\Projects\OnlineSoup\soup-cli-test\cli\node_modules' -Recurse -Force
```

- 第一条同时清理账号密码文件、BOM 文件、房间密码文件、CLI 会话、网站安装包、独立安装及 Node 便携版、npm 缓存和输出 JSON。未使用通用 `%TEMP%\pw.txt`，不删除可能属于操作者的既有文件。
- 失败项关键输出已记录在对应结果和自动化记录中；没有真实密码。未修改 CLI 代码，未提交或推送。
## 0.3.1 修复跟进（Claude Code，2026-10-11）

| 失败项 | 根因（已对照代码确认） | 0.3.1 处理 | 验证 |
|---|---|---|---|
| 1 自动化测试 3 项失败 | 测试以 `new URL(...).pathname` 启动子进程，Windows 得到 `/D:/...` | 三个测试文件改用 `fileURLToPath` | macOS 20/20 通过；Windows 待复测 |
| 7 带 BOM 密码文件登录失败 | `--password-stdin` 只去除结尾换行，未去除开头 UTF-8 BOM | 读取时去除开头 BOM（账号与房间密码共用） | 新增 BOM+CRLF 用例通过；Windows 待复测 |
| 11 PowerShell `soup /say -- '--json 不是选项'` | 推断：PowerShell 调用 `soup.ps1` 时去掉单独的 `--`，CLI 把正文当未知选项（未在 Windows 复现确认） | 报错改为“未知选项：…”，含空格时提示改用 `soup.cmd`；README 与玩家指南说明 | 安装包实测提示正确；Windows 待复测 `soup.cmd` 方式 |
| 12 CMD `%PATH%` 被拒 | 展开后 1339 字，超过聊天 300 字上限，拒绝正确但提示含糊 | 发送前按模式本地检查字数（聊天 300 / 询问 100 / 提示 50 / 推理 300），提示上限与当前字数，不发请求 | 新增超长用例通过 |

未处理：第 13 项（Git Bash）和第 15 项（特殊 Windows 用户名）仍未实测。
