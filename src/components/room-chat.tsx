"use client";

import {
  type ReactNode,
  FormEvent,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { createClient } from "@/lib/supabase/client";
import type { MessageMode, RoomMessage } from "@/lib/types";

const MODES = [
  { key: "chat"   as MessageMode, label: "聊天",   cost: 0, maxLength: 500 },
  { key: "ask"    as MessageMode, label: "询问",   cost: 1, maxLength: 50  },
  { key: "hint"   as MessageMode, label: "提示",   cost: 1, maxLength: 50  },
  { key: "reason" as MessageMode, label: "尝试推理", cost: 2, maxLength: 200 },
] as const;

const MODE_LABEL: Record<MessageMode, string> = {
  chat:   "聊天",
  ask:    "询问",
  hint:   "提示",
  reason: "推理",
};

// 待回复的 AI 请求超时阈值：超过此时间仍无 AI 消息则不再显示"回复中"
const PENDING_AI_TIMEOUT_MS = 90_000;

type RoomChatProps = {
  initialMessages: RoomMessage[];
  roomCode: string;
  roomId: string;
  seatId?: string | null;
  currentUserId?: string;
  initialPersonalPoints?: number;
  initialSeatPoints?: number;
  initialHintTokens?: number;
  initialHasPuzzle?: boolean;
  initialPuzzleId?: number | null;
  senderName?: string;
  senderSeatNumber?: number;
  senderType?: "registered" | "guest";
};

type ConfirmState = {
  content: string;
  mode: MessageMode;
};

type AiMessageContent = {
  kind: "answer" | "hint" | "reasoning_result" | "reveal";
  text: string;
  fact_summary?: string | null;
};

const ANSWER_COLOR_CLASS: Record<string, string> = {
  是: "ask-answer-yes",
  否: "ask-answer-no",
  与此无关: "ask-answer-irrelevant",
  模糊问题: "ask-answer-ambiguous",
};

// 每条消息的去重 key（用于判断临时消息是否已有真实消息对应）
function messageKey(message: RoomMessage) {
  return `${message.seat_id}|${message.message_mode}|${message.content}`;
}

function mergeMessages(current: RoomMessage[], incoming: RoomMessage[]) {
  const byId = new Map(current.map((m) => [m.id, m]));
  for (const m of incoming) byId.set(m.id, m);
  return Array.from(byId.values())
    .sort(
      (a, b) =>
        new Date(a.created_at).getTime() - new Date(b.created_at).getTime() ||
        a.id - b.id,
    )
    .slice(-100);
}

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit",
  hour12: false,
});

function getSystemMessageContent(message: RoomMessage) {
  switch (message.content) {
    case "member_joined": return `${message.sender_name} 加入了房间`;
    case "member_left":   return `${message.sender_name} 退出了房间`;
    case "member_kicked": return `${message.sender_name} 被房主移出了房间`;
    default:              return message.content;
  }
}

function getPlaceholder(mode: MessageMode) {
  switch (mode) {
    case "ask":    return "向 AI 提问（50 字以内），消耗 1 积分";
    case "hint":   return "请求提示（50 字以内），消耗 1 积分 + 1 次提示机会";
    case "reason": return "尝试推理（200 字以内），消耗 2 积分，完成后获得 1 次提示机会";
    default:       return "输入普通聊天内容，Enter 发送，Shift+Enter 换行";
  }
}

function parseAiMessageContent(content: string): AiMessageContent | null {
  try {
    const parsed = JSON.parse(content) as Partial<AiMessageContent>;
    if (
      (parsed.kind === "answer" ||
        parsed.kind === "hint" ||
        parsed.kind === "reasoning_result" ||
        parsed.kind === "reveal") &&
      typeof parsed.text === "string"
    ) {
      return {
        kind: parsed.kind,
        text: parsed.text,
        fact_summary:
          typeof parsed.fact_summary === "string" ? parsed.fact_summary : null,
      };
    }
  } catch {
    return null;
  }

  return null;
}

function getAiLabel(kind: AiMessageContent["kind"]) {
  switch (kind) {
    case "answer": return "回复";
    case "hint": return "提示";
    case "reasoning_result": return "推理结果";
    case "reveal": return "汤底";
  }
}

