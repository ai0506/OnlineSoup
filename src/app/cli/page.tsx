import type { Metadata } from "next";
import Link from "next/link";
import release from "../../../public/downloads/cli-release.json";

export const metadata: Metadata = {
  title: "CLI 下载与入门 - 汤局 OnlineSoup",
  description: "下载汤局终端客户端，安装后通过浏览器登录，与网页玩家一起推理海龟汤。",
};

export default function CliPage() {
  return (
    <div className="docs-layout">
      <aside className="docs-sidebar">
        <div className="docs-sidebar-label">OnlineSoup / CLI</div>
        <nav aria-label="CLI 入门目录">
          <a href="#install">安装客户端</a>
          <a href="#play">开始玩</a>
          <a href="#commands">常用命令</a>
          <a href={release.guideUrl}>完整 Markdown 教程 ↗</a>
        </nav>
        <Link className="docs-sidebar-back" href="/tutorial">网页版使用教程 →</Link>
      </aside>

      <div className="docs-content">
        <header className="docs-header">
          <div className="docs-kicker">ONLINESOUP · TERMINAL CLIENT · v{release.version}</div>
          <h1>在终端里，一起推理。</h1>
          <p>汤局是多人在线海龟汤游戏。房主在网页选题，你可以用 CLI 与网页玩家一起聊天、向 AI 主持人提问，逐步找出故事的真相。</p>
        </header>

        <section className="docs-section" id="install">
          <div className="docs-section-heading"><span>01</span><h2>安装客户端</h2></div>
          <p>每台电脑先安装 <a href="https://nodejs.org/en/download" target="_blank" rel="noreferrer">Node.js 22 或更高版本</a>，再在电脑终端运行：</p>
          <pre className="docs-flow">{`npm install --global https://onlinesoup.ai0506.com${release.packageUrl}\nsoup /help`}</pre>
          <p>程序和运行依赖已打包，无需下载项目源码或自己编译。安装包面向 macOS、Windows 和 Linux；已在 Apple 芯片的 macOS 实测，其他系统尚未实机验收。</p>
          <p>Windows 若阻止 PowerShell 脚本，使用 <code>npm.cmd</code> 和 <code>soup.cmd</code>。安装权限或找不到命令的问题见完整教程。</p>
          <p><a className="button" href={release.packageUrl} download>下载安装包 · v{release.version}</a>{" "}<a className="button secondary" href={release.guideUrl} download>下载 Markdown 教程</a></p>
          <p><a href={`${release.packageUrl}.sha256`}>SHA-256 校验文件</a> · 安装包约 {(release.size / 1024 / 1024).toFixed(1)} MB</p>
        </section>

        <section className="docs-section" id="play">
          <div className="docs-section-heading"><span>02</span><h2>登录，加入，开始玩</h2></div>
          <p>CLI 使用注册账号。先在电脑终端输入 <code>soup</code>，然后在 soup 提示符逐条输入：</p>
          <pre className="docs-flow">{`/login\n/join ABC123\n/puzzle\n/ask 他是故意这样做的吗？\n/messages\n/leave\n/exit`}</pre>
          <p><code>/login</code> 会打开网页：确认已有账号，或换一个账号登录，再输入终端显示的确认码。把示例 <code>ABC123</code> 换成房主给你的真实房间码；有密码时终端会隐藏输入。</p>
          <div className="docs-note"><strong>和朋友一起玩</strong><span>请另一位房主在网页创建房间、开始题目。CLI 负责玩家操作；询问消耗 1 积分，提示消耗 1 积分及 1 次提示机会，尝试推理消耗 2 积分。</span></div>
          <p>换电脑只需重新安装和登录。需要接管自己原来的座位时，用 <code>/join CODE --takeover</code>；旧端随后无法继续操作。</p>
        </section>

        <section className="docs-section" id="commands">
          <div className="docs-section-heading"><span>03</span><h2>常用命令</h2></div>
          <table className="docs-table">
            <thead><tr><th>命令</th><th>用途</th></tr></thead>
            <tbody>
              <tr><td><code>/state · /puzzle · /facts</code></td><td>房间状态、题面、已确认事实</td></tr>
              <tr><td><code>/seats · /points</code></td><td>玩家座位、积分和提示机会</td></tr>
              <tr><td><code>/say 文字</code> 或直接输入文字</td><td>和玩家聊天</td></tr>
              <tr><td><code>/ask 问题</code></td><td>向 AI 提出一个是非问题</td></tr>
              <tr><td><code>/hint · /reason 完整推理</code></td><td>请求提示或尝试解答</td></tr>
              <tr><td><code>/messages · /wait</code></td><td>补拉新消息或等待变化</td></tr>
              <tr><td><code>/leave · /logout · /exit</code></td><td>退房、注销、关闭 CLI；仅关闭会保留座位</td></tr>
              <tr><td><code>/help</code></td><td>查看完整命令帮助</td></tr>
            </tbody>
          </table>
          <p>房间操作后会自动检查并提醒尚未获取的新消息，用 <code>/messages</code> 获取正文；终端闲置时可用 <code>/wait</code> 等待变化。默认 AI 操作使用座位积分；需要个人积分时显式添加 <code>--use-personal-points</code>。</p>
          <p><a href={release.guideUrl}>阅读完整 Markdown 教程 →</a> 包含全部命令、消息分页、脚本调用、更新卸载和异常恢复。</p>
        </section>
      </div>
    </div>
  );
}
