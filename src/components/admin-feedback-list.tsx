"use client";

import { useLayoutEffect, useRef, useState } from "react";

import { SubmitButton } from "@/components/submit-button";
import { formatAdminTime } from "@/lib/admin-time";

type FeedbackStatus = "open" | "handled" | "ignored";

type FeedbackCategory = "bug" | "ai" | "suggestion" | "puzzle" | "other";

export type AdminFeedbackEntry = {
  id: string;
  category: FeedbackCategory;
  content: string;
  status: FeedbackStatus;
  admin_note: string;
  display_name: string;
  page_path: string;
  device_label: string;
  location_label: string;
  created_at: string;
};

type AdminFeedbackListProps = {
  entries: AdminFeedbackEntry[];
  updateAction: (formData: FormData) => Promise<void>;
};

const statusLabels: Record<FeedbackStatus, string> = {
  open: "待处理",
  handled: "已处理",
  ignored: "忽略",
};

const categoryLabels: Record<FeedbackCategory, string> = {
  bug: "功能异常",
  ai: "AI 判定问题",
  suggestion: "体验建议",
  puzzle: "投稿汤",
  other: "其他",
};

function FeedbackRow({
  entry,
  onToggle,
  open,
  updateAction,
}: {
  entry: AdminFeedbackEntry;
  onToggle: (row: HTMLTableRowElement) => void;
  open: boolean;
  updateAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <>
      <tr
        aria-expanded={open}
        className={`admin-table-expandable${open ? " open" : ""}`}
        data-feedback-id={entry.id}
        onClick={(event) => onToggle(event.currentTarget)}
      >
        <td className="muted">{formatAdminTime(entry.created_at)}</td>
        <td>{entry.display_name || <span className="muted">未知用户</span>}</td>
        <td>{categoryLabels[entry.category]}</td>
        <td>
          <span className={`admin-error-status-badge admin-error-badge-${entry.status}`}>
            {statusLabels[entry.status]}
          </span>
        </td>
        <td className="admin-table-clip admin-table-grow">
          {entry.content}
          {entry.admin_note && (
            <span className="muted"> · 备注：{entry.admin_note}</span>
          )}
        </td>
        <td className="admin-table-actions">
          <button className="button ghost small" type="button">
            {open ? "收起" : "处理"}
          </button>
        </td>
      </tr>
      {open && (
        <tr className="admin-table-detail">
          <td colSpan={6}>
            <div className="admin-feedback-detail">
              <p className="admin-feedback-content">{entry.content}</p>
              <form action={updateAction} className="admin-feedback-form">
                <input name="feedbackId" type="hidden" value={entry.id} />
                <label>
                  状态
                  <select defaultValue={entry.status} name="status">
                    {(Object.entries(statusLabels) as [FeedbackStatus, string][]).map(
                      ([value, label]) => (
                        <option key={value} value={value}>
                          {label}
                        </option>
                      ),
                    )}
                  </select>
                </label>
                <label>
                  内部备注
                  <textarea
                    defaultValue={entry.admin_note}
                    maxLength={1000}
                    name="adminNote"
                    placeholder="仅后台可见"
                    rows={3}
                  />
                </label>
                <p className="muted admin-feedback-source">
                  {entry.page_path && `来源 ${entry.page_path} · `}
                  {entry.location_label || "未知地点"} · {entry.device_label || "未知设备"}
                </p>
                <SubmitButton className="button secondary small" pendingText="保存中...">
                  保存
                </SubmitButton>
              </form>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function AdminFeedbackList({
  entries,
  updateAction,
}: AdminFeedbackListProps) {
  const [openId, setOpenId] = useState<string | null>(null);
  // 同一时间只展开一条：上方展开的一条收起时，被点的行会跟着上移，
  // 这里记下点击前它在屏幕上的位置，渲染后把滚动补回去，让它停在原处
  const anchor = useRef<{ id: string; top: number } | null>(null);

  useLayoutEffect(() => {
    const saved = anchor.current;
    anchor.current = null;
    if (!saved) return;
    const row = document.querySelector<HTMLElement>(`[data-feedback-id="${saved.id}"]`);
    if (!row) return;
    const shift = row.getBoundingClientRect().top - saved.top;
    if (shift !== 0) window.scrollBy(0, shift);
  }, [openId]);

  function toggle(id: string, row: HTMLTableRowElement) {
    anchor.current = { id, top: row.getBoundingClientRect().top };
    setOpenId((current) => (current === id ? null : id));
  }

  if (entries.length === 0) {
    return <div className="card muted">还没有匹配的用户反馈。</div>;
  }

  return (
    <div className="admin-table-wrap">
      <table className="admin-table">
        <thead>
          <tr>
            <th>时间</th>
            <th>用户</th>
            <th>类型</th>
            <th>状态</th>
            <th>内容</th>
            <th className="admin-table-actions">操作</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <FeedbackRow
              entry={entry}
              key={entry.id}
              onToggle={(row) => toggle(entry.id, row)}
              open={openId === entry.id}
              updateAction={updateAction}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
