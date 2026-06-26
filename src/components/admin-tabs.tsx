"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type AdminTab = "accounts" | "puzzles" | "messages" | "rooms" | "points" | "emails";

type MessageSubTab = "audit" | "errors" | "backup";

type AdminTabsProps = {
  accountCount: number;
  accountContent: React.ReactNode;
  aiErrorCaseContent: React.ReactNode;
  aiErrorCaseCount: number;
  chatBackupContent: React.ReactNode;
  chatBackupCount: number;
  cleanupContent: React.ReactNode;
  cleanupCount: number;
  createPuzzleContent: React.ReactNode;
  initialTab?: AdminTab;
  initialMessageSubTab?: MessageSubTab;
  importPuzzleContent: React.ReactNode;
  messageContent: React.ReactNode;
  messageCount: number;
  puzzleContent: React.ReactNode;
  puzzleCount: number;
  roomsContent: React.ReactNode;
  roomsCount: number;
  pointsContent: React.ReactNode;
  pointsCount: number;
  emailContent: React.ReactNode;
};

const TAB_PARAMS: Record<AdminTab, string[]> = {
  accounts: ["q"],
  puzzles: ["q"],
  messages: [
    "roomCode",
    "sender",
    "senderType",
    "mode",
    "dateFrom",
    "dateTo",
    "caseStatus",
  ],
  rooms: [],
  points: ["ptUser", "ptType", "ptDateFrom", "ptDateTo"],
  emails: [],
};

function cleanUrlForTab(url: URL, tab: AdminTab) {
  const allowedParams = new Set(["tab", ...TAB_PARAMS[tab]]);

  for (const key of Array.from(url.searchParams.keys())) {
    if (!allowedParams.has(key) || !url.searchParams.get(key)?.trim()) {
      url.searchParams.delete(key);
    }
  }
}

export function AdminTabs({
  accountCount,
  accountContent,
  aiErrorCaseContent,
  aiErrorCaseCount,
  chatBackupContent,
  chatBackupCount,
  cleanupContent,
  cleanupCount,
  createPuzzleContent,
  initialTab = "accounts",
  initialMessageSubTab = "audit",
  importPuzzleContent,
  messageContent,
  messageCount,
  puzzleContent,
  puzzleCount,
  roomsContent,
  roomsCount,
  pointsContent,
  pointsCount,
  emailContent,
}: AdminTabsProps) {
  const router = useRouter();
  const [activeTab, setActiveTab] = useState<AdminTab>(initialTab);
  const [msgSubTab, setMsgSubTab] = useState<MessageSubTab>(initialMessageSubTab);
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
    cleanUrlForTab(url, tab);
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }

  function selectMsgSubTab(sub: MessageSubTab) {
    setMsgSubTab(sub);
    const url = new URL(window.location.href);
    url.searchParams.set(
      "tab",
      sub === "errors" ? "ai-errors" : sub === "backup" ? "chat-backup" : "messages",
    );
    cleanUrlForTab(url, "messages");
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
    if (activeTab !== "messages" && activeTab !== "rooms") return;

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
          消息 &amp; 案例
          <span>{messageCount + aiErrorCaseCount}</span>
        </button>
        <button
          aria-selected={activeTab === "rooms"}
          className={`admin-tab${activeTab === "rooms" ? " active" : ""}`}
          onClick={() => selectTab("rooms")}
          role="tab"
          type="button"
        >
          房间管理
          <span>{roomsCount + cleanupCount}</span>
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
        <button
          aria-selected={activeTab === "emails"}
          className={`admin-tab${activeTab === "emails" ? " active" : ""}`}
          onClick={() => selectTab("emails")}
          role="tab"
          type="button"
        >
          邮件发送
          <span>发送</span>
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
        <div className="admin-subtabs" role="tablist" aria-label="消息子分类">
          <button
            aria-selected={msgSubTab === "audit"}
            className={`admin-subtab${msgSubTab === "audit" ? " active" : ""}`}
            onClick={() => selectMsgSubTab("audit")}
            role="tab"
            type="button"
          >
            消息审计
            <span>{messageCount}</span>
          </button>
          <button
            aria-selected={msgSubTab === "errors"}
            className={`admin-subtab${msgSubTab === "errors" ? " active" : ""}`}
            onClick={() => selectMsgSubTab("errors")}
            role="tab"
            type="button"
          >
            AI 错误案例
            <span>{aiErrorCaseCount}</span>
          </button>
          <button
            aria-selected={msgSubTab === "backup"}
            className={`admin-subtab${msgSubTab === "backup" ? " active" : ""}`}
            onClick={() => selectMsgSubTab("backup")}
            role="tab"
            type="button"
          >
            聊天备份
            <span>{chatBackupCount}</span>
          </button>
        </div>
        <div hidden={msgSubTab !== "audit"}>{messageContent}</div>
        <div hidden={msgSubTab !== "errors"}>{aiErrorCaseContent}</div>
        <div hidden={msgSubTab !== "backup"}>{chatBackupContent}</div>
      </section>

      <section hidden={activeTab !== "rooms"} role="tabpanel">
        {roomsContent}
        <div className="admin-tab-divider">
          <span>待清理房间 · {cleanupCount} 个</span>
        </div>
        {cleanupContent}
      </section>

      <section hidden={activeTab !== "points"} role="tabpanel">
        {pointsContent}
      </section>

      <section hidden={activeTab !== "emails"} role="tabpanel">
        {emailContent}
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
