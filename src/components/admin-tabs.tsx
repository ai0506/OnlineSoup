"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type AdminTab = "accounts" | "puzzles" | "messages" | "cleanup" | "ai-errors" | "rooms" | "points";

type AdminTabsProps = {
  accountCount: number;
  accountContent: React.ReactNode;
  aiErrorCaseContent: React.ReactNode;
  aiErrorCaseCount: number;
  cleanupContent: React.ReactNode;
  cleanupCount: number;
  createPuzzleContent: React.ReactNode;
  initialTab?: AdminTab;
  importPuzzleContent: React.ReactNode;
  messageContent: React.ReactNode;
  messageCount: number;
  puzzleContent: React.ReactNode;
  puzzleCount: number;
  roomsContent: React.ReactNode;
  roomsCount: number;
  pointsContent: React.ReactNode;
  pointsCount: number;
};

export function AdminTabs({
  accountCount,
  accountContent,
  aiErrorCaseContent,
  aiErrorCaseCount,
  cleanupContent,
  cleanupCount,
  createPuzzleContent,
  initialTab = "accounts",
  importPuzzleContent,
  messageContent,
  messageCount,
  puzzleContent,
  puzzleCount,
  roomsContent,
  roomsCount,
  pointsContent,
  pointsCount,
}: AdminTabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [createOpen, setCreateOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);

  function selectTab(tab: AdminTab) {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    if (tab === "accounts") {
      url.searchParams.delete("tab");
    } else {
      url.searchParams.set("tab", tab);
    }
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  useEffect(() => {
    if (!createOpen && !importOpen) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setCreateOpen(false);
        setImportOpen(false);
      }
    };
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [createOpen, importOpen]);

  useEffect(() => {
    if (
      activeTab !== "messages" &&
      activeTab !== "ai-errors" &&
      activeTab !== "rooms"
    )
      return;

    const refreshMessages = () => {
      if (document.visibilityState === "visible") {
        router.refresh();
      }
    };
    refreshMessages();
    const intervalId = window.setInterval(refreshMessages, 5000);

    return () => window.clearInterval(intervalId);
  }, [activeTab, router]);

  return (
    <div className="admin-tabs-shell">
      <div className="admin-tabs" role="tablist" aria-label="后台管理分类">
        <button
          aria-selected={activeTab === "accounts"}
          className={`admin-tab${activeTab === "accounts" ? " active" : ""}`}
          onClick={() => selectTab("accounts")}
          role="tab"
          type="button"
        >
          账户管理
          <span>{accountCount}</span>
        </button>
        <button
          aria-selected={activeTab === "puzzles"}
          className={`admin-tab${activeTab === "puzzles" ? " active" : ""}`}
          onClick={() => selectTab("puzzles")}
          role="tab"
          type="button"
        >
          题库管理
          <span>{puzzleCount}</span>
        </button>
        <button
          aria-selected={activeTab === "messages"}
          className={`admin-tab${activeTab === "messages" ? " active" : ""}`}
          onClick={() => selectTab("messages")}
          role="tab"
          type="button"
        >
          消息审计
          <span>{messageCount}</span>
        </button>
        <button
          aria-selected={activeTab === "cleanup"}
          className={`admin-tab${activeTab === "cleanup" ? " active" : ""}`}
          onClick={() => selectTab("cleanup")}
          role="tab"
          type="button"
        >
          房间清理
          <span>{cleanupCount}</span>
        </button>
        <button
          aria-selected={activeTab === "ai-errors"}
          className={`admin-tab${activeTab === "ai-errors" ? " active" : ""}`}
          onClick={() => selectTab("ai-errors")}
          role="tab"
          type="button"
        >
          AI 错误案例
          <span>{aiErrorCaseCount}</span>
        </button>
        <button
          aria-selected={activeTab === "rooms"}
          className={`admin-tab${activeTab === "rooms" ? " active" : ""}`}
          onClick={() => selectTab("rooms")}
          role="tab"
          type="button"
        >
          房间总览
          <span>{roomsCount}</span>
        </button>
        <button
          aria-selected={activeTab === "points"}
          className={`admin-tab${activeTab === "points" ? " active" : ""}`}
          onClick={() => selectTab("points")}
          role="tab"
          type="button"
        >
          积分流水
          <span>{pointsCount}</span>
        </button>
      </div>

      <section hidden={activeTab !== "accounts"} role="tabpanel">
        {accountContent}
      </section>

      <section hidden={activeTab !== "puzzles"} role="tabpanel">
        <div className="admin-section-heading with-action">
          <div>
            <h2>题库管理</h2>
            <p className="muted">新增、修改或移除房主可选择的海龟汤题目。</p>
          </div>
          <div className="admin-section-actions">
            <a className="button secondary" href="/admin/puzzles/export">
              下载题库 JSON
            </a>
            <button
              className="button secondary"
              onClick={() => setImportOpen(true)}
              type="button"
            >
              导入题库 JSON
            </button>
            <button
              className="button"
              onClick={() => setCreateOpen(true)}
              type="button"
            >
              新增题目
            </button>
          </div>
        </div>
        {puzzleContent}
      </section>

      <section hidden={activeTab !== "messages"} role="tabpanel">
        {messageContent}
      </section>

      <section hidden={activeTab !== "cleanup"} role="tabpanel">
        {cleanupContent}
      </section>

      <section hidden={activeTab !== "ai-errors"} role="tabpanel">
        {aiErrorCaseContent}
      </section>

      <section hidden={activeTab !== "rooms"} role="tabpanel">
        {roomsContent}
      </section>

      <section hidden={activeTab !== "points"} role="tabpanel">
        {pointsContent}
      </section>

      {importOpen && (
        <div className="admin-panel-overlay" role="dialog" aria-modal="true">
          <div className="admin-panel-dialog">
            <div className="admin-panel-header">
              <div>
                <h2>导入题库 JSON</h2>
                <p className="muted">会整体替换当前题库，请先确认文件内容。</p>
              </div>
              <button
                aria-label="关闭导入题库面板"
                className="admin-panel-close"
                onClick={() => setImportOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            {importPuzzleContent}
          </div>
        </div>
      )}

      {createOpen && (
        <div className="admin-panel-overlay" role="dialog" aria-modal="true">
          <div className="admin-panel-dialog">
            <div className="admin-panel-header">
              <div>
                <h2>新增题目</h2>
                <p className="muted">保存后会加入房主可选择的题库。</p>
              </div>
              <button
                aria-label="关闭新增题目面板"
                className="admin-panel-close"
                onClick={() => setCreateOpen(false)}
                type="button"
              >
                ×
              </button>
            </div>
            {createPuzzleContent}
          </div>
        </div>
      )}
    </div>
  );
}
