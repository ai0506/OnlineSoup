"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  joinRoom,
  leaveRoom,
  type RoomActionState,
  verifyRoomPassword,
} from "@/app/rooms/actions";
import { SubmitButton } from "@/components/submit-button";

const initialState: RoomActionState = { status: "idle" };

type GuestRoomPanelProps = {
  isAuthenticated: boolean;
  isRegisteredMember: boolean;
  initiallyJoined: boolean;
  requiresPassword: boolean;
  roomCode: string;
};

export function GuestRoomPanel({
  isAuthenticated,
  isRegisteredMember,
  initiallyJoined,
  requiresPassword,
  roomCode,
}: GuestRoomPanelProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [passwordState, passwordAction] = useActionState(
    verifyRoomPassword,
    initialState,
  );
  const [joinState, joinAction] = useActionState(joinRoom, initialState);
  const [leaveState, leaveAction] = useActionState(leaveRoom, initialState);
  const joined =
    isRegisteredMember ||
    initiallyJoined ||
    (joinState.status === "success" && Boolean(joinState.seatId));
  const passwordAccepted =
    !requiresPassword || passwordState.status === "success";

  useEffect(() => {
    if (joinState.navigateTo) {
      router.replace(joinState.navigateTo);
      return;
    }
    if (joinState.status === "success" && joinState.seatId) {
      window.dispatchEvent(
        new CustomEvent("guest-seat-changed", {
          detail: { seatId: joinState.seatId },
        }),
      );
      router.refresh();
    }
  }, [joinState, router]);

  useEffect(() => {
    if (leaveState.navigateTo) {
      router.replace(leaveState.navigateTo);
      return;
    }
    if (leaveState.status === "error") {
      window.dispatchEvent(new Event("room-leave-cancelled"));
    }
  }, [leaveState, router]);

  if (joined) {
    return (
      <div className="room-member-actions">
        {joinState.message && <div className="notice">{joinState.message}</div>}
        <form
          action={leaveAction}
          onSubmit={() => {
            window.dispatchEvent(new Event("room-leave-started"));
          }}
        >
          <input name="code" type="hidden" value={roomCode} />
          <SubmitButton
            className="button secondary danger-text"
            pendingText="正在退出..."
          >
            退出房间
          </SubmitButton>
          {leaveState.status === "error" && (
            <div className="error" role="alert">
              {leaveState.message}
            </div>
          )}
        </form>
      </div>
    );
  }

  return (
    <div className="join-room-panel">
      <p className="join-room-code">房间码 {roomCode}</p>
      <h1>加入房间</h1>
      {passwordAccepted ? (
        <form action={joinAction} className="form-grid">
          <input name="code" type="hidden" value={roomCode} />
          {requiresPassword && (
            <input name="password" type="hidden" value={password} />
          )}
          {!isAuthenticated && (
            <>
              <input
                aria-label="访客名字"
                autoFocus
                maxLength={8}
                minLength={3}
                name="nickname"
                pattern="[A-Za-z0-9_]{3,8}"
                placeholder="访客名字"
                required
              />
              <span className="help">
                3 到 8 位英文字母、数字或下划线，不能与注册用户名或房内成员重名。
              </span>
            </>
          )}
          <SubmitButton pendingText="正在进入...">进入房间</SubmitButton>
          {joinState.status === "error" && (
            <div className="error" role="alert">
              {joinState.message}
            </div>
          )}
        </form>
      ) : (
        <form action={passwordAction} className="form-grid">
          <input name="code" type="hidden" value={roomCode} />
          <input
            aria-label="房间密码"
            autoFocus
            inputMode="numeric"
            maxLength={6}
            minLength={6}
            name="password"
            onChange={(event) => setPassword(event.target.value)}
            pattern="[0-9]{6}"
            placeholder="输入 6 位数字密码"
            required
            type="password"
            value={password}
          />
          <SubmitButton pendingText="正在验证...">继续</SubmitButton>
          {passwordState.status === "error" && (
            <div className="error" role="alert">
              {passwordState.message}
            </div>
          )}
        </form>
      )}
    </div>
  );
}
