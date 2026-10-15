import {
  approveCacheEntry,
  clearRoomMessages,
  clearPuzzleCache,
  createAiErrorCase,
  createAdminUser,
  createPuzzle,
  deleteAdminUser,
  deleteCacheEntry,
  deletePuzzle,
  updateCacheAnswer,
  updateCacheText,
  forceCloseRoom,
  importPuzzles,
  sendPasswordReset,
  sendEmailFromAdmin,
  updateAiErrorCase,
  batchUpdateAiErrorCaseStatus,
  updatePuzzle,
  updateUserPassword,
  updateFeedbackStatus,
  adjustUserPoints,
  updateUserUsername,
} from "@/app/admin/actions";
import {
  AdminUserSection,
  type AdminUserEntry,
} from "@/components/admin-user-section";
import {
  AdminPuzzleForm,
  type AdminPuzzleFormValue,
} from "@/components/admin-puzzle-form";
import { AdminPuzzleImport } from "@/components/admin-puzzle-import";
import { AdminPuzzleList } from "@/components/admin-puzzle-list";
import type { PuzzleCacheEntry } from "@/components/admin-puzzle-cache-panel";
import { AdminRoomCleanupList } from "@/components/admin-room-cleanup-list";
import {
  AdminRoomOverviewList,
  type AdminActiveRoom,
} from "@/components/admin-room-overview-list";
import {
  AdminMessageAuditList,
  type AdminMessage,
  type AdminMessageRoom,
  type AdminPuzzleFactRef,
  type AdminQuestionMessage,
} from "@/components/admin-message-audit-list";
import { AdminTabs } from "@/components/admin-tabs";
import { AdminAiErrorCaseList } from "@/components/admin-ai-error-case-list";
import {
  AdminChatBackupList,
  type ChatBackupDay,
} from "@/components/admin-chat-backup-list";
import {
  AdminFeedbackList,
  type AdminFeedbackEntry,
} from "@/components/admin-feedback-list";
import { AdminFilterForm } from "@/components/admin-filter-form";
import { AdminEmailForm } from "@/components/admin-email-form";
import { FlashCookieCleaner } from "@/components/flash-cookie-cleaner";
import { requireAdmin } from "@/lib/admin";
import { formatAdminTime } from "@/lib/admin-time";
import { getFlashMessage } from "@/lib/flash";
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
    caseStatus?: string;
    tab?: string;
    dateFrom?: string;
    dateTo?: string;
    ptUser?: string;
    ptType?: string;
    ptDateFrom?: string;
    ptDateTo?: string;
    fbStatus?: string;
    fbCategory?: string;
    sort?: string;
  }>;
};

type AdminPuzzle = Required<Pick<AdminPuzzleFormValue, "id">> &
  AdminPuzzleFormValue & {
    difficulty: "简单" | "中等" | "困难" | "抽象";
    is_active: boolean;
    created_at: string;
    facts: unknown;
    content_version: number;
  };

type AdminTab =
  | "accounts"
  | "puzzles"
  | "messages"
  | "rooms"
  | "points"
  | "feedback"
  | "emails";
type AiErrorStatus = "open" | "reviewed" | "fixed" | "ignored";

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
  cleanup_reason: "closed_over_3_days" | "abandoned_over_7_days";
  backup_pending: boolean;
};

type AdminActiveRoomRaw = {
  id: string;
  code: string;
  name: string;
  status: "waiting" | "playing";
  max_members: number;
  points_per_seat: number;
  created_at: string;
  owner_id: string;
  current_puzzle_id: number | null;
};

type PointsTransactionType =
  | "signup_bonus"
  | "room_reservation"
  | "room_refund"
  | "gift_sent"
  | "seat_query"
  | "admin_adjustment";

type AdminPointsTransaction = {
  id: number;
  user_id: string;
  room_id: string | null;
  type: PointsTransactionType;
  amount: number;
  balance_after: number;
  note: string | null;
  login_ip: string | null;
  login_device: string | null;
  login_location: string | null;
  created_at: string;
};

type AdminAiErrorCase = {
  id: string;
  room_id: string | null;
  puzzle_id: number | null;
  question_message_id: number | null;
  ai_message_id: number | null;
  question_content: string;
  ai_content: string;
  correct_answer: string;
  note: string;
  status: AiErrorStatus;
  puzzle_title: string;
  puzzle_surface: string;
  puzzle_bottom: string;
  created_at: string;
  updated_at: string;
  rooms: AdminMessageRoom | null;
};

type SupabaseResult<T> = PromiseLike<{
  data: T | null;
  error: { message: string } | null;
}>;

