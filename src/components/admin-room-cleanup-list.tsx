"use client";

import { useMemo, useState } from "react";

import { SubmitButton } from "@/components/submit-button";

type AdminCleanupRoom = {
  room_id: string;
  room_code: string;
  room_name: string;
  room_status: "waiting" | "playing" | "closed";
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  message_count: number;
  cleanup_reason: "closed_over_3_days" | "inactive_over_1_day";
};

type AdminRoomCleanupListProps = {
  action: (formData: FormData) => void | Promise<void>;
  rooms: AdminCleanupRoom[];
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
  return value ? timeFormatter.format(new Date(value)) : "无消息";
}

function getCleanupReasonLabel(value: AdminCleanupRoom["cleanup_reason"]) {
  return value === "closed_over_3_days"
    ? "已关闭超过 3 天"
    : "超过 1 天没有新消息";
}

export function AdminRoomCleanupList({
  action,
  rooms,
}: AdminRoomCleanupListProps) {
  const roomIds = useMemo(() => rooms.map((room) => room.room_id), [rooms]);
  const [selectedIds, setSelectedIds] = useState<string[]>(roomIds);
  const allSelected = rooms.length > 0 && selectedIds.length === rooms.length;

  function toggleAll() {
    setSelectedIds(allSelected ? [] : roomIds);
  }

  function toggleRoom(roomId: string) {
    setSelectedIds((current) =>
      current.includes(roomId)
        ? current.filter((id) => id !== roomId)
        : [...current, roomId],
    );
  }

  if (rooms.length === 0) {
    return <div className="card muted">暂时没有符合条件的房间。</div>;
  }

  return (
    <form action={action} className="admin-cleanup-list">
      <div className="admin-cleanup-toolbar">
        <button className="button secondary" onClick={toggleAll} type="button">
          {allSelected ? "取消全选" : "全选"}
        </button>
        <span className="muted">已选择 {selectedIds.length} / {rooms.length} 个房间</span>
        <SubmitButton className="button danger" pendingText="清理中...">
          强制清理
        </SubmitButton>
      </div>

      {rooms.map((room) => {
        const checked = selectedIds.includes(room.room_id);

        return (
          <article className="admin-cleanup-row" key={room.room_id}>
            <label className="admin-cleanup-select">
              <input
                checked={checked}
                name="roomId"
                onChange={() => toggleRoom(room.room_id)}
                type="checkbox"
                value={room.room_id}
              />
              <span>选择</span>
            </label>

            <div className="admin-cleanup-main">
              <div>
                <strong>{room.room_code}</strong>
                <span>{room.room_name}</span>
              </div>
              <div className="admin-cleanup-tags">
                <span>{room.room_status === "closed" ? "已关闭" : "未关闭"}</span>
                <span>{getCleanupReasonLabel(room.cleanup_reason)}</span>
                <span>{room.message_count} 条消息</span>
              </div>
              <p className="muted">
                创建：{formatTime(room.created_at)} · 更新：
                {formatTime(room.updated_at)} · 最后消息：
                {formatTime(room.last_message_at)}
              </p>
            </div>
          </article>
        );
      })}
    </form>
  );
}
