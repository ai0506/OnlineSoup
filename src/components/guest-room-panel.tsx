"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import {
  joinRoom,
  leaveRoom,
  type RoomActionState,
  verifyRoomPassword,
} from "@/app/rooms/actions";
import { ConfirmDialog } from "@/components/confirm-dialog";
import { SubmitButton } from "@/components/submit-button";

const initialState: RoomActionState = { status: "idle" };

type GuestRoomPanelProps = {
  activeRoomCode?: string;
  isAuthenticated: boolean;
  isRegisteredMember: boolean;
  initiallyJoined: boolean;
  requiresPassword: boolean;
  roomCode: string;
};

export function GuestRoomPanel({
  activeRoomCode,
  isAuthenticated,
  isRegisteredMember,
  initiallyJoined,
  requiresPassword,
  roomCode,
}: GuestRoomPanelProps) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [leaveConfirmOpen, setLeaveConfirmOpen] = useState(false);
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
      window.dispatchEvent(new Event("room-data-refresh"));
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
        <button
          className="button secondary danger-text"
          onClick={() => setLeaveConfirmOpen(true)}
          type="button"
        >
          退出房间
        </button>
        {leaveConfirmOpen && (
          <ConfirmDialog onClose={() => setLeaveConfirmOpen(false)} title="退出房间？">
            <p className="muted">退出后座位会空出来，座位上剩余的临时积分留在房间里，不会带走。</p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setLeaveConfirmOpen(false)}
                type="button"
              >
                取消
              </button>
              <form
                action={leaveAction}
                onSubmit={() => {
                  window.dispatchEvent(new Event("room-leave-started"));
                }}
              >
                <input name="code" type="hidden" value={roomCode} />
                <SubmitButton
                  className="button danger"
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
          </ConfirmDialog>
        )}
      </div>
    );
  }

  if (activeRoomCode) {
    return (
      <div className="join-room-panel">
        <p className="join-room-code">房间码 {roomCode}</p>
        <h1>加入房间</h1>
        <div className="join-active-room">
          <p>
            你当前在房间 {activeRoomCode} 中。请先回到原房间退出；如果原房间是你创建的，需要先关闭它，再加入本房间。
          </p>
          <Link className="button" href={`/rooms/${activeRoomCode}?action=enter`}>
            返回原房间
          </Link>
        </div>
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