const errors: Record<string, string> = {
  invalid_points: "调整数量必须是非零整数。",
  points_insufficient: "积分不足，无法扣除。",
  points_update_failed: "积分调整失败，请稍后重试。",
  invalid_user: "账户信息无效。",
  password_reset_failed: "重置邮件发送失败，请稍后重试。",
  password_reset_rate_limited:
    "重置邮件发送太频繁，已触发 Supabase 内置邮件额度限制。请稍后再试，或在 Supabase 配置自定义 SMTP。",
  invalid_username: "用户名需要 3 到 8 位，只能使用英文字母、数字和下划线。",
  username_taken: "这个用户名已经被使用。",
  username_active_room: "该用户仍在活动房间中，暂时不能修改用户名。",
  username_room_conflict: "该用户所在房间里已经有人使用这个名字。",
  username_update_failed: "用户名修改失败，请稍后重试。",
  invalid_create_user: "用户信息不合法，请检查用户名（3–8位英数字下划线）、密码（至少6位）和积分。",
  create_user_failed: "创建账户失败，请稍后重试。",
  invalid_password: "密码需要 6 到 72 位。",
  password_update_failed: "密码修改失败，请稍后重试。",
  delete_user_failed: "删除账户失败，请稍后重试。",
  invalid_puzzle: "题目信息不完整，请检查标题、题面、汤底、评分点、示例问题和难度。",
  invalid_puzzle_delete: "删除题目前请勾选确认。",
  invalid_puzzle_import: "文件内容格式不正确，或者没有勾选确认替换。",
  invalid_puzzle_import_json: "文件不是合法的 JSON，请检查后重试。",
  puzzle_title_taken: "这个题目标题已经存在。",
  puzzle_not_found: "没有找到这道题。",
  puzzle_update_failed: "题库操作失败，请稍后重试。",
  invalid_room_cleanup: "请先选择要清理的房间。",
  room_cleanup_failed: "房间清理失败，请稍后重试。",
  invalid_ai_error_case: "AI 错误案例信息不完整，请检查正确答案和备注。",
  invalid_ai_error_case_source: "只能从 AI 询问回复创建错误案例。",
  ai_error_case_exists: "这条 AI 回复已经收录过错误案例。",
  ai_error_question_not_found: "没有找到这条 AI 回复对应的玩家提问。",
  ai_error_puzzle_not_found: "没有找到这条 AI 回复对应的故事。",
  ai_error_case_failed: "AI 错误案例保存失败，请稍后重试。",
  invalid_cache_entry: "缓存条目信息无效。",
  cache_update_failed: "缓存操作失败，请稍后重试。",
  invalid_email: "邮件信息不完整，请检查收件邮箱、标题和正文。",
  email_not_configured: "邮件服务还没有配置，请先设置 RESEND_API_KEY 和 ADMIN_EMAIL_FROM。",
  email_send_failed: "邮件发送失败，请检查发件域名、收件人或 Resend 配置。",
  invalid_feedback: "反馈处理信息无效，请检查状态和备注。",
  feedback_update_failed: "反馈状态保存失败，请稍后重试。",
};

const messages: Record<string, string> = {
  points_updated: "积分已调整。",
  password_reset_sent: "密码重置邮件已发送。",
  password_updated: "密码已修改。",
  user_created: "账户已创建。",
  user_deleted: "账户已删除。",
  username_updated: "用户名已更新。",
  puzzle_created: "题目已新增。",
  puzzle_updated: "题目已保存。",
  puzzle_deleted: "题目已从可用题库移除。",
  puzzles_imported: "题库已清空并重新导入。",
  room_cleaned: "房间已关闭，聊天记录已删除。",
  ai_error_case_created: "AI 错误案例已收录。",
  ai_error_case_updated: "AI 错误案例已更新。",
  ai_error_cases_updated: "AI 错误案例已批量更新。",
  cache_entry_deleted: "缓存条目已删除。",
  cache_entry_updated: "缓存答案已修改。",
  cache_cleared: "整题缓存已清空。",
  email_sent: "邮件已发送。",
  feedback_updated: "反馈已更新。",
};

function getAdminTab(value?: string): AdminTab {
  if (
    value === "puzzles" ||
    value === "messages" ||
    value === "rooms" ||
    value === "points" ||
    value === "feedback" ||
    value === "emails"
  ) {
    return value;
  }
  // 旧 tab 值向后兼容
  if (value === "cleanup") return "rooms";
  if (value === "ai-errors") return "messages";
  if (value === "chat-backup") return "messages";
  return "accounts";
}

function getPointsTypeLabel(type: PointsTransactionType) {
  switch (type) {
    case "signup_bonus":
      return "注册奖励";
    case "room_reservation":
      return "房间预留";
    case "room_refund":
      return "房间退还";
    case "gift_sent":
      return "赠送积分";
    case "seat_query":
      return "AI 查询";
    case "admin_adjustment":
      return "管理员调整";
  }
}

function getPointsTypeFilter(value?: string): PointsTransactionType | "" {
  if (
    value === "signup_bonus" ||
    value === "room_reservation" ||
    value === "room_refund" ||
    value === "gift_sent" ||
    value === "seat_query" ||
    value === "admin_adjustment"
  ) {
    return value;
  }
  return "";
}

function getFeedbackStatusFilter(value?: string) {
  return value === "open" || value === "handled" || value === "ignored"
    ? value
    : "";
}

function getFeedbackCategoryFilter(value?: string) {
  return value === "bug" ||
    value === "ai" ||
    value === "suggestion" ||
    value === "puzzle" ||
    value === "other"
    ? value
    : "";
}

function getAiErrorStatusFilter(value?: string) {
  return value === "open" ||
    value === "reviewed" ||
    value === "fixed" ||
    value === "ignored"
    ? value
    : "";
}


function getModeFilter(value?: string) {
  return value === "chat" ||
    value === "ask" ||
    value === "hint" ||
    value === "reason"
    ? value
    : "";
}

