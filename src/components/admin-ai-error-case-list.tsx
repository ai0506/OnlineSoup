"use client";

import { useState, useTransition } from "react";
import { AdminAiErrorEditForm } from "@/components/admin-ai-error-edit-form";

type AiErrorStatus = "open" | "reviewed" | "fixed" | "ignored";

type AdminAiErrorCaseRoom = {
  code: string;
  name: string;
  status: "waiting" | "playing" | "closed";
};

export type AdminAiErrorCaseEntry = {
  id: string;
  question_content: string;
  ai_content: string;
  correct_answer: string;
  note: string;
  status: AiErrorStatus;
  puzzle_title: string;
  puzzle_surface: string;
  puzzle_bottom: string;
  created_at: string;
  rooms: AdminAiErrorCaseRoom | null;
};

type AdminAiErrorCaseListProps = {
  cases: AdminAiErrorCaseEntry[];
  updateAction: (formData: FormData) => Promise<void>;
  batchUpdateAction: (formData: FormData) => Promise<void>;
  exportHref: string;
};

const statusLabels: Record<AiErrorStatus, string> = {
  open: "待处理",
  reviewed: "已复核",
  fixed: "已修复",
  ignored: "忽略",
};

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatTime(value: string) {
  return timeFormatter.format(new Date(value));
}

function parseAiText(content: string): string {
  try {
    const parsed = JSON.parse(content) as { text?: unknown };
    if (typeof parsed.text === "string") return parsed.text;
  } catch {
    // not JSON, return as-is
  }
  return content;
}

export function AdminAiErrorCaseList({
  cases,
  updateAction,
  batchUpdateAction,
  exportHref,
}: AdminAiErrorCaseListProps) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [batchStatus, setBatchStatus] = useState<AiErrorStatus>("reviewed");
  const [isPending, startTransition] = useTransition();

  const allSelected = cases.length > 0 && selected.size === cases.length;

  function toggleAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(cases.map((c) => c.id)));
    }
  }

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBatchUpdate(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (selected.size === 0) return;
    const formData = new FormData();
    for (const id of selected) {
      formData.append("caseIds", id);
    }
    formData.set("status", batchStatus);
    startTransition(async () => {
      await batchUpdateAction(formData);
      setSelected(new Set());
    });
  }

  return (
    <div className="admin-ai-error-list">
      <div className="admin-ai-error-toolbar">
        <label className="admin-cleanup-select">
          <input
            checked={allSelected}
            onChange={toggleAll}
            type="checkbox"
          />
          {selected.size > 0 ? `已选 ${selected.size} 条` : "全选"}
        </label>
        {selected.size > 0 && (
          <form className="admin-ai-error-batch-form" onSubmit={handleBatchUpdate}>
            <select
              onChange={(e) => setBatchStatus(e.target.value as AiErrorStatus)}
              value={batchStatus}
            >
              {(Object.entries(statusLabels) as [AiErrorStatus, string][]).map(
                ([val, label]) => (
                  <option key={val} value={val}>
                    {label}
                  </option>
                ),
              )}
            </select>
            <button className="button secondary" disabled={isPending} type="submit">
              {isPending ? "更新中…" : `批量更新 (${selected.size})`}
            </button>
          </form>
        )}
        <a className="button ghost admin-ai-error-export-btn" href={exportHref}>
          导出 CSV
        </a>
      </div>

      {cases.map((item) => (
        <article
          className={`admin-ai-error-row${selected.has(item.id) ? " selected" : ""}`}
          key={item.id}
        >
          <div className="admin-ai-error-row-header">
            <input
              checked={selected.has(item.id)}
              onChange={() => toggle(item.id)}
              type="checkbox"
            />
            <div className="admin-message-meta admin-ai-error-row-meta">
              <strong>{item.rooms?.code ?? "房间已删除"}</strong>
              <span>{item.puzzle_title}</span>
              <span>{formatTime(item.created_at)}</span>
            </div>
            <span className={`admin-error-status-badge admin-error-badge-${item.status}`}>
              {statusLabels[item.status]}
            </span>
            <AdminAiErrorEditForm
              action={updateAction}
              caseId={item.id}
              correctAnswer={item.correct_answer}
              note={item.note}
              status={item.status}
            />
          </div>

          <div className="admin-ai-error-sample">
            <div>
              <strong>玩家提问</strong>
              <p>{item.question_content}</p>
            </div>
            <div>
              <strong>AI 回答</strong>
              <p>{parseAiText(item.ai_content)}</p>
            </div>
          </div>

          {item.correct_answer && (
            <div className="admin-ai-error-answer-row">
              <span className="admin-ai-error-answer-label">正确答案</span>
              <span className="admin-ai-error-answer-text">{item.correct_answer}</span>
            </div>
          )}

          {item.note && (
            <p className="admin-ai-error-note">{item.note}</p>
          )}

          <details className="admin-collapsible admin-ai-error-story-collapsible">
            <summary>查看题面 · 汤底</summary>
            <div className="admin-ai-error-story">
              <div>
                <strong>题面</strong>
                <p>{item.puzzle_surface}</p>
              </div>
              <div>
                <strong>汤底</strong>
                <p>{item.puzzle_bottom}</p>
              </div>
            </div>
          </details>
        </article>
      ))}

      {cases.length === 0 && (
        <div className="card muted">还没有匹配的 AI 错误案例。</div>
      )}
    </div>
  );
}
