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
import { usePendingAction } from "@/lib/use-pending-action";

export type AdminPuzzleListItem = AdminPuzzleFormValue & {
  facts?: unknown;
  content_version?: number;
};

type PuzzleFactRow = {
  id: string;
  text: string;
  kind: string | null;
  quote: string | null;
  dependsOn: string[];
  note: string | null;
  status: string | null;
};

type AdminPuzzleListProps = {
  deleteAction: (formData: FormData) => void | Promise<void>;
  puzzles: AdminPuzzleListItem[];
  updateAction: (formData: FormData) => void | Promise<void>;
  approveCacheAction: (formData: FormData) => void | Promise<void>;
  cacheByPuzzle: Record<number, PuzzleCacheEntry[]>;
  deleteCacheAction: (formData: FormData) => void | Promise<void>;
  updateCacheAnswerAction: (formData: FormData) => void | Promise<void>;
  updateCacheTextAction: (formData: FormData) => void | Promise<void>;
  clearPuzzleCacheAction: (formData: FormData) => void | Promise<void>;
};

const factStatusLabels: Record<string, string> = {
  approved: "已审核",
  draft: "草稿",
  needs_review: "待复核",
};

const factKindLabels: Record<string, string> = {
  explicit: "原文",
  derived: "推导",
};

// Facts 由服务端校验后写入，这里只做宽松读取用于展示
function readFacts(value: unknown): PuzzleFactRow[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => {
    if (typeof item !== "object" || item === null) return [];
    const fact = item as Record<string, unknown>;
    if (typeof fact.id !== "string" || typeof fact.text !== "string") return [];
    return [
      {
        id: fact.id,
        text: fact.text,
        kind: typeof fact.kind === "string" ? fact.kind : null,
        quote: typeof fact.quote === "string" ? fact.quote : null,
        dependsOn: Array.isArray(fact.depends_on)
          ? fact.depends_on.filter((dep): dep is string => typeof dep === "string")
          : [],
        note: typeof fact.note === "string" ? fact.note : null,
        status: typeof fact.status === "string" ? fact.status : null,
      },
    ];
  });
}

