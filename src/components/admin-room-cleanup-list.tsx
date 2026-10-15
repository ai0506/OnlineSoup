"use client";

import { useMemo, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { formatAdminTime } from "@/lib/admin-time";

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

function getCleanupReasonLabel(value: AdminCleanupRoom["cleanup_reason"]) {
  return value === "closed_over_3_days"
    ? "关闭超 3 天"
    : "7 天无消息";
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
      <div className="admin-table-toolbar">
        <span className="muted">已选择 {selectedIds.length} / {rooms.length} 个房间</span>
        <SubmitButton className="button danger small" pendingText="清理中...">
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

      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th className="admin-table-check">
                <input
                  aria-label="全选"
                  checked={allSelected}
                  onChange={toggleAll}
                  type="checkbox"
                />
              </th>
              <th>房间码</th>
              <th>名称</th>
              <th>状态</th>
              <th>清理原因</th>
              <th className="admin-table-num">消息</th>
              <th>最后消息</th>
              <th>创建时间</th>
              <th>备份</th>
            </tr>
          </thead>
          <tbody>
            {rooms.map((room) => (
              <tr key={room.room_id}>
                <td className="admin-table-check">
                  <input
                    aria-label={`选择房间 ${room.room_code}`}
                    checked={selectedIds.includes(room.room_id)}
                    name="roomId"
                    onChange={() => toggleRoom(room.room_id)}
                    type="checkbox"
                    value={room.room_id}
                  />
                </td>
                <td>
                  <strong className="admin-table-code">{room.room_code}</strong>
                </td>
                <td className="admin-table-clip" title={room.room_name}>
                  {room.room_name}
                </td>
                <td className="muted">
                  {room.room_status === "closed" ? "已关闭" : "未关闭"}
                </td>
                <td>{getCleanupReasonLabel(room.cleanup_reason)}</td>
                <td className="admin-table-num">{room.message_count}</td>
                <td className="muted">{formatAdminTime(room.last_message_at, "无消息")}</td>
                <td className="muted">{formatAdminTime(room.created_at)}</td>
                <td>
                  {room.backup_pending ? (
                    <span className="admin-pill admin-pill-warning">未导出</span>
                  ) : (
                    <span className="muted">已导出</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </form>
  );
}
