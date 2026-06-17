import {
  clearRoomMessages,
  createPuzzle,
  deletePuzzle,
  importPuzzles,
  sendPasswordReset,
  updatePuzzle,
  updateUserPoints,
  updateUserUsername,
} from "@/app/admin/actions";
import {
  AdminPuzzleForm,
  type AdminPuzzleFormValue,
} from "@/components/admin-puzzle-form";
import { AdminPuzzleImport } from "@/components/admin-puzzle-import";
import { AdminPuzzleList } from "@/components/admin-puzzle-list";
import { AdminRoomCleanupList } from "@/components/admin-room-cleanup-list";
import { AdminTabs } from "@/components/admin-tabs";
import { SubmitButton } from "@/components/submit-button";
import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type AdminPageProps = {
  searchParams: Promise<{
    error?: string;
    message?: string;
    q?: string;
    roomCode?: string;
    mode?: string;
    sender?: string;
    senderType?: string;
    tab?: string;
  }>;
};

type AdminPuzzle = Required<Pick<AdminPuzzleFormValue, "id">> &
  AdminPuzzleFormValue & {
    difficulty: "简单" | "中等" | "困难" | "抽象";
    is_active: boolean;
    created_at: string;
  };

type AdminTab = "accounts" | "puzzles" | "messages" | "cleanup";

type AdminMessageRoom = {
  code: string;
  name: string;
  status: "waiting" | "playing" | "closed";
};

type AdminMessage = {
  id: number;
  room_id: string;
  seat_id: string;
  sender_name: string;
  sender_seat_number: number;
  sender_type: "registered" | "guest";
  message_type: "chat" | "system" | "ai";
  message_mode: "chat" | "ask" | "hint" | "reason";
  content: string;
  puzzle_id: number | null;
  created_at: string;
  rooms: AdminMessageRoom | null;
};

type AdminCleanupRoom = {
  room_id: string;
  room_code: string;
  room_name: string;
  room_status: "waiting" | "playing" | "closed";
  owner_id: string;
  created_at: string;
  updated_at: string;
  last_message_at: string | null;
  message_count: number;
  cleanup_reason: "closed_over_3_days" | "inactive_over_1_day";
};

type SupabaseResult<T> = PromiseLike<{
  data: T | null;
  error: { message: string } | null;
}>;

type ReasoningCoverage = {
  id: number;
  text?: string;
  covered: boolean;
};

type AskAuditEntry = {
  label: string;
  answerType: string;
  text: string;
  factSummary: string | null;
};

type AskAnswerDetails = {
  text: string;
  factSummary: string | null;
  auditEntries: AskAuditEntry[];
  usedArbitration: boolean;
};

const errors: Record<string, string> = {
  invalid_points: "积分必须是 0 到 10 亿之间的整数。",
  points_update_failed: "积分修改失败，请稍后重试。",
  invalid_user: "账户信息无效。",
  password_reset_failed: "重置邮件发送失败，请稍后重试。",
  invalid_username: "用户名需要 3 到 8 位，只能使用英文字母、数字和下划线。",
  username_taken: "这个用户名已经被使用。",
  username_active_room: "该用户仍在活动房间中，暂时不能修改用户名。",
  username_room_conflict: "该用户所在房间里已经有人使用这个名字。",
  username_update_failed: "用户名修改失败，请稍后重试。",
  invalid_puzzle: "题目信息不完整，请检查标题、题面、汤底、评分点、示例问题和难度。",
  invalid_puzzle_delete: "删除题目前请勾选确认。",
  invalid_puzzle_import: "文件内容格式不正确，或者没有勾选确认替换。",
  invalid_puzzle_import_json: "文件不是合法的 JSON，请检查后重试。",
  puzzle_title_taken: "这个题目标题已经存在。",
  puzzle_not_found: "没有找到这道题。",
  puzzle_update_failed: "题库操作失败，请稍后重试。",
  invalid_room_cleanup: "请先选择要清理的房间。",
  room_cleanup_failed: "房间清理失败，请稍后重试。",
};

