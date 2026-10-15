"use client";

import { useState } from "react";

import { usePendingAction } from "@/lib/use-pending-action";

export type PuzzleCacheEntry = {
  id: number;
  question_text: string;
  normalized_question: string;
  answer_type: "yes" | "no";
  status: "pending" | "approved";
  hit_count: number;
  created_at: string;
  last_hit_at: string | null;
  engine?: "v1" | "v2";
  content_version?: number | null;
};

type AdminPuzzleCachePanelProps = {
  puzzleId: number;
  puzzleContentVersion: number | null;
  entries: PuzzleCacheEntry[];
  approveAction: (formData: FormData) => void | Promise<void>;
  deleteAction: (formData: FormData) => void | Promise<void>;
  updateAnswerAction: (formData: FormData) => void | Promise<void>;
  updateTextAction: (formData: FormData) => void | Promise<void>;
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
  puzzleContentVersion,
  entries,
  approveAction,
  deleteAction,
  updateAnswerAction,
  updateTextAction,
  clearAction,
}: AdminPuzzleCachePanelProps) {
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editingText, setEditingText] = useState("");
  const [clearing, setClearing] = useState(false);
  const [syncedEntries, setSyncedEntries] = useState(entries);
  const { busy, pendingKey, run } = usePendingAction<string>(entries);

  // 服务端数据回来即视为本次操作结束：收起编辑态和确认框
  if (syncedEntries !== entries) {
    setSyncedEntries(entries);
    setEditingId(null);
    setDeletingId(null);
    setClearing(false);
  }

  const deletingEntry = entries.find((entry) => entry.id === deletingId) ?? null;
  const pendingLabel = "处理中…";

  if (entries.length === 0) {
    return <div className="card muted">这道题还没有任何问答缓存。</div>;
  }

  return (
    <>
      <div className="admin-cache-panel-actions">
        <span className="muted">
          共 {entries.length} 条缓存，待批准 {entries.filter((entry) => entry.status === "pending").length} 条
        </span>
        <button
          className="button danger"
          disabled={busy}
          onClick={() => setClearing(true)}
          type="button"
        >
          清空整题缓存
        </button>
      </div>

      <div className="admin-cache-entry-list">
        {entries.map((entry) => {
          const isEditing = editingId === entry.id;
          return (
            <article className="admin-cache-entry" key={entry.id}>
              <div className="admin-cache-entry-main">
                {isEditing ? (
                  <textarea
                    className="admin-cache-entry-input"
                    maxLength={500}
                    onChange={(event) => setEditingText(event.target.value)}
                    rows={2}
                    value={editingText}
                  />
                ) : (
                  <p className="admin-cache-entry-question">{entry.question_text}</p>
                )}
                <div className="admin-cache-entry-meta">
                  <span className={`admin-cache-answer ${entry.answer_type}`}>
                    {answerLabel(entry.answer_type)}
                  </span>
                  <span>{entry.status === "approved" ? "已批准" : "待批准"}</span>
                  {entry.engine === "v2" ? (
                    entry.content_version !== puzzleContentVersion ? (
                      <span className="admin-cache-stale">
                        v2 · 内容版本 {entry.content_version}（题目已更新，不再命中）
                      </span>
                    ) : (
                      <span>v2 · 内容版本 {entry.content_version}</span>
                    )
                  ) : (
                    <span>v1</span>
                  )}
                  <span>命中 {entry.hit_count} 次</span>
                  <span>最近命中 {formatTime(entry.last_hit_at)}</span>
                </div>
              </div>
              <div className="admin-cache-entry-actions">
                {isEditing ? (
                  <>
                    <button
                      className="button"
                      disabled={
                        busy ||
                        editingText.trim().length === 0 ||
                        editingText.trim() === entry.question_text
                      }
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("entryId", String(entry.id));
                        formData.set("questionText", editingText.trim());
                        run(`text-${entry.id}`, updateTextAction, formData, () => setEditingId(null));
                      }}
                      type="button"
                    >
                      {pendingKey === `text-${entry.id}` ? pendingLabel : "保存"}
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => setEditingId(null)}
                      type="button"
                    >
                      取消
                    </button>
                  </>
                ) : (
                  <>
                    {entry.status === "pending" && (
                      <button
                        className="button"
                        disabled={busy}
                        onClick={() => {
                          const formData = new FormData();
                          formData.set("entryId", String(entry.id));
                          run(`approve-${entry.id}`, approveAction, formData);
                        }}
                        type="button"
                      >
                        {pendingKey === `approve-${entry.id}` ? pendingLabel : "批准"}
                      </button>
                    )}
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        setEditingId(entry.id);
                        setEditingText(entry.question_text);
                      }}
                      type="button"
                    >
                      编辑原文
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("entryId", String(entry.id));
                        formData.set("answerType", entry.answer_type === "yes" ? "no" : "yes");
                        run(`answer-${entry.id}`, updateAnswerAction, formData);
                      }}
                      type="button"
                    >
                      {pendingKey === `answer-${entry.id}`
                        ? pendingLabel
                        : `改为「${answerLabel(entry.answer_type === "yes" ? "no" : "yes")}」`}
                    </button>
                    <button
                      className="button danger"
                      disabled={busy}
                      onClick={() => setDeletingId(entry.id)}
                      type="button"
                    >
                      删除
                    </button>
                  </>
                )}
              </div>
            </article>
          );
        })}
      </div>

      {deletingEntry && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="确认删除缓存条目">
          <div className="dialog-panel">
            <h2>删除这条缓存？</h2>
            <p>「{deletingEntry.question_text}」的缓存答案将被删除，下次相同提问会重新调用 AI。</p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                disabled={busy}
                onClick={() => setDeletingId(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("entryId", String(deletingEntry.id));
                  run("delete", deleteAction, formData, () => setDeletingId(null));
                }}
                type="button"
              >
                {pendingKey === "delete" ? "删除中…" : "确认删除"}
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
                disabled={busy}
                onClick={() => setClearing(false)}
                type="button"
              >
                取消
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("puzzleId", String(puzzleId));
                  run("clear", clearAction, formData, () => setClearing(false));
                }}
                type="button"
              >
                {pendingKey === "clear" ? "清空中…" : "确认清空"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
