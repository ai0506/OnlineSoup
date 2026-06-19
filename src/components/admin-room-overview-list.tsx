"use client";

import { useState } from "react";

import { SubmitButton } from "@/components/submit-button";

export type AdminActiveRoom = {
  id: string;
  code: string;
  name: string;
  status: "waiting" | "playing";
  max_members: number;
  points_per_seat: number;
  created_at: string;
  owner_username: string | null;
  puzzle_title: string | null;
  occupied_count: number;
};

type AdminRoomOverviewListProps = {
  action: (formData: FormData) => void | Promise<void>;
  rooms: AdminActiveRoom[];
};

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function formatTime(value?: string | null) {
  return value ? timeFormatter.format(new Date(value)) : "-";
}

function RoomRow({
  action,
  room,
}: {
  action: (formData: FormData) => void | Promise<void>;
  room: AdminActiveRoom;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <article className="admin-room-row">
      <div className="admin-room-main">
        <div className="admin-room-title">
          <strong>{room.code}</strong>
          <span>{room.name}</span>
        </div>
        <div className="admin-message-badges">
          <span className={`admin-room-status-badge ${room.status}`}>
            {room.status === "playing" ? "游戏中" : "等待中"}
          </span>
          <span>
            {room.occupied_count}/{room.max_members} 人
          </span>
          {room.puzzle_title && <span>题：{room.puzzle_title}</span>}
          {room.points_per_seat > 0 && <span>{room.points_per_seat} pt/座</span>}
        </div>
        <p className="muted admin-room-meta">
          房主：{room.owner_username ?? "未知"} · 创建：{formatTime(room.created_at)}
        </p>
      </div>

      <div className="admin-room-actions">
        {confirming ? (
          <form action={action} className="admin-room-confirm-form">
            <input name="roomId" type="hidden" value={room.id} />
            <SubmitButton className="button danger" pendingText="关闭中...">
              确认关闭
            </SubmitButton>
            <button
              className="button ghost"
              onClick={() => setConfirming(false)}
              type="button"
            >
              取消
            </button>
          </form>
        ) : (
          <button
            className="button secondary"
            onClick={() => setConfirming(true)}
            type="button"
          >
            强制关闭
          </button>
        )}
      </div>
    </article>
  );
}

export function AdminRoomOverviewList({
  action,
  rooms,
}: AdminRoomOverviewListProps) {
  if (rooms.length === 0) {
    return <div className="card muted">当前没有活跃房间。</div>;
  }

  return (
    <div className="admin-rooms-list">
      {rooms.map((room) => (
        <RoomRow action={action} key={room.id} room={room} />
      ))}
    </div>
  );
}
