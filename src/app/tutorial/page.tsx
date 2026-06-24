"use client";

import Image from "next/image";
import { useState } from "react";

function Lightbox({ src, onClose }: { src: string; onClose: () => void }) {
  return (
    <div className="tutorial-lightbox" onClick={onClose}>
      <button className="tutorial-lightbox-close" onClick={onClose} aria-label="关闭大图">
        x
      </button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" onClick={(event) => event.stopPropagation()} />
    </div>
  );
}

function Shot({
  src,
  alt,
  caption,
  phone,
  onZoom,
}: {
  src: string;
  alt: string;
  caption?: string;
  phone?: boolean;
  onZoom: (src: string) => void;
}) {
  return (
    <>
      <button
        type="button"
        className={`tutorial-shot${phone ? " phone" : ""}`}
        onClick={() => onZoom(src)}
        aria-label={`放大查看：${alt}`}
      >
        <Image
          src={src}
          alt={alt}
          width={phone ? 1420 : 2864}
          height={1630}
          style={{ width: "100%", height: "auto", display: "block" }}
        />
      </button>
      {caption && <p className="tutorial-caption">{caption}</p>}
    </>
  );
}

const faqItems = [
  ["我是访客，为什么问不了 AI？", "你可能没有座位临时积分。请找房主给你的座位赠送积分，或者让房主下次创建房间时设置「每位玩家积分」。"],
  ["我是访客，名字被占用了怎么办？", "先换一个访客名。如果你必须使用这个名字，联系房主检查房间座位，把占名字的访客移出。"],
  ["为什么我只能聊天，不能询问 AI？", "通常是房主还没有开始题目。请让房主打开「房间详情」里的「海龟汤」，点击「题目 ▾」选择题目。"],
  ["为什么提示按钮不能点？", "可能是没有提示机会。每询问 3 次会获得 1 次提示机会，每尝试推理 1 次也会获得 1 次提示机会。"],
  ["为什么显示积分不足？", "AI 操作需要积分。访客只能用座位临时积分，耗尽时请联系房主在房间详情中赠送积分。登录用户注册即送 100 积分，用完后可发邮件至 support@ai0506.com 联系管理员补充。"],
  ["为什么我问了问题，AI 回「模糊问题」？", "你的问题可能不是是非问题，或者一次问了多个判断。把问题改成一个能回答「是/否」的句子。"],
  ["为什么 AI 没有马上回答？", "同一个房间内 AI 请求会排队处理，避免多人同时提问导致事实冲突。稍等一下即可。如果失败，系统会退还本次积分。"],
  ["为什么临时积分没有跟着人走？", "临时积分绑定座位，不绑定人。可以把它理解成贴在座位上的餐券，而不是玩家口袋里的钱。"],
  ["房主给别人赠送积分时，消耗谁的积分？", "消耗房主个人积分，增加目标座位临时积分。不能用房主自己座位上的临时积分去赠送。"],
] as const;