export function RoomChat({
  initialMessages,
  roomCode,
  roomId,
  seatId,
  currentUserId,
  initialPersonalPoints = 0,
  initialSeatPoints = 0,
  initialHintTokens = 0,
  initialHasPuzzle = false,
  initialPuzzleId = null,
  senderName,
  senderSeatNumber,
  senderType,
}: RoomChatProps) {
  const [messages, setMessages] = useState(initialMessages);
  const [content, setContent] = useState("");
  const [mode, setMode] = useState<MessageMode>("chat");
  const [hasPuzzle, setHasPuzzle] = useState(initialHasPuzzle);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [skipPersonalPointsConfirm, setSkipPersonalPointsConfirm] = useState(false);
  const [showInsufficientNotice, setShowInsufficientNotice] = useState(false);
  const [showRateLimitNotice, setShowRateLimitNotice] = useState(false);
  const [seatPoints, setSeatPoints] = useState(initialSeatPoints);
  const [personalPoints, setPersonalPoints] = useState(initialPersonalPoints);
  const [hintTokens, setHintTokens] = useState(initialHintTokens);
  const [activeSeatId, setActiveSeatId] = useState(seatId);
  const [currentPuzzleId, setCurrentPuzzleId] = useState<number | null>(initialPuzzleId);
  // pendingSends: keyed by tempId (negative number); stores failed message info for retry
  const [pendingSends, setPendingSends] = useState<Record<number, { content: string; mode: MessageMode }>>({});
  // tickTime 每 10 秒更新一次（毫秒时间戳），驱动 pendingAiAfterMessageId 重新检查超时
  const [tickTime, setTickTime] = useState(() => new Date().getTime());
  const messageListRef = useRef<HTMLDivElement>(null);
  const tempIdRef = useRef(0);
  // 发送消息时设为 true，下次 messages 变化后强制滚到底部
  const forceScrollRef = useRef(false);

  const currentMode = MODES.find((m) => m.key === mode)!;

  // Scroll to bottom on initial load
  useLayoutEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    const frame = window.requestAnimationFrame(() => {
      el.scrollTop = el.scrollHeight;
      window.requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    });
    return () => window.cancelAnimationFrame(frame);
  }, []);

  // Auto-scroll when new messages arrive；发送消息时强制滚底
  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
    if (forceScrollRef.current) {
      el.scrollTop = el.scrollHeight;
      forceScrollRef.current = false;
      return;
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (atBottom) el.scrollTop = el.scrollHeight;
  }, [messages]);

  // Message polling + Realtime
  useEffect(() => {
    let disposed = false;

    const refreshMessages = async () => {
      if (document.visibilityState !== "visible") return;
      const response = await fetch(`/rooms/${roomCode}/messages`, { cache: "no-store" });
      if (!response.ok || disposed) return;
      const result = (await response.json()) as { messages: RoomMessage[] };
      if (!disposed) setMessages((cur) => mergeMessages(cur, result.messages));
    };

    const handleVisible = () => {
      if (document.visibilityState === "visible") void refreshMessages();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", handleVisible);
    window.addEventListener("online", handleVisible);
    window.addEventListener("room-data-refresh", refreshMessages);
    const timer = window.setInterval(() => void refreshMessages(), 2000);

    const supabase = createClient();
    const channel = supabase
      .channel(`room-messages:${roomId}`)
      .on("postgres_changes", {
        event: "INSERT",
        schema: "public",
        table: "room_messages",
        filter: `room_id=eq.${roomId}`,
      }, () => { if (!disposed) void refreshMessages(); })
      .subscribe((status) => { if (status === "SUBSCRIBED") void refreshMessages(); });

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", handleVisible);
      window.removeEventListener("online", handleVisible);
      window.removeEventListener("room-data-refresh", refreshMessages);
      window.clearInterval(timer);
      void supabase.removeChannel(channel);
    };
  }, [roomCode, roomId]);

  // Points + hint tokens Realtime + polling
  useEffect(() => {
    if (!activeSeatId && !currentUserId) return;

    const supabase = createClient();
    let disposed = false;
    const channels: ReturnType<typeof supabase.channel>[] = [];

    const syncSeatData = async () => {
      if (!activeSeatId || document.visibilityState !== "visible") return;
      const { data } = await supabase
        .from("room_seats")
        .select("remaining_points, hint_tokens")
        .eq("id", activeSeatId)
        .maybeSingle();
      if (!disposed) {
        if (typeof data?.remaining_points === "number") setSeatPoints(data.remaining_points);
        if (typeof data?.hint_tokens === "number") setHintTokens(data.hint_tokens);
      }
    };

    const syncPersonalPoints = async () => {
      if (!currentUserId || document.visibilityState !== "visible") return;
      const { data } = await supabase
        .from("profiles")
        .select("points")
        .eq("id", currentUserId)
        .maybeSingle();
      if (!disposed && typeof data?.points === "number") {
        setPersonalPoints(data.points);
      }
    };

    const handleRefresh = () => {
      void syncSeatData();
      void syncPersonalPoints();
    };

    if (activeSeatId) {
      const ch = supabase
        .channel(`chat-seat-pts:${activeSeatId}`)
        .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "room_seats",
          filter: `id=eq.${activeSeatId}`,
        }, (payload) => {
          const updated = payload.new as { remaining_points?: number; hint_tokens?: number };
          if (typeof updated.remaining_points === "number") setSeatPoints(updated.remaining_points);
          if (typeof updated.hint_tokens === "number") setHintTokens(updated.hint_tokens);
        })
        .subscribe(() => { void syncSeatData(); });
      channels.push(ch);
    }

    if (currentUserId) {
      const ch = supabase
        .channel(`chat-profile-pts:${currentUserId}`)
        .on("postgres_changes", {
          event: "UPDATE",
          schema: "public",
          table: "profiles",
          filter: `id=eq.${currentUserId}`,
        }, (payload) => {
          const updated = payload.new as { points?: number };
          if (typeof updated.points === "number") setPersonalPoints(updated.points);
        })
        .subscribe(() => { void syncPersonalPoints(); });
      channels.push(ch);
    }

    window.addEventListener("room-data-refresh", handleRefresh);
    const timer = window.setInterval(handleRefresh, 3000);

    return () => {
      disposed = true;
      window.removeEventListener("room-data-refresh", handleRefresh);
      window.clearInterval(timer);
      for (const ch of channels) void supabase.removeChannel(ch);
    };
  }, [activeSeatId, currentUserId]);

  useEffect(() => {
    const handleSeatChanged = (event: Event) => {
      const detail = (event as CustomEvent<{
        seatId: string;
        remainingPoints: number;
      }>).detail;
      setActiveSeatId(detail.seatId);
      setSeatPoints(detail.remainingPoints);
    };

    window.addEventListener("current-room-seat-changed", handleSeatChanged);
    return () => {
      window.removeEventListener("current-room-seat-changed", handleSeatChanged);
    };
  }, []);

  // 房主开题/关闭题目时，同步是否允许使用询问/提示/推理；关闭题目时强制回到普通聊天模式
  useEffect(() => {
    const handlePuzzleChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ hasPuzzle: boolean; puzzleId: number | null }>).detail;
      setHasPuzzle(detail.hasPuzzle);
      setCurrentPuzzleId(detail.puzzleId);
      if (!detail.hasPuzzle) {
        setMode("chat");
      }
    };

    window.addEventListener("room-puzzle-changed", handlePuzzleChanged);
    return () => {
      window.removeEventListener("room-puzzle-changed", handlePuzzleChanged);
    };
  }, []);

  // 当前题目的事实总结发生变化时广播给题目面板展示
  useEffect(() => {
    if (currentPuzzleId === null) return;

    const facts: string[] = [];
    for (const message of messages) {
      if (message.message_type !== "ai" || message.puzzle_id !== currentPuzzleId) continue;
      const parsed = parseAiMessageContent(message.content);
      if (!parsed) continue;
      if (parsed.kind !== "reasoning_result" && parsed.kind !== "reveal" && parsed.fact_summary) {
        if (!facts.includes(parsed.fact_summary)) facts.push(parsed.fact_summary);
      }
    }

    const broadcastFacts = () => {
      window.dispatchEvent(
        new CustomEvent("room-facts-changed", {
          detail: { puzzleId: currentPuzzleId, facts },
        }),
      );
    };

    broadcastFacts();

    const handleFactsRequest = (event: Event) => {
      const detail = (event as CustomEvent<{ puzzleId: number | null }>).detail;
      if (detail.puzzleId === currentPuzzleId) broadcastFacts();
    };

    window.addEventListener("room-facts-request", handleFactsRequest);
    return () => {
      window.removeEventListener("room-facts-request", handleFactsRequest);
    };
  }, [messages, currentPuzzleId]);

  async function doSend(text: string, msgMode: MessageMode, usePersonal: boolean) {
    const cost = MODES.find((m) => m.key === msgMode)!.cost;
    if (cost > 0 && currentPuzzleId === null) {
      setErrorNotice("题目已经变化，请刷新后重试");
      return;
    }

    setSending(true);
    setErrorNotice(null);
    setConfirmState(null);

    // Optimistic point deduction for instant UI feedback
    if (cost > 0) {
      if (usePersonal) setPersonalPoints((p) => p - cost);
      else setSeatPoints((p) => p - cost);
    }

    // 提示模式乐观扣除提示机会
    if (msgMode === "hint") setHintTokens((t) => t - 1);
    // 推理/提问模式乐观更新提示机会（推理+1；提问每3次+1，这里简化为只在服务端更新后通过Realtime同步）

    const seatForMessage = activeSeatId ?? "";
    const tempId = -(++tempIdRef.current);
    const optimisticMessage: RoomMessage = {
      id: tempId,
      room_id: roomId,
      seat_id: seatForMessage,
      sender_name: senderName ?? "我",
      sender_seat_number: senderSeatNumber ?? 0,
      sender_type: senderType ?? "guest",
      message_type: "chat",
      message_mode: msgMode,
      content: text,
      puzzle_id: currentPuzzleId,
      created_at: new Date().toISOString(),
    };

    forceScrollRef.current = true;
    setMessages((cur) => mergeMessages(cur, [optimisticMessage]));
    setContent("");

    const endpoint =
      msgMode === "chat" ? `/rooms/${roomCode}/messages` : `/rooms/${roomCode}/ask`;

    const rollbackPoints = () => {
      if (cost === 0) return;
      if (usePersonal) setPersonalPoints((p) => p + cost);
      else setSeatPoints((p) => p + cost);
    };

    const rollbackHintToken = () => {
      if (msgMode === "hint") setHintTokens((t) => t + 1);
    };

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: text,
          message_mode: msgMode,
          use_personal_points: usePersonal,
          expected_puzzle_id: msgMode === "chat" ? null : currentPuzzleId,
        }),
      });
      const responseStatus = response.status;
      const result = (await response.json()) as {
        error?: string;
        message?: RoomMessage;
        aiMessage?: RoomMessage;
      };

      if (!response.ok || !result.message) {
        rollbackPoints();
        rollbackHintToken();
        if (msgMode !== "chat") {
          setPendingSends((cur) => ({ ...cur, [tempId]: { content: text, mode: msgMode } }));
          setErrorNotice(result.error ?? "AI 主持暂时没有回应，请稍后重试");
          if (responseStatus === 409) {
            window.dispatchEvent(new CustomEvent("room-puzzle-refresh"));
          }
        } else {
          setMessages((cur) => cur.filter((m) => m.id !== tempId));
          if (response.status === 429) {
            setShowRateLimitNotice(true);
          } else {
            setErrorNotice(result.error ?? "消息发送失败，请稍后重试");
          }
        }
        return;
      }

      setMessages((cur) =>
        mergeMessages(
          cur.filter((m) => m.id !== tempId),
          [result.message!, result.aiMessage].filter(Boolean) as RoomMessage[],
        ),
      );
      setPendingSends((cur) => {
        const next = { ...cur };
        delete next[tempId];
        return next;
      });
    } catch {
      rollbackPoints();
      rollbackHintToken();
      if (msgMode !== "chat") {
        setPendingSends((cur) => ({ ...cur, [tempId]: { content: text, mode: msgMode } }));
      } else {
        setMessages((cur) => cur.filter((m) => m.id !== tempId));
        setErrorNotice("消息发送失败，请稍后重试");
      }
    } finally {
      setSending(false);
      // 使用个人积分时通知右上角积分组件从数据库同步最新值
      if (usePersonal) {
        window.dispatchEvent(new Event("room-data-refresh"));
      }
    }
  }

  async function handleRetry(text: string, msgMode: MessageMode) {
    if (sending) return;
    const cost = MODES.find((m) => m.key === msgMode)!.cost;
    if (seatPoints >= cost) {
      await doSend(text, msgMode, false);
    } else if (currentUserId && personalPoints >= cost) {
      if (skipPersonalPointsConfirm) {
        await doSend(text, msgMode, true);
      } else {
        setConfirmState({ content: text, mode: msgMode });
      }
    } else {
      setShowInsufficientNotice(true);
    }
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = content.trim();
    if (!text || sending) return;

    const cost = currentMode.cost;

    if (cost === 0) {
      await doSend(text, mode, false);
      return;
    }

    if (seatPoints >= cost) {
      await doSend(text, mode, false);
      return;
    }

    // Seat points insufficient
    if (currentUserId && personalPoints >= cost) {
      if (skipPersonalPointsConfirm) {
        await doSend(text, mode, true);
        return;
      }
      setConfirmState({ content: text, mode });
      return;
    }

    setShowInsufficientNotice(true);
  }

  const canAfford =
    currentMode.cost === 0 ||
    seatPoints >= currentMode.cost ||
    (!!currentUserId && personalPoints >= currentMode.cost);

  // 真实消息到达后，隐藏内容相同的非失败临时占位消息，避免重复展示。
  // 已失败的临时消息（pendingSends[id] = "failed"）保持可见并隐藏对应真实消息，
  // 防止失败状态丢失，同时阻止"回复中"指示器误触发。
  const visibleMessages = useMemo(() => {
    const failedTempKeys = new Set(
      messages
        .filter((m) => m.id < 0 && !!pendingSends[m.id])
        .map((m) => messageKey(m)),
    );
    const realKeys = new Set(
      messages
        .filter((m) => m.id > 0 && !failedTempKeys.has(messageKey(m)))
        .map((m) => messageKey(m)),
    );
    return messages.filter((m) => {
      if (m.id > 0) return !failedTempKeys.has(messageKey(m));
      return !realKeys.has(messageKey(m));
    });
  }, [messages, pendingSends]);

  // 同一房间的 AI 请求严格顺序处理，所以 ask/hint/reason 消息之后
  // 第一个 AI 消息必定是它的回复，据此把回答类型映射回询问消息本身。
  const askAnswerColorByMessageId = useMemo(() => {
    const map = new Map<number, string>();
    let pendingAskId: number | null = null;
    for (const message of visibleMessages) {
      if (message.message_type === "chat" && message.message_mode === "ask") {
        pendingAskId = message.id;
        continue;
      }
      if (message.message_type === "ai" && pendingAskId !== null) {
        const parsed = parseAiMessageContent(message.content);
        if (parsed?.kind === "answer") {
          const colorClass = ANSWER_COLOR_CLASS[parsed.text];
          if (colorClass) map.set(pendingAskId, colorClass);
        }
        pendingAskId = null;
      }
    }
    return map;
  }, [visibleMessages]);

  // tickTime 每 10 秒推进一次，驱动超时判断重算
  useEffect(() => {
    const timer = window.setInterval(() => setTickTime(new Date().getTime()), 10_000);
    return () => window.clearInterval(timer);
  }, []);

  // 找出最后一条尚未收到 AI 回复的 ask/hint/reason 消息（房间所有人共享此状态）。
  // 排除已标记为失败的本地临时消息，避免失败后仍显示"回复中"。
  // 超过 PENDING_AI_TIMEOUT_MS 的旧消息也不再显示，防止永久挂起。
  const pendingAiAfterMessageId = useMemo(() => {
    let lastAiRelatedId: number | null = null;
    let hasFollowingAi = false;

    for (const msg of visibleMessages) {
      if (msg.message_type === "chat" && msg.message_mode !== "chat") {
        if (msg.id < 0 && !!pendingSends[msg.id]) continue;
        lastAiRelatedId = msg.id;
        hasFollowingAi = false;
      } else if (msg.message_type === "ai" && lastAiRelatedId !== null) {
        hasFollowingAi = true;
      }
    }

    if (lastAiRelatedId === null || hasFollowingAi) return null;

    const lastMsg = visibleMessages.find((m) => m.id === lastAiRelatedId);
    if (!lastMsg) return null;
    if (tickTime - new Date(lastMsg.created_at).getTime() > PENDING_AI_TIMEOUT_MS) return null;

    return lastAiRelatedId;
  }, [visibleMessages, pendingSends, tickTime]);

  return (
    <section className="room-chat">
      <div className="room-chat-heading">
        <h2>聊天</h2>
      </div>

      <div aria-live="polite" className="message-list" ref={messageListRef}>
        {visibleMessages.length === 0 ? (
          <div className="empty-chat">还没有消息，来打个招呼吧。</div>
        ) : (
          visibleMessages.flatMap((message) => {
            const items: ReactNode[] = [];

            if (message.message_type === "system") {
              items.push(
                <div className="system-message" key={message.id}>
                  <span>{getSystemMessageContent(message)}</span>
                  <time dateTime={message.created_at}>
                    {timeFormatter.format(new Date(message.created_at))}
                  </time>
                </div>
              );
            } else {
              items.push(
                <article
                  className={`chat-message${message.message_type === "ai" ? " ai-message" : ""}${
                    askAnswerColorByMessageId.has(message.id)
                      ? ` ${askAnswerColorByMessageId.get(message.id)}`
                      : ""
                  }`}
                  key={message.id}
                >
                  <div className="chat-message-meta">
                    <strong>{message.sender_name}</strong>
                    {message.message_type !== "ai" && (
                      <>
                        <span>[{message.sender_seat_number}]</span>
                        <span>[{message.sender_type === "registered" ? "已注册" : "访客"}]</span>
                        {message.message_mode !== "chat" && (
                          <span className="chat-mode-badge">
                            {MODE_LABEL[message.message_mode]}
                          </span>
                        )}
                      </>
                    )}
                  </div>
                  <div className="chat-message-body">
                    {message.message_type === "ai" && parseAiMessageContent(message.content) ? (
                      <div className="ai-message-content">
                        {(() => {
                          const parsed = parseAiMessageContent(message.content)!;
                          return (
                            <p>
                              <span className="ai-message-label">
                                {getAiLabel(parsed.kind)}
                              </span>
                              {parsed.text}
                            </p>
                          );
                        })()}
                      </div>
                    ) : (
                      <p>{message.content}</p>
                    )}
                    <time dateTime={message.created_at}>
                      {timeFormatter.format(new Date(message.created_at))}
                    </time>
                  </div>
                  {/* 仅对发送失败的本地临时消息显示失败提示 */}
                  {message.id < 0 && !!pendingSends[message.id] && (
                    <p className="ai-pending-status failed">
                      发送失败，已退还积分
                      <button
                        className="retry-button"
                        disabled={sending}
                        onClick={() => {
                          const info = pendingSends[message.id];
                          if (info) void handleRetry(info.content, info.mode);
                        }}
                        title="重试"
                        type="button"
                      >
                        ↺
                      </button>
                    </p>
                  )}
                </article>
              );
            }

            // 在待回复消息后插入动态"回复中"指示器（所有房间成员共享）
            if (message.id === pendingAiAfterMessageId) {
              items.push(
                <div className="pending-ai-indicator" key={`pending-${message.id}`}>
                  <span className="pending-ai-label">AI主持</span>
                  <span className="pending-ai-dots" aria-label="回复中">
                    <span />
                    <span />
                    <span />
                  </span>
                </div>
              );
            }

            return items;
          })
        )}
      </div>

      {/* Confirm dialog: seat points insufficient, ask to use personal */}
      {confirmState && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="积分确认">
          <div className="dialog-panel">
            <h2>使用个人积分？</h2>
            <p>
              座位临时积分不足（剩余 <strong>{seatPoints}</strong> 点），
              是否改用个人积分（剩余 <strong>{personalPoints}</strong> 点）发送此消息？
              本次消耗 <strong>{MODES.find((m) => m.key === confirmState.mode)!.cost}</strong> 点。
            </p>
            <label className="checkbox-line">
              <input
                checked={skipPersonalPointsConfirm}
                onChange={(e) => setSkipPersonalPointsConfirm(e.target.checked)}
                type="checkbox"
              />
              下次不再提醒，座位积分不足时自动使用个人积分
            </label>
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={sending}
                onClick={() => setConfirmState(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button"
                disabled={sending}
                onClick={() => void doSend(confirmState.content, confirmState.mode, true)}
                type="button"
              >
                {sending ? "发送中..." : "使用个人积分发送"}
              </button>
            </div>
          </div>
        </div>
      )}

      {showInsufficientNotice && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="积分不足">
          <div className="dialog-panel">
            <h2>积分不足</h2>
            <div className="dialog-actions">
              <button
                className="button"
                onClick={() => setShowInsufficientNotice(false)}
                type="button"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      {showRateLimitNotice && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="发送太频繁">
          <div className="dialog-panel">
            <h2>发送太频繁</h2>
            <p>请稍后再发送消息。</p>
            <div className="dialog-actions">
              <button
                className="button"
                onClick={() => setShowRateLimitNotice(false)}
                type="button"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}

      <form className="chat-form" onSubmit={(e) => void handleSubmit(e)}>
        {/* Mode tabs */}
        <div className="chat-mode-tabs">
          {MODES.map((m) => {
            const noPuzzleLocked = m.key !== "chat" && !hasPuzzle;
            const noTokenLocked = m.key === "hint" && hasPuzzle && hintTokens < 1;
            const locked = noPuzzleLocked || noTokenLocked;
            const title = noPuzzleLocked
              ? "需要先选择题目才能使用"
              : noTokenLocked
                ? "提问 3 次或完成一次推理可获得提示机会"
                : undefined;
            return (
              <button
                key={m.key}
                className={`chat-mode-tab${mode === m.key ? " active" : ""}`}
                disabled={locked}
                onClick={() => {
                  if (locked) return;
                  setMode(m.key);
                  setContent("");
                }}
                title={title}
                type="button"
              >
                {m.label}
                {m.cost > 0 && <span className="chat-mode-cost">{m.cost}pt</span>}
              </button>
            );
          })}
        </div>

        <p className={`chat-mode-locked-hint muted${hasPuzzle ? " chat-mode-locked-hint--hidden" : ""}`}>
          房主开始题目后，才能使用询问 / 提示 / 尝试推理
        </p>

        <textarea
          aria-label={currentMode.label}
          maxLength={currentMode.maxLength}
          onChange={(e) => setContent(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              e.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder={getPlaceholder(mode)}
          rows={3}
          value={content}
        />

        <div className="chat-form-footer">
          <span className="muted">{content.length}/{currentMode.maxLength}</span>

          {/* 积分 + 提示机会（合为一行，占 grid 中间列） */}
          <span className="chat-footer-center">
            {currentMode.cost > 0 && (
              <span className={`chat-points-info${canAfford ? "" : " insufficient"}`}>
                {seatPoints}[临]
                {currentUserId ? ` + ${personalPoints}` : ""}
              </span>
            )}
            {hasPuzzle && mode !== "chat" && (
              <span className={`chat-hint-tokens-info${hintTokens === 0 ? " muted" : ""}`}>
                提示机会 {hintTokens} 次
              </span>
            )}
          </span>

          <button
            className="button"
            disabled={sending || !content.trim()}
            type="submit"
          >
            {sending ? "发送中..." : "发送"}
          </button>
        </div>
      </form>

      {errorNotice && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="发送失败">
          <div className="dialog-panel">
            <h2>发送失败</h2>
            <p>{errorNotice}</p>
            <div className="dialog-actions">
              <button
                className="button"
                onClick={() => setErrorNotice(null)}
                type="button"
              >
                知道了
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
