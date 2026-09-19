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
import { sanitizeRoomMessagesForPlayer } from "@/lib/room-message";
import { createClient } from "@/lib/supabase/server";
import type { CurrentPuzzle, PuzzleListItem, RoomChatBootstrap, RoomMemberState } from "@/lib/types";

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

  const [{ data: claimsData }, { data: joinInfo }] = await Promise.all([
    supabase.auth.getClaims(),
    supabase.rpc("get_room_join_info", { p_room_code: code }),
  ]);
  if (!joinInfo || (joinInfo as { exists?: boolean }).exists !== true) {
    notFound();
  }
  const userId = claimsData?.claims?.sub as string | undefined;
  const stateResult = await supabase.rpc("get_room_member_state", { p_room_code: code, p_guest_token: guestToken || null });
  if (stateResult.error?.message.includes("room_device_in_use")) {
      if (action === "enter") {
        await supabase.rpc("take_over_room_session", { p_room_code: code });
        redirect(`/rooms/${code}`);
      } else {
        redirect(flashRedirectPath("/", {
          code: "room_displaced",
          kind: "notice",
          scope: "home",
        }));
      }
  }
  const memberState = stateResult.error ? null : stateResult.data as RoomMemberState;
  const isMember = Boolean(memberState);
  const isOwner = memberState?.room.is_owner === true;
  const isRegisteredMember = Boolean(userId && isMember && !isOwner);
  const isJoinedGuest = Boolean(!userId && isMember);
  const room = memberState?.room ?? joinInfo as RoomMemberState["room"];
  const seats = memberState?.seats ?? [];
  const currentUserPoints = memberState?.personal_points ?? undefined;

  const verifiedRoomPassword = cookieStore.get(`room_password_${code}`)?.value;
  const requiresPassword = (joinInfo as { requires_password?: boolean }).requires_password === true
    && !/^\d{6}$/.test(verifiedRoomPassword ?? "");

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
            initialMessages={sanitizeRoomMessagesForPlayer(chatBootstrap.messages)}
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
            senderType={userId ? "registered" : "guest"}
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
