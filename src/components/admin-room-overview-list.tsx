"use client";

import { useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { formatAdminTime } from "@/lib/admin-time";

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

function RoomRow({
  action,
  room,
}: {
  action: (formData: FormData) => void | Promise<void>;
  room: AdminActiveRoom;
}) {
  const [confirming, setConfirming] = useState(false);

  return (
    <tr>
      <td>
        <strong className="admin-table-code">{room.code}</strong>
      </td>
      <td className="admin-table-clip" title={room.name}>
        {room.name}
      </td>
      <td>
        <span className={`admin-room-status-badge ${room.status}`}>
          {room.status === "playing" ? "游戏中" : "等待中"}
        </span>
      </td>
      <td className="admin-table-num">
        {room.occupied_count}/{room.max_members}
      </td>
      <td className="admin-table-clip" title={room.puzzle_title ?? undefined}>
        {room.puzzle_title ?? <span className="muted">—</span>}
      </td>
      <td className="admin-table-num">{room.points_per_seat}</td>
      <td>{room.owner_username ?? <span className="muted">未知</span>}</td>
      <td className="muted">{formatAdminTime(room.created_at)}</td>
      <td className="admin-table-actions">
        {confirming ? (
          <form action={action} className="admin-table-inline-form">
            <input name="roomId" type="hidden" value={room.id} />
            <SubmitButton className="button danger small" pendingText="关闭中...">
              确认关闭
            </SubmitButton>
            <button
              className="button ghost small"
              onClick={() => setConfirming(false)}
              type="button"
            >
              取消
            </button>
          </form>
        ) : (
          <button
            className="button danger-text small"
            onClick={() => setConfirming(true)}
            type="button"
          >
            强制关闭
          </button>
        )}
      </td>
    </tr>
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
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>房间码</th>
            <th>名称</th>
            <th>状态</th>
            <th className="admin-table-num">人数</th>
            <th>当前题目</th>
            <th className="admin-table-num">积分/座</th>
            <th>房主</th>
            <th>创建时间</th>
            <th className="admin-table-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {rooms.map((room) => (
            <RoomRow action={action} key={room.id} room={room} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
