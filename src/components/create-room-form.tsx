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
    <form action={formAction} className="form-grid">
      <label>
        房间名称
        <input
          defaultValue={defaultRoomName}
          maxLength={8}
          minLength={2}
          name="name"
          required
        />
        <span className="help">2 到 8 个任意字符。</span>
      </label>
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
        <span className="help">包含房主在内，1 到 20 个座位。</span>
      </label>
      <label>
        每位玩家积分
        <input
          max={100}
          min={0}
          name="pointsPerSeat"
          onChange={(e) => setPointsPerSeat(e.target.value)}
          required
          type="number"
          value={pointsPerSeat}
        />
        <span className="help">每位玩家预留积分，0 到 100。设为 0 表示本场不预留积分。</span>
      </label>

      <div className="points-preview">
        {cost === 0 ? (
          <span>本次不消耗积分</span>
        ) : (
          <span>本次消耗：<strong>{cost} 积分</strong>（{seats} 座 × {pointsPerSeat} 分）</span>
        )}
        {cost > 0 && (
          <span className={remaining < 0 ? "points-insufficient" : "points-remaining"}>
            创建后剩余：<strong>{remaining} 积分</strong>
          </span>
        )}
      </div>

      <label>
        6 位数字密码（可选）
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
        <span className="help">设置密码后，加入者需要输入相同的 6 位数字。</span>
      </label>

      {state.status === "error" && (
        <div className="error" role="alert">{state.message}</div>
      )}

      <SubmitButton pendingText="正在创建...">创建房间</SubmitButton>
    </form>
  );
}