const messages: Record<string, string> = {
  points_updated: "积分已更新。",
  password_reset_sent: "密码重置邮件已发送。",
  username_updated: "用户名已更新。",
  puzzle_created: "题目已新增。",
  puzzle_updated: "题目已保存。",
  puzzle_deleted: "题目已从可用题库移除。",
  puzzles_imported: "题库已清空并重新导入。",
  room_cleaned: "房间已关闭，聊天记录已删除。",
};

const timeFormatter = new Intl.DateTimeFormat("zh-CN", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hour12: false,
});

function getAdminTab(value?: string): AdminTab {
  if (value === "puzzles" || value === "messages" || value === "cleanup") {
    return value;
  }
  return "accounts";
}

function formatTime(value?: string | null) {
  return value ? timeFormatter.format(new Date(value)) : "无消息";
}

function getSenderTypeLabel(value: "registered" | "guest") {
  return value === "registered" ? "已注册" : "访客";
}

function getMessageTypeLabel(value: AdminMessage["message_type"]) {
  switch (value) {
    case "ai":
      return "AI返回";
    case "system":
      return "系统";
    default:
      return "聊天";
  }
}

function getModeLabel(value: AdminMessage["message_mode"]) {
  switch (value) {
    case "ask":
      return "询问";
    case "hint":
      return "提示";
    case "reason":
      return "推理";
    default:
      return "普通";
  }
}

function getModeFilter(value?: string) {
  return value === "chat" ||
    value === "ask" ||
    value === "hint" ||
    value === "reason"
    ? value
    : "";
}

function getReasoningCoverage(message: AdminMessage) {
  if (message.message_type !== "ai" || message.message_mode !== "reason") {
    return [];
  }

  try {
    const parsed = JSON.parse(message.content) as {
      kind?: unknown;
      coverage?: unknown;
    };
    if (parsed.kind !== "reasoning_result" || !Array.isArray(parsed.coverage)) {
      return [];
    }

    return parsed.coverage
      .map((item): ReasoningCoverage | null => {
        if (typeof item !== "object" || item === null) return null;
        const record = item as Record<string, unknown>;
        if (typeof record.covered !== "boolean") return null;
        const id =
          typeof record.id === "number"
            ? record.id
            : Number.parseInt(String(record.id ?? ""), 10);
        if (!Number.isFinite(id)) return null;

        return {
          id,
          covered: record.covered,
          text: typeof record.text === "string" ? record.text : undefined,
        };
      })
      .filter((item): item is ReasoningCoverage => item !== null);
  } catch {
    return [];
  }
}

