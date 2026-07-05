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
import { AdminTabs } from "@/components/admin-tabs";
import { AdminAiErrorForm } from "@/components/admin-ai-error-form";
import { AdminAiErrorCaseList } from "@/components/admin-ai-error-case-list";
import {
  AdminChatBackupList,
  type ChatBackupDay,
} from "@/components/admin-chat-backup-list";
import { AdminFilterForm } from "@/components/admin-filter-form";
import { AdminEmailForm } from "@/components/admin-email-form";
import { FlashCookieCleaner } from "@/components/flash-cookie-cleaner";
import { requireAdmin } from "@/lib/admin";
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
  }>;
};

type AdminPuzzle = Required<Pick<AdminPuzzleFormValue, "id">> &
  AdminPuzzleFormValue & {
    difficulty: "简单" | "中等" | "困难" | "抽象";
    is_active: boolean;
    created_at: string;
  };

type AdminTab = "accounts" | "puzzles" | "messages" | "rooms" | "points" | "emails";
type AiErrorStatus = "open" | "reviewed" | "fixed" | "ignored";

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
  reply_to_id: number | null;
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
  reason: string | null;
};

type FactSummarySource = "glm" | "deepseek" | "unknown";

type AskCacheHitDetails = {
  entryId: number;
  questionText: string;
  normalizedQuestion: string | null;
  answerType: string;
  matchType: "exact" | "equivalent" | "unknown";
};