function FactsSummary({ facts }: { facts: PuzzleFactRow[] }) {
  if (facts.length === 0) return <span className="muted">—</span>;
  const pending = facts.filter((fact) => fact.status !== "approved").length;
  return (
    <>
      {facts.length}
      {pending > 0 && <span className="admin-pill admin-verdict-warn">{pending} 待审</span>}
    </>
  );
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
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const { pendingKey, run } = usePendingAction<"delete">(puzzles);
  const [cachePuzzleId, setCachePuzzleId] = useState<number | null>(null);
  const [factsPuzzleId, setFactsPuzzleId] = useState<number | null>(null);
  const editingPuzzle = useMemo(
    () => puzzles.find((puzzle) => puzzle.id === editingId),
    [editingId, puzzles],
  );
  const cachePuzzle = useMemo(
    () => puzzles.find((puzzle) => puzzle.id === cachePuzzleId),
    [cachePuzzleId, puzzles],
  );
  // 删除成功后题目从列表消失，确认框随之关闭
  const deletingPuzzle = useMemo(
    () => puzzles.find((puzzle) => puzzle.id === deletingId),
    [deletingId, puzzles],
  );
  const factsPuzzle = useMemo(
    () => puzzles.find((puzzle) => puzzle.id === factsPuzzleId),
    [factsPuzzleId, puzzles],
  );

  useEffect(() => {
    if (!editingPuzzle && !deletingPuzzle && !cachePuzzle && !factsPuzzle) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setEditingId(null);
      if (!pendingKey) setDeletingId(null);
      setCachePuzzleId(null);
      setFactsPuzzleId(null);
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [editingPuzzle, deletingPuzzle, cachePuzzle, factsPuzzle, pendingKey]);

  if (puzzles.length === 0) {
    return <div className="card muted">没有找到匹配的题目。</div>;
  }

  return (
    <>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>#</th>
              <th>标题</th>
              <th>汤面</th>
              <th>难度</th>
              <th>状态</th>
              <th className="admin-table-num">Facts</th>
              <th className="admin-table-num">内容版本</th>
              <th className="admin-table-num">缓存</th>
              <th className="admin-table-actions">操作</th>
            </tr>
          </thead>
          <tbody>
            {puzzles.map((puzzle) => {
              const facts = readFacts(puzzle.facts);
              const cacheEntries = puzzle.id ? (cacheByPuzzle[puzzle.id] ?? []) : [];
              const pendingCache = cacheEntries.filter((entry) => entry.status === "pending").length;
              return (
                <tr className={puzzle.is_active ? undefined : "admin-table-row-dim"} key={puzzle.id}>
                  <td className="muted">#{puzzle.id}</td>
                  <td>
                    <strong>{puzzle.title}</strong>
                  </td>
                  <td className="admin-table-clip admin-table-grow muted" title={puzzle.surface}>
                    {puzzle.surface || "暂无汤面"}
                  </td>
                  <td>{puzzle.difficulty ?? "未设难度"}</td>
                  <td>
                    {puzzle.is_active ? (
                      <span className="admin-pill admin-verdict-ok">可用</span>
                    ) : (
                      <span className="admin-pill">已移除</span>
                    )}
                  </td>
                  <td className="admin-table-num">
                    <FactsSummary facts={facts} />
                  </td>
                  <td className="admin-table-num">{puzzle.content_version ?? 1}</td>
                  <td className="admin-table-num">
                    {cacheEntries.length}
                    {pendingCache > 0 && (
                      <span className="admin-pill admin-verdict-warn">{pendingCache} 待批</span>
                    )}
                  </td>
                  <td className="admin-table-actions">
                    <button
                      className="button ghost small"
                      onClick={() => setEditingId(puzzle.id ?? null)}
                      type="button"
                    >
                      编辑
                    </button>
                    <button
                      className="button ghost small"
                      disabled={facts.length === 0}
                      onClick={() => setFactsPuzzleId(puzzle.id ?? null)}
                      type="button"
                    >
                      Facts
                    </button>
                    <button
                      className="button ghost small"
                      onClick={() => setCachePuzzleId(puzzle.id ?? null)}
                      type="button"
                    >
                      缓存
                    </button>
                    <button
                      className="button danger-text small"
                      onClick={() => setDeletingId(puzzle.id ?? null)}
                      type="button"
                    >
                      删除
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
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

      {factsPuzzle && (
        <div className="admin-panel-overlay" role="dialog" aria-modal="true">
          <div className="admin-panel-dialog">
            <div className="admin-panel-header">
              <div>
                <h2>Facts</h2>
                <p className="muted">
                  #{factsPuzzle.id} · {factsPuzzle.title} · 内容版本{" "}
                  {factsPuzzle.content_version ?? 1}
                </p>
              </div>
              <button
                aria-label="关闭 Facts 面板"
                className="admin-panel-close"
                onClick={() => setFactsPuzzleId(null)}
                type="button"
              >
                ×
              </button>
            </div>
            <p className="muted admin-facts-hint">
              AI 主持判定时引用的事实清单，只读。修改汤面或汤底后，未同时更新的 Facts 会变为「待复核」。
            </p>
            <div className="admin-table-wrap">
              <table className="admin-table admin-facts-table">
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>内容</th>
                    <th>类型</th>
                    <th>依据</th>
                    <th>状态</th>
                  </tr>
                </thead>
                <tbody>
                  {readFacts(factsPuzzle.facts).map((fact) => (
                    <tr key={fact.id}>
                      <td className="admin-table-code">{fact.id}</td>
                      <td className="admin-table-text">
                        {fact.text}
                        {fact.note && <p className="muted">{fact.note}</p>}
                      </td>
                      <td>{fact.kind ? (factKindLabels[fact.kind] ?? fact.kind) : "—"}</td>
                      <td className="admin-table-text muted">
                        {fact.quote && <>「{fact.quote}」</>}
                        {fact.dependsOn.length > 0 && <>依赖 {fact.dependsOn.join("、")}</>}
                        {!fact.quote && fact.dependsOn.length === 0 && "—"}
                      </td>
                      <td>
                        <span
                          className={`admin-pill${fact.status === "approved" ? " admin-verdict-ok" : " admin-verdict-warn"}`}
                        >
                          {fact.status ? (factStatusLabels[fact.status] ?? fact.status) : "未知"}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
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
              puzzleContentVersion={cachePuzzle.content_version ?? null}
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
                disabled={pendingKey !== null}
                onClick={() => setDeletingId(null)}
                type="button"
              >
                取消
              </button>
              <button
                className="button danger"
                disabled={pendingKey !== null}
                onClick={() => {
                  const formData = new FormData();
                  formData.set("returnTab", "puzzles");
                  formData.set("puzzleId", String(deletingPuzzle.id));
                  formData.set("confirmDelete", "on");
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
    </>
  );
}
