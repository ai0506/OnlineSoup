import Link from "next/link";
import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";

import {
  closeRoom,
} from "@/app/rooms/actions";
import { GuestRoomPanel } from "@/components/guest-room-panel";
import { LiveRoomSeats } from "@/components/live-room-seats";
import { PuzzlePanel } from "@/components/puzzle-panel";
import { RoomActionForm } from "@/components/room-action-form";
import { RoomChat } from "@/components/room-chat";
import { hasSupabaseEnv } from "@/lib/env";
import { flashRedirectPath } from "@/lib/flash";
import { createClient } from "@/lib/supabase/server";
import type { CurrentPuzzle, PuzzleListItem, Room, RoomChatBootstrap, RoomSeat } from "@/lib/types";

type RoomPageProps = {
  params: Promise<{ code: string }>;
  searchParams: Promise<{ action?: string }>;
};

export default async function RoomPage({
  params,
  searchParams,
}: RoomPageProps) {
  if (!hasSupabaseEnv()) {
    notFound();
  }

  const { code: rawCode } = await params;
  const { action } = await searchParams;
  const code = rawCode.toUpperCase();
  const supabase = await createClient();
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(`guest_room_${code}`)?.value;
  const guestIdentity = cookieStore.get("guest_identity")?.value;
  const { data: exitReason, error: exitReasonError } = await supabase.rpc(
    "get_room_exit_reason",
    {
      room_code: code,
      guest_token: guestToken || null,
      guest_identity: guestIdentity || null,
    },
  );

  if (exitReasonError) {
    console.error("get_room_exit_reason RPC failed", {
      code: exitReasonError.code,
      message: exitReasonError.message,
      roomCode: code,
    });
  }

  if (exitReason === "closed") {
    redirect(flashRedirectPath("/", {
      code: "room_closed",
      kind: "notice",
      scope: "home",
    }));
  }

  if (exitReason === "kicked") {
    redirect(flashRedirectPath("/", {
      code: "room_kicked",
      kind: "notice",
      scope: "home",
    }));
  }

  const { data: roomData } = await supabase
    .from("rooms")
    .select("*")
    .eq("code", code)
    .single();

  if (!roomData) {
    notFound();
  }

  const room = roomData as Room;

  // 并行：seats、身份认证、房间密码检查互不依赖，一次发出
  const [
    { data: seatData },
    { data: claimsData },
    { data: requiresPasswordData, error: passwordCheckError },
  ] = await Promise.all([
    supabase
      .from("room_seats")
      .select("id, seat_number, nickname, user_id, remaining_points, hint_tokens, occupied_at")
      .eq("room_id", room.id)
      .order("seat_number"),
    supabase.auth.getClaims(),
    supabase.rpc("room_requires_password", { room_code: code }),
  ]);

  if (passwordCheckError) {
    console.error("room_requires_password RPC failed", {
      code: passwordCheckError.code,
      message: passwordCheckError.message,
      roomCode: code,
    });
  }

  const seats = (seatData || []) as RoomSeat[];
  const userId = claimsData?.claims?.sub as string | undefined;
  const isOwner = userId === room.owner_id;
  const isRegisteredMember = Boolean(
    userId && !isOwner && seats.some((seat) => seat.user_id === userId),
  );

  // 并行：游客验证与登录用户积分查询互不依赖
  const [membershipResult, profileResult] = await Promise.all([
    (!userId && guestToken)
      ? supabase.rpc("verify_guest_membership", { room_code: code, guest_token: guestToken })
      : Promise.resolve({ data: null }),
    (userId && (isOwner || isRegisteredMember))
      ? supabase.from("profiles").select("points").eq("id", userId).maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const isJoinedGuest = (!userId && guestToken) ? membershipResult.data === true : false;
  const currentUserPoints: number | undefined =
    userId && (isOwner || isRegisteredMember)
      ? (profileResult.data?.points as number | undefined)
      : undefined;

  if (userId && (isOwner || isRegisteredMember)) {
    const { data: canUseRoomSession, error: sessionCheckError } =
      await supabase.rpc("can_use_room_session", { room_code: code });

    if (sessionCheckError) {
      console.error("can_use_room_session RPC failed", {
        code: sessionCheckError.code,
        message: sessionCheckError.message,
        roomCode: code,
      });
    }

    if (!sessionCheckError && canUseRoomSession === false) {
      if (action === "enter") {
        // User explicitly chose to enter on this device — take over session
        await supabase.rpc("take_over_room_session", { p_room_code: code });
        redirect(`/rooms/${code}`);
      } else {
        // Normal refresh: this device was displaced by another, go home
        redirect(flashRedirectPath("/", {
          code: "room_displaced",
          kind: "notice",
          scope: "home",
        }));
      }
    }
  }

  const verifiedRoomPassword = cookieStore.get(`room_password_${code}`)?.value;
  const requiresPassword =
    requiresPasswordData === true && !/^\d{6}$/.test(verifiedRoomPassword ?? "");

  if (!isOwner && !isRegisteredMember && !isJoinedGuest) {
    return (
      <section className="join-landing">
        <GuestRoomPanel
          isAuthenticated={Boolean(userId)}
          isRegisteredMember={false}
          initiallyJoined={false}
          requiresPassword={requiresPassword}
          roomCode={room.code}
        />
        <Link className="join-back-link" href="/">
          返回
        </Link>
      </section>
    );
  }

  // 并行：chat bootstrap、当前题目、题库列表互不依赖
  const isMember = isOwner || isRegisteredMember || isJoinedGuest;
  const [chatBootstrapResult, puzzleDataResult, puzzleListResult] = await Promise.all([
    isMember
      ? supabase.rpc("get_room_chat_bootstrap", { room_code: code, guest_token: guestToken || null })
      : Promise.resolve({ data: null, error: null }),
    isMember
      ? supabase.rpc("get_room_current_puzzle", { room_code: code, guest_token: guestToken || null })
      : Promise.resolve({ data: null }),
    isOwner
      ? supabase.rpc("get_puzzle_list", { room_code: code })
      : Promise.resolve({ data: null }),
  ]);

  if (chatBootstrapResult.error) {
    console.error("get_room_chat_bootstrap RPC failed", {
      code: chatBootstrapResult.error.code,
      message: chatBootstrapResult.error.message,
      roomCode: code,
    });
  }

  const chatBootstrap = chatBootstrapResult.error
    ? null
    : (chatBootstrapResult.data as RoomChatBootstrap | null);

  const chatSeatId = chatBootstrap?.seat_id ?? null;
  const chatSeat = chatSeatId ? seats.find((s) => s.id === chatSeatId) : null;
  const initialSeatPoints = chatSeat?.remaining_points ?? 0;
  const initialHintTokens = chatSeat?.hint_tokens ?? 0;

  const currentPuzzle = isMember
    ? ((puzzleDataResult.data as CurrentPuzzle | null) ?? null)
    : null;
  const puzzleList: PuzzleListItem[] = isOwner
    ? ((puzzleListResult.data as PuzzleListItem[] | null) ?? [])
    : [];

  return (
    <section className="room-layout">
      <main className="room-chat-panel">
        {chatBootstrap ? (
          <RoomChat
            initialMessages={chatBootstrap.messages}
            roomCode={room.code}
            roomId={room.id}
            seatId={chatSeatId}
            currentUserId={userId}
            initialPersonalPoints={currentUserPoints ?? 0}
            initialSeatPoints={initialSeatPoints}
            initialHintTokens={initialHintTokens}
            initialHasPuzzle={Boolean(currentPuzzle)}
            initialPuzzleId={currentPuzzle?.id ?? null}
            senderName={chatSeat?.nickname ?? undefined}
            senderSeatNumber={chatSeat?.seat_number}
            senderType={chatSeat?.user_id ? "registered" : "guest"}
          />
        ) : (
          <div className="chat-migration-notice">
            <h2>聊天暂时不可用</h2>
            <p className="muted">请稍后再试或联系管理员。</p>
          </div>
        )}
      </main>

      <LiveRoomSeats
        initialSeats={seats}
        isOwner={isOwner}
        isJoinedGuest={isJoinedGuest || isRegisteredMember}
        guestSeatId={chatBootstrap?.seat_id ?? undefined}
        maxMembers={room.max_members}
        pointsPerSeat={room.points_per_seat}
        requiresPassword={requiresPassword}
        roomCode={room.code}
        roomName={room.name}
        roomId={room.id}
        currentUserId={userId}
        currentUserSeatId={chatBootstrap?.seat_id ?? undefined}
        currentUserPoints={currentUserPoints}
        puzzlePanel={
          <PuzzlePanel
            isOwner={isOwner}
            roomCode={room.code}
            roomId={room.id}
            initialPuzzle={currentPuzzle}
            puzzleList={puzzleList}
          />
        }
        manageExtra={
          <div className="room-controls">
            {isOwner && (
              <RoomActionForm
                action={closeRoom}
                buttonClassName="button danger"
                buttonText="关闭房间"
                code={room.code}
                pendingText="正在关闭..."
              />
            )}
            {(isJoinedGuest || isRegisteredMember) && (
              <GuestRoomPanel
                isAuthenticated={Boolean(userId)}
                isRegisteredMember={isRegisteredMember}
                initiallyJoined
                requiresPassword={requiresPassword}
                roomCode={room.code}
              />
            )}
          </div>
        }
      />
    </section>
  );
}