export default function TutorialPage() {
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [navOpen, setNavOpen] = useState(false);

  const zoom = (src: string) => setLightbox(src);

  return (
    <>
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox(null)} />}

      <div className="tutorial-layout">
        <button
          type="button"
          className="tutorial-nav-toggle"
          onClick={() => setNavOpen((open) => !open)}
          aria-expanded={navOpen}
        >
          目录 {navOpen ? "▲" : "▼"}
        </button>

        <aside className={`tutorial-nav${navOpen ? " open" : ""}`}>
          <div className="tutorial-nav-title">目录</div>
          <ul onClick={() => setNavOpen(false)}>
            <li className="group">概览</li>
            <li><a href="#overview">汤局是什么</a></li>
            <li className="sep" />
            <li className="group">第一部分 · 玩家</li>
            <li><a href="#s1-1">进入房间</a></li>
            <li><a href="#s1-2">界面总览</a></li>
            <li><a href="#s1-3">等待开题</a></li>
            <li><a href="#s1-4">向 AI 询问</a></li>
            <li><a href="#s1-5">请求提示</a></li>
            <li><a href="#s1-6">尝试推理</a></li>
            <li><a href="#s1-7">积分说明</a></li>
            <li className="sep" />
            <li className="group">第二部分 · 房主</li>
            <li><a href="#s2-0">注册账号</a></li>
            <li><a href="#s2-1">创建房间</a></li>
            <li><a href="#s2-2">临时积分</a></li>
            <li><a href="#s2-4">赠送积分</a></li>
            <li><a href="#s2-5">调换位置</a></li>
            <li><a href="#s2-6">踢出玩家</a></li>
            <li><a href="#s2-7">关闭房间</a></li>
            <li className="sep" />
            <li className="group">第三部分 · 海龟汤</li>
            <li><a href="#s3-1">开启题目</a></li>
            <li><a href="#s3-3">进度与事实</a></li>
            <li><a href="#s3-4">切换 / 停止</a></li>
            <li className="sep" />
            <li className="group">通用说明</li>
            <li><a href="#ai-answers">AI 四种回答</a></li>
            <li><a href="#reasoning">推理结果</a></li>
            <li><a href="#modes">模式速查</a></li>
            <li><a href="#faq">常见问题</a></li>
          </ul>
        </aside>

        <main className="tutorial-content">
          <h1>使用教程</h1>
          <p className="tutorial-subtitle">汤局 OnlineSoup · 多人在线海龟汤推理游戏</p>

          <section id="overview">
            <div className="tutorial-overview">
              <p><strong>汤局是什么？</strong> 房主创建房间并选择一道海龟汤题目，玩家进入后向 AI 主持人提问，一步步拼出真相。</p>
              <pre className="tutorial-flow">
                {"房主注册 → 创建房间 → 把房间码发给玩家\n玩家加入（无需注册）→ 房主选题 → 玩家询问 / 提示 / 推理 → 推理成功 → 房主关闭房间"}
              </pre>
            </div>

            <table className="tutorial-table">
              <thead><tr><th>角色</th><th>需要注册吗</th><th>需要积分吗</th></tr></thead>
              <tbody>
                <tr><td>访客 / 普通玩家</td><td><span className="badge badge-no">不需要</span></td><td>需要座位临时积分（房主分配）</td></tr>
                <tr><td>注册玩家</td><td><span className="badge badge-need">推荐</span></td><td>有个人积分，也可以用座位临时积分</td></tr>
                <tr><td>房主</td><td><span className="badge badge-must">必须</span></td><td>需要个人积分用于创建房间</td></tr>
              </tbody>
            </table>
          </section>

          <h2 id="part1"><span className="num">1</span>我收到了房间码，怎么加入？</h2>
          <h3 id="s1-1">1.1 进入房间</h3>
          <p>从房主那里拿到 6 位房间码，在首页输入后加入。如果房间有密码，先输入房主给你的 6 位数字密码；访客还需要填写一个 3 到 8 位的名字。</p>
          <Shot src="/screenshots/1.1mainpageentercode.png" alt="首页输入房间码" caption="首页：输入房间码后点击「加入房间」" onZoom={zoom} />
          <div className="tutorial-tip"><strong>名字冲突？</strong> 说明名字已被占用。换一个名字，或联系房主把同名访客移出。</div>

          <h3 id="s1-2">1.2 进入后先看哪里</h3>
          <p>房间页主要分成「聊天区」和「房间详情」。手机或窄屏上，房间详情默认折叠在上方。</p>
          <div className="tutorial-pair">
            <Shot src="/screenshots/1.2inroomchatandconts_pc.png" alt="PC 端房间页面" onZoom={zoom} />
            <Shot src="/screenshots/1.2inroomchatandconts_phone.png" alt="手机端房间页面" phone onZoom={zoom} />
          </div>
          <p className="tutorial-caption">左：PC 端布局（聊天区 + 右侧房间详情） 右：手机端（房间详情折叠在上方）</p>

          <h3 id="s1-3">1.3 等房主开始题目</h3>
          <p>房主还没选题前，你只能普通聊天。房主选择题目后，「询问」「提示」「尝试推理」模式会解锁。</p>
          <div className="tutorial-tip">看到“房主开始题目后，才能使用询问 / 提示 / 尝试推理”？说明还没开题，等房主在「海龟汤」里选择题目。</div>

          <h3 id="s1-4">1.4 怎么向 AI 询问</h3>
          <p>切换到「询问」模式，输入一个可以用“是 / 否”判断的问题，再发送。</p>
          <Shot src="/screenshots/1.4howtoask.png" alt="聊天区询问模式" caption="聊天区底部：四种模式切换按钮和输入框" onZoom={zoom} />
          <p><strong>推荐：</strong>“死者是自杀吗？” “故事发生在医院吗？” “男人之前见过这个人吗？”</p>
          <p><strong>不推荐：</strong>“为什么他要这么做？”不是是非题；“他是医生并且认识死者吗？”一次问了两件事。</p>

          <h3 id="s1-5">1.5 怎么请求提示</h3>
          <p>切换到「提示」模式，写下你卡住的方向或直接写“给我提示”。请求提示需要 1 积分和 1 次提示机会。</p>
          <p>提示机会的获得方式：每完成 3 次询问 +1 次，每尝试推理 1 次 +1 次。</p>

          <h3 id="s1-6">1.6 怎么尝试推理</h3>
          <p>切换到「尝试推理」模式，用 200 字以内写出完整推理。发送后 AI 会判定「推理正确」「部分正确」或「推理不正确」。</p>

          <h3 id="s1-7">1.7 积分说明</h3>
          <Shot src="/screenshots/1.7tempsandaccountscore.png" alt="积分显示区域" caption="积分显示：个人积分 + 座位临时积分 [临]" onZoom={zoom} />
          <table className="tutorial-table">
            <thead><tr><th>操作</th><th>消耗</th></tr></thead>
            <tbody>
              <tr><td>询问</td><td>1 积分</td></tr>
              <tr><td>提示</td><td>1 积分 + 1 次提示机会</td></tr>
              <tr><td>尝试推理</td><td>2 积分</td></tr>
            </tbody>
          </table>
          <div className="tutorial-tip"><strong>访客没有个人积分</strong>，只能用座位临时积分（<code>[临]</code>）。临时积分耗尽请联系房主在房间详情中赠送积分。<strong>登录用户注册即送 100 积分</strong>，用完后可发邮件至 <a href="mailto:support@ai0506.com">support@ai0506.com</a> 联系管理员补充。</div>
          <p>刷新或关掉标签页后重新打开，只要房间未关闭，访客身份和座位都会自动恢复。</p>

          <h2 id="part2"><span className="num">2</span>我想当房主，怎么开房？</h2>
          <h3 id="s2-0">2.0 先注册账号</h3>
          <p>当房主必须登录账号。没有账号时，点击右上角「登录 / 注册」，切到注册并填写邮箱和密码。</p>
          <Shot src="/screenshots/2.0register.png" alt="注册页面" caption="注册页：填写邮箱和密码，注册后会有初始积分" onZoom={zoom} />

          <h3 id="s2-1">2.1 创建房间</h3>
          <Shot src="/screenshots/2.1createroom.png" alt="创建房间表单" caption="创建房间：设置座位数量、每位玩家积分和可选密码" onZoom={zoom} />
          <ol>
            <li>登录后点击「创建房间」。</li>
            <li>填写房间名称、座位数量、每位玩家积分和可选密码。</li>
            <li>创建成功后复制房间码发给玩家。</li>
          </ol>
          <div className="tutorial-tip"><strong>积分消耗 = 座位数量 × 每位玩家积分。</strong>例如 5 座 × 10 分 = 消耗 50 个人积分。关闭房间时剩余临时积分会退还房主。</div>

          <h3 id="s2-2">2.2 临时积分建议</h3>
          <ul>
            <li>纯聊天 / 测试：设为 0。</li>
            <li>正常海龟汤：建议 5 到 20。</li>
            <li>新手局或长题：可以更高。</li>
          </ul>
          <p>访客没有个人积分。如果希望访客能问 AI，创建房间时最好给每个座位设置初始积分。</p>

          <h3 id="s2-4">2.4 怎么给玩家赠送积分</h3>
          <Shot src="/screenshots/2.4sendtempscore.png" alt="赠送积分操作" caption="「房间管理」标签 → 座位右上角菜单 → 赠送积分" onZoom={zoom} />
          <p>打开「房间详情」里的「房间管理」，找到目标座位，点右上角菜单选择「赠送积分」。赠送消耗房主个人积分，增加目标座位临时积分。</p>

          <h3 id="s2-5">2.5 怎么调换玩家位置</h3>
          <p>在「房间管理」里找到要移动的玩家座位，点击菜单里的「移动位置」，再选择一个空座位。房主座位不能移动。</p>

          <h3 id="s2-6">2.6 怎么踢出玩家</h3>
          <p>在「房间管理」中找到玩家座位，点击菜单里的「移出房间」。被移出的玩家会离开房间，原座位空出来。</p>

          <h3 id="s2-7">2.7 怎么关闭房间</h3>
          <p>房主需要使用「关闭房间」。关闭后所有玩家会离开，所有座位剩余临时积分会汇总退还给房主个人积分。</p>

          <h2 id="part3"><span className="num">3</span>我是房主，怎么开启海龟汤？</h2>
          <h3 id="s3-1">3.1 开启题目</h3>
          <div className="tutorial-pair">
            <Shot src="/screenshots/3.1switchtosouptab.png" alt="切换到海龟汤标签" onZoom={zoom} />
            <Shot src="/screenshots/3.1chooseapuzzle.png" alt="选择题目列表" onZoom={zoom} />
          </div>
          <p className="tutorial-caption">左：「海龟汤」标签 → 点击「题目 ▾」展开菜单 右：题库列表，可按难度筛选</p>
          <p>打开「房间详情」里的「海龟汤」标签，点击「题目 ▾」选择题目。开始后所有玩家的 AI 模式都会可用。</p>

          <h3 id="s3-3">3.3 进度与事实总结</h3>
          <p>「事实总结」像公共白板。AI 确认过的关键事实会整理到这里，方便大家继续推理。</p>

          <h3 id="s3-4">3.4 切换 / 停止题目</h3>
          <p>「切换题目」会中止当前题目并选择新题，AI 不会把旧题事实混进新题；「停止题目」会让玩家回到普通聊天状态。</p>

          <h2 id="ai-answers"><span className="num">4</span>AI 询问的四种回答</h2>
          <div className="tutorial-ai-tags">
            <span className="ai-tag tag-yes">是</span>
            <span className="ai-tag tag-no">否</span>
            <span className="ai-tag tag-irr">与此无关</span>
            <span className="ai-tag tag-amb">模糊问题</span>
          </div>
          <table className="tutorial-table">
            <thead><tr><th>回答</th><th>含义</th></tr></thead>
            <tbody>
              <tr><td>是</td><td>你的判断被汤底明确支持。</td></tr>
              <tr><td>否</td><td>你的判断和汤底明确冲突。</td></tr>
              <tr><td>与此无关</td><td>这件事就算知道了，也不影响解谜主线。</td></tr>
              <tr><td>模糊问题</td><td>问题不适合用是/否回答，建议换一种问法。</td></tr>
            </tbody>
          </table>

          <h2 id="reasoning"><span className="num">5</span>尝试推理的三种结果</h2>
          <table className="tutorial-table">
            <thead><tr><th>结果</th><th>含义</th></tr></thead>
            <tbody>
              <tr><td><strong style={{ color: "#065f46" }}>推理正确</strong></td><td>覆盖了大部分关键事实，题目会标记为已推理成功。</td></tr>
              <tr><td><strong style={{ color: "#92400e" }}>部分正确</strong></td><td>抓到了一部分关键事实，但还缺重要环节。</td></tr>
              <tr><td><strong style={{ color: "#991b1b" }}>推理不正确</strong></td><td>关键事实太少，方向可能需要调整。</td></tr>
            </tbody>
          </table>

          <h2 id="modes"><span className="num">6</span>聊天区四种模式速查</h2>
          <table className="tutorial-table">
            <thead><tr><th>模式</th><th>用途</th><th>消耗</th><th>字数限制</th></tr></thead>
            <tbody>
              <tr><td>聊天</td><td>普通聊天，不问 AI</td><td>0</td><td>500 字</td></tr>
              <tr><td>询问</td><td>向 AI 问一个是非判断</td><td>1 积分</td><td>50 字</td></tr>
              <tr><td>提示</td><td>请求 AI 给一点线索</td><td>1 积分 + 1 次提示机会</td><td>50 字</td></tr>
              <tr><td>尝试推理</td><td>提交你认为的完整真相</td><td>2 积分</td><td>200 字</td></tr>
            </tbody>
          </table>

          <h2 id="faq"><span className="num">7</span>常见问题</h2>
          {faqItems.map(([question, answer]) => (
            <div key={question} className="faq-item">
              <div className="faq-q">{question}</div>
              <div className="faq-a">{answer}</div>
            </div>
          ))}
        </main>
      </div>
    </>
  );
}