export default async function AdminPage({ searchParams }: AdminPageProps) {
  await requireAdmin();
  const params = await searchParams;
  const flash = await getFlashMessage("admin");
  const errorCode = flash?.kind === "error" ? flash.code : params.error;
  const messageCode = flash?.kind === "notice" ? flash.code : params.message;
  const query = params.q?.trim().toLowerCase() ?? "";
  const activeTab = getAdminTab(params.tab);
  const initialMessageSubTab =
    params.tab === "ai-errors"
      ? ("errors" as const)
      : params.tab === "chat-backup"
        ? ("backup" as const)
        : ("audit" as const);
  const roomCodeFilter = params.roomCode?.trim().toUpperCase() ?? "";
  const modeFilter = getModeFilter(params.mode);
  const senderFilter = params.sender?.trim() ?? "";
  const senderTypeFilter =
    params.senderType === "registered" || params.senderType === "guest"
      ? params.senderType
      : "";
  const aiErrorStatusFilter = getAiErrorStatusFilter(params.caseStatus);
  const dateFrom = params.dateFrom?.trim() ?? "";
  const dateTo = params.dateTo?.trim() ?? "";
  const ptUserFilter = params.ptUser?.trim() ?? "";
  const ptTypeFilter = getPointsTypeFilter(params.ptType);
  const ptDateFrom = params.ptDateFrom?.trim() ?? "";
  const ptDateTo = params.ptDateTo?.trim() ?? "";
  const fbStatusFilter = getFeedbackStatusFilter(params.fbStatus);
  const fbCategoryFilter = getFeedbackCategoryFilter(params.fbCategory);
  const messageExportParams = new URLSearchParams();
  if (roomCodeFilter) messageExportParams.set("roomCode", roomCodeFilter);
  if (modeFilter) messageExportParams.set("mode", modeFilter);
  if (senderFilter) messageExportParams.set("sender", senderFilter);
  if (senderTypeFilter) messageExportParams.set("senderType", senderTypeFilter);
  const messageExportHref = `/admin/messages/export${
    messageExportParams.size ? `?${messageExportParams.toString()}` : ""
  }`;
  const admin = createAdminClient();

  // 按 tab 按需加载：只拉当前 tab 所需数据，避免每次请求都全量加载
  const loadAccounts = activeTab === "accounts";
  const loadPuzzles = activeTab === "puzzles";
  const loadMessages = activeTab === "messages";
  const loadRooms = activeTab === "rooms";
  const loadPoints = activeTab === "points";
  const loadFeedback = activeTab === "feedback";
  // 消息 tab 再按子 tab 收紧：审计、错误案例、聊天备份互不相干，不必一次全拉
  const loadMessageAudit = loadMessages && initialMessageSubTab === "audit";
  const loadAiErrors = loadMessages && initialMessageSubTab === "errors";
  const loadChatBackup = loadMessages && initialMessageSubTab === "backup";

  let adminMessagesQuery = admin
    .from("room_messages")
    .select(
      "id, room_id, seat_id, sender_name, sender_seat_number, sender_type, message_type, message_mode, content, puzzle_id, reply_to_id, created_at, rooms!inner(code, name, status)",
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

  if (dateFrom) {
    adminMessagesQuery = adminMessagesQuery.gte("created_at", dateFrom);
  }

  if (dateTo) {
    adminMessagesQuery = adminMessagesQuery.lte(
      "created_at",
      dateTo + "T23:59:59.999Z",
    );
  }

  const adminMessagesPromise = loadMessageAudit
    ? adminMessagesQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(200)
        .returns<AdminMessage[]>()
    : Promise.resolve({ data: [] as AdminMessage[], error: null });
  const cleanupRoomsPromise = loadRooms
    ? (admin.rpc(
        "admin_list_room_cleanup_candidates",
      ) as unknown as SupabaseResult<AdminCleanupRoom[]>)
    : Promise.resolve({ data: [] as AdminCleanupRoom[], error: null });
  const chatBackupDaysPromise = loadChatBackup
    ? (admin.rpc(
        "admin_list_chat_backup_days",
      ) as unknown as SupabaseResult<ChatBackupDay[]>)
    : Promise.resolve({ data: [] as ChatBackupDay[], error: null });

  const activeRoomsPromise = loadRooms
    ? admin
        .from("rooms")
        .select("id, code, name, status, max_members, points_per_seat, created_at, owner_id, current_puzzle_id")
        .in("status", ["waiting", "playing"])
        .order("created_at", { ascending: false })
        .limit(100)
        .returns<AdminActiveRoomRaw[]>()
    : Promise.resolve({ data: [] as AdminActiveRoomRaw[], error: null });

  let ptTxnsQuery = admin
    .from("points_transactions")
    .select("id, user_id, room_id, type, amount, balance_after, note, login_ip, login_device, login_location, created_at");

  if (ptTypeFilter) {
    ptTxnsQuery = ptTxnsQuery.eq("type", ptTypeFilter);
  }
  if (ptDateFrom) {
    ptTxnsQuery = ptTxnsQuery.gte("created_at", ptDateFrom);
  }
  if (ptDateTo) {
    ptTxnsQuery = ptTxnsQuery.lte("created_at", ptDateTo + "T23:59:59.999Z");
  }

  const ptTxnsPromise = loadPoints
    ? ptTxnsQuery
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(300)
        .returns<AdminPointsTransaction[]>()
    : Promise.resolve({ data: [] as AdminPointsTransaction[], error: null });
  let aiErrorCasesQuery = admin
    .from("ai_error_cases")
    .select(
      "id, room_id, puzzle_id, question_message_id, ai_message_id, question_content, ai_content, correct_answer, note, status, puzzle_title, puzzle_surface, puzzle_bottom, created_at, updated_at, rooms(code, name, status)",
    );

  if (aiErrorStatusFilter) {
    aiErrorCasesQuery = aiErrorCasesQuery.eq("status", aiErrorStatusFilter);
  }

  const aiErrorCasesPromise = loadAiErrors
    ? aiErrorCasesQuery
        .order("created_at", { ascending: false })
        .limit(500)
        .returns<AdminAiErrorCase[]>()
    : Promise.resolve({ data: [] as AdminAiErrorCase[], error: null });
  // 审计子 tab 只需要知道哪些 AI 回复已收录，不必拉整份案例正文
  const markedAiMessagesPromise = loadMessageAudit
    ? admin
        .from("ai_error_cases")
        .select("ai_message_id")
        .not("ai_message_id", "is", null)
        .returns<{ ai_message_id: number | null }[]>()
    : Promise.resolve({
        data: [] as { ai_message_id: number | null }[],
        error: null,
      });
  let feedbackQuery = admin
    .from("user_feedback")
    .select(
      "id, category, content, status, admin_note, display_name, page_path, device_label, location_label, created_at",
    );

  if (fbStatusFilter) {
    feedbackQuery = feedbackQuery.eq("status", fbStatusFilter);
  }
  if (fbCategoryFilter) {
    feedbackQuery = feedbackQuery.eq("category", fbCategoryFilter);
  }

  const feedbackPromise = loadFeedback
    ? feedbackQuery
        .order("created_at", { ascending: false })
        .limit(300)
        .returns<AdminFeedbackEntry[]>()
    : Promise.resolve({ data: [] as AdminFeedbackEntry[], error: null });
  const cacheEntriesPromise = loadPuzzles
    ? admin
        .from("puzzle_qa_cache")
        .select("id, puzzle_id, question_text, normalized_question, answer_type, status, hit_count, created_at, last_hit_at, engine, content_version")
        .order("status", { ascending: false })
        .order("hit_count", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(2000)
        .returns<(PuzzleCacheEntry & { puzzle_id: number })[]>()
    : Promise.resolve({ data: [] as (PuzzleCacheEntry & { puzzle_id: number })[], error: null });

  const [
    { data: usersData, error: usersError },
    { data: puzzles, error: puzzlesError },
    { data: adminMessages, error: adminMessagesError },
    { data: cleanupRooms, error: cleanupRoomsError },
    { data: aiErrorCases, error: aiErrorCasesError },
    { data: activeRoomsRaw, error: activeRoomsError },
    { data: ptTxnsRaw, error: ptTxnsError },
    { data: cacheEntriesRaw, error: cacheEntriesError },
    { data: chatBackupDays, error: chatBackupDaysError },
    { data: feedbackEntries, error: feedbackError },
    { data: markedAiMessages },
    { data: profiles, error: profilesError },
    { data: userActivity, error: userActivityError },
  ] = await Promise.all([
    loadAccounts
      ? admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      : (Promise.resolve({ data: { users: [] }, error: null }) as unknown as ReturnType<typeof admin.auth.admin.listUsers>),
    loadPuzzles
      ? admin
          .from("puzzles")
          .select(
            "id, title, surface, bottom, difficulty, is_active, key_points, examples, created_at, facts, content_version",
          )
          .order("id", { ascending: true })
          .returns<AdminPuzzle[]>()
      : Promise.resolve({ data: [] as AdminPuzzle[], error: null }),
    adminMessagesPromise,
    cleanupRoomsPromise,
    aiErrorCasesPromise,
    activeRoomsPromise,
    ptTxnsPromise,
    cacheEntriesPromise,
    chatBackupDaysPromise,
    feedbackPromise,
    markedAiMessagesPromise,
    // profiles 不依赖 auth 用户列表，和 listUsers 并行拉，少一次串行往返
    loadAccounts
      ? admin
          .from("profiles")
          .select("id, display_name, username, points, created_at")
          .limit(1000)
      : Promise.resolve({
          data: [] as {
            id: string;
            display_name: string | null;
            username: string | null;
            points: number;
            created_at: string;
          }[],
          error: null,
        }),
    loadAccounts
      ? admin
          .from("user_activity")
          .select("user_id, last_active_at")
          .limit(1000)
          .returns<{ user_id: string; last_active_at: string }[]>()
      : Promise.resolve({
          data: [] as { user_id: string; last_active_at: string }[],
          error: null,
        }),
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

  if (aiErrorCasesError) {
    throw new Error(`读取 AI 错误案例失败：${aiErrorCasesError.message}`);
  }

  if (activeRoomsError) {
    throw new Error(`读取活跃房间失败：${activeRoomsError.message}`);
  }

  if (ptTxnsError) {
    throw new Error(`读取积分流水失败：${ptTxnsError.message}`);
  }

  if (cacheEntriesError) {
    throw new Error(`读取问答缓存失败：${cacheEntriesError.message}`);
  }

  if (feedbackError) {
    throw new Error(`读取用户反馈失败：${feedbackError.message}`);
  }

  // 活跃时间只是辅助列，读取失败时显示为暂无记录，不影响账户管理。
  if (userActivityError) {
    console.error("读取用户活跃时间失败:", userActivityError.message);
  }

  // 聊天备份列表不影响其他 tab，报错时降级为空列表，避免整页崩溃。
  if (chatBackupDaysError) {
    console.error("读取聊天备份列表失败:", chatBackupDaysError.message);
  }

  const cacheByPuzzle: Record<number, PuzzleCacheEntry[]> = {};
  for (const entry of cacheEntriesRaw ?? []) {
    const { puzzle_id, ...rest } = entry;
    (cacheByPuzzle[puzzle_id] ??= []).push(rest);
  }

  // Fetch question messages referenced by AI messages via reply_to_id
  const replyToIds = [
    ...new Set(
      (adminMessages ?? [])
        .map((m) => m.reply_to_id)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const questionById: Record<number, AdminQuestionMessage> = {};
  if (replyToIds.length > 0) {
    const { data: questionMessages } = await admin
      .from("room_messages")
      .select("id, sender_name, sender_seat_number, sender_type, content, message_mode, created_at")
      .in("id", replyToIds)
      .returns<AdminQuestionMessage[]>();
    for (const q of questionMessages ?? []) {
      questionById[q.id] = q;
    }
  }

  // 审计详情里 B1 引用的 Fact 编号需要对应原文，只取本页消息涉及的题目
  const auditPuzzleIds = [
    ...new Set(
      (adminMessages ?? [])
        .map((m) => m.puzzle_id)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const factsByPuzzle: Record<number, AdminPuzzleFactRef[]> = {};
  if (auditPuzzleIds.length > 0) {
    const { data: auditPuzzles } = await admin
      .from("puzzles")
      .select("id, facts")
      .in("id", auditPuzzleIds)
      .returns<{ id: number; facts: unknown }[]>();
    for (const puzzle of auditPuzzles ?? []) {
      factsByPuzzle[puzzle.id] = Array.isArray(puzzle.facts)
        ? puzzle.facts.flatMap((fact) =>
            typeof fact?.id === "string" && typeof fact?.text === "string"
              ? [{ id: fact.id, text: fact.text }]
              : [],
          )
        : [];
    }
  }

  const users = usersData.users;

  if (profilesError) {
    throw new Error(`读取积分失败：${profilesError.message}`);
  }

  const profileById = new Map(
    profiles?.map((profile) => [profile.id, profile]) ?? [],
  );

  // 活跃房间关联数据
  const ownerIds = [
    ...new Set((activeRoomsRaw ?? []).map((r) => r.owner_id)),
  ];
  const puzzleIds = [
    ...new Set(
      (activeRoomsRaw ?? [])
        .map((r) => r.current_puzzle_id)
        .filter((id): id is number => id !== null),
    ),
  ];
  const activeRoomIds = (activeRoomsRaw ?? []).map((r) => r.id);

  const [ownerProfilesResult, activePuzzlesResult, roomSeatsResult] =
    await Promise.all([
      ownerIds.length
        ? admin.from("profiles").select("id, username").in("id", ownerIds)
        : { data: [] as { id: string; username: string | null }[], error: null },
      puzzleIds.length
        ? admin.from("puzzles").select("id, title").in("id", puzzleIds)
        : { data: [] as { id: number; title: string }[], error: null },
      activeRoomIds.length
        ? admin
            .from("room_seats")
            .select("room_id")
            .not("occupied_at", "is", null)
            .in("room_id", activeRoomIds)
        : { data: [] as { room_id: string }[], error: null },
    ]);

  const ownerProfileById = new Map(
    (ownerProfilesResult.data ?? []).map((p) => [p.id, p]),
  );
  const activePuzzleById = new Map(
    (activePuzzlesResult.data ?? []).map((p) => [p.id, p]),
  );
  const occupiedCountByRoom = new Map<string, number>();
  for (const seat of roomSeatsResult.data ?? []) {
    occupiedCountByRoom.set(
      seat.room_id,
      (occupiedCountByRoom.get(seat.room_id) ?? 0) + 1,
    );
  }

  const activeRooms: AdminActiveRoom[] = (activeRoomsRaw ?? []).map((r) => ({
    id: r.id,
    code: r.code,
    name: r.name,
    status: r.status,
    max_members: r.max_members,
    points_per_seat: r.points_per_seat,
    created_at: r.created_at,
    owner_username: ownerProfileById.get(r.owner_id)?.username ?? null,
    puzzle_title: r.current_puzzle_id
      ? (activePuzzleById.get(r.current_puzzle_id)?.title ?? null)
      : null,
    occupied_count: occupiedCountByRoom.get(r.id) ?? 0,
  }));

  // 积分流水关联数据
  const txnUserIds = [...new Set((ptTxnsRaw ?? []).map((t) => t.user_id))];
  const txnRoomIds = [
    ...new Set(
      (ptTxnsRaw ?? [])
        .map((t) => t.room_id)
        .filter((id): id is string => id !== null),
    ),
  ];

  const [txnProfilesResult, txnRoomsResult] = await Promise.all([
    txnUserIds.length
      ? admin.from("profiles").select("id, username").in("id", txnUserIds)
      : { data: [] as { id: string; username: string | null }[], error: null },
    txnRoomIds.length
      ? admin.from("rooms").select("id, code").in("id", txnRoomIds)
      : { data: [] as { id: string; code: string }[], error: null },
  ]);

  const txnProfileById = new Map(
    (txnProfilesResult.data ?? []).map((p) => [p.id, p]),
  );
  const txnRoomById = new Map(
    (txnRoomsResult.data ?? []).map((r) => [r.id, r]),
  );

  type EnrichedTransaction = AdminPointsTransaction & {
    username: string | null;
    room_code: string | null;
    note: string | null;
  };

  const allEnrichedTxns: EnrichedTransaction[] = (ptTxnsRaw ?? []).map(
    (t) => ({
      ...t,
      username: txnProfileById.get(t.user_id)?.username ?? null,
      room_code: t.room_id ? (txnRoomById.get(t.room_id)?.code ?? null) : null,
    }),
  );

  const visibleTxns = allEnrichedTxns.filter((t) =>
    ptUserFilter
      ? t.username?.toLowerCase().includes(ptUserFilter.toLowerCase())
      : true,
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
  const markedAiMessageIds = new Set(
    (markedAiMessages ?? [])
      .map((item) => item.ai_message_id)
      .filter((id): id is number => typeof id === "number"),
  );
  const visibleAiErrorCases = aiErrorCases ?? [];

  // 查询命中硬编码上限时给出提示，避免管理员误以为数据就这么多
  const usersTruncated = users.length >= 1000;
  const messagesTruncated = (adminMessages ?? []).length >= 200;
  const aiErrorCasesTruncated = (aiErrorCases ?? []).length >= 500;
  const pointsTruncated = (ptTxnsRaw ?? []).length >= 300;

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
      approveCacheAction={approveCacheEntry}
      cacheByPuzzle={cacheByPuzzle}
      clearPuzzleCacheAction={clearPuzzleCache}
      deleteAction={deletePuzzle}
      deleteCacheAction={deleteCacheEntry}
      key="puzzle-list"
      puzzles={visiblePuzzles}
      updateAction={updatePuzzle}
      updateCacheAnswerAction={updateCacheAnswer}
      updateCacheTextAction={updateCacheText}
    />
  );

  const importPuzzleContent = (
    <AdminPuzzleImport action={importPuzzles} key="import-puzzle-form" />
  );

  const lastActiveById = new Map(
    (userActivity ?? []).map((item) => [item.user_id, item.last_active_at]),
  );
  const accountUsers: AdminUserEntry[] = visibleUsers.map((user) => {
    const profile = profileById.get(user.id);
    return {
      id: user.id,
      email: user.email,
      username: profile?.username ?? null,
      points: profile?.points ?? 0,
      createdAt: user.created_at,
      lastActiveAt: lastActiveById.get(user.id) ?? null,
    };
  });

  // 搜索框放在各自 tab 的工具栏里，页头在所有 tab 下保持同一高度，切换时内容不跳
  const accountSearch = (
    <form className="admin-search">
      {params.sort === "active" && <input name="sort" type="hidden" value="active" />}
      <input
        defaultValue={params.q}
        name="q"
        placeholder="搜索邮箱或用户名"
        type="search"
      />
      <button className="button secondary" type="submit">
        搜索
      </button>
    </form>
  );

  const puzzleSearch = (
    <form className="admin-search">
      <input name="tab" type="hidden" value="puzzles" />
      <input
        defaultValue={params.q}
        name="q"
        placeholder="搜索标题、汤面或汤底"
        type="search"
      />
      <button className="button secondary" type="submit">
        搜索
      </button>
    </form>
  );

  const accountContent = (
    <div className="admin-section" key="accounts-section">
      <AdminUserSection
        search={accountSearch}
        createAdminUser={createAdminUser}
        deleteAdminUser={deleteAdminUser}
        sendPasswordReset={sendPasswordReset}
        updateUserPassword={updateUserPassword}
        adjustUserPoints={adjustUserPoints}
        updateUserUsername={updateUserUsername}
        users={accountUsers}
        initialSort={params.sort === "active" ? "active" : "created"}
        truncated={usersTruncated}
      />
    </div>
  );

  const messageContent = (
    <div className="admin-section" key="messages-section">
      <div className="admin-section-heading">
        <h2>消息审计</h2>
        <p className="muted">
          各房间最近 200 条消息，点击一条在右侧查看 AI 判定过程、证据和事实总结。
        </p>
        {messagesTruncated && (
          <p className="admin-truncated-hint">
            已达到本次查询上限（200 条），可能还有更早的消息未显示，请用房间号、发送者或日期区间缩小范围查看。
          </p>
        )}
      </div>

      <AdminFilterForm className="admin-message-filters">
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
        <label>
          开始日期
          <input defaultValue={dateFrom} name="dateFrom" type="date" />
        </label>
        <label>
          结束日期
          <input defaultValue={dateTo} name="dateTo" type="date" />
        </label>
        <div className="admin-filter-actions">
          <button className="button secondary" type="submit">
            筛选
          </button>
          <a className="button secondary" href={messageExportHref}>
            导出 CSV
          </a>
          <a className="button ghost" href="/admin?tab=messages">
            清空
          </a>
        </div>
      </AdminFilterForm>

      <AdminMessageAuditList
        createAiErrorCase={createAiErrorCase}
        factsByPuzzle={factsByPuzzle}
        markedAiMessageIds={[...markedAiMessageIds]}
        messages={adminMessages ?? []}
        questionById={questionById}
      />
    </div>
  );

  const aiErrorCaseContent = (
    <div className="admin-section" key="ai-error-cases-section">
      <div className="admin-section-heading">
        <h2>AI 错误案例</h2>
        <p className="muted">
          收集 AI 询问回答不准确的样本，保留玩家提问、AI 回答和题目故事快照。
        </p>
        {aiErrorCasesTruncated && (
          <p className="admin-truncated-hint">
            已达到本次查询上限（500 条），可能还有更早的案例未显示，请用状态筛选缩小范围查看。
          </p>
        )}
      </div>

      <AdminFilterForm className="admin-message-filters">
        <input name="tab" type="hidden" value="ai-errors" />
        <label>
          状态
          <select defaultValue={aiErrorStatusFilter} name="caseStatus">
            <option value="">全部</option>
            <option value="open">待处理</option>
            <option value="reviewed">已复核</option>
            <option value="fixed">已修复</option>
            <option value="ignored">忽略</option>
          </select>
        </label>
        <div className="admin-filter-actions">
          <button className="button secondary" type="submit">
            筛选
          </button>
          <a className="button ghost" href="/admin?tab=ai-errors">
            清空
          </a>
        </div>
      </AdminFilterForm>

      <AdminAiErrorCaseList
        batchUpdateAction={batchUpdateAiErrorCaseStatus}
        cases={visibleAiErrorCases}
        exportHref="/admin/ai-errors/export"
        updateAction={updateAiErrorCase}
      />
    </div>
  );

  const chatBackupContent = (
    <div className="admin-section" key="chat-backup-section">
      <div className="admin-section-heading">
        <h2>聊天备份</h2>
        <p className="muted">
          按自然日（00:00:00–23:59:59）下载聊天记录，便于日后查看。列表显示每天是否已下载过。
        </p>
      </div>
      <AdminChatBackupList days={chatBackupDays ?? []} />
    </div>
  );

  const roomsContent = (
    <div className="admin-section" key="rooms-section">
      <div className="admin-section-heading">
        <h2>房间总览</h2>
        <p className="muted">
          显示当前所有等待中和游戏中的房间，可强制关闭并清除消息记录。
        </p>
      </div>
      <AdminRoomOverviewList action={forceCloseRoom} rooms={activeRooms} />
    </div>
  );

  const pointsContent = (
    <div className="admin-section" key="points-section">
      <div className="admin-section-heading">
        <h2>积分流水</h2>
        <p className="muted">最近 300 条积分变动记录，按类型和日期范围筛选。</p>
        {pointsTruncated && (
          <p className="admin-truncated-hint">
            已达到本次查询上限（300 条），用户名搜索仅在这 300 条内匹配，请先用类型或日期区间缩小范围再搜索用户名。
          </p>
        )}
      </div>

      <AdminFilterForm className="admin-message-filters">
        <input name="tab" type="hidden" value="points" />
        <label>
          用户名
          <input
            defaultValue={ptUserFilter}
            maxLength={20}
            name="ptUser"
            placeholder="用户名"
          />
        </label>
        <label>
          类型
          <select defaultValue={ptTypeFilter} name="ptType">
            <option value="">全部</option>
            <option value="signup_bonus">注册奖励</option>
            <option value="room_reservation">房间预留</option>
            <option value="room_refund">房间退还</option>
            <option value="gift_sent">赠送积分</option>
            <option value="seat_query">AI 查询</option>
            <option value="admin_adjustment">管理员调整</option>
          </select>
        </label>
        <label>
          开始日期
          <input defaultValue={ptDateFrom} name="ptDateFrom" type="date" />
        </label>
        <label>
          结束日期
          <input defaultValue={ptDateTo} name="ptDateTo" type="date" />
        </label>
        <div className="admin-filter-actions">
          <button className="button secondary" type="submit">
            筛选
          </button>
          <a className="button ghost" href="/admin?tab=points">
            清空
          </a>
        </div>
      </AdminFilterForm>

      {visibleTxns.length === 0 ? (
        <div className="card muted">没有找到匹配的积分记录。</div>
      ) : (
        <div className="admin-table-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>时间</th>
                <th>用户</th>
                <th>类型</th>
                <th className="admin-table-num">变动</th>
                <th className="admin-table-num">余额</th>
                <th>房间</th>
                <th>备注 / 来源</th>
              </tr>
            </thead>
            <tbody>
              {visibleTxns.map((txn) => {
                const source = [txn.login_location, txn.login_device, txn.login_ip]
                  .filter(Boolean)
                  .join(" · ");
                const detail = [txn.note, source].filter(Boolean).join(" · ");
                return (
                  <tr key={txn.id}>
                    <td className="muted">{formatAdminTime(txn.created_at)}</td>
                    <td>
                      <strong>{txn.username ?? txn.user_id.slice(0, 8)}</strong>
                    </td>
                    <td>
                      <span className={`admin-pill admin-points-type ${txn.type}`}>
                        {getPointsTypeLabel(txn.type)}
                      </span>
                    </td>
                    <td
                      className={`admin-table-num admin-points-amount ${txn.amount >= 0 ? "positive" : "negative"}`}
                    >
                      {txn.amount >= 0 ? "+" : ""}
                      {txn.amount}
                    </td>
                    <td className="admin-table-num">{txn.balance_after}</td>
                    <td>
                      {txn.room_code ? (
                        <span className="admin-table-code">{txn.room_code}</span>
                      ) : (
                        <span className="muted">—</span>
                      )}
                    </td>
                    <td className="admin-table-clip admin-table-grow muted" title={detail}>
                      {detail || "—"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );

  const visibleFeedback = feedbackEntries ?? [];
  const feedbackOpenCount = visibleFeedback.filter(
    (item) => item.status === "open",
  ).length;
  const feedbackTruncated = visibleFeedback.length >= 300;

  const feedbackContent = (
    <div className="admin-section" key="feedback-section">
      <div className="admin-section-heading">
        <h2>用户反馈</h2>
        <p className="muted">
          注册用户通过 /feedback 提交的反馈和投稿，每个账号每天最多 3 条。
        </p>
        {feedbackTruncated && (
          <p className="admin-truncated-hint">
            已达到本次查询上限（300 条），请用状态或类型筛选缩小范围查看。
          </p>
        )}
      </div>

      <AdminFilterForm className="admin-message-filters">
        <input name="tab" type="hidden" value="feedback" />
        <label>
          状态
          <select defaultValue={fbStatusFilter} name="fbStatus">
            <option value="">全部</option>
            <option value="open">待处理</option>
            <option value="handled">已处理</option>
            <option value="ignored">忽略</option>
          </select>
        </label>
        <label>
          类型
          <select defaultValue={fbCategoryFilter} name="fbCategory">
            <option value="">全部</option>
            <option value="bug">功能异常</option>
            <option value="ai">AI 判定问题</option>
            <option value="suggestion">体验建议</option>
            <option value="puzzle">投稿汤</option>
            <option value="other">其他</option>
          </select>
        </label>
        <div className="admin-filter-actions">
          <button className="button secondary" type="submit">
            筛选
          </button>
          <a className="button ghost" href="/admin?tab=feedback">
            清空
          </a>
        </div>
      </AdminFilterForm>

      <AdminFeedbackList
        entries={visibleFeedback}
        updateAction={updateFeedbackStatus}
      />
    </div>
  );

  const emailContent = (
    <div className="admin-section" key="emails-section">
      <div className="admin-section-heading">
        <h2>发送邮件</h2>
        <p className="muted">
          向指定邮箱发送纯文本通知。多个收件人可以换行填写。
        </p>
      </div>
      <AdminEmailForm action={sendEmailFromAdmin} />
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
        <div className="admin-heading-title">
          <h1>后台管理</h1>
          <p className="muted">
            {activeTab === "accounts" && `共 ${users.length} 个账户`}
            {activeTab === "puzzles" && `共 ${(puzzles ?? []).length} 道题目`}
            {activeTab === "messages" &&
              (loadAiErrors
                ? `共 ${visibleAiErrorCases.length} 条 AI 错误案例`
                : loadChatBackup
                  ? `共 ${(chatBackupDays ?? []).length} 天聊天备份`
                  : `共 ${(adminMessages ?? []).length} 条消息`)}
            {activeTab === "rooms" && `${cleanupRooms?.length ?? 0} 个待清理，${activeRooms.length} 个活跃房间`}
            {activeTab === "points" && `共 ${visibleTxns.length} 条积分记录`}
            {activeTab === "feedback" &&
              `共 ${visibleFeedback.length} 条反馈，${feedbackOpenCount} 条待处理`}
            {activeTab === "emails" && "发送系统邮件"}
          </p>
        </div>
      </div>

      {flash && <FlashCookieCleaner />}
      {errorCode && (
        <div className="error">
          {errors[errorCode] ?? "操作失败，请稍后重试。"}
        </div>
      )}
      {messageCode && (
        <div className="notice">{messages[messageCode] ?? "操作成功。"}</div>
      )}

      <AdminTabs
        accountCount={loadAccounts ? visibleUsers.length : null}
        accountContent={accountContent}
        aiErrorCaseContent={aiErrorCaseContent}
        aiErrorCaseCount={loadAiErrors ? visibleAiErrorCases.length : null}
        chatBackupContent={chatBackupContent}
        chatBackupCount={loadChatBackup ? (chatBackupDays ?? []).length : null}
        createPuzzleContent={createPuzzleContent}
        cleanupContent={cleanupContent}
        cleanupCount={loadRooms ? (cleanupRooms?.length ?? 0) : null}
        initialTab={activeTab}
        initialMessageSubTab={initialMessageSubTab}
        loadedTab={activeTab}
        loadedMessageSubTab={initialMessageSubTab}
        importPuzzleContent={importPuzzleContent}
        messageContent={messageContent}
        messageCount={loadMessageAudit ? (adminMessages?.length ?? 0) : null}
        puzzleContent={puzzleContent}
        puzzleSearch={puzzleSearch}
        puzzleCount={loadPuzzles ? visiblePuzzles.length : null}
        roomsContent={roomsContent}
        roomsCount={loadRooms ? activeRooms.length : null}
        pointsContent={pointsContent}
        pointsCount={loadPoints ? visibleTxns.length : null}
        feedbackContent={feedbackContent}
        feedbackOpenCount={loadFeedback ? feedbackOpenCount : null}
        emailContent={emailContent}
      />
    </section>
  );
}
