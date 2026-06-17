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
};

export default async function RoomPage({
  params,
}: RoomPageProps) {
  if (!hasSupabaseEnv()) {
    notFound();
  }

  const { code: rawCode } = await params;
  const code = rawCode.toUpperCase();
  const supabase = await createClient();
  const cookieStore = await cookies();
  const guestToken = cookieStore.get(`guest_room_${code}`)?.value;
  const guestIdentity = cookieStore.get("guest_identity")?.value;
  let { data: exitReason, error: exitReasonError } = await supabase.rpc(
    "get_room_exit_reason",
    {
      room_code: code,
      guest_token: guestToken || null,
      guest_identity: guestIdentity || null,
    },
  );

  if (exitReasonError) {
    const legacyResult = await supabase.rpc("get_room_exit_reason", {
      room_code: code,
      guest_token: guestToken || null,
    });
    exitReason = legacyResult.data;
    exitReasonError = legacyResult.error;
  }

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
  const { data: seatData } = await supabase
    .from("room_seats")
    .select(
      "id, seat_number, nickname, user_id, remaining_points, occupied_at",
    )
    .eq("room_id", room.id)
    .order("seat_number");
  const seats = (seatData || []) as RoomSeat[];

  const { data: claimsData } = await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub as string | undefined;
  const isOwner = userId === room.owner_id;
  const isRegisteredMember = Boolean(
    userId && !isOwner && seats.some((seat) => seat.user_id === userId),
  );
  let isJoinedGuest = false;
  let currentUserPoints: number | undefined;

  if (!userId && guestToken) {
    const { data: membership } = await supabase.rpc("verify_guest_membership", {
      room_code: code,
      guest_token: guestToken,
    });
    isJoinedGuest = membership === true;
  }

  if (userId && (isOwner || isRegisteredMember)) {
    const { data: profileData } = await supabase
      .from("profiles")
      .select("points")
      .eq("id", userId)
      .maybeSingle();
    currentUserPoints = profileData?.points;
  }

  const { data: requiresPasswordData, error: passwordCheckError } =
    await supabase.rpc("room_requires_password", {
      room_code: code,
    });
  if (passwordCheckError) {
    console.error("room_requires_password RPC failed", {
      code: passwordCheckError.code,
      message: passwordCheckError.message,
      roomCode: code,
    });
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

  let chatBootstrap: RoomChatBootstrap | null = null;
  if (isOwner || isRegisteredMember || isJoinedGuest) {
    const { data, error } = await supabase.rpc("get_room_chat_bootstrap", {
      room_code: code,
      guest_token: guestToken || null,
    });

    if (error) {
      console.error("get_room_chat_bootstrap RPC failed", {
        code: error.code,
        message: error.message,
        roomCode: code,
      });
    } else {
      chatBootstrap = data as RoomChatBootstrap;
    }
  }

  const chatSeatId = chatBootstrap?.seat_id ?? null;
  const chatSeat = chatSeatId ? seats.find((s) => s.id === chatSeatId) : null;
  const initialSeatPoints = chatSeat?.remaining_points ?? 0;

  // 题目数据
  let currentPuzzle: CurrentPuzzle | null = null;
  let puzzleList: PuzzleListItem[] = [];

  if (isOwner || isRegisteredMember || isJoinedGuest) {
    const { data: puzzleData } = await supabase.rpc("get_room_current_puzzle", {
      room_code: code,
      guest_token: guestToken || null,
    });
    currentPuzzle = (puzzleData as CurrentPuzzle | null) ?? null;
  }

  if (isOwner) {
    const { data: listData } = await supabase.rpc("get_puzzle_list", { room_code: code });
    puzzleList = (listData as PuzzleListItem[] | null) ?? [];
  }

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
            <Link className="button secondary room-back-link" href="/">
              返回大厅
            </Link>
          </div>
        }
      />
    </section>
  );
}
