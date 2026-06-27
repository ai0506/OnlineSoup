"use client";

import { useRouter } from "next/navigation";
import { useActionState, useEffect, useState } from "react";

import { createRoom } from "@/app/rooms/actions";
import type { RoomActionState } from "@/app/rooms/actions";
import { SubmitButton } from "@/components/submit-button";

const initialState: RoomActionState = { status: "idle" };

type CreateRoomFormProps = {
  currentPoints: number;
  defaultRoomName: string;
};

export function CreateRoomForm({ currentPoints, defaultRoomName }: CreateRoomFormProps) {
  const router = useRouter();
  const [state, formAction] = useActionState(createRoom, initialState);

  const [seats, setSeats] = useState("5");
  const [pointsPerSeat, setPointsPerSeat] = useState("0");

  const seatCount = seats === "" ? 0 : Number(seats);
  const seatPoints = pointsPerSeat === "" ? 0 : Number(pointsPerSeat);
  const cost = seatCount * seatPoints;
  const remaining = currentPoints - cost;

  useEffect(() => {
    if (state.navigateTo) {
      router.replace(state.navigateTo);
    }
  }, [router, state]);

  return (
    <form action={formAction} className="form-grid create-room-form">
      <label>
        房间名称
        <input
          defaultValue={defaultRoomName}
          maxLength={8}
          minLength={2}
          name="name"
          placeholder="2–8 个字符"
          required
        />
      </label>
      <div className="form-row-2">
        <label>
          座位数量
          <input
            max={20}
            min={1}
            name="maxMembers"
            onChange={(e) => setSeats(e.target.value)}
            required
            type="number"
            value={seats}
          />
        </label>
        <label>
          每座积分
          <input
            max={100}
            min={0}
            name="pointsPerSeat"
            onChange={(e) => setPointsPerSeat(e.target.value)}
            required
            type="number"
            value={pointsPerSeat}
          />
        </label>
      </div>
      <div className="create-room-cost">
        {cost === 0 ? (
          <span className="muted">本次不消耗积分</span>
        ) : (
          <span>消耗 <strong>{cost}</strong> 积分（{seats} 座 × {pointsPerSeat} 分）</span>
        )}
        {cost > 0 && (
          <span className={remaining < 0 ? "points-insufficient" : "muted"}>
            剩余 <strong>{remaining}</strong>
          </span>
        )}
      </div>
      <label>
        密码<span className="muted">（可选，6 位数字）</span>
        <input
          autoComplete="new-password"
          inputMode="numeric"
          maxLength={6}
          minLength={6}
          name="password"
          pattern="[0-9]{6}"
          placeholder="留空则无需密码"
          type="password"
        />
      </label>
      {state.status === "error" && (
        <div className="error" role="alert">{state.message}</div>
      )}
      <SubmitButton pendingText="正在创建...">创建房间</SubmitButton>
    </form>
  );
}