type AskAnswerDetails = {
  text: string;
  factSummary: string | null;
  factSummarySource: FactSummarySource;
  auditEntries: AskAuditEntry[];
  usedArbitration: boolean;
  cacheHit: AskCacheHitDetails | null;
};

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
  if (value === "puzzles" || value === "messages" || value === "rooms" || value === "points" || value === "emails") {
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

function getAiErrorStatusFilter(value?: string) {
  return value === "open" ||
    value === "reviewed" ||
    value === "fixed" ||
    value === "ignored"
    ? value
    : "";
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

function getFactSummarySourceLabel(source: FactSummarySource) {
  switch (source) {
    case "glm":
      return "GLM";
    case "deepseek":
      return "DeepSeek";
    default:
      return "历史消息";
  }
}

function getCacheMatchTypeLabel(value: AskCacheHitDetails["matchType"]) {
  switch (value) {
    case "exact":
      return "完全相同";
    case "equivalent":
      return "相似等价";
    default:
      return "未知";
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
      fact_summary_source?: unknown;
      ask_audit?: unknown;
      cache_hit?: unknown;
    };
    if (parsed.kind !== "answer" || typeof parsed.text !== "string") {
      return null;
    }

    const factSummary =
      typeof parsed.fact_summary === "string" ? parsed.fact_summary : null;
    const factSummarySource: FactSummarySource =
      parsed.fact_summary_source === "glm" || parsed.fact_summary_source === "deepseek"
        ? parsed.fact_summary_source
        : "unknown";
    let cacheHit: AskCacheHitDetails | null = null;
    if (typeof parsed.cache_hit === "object" && parsed.cache_hit !== null) {
      const record = parsed.cache_hit as Record<string, unknown>;
      const entryId =
        typeof record.entry_id === "number"
          ? record.entry_id
          : Number.parseInt(String(record.entry_id ?? ""), 10);
      if (
        Number.isFinite(entryId) &&
        typeof record.question_text === "string" &&
        typeof record.answer_type === "string"
      ) {
        cacheHit = {
          entryId,
          questionText: record.question_text,
          normalizedQuestion:
            typeof record.normalized_question === "string"
              ? record.normalized_question
              : null,
          answerType: record.answer_type,
          matchType:
            record.match_type === "exact" || record.match_type === "equivalent"
              ? record.match_type
              : "unknown",
        };
      }
    }

    if (typeof parsed.ask_audit !== "object" || parsed.ask_audit === null) {
      return {
        text: parsed.text,
        factSummary,
        factSummarySource,
        auditEntries: [],
        usedArbitration: false,
        cacheHit,
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
          reason: typeof record.reason === "string" ? record.reason : null,
        };
      })
      .filter((item): item is AskAuditEntry => item !== null);

    return {
      text: parsed.text,
      factSummary,
      factSummarySource,
      auditEntries,
      usedArbitration: auditEntries.some((item) => item.label === "仲裁"),
      cacheHit,
    };
  } catch {
    return null;
  }
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
  const loadPoints = activeTab === "points";

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

  const adminMessagesPromise = adminMessagesQuery
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(200)
    .returns<AdminMessage[]>();
  const cleanupRoomsPromise = admin.rpc(
    "admin_list_room_cleanup_candidates",
  ) as unknown as SupabaseResult<AdminCleanupRoom[]>;
  const chatBackupDaysPromise = loadMessages
    ? (admin.rpc(
        "admin_list_chat_backup_days",
      ) as unknown as SupabaseResult<ChatBackupDay[]>)
    : Promise.resolve({ data: [] as ChatBackupDay[], error: null });

  const activeRoomsPromise = admin
    .from("rooms")
    .select("id, code, name, status, max_members, points_per_seat, created_at, owner_id, current_puzzle_id")
    .in("status", ["waiting", "playing"])
    .order("created_at", { ascending: false })
    .limit(100)
    .returns<AdminActiveRoomRaw[]>();

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
  const aiErrorCasesPromise = loadMessages
    ? admin
        .from("ai_error_cases")
        .select(
          "id, room_id, puzzle_id, question_message_id, ai_message_id, question_content, ai_content, correct_answer, note, status, puzzle_title, puzzle_surface, puzzle_bottom, created_at, updated_at, rooms(code, name, status)",
        )
        .order("created_at", { ascending: false })
        .limit(500)
        .returns<AdminAiErrorCase[]>()
    : Promise.resolve({ data: [] as AdminAiErrorCase[], error: null });
  const cacheEntriesPromise = loadPuzzles
    ? admin
        .from("puzzle_qa_cache")
        .select("id, puzzle_id, question_text, normalized_question, answer_type, status, hit_count, created_at, last_hit_at")
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
  ] = await Promise.all([
    loadAccounts
      ? admin.auth.admin.listUsers({ page: 1, perPage: 1000 })
      : (Promise.resolve({ data: { users: [] }, error: null }) as unknown as ReturnType<typeof admin.auth.admin.listUsers>),
    loadPuzzles
      ? admin
          .from("puzzles")
          .select(
            "id, title, surface, bottom, difficulty, is_active, key_points, examples, created_at",
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
  type QuestionMessage = Pick<
    AdminMessage,
    "id" | "sender_name" | "sender_seat_number" | "sender_type" | "content" | "message_mode" | "created_at"
  >;
  const questionById = new Map<number, QuestionMessage>();
  if (replyToIds.length > 0) {
    const { data: questionMessages } = await admin
      .from("room_messages")
      .select("id, sender_name, sender_seat_number, sender_type, content, message_mode, created_at")
      .in("id", replyToIds)
      .returns<QuestionMessage[]>();
    for (const q of questionMessages ?? []) {
      questionById.set(q.id, q);
    }
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
    (aiErrorCases ?? [])
      .map((item) => item.ai_message_id)
      .filter((id): id is number => typeof id === "number"),
  );
  const visibleAiErrorCases = (aiErrorCases ?? []).filter((item) =>
    aiErrorStatusFilter ? item.status === aiErrorStatusFilter : true,
  );

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

  const accountUsers: AdminUserEntry[] = visibleUsers.map((user) => {
    const profile = profileById.get(user.id);
    return {
      id: user.id,
      email: user.email,
      username: profile?.username ?? null,
      points: profile?.points ?? 0,
    };
  });

  const accountContent = (
    <div className="admin-section" key="accounts-section">
      <AdminUserSection
        createAdminUser={createAdminUser}
        deleteAdminUser={deleteAdminUser}
        sendPasswordReset={sendPasswordReset}
        updateUserPassword={updateUserPassword}
        adjustUserPoints={adjustUserPoints}
        updateUserUsername={updateUserUsername}
        users={accountUsers}
      />
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

      <div className="admin-message-list">
        {(adminMessages ?? []).map((message) => {
          const reasoningCoverage = getReasoningCoverage(message);
          const askAnswerDetails = getAskAnswerDetails(message);
          const questionMessage = message.reply_to_id
            ? questionById.get(message.reply_to_id)
            : undefined;

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
              {questionMessage && (
                <div className="admin-question-row">
                  <span className="admin-question-label">
                    {questionMessage.sender_name} [{questionMessage.sender_seat_number}]
                    {" · "}{getModeLabel(questionMessage.message_mode)}
                    {" · "}{formatTime(questionMessage.created_at)}
                  </span>
                  <p className="admin-question-content">{questionMessage.content}</p>
                </div>
              )}
              {reasoningCoverage.length > 0 && (
                <div className="admin-reasoning-section">
                  <div className="admin-reasoning-section-header">
                    <span className="admin-reasoning-coverage-label">
                      覆盖率 {reasoningCoverage.filter(i => i.covered).length}/{reasoningCoverage.length} 已覆盖
                    </span>
                    {markedAiMessageIds.has(message.id) ? (
                      <span className="admin-ai-error-marked-badge">已收录</span>
                    ) : (
                      <AdminAiErrorForm
                        action={createAiErrorCase}
                        aiMessageId={message.id}
                        reasoningCoverage={reasoningCoverage}
                      />
                    )}
                  </div>
                  <details className="admin-collapsible">
                    <summary>查看覆盖率详情</summary>
                    <div className="admin-reasoning-coverage">
                      {reasoningCoverage.map((item) => (
                        <div
                          className={`admin-coverage-item${item.covered ? " covered" : ""}`}
                          key={item.id}
                        >
                          <strong>#{item.id}</strong>
                          <span>{item.covered ? "已覆盖" : "未覆盖"}</span>
                          {item.text && <p>{item.text}</p>}
                        </div>
                      ))}
                    </div>
                  </details>
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
                      {askAnswerDetails.cacheHit
                        ? "命中缓存"
                        : askAnswerDetails.usedArbitration
                          ? "已触发仲裁"
                          : "两路一致"}
                    </span>
                    {markedAiMessageIds.has(message.id) ? (
                      <span className="admin-ai-error-marked-badge">已收录</span>
                    ) : (
                      <AdminAiErrorForm action={createAiErrorCase} aiMessageId={message.id} />
                    )}
                  </div>
                  {askAnswerDetails.factSummary && (
                    <p className="admin-ask-fact">
                      事实总结：{askAnswerDetails.factSummary}
                      {" · 来源："}
                      {getFactSummarySourceLabel(askAnswerDetails.factSummarySource)}
                    </p>
                  )}
                  {askAnswerDetails.cacheHit && (
                    <details className="admin-collapsible admin-cache-hit-details">
                      <summary>
                        查看缓存来源
                        <span className="admin-cache-hit-badge">
                          {getCacheMatchTypeLabel(askAnswerDetails.cacheHit.matchType)}
                        </span>
                      </summary>
                      <div className="admin-cache-hit-body">
                        <div>
                          <span>缓存问题</span>
                          <p>{askAnswerDetails.cacheHit.questionText}</p>
                        </div>
                        <div className="admin-cache-hit-meta">
                          <span>缓存条目 #{askAnswerDetails.cacheHit.entryId}</span>
                          <span>答案类型 {askAnswerDetails.cacheHit.answerType}</span>
                          {askAnswerDetails.cacheHit.normalizedQuestion && (
                            <span>
                              规范化：{askAnswerDetails.cacheHit.normalizedQuestion}
                            </span>
                          )}
                        </div>
                      </div>
                    </details>
                  )}
                  {askAnswerDetails.auditEntries.length > 0 && (
                    <details className="admin-collapsible">
                      <summary>审计详情（{askAnswerDetails.usedArbitration ? "已仲裁" : "两路一致"}）</summary>
                      <div className="admin-ask-audit">
                        {askAnswerDetails.auditEntries.map((item) => (
                          <div className="admin-ask-audit-item" key={item.label}>
                            <strong>{item.label}</strong>
                            <span>
                              {item.text} / {item.answerType}
                            </span>
                            {item.reason && <p className="admin-ask-audit-reason">原因：{item.reason}</p>}
                            {item.factSummary && <p>{item.factSummary}</p>}
                          </div>
                        ))}
                      </div>
                    </details>
                  )}
                </div>
              )}
              <details className="admin-collapsible">
                <summary>原始内容</summary>
                <pre className="admin-message-content">{message.content}</pre>
              </details>
            </article>
          );
        })}

        {(adminMessages ?? []).length === 0 && (
          <div className="card muted">没有找到匹配的消息。</div>
        )}
      </div>
    </div>
  );

  const aiErrorCaseContent = (
    <div className="admin-section" key="ai-error-cases-section">
      <div className="admin-section-heading">
        <h2>AI 错误案例</h2>
        <p className="muted">
          收集 AI 询问回答不准确的样本，保留玩家提问、AI 回答和题目故事快照。
        </p>
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

      <div className="admin-points-list">
        {visibleTxns.map((txn) => (
          <div className="admin-points-row" key={txn.id}>
            <div className="admin-message-meta">
              <strong>{txn.username ?? txn.user_id.slice(0, 8)}</strong>
              {txn.room_code && <span>房间 {txn.room_code}</span>}
              <span>{formatTime(txn.created_at)}</span>
            </div>
            <div className="admin-message-badges">
              <span className={`admin-points-type ${txn.type}`}>
                {getPointsTypeLabel(txn.type)}
              </span>
              <span
                className={`admin-points-amount ${txn.amount >= 0 ? "positive" : "negative"}`}
              >
                {txn.amount >= 0 ? "+" : ""}
                {txn.amount} pt
              </span>
              <span>余额 {txn.balance_after} pt</span>
            </div>
            {(txn.login_location || txn.login_device || txn.login_ip) && (
              <div className="admin-message-meta">
                {txn.login_location && <span>地点 {txn.login_location}</span>}
                {txn.login_device && <span>设备 {txn.login_device}</span>}
                {txn.login_ip && <span>IP {txn.login_ip}</span>}
              </div>
            )}
            {txn.note && <p className="admin-points-note">{txn.note}</p>}
          </div>
        ))}
        {visibleTxns.length === 0 && (
          <div className="card muted">没有找到匹配的积分记录。</div>
        )}
      </div>
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
        <div>
          <p className="eyebrow">管理端</p>
          <h1>后台管理</h1>
          <p className="lead">
            {activeTab === "accounts" && `共 ${users.length} 个账户`}
            {activeTab === "puzzles" && `共 ${(puzzles ?? []).length} 道题目`}
            {activeTab === "messages" && `共 ${(adminMessages ?? []).length} 条消息`}
            {activeTab === "rooms" && `${cleanupRooms?.length ?? 0} 个待清理，${activeRooms.length} 个活跃房间`}
            {activeTab === "points" && `共 ${visibleTxns.length} 条积分记录`}
            {activeTab === "emails" && "发送系统邮件"}
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
        accountCount={visibleUsers.length}
        accountContent={accountContent}
        aiErrorCaseContent={aiErrorCaseContent}
        aiErrorCaseCount={visibleAiErrorCases.length}
        chatBackupContent={chatBackupContent}
        chatBackupCount={(chatBackupDays ?? []).length}
        createPuzzleContent={createPuzzleContent}
        cleanupContent={cleanupContent}
        cleanupCount={cleanupRooms?.length ?? 0}
        initialTab={activeTab}
        initialMessageSubTab={initialMessageSubTab}
        importPuzzleContent={importPuzzleContent}
        messageContent={messageContent}
        messageCount={adminMessages?.length ?? 0}
        puzzleContent={puzzleContent}
        puzzleCount={visiblePuzzles.length}
        roomsContent={roomsContent}
        roomsCount={activeRooms.length}
        pointsContent={pointsContent}
        pointsCount={visibleTxns.length}
        emailContent={emailContent}
      />
    </section>
  );
}
