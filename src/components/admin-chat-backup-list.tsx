"use client";

import { useState } from "react";

export type ChatBackupDay = {
  backup_date: string;
  message_count: number;
  last_message_at: string | null;
  downloaded_at: string | null;
};

type AdminChatBackupListProps = {
  days: ChatBackupDay[];
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
  return value ? timeFormatter.format(new Date(value)) : "";
}

export function AdminChatBackupList({ days }: AdminChatBackupListProps) {
  // 客户端乐观记录本次下载，避免等待整页刷新才更新状态。
  const [localDownloads, setLocalDownloads] = useState<Record<string, string>>(
    {},
  );
  const [busyDate, setBusyDate] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function download(date: string) {
    setBusyDate(date);
    setError(null);
    try {
      const response = await fetch(
        `/admin/messages/backup?date=${encodeURIComponent(date)}`,
      );
      if (!response.ok) {
        throw new Error("download_failed");
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `online-soup-chat-${date}.csv`;
      document.body.append(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setLocalDownloads((current) => ({
        ...current,
        [date]: new Date().toISOString(),
      }));
    } catch {
      setError("下载失败，请稍后重试。");
    } finally {
      setBusyDate(null);
    }
  }

  if (days.length === 0) {
    return <div className="card muted">暂时没有可备份的聊天记录。</div>;
  }

  return (
    <div className="admin-points-list">
      {error && <div className="error">{error}</div>}
      {days.map((day) => {
        const downloadedAt = day.downloaded_at ?? localDownloads[day.backup_date] ?? null;
        const isDownloaded = downloadedAt !== null;
        const hasNewerMessages =
          isDownloaded &&
          day.last_message_at !== null &&
          new Date(day.last_message_at).getTime() > new Date(downloadedAt).getTime();
        const busy = busyDate === day.backup_date;

        return (
          <div className="admin-points-row" key={day.backup_date}>
            <div className="admin-message-meta">
              <strong>{day.backup_date}</strong>
              <span>{day.message_count} 条消息</span>
            </div>
            <div className="admin-message-badges">
              {isDownloaded ? (
                <span>已下载 · {formatTime(downloadedAt)}</span>
              ) : (
                <span className="muted">未下载</span>
              )}
              {hasNewerMessages && <span>下载后有新消息</span>}
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => download(day.backup_date)}
                type="button"
              >
                {busy ? "下载中..." : isDownloaded ? "重新下载" : "下载"}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
