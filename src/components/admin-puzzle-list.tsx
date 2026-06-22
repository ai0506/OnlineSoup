"use client";

import { useEffect, useMemo, useState } from "react";

import {
  AdminPuzzleForm,
  type AdminPuzzleFormValue,
} from "@/components/admin-puzzle-form";
import {
  AdminPuzzleCachePanel,
  type PuzzleCacheEntry,
} from "@/components/admin-puzzle-cache-panel";

type AdminPuzzleListProps = {
  deleteAction: (formData: FormData) => void | Promise<void>;
  puzzles: AdminPuzzleFormValue[];
  updateAction: (formData: FormData) => void | Promise<void>;
  approveCacheAction: (formData: FormData) => void | Promise<void>;
  cacheByPuzzle: Record<number, PuzzleCacheEntry[]>;
  deleteCacheAction: (formData: FormData) => void | Promise<void>;
  updateCacheAnswerAction: (formData: FormData) => void | Promise<void>;
  updateCacheTextAction: (formData: FormData) => void | Promise<void>;
  clearPuzzleCacheAction: (formData: FormData) => void | Promise<void>;
};

function clampText(value: string | undefined, maxLength = 42) {
  if (!value) return "暂无汤面";
  return value.length > maxLength ? `${value.slice(0, maxLength)}...` : value;
}

export function AdminPuzzleList({
  deleteAction,
  puzzles,
  updateAction,
  approveCacheAction,
  cacheByPuzzle,
  deleteCacheAction,
  updateCacheAnswerAction,
  updateCacheTextAction,
  clearPuzzleCacheAction,
}: AdminPuzzleListProps) {
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingPuzzle, setDeletingPuzzle] = useState<AdminPuzzleFormValue | null>(
    null,
  );
  const [cachePuzzleId, setCachePuzzleId] = useState<number | null>(null);
  const editingPuzzle = useMemo(
    () => puzzles.find((puzzle) => puzzle.id === editingId),
    [editingId, puzzles],
  );
  const cachePuzzle = useMemo(
    () => puzzles.find((puzzle) => puzzle.id === cachePuzzleId),
    [cachePuzzleId, puzzles],
  );

  useEffect(() => {
    if (!editingPuzzle && !deletingPuzzle && !cachePuzzle) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setEditingId(null);
      setDeletingPuzzle(null);
      setCachePuzzleId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [editingPuzzle, deletingPuzzle, cachePuzzle]);

  if (puzzles.length === 0) {
    return <div className="card muted">没有找到匹配的题目。</div>;
  }

  return (
    <>
      <div className="admin-puzzle-summary-list">
        {puzzles.map((puzzle) => {
          return (
            <article
              className={`admin-puzzle-summary-card${puzzle.is_active ? "" : " inactive"}`}
              key={puzzle.id}
            >
              <div className="admin-puzzle-summary-main">
                <div className="admin-puzzle-summary-title">
                  <span className="admin-puzzle-id">#{puzzle.id}</span>
                  <strong>{puzzle.title}</strong>
                </div>
                <p>{clampText(puzzle.surface)}</p>
                <div className="admin-puzzle-tags">
                  <span>{puzzle.difficulty ?? "未设难度"}</span>
                  <span>{puzzle.is_active ? "可用" : "已移除"}</span>
                </div>
              </div>
              <div className="admin-puzzle-summary-actions">
                <button
                  className="button secondary"
                  onClick={() => setEditingId(puzzle.id ?? null)}
                  type="button"
                >
                  编辑
                </button>
                <button
                  className="button ghost"
                  onClick={() => setCachePuzzleId(puzzle.id ?? null)}
                  type="button"
                >
                  缓存
                  <span className="admin-puzzle-cache-count">
                    {puzzle.id ? (cacheByPuzzle[puzzle.id]?.length ?? 0) : 0}
                  </span>
                </button>
                <button
                  className="button danger"
                  onClick={() => setDeletingPuzzle(puzzle)}
                  type="button"
                >
                  删除
                </button>
              </div>
            </article>
          );
        })}
      </div>

      {editingPuzzle && (
        <div className="admin-panel-overlay" role="dialog" aria-modal="true">
          <div className="admin-panel-dialog">
            <div className="admin-panel-header">
              <div>
                <h2>编辑题目</h2>
                <p className="muted">
                  #{editingPuzzle.id} · {editingPuzzle.title}
                </p>
              </div>
              <button
                aria-label="关闭编辑题目面板"
                className="admin-panel-close"
                onClick={() => setEditingId(null)}
                type="button"
              >
                ×
              </button>
            </div>

            <AdminPuzzleForm
              action={updateAction}
              className="admin-puzzle-edit"
              mode="edit"
              puzzle={editingPuzzle}
              returnTab="puzzles"
            />
          </div>
        </div>
      )}

      {cachePuzzle && (
        <div className="admin-panel-overlay" role="dialog" aria-modal="true">
          <div className="admin-panel-dialog">
            <div className="admin-panel-header">
              <div>
                <h2>问答缓存</h2>
                <p className="muted">
                  #{cachePuzzle.id} · {cachePuzzle.title}
                </p>
              </div>
              <button
                aria-label="关闭问答缓存面板"
                className="admin-panel-close"
                onClick={() => setCachePuzzleId(null)}
                type="button"
              >
                ×
              </button>
            </div>

            <AdminPuzzleCachePanel
              clearAction={clearPuzzleCacheAction}
              approveAction={approveCacheAction}
              deleteAction={deleteCacheAction}
              entries={cachePuzzle.id ? (cacheByPuzzle[cachePuzzle.id] ?? []) : []}
              puzzleId={cachePuzzle.id ?? 0}
              updateAnswerAction={updateCacheAnswerAction}
              updateTextAction={updateCacheTextAction}
            />
          </div>
        </div>
      )}

      {deletingPuzzle && (
        <div className="dialog-backdrop" role="dialog" aria-modal="true" aria-label="确认删除题目">
          <div className="dialog-panel">
            <h2>确认删除题目？</h2>
            <p>
              #{deletingPuzzle.id} · {deletingPuzzle.title} 将被永久删除，无法恢复。
            </p>
            <div className="dialog-actions">
              <button
                className="button secondary"
                onClick={() => setDeletingPuzzle(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button danger"
                onClick={() => {
                  const formData = new FormData();
                  formData.set("returnTab", "puzzles");
                  formData.set("puzzleId", String(deletingPuzzle.id));
                  formData.set("confirmDelete", "on");
                  setDeletingPuzzle(null);
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
    </>
  );
}
