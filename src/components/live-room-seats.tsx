"use client";

import {
  ReactNode,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";

import { checkSeatSessionActive, getRoomMembershipStatus, giftPoints, kickGuest, moveSeat } from "@/app/rooms/actions";
import type { RoomActionState } from "@/app/rooms/actions";
import { CopyRoomCode } from "@/components/copy-room-code";
import { RoomActionForm } from "@/components/room-action-form";
import { ShareRoomLink } from "@/components/share-room-link";

import { createClient } from "@/lib/supabase/client";
import type { RoomSeat } from "@/lib/types";

const occupiedAtFormatter = new Intl.DateTimeFormat("zh-CN", {
  hour: "2-digit",
  minute: "2-digit",
});

const SEATS_FALLBACK_POLL_MS = 10_000;
const PERSONAL_POINTS_FALLBACK_POLL_MS = 30_000;

type LiveRoomSeatsProps = {
  initialSeats: RoomSeat[];
  isOwner: boolean;
  roomCode: string;
  roomName: string;
  roomId: string;
  maxMembers: number;
  pointsPerSeat: number;
  requiresPassword: boolean;
  guestSeatId?: string;
  isJoinedGuest: boolean;
  currentUserId?: string;
  currentUserSeatId?: string;
  currentUserPoints?: number;
  puzzlePanel: ReactNode;
  manageExtra: ReactNode;
};

function leaveWithNotice(notice: "room_kicked" | "room_closed" | "room_left" | "room_displaced") {
  const params = new URLSearchParams({
    code: notice,
    kind: "notice",
    next: "/",
    scope: "home",
  });
  window.location.replace(`/flash/redirect?${params.toString()}`);
}

export function LiveRoomSeats({
  initialSeats,
  isOwner,
  roomCode,
  roomName,
  roomId,
  maxMembers,
  pointsPerSeat,
  requiresPassword,
  guestSeatId,
  isJoinedGuest,
  currentUserId,
  currentUserSeatId,
  currentUserPoints,
  puzzlePanel,
  manageExtra,
}: LiveRoomSeatsProps) {
  const [seats, setSeats] = useState(initialSeats);
  const [currentSeatId, setCurrentSeatId] = useState(
    currentUserSeatId ?? guestSeatId,
  );
  const [wideLayout, setWideLayout] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"manage" | "puzzle">("manage");
  const [onlineSeatIds, setOnlineSeatIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [openSeatMenuId, setOpenSeatMenuId] = useState<string | null>(null);
  const [seatMenuOpensUpward, setSeatMenuOpensUpward] = useState(false);
  const openSeatMenuRef = useRef<HTMLDivElement>(null);

  // Move seat modal state
  const [movingFromSeatId, setMovingFromSeatId] = useState<string | null>(null);
  const [moveError, setMoveError] = useState<string | null>(null);
  const [isMovePending, startMoveTransition] = useTransition();

  // Gift points modal state
  const [giftTargetSeatId, setGiftTargetSeatId] = useState<string | null>(null);
  const [giftAmount, setGiftAmount] = useState(1);
  const [giftError, setGiftError] = useState<string | null>(null);
  const [isGiftPending, startGiftTransition] = useTransition();

  // Points display state
  const [personalPoints, setPersonalPoints] = useState(currentUserPoints ?? 0);

  const isLeavingRef = useRef(false);
  // Track current user's nickname to distinguish move vs kick
  const myNicknameRef = useRef<string | null>(null);

  // Keep myNicknameRef up to date
  useEffect(() => {
    if (!currentSeatId) return;
    const mySeat = seats.find((s) => s.id === currentSeatId);
    if (mySeat?.nickname) myNicknameRef.current = mySeat.nickname;
  }, [seats, currentSeatId]);

  useEffect(() => {
    const media = window.matchMedia(
      "(min-width: 880px) and (min-aspect-ratio: 6 / 5)",
    );
    const updateLayout = () => setWideLayout(media.matches);
    updateLayout();
    media.addEventListener("change", updateLayout);
    return () => media.removeEventListener("change", updateLayout);
  }, []);

  useEffect(() => {
    const media = window.matchMedia(
      "(min-width: 640px) and (max-width: 879px) and (orientation: landscape)",
    );
    const openTabletDetails = () => {
      if (media.matches) setDetailsOpen(true);
    };
    openTabletDetails();
    media.addEventListener("change", openTabletDetails);
    return () => media.removeEventListener("change", openTabletDetails);
  }, []);

  useEffect(() => {
    const handleGuestSeatChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ seatId?: string }>).detail;
      setCurrentSeatId(detail.seatId);
    };
    const handleLeaveStarted = () => { isLeavingRef.current = true; };
    const handleLeaveCancelled = () => { isLeavingRef.current = false; };

    window.addEventListener("guest-seat-changed", handleGuestSeatChanged);
    window.addEventListener("room-leave-started", handleLeaveStarted);
    window.addEventListener("room-leave-cancelled", handleLeaveCancelled);
    return () => {
      window.removeEventListener("guest-seat-changed", handleGuestSeatChanged);
      window.removeEventListener("room-leave-started", handleLeaveStarted);
      window.removeEventListener("room-leave-cancelled", handleLeaveCancelled);
    };
  }, []);

  useLayoutEffect(() => {
    if (!openSeatMenuId) return;

    const menu = openSeatMenuRef.current;
    const trigger = menu?.querySelector<HTMLElement>(".seat-menu-trigger");
    const popover = menu?.querySelector<HTMLElement>(".seat-menu-popover");
    if (!menu || !trigger || !popover) return;

    const container = menu.closest(".room-details-content");
    const triggerRect = trigger.getBoundingClientRect();
    const containerRect = container?.getBoundingClientRect();
    const topBoundary = Math.max(8, containerRect?.top ?? 8);
    const bottomBoundary = Math.min(
      window.innerHeight - 8,
      containerRect?.bottom ?? window.innerHeight - 8,
    );
    const spaceAbove = triggerRect.top - topBoundary;
    const spaceBelow = bottomBoundary - triggerRect.bottom;

    setSeatMenuOpensUpward(
      spaceBelow < popover.offsetHeight + 8 && spaceAbove > spaceBelow,
    );
  }, [openSeatMenuId]);

  useEffect(() => {
    if (!openSeatMenuId) return;

    const closeMenu = (event: PointerEvent) => {
      if (!openSeatMenuRef.current?.contains(event.target as Node)) {
        setOpenSeatMenuId(null);
      }
    };
    const closeMenuOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpenSeatMenuId(null);
    };

    document.addEventListener("pointerdown", closeMenu);
    document.addEventListener("keydown", closeMenuOnEscape);
    return () => {
      document.removeEventListener("pointerdown", closeMenu);
      document.removeEventListener("keydown", closeMenuOnEscape);
    };
  }, [openSeatMenuId]);

  useEffect(() => {
    const currentSeat = currentUserId
      ? seats.find((seat) => seat.user_id === currentUserId) ??
        seats.find((seat) => seat.id === currentSeatId)
      : seats.find((seat) => seat.id === currentSeatId);
    if (!currentSeat) return;

    window.dispatchEvent(new CustomEvent("current-room-seat-changed", {
      detail: {
        seatId: currentSeat.id,
        remainingPoints: currentSeat.remaining_points,
        hintTokens: currentSeat.hint_tokens,
      },
    }));
  }, [currentSeatId, currentUserId, seats]);

  // Realtime: seats + room status
  useEffect(() => {
    const supabase = createClient();
    let checking = false;
    let syncRequested = false;
    let sessionCheckTimer: ReturnType<typeof setInterval> | null = null;

    // For logged-in members: periodically check if this device is still the active session.
    // If another device entered the room, it took over the session and we should leave.
    const checkSession = async () => {
      if (!currentUserId || document.visibilityState !== "visible") return;
      const active = await checkSeatSessionActive(roomCode);
      if (!active) leaveWithNotice("room_displaced");
    };

    const syncSeats = async () => {
      if (checking || document.visibilityState !== "visible") return;
      checking = true;
      try {
        do {
          syncRequested = false;
          const [seatResult, roomResult] = await Promise.all([
            supabase
              .from("room_seats")
              .select("id, seat_number, nickname, user_id, remaining_points, hint_tokens, occupied_at")
              .eq("room_id", roomId)
              .order("seat_number"),
            supabase.from("rooms").select("status").eq("id", roomId).maybeSingle(),
          ]);

          // 房间关闭后 RLS 会隐藏 rooms/room_seats 行（包括房主自己），直接查询会拿到
          // 空结果而不是 status:"closed"；这时必须用 SECURITY DEFINER 的 RPC 确认真实原因，
          // 否则会被误判为"被踢出"。
          if (roomResult.data?.status === "closed" || !roomResult.data) {
            const status = await getRoomMembershipStatus(roomCode);
            leaveWithNotice(
              status === "kicked"
                ? (isLeavingRef.current ? "room_left" : "room_kicked")
                : "room_closed",
            );
            return;
          }

          if (seatResult.data) {
            const nextSeats = seatResult.data as RoomSeat[];

            if (currentSeatId && !nextSeats.find((s) => s.id === currentSeatId && s.nickname)) {
              // A move updates two rows. Read the committed room state before
              // deciding whether the current player moved or was removed.
              const movedTo =
                (currentUserId
                  ? nextSeats.find((s) => s.user_id === currentUserId)
                  : null) ??
                (myNicknameRef.current
                  ? nextSeats.find((s) => s.id !== currentSeatId && s.nickname === myNicknameRef.current)
                  : null);

              if (movedTo) {
                setCurrentSeatId(movedTo.id);
                setSeats(nextSeats);
                continue;
              }

              const status = await getRoomMembershipStatus(roomCode);
              leaveWithNotice(
                status === "closed"
                  ? "room_closed"
                  : (isLeavingRef.current ? "room_left" : "room_kicked"),
              );
              return;
            }

            setSeats(nextSeats);
          }

          if (isJoinedGuest && !currentSeatId) {
            const status = await getRoomMembershipStatus(roomCode);
            if (status === "kicked") {
              leaveWithNotice(isLeavingRef.current ? "room_left" : "room_kicked");
            } else if (status === "closed") {
              leaveWithNotice("room_closed");
            }
          }
        } while (syncRequested && document.visibilityState === "visible");
      } finally {
        checking = false;
      }
    };

    const channel = supabase
      .channel(`room-seats:${roomId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "room_seats",
        filter: `room_id=eq.${roomId}`,
      }, (payload) => {
        const changedSeat = payload.new as RoomSeat;

        syncRequested = true;
        if (currentSeatId === changedSeat.id && !changedSeat.nickname) {
          // Our seat was cleared — defer to syncSeats to distinguish move vs kick.
          void syncSeats();
          return;
        }

        // If our seat was updated (e.g. session takeover by another device), check session
        if (currentUserId && currentSeatId === changedSeat.id) {
          void checkSession();
        }

        setSeats((current) =>
          current.map((seat) => seat.id === changedSeat.id ? changedSeat : seat),
        );
        void syncSeats();
      })
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "rooms",
        filter: `id=eq.${roomId}`,
      }, (payload) => {
        if ((payload.new as { status?: string }).status === "closed") {
          leaveWithNotice("room_closed");
        }
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") {
          void syncSeats();
          if (currentUserId) {
            // Check every 15s as fallback for when Realtime misses the takeover event
            sessionCheckTimer = setInterval(() => void checkSession(), 15_000);
          }
        }
      });

    document.addEventListener("visibilitychange", syncSeats);
    document.addEventListener("visibilitychange", checkSession);
    window.addEventListener("focus", syncSeats);
    window.addEventListener("focus", checkSession);
    window.addEventListener("online", syncSeats);
    window.addEventListener("room-data-refresh", syncSeats);
    const syncTimer = window.setInterval(() => void syncSeats(), SEATS_FALLBACK_POLL_MS);
    void syncSeats();

    return () => {
      document.removeEventListener("visibilitychange", syncSeats);
      document.removeEventListener("visibilitychange", checkSession);
      window.removeEventListener("focus", syncSeats);
      window.removeEventListener("focus", checkSession);
      window.removeEventListener("online", syncSeats);
      window.removeEventListener("room-data-refresh", syncSeats);
      window.clearInterval(syncTimer);
      if (sessionCheckTimer !== null) clearInterval(sessionCheckTimer);
      void supabase.removeChannel(channel);
    };
  }, [currentSeatId, currentUserId, isJoinedGuest, roomCode, roomId]);

  // Realtime Presence: occupied seats currently viewing this room.
  useEffect(() => {
    if (!currentSeatId) return;

    const supabase = createClient();
    const channel = supabase.channel(`room-presence:${roomId}`, {
      config: {
        presence: {
          key: currentSeatId,
        },
      },
    });

    const syncPresence = () => {
      const state = channel.presenceState() as Record<
        string,
        Array<{ seat_id?: string }>
      >;
      // 自己正在浏览房间，必定在线；presence 抖动时不应把自己显示成离线。
      const nextOnline = new Set<string>([currentSeatId]);

      Object.entries(state).forEach(([key, presences]) => {
        if (key) nextOnline.add(key);
        presences.forEach((presence) => {
          if (presence.seat_id) nextOnline.add(presence.seat_id);
        });
      });

      setOnlineSeatIds(nextOnline);
    };

    // Supabase 在 websocket 重连后不会自动重新 track，所以标签页重新可见、
    // 重新获焦或网络恢复时都要重新上报，避免人还在却被显示为离线。
    const trackPresence = () => {
      void channel.track({
        seat_id: currentSeatId,
        online_at: new Date().toISOString(),
      });
    };

    const handleVisible = () => {
      if (document.visibilityState === "visible") trackPresence();
    };

    channel
      .on("presence", { event: "sync" }, syncPresence)
      .on("presence", { event: "join" }, syncPresence)
      .on("presence", { event: "leave" }, syncPresence)
      .subscribe((status) => {
        if (status === "SUBSCRIBED") trackPresence();
      });

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", trackPresence);
    window.addEventListener("online", trackPresence);

    return () => {
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", trackPresence);
      window.removeEventListener("online", trackPresence);
      setOnlineSeatIds((current) => {
        const nextOnline = new Set(current);
        nextOnline.delete(currentSeatId);
        return nextOnline;
      });
      void supabase.removeChannel(channel);
    };
  }, [currentSeatId, roomId]);

  // 向 room-chat 广播个人积分变化（room-chat 不持有自己的 profiles Realtime 订阅）
  useEffect(() => {
    if (!currentUserId) return;
    window.dispatchEvent(
      new CustomEvent("personal-points-changed", { detail: { points: personalPoints } }),
    );
  }, [currentUserId, personalPoints]);

  // Realtime: personal points (logged-in members only)
  useEffect(() => {
    if (!currentUserId) return;
    const supabase = createClient();
    let disposed = false;

    const syncPersonalPoints = async () => {
      if (document.visibilityState !== "visible") return;
      const { data } = await supabase
        .from("profiles")
        .select("points")
        .eq("id", currentUserId)
        .maybeSingle();
      if (!disposed && typeof data?.points === "number") {
        setPersonalPoints(data.points);
      }
    };

    const channel = supabase
      .channel(`profile-points:${currentUserId}`)
      .on("postgres_changes", {
        event: "UPDATE",
        schema: "public",
        table: "profiles",
        filter: `id=eq.${currentUserId}`,
      }, (payload) => {
        const updated = payload.new as { points?: number };
        if (typeof updated.points === "number") setPersonalPoints(updated.points);
      })
      .subscribe((status) => {
        if (status === "SUBSCRIBED") void syncPersonalPoints();
      });

    const handleVisible = () => {
      if (document.visibilityState === "visible") void syncPersonalPoints();
    };

    document.addEventListener("visibilitychange", handleVisible);
    window.addEventListener("focus", syncPersonalPoints);
    window.addEventListener("online", syncPersonalPoints);
    window.addEventListener("room-data-refresh", syncPersonalPoints);
    const syncTimer = window.setInterval(() => void syncPersonalPoints(), PERSONAL_POINTS_FALLBACK_POLL_MS);

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", handleVisible);
      window.removeEventListener("focus", syncPersonalPoints);
      window.removeEventListener("online", syncPersonalPoints);
      window.removeEventListener("room-data-refresh", syncPersonalPoints);
      window.clearInterval(syncTimer);
      void supabase.removeChannel(channel);
    };
  }, [currentUserId]);

  const handleMoveSeat = (targetSeatId: string) => {
    if (!movingFromSeatId || isMovePending) return;
    setMoveError(null);
    startMoveTransition(async () => {
      const formData = new FormData();
      formData.set("code", roomCode);
      formData.set("sourceSeatId", movingFromSeatId);
      formData.set("targetSeatId", targetSeatId);
      const result: RoomActionState = await moveSeat({ status: "idle" }, formData);
      if (result.status === "error") {
        setMoveError(result.message ?? "移动失败");
      } else {
        setMovingFromSeatId(null);
        setMoveError(null);
        window.dispatchEvent(new Event("room-data-refresh"));
      }
    });
  };

  const occupiedCount = seats.filter((s) => s.nickname).length;

  // Points display
  const currentUserSeat = currentUserId
    ? seats.find((s) => s.user_id === currentUserId) ??
      seats.find((s) => s.id === currentSeatId)
    : seats.find((s) => s.id === currentSeatId);
  const roomPoints = currentUserSeat?.remaining_points ?? 0;

  const pointsDisplay = (() => {
    if (currentUserId && currentUserPoints !== undefined) {
      return roomPoints > 0 ? `${personalPoints}+${roomPoints}[临]` : `${personalPoints}`;
    }
    if (isJoinedGuest && currentSeatId && roomPoints > 0) {
      return `${roomPoints}[临]`;
    }
    return null;
  })();

  const handleGiftSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (isGiftPending || !giftTargetSeatId) return;
    setGiftError(null);
    startGiftTransition(async () => {
      const formData = new FormData();
      formData.set("code", roomCode);
      formData.set("seatId", giftTargetSeatId);
      formData.set("amount", String(giftAmount));
      const result: RoomActionState = await giftPoints({ status: "idle" }, formData);
      if (result.status === "error") {
        setGiftError(result.message ?? "赠送失败");
      } else {
        setGiftTargetSeatId(null);
        setGiftAmount(1);
        setGiftError(null);
        window.dispatchEvent(new Event("room-data-refresh"));
      }
    });
  };

  const movingFromSeat = movingFromSeatId ? seats.find((s) => s.id === movingFromSeatId) : null;
  const giftTargetSeat = giftTargetSeatId ? seats.find((s) => s.id === giftTargetSeatId) : null;

  return (
    <>
      {/* Move seat modal */}
      {movingFromSeatId && (
        <div className="move-seat-overlay" role="dialog" aria-modal="true" aria-label="选择目标座位">
          <div className="move-seat-dialog">
            <div className="move-seat-header">
              <span>
                移动 <strong>{movingFromSeat?.nickname ?? "玩家"}</strong> 到新座位
              </span>
              <button
                className="move-seat-close"
                onClick={() => { setMovingFromSeatId(null); setMoveError(null); }}
                type="button"
                aria-label="取消"
              >
                ✕
              </button>
            </div>

            <div className="move-seat-legend">
              <span className="legend-item"><span className="legend-dot dot-source" />当前座位</span>
              <span className="legend-item"><span className="legend-dot dot-target" />可移动</span>
              <span className="legend-item"><span className="legend-dot dot-occupied" />已占用</span>
            </div>

            {moveError && <div className="error move-seat-error">{moveError}</div>}

            <div className="move-seat-grid">
              {seats.map((seat) => {
                const isSource = seat.id === movingFromSeatId;
                const isOwnerSeat = seat.seat_number === 1;
                const isEmpty = !seat.nickname;
                const isTarget = !isSource && !isOwnerSeat && isEmpty;
                const isOccupiedOther = !isSource && !isEmpty;

                return (
                  <button
                    key={seat.id}
                    className={[
                      "move-seat-card",
                      isSource ? "card-source" : "",
                      isTarget ? "card-target" : "",
                      isOccupiedOther ? "card-occupied" : "",
                      isOwnerSeat && isEmpty ? "card-locked" : "",
                    ].filter(Boolean).join(" ")}
                    disabled={!isTarget || isMovePending}
                    onClick={isTarget ? () => handleMoveSeat(seat.id) : undefined}
                    type="button"
                  >
                    <span className="move-card-number">座位 {seat.seat_number}</span>
                    <span className="move-card-name">
                      {isSource ? movingFromSeat?.nickname : (seat.nickname ?? (isOwnerSeat ? "房主" : "空位"))}
                    </span>
                    <span className="move-card-points">{seat.remaining_points}[临]</span>
                    {isTarget && <span className="move-card-hint">{isMovePending ? "…" : "点击移入"}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Gift points modal */}
      {giftTargetSeatId && giftTargetSeat && (
        <div className="move-seat-overlay" role="dialog" aria-modal="true" aria-label="赠送积分">
          <div className="move-seat-dialog gift-modal">
            <div className="move-seat-header">
              <span>
                赠送积分给 <strong>[{giftTargetSeat.seat_number}] {giftTargetSeat.nickname}</strong>
              </span>
              <button
                className="move-seat-close"
                onClick={() => { setGiftTargetSeatId(null); setGiftAmount(1); }}
                type="button"
                aria-label="取消"
                disabled={isGiftPending}
              >
                ✕
              </button>
            </div>

            <div className="gift-info-block">
              <div className="gift-info-row">
                <span className="muted">你的积分</span>
                <span>
                  <strong>{personalPoints}</strong>
                  {roomPoints > 0 && <span className="muted"> + {roomPoints}[临]</span>}
                </span>
              </div>
              <div className="gift-info-row">
                <span className="muted">{giftTargetSeat.nickname} 的临时积分</span>
                <strong>{giftTargetSeat.remaining_points}[临]</strong>
              </div>
            </div>

            <p className="gift-note muted">赠送将消耗你的个人积分，增加对方的临时积分</p>

            <form className="gift-form" onSubmit={handleGiftSubmit}>
              <label className="gift-amount-label">
                <span>赠送积分数量</span>
                <input
                  className="gift-amount-input"
                  disabled={isGiftPending}
                  min={1}
                  max={personalPoints}
                  name="amount"
                  required
                  type="number"
                  value={giftAmount}
                  onChange={(e) => setGiftAmount(Number(e.target.value))}
                />
              </label>
              {giftError && (
                <div className="error">{giftError}</div>
              )}
              <div className="gift-form-actions">
                <button
                  className="button secondary"
                  onClick={() => { setGiftTargetSeatId(null); setGiftAmount(1); }}
                  type="button"
                  disabled={isGiftPending}
                >
                  取消
                </button>
                <button
                  className="button"
                  disabled={isGiftPending || giftAmount < 1 || giftAmount > personalPoints}
                  type="submit"
                >
                  {isGiftPending ? "赠送中..." : "确认赠送"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <details
        className="room-details"
        onToggle={(event) => {
          if (!wideLayout) setDetailsOpen(event.currentTarget.open);
        }}
        open={wideLayout || detailsOpen}
      >
        <summary>
          <span className="room-summary-title">
            <strong>{roomName}</strong>
            <span>{roomCode}</span>
          </span>
          <span className="room-occupancy">{occupiedCount}/{maxMembers} 人</span>
          {pointsDisplay && (
            <span
              className="room-summary-points"
              title={
                currentUserId && roomPoints > 0
                  ? `个人积分 ${personalPoints} + 座位临时积分 ${roomPoints}（[临]表示房间内临时积分，关房退还给房主）`
                  : roomPoints > 0
                    ? `座位临时积分 ${roomPoints}（[临]表示房间内临时积分）`
                    : undefined
              }
            >
              {pointsDisplay}
            </span>
          )}
        </summary>

        <div className="room-tabs room-tabs-stable">
          <button
            className={`room-tab${activeTab === "manage" ? " active" : ""}`}
            onClick={() => setActiveTab("manage")}
            type="button"
          >
            房间管理
          </button>
          <button
            className={`room-tab${activeTab === "puzzle" ? " active" : ""}`}
            onClick={() => setActiveTab("puzzle")}
            type="button"
          >
            海龟汤
          </button>
        </div>

        <div className="room-details-content">
          <div
            className="room-puzzle-tab"
            hidden={activeTab !== "puzzle"}
          >
            {puzzlePanel}
          </div>

          <div className="room-manage-tab" hidden={activeTab !== "manage"}>
          <div className="room-details-code">
            <span className="room-code-label">房间码</span>
            <div className="room-code-row">
              <span className="room-code">{roomCode}</span>
              <CopyRoomCode code={roomCode} />
              <ShareRoomLink code={roomCode} />
            </div>
          </div>
          <div className="room-detail-meta">
            <span>
              {pointsPerSeat > 0 ? `每位玩家 ${pointsPerSeat} 积分` : "不预留积分"}
            </span>
            <span>{requiresPassword ? "需要密码" : "无需密码"}</span>
          </div>

          <div className="seat-grid">
            {seats.map((seat) => {
              const isSeatOnline = Boolean(seat.nickname && onlineSeatIds.has(seat.id));
              const identity =
                seat.seat_number === 1 ? "owner" : seat.user_id ? "registered" : "guest";
              const identityLabel =
                seat.seat_number === 1 ? "房主" : seat.user_id ? "注册" : "访客";

              return (
              <div
                className={`seat ${seat.nickname ? "occupied" : ""}`}
                key={seat.id}
              >
                <span className="seat-number">{seat.seat_number}</span>
                <span
                  aria-label={seat.nickname ? (isSeatOnline ? "在线" : "离线") : "空位"}
                  className={`seat-status-dot ${seat.nickname ? (isSeatOnline ? "online" : "offline") : "empty"}`}
                  title={seat.nickname ? (isSeatOnline ? "在线" : "离线") : "空位"}
                />
                <strong className="seat-name">{seat.nickname || "等待玩家"}</strong>
                {seat.nickname && seat.remaining_points > 0 && (
                  <span className="seat-points">{seat.remaining_points}[临]</span>
                )}
                {seat.nickname && (
                  <span className={`seat-id-badge ${identity}`}>{identityLabel}</span>
                )}
                {seat.nickname && (
                  <div
                    className="seat-menu"
                    ref={openSeatMenuId === seat.id ? openSeatMenuRef : undefined}
                  >
                    <button
                      aria-expanded={openSeatMenuId === seat.id}
                      aria-label={`${seat.nickname}的更多操作`}
                      className="seat-menu-trigger"
                      onClick={() =>
                        setOpenSeatMenuId((current) =>
                          current === seat.id ? null : seat.id,
                        )
                      }
                      type="button"
                    >
                      ···
                    </button>
                    {openSeatMenuId === seat.id && (
                      <div
                        className={`seat-menu-popover${seatMenuOpensUpward ? " opens-upward" : ""}`}
                      >
                        <div className="seat-menu-info-row">
                          <span className="muted">剩余积分</span>
                          <strong>{seat.remaining_points}</strong>
                        </div>
                        <div className="seat-menu-info-row">
                          <span className="muted">入座时间</span>
                          <strong>
                            {seat.occupied_at
                              ? occupiedAtFormatter.format(new Date(seat.occupied_at))
                              : "未知"}
                          </strong>
                        </div>

                        {isOwner && seat.seat_number !== 1 && (
                          <div className="seat-menu-actions">
                            <button
                              className="seat-menu-action-btn"
                              onClick={() => {
                                setOpenSeatMenuId(null);
                                setGiftTargetSeatId(seat.id);
                                setGiftAmount(1);
                              }}
                              type="button"
                            >
                              赠送积分
                            </button>
                            <button
                              className="seat-menu-action-btn"
                              onClick={() => {
                                setOpenSeatMenuId(null);
                                setMovingFromSeatId(seat.id);
                                setMoveError(null);
                              }}
                              type="button"
                            >
                              调整位置
                            </button>
                            <RoomActionForm
                              action={kickGuest}
                              buttonClassName="seat-menu-action-btn danger"
                              buttonText="移出房间"
                              code={roomCode}
                              pendingText="正在移出..."
                              seatId={seat.id}
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
              );
            })}
          </div>

          {manageExtra}
          </div>
        </div>
      </details>
    </>
  );
}
