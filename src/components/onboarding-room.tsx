"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { createClient } from "@/lib/supabase/client";

// 上手教程：复刻真实房间页的结构和样式，但所有数据都是本地预设，
// 不调用任何房间接口或 AI，也不会写入任何真实房间。

const PUZZLE = {
  title: "撕掉的彩票",
  difficulty: "简单",
  surface: "男人发现手里的彩票中了头奖，却毫不犹豫地把它撕了，还松了一口气。",
};
const PRESET_QUESTION = "这张彩票和他的工作有关吗？";
const PRESET_ANSWER = "是";
const PRESET_FACT = "彩票和男人的工作有关";
const DIFFICULTIES = ["简单", "中等", "困难", "抽象"] as const;

const PAD = 6;
const CARD_GAP = 12;

type StepId =
  | "intro"
  | "open-puzzle-tab"
  | "open-menu"
  | "choose"
  | "pick"
  | "start"
  | "current"
  | "back-to-chat"
  | "pick-ask"
  | "typing"
  | "send"
  | "answer"
  | "facts"
  | "done";

type Step = {
  id: StepId;
  /** 按顺序尝试，取第一个有可见元素的选择器，多个匹配时合并成一个高亮区域；为空表示居中卡片 */
  targets: string[];
  title: string;
  body: string;
  /** 只在手机竖屏 / 非竖屏布局下出现的步骤 */
  only?: "portrait" | "landscape";
  /** 不需要点高亮元素，用卡片上的「下一步」继续 */
  manual?: boolean;
  /** 竖屏时这一步需要显示的分段；不填则沿用用户自己切到的分段 */
  view?: "chat" | "puzzle";
};

const STEPS: Step[] = [
  {
    id: "intro",
    targets: [],
    title: "上手教程",
    body: "跟着高亮的地方点一遍，1 分钟学会怎么开题、怎么问 AI。这是教程房间，不会影响任何真实房间，也不消耗积分。",
  },
  {
    id: "open-puzzle-tab",
    targets: ['[data-t="seg-puzzle"]', '[data-t="tab-puzzle"]', '[data-t="summary"]'],
    title: "打开题目",
    body: "房间刚建好时还没有题目。题目相关的操作都在这里。",
  },
  {
    id: "open-menu",
    view: "puzzle",
    targets: ['[data-t="puzzle-menu"]'],
    title: "房主来开题",
    body: "只有房主有这个按钮。点开它。",
  },
  {
    id: "choose",
    view: "puzzle",
    targets: ['[data-t="menu-select"]'],
    title: "选择题目",
    body: "点「选择题目」打开题库。",
  },
  {
    id: "pick",
    view: "puzzle",
    targets: ['[data-t="puzzle-item"]'],
    title: "挑一道题",
    body: "题库按难度分类。点这道题看看题面。",
  },
  {
    id: "start",
    view: "puzzle",
    targets: ['[data-t="preview-dialog"]'],
    title: "开始这道题",
    body: "题面是所有人都能看到的谜面。点「开始这道题」，大家就可以向 AI 提问了。",
  },
  {
    id: "current",
    view: "puzzle",
    targets: ['[data-t="current-card"]'],
    title: "题目开始了",
    body: "题面会一直显示在这里。下方的「事实总结」会自动收集大家问出来的线索。",
    manual: true,
  },
  {
    id: "back-to-chat",
    targets: ['[data-t="seg-chat"]'],
    title: "回到聊天",
    body: "去聊天区提问。",
    only: "portrait",
  },
  {
    id: "pick-ask",
    view: "chat",
    targets: ['[data-t="mode-ask"]'],
    title: "切到「询问」",
    body: "「聊天」只发给房间里的人，AI 不会回答。要问 AI 主持，得先切到「询问」，每次消耗 1 积分。",
  },
  {
    id: "typing",
    view: "chat",
    targets: ['[data-t="chat-input"]'],
    title: "问一个是非题",
    body: "我们帮你写好了一个问题。好问题要能用「是 / 否」回答，一次只问一件事。",
  },
  {
    id: "send",
    view: "chat",
    targets: ['[data-t="chat-form"]'],
    title: "发送问题",
    body: "点「发送」，把问题交给 AI 主持。",
  },
  {
    id: "answer",
    view: "chat",
    targets: ['[data-t="qa"]'],
    title: "看 AI 的回答",
    body: "AI 只会答「是」「否」「与此无关」或「模糊问题」，你的问题也会按答案变色。「归纳」是 AI 帮大家记下的线索。",
    manual: true,
  },
  {
    id: "facts",
    view: "puzzle",
    targets: ['[data-t="facts"]'],
    title: "事实总结",
    body: "问出来的线索会汇总到这里，所有人都能看到。",
    only: "landscape",
    manual: true,
  },
  {
    id: "done",
    targets: [],
    title: "上手完成！",
    body: "就这样一问一答，慢慢拼出真相。卡住时可以用「提示」，想好了用「尝试推理」提交完整答案。更多说明在顶部的「教程」里。",
  },
];

