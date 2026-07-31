"use client";

import { useState } from "react";

import { SubmitButton } from "@/components/submit-button";

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

// 正文最长 2000 字，超过这个长度默认折叠，避免列表被单条撑满
const COLLAPSE_THRESHOLD = 160;

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function FeedbackContent({ content }: { content: string }) {
  const [expanded, setExpanded] = useState(false);

  if (content.length <= COLLAPSE_THRESHOLD) {
    return <p className="admin-feedback-content">{content}</p>;
  }

  return (
    <div className="admin-feedback-content-wrap">
      <p className="admin-feedback-content">
        {expanded ? content : `${content.slice(0, COLLAPSE_THRESHOLD)}…`}
      </p>
      <button
        className="button ghost admin-feedback-expand"
        onClick={() => setExpanded((value) => !value)}
        type="button"
      >
        {expanded ? "收起" : `展开全文（${content.length} 字）`}
      </button>
    </div>
  );
}

function FeedbackRow({
  entry,
  updateAction,
}: {
  entry: AdminFeedbackEntry;
  updateAction: (formData: FormData) => Promise<void>;
}) {
  return (
    <article className="admin-feedback-row">
      <div className="admin-message-meta admin-feedback-meta">
        <strong>{categoryLabels[entry.category]}</strong>
        <span>{entry.display_name || "未知用户"}</span>
        <span>{timeFormatter.format(new Date(entry.created_at))}</span>
        {entry.page_path && <span>来源 {entry.page_path}</span>}
        <span className={`admin-error-status-badge admin-error-badge-${entry.status}`}>
          {statusLabels[entry.status]}
        </span>
      </div>

      <FeedbackContent content={entry.content} />

      <details className="admin-collapsible admin-feedback-actions">
        <summary>处理这条反馈</summary>
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
            {entry.location_label || "未知地点"} · {entry.device_label || "未知设备"}
          </p>
          <SubmitButton className="button secondary" pendingText="保存中...">
            保存
          </SubmitButton>
        </form>
      </details>

      {entry.admin_note && (
        <p className="admin-ai-error-note">备注：{entry.admin_note}</p>
      )}
    </article>
  );
}

export function AdminFeedbackList({
  entries,
  updateAction,
}: AdminFeedbackListProps) {
  return (
    <div className="admin-feedback-list">
      {entries.map((entry) => (
        <FeedbackRow entry={entry} key={entry.id} updateAction={updateAction} />
      ))}

      {entries.length === 0 && (
        <div className="card muted">还没有匹配的用户反馈。</div>
      )}
    </div>
  );
}
