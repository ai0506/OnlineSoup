"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";

import {
  closePuzzle,
  getPuzzleList,
  getRoomCurrentPuzzle,
  openPuzzle,
} from "@/app/rooms/actions";
import type { RoomActionState } from "@/app/rooms/actions";
import { createClient } from "@/lib/supabase/client";
import type { CurrentPuzzle, PuzzleListItem } from "@/lib/types";

const DIFFICULTIES = ["简单", "中等", "困难", "抽象"] as const;

const DIFFICULTY_COLORS: Record<string, string> = {
  简单: "puzzle-diff-easy",
  中等: "puzzle-diff-medium",
  困难: "puzzle-diff-hard",
  抽象: "puzzle-diff-abstract",
};

const LONG_SURFACE_CHAR_LIMIT = 360;
const LONG_SURFACE_LINE_LIMIT = 8;
const LONG_FACTS_COUNT_LIMIT = 5;
const LONG_FACTS_CHAR_LIMIT = 180;

type PuzzlePanelProps = {
  isOwner: boolean;
  roomCode: string;
  roomId: string;
  initialPuzzle: CurrentPuzzle | null;
  puzzleList: PuzzleListItem[];
};

type DialogState =
  | "none"
  | "select"
  | "preview"
  | "stop-confirm"
  | "switch-confirm";

