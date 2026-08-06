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
  cleanup_reason: "closed_over_3_days" | "abandoned_over_7_days";
  backup_pending: boolean;
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
    ? "已关闭且 3 天无新消息"
    : "超过 7 天没有新消息";
}

export function AdminRoomCleanupList({
  action,
  rooms,
}: AdminRoomCleanupListProps) {
  const roomIds = useMemo(() => rooms.map((room) => room.room_id), [rooms]);
  // 聊天记录尚未完整备份的房间默认不勾选，避免全选后误清掉还没导出的记录。
  const backedUpIds = useMemo(
    () =>
      rooms.filter((room) => !room.backup_pending).map((room) => room.room_id),
    [rooms],
  );
  const [selectedIds, setSelectedIds] = useState<string[]>(backedUpIds);
  const allSelected = rooms.length > 0 && selectedIds.length === rooms.length;
  const pendingCount = rooms.length - backedUpIds.length;
  const selectedPendingCount = rooms.filter(
    (room) => room.backup_pending && selectedIds.includes(room.room_id),
  ).length;

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

      {pendingCount > 0 ? (
        <p className="admin-cleanup-warning">
          有 {pendingCount} 个房间的聊天记录还没导出备份，已默认不勾选。
          {selectedPendingCount > 0
            ? `当前仍选中了其中 ${selectedPendingCount} 个，清理后只能到聊天备份里按日期找回。`
            : ""}
        </p>
      ) : null}

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
                {room.backup_pending ? (
                  <span className="admin-cleanup-tag-warning">备份未导出</span>
                ) : null}
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
