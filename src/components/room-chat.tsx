"use client";

import {
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

type RoomChatProps = {
  initialMessages: RoomMessage[];
  roomCode: string;
  roomId: string;
  seatId?: string | null;
  currentUserId?: string;
  initialPersonalPoints?: number;
  initialSeatPoints?: number;
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

function pendingKey(seatId: string, mode: MessageMode, content: string) {
  return `${seatId}|${mode}|${content}`;
}

function messageKey(message: RoomMessage) {
  return pendingKey(message.seat_id, message.message_mode, message.content);
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
    case "hint":   return "请求提示（50 字以内），消耗 1 积分";
    case "reason": return "尝试推理（200 字以内），消耗 2 积分";
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
  const [activeSeatId, setActiveSeatId] = useState(seatId);
  const [currentPuzzleId, setCurrentPuzzleId] = useState<number | null>(initialPuzzleId);
  const [pendingSends, setPendingSends] = useState<Record<string, "waiting" | "failed">>({});
  const messageListRef = useRef<HTMLDivElement>(null);
  const tempIdRef = useRef(0);

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

  // Auto-scroll when new messages arrive
  useEffect(() => {
    const el = messageListRef.current;
    if (!el) return;
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

  // Points Realtime + polling
  useEffect(() => {
    if (!activeSeatId && !currentUserId) return;

    const supabase = createClient();
    let disposed = false;
    const channels: ReturnType<typeof supabase.channel>[] = [];

    const syncSeatPoints = async () => {
      if (!activeSeatId || document.visibilityState !== "visible") return;
      const { data } = await supabase
        .from("room_seats")
        .select("remaining_points")
        .eq("id", activeSeatId)
        .maybeSingle();
      if (!disposed && typeof data?.remaining_points === "number") {
        setSeatPoints(data.remaining_points);
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
      void syncSeatPoints();
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
          const updated = payload.new as { remaining_points?: number };
          if (typeof updated.remaining_points === "number") {
            setSeatPoints(updated.remaining_points);
          }
        })
        .subscribe(() => { void syncSeatPoints(); });
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

  // 当前题目的事实总结发生变化时（新消息到达或题目切换），广播给题目面板展示。
  // 提示也以陈述句形式归入同一份事实总结，不再单独维护一份提示列表。
  // 题目面板也可以主动请求一次当前数据（避免双方挂载顺序不同导致错过首次广播）。
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

    // 立即把消息本身展示出来，不等待 AI 回复；ask/hint/reason 模式下方再叠加
    // 一行"回复中..."状态，收到结果后用真实回复替换，失败则改为失败提示。
    const seatForMessage = activeSeatId ?? "";
    const tempId = -(++tempIdRef.current);
    const key = pendingKey(seatForMessage, msgMode, text);
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

    setMessages((cur) => mergeMessages(cur, [optimisticMessage]));
    setContent("");
    if (msgMode !== "chat") {
      setPendingSends((cur) => ({ ...cur, [key]: "waiting" }));
    }

    const endpoint =
      msgMode === "chat" ? `/rooms/${roomCode}/messages` : `/rooms/${roomCode}/ask`;

    const rollbackPoints = () => {
      if (cost === 0) return;
      if (usePersonal) setPersonalPoints((p) => p + cost);
      else setSeatPoints((p) => p + cost);
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
        if (msgMode !== "chat") {
          setPendingSends((cur) => ({ ...cur, [key]: "failed" }));
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
      if (msgMode !== "chat") {
        setPendingSends((cur) => {
          const next = { ...cur };
          delete next[key];
          return next;
        });
      }
    } catch {
      rollbackPoints();
      if (msgMode !== "chat") {
        setPendingSends((cur) => ({ ...cur, [key]: "failed" }));
      } else {
        setMessages((cur) => cur.filter((m) => m.id !== tempId));
        setErrorNotice("消息发送失败，请稍后重试");
      }
    } finally {
      setSending(false);
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

  // 真实消息到达（轮询/Realtime 或本次请求自身的响应）后，隐藏内容相同的临时
  // 占位消息，避免同一条消息短暂重复展示两次。
  const visibleMessages = useMemo(() => {
    const realKeys = new Set(
      messages.filter((m) => m.id > 0).map((m) => messageKey(m)),
    );
    return messages.filter((m) => m.id > 0 || !realKeys.has(messageKey(m)));
  }, [messages]);

  // 同一房间的 AI 请求严格按顺序处理，所以一条询问消息之后最先出现的 AI 消息
  // 必定是它的回复，据此把回答类型映射回询问消息本身，用于给问题气泡上色。
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

  return (
    <section className="room-chat">
      <div className="room-chat-heading">
        <h2>聊天</h2>
      </div>

      <div aria-live="polite" className="message-list" ref={messageListRef}>
        {visibleMessages.length === 0 ? (
          <div className="empty-chat">还没有消息，来打个招呼吧。</div>
        ) : (
          visibleMessages.map((message) =>
            message.message_type === "system" ? (
              <div className="system-message" key={message.id}>
                <span>{getSystemMessageContent(message)}</span>
                <time dateTime={message.created_at}>
                  {timeFormatter.format(new Date(message.created_at))}
                </time>
              </div>
            ) : (
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
                {message.message_type === "chat" && message.message_mode !== "chat" && (() => {
                  const status = pendingSends[messageKey(message)];
                  if (!status) return null;
                  return (
                    <p className={`ai-pending-status${status === "failed" ? " failed" : ""}`}>
                      {status === "failed" ? "发送消息失败，已退还积分" : "回复中..."}
                    </p>
                  );
                })()}
              </article>
            ),
          )
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
            const locked = m.key !== "chat" && !hasPuzzle;
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
                title={locked ? "需要先选择题目才能使用" : undefined}
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

          {/* Points status for paid modes */}
          {currentMode.cost > 0 && (
            <span className={`chat-points-info${canAfford ? "" : " insufficient"}`}>
              {seatPoints}[临]
              {currentUserId ? ` + ${personalPoints}` : ""}
            </span>
          )}

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
