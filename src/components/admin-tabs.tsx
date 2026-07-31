"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

type AdminTab =
  | "accounts"
  | "puzzles"
  | "messages"
  | "rooms"
  | "points"
  | "feedback"
  | "emails";

type MessageSubTab = "audit" | "errors" | "backup";

// 未加载的 tab 传 null：不显示数字，避免把「未加载」误显示成「0 条」
type TabCount = number | null;

type AdminTabsProps = {
  accountCount: TabCount;
  accountContent: React.ReactNode;
  aiErrorCaseContent: React.ReactNode;
  aiErrorCaseCount: TabCount;
  chatBackupContent: React.ReactNode;
  chatBackupCount: TabCount;
  cleanupContent: React.ReactNode;
  cleanupCount: TabCount;
  createPuzzleContent: React.ReactNode;
  initialTab?: AdminTab;
  initialMessageSubTab?: MessageSubTab;
  importPuzzleContent: React.ReactNode;
  messageContent: React.ReactNode;
  messageCount: TabCount;
  puzzleContent: React.ReactNode;
  puzzleCount: TabCount;
  roomsContent: React.ReactNode;
  roomsCount: TabCount;
  pointsContent: React.ReactNode;
  pointsCount: TabCount;
  feedbackContent: React.ReactNode;
  feedbackOpenCount: TabCount;
  emailContent: React.ReactNode;
};

function TabBadge({ counts }: { counts: TabCount[] }) {
  const known = counts.filter((count): count is number => count !== null);
  if (known.length !== counts.length) return null;
  return <span>{known.reduce((sum, count) => sum + count, 0)}</span>;
}

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
  feedback: ["fbStatus", "fbCategory"],
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
  feedbackContent,
  feedbackOpenCount,
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
    // messages 和 rooms 有专用的 useEffect 轮询处理刷新，其他 tab 需手动触发服务端重取
    if (tab !== "messages" && tab !== "rooms") {
      router.refresh();
    }
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
      if (document.visibilityState !== "visible") return;

      const active = document.activeElement;
      const isEditing =
        active instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(active.tagName);
      const hasOpenDialog = document.querySelector('[aria-modal="true"]') !== null;
      if (isEditing || hasOpenDialog) return;

      router.refresh();
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
          <TabBadge counts={[accountCount]} />
        </button>
        <button
          aria-selected={activeTab === "puzzles"}
          className={`admin-tab${activeTab === "puzzles" ? " active" : ""}`}
          onClick={() => selectTab("puzzles")}
          role="tab"
          type="button"
        >
          题库管理
          <TabBadge counts={[puzzleCount]} />
        </button>
        <button
          aria-selected={activeTab === "messages"}
          className={`admin-tab${activeTab === "messages" ? " active" : ""}`}
          onClick={() => selectTab("messages")}
          role="tab"
          type="button"
        >
          消息 &amp; 案例
          <TabBadge counts={[messageCount, aiErrorCaseCount]} />
        </button>
        <button
          aria-selected={activeTab === "rooms"}
          className={`admin-tab${activeTab === "rooms" ? " active" : ""}`}
          onClick={() => selectTab("rooms")}
          role="tab"
          type="button"
        >
          房间管理
          <TabBadge counts={[roomsCount, cleanupCount]} />
        </button>
        <button
          aria-selected={activeTab === "points"}
          className={`admin-tab${activeTab === "points" ? " active" : ""}`}
          onClick={() => selectTab("points")}
          role="tab"
          type="button"
        >
          积分流水
          <TabBadge counts={[pointsCount]} />
        </button>
        <button
          aria-selected={activeTab === "feedback"}
          className={`admin-tab${activeTab === "feedback" ? " active" : ""}`}
          onClick={() => selectTab("feedback")}
          role="tab"
          type="button"
        >
          用户反馈
          <TabBadge counts={[feedbackOpenCount]} />
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
            <TabBadge counts={[messageCount]} />
          </button>
          <button
            aria-selected={msgSubTab === "errors"}
            className={`admin-subtab${msgSubTab === "errors" ? " active" : ""}`}
            onClick={() => selectMsgSubTab("errors")}
            role="tab"
            type="button"
          >
            AI 错误案例
            <TabBadge counts={[aiErrorCaseCount]} />
          </button>
          <button
            aria-selected={msgSubTab === "backup"}
            className={`admin-subtab${msgSubTab === "backup" ? " active" : ""}`}
            onClick={() => selectMsgSubTab("backup")}
            role="tab"
            type="button"
          >
            聊天备份
            <TabBadge counts={[chatBackupCount]} />
          </button>
        </div>
        <div hidden={msgSubTab !== "audit"}>{messageContent}</div>
        <div hidden={msgSubTab !== "errors"}>{aiErrorCaseContent}</div>
        <div hidden={msgSubTab !== "backup"}>{chatBackupContent}</div>
      </section>

      <section hidden={activeTab !== "rooms"} role="tabpanel">
        {roomsContent}
        <div className="admin-tab-divider">
          <span>待清理房间 · {cleanupCount ?? 0} 个</span>
        </div>
        {cleanupContent}
      </section>

      <section hidden={activeTab !== "points"} role="tabpanel">
        {pointsContent}
      </section>

      <section hidden={activeTab !== "feedback"} role="tabpanel">
        {feedbackContent}
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