type Rect = { top: number; left: number; width: number; height: number };

type TutorialMessage =
  | { id: number; kind: "system"; text: string; time: string }
  | { id: number; kind: "ask"; text: string; time: string }
  | { id: number; kind: "ai"; time: string };

const timeFmt = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function nowTime() {
  return timeFmt.format(new Date());
}

function visibleRects(selectors: string[]): DOMRect[] {
  for (const selector of selectors) {
    const rects = Array.from(document.querySelectorAll<HTMLElement>(selector))
      .map((el) => el.getBoundingClientRect())
      .filter((r) => r.width > 0 && r.height > 0);
    if (rects.length > 0) return rects;
  }
  return [];
}

function useMedia(query: string) {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);
  return matches;
}

export function OnboardingRoom({
  userId,
  username,
  points,
}: {
  userId?: string;
  username: string;
  points: number;
}) {
  const router = useRouter();
  const portrait = useMedia("(orientation: portrait) and (max-width: 760px)");
  const wideLayout = useMedia("(min-width: 880px) and (min-aspect-ratio: 6 / 5)");
  const tabletLandscape = useMedia("(min-width: 640px) and (max-width: 879px) and (orientation: landscape)");
  const [detailsOpen, setDetailsOpen] = useState(false);

  const [stepIndex, setStepIndex] = useState(0);
  const [rect, setRect] = useState<Rect | null>(null);
  const [cardStyle, setCardStyle] = useState<React.CSSProperties | null>(null);

  const [portraitTab, setPortraitTab] = useState<"chat" | "puzzle">("chat");
  const [activeTab, setActiveTab] = useState<"manage" | "puzzle">("manage");
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const [dialog, setDialog] = useState<"select" | "preview" | null>(null);
  const [started, setStarted] = useState(false);
  const [mode, setMode] = useState<"chat" | "ask">("chat");
  const [content, setContent] = useState("");
  const [thinking, setThinking] = useState(false);
  const [answered, setAnswered] = useState(false);
  const [messages, setMessages] = useState<TutorialMessage[]>(() => [
    { id: 1, kind: "system", text: `${username} 加入了房间`, time: nowTime() },
  ]);

  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const messageListRef = useRef<HTMLDivElement>(null);
  const layoutRef = useRef<HTMLElement>(null);

  const applies = useCallback(
    (s: Step) => !s.only || (s.only === "portrait") === portrait,
    [portrait],
  );
  // 不适用于当前布局的步骤（如旋转屏幕后）直接顺延到下一个适用步骤
  let currentIndex = stepIndex;
  while (currentIndex < STEPS.length - 1 && !applies(STEPS[currentIndex])) currentIndex += 1;
  const step = STEPS[currentIndex];
  // 竖屏下按步骤需要强制显示对应分段，避免中途旋转/缩放后目标被藏起来
  const shownTab = step.view ?? portraitTab;

  // 与真实房间一致：竖屏时把分段写到 .room-layout 上，由 CSS 控制聊天/详情显隐
  useEffect(() => {
    const layout = layoutRef.current;
    if (!layout) return;
    if (portrait) layout.dataset.portraitTab = shownTab;
    else delete layout.dataset.portraitTab;
  }, [portrait, shownTab]);

  const [finishing, setFinishing] = useState(false);
  const finish = useCallback(async () => {
    if (finishing) return;
    setFinishing(true);
    if (userId) {
      // 记录失败不阻塞用户，最多下次登录再进一次教程
      const { error } = await createClient().rpc("complete_onboarding");
      if (error) console.error("Complete onboarding failed", error.message);
    }
    router.push("/");
  }, [finishing, router, userId]);

  const next = useCallback(() => {
    setStepIndex(Math.min(currentIndex + 1, STEPS.length - 1));
  }, [currentIndex]);

  const measure = useCallback(() => {
    const current = STEPS[currentIndex];
    const rects = current.targets.length > 0 ? visibleRects(current.targets) : [];
    if (rects.length === 0) {
      setRect(null);
      setCardStyle(null);
      return;
    }
    const top = Math.min(...rects.map((r) => r.top)) - PAD;
    const left = Math.min(...rects.map((r) => r.left)) - PAD;
    const bottom = Math.max(...rects.map((r) => r.bottom)) + PAD;
    const right = Math.max(...rects.map((r) => r.right)) + PAD;
    const hole: Rect = { top, left, width: right - left, height: bottom - top };
    setRect(hole);

    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const cardWidth = Math.min(320, vw - 32);
    const cardLeft = Math.min(Math.max(16, left + hole.width / 2 - cardWidth / 2), vw - cardWidth - 16);
    const spaceBelow = vh - bottom;
    const spaceRight = vw - right;
    const sideTop = Math.min(Math.max(16, top), vh - 200);
    if (spaceBelow >= 200) {
      setCardStyle({ width: cardWidth, left: cardLeft, top: bottom + CARD_GAP });
    } else if (top >= 200) {
      setCardStyle({ width: cardWidth, left: cardLeft, bottom: vh - top + CARD_GAP });
    } else if (spaceRight >= cardWidth + CARD_GAP + 16) {
      setCardStyle({ width: cardWidth, left: right + CARD_GAP, top: sideTop });
    } else if (left >= cardWidth + CARD_GAP + 16) {
      setCardStyle({ width: cardWidth, left: left - CARD_GAP - cardWidth, top: sideTop });
    } else {
      setCardStyle({ width: cardWidth, left: cardLeft, bottom: 16 });
    }
  }, [currentIndex]);

  useLayoutEffect(() => {
    const frame = window.requestAnimationFrame(measure);
    return () => window.cancelAnimationFrame(frame);
  }, [measure, messages, dialog, menuPos, activeTab, shownTab, started, portrait, detailsOpen]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") void finish();
    };
    window.addEventListener("resize", measure);
    window.addEventListener("scroll", measure, true);
    window.addEventListener("keydown", onKey);
    const timer = window.setInterval(measure, 300);
    return () => {
      window.removeEventListener("resize", measure);
      window.removeEventListener("scroll", measure, true);
      window.removeEventListener("keydown", onKey);
      window.clearInterval(timer);
    };
  }, [measure, finish]);

  // 与真实题目菜单一致：窗口变化时菜单跟随按钮位置
  const menuOpen = menuPos !== null;
  useEffect(() => {
    if (!menuOpen) return;
    const update = () => {
      const trigger = menuTriggerRef.current;
      if (!trigger) return;
      const r = trigger.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    };
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [menuOpen]);

  // 预设问题逐字写入输入框
  useEffect(() => {
    if (step.id !== "typing") return;
    let count = 0;
    let doneTimer = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setContent(PRESET_QUESTION.slice(0, count));
      if (count >= PRESET_QUESTION.length) {
        window.clearInterval(timer);
        doneTimer = window.setTimeout(next, 500);
      }
    }, 90);
    return () => {
      window.clearInterval(timer);
      window.clearTimeout(doneTimer);
    };
  }, [step.id, next]);

  useEffect(() => {
    const list = messageListRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages, thinking]);

  const pushMessage = (
    message: { kind: "system"; text: string } | { kind: "ask"; text: string } | { kind: "ai" },
  ) => setMessages((list) => [...list, { ...message, id: list.length + 1, time: nowTime() }]);

  const onOpenPuzzleTab = () => {
    if (step.id !== "open-puzzle-tab") return;
    setDetailsOpen(true);
    setActiveTab("puzzle");
    setPortraitTab("puzzle");
    next();
  };

  const onOpenMenu = () => {
    if (step.id !== "open-menu") return;
    const trigger = menuTriggerRef.current;
    if (trigger) {
      const r = trigger.getBoundingClientRect();
      setMenuPos({ top: r.bottom + 4, right: window.innerWidth - r.right });
    }
    next();
  };

  const onChoose = () => {
    if (step.id !== "choose") return;
    setMenuPos(null);
    setDialog("select");
    next();
  };

  const onPick = () => {
    if (step.id !== "pick") return;
    setDialog("preview");
    next();
  };

  const onStart = () => {
    if (step.id !== "start") return;
    setDialog(null);
    setStarted(true);
    pushMessage({ kind: "system", text: `【开始题目】${PUZZLE.title}（${PUZZLE.difficulty}）` });
    next();
  };

  const onBackToChat = () => {
    if (step.id !== "back-to-chat") return;
    setPortraitTab("chat");
    next();
  };

  const onPickAsk = () => {
    if (step.id !== "pick-ask") return;
    setMode("ask");
    setContent("");
    next();
  };

  const onSend = () => {
    if (step.id !== "send" || thinking) return;
    pushMessage({ kind: "ask", text: PRESET_QUESTION });
    setContent("");
    setThinking(true);
    window.setTimeout(() => {
      setThinking(false);
      setAnswered(true);
      pushMessage({ kind: "ai" });
      next();
    }, 1500);
  };

  const countedSteps = STEPS.filter((s) => s.targets.length > 0 && applies(s));
  const position = countedSteps.indexOf(step) + 1;
  const needsClick = step.targets.length > 0 && !step.manual && step.id !== "typing" && !thinking;
  const maxLength = mode === "ask" ? 100 : 300;
  const pointsDisplay = String(points);

  return (
    <>
      <section className="room-layout" ref={layoutRef}>
        <main className="room-chat-panel">
          <section className="room-chat">
            <div className="room-chat-heading">
              <h2>聊天</h2>
            </div>

            <div aria-live="polite" className="message-list" ref={messageListRef}>
              {messages.map((m) =>
                m.kind === "system" ? (
                  <div className="system-message" key={m.id}>
                    <span>{m.text}</span>
                    <time suppressHydrationWarning>{m.time}</time>
                  </div>
                ) : m.kind === "ask" ? (
                  <div key={m.id}>
                    <article
                      className={`chat-message${answered ? " ask-answer-yes" : ""}`}
                      data-t="qa"
                    >
                      <div className="chat-message-meta">
                        <strong>{username}</strong>
                        <span>[1]</span>
                        <span>[已注册]</span>
                        <span className="chat-mode-badge">询问</span>
                      </div>
                      <div className="chat-message-body">
                        <p>{m.text}</p>
                        <time suppressHydrationWarning>{m.time}</time>
                      </div>
                    </article>
                    {thinking && (
                      <div className="pending-ai-indicator">
                        <span className="pending-ai-label">AI主持</span>
                        <span className="pending-ai-dots" aria-label="回复中">
                          <span />
                          <span />
                          <span />
                        </span>
                      </div>
                    )}
                  </div>
                ) : (
                  <article className="chat-message ai-message" data-t="qa" key={m.id}>
                    <div className="chat-message-meta">
                      <strong>AI主持</strong>
                    </div>
                    <div className="chat-message-body">
                      <div className="ai-message-content">
                        <p>
                          <span className="ai-message-label">回复</span>
                          {PRESET_ANSWER}
                        </p>
                        <p className="ai-message-fact">归纳：{PRESET_FACT}</p>
                      </div>
                      <time suppressHydrationWarning>{m.time}</time>
                    </div>
                  </article>
                ),
              )}
            </div>

            <form className="chat-form" data-t="chat-form" onSubmit={(e) => e.preventDefault()}>
              <div className="chat-mode-tabs">
                <button className={`chat-mode-tab${mode === "chat" ? " active" : ""}`} tabIndex={-1} type="button">
                  聊天
                </button>
                <button
                  className={`chat-mode-tab${mode === "ask" ? " active" : ""}`}
                  data-t="mode-ask"
                  disabled={!started}
                  onClick={onPickAsk}
                  title={started ? undefined : "需要先选择题目才能使用"}
                  type="button"
                >
                  询问<span className="chat-mode-cost">1pt</span>
                </button>
                <button
                  className="chat-mode-tab"
                  disabled
                  tabIndex={-1}
                  title={started ? "提问 3 次或完成一次推理可获得提示机会" : "需要先选择题目才能使用"}
                  type="button"
                >
                  提示<span className="chat-mode-cost">1pt</span>
                </button>
                <button className="chat-mode-tab" disabled={!started} tabIndex={-1} type="button">
                  尝试推理<span className="chat-mode-cost">2pt</span>
                </button>
              </div>

              <p className={`chat-mode-locked-hint muted${started ? " chat-mode-locked-hint--hidden" : ""}`}>
                房主开始题目后，才能使用询问 / 提示 / 尝试推理
              </p>

              <textarea
                aria-label={mode === "ask" ? "询问" : "聊天"}
                data-t="chat-input"
                maxLength={maxLength}
                placeholder={
                  mode === "ask"
                    ? "向 AI 提问（100 字以内），消耗 1 积分"
                    : "输入普通聊天内容，Enter 发送，Shift+Enter 换行"
                }
                readOnly
                rows={3}
                tabIndex={-1}
                value={content}
              />

              <div className="chat-form-footer">
                <span className="chat-char-count">
                  {content.length}/{maxLength}
                </span>
                <span className="chat-footer-center">
                  {mode === "ask" && <span className="chat-points-info">0[临] + {points}</span>}
                  {started && mode !== "chat" && (
                    <span className="chat-hint-tokens-info muted">提示机会 0 次</span>
                  )}
                </span>
                <button
                  className="button"
                  disabled={thinking || !content.trim()}
                  onClick={onSend}
                  type="button"
                >
                  {thinking ? "发送中..." : "发送"}
                </button>
              </div>
            </form>
          </section>
        </main>

        <details className="room-details" open={wideLayout || tabletLandscape || portrait || detailsOpen}>
          <div className="room-portrait-bar">
            <span className="room-portrait-title">
              <strong>上手教程</strong>
              <span />
            </span>
            <span className="room-portrait-points">{pointsDisplay}</span>
          </div>
          <div className="room-seg-nav" role="tablist">
            <button
              className={`room-seg-btn${shownTab === "chat" ? " active" : ""}`}
              data-t="seg-chat"
              onClick={onBackToChat}
              type="button"
            >
              聊天
            </button>
            <button
              className={`room-seg-btn${shownTab === "puzzle" ? " active" : ""}`}
              data-t="seg-puzzle"
              onClick={onOpenPuzzleTab}
              type="button"
            >
              题目
            </button>
            <button className="room-seg-btn" tabIndex={-1} type="button">
              座位 <span className="room-seg-count">1</span>
            </button>
          </div>
          {shownTab === "chat" && started && (
            <button className="room-pinned-puzzle" tabIndex={-1} type="button">
              <span className="room-pinned-diff">{PUZZLE.difficulty}</span>
              <span className="room-pinned-text">{PUZZLE.surface}</span>
              <span className="room-pinned-go">看题 ›</span>
            </button>
          )}

          <summary
            data-t="summary"
            onClick={(e) => {
              e.preventDefault();
              onOpenPuzzleTab();
            }}
          >
            <span className="room-summary-title">
              <strong>上手教程</strong>
              <span />
            </span>
            <span className="room-occupancy">1/2 人</span>
            <span className="room-summary-points">{pointsDisplay}</span>
          </summary>

          <div className="room-tabs room-tabs-stable">
            <button
              className={`room-tab${activeTab === "manage" ? " active" : ""}`}
              tabIndex={-1}
              type="button"
            >
              房间管理
            </button>
            <button
              className={`room-tab${activeTab === "puzzle" ? " active" : ""}`}
              data-t="tab-puzzle"
              onClick={onOpenPuzzleTab}
              type="button"
            >
              海龟汤
            </button>
          </div>

          <div className="room-details-content">
            <div className="room-puzzle-tab" hidden={activeTab !== "puzzle"}>
              <div className="room-puzzle-section">
                <div className="puzzle-section-header">
                  <span className="puzzle-section-label">当前题目</span>
                  <div className="puzzle-owner-menu">
                    <button
                      className="button small puzzle-menu-trigger"
                      data-t="puzzle-menu"
                      onClick={onOpenMenu}
                      ref={menuTriggerRef}
                      type="button"
                    >
                      题目 ▾
                    </button>
                  </div>
                </div>

                {started ? (
                  <div className="puzzle-current-card" data-t="current-card">
                    <div className="puzzle-current-meta">
                      <span className="puzzle-diff-badge puzzle-diff-easy">{PUZZLE.difficulty}</span>
                      <span className="puzzle-current-title">{PUZZLE.title}</span>
                      <span className="puzzle-unsolved-badge">○ 进行中</span>
                    </div>
                    <div className="puzzle-surface-block">
                      <p className="puzzle-surface-text">{PUZZLE.surface}</p>
                    </div>
                    <div className="puzzle-facts-section" data-t="facts">
                      <div className="puzzle-facts-header">
                        <span className="puzzle-facts-label">事实总结</span>
                      </div>
                      {answered ? (
                        <ul className="puzzle-facts-list">
                          <li>{PRESET_FACT}</li>
                        </ul>
                      ) : (
                        <p className="puzzle-facts-empty muted">
                          暂无已确认事实，向 AI 提问或请求提示后系统会自动归纳在这里。
                        </p>
                      )}
                    </div>
                  </div>
                ) : (
                  <p className="puzzle-empty-hint muted">点击「题目 ▾」开始本局题目</p>
                )}
              </div>
            </div>

            <div className="room-manage-tab" hidden={activeTab !== "manage"}>
              <div className="room-details-code">
                <span className="room-code-label">房间码</span>
                <div className="room-code-row">
                  <span className="room-code">——</span>
                </div>
              </div>
              <div className="room-detail-meta">
                <span>不预留积分</span>
                <span>无需密码</span>
              </div>
              <div className="seat-grid">
                <div className="seat occupied">
                  <span className="seat-number">1</span>
                  <span className="seat-status-dot online" title="在线" />
                  <strong className="seat-name">{username}</strong>
                  <span className="seat-id-badge owner">房主</span>
                </div>
                <div className="seat">
                  <span className="seat-number">2</span>
                  <span className="seat-status-dot empty" title="空位" />
                  <strong className="seat-name">等待玩家</strong>
                </div>
              </div>
            </div>
          </div>
        </details>
      </section>

      {menuPos && (
        <div className="puzzle-menu-popover puzzle-menu-popover-fixed" style={{ top: menuPos.top, right: menuPos.right }}>
          <button className="puzzle-menu-item" data-t="menu-select" onClick={onChoose} type="button">
            选择题目
          </button>
        </div>
      )}

      {dialog === "select" && (
        <div className="move-seat-overlay" role="dialog" aria-modal="true" aria-label="选择题目">
          <div className="move-seat-dialog puzzle-list-dialog">
            <div className="move-seat-header">
              <span>选择题目</span>
              <button className="move-seat-close" tabIndex={-1} type="button">
                ✕
              </button>
            </div>
            <div className="puzzle-filter-tabs">
              <button className="puzzle-filter-tab active" tabIndex={-1} type="button">
                全部
              </button>
              {DIFFICULTIES.map((d) => (
                <button className="puzzle-filter-tab" key={d} tabIndex={-1} type="button">
                  {d}
                </button>
              ))}
            </div>
            <div className="puzzle-list">
              <button className="puzzle-list-item" data-t="puzzle-item" onClick={onPick} type="button">
                <span className="puzzle-list-item-left">
                  <span className="puzzle-diff-badge puzzle-diff-easy">{PUZZLE.difficulty}</span>
                  <span className="puzzle-list-title">{PUZZLE.title}</span>
                </span>
                <span className="puzzle-list-item-right" />
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog === "preview" && (
        <div className="move-seat-overlay" role="dialog" aria-modal="true" aria-label="确认开始题目">
          <div className="move-seat-dialog puzzle-preview-dialog" data-t="preview-dialog">
            <div className="move-seat-header">
              <span>确认开始题目</span>
              <button className="move-seat-close" tabIndex={-1} type="button">
                ✕
              </button>
            </div>
            <div className="puzzle-preview-meta">
              <span className="puzzle-diff-badge puzzle-diff-easy">{PUZZLE.difficulty}</span>
              <strong className="puzzle-preview-title">{PUZZLE.title}</strong>
            </div>
            <div className="puzzle-preview-surface">
              <p>{PUZZLE.surface}</p>
            </div>
            <div className="puzzle-confirm-actions">
              <button className="button secondary" tabIndex={-1} type="button">
                返回列表
              </button>
              <button className="button" onClick={onStart} type="button">
                开始这道题
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 遮罩：只在高亮区域留洞，其余全部挡住点击 */}
      {rect ? (
        <>
          <div className="onboard-dim" style={{ top: 0, left: 0, right: 0, height: Math.max(0, rect.top) }} />
          <div className="onboard-dim" style={{ top: rect.top + rect.height, left: 0, right: 0, bottom: 0 }} />
          <div
            className="onboard-dim"
            style={{ top: rect.top, left: 0, width: Math.max(0, rect.left), height: rect.height }}
          />
          <div
            className="onboard-dim"
            style={{ top: rect.top, left: rect.left + rect.width, right: 0, height: rect.height }}
          />
          <div
            className={`onboard-hole${needsClick ? " onboard-hole--pulse" : ""}`}
            style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
          />
          {!needsClick && (
            <div
              className="onboard-guard"
              style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }}
            />
          )}
        </>
      ) : (
        <div className="onboard-dim" style={{ inset: 0 }} />
      )}

      <button className="onboard-skip" onClick={() => void finish()} type="button">
        跳过教程
      </button>

      <div
        aria-label={step.title}
        className={`onboard-card${cardStyle ? "" : " onboard-card--center"}`}
        role="dialog"
        style={cardStyle ?? undefined}
      >
        <div className="onboard-card-head">
          <strong>{step.title}</strong>
          {position > 0 && (
            <span className="onboard-progress">
              {position}/{countedSteps.length}
            </span>
          )}
        </div>
        <p>{thinking ? "AI 主持正在思考，稍等一下…" : step.body}</p>
        <div className="onboard-actions">
          {step.id === "intro" ? (
            <>
              <button className="button secondary" onClick={() => void finish()} type="button">
                跳过
              </button>
              <button className="button" onClick={next} type="button">
                开始
              </button>
            </>
          ) : step.id === "done" ? (
            <button className="button" onClick={() => void finish()} type="button">
              完成
            </button>
          ) : step.manual ? (
            <button className="button" onClick={next} type="button">
              下一步
            </button>
          ) : (
            !thinking && (
              <span className="onboard-tip">{step.id === "typing" ? "正在输入…" : "点击高亮的按钮继续"}</span>
            )
          )}
        </div>
      </div>
    </>
  );
}