function getAskAnswerDetails(message: AdminMessage): AskAnswerDetails | null {
  if (message.message_type !== "ai" || message.message_mode !== "ask") {
    return null;
  }

  try {
    const parsed = JSON.parse(message.content) as {
      kind?: unknown;
      text?: unknown;
      fact_summary?: unknown;
      ask_audit?: unknown;
    };
    if (parsed.kind !== "answer" || typeof parsed.text !== "string") {
      return null;
    }

    const factSummary =
      typeof parsed.fact_summary === "string" ? parsed.fact_summary : null;

    if (typeof parsed.ask_audit !== "object" || parsed.ask_audit === null) {
      return {
        text: parsed.text,
        factSummary,
        auditEntries: [],
        usedArbitration: false,
      };
    }

    const audit = parsed.ask_audit as Record<string, unknown>;
    const labels: Array<[string, string]> = [
      ["strict", "严格"],
      ["inferential", "推断"],
      ["final", "仲裁"],
    ];

    const auditEntries = labels
      .map(([key, label]): AskAuditEntry | null => {
        const value = audit[key];
        if (typeof value !== "object" || value === null) return null;
        const record = value as Record<string, unknown>;
        if (
          typeof record.answer_type !== "string" ||
          typeof record.text !== "string"
        ) {
          return null;
        }

        return {
          label,
          answerType: record.answer_type,
          text: record.text,
          factSummary:
            typeof record.fact_summary === "string"
              ? record.fact_summary
              : null,
        };
      })
      .filter((item): item is AskAuditEntry => item !== null);

    return {
      text: parsed.text,
      factSummary,
      auditEntries,
      usedArbitration: auditEntries.some((item) => item.label === "仲裁"),
    };
  } catch {
    return null;
  }
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  await requireAdmin();
  const params = await searchParams;
  const query = params.q?.trim().toLowerCase() ?? "";
  const activeTab = getAdminTab(params.tab);
  const roomCodeFilter = params.roomCode?.trim().toUpperCase() ?? "";
  const modeFilter = getModeFilter(params.mode);
  const senderFilter = params.sender?.trim() ?? "";
  const senderTypeFilter =
    params.senderType === "registered" || params.senderType === "guest"
      ? params.senderType
      : "";
  const admin = createAdminClient();

  let adminMessagesQuery = admin
    .from("room_messages")
    .select(
      "id, room_id, seat_id, sender_name, sender_seat_number, sender_type, message_type, message_mode, content, puzzle_id, created_at, rooms!inner(code, name, status)",
    );

  if (roomCodeFilter) {
    adminMessagesQuery =
      roomCodeFilter.length === 6
        ? adminMessagesQuery.eq("rooms.code", roomCodeFilter)
        : adminMessagesQuery.ilike("rooms.code", `${roomCodeFilter}%`);
  }

  if (senderFilter) {
    adminMessagesQuery = adminMessagesQuery.ilike(
      "sender_name",
      `%${senderFilter}%`,
    );
  }

  if (senderTypeFilter) {
    adminMessagesQuery = adminMessagesQuery.eq("sender_type", senderTypeFilter);
  }

  if (modeFilter) {
    adminMessagesQuery = adminMessagesQuery.eq("message_mode", modeFilter);
  }

  const adminMessagesPromise = adminMessagesQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200)
    .returns<AdminMessage[]>();
  const cleanupRoomsPromise = admin.rpc(
    "admin_list_room_cleanup_candidates",
  ) as unknown as SupabaseResult<AdminCleanupRoom[]>;

  const [
    { data: usersData, error: usersError },
    { data: puzzles, error: puzzlesError },
    { data: adminMessages, error: adminMessagesError },
    { data: cleanupRooms, error: cleanupRoomsError },
  ] = await Promise.all([
      admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      }),
      admin
        .from("puzzles")
        .select(
          "id, title, surface, bottom, difficulty, is_active, key_points, examples, created_at",
        )
        .order("id", { ascending: true })
        .returns<AdminPuzzle[]>(),
      adminMessagesPromise,
      cleanupRoomsPromise,
    ]);

  if (usersError) {
    throw new Error(`读取账户失败：${usersError.message}`);
  }

  if (puzzlesError) {
    throw new Error(`读取题库失败：${puzzlesError.message}`);
  }

  if (adminMessagesError) {
    throw new Error(`读取房间消息失败：${adminMessagesError.message}`);
  }

  if (cleanupRoomsError) {
    throw new Error(`读取待清理房间失败：${cleanupRoomsError.message}`);
  }

  const users = usersData.users;
  const userIds = users.map((user) => user.id);
  const { data: profiles, error: profilesError } = userIds.length
    ? await admin
        .from("profiles")
        .select("id, display_name, username, points, created_at")
        .in("id", userIds)
    : { data: [], error: null };

  if (profilesError) {
    throw new Error(`读取积分失败：${profilesError.message}`);
  }

  const profileById = new Map(
    profiles?.map((profile) => [profile.id, profile]) ?? [],
  );
  const visibleUsers = users.filter((user) => {
    if (!query) return true;
    const profile = profileById.get(user.id);
    return (
      user.email?.toLowerCase().includes(query) ||
      profile?.username?.toLowerCase().includes(query)
    );
  });
  const visiblePuzzles = (puzzles ?? []).filter((puzzle) => {
    if (!query) return true;
    return (
      puzzle.title?.toLowerCase().includes(query) ||
      puzzle.surface?.toLowerCase().includes(query) ||
      puzzle.bottom?.toLowerCase().includes(query)
    );
  });

  const createPuzzleContent = (
    <AdminPuzzleForm
      action={createPuzzle}
      className="admin-puzzle-create"
      key="create-puzzle-form"
      mode="create"
      returnTab="puzzles"
    />
  );

  const puzzleContent = (
    <AdminPuzzleList
      deleteAction={deletePuzzle}
      key="puzzle-list"
      puzzles={visiblePuzzles}
      updateAction={updatePuzzle}
    />
  );

  const importPuzzleContent = (
    <AdminPuzzleImport action={importPuzzles} key="import-puzzle-form" />
  );

  const accountContent = (
    <div className="admin-section" key="accounts-section">
      <div className="admin-section-heading">
        <h2>账户管理</h2>
        <p className="muted">修改用户名、积分，或发送密码重置邮件。</p>
      </div>

      <div className="admin-list">
        {visibleUsers.map((user) => {
          const profile = profileById.get(user.id);

          return (
            <article className="admin-user-card" key={user.id}>
              <div className="admin-user-summary">
                <div>
                  <strong>{user.email ?? "无邮箱账户"}</strong>
                  <span>{profile?.username ?? "未设置用户名"}</span>
                </div>
                <div className="points-badge">
                  {profile?.points ?? 0} 积分
                </div>
              </div>

              <div className="admin-user-actions">
                <form
                  action={updateUserUsername}
                  className="inline-admin-form"
                >
                  <input name="userId" type="hidden" value={user.id} />
                  <label>
                    用户名
                    <input
                      defaultValue={profile?.username ?? ""}
                      maxLength={8}
                      minLength={3}
                      name="username"
                      pattern="[A-Za-z0-9_]{3,8}"
                      required
                    />
                  </label>
                  <SubmitButton pendingText="保存中...">
                    保存用户名
                  </SubmitButton>
                </form>

                <form action={updateUserPoints} className="inline-admin-form">
                  <input name="userId" type="hidden" value={user.id} />
                  <label>
                    新积分
                    <input
                      defaultValue={profile?.points ?? 0}
                      max={1_000_000_000}
                      min={0}
                      name="points"
                      required
                      type="number"
                    />
                  </label>
                  <SubmitButton pendingText="保存中...">保存积分</SubmitButton>
                </form>

                <form action={sendPasswordReset} className="password-reset-form">
                  <input name="userId" type="hidden" value={user.id} />
                  <SubmitButton
                    className="button secondary"
                    pendingText="发送中..."
                  >
                    重置密码
                  </SubmitButton>
                </form>
              </div>
            </article>
          );
        })}

        {visibleUsers.length === 0 && (
          <div className="card muted">没有找到匹配的账户。</div>
        )}
      </div>
    </div>
  );

  const messageContent = (
    <div className="admin-section" key="messages-section">
      <div className="admin-section-heading">
        <h2>消息审计</h2>
        <p className="muted">
          查看各房间最近 200 条消息，AI 询问回复会拆出最终答案、严格/推断/仲裁结果和事实总结。
        </p>
      </div>

      <form className="admin-message-filters">
        <input name="tab" type="hidden" value="messages" />
        <label>
          房间号
          <input
            defaultValue={roomCodeFilter}
            maxLength={6}
            name="roomCode"
            pattern="[A-Za-z0-9]{0,6}"
            placeholder="ABC123"
          />
        </label>
        <label>
          发送者
          <input
            defaultValue={senderFilter}
            maxLength={20}
            name="sender"
            placeholder="昵称"
          />
        </label>
        <label>
          模式
          <select defaultValue={modeFilter} name="mode">
            <option value="">全部</option>
            <option value="ask">仅询问</option>
            <option value="hint">仅提示</option>
            <option value="reason">仅推理</option>
            <option value="chat">仅普通聊天</option>
          </select>
        </label>
        <label>
          身份
          <select defaultValue={senderTypeFilter} name="senderType">
            <option value="">全部</option>
            <option value="registered">仅注册用户</option>
            <option value="guest">仅访客</option>
          </select>
        </label>
        <div className="admin-filter-actions">
          <button className="button secondary" type="submit">
            筛选
          </button>
          <a className="button ghost" href="/admin?tab=messages">
            清空
          </a>
        </div>
      </form>

      <div className="admin-message-list">
        {(adminMessages ?? []).map((message) => {
          const reasoningCoverage = getReasoningCoverage(message);
          const askAnswerDetails = getAskAnswerDetails(message);

          return (
            <article className="admin-message-row" key={message.id}>
              <div className="admin-message-meta">
                <strong>{message.rooms?.code ?? "未知房间"}</strong>
                <span>{message.rooms?.name ?? "房间信息缺失"}</span>
                <span>{formatTime(message.created_at)}</span>
              </div>
              <div className="admin-message-badges">
                <span>{getMessageTypeLabel(message.message_type)}</span>
                <span>{getModeLabel(message.message_mode)}</span>
                <span>
                  {message.sender_name} [{message.sender_seat_number}] [
                  {getSenderTypeLabel(message.sender_type)}]
                </span>
                {message.puzzle_id && <span>题目 #{message.puzzle_id}</span>}
              </div>
              {reasoningCoverage.length > 0 && (
                <div className="admin-reasoning-coverage">
                  {reasoningCoverage.map((item) => (
                    <div
                      className={`admin-coverage-item${item.covered ? " covered" : ""}`}
                      key={item.id}
                    >
                      <strong>#{item.id}</strong>
                      <span>{String(item.covered)}</span>
                      {item.text && <p>{item.text}</p>}
                    </div>
                  ))}
                </div>
              )}
              {askAnswerDetails && (
                <div className="admin-ask-answer">
                  <div className="admin-ask-answer-summary">
                    <div>
                      <span>最终回答</span>
                      <strong>{askAnswerDetails.text}</strong>
                    </div>
                    <span>
                      {askAnswerDetails.usedArbitration
                        ? "已触发仲裁"
                        : "两路一致"}
                    </span>
                  </div>
                  {askAnswerDetails.factSummary && (
                    <p className="admin-ask-fact">
                      事实总结：{askAnswerDetails.factSummary}
                    </p>
                  )}
                  {askAnswerDetails.auditEntries.length > 0 && (
                    <div className="admin-ask-audit">
                      {askAnswerDetails.auditEntries.map((item) => (
                        <div className="admin-ask-audit-item" key={item.label}>
                          <strong>{item.label}</strong>
                          <span>
                            {item.text} / {item.answerType}
                          </span>
                          {item.factSummary && <p>{item.factSummary}</p>}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              <pre className="admin-message-content">{message.content}</pre>
            </article>
          );
        })}

        {(adminMessages ?? []).length === 0 && (
          <div className="card muted">没有找到匹配的消息。</div>
        )}
      </div>
    </div>
  );

  const cleanupContent = (
    <div className="admin-section" key="cleanup-section">
      <div className="admin-section-heading">
        <h2>房间清理</h2>
        <p className="muted">
          显示已关闭超过 3 天，或超过 1 天没有新消息的房间。
        </p>
      </div>

      <AdminRoomCleanupList
        action={clearRoomMessages}
        key={(cleanupRooms ?? []).map((room) => room.room_id).join(":")}
        rooms={cleanupRooms ?? []}
      />
    </div>
  );

  return (
    <section className="admin-page">
      <div className="admin-heading">
        <div>
          <p className="eyebrow">管理端</p>
          <h1>后台管理</h1>
          <p className="lead">
            共 {users.length} 个账户，{puzzles?.length ?? 0} 道题目，
            {(adminMessages ?? []).length} 条消息，{cleanupRooms?.length ?? 0} 个待清理房间。
          </p>
        </div>
        {(activeTab === "accounts" || activeTab === "puzzles") && (
          <form className="admin-search">
            {activeTab === "puzzles" && (
              <input name="tab" type="hidden" value="puzzles" />
            )}
            <input
              defaultValue={params.q}
              name="q"
              placeholder="搜索邮箱、用户名或题目"
              type="search"
            />
            <button className="button secondary" type="submit">
              搜索
            </button>
          </form>
        )}
      </div>

      {params.error && (
        <div className="error">
          {errors[params.error] ?? "操作失败，请稍后重试。"}
        </div>
      )}
      {params.message && (
        <div className="notice">{messages[params.message] ?? "操作成功。"}</div>
      )}

      <AdminTabs
        accountCount={visibleUsers.length}
        accountContent={accountContent}
        createPuzzleContent={createPuzzleContent}
        cleanupContent={cleanupContent}
        cleanupCount={cleanupRooms?.length ?? 0}
        initialTab={activeTab}
        importPuzzleContent={importPuzzleContent}
        messageContent={messageContent}
        messageCount={adminMessages?.length ?? 0}
        puzzleContent={puzzleContent}
        puzzleCount={visiblePuzzles.length}
      />
    </section>
  );
}
