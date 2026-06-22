"use client";

import { useState } from "react";

export type PuzzleCacheEntry = {
  id: number;
  question_text: string;
  normalized_question: string;
  answer_type: "yes" | "no";
  hit_count: number;
  created_at: string;
  last_hit_at: string | null;
};

type AdminPuzzleCachePanelProps = {
  puzzleId: number;
  entries: PuzzleCacheEntry[];
  deleteAction: (formData: FormData) => void | Promise<void>;
  updateAnswerAction: (formData: FormData) => void | Promise<void>;
  clearAction: (formData: FormData) => void | Promise<void>;
};

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function formatTime(value: string | null) {
  return value ? timeFormatter.format(new Date(value)) : "从未命中";
}

function answerLabel(type: "yes" | "no") {
  return type === "yes" ? "是" : "否";
}

export function AdminPuzzleCachePanel({
  puzzleId,
  entries,
  deleteAction,
  updateAnswerAction,
  clearAction,
}: AdminPuzzleCachePanelProps) {
  const [deletingEntry, setDeletingEntry] = useState<PuzzleCacheEntry | null>(null);
  const [clearing, setClearing] = useState(false);

  if (entries.length === 0) {
    return <div className="card muted">这道题还没有任何问答缓存。</div>;
  }

  return (
    <>
      <div className="admin-cache-panel-actions">
        <span className="muted">共 {entries.length} 条缓存</span>
        <button
          className="button danger"
          onClick={() => setClearing(true)}
          type="button"
        >
          清空整题缓存
        </button>
      </div>

      <div className="admin-cache-entry-list">
        {entries.map((entry) => (
          <article className="admin-cache-entry" key={entry.id}>
            <div className="admin-cache-entry-main">
              <p className="admin-cache-entry-question">{entry.question_text}</p>
              <div className="admin-cache-entry-meta">
                <span className={`admin-cache-answer ${entry.answer_type}`}>
                  {answerLabel(entry.answer_type)}
                </span>
                <span>命中 {entry.hit_count} 次</span>
                <span>最近命中 {formatTime(entry.last_hit_at)}</span>
              </div>
            </div>
            <div className="admin-cache-entry-actions">
              <button
                className="button secondary"
                onClick={() => {
                  const formData = new FormData();
                  formData.set("entryId", String(entry.id));
                  formData.set("answerType", entry.answer_type === "yes" ? "no" : "yes");
                  void updateAnswerAction(formData);
                }}
                type="button"
              >
                改为「{answerLabel(entry.answer_type === "yes" ? "no" : "yes")}」
              </button>
              <button
                className="button danger"
                onClick={() => setDeletingEntry(entry)}
                type="button"
              >
                删除
              </button>
            </div>
          </article>
        ))}
      </div>

      {deletingEntry && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="确认删除缓存条目">
          <div className="dialog-panel">
            <h2>删除这条缓存？</h2>
            <p>「{deletingEntry.question_text}」的缓存答案将被删除，下次相同提问会重新调用 AI。</p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setDeletingEntry(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button danger"
                onClick={() => {
                  const formData = new FormData();
                  formData.set("entryId", String(deletingEntry.id));
                  setDeletingEntry(null);
                  void deleteAction(formData);
                }}
                type="button"
              >
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}

      {clearing && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="确认清空整题缓存">
          <div className="dialog-panel">
            <h2>清空这道题的全部缓存？</h2>
            <p>该题的 {entries.length} 条问答缓存将被全部删除，无法恢复。</p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setClearing(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button danger"
                onClick={() => {
                  const formData = new FormData();
                  formData.set("puzzleId", String(puzzleId));
                  setClearing(false);
                  void clearAction(formData);
                }}
                type="button"
              >
                确认清空
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