export function PuzzlePanel({
  isOwner,
  roomCode,
  roomId,
  initialPuzzle,
  puzzleList: initialPuzzleList,
}: PuzzlePanelProps) {
  const [currentPuzzle, setCurrentPuzzle] = useState<CurrentPuzzle | null>(initialPuzzle);
  const [puzzleList, setPuzzleList] = useState<PuzzleListItem[]>(initialPuzzleList);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [dialogState, setDialogState] = useState<DialogState>("none");
  const [filterDiff, setFilterDiff] = useState<string | null>(null);
  const [selectedPuzzle, setSelectedPuzzle] = useState<PuzzleListItem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [surfaceExpanded, setSurfaceExpanded] = useState(false);
  const [factsExpanded, setFactsExpanded] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dropdownRef = useRef<HTMLDivElement>(null);
  const menuTriggerRef = useRef<HTMLButtonElement>(null);
  const menuPopoverRef = useRef<HTMLDivElement>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const refreshSeqRef = useRef(0);

  const [knownFacts, setKnownFacts] = useState<{ text: string; source: "ask" | "hint" }[]>([]);
  const [factsPuzzleId, setFactsPuzzleId] = useState<number | null>(currentPuzzle?.id ?? null);

  const refreshCurrentPuzzle = useCallback(() => {
    const seq = ++refreshSeqRef.current;
    getRoomCurrentPuzzle(roomCode)
      .then((p) => {
        if (seq === refreshSeqRef.current) setCurrentPuzzle(p ?? null);
      })
      .catch(() => undefined);
  }, [roomCode]);

  // 题目切换时清空已展示的事实总结（在渲染期间同步，而非副作用里调用 setState）
  if (factsPuzzleId !== (currentPuzzle?.id ?? null)) {
    setFactsPuzzleId(currentPuzzle?.id ?? null);
    setKnownFacts([]);
    setSurfaceExpanded(false);
    setFactsExpanded(false);
  }

  // 同步通知聊天区：当前是否有进行中的题目、题目 ID，决定能否使用询问/提示/推理
  // 以及事实总结应按哪个题目筛选
  useEffect(() => {
    window.dispatchEvent(
      new CustomEvent("room-puzzle-changed", {
        detail: {
          hasPuzzle: Boolean(currentPuzzle),
          puzzleId: currentPuzzle?.id ?? null,
          title: currentPuzzle?.title ?? null,
          difficulty: currentPuzzle?.difficulty ?? null,
          surface: currentPuzzle?.surface ?? null,
        },
      }),
    );
  }, [currentPuzzle]);

  // 聊天区每次解析到新的事实总结都会广播，这里只负责展示。
  // 挂载或切换题目后主动请求一次，避免错过聊天区先挂载时发出的广播。
  useEffect(() => {
    const puzzleId = currentPuzzle?.id ?? null;

    const handleFactsChanged = (event: Event) => {
      const detail = (event as CustomEvent<{ puzzleId: number | null; facts: { text: string; source: "ask" | "hint" }[] }>).detail;
      if (detail.puzzleId !== puzzleId) return;
      setKnownFacts(detail.facts);
    };

    window.addEventListener("room-facts-changed", handleFactsChanged);
    if (puzzleId !== null) {
      window.dispatchEvent(
        new CustomEvent("room-facts-request", { detail: { puzzleId } }),
      );
    }
    return () => {
      window.removeEventListener("room-facts-changed", handleFactsChanged);
    };
  }, [currentPuzzle]);

  // Realtime: rooms 表 current_puzzle_id 变化
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`room-puzzle:${roomId}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (payload) => {
          const newRow = payload.new as { current_puzzle_id?: number | null };
          if (!("current_puzzle_id" in newRow)) return;
          if (newRow.current_puzzle_id === null) {
            ++refreshSeqRef.current;
            setCurrentPuzzle(null);
          } else {
            refreshCurrentPuzzle();
          }
        },
      )
      .subscribe();

    return () => void supabase.removeChannel(channel);
  }, [roomId, refreshCurrentPuzzle]);

  useEffect(() => {
    window.addEventListener("room-puzzle-refresh", refreshCurrentPuzzle);
    return () => {
      window.removeEventListener("room-puzzle-refresh", refreshCurrentPuzzle);
    };
  }, [refreshCurrentPuzzle]);

  // 点击下拉菜单外部时关闭（弹出层已通过 Portal 挂到 body，需一并排除）
  useEffect(() => {
    if (!dropdownOpen) return;
    const close = (e: PointerEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (menuPopoverRef.current?.contains(target)) return;
      setDropdownOpen(false);
    };
    const closeKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDropdownOpen(false);
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", closeKey);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", closeKey);
    };
  }, [dropdownOpen]);

  // 弹出层脱离父容器的 overflow:hidden/滚动裁剪，改用 Portal + 固定定位跟随触发按钮
  useEffect(() => {
    if (!dropdownOpen) return;
    const updatePosition = () => {
      const trigger = menuTriggerRef.current;
      if (!trigger) return;
      const rect = trigger.getBoundingClientRect();
      setMenuPos({
        top: rect.bottom + 4,
        right: window.innerWidth - rect.right,
      });
    };
    updatePosition();
    window.addEventListener("scroll", updatePosition, true);
    window.addEventListener("resize", updatePosition);
    return () => {
      window.removeEventListener("scroll", updatePosition, true);
      window.removeEventListener("resize", updatePosition);
    };
  }, [dropdownOpen]);

  const closeDialog = () => {
    setDialogState("none");
    setSelectedPuzzle(null);
    setError(null);
  };

  const openSelectDialog = () => {
    setError(null);
    setFilterDiff(null);
    setDialogState("select");
    getPuzzleList(roomCode).then((list) => {
      if (list) setPuzzleList(list);
    });
  };

  const handleSelectConfirm = () => {
    if (!selectedPuzzle || isPending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("code", roomCode);
      fd.set("puzzleId", String(selectedPuzzle.id));
      const result: RoomActionState = await openPuzzle({ status: "idle" }, fd);
      if (result.status === "error") {
        setError(result.message ?? "操作失败");
      } else {
        closeDialog();
      }
    });
  };

  const handleStopConfirm = () => {
    if (isPending) return;
    setError(null);
    startTransition(async () => {
      const fd = new FormData();
      fd.set("code", roomCode);
      const result: RoomActionState = await closePuzzle({ status: "idle" }, fd);
      if (result.status === "error") {
        setError(result.message ?? "操作失败");
      } else {
        closeDialog();
      }
    });
  };

  const filteredPuzzles = filterDiff
    ? puzzleList.filter((p) => p.difficulty === filterDiff)
    : puzzleList;

  const currentSurface = currentPuzzle?.surface ?? "";
  const currentSurfaceLineCount = currentSurface.split(/\r\n|\r|\n/).length;
  const isLongSurface =
    currentSurface.length > LONG_SURFACE_CHAR_LIMIT ||
    currentSurfaceLineCount > LONG_SURFACE_LINE_LIMIT;
  const factsCharCount = knownFacts.reduce((total, fact) => total + fact.text.length, 0);
  const isLongFacts =
    knownFacts.length > LONG_FACTS_COUNT_LIMIT || factsCharCount > LONG_FACTS_CHAR_LIMIT;

  const portalTarget = typeof document === "undefined" ? null : document.body;

  // 弹窗/菜单通过 Portal 挂到 body，避免被 <details> 的 overflow:hidden 干扰或裁剪
  const dialogs = portalTarget ? createPortal(
    <>
      {/* 题目菜单 */}
      {dropdownOpen && menuPos && (
        <div
          ref={menuPopoverRef}
          className="puzzle-menu-popover puzzle-menu-popover-fixed"
          style={{ top: menuPos.top, right: menuPos.right }}
        >
          {!currentPuzzle ? (
            <button
              className="puzzle-menu-item"
              type="button"
              onClick={() => { setDropdownOpen(false); openSelectDialog(); }}
            >
              选择题目
            </button>
          ) : (
            <>
              <button
                className="puzzle-menu-item"
                type="button"
                onClick={() => { setDropdownOpen(false); setDialogState("switch-confirm"); }}
              >
                切换题目
              </button>
              <button
                className="puzzle-menu-item puzzle-menu-item-danger"
                type="button"
                onClick={() => { setDropdownOpen(false); setDialogState("stop-confirm"); }}
              >
                停止题目
              </button>
            </>
          )}
        </div>
      )}

      {/* 确认切换 */}
      {dialogState === "switch-confirm" && currentPuzzle && (
        <div className="move-seat-overlay" role="dialog" aria-modal="true" aria-label="确认切换题目">
          <div className="move-seat-dialog puzzle-confirm-dialog">
            <div className="move-seat-header">
              <span>确认切换题目</span>
              <button className="move-seat-close" type="button" onClick={closeDialog}>✕</button>
            </div>
            <p className="puzzle-confirm-body">
              当前正在进行《<strong>{currentPuzzle.title}</strong>》，切换将中止当前题目并开始新题，确认继续？
            </p>
            {error && <div className="error puzzle-dialog-error">{error}</div>}
            <div className="puzzle-confirm-actions">
              <button className="button secondary" type="button" onClick={closeDialog}>取消</button>
              <button
                className="button"
                type="button"
                onClick={openSelectDialog}
              >
                确认，选择新题目
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 确认停止 */}
      {dialogState === "stop-confirm" && currentPuzzle && (
        <div className="move-seat-overlay" role="dialog" aria-modal="true" aria-label="确认停止题目">
          <div className="move-seat-dialog puzzle-confirm-dialog">
            <div className="move-seat-header">
              <span>确认停止题目</span>
              <button className="move-seat-close" type="button" onClick={closeDialog} disabled={isPending}>✕</button>
            </div>
            <p className="puzzle-confirm-body">
              确认停止《<strong>{currentPuzzle.title}</strong>》？停止后题目进度不会丢失。
            </p>
            {error && <div className="error puzzle-dialog-error">{error}</div>}
            <div className="puzzle-confirm-actions">
              <button className="button secondary" type="button" onClick={closeDialog} disabled={isPending}>取消</button>
              <button className="button danger" type="button" disabled={isPending} onClick={handleStopConfirm}>
                {isPending ? "正在停止..." : "确认停止"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 题库列表 */}
      {dialogState === "select" && (
        <div className="move-seat-overlay" role="dialog" aria-modal="true" aria-label="选择题目">
          <div className="move-seat-dialog puzzle-list-dialog">
            <div className="move-seat-header">
              <span>选择题目</span>
              <button className="move-seat-close" type="button" onClick={closeDialog}>✕</button>
            </div>

            <div className="puzzle-filter-tabs">
              <button
                className={`puzzle-filter-tab${filterDiff === null ? " active" : ""}`}
                type="button"
                onClick={() => setFilterDiff(null)}
              >
                全部
              </button>
              {DIFFICULTIES.map((d) => (
                <button
                  key={d}
                  className={`puzzle-filter-tab${filterDiff === d ? " active" : ""}`}
                  type="button"
                  onClick={() => setFilterDiff(d)}
                >
                  {d}
                </button>
              ))}
            </div>

            <div className="puzzle-list">
              {filteredPuzzles.length === 0 ? (
                <p className="muted puzzle-list-empty">该难度暂无题目</p>
              ) : (
                filteredPuzzles.map((puzzle) => (
                  <button
                    key={puzzle.id}
                    className={`puzzle-list-item${puzzle.id === currentPuzzle?.id ? " current" : ""}`}
                    type="button"
                    onClick={() => {
                      setSelectedPuzzle(puzzle);
                      setError(null);
                      setDialogState("preview");
                    }}
                  >
                    <span className="puzzle-list-item-left">
                      <span className={`puzzle-diff-badge ${DIFFICULTY_COLORS[puzzle.difficulty] ?? ""}`}>
                        {puzzle.difficulty}
                      </span>
                      <span className="puzzle-list-title">{puzzle.title}</span>
                    </span>
                    <span className="puzzle-list-item-right">
                      {puzzle.id === currentPuzzle?.id && (
                        <span className="puzzle-current-tag">当前</span>
                      )}
                      {puzzle.played && !puzzle.solved && (
                        <span className="puzzle-unsolved-badge small">○ 进行中</span>
                      )}
                      {puzzle.solved && (
                        <span className="puzzle-solved-badge small">✓ 已推理成功</span>
                      )}
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* 题目预览+确认 */}
      {dialogState === "preview" && selectedPuzzle && (
        <div className="move-seat-overlay" role="dialog" aria-modal="true" aria-label="确认开始题目">
          <div className="move-seat-dialog puzzle-preview-dialog">
            <div className="move-seat-header">
              <span>确认开始题目</span>
              <button
                className="move-seat-close"
                type="button"
                onClick={() => { setError(null); setDialogState("select"); }}
                disabled={isPending}
              >
                ✕
              </button>
            </div>

            <div className="puzzle-preview-meta">
              <span className={`puzzle-diff-badge ${DIFFICULTY_COLORS[selectedPuzzle.difficulty] ?? ""}`}>
                {selectedPuzzle.difficulty}
              </span>
              <strong className="puzzle-preview-title">{selectedPuzzle.title}</strong>
              {selectedPuzzle.solved && <span className="puzzle-solved-badge">✓ 已推理成功</span>}
              {selectedPuzzle.played && !selectedPuzzle.solved && (
                <span className="puzzle-unsolved-badge">○ 曾经进行过</span>
              )}
            </div>

            <div className="puzzle-preview-surface">
              <p>{selectedPuzzle.surface}</p>
            </div>

            {error && <div className="error puzzle-dialog-error">{error}</div>}

            <div className="puzzle-confirm-actions">
              <button
                className="button secondary"
                type="button"
                onClick={() => { setError(null); setDialogState("select"); }}
                disabled={isPending}
              >
                返回列表
              </button>
              <button className="button" type="button" disabled={isPending} onClick={handleSelectConfirm}>
                {isPending ? "正在开始..." : "开始这道题"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>,
    portalTarget,
  ) : null;

  return (
    <div className="room-puzzle-section">
      {dialogs}

      <div className="puzzle-section-header">
        <span className="puzzle-section-label">当前题目</span>
        {isOwner && (
          <div className="puzzle-owner-menu" ref={dropdownRef}>
            <button
              ref={menuTriggerRef}
              className="button small puzzle-menu-trigger"
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-expanded={dropdownOpen}
            >
              题目 ▾
            </button>
          </div>
        )}
      </div>

      {currentPuzzle ? (
        <div className="puzzle-current-card">
          <div className="puzzle-current-meta">
            <span className={`puzzle-diff-badge ${DIFFICULTY_COLORS[currentPuzzle.difficulty] ?? ""}`}>
              {currentPuzzle.difficulty}
            </span>
            <span className="puzzle-current-title">{currentPuzzle.title}</span>
            {currentPuzzle.solved ? (
              <span className="puzzle-solved-badge">✓ 已推理成功</span>
            ) : (
              <span className="puzzle-unsolved-badge">○ 进行中</span>
            )}
          </div>
          <div className="puzzle-surface-block">
            <p
              className={`puzzle-surface-text${isLongSurface ? " long" : ""}${surfaceExpanded ? " expanded" : ""}`}
            >
              {currentPuzzle.surface}
            </p>
            {isLongSurface && (
              <button
                className="puzzle-surface-toggle"
                type="button"
                onClick={() => setSurfaceExpanded((value) => !value)}
                aria-expanded={surfaceExpanded}
              >
                {surfaceExpanded ? "收起" : "展开阅读"}
              </button>
            )}
          </div>

          <div className="puzzle-facts-section">
            <div className="puzzle-facts-header">
              <span className="puzzle-facts-label">事实总结</span>
              {isLongFacts && (
                <button
                  className="puzzle-text-toggle"
                  type="button"
                  onClick={() => setFactsExpanded((value) => !value)}
                  aria-expanded={factsExpanded}
                >
                  {factsExpanded ? "收起事实总结" : "展开全部事实"}
                </button>
              )}
            </div>
            {knownFacts.length === 0 ? (
              <p className="puzzle-facts-empty muted">
                暂无已确认事实，向 AI 提问或请求提示后系统会自动归纳在这里。
              </p>
            ) : (
              <ul className={`puzzle-facts-list${isLongFacts ? " long" : ""}${factsExpanded ? " expanded" : ""}`}>
                {knownFacts.map((fact, index) => (
                  <li key={index}>
                    {fact.source === "hint" && (
                      <span className="puzzle-fact-source">提示</span>
                    )}
                    {fact.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      ) : (
        <p className="puzzle-empty-hint muted">
          {isOwner ? "点击「题目 ▾」开始本局题目" : "等待房主选择题目"}
        </p>
      )}
    </div>
  );
}
