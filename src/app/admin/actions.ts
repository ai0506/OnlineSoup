"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { EmailConfigError, sendAdminEmail } from "@/lib/email";
import { redirectWithFlash } from "@/lib/flash";
import { getSiteOrigin } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizeQuestion } from "@/lib/qa-cache";
import { adminCreateUserSchema, adminPasswordSchema, usernameSchema } from "@/lib/validation";

const NOEMAIL_DOMAIN = "@noemail.internal";

const userIdSchema = z.uuid();
const roomIdSchema = z.uuid();
const caseIdSchema = z.uuid();
const messageIdSchema = z.coerce.number().int().positive();
const adjustAmountSchema = z.coerce.number().int().min(-1_000_000_000).max(1_000_000_000).refine((v) => v !== 0, "amount must not be zero");
const adjustNoteSchema = z.string().trim().max(200).default("");
const puzzleIdSchema = z.coerce.number().int().positive();
const cacheEntryIdSchema = z.coerce.number().int().positive();
const cacheAnswerSchema = z.enum(["yes", "no"]);
const cacheQuestionSchema = z.string().trim().min(1).max(500);
const aiErrorStatusSchema = z.enum(["open", "reviewed", "fixed", "ignored"]);
const aiErrorCaseSchema = z.object({
  correctAnswer: z.string().trim().min(1).max(2000),
  note: z.string().trim().max(1000).default(""),
});
const aiErrorCaseUpdateSchema = aiErrorCaseSchema.extend({
  status: aiErrorStatusSchema,
});
const puzzleSchema = z.object({
  title: z.string().trim().min(1).max(60),
  surface: z.string().trim().min(5).max(1000),
  bottom: z.string().trim().min(5).max(2000),
  difficulty: z.enum(["简单", "中等", "困难", "抽象"]),
  isActive: z.boolean(),
});

const importKeyPointSchema = z.object({
  id: z.coerce.number().int().optional(),
  text: z.string().trim().min(1),
  accept: z.array(z.string().trim()).optional().default([]),
});

const importExampleSchema = z.object({
  model: z.enum(["fact", "inferential"]).optional().default("fact"),
  question: z.string().trim().min(1),
  answer: z.enum(["是", "否", "与此无关", "模糊问题"]),
  reason: z.string().trim().optional().default(""),
  summary: z.string().trim().nullable().optional().default(null),
});

const importPuzzleSchema = z.object({
  title: z.string().trim().min(1).max(60),
  surface: z.string().trim().min(5).max(1000),
  bottom: z.string().trim().min(5).max(2000),
  difficulty: z.enum(["简单", "中等", "困难", "抽象"]),
  is_active: z.boolean().optional().default(true),
  key_points: z.array(importKeyPointSchema).optional().default([]),
  examples: z.array(importExampleSchema).optional().default([]),
});

const importPuzzlesSchema = z.array(importPuzzleSchema).min(1).max(500);
const ALLOWED_EMAIL_SENDERS = [
  "Online Soup <noreply@ai0506.com>",
  "Support <support@ai0506.com>",
] as const;

const adminEmailSchema = z.object({
  to: z
    .string()
    .trim()
    .min(1)
    .max(2000)
    .transform((value) =>
      value
        .split(/[\n,;]/)
        .map((item) => item.trim())
        .filter(Boolean),
    )
    .pipe(z.array(z.email()).min(1).max(50)),
  subject: z.string().trim().min(1).max(120),
  body: z.string().trim().min(1).max(5000),
  from: z.enum(ALLOWED_EMAIL_SENDERS).optional(),
});

// 兼容旧版 questions.json 里用 `points` 命名得分点字段的情况
function normalizeImportItem(item: unknown) {
  if (typeof item !== "object" || item === null) return item;
  const record = item as Record<string, unknown>;
  if (record.key_points === undefined && record.points !== undefined) {
    return { ...record, key_points: record.points };
  }
  return record;
}

type AdminResultTab = "puzzles" | "messages" | "cleanup" | "ai-errors" | "rooms" | "points" | "emails";

async function redirectAdminResult(
  type: "error" | "message",
  code: string,
  tab?: AdminResultTab,
): Promise<never> {
  return await redirectWithFlash(tab ? `/admin?tab=${tab}` : "/admin", {
    code,
    kind: type === "error" ? "error" : "notice",
    scope: "admin",
  });
}

function resultTab(formData: FormData) {
  return formData.get("returnTab") === "puzzles" ? "puzzles" : undefined;
}

function splitAccept(value: FormDataEntryValue | null) {
  return String(value ?? "")
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseKeyPoints(formData: FormData) {
  const texts = formData.getAll("pointText");
  const accepts = formData.getAll("pointAccept");

  return texts
    .map((value, index) => ({
      id: index + 1,
      text: String(value ?? "").trim(),
      accept: splitAccept(accepts[index] ?? null),
    }))
    .filter((point) => point.text || point.accept.length > 0)
    .map((point) => {
      if (!point.text) {
        throw new Error("invalid_key_points");
      }
      return point;
    });
}

function parseExamples(formData: FormData) {
  const models = formData.getAll("exampleModel");
  const questions = formData.getAll("exampleQuestion");
  const answers = formData.getAll("exampleAnswer");
  const reasons = formData.getAll("exampleReason");
  const validAnswers = new Set(["是", "否", "与此无关", "模糊问题"]);
  const validModels = new Set(["fact", "inferential"]);

  return questions
    .map((value, index) => ({
      model: String(models[index] ?? "fact").trim(),
      question: String(value ?? "").trim(),
      answer: String(answers[index] ?? "").trim(),
      reason: String(reasons[index] ?? "").trim(),
    }))
    .filter(
      (example) =>
        example.question || example.answer || example.reason,
    )
    .map((example) => {
      if (
        !example.question ||
        !validAnswers.has(example.answer) ||
        !validModels.has(example.model)
      ) {
        throw new Error("invalid_examples");
      }
      return {
        ...example,
        model: example.model as "fact" | "inferential",
      };
    });
}

function puzzleErrorCode(error: { message: string }) {
  if (error.message.includes("puzzle_title_taken")) return "puzzle_title_taken";
  if (error.message.includes("puzzle_not_found")) return "puzzle_not_found";
  if (
    error.message.includes("invalid_title") ||
    error.message.includes("invalid_surface") ||
    error.message.includes("invalid_bottom") ||
    error.message.includes("invalid_difficulty") ||
    error.message.includes("invalid_key_points") ||
    error.message.includes("invalid_examples") ||
    error.message.includes("invalid_puzzle") ||
    error.message.includes("invalid_puzzles")
  ) {
    return "invalid_puzzle";
  }
  return "puzzle_update_failed";
}

function passwordResetErrorCode(error: {
  code?: string;
  message?: string;
  status?: number;
}) {
  const message = error.message?.toLowerCase() ?? "";
  const code = error.code?.toLowerCase() ?? "";

  if (
    error.status === 429 ||
    code.includes("rate") ||
    message.includes("rate") ||
    message.includes("too many")
  ) {
    return "password_reset_rate_limited";
  }

  return "password_reset_failed";
}

export async function adjustUserPoints(formData: FormData) {
  await requireAdmin();

  const userId = userIdSchema.safeParse(formData.get("userId"));
  const amount = adjustAmountSchema.safeParse(formData.get("amount"));
  const note = adjustNoteSchema.safeParse(formData.get("note"));

  if (!userId.success || !amount.success) {
    return await redirectAdminResult("error", "invalid_points");
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_adjust_user_points", {
    p_user_id: userId.data,
    p_amount: amount.data,
    p_note: note.success && note.data ? note.data : null,
  });

  if (error) {
    console.error("Admin points adjust failed", error);
    if (error.message.includes("insufficient points")) {
      return await redirectAdminResult("error", "points_insufficient");
    }
    return await redirectAdminResult("error", "points_update_failed");
  }

  revalidatePath("/admin");
  revalidatePath("/");
  return await redirectAdminResult("message", "points_updated");
}

export async function updateUserUsername(formData: FormData) {
  await requireAdmin();

  const userId = userIdSchema.safeParse(formData.get("userId"));
  const username = usernameSchema.safeParse(formData.get("username"));

  if (!userId.success || !username.success) {
    return await redirectAdminResult("error", "invalid_username");
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_set_username", {
    target_user_id: userId.data,
    requested_username: username.data,
  });

  if (error) {
    console.error("Admin username update failed", {
      code: error.code,
      message: error.message,
    });
    const code = error.message.includes("username_taken")
      ? "username_taken"
      : error.message.includes("active_room_exists")
        ? "username_active_room"
        : error.message.includes("room_name_conflict")
          ? "username_room_conflict"
          : "username_update_failed";
    return await redirectAdminResult("error", code);
  }

  revalidatePath("/admin");
  revalidatePath("/");
  return await redirectAdminResult("message", "username_updated");
}

export async function sendPasswordReset(formData: FormData) {
  await requireAdmin();

  const userId = userIdSchema.safeParse(formData.get("userId"));

  if (!userId.success) {
    return await redirectAdminResult("error", "invalid_user");
  }

  const admin = createAdminClient();
  const { data, error: userError } = await admin.auth.admin.getUserById(
    userId.data,
  );

  if (userError || !data.user.email) {
    console.error("Admin user lookup failed", userError);
    return await redirectAdminResult("error", "password_reset_failed");
  }

  const siteUrl = await getSiteOrigin();
  const { error } = await admin.auth.resetPasswordForEmail(data.user.email, {
    redirectTo: `${siteUrl}/reset-password`,
  });

  if (error) {
    console.error(
      `Admin password reset email failed: code=${error.code ?? "unknown"} status=${error.status ?? "unknown"} message=${error.message}`,
    );
    return await redirectAdminResult("error", passwordResetErrorCode(error));
  }

  return await redirectAdminResult("message", "password_reset_sent");
}

export async function sendEmailFromAdmin(formData: FormData) {
  await requireAdmin();

  const parsed = adminEmailSchema.safeParse({
    to: formData.get("to"),
    subject: formData.get("subject"),
    body: formData.get("body"),
    from: formData.get("from") || undefined,
  });

  if (!parsed.success) {
    return await redirectAdminResult("error", "invalid_email", "emails");
  }

  try {
    await sendAdminEmail({
      to: parsed.data.to,
      subject: parsed.data.subject,
      text: parsed.data.body,
      from: parsed.data.from,
    });
  } catch (error) {
    if (error instanceof EmailConfigError) {
      return await redirectAdminResult("error", "email_not_configured", "emails");
    }

    console.error("Admin email send failed", error);
    return await redirectAdminResult("error", "email_send_failed", "emails");
  }

  return await redirectAdminResult("message", "email_sent", "emails");
}

export async function createAdminUser(formData: FormData) {
  await requireAdmin();

  const parsed = adminCreateUserSchema.safeParse({
    username: formData.get("username"),
    password: formData.get("password"),
    points: formData.get("points"),
  });

  if (!parsed.success) {
    return await redirectAdminResult("error", "invalid_create_user");
  }

  const { username, password, points } = parsed.data;
  const internalEmail = username.toLowerCase() + NOEMAIL_DOMAIN;

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.createUser({
    email: internalEmail,
    password,
    email_confirm: true,
    user_metadata: {
      username,
      initial_points: points,
    },
  });

  if (error) {
    console.error("Admin create user failed", {
      code: error.code,
      message: error.message,
    });
    const code = error.message.includes("username_taken")
      ? "username_taken"
      : error.message.includes("already been registered") ||
          error.message.includes("already exists")
        ? "username_taken"
        : "create_user_failed";
    return await redirectAdminResult("error", code);
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "user_created");
}

export async function updateUserPassword(formData: FormData) {
  await requireAdmin();

  const userId = userIdSchema.safeParse(formData.get("userId"));
  const password = adminPasswordSchema.safeParse(formData.get("password"));

  if (!userId.success || !password.success) {
    return await redirectAdminResult("error", "invalid_password");
  }

  const admin = createAdminClient();
  const { error } = await admin.auth.admin.updateUserById(userId.data, {
    password: password.data,
  });

  if (error) {
    console.error("Admin password update failed", error);
    return await redirectAdminResult("error", "password_update_failed");
  }

  return await redirectAdminResult("message", "password_updated");
}

export async function deleteAdminUser(formData: FormData) {
  await requireAdmin();

  const userId = userIdSchema.safeParse(formData.get("userId"));
  if (!userId.success) {
    return await redirectAdminResult("error", "invalid_user");
  }

  const admin = createAdminClient();
  const id = userId.data;

  try {
    const { error: cleanupError } = await admin.rpc(
      "admin_cleanup_user_before_delete",
      { p_user_id: id },
    );
    if (cleanupError) throw cleanupError;

    const { error: deleteError } = await admin.auth.admin.deleteUser(id);
    if (deleteError) throw deleteError;
  } catch (err) {
    console.error("Admin delete user failed", err);
    return await redirectAdminResult("error", "delete_user_failed");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "user_deleted");
}

export async function createPuzzle(formData: FormData) {
  await requireAdmin();
  const tab = resultTab(formData);

  let keyPoints: ReturnType<typeof parseKeyPoints>;
  let examples: ReturnType<typeof parseExamples>;
  try {
    keyPoints = parseKeyPoints(formData);
    examples = parseExamples(formData);
  } catch {
    return await redirectAdminResult("error", "invalid_puzzle", tab);
  }

  const parsed = puzzleSchema.safeParse({
    title: formData.get("title"),
    surface: formData.get("surface"),
    bottom: formData.get("bottom"),
    difficulty: formData.get("difficulty"),
    isActive: true,
  });

  if (!parsed.success) {
    return await redirectAdminResult("error", "invalid_puzzle", tab);
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_create_puzzle", {
    p_title: parsed.data.title,
    p_surface: parsed.data.surface,
    p_bottom: parsed.data.bottom,
    p_difficulty: parsed.data.difficulty,
    p_key_points: keyPoints,
    p_examples: examples,
  });

  if (error) {
    console.error("Admin puzzle create failed", error);
    return await redirectAdminResult("error", puzzleErrorCode(error), tab);
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return await redirectAdminResult("message", "puzzle_created", tab);
}

export async function updatePuzzle(formData: FormData) {
  await requireAdmin();
  const tab = resultTab(formData);

  let keyPoints: ReturnType<typeof parseKeyPoints>;
  let examples: ReturnType<typeof parseExamples>;
  try {
    keyPoints = parseKeyPoints(formData);
    examples = parseExamples(formData);
  } catch {
    return await redirectAdminResult("error", "invalid_puzzle", tab);
  }

  const puzzleId = puzzleIdSchema.safeParse(formData.get("puzzleId"));
  const parsed = puzzleSchema.safeParse({
    title: formData.get("title"),
    surface: formData.get("surface"),
    bottom: formData.get("bottom"),
    difficulty: formData.get("difficulty"),
    isActive: formData.get("isActive") === "on",
  });

  if (!puzzleId.success || !parsed.success) {
    return await redirectAdminResult("error", "invalid_puzzle", tab);
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_update_puzzle", {
    p_puzzle_id: puzzleId.data,
    p_title: parsed.data.title,
    p_surface: parsed.data.surface,
    p_bottom: parsed.data.bottom,
    p_difficulty: parsed.data.difficulty,
    p_is_active: parsed.data.isActive,
    p_key_points: keyPoints,
    p_examples: examples,
  });

  if (error) {
    console.error("Admin puzzle update failed", error);
    return await redirectAdminResult("error", puzzleErrorCode(error), tab);
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return await redirectAdminResult("message", "puzzle_updated", tab);
}

export async function importPuzzles(formData: FormData) {
  await requireAdmin();
  const tab = resultTab(formData);

  const confirmed = formData.get("confirmReplace") === "on";
  const file = formData.get("file");

  if (!confirmed || !(file instanceof File) || file.size === 0) {
    return await redirectAdminResult("error", "invalid_puzzle_import", tab);
  }

  let parsedJson: unknown;
  try {
    const text = await file.text();
    parsedJson = JSON.parse(text);
  } catch {
    return await redirectAdminResult("error", "invalid_puzzle_import_json", tab);
  }

  const normalized = Array.isArray(parsedJson)
    ? parsedJson.map(normalizeImportItem)
    : parsedJson;
  const parsed = importPuzzlesSchema.safeParse(normalized);

  if (!parsed.success) {
    return await redirectAdminResult("error", "invalid_puzzle_import", tab);
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_replace_all_puzzles", {
    p_puzzles: parsed.data,
  });

  if (error) {
    console.error("Admin puzzle import failed", error);
    return await redirectAdminResult("error", puzzleErrorCode(error), tab);
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return await redirectAdminResult("message", "puzzles_imported", tab);
}

export async function deletePuzzle(formData: FormData) {
  await requireAdmin();
  const tab = resultTab(formData);

  const puzzleId = puzzleIdSchema.safeParse(formData.get("puzzleId"));
  const confirmed = formData.get("confirmDelete") === "on";

  if (!puzzleId.success || !confirmed) {
    return await redirectAdminResult("error", "invalid_puzzle_delete", tab);
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_delete_puzzle", {
    p_puzzle_id: puzzleId.data,
  });

  if (error) {
    console.error("Admin puzzle delete failed", error);
    return await redirectAdminResult("error", puzzleErrorCode(error), tab);
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  return await redirectAdminResult("message", "puzzle_deleted", tab);
}

export async function deleteCacheEntry(formData: FormData) {
  await requireAdmin();

  const entryId = cacheEntryIdSchema.safeParse(formData.get("entryId"));
  if (!entryId.success) {
    return await redirectAdminResult("error", "invalid_cache_entry", "puzzles");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("puzzle_qa_cache")
    .delete()
    .eq("id", entryId.data);

  if (error) {
    console.error("Admin cache entry delete failed", error);
    return await redirectAdminResult("error", "cache_update_failed", "puzzles");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "cache_entry_deleted", "puzzles");
}

export async function updateCacheAnswer(formData: FormData) {
  await requireAdmin();

  const entryId = cacheEntryIdSchema.safeParse(formData.get("entryId"));
  const answer = cacheAnswerSchema.safeParse(formData.get("answerType"));
  if (!entryId.success || !answer.success) {
    return await redirectAdminResult("error", "invalid_cache_entry", "puzzles");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("puzzle_qa_cache")
    .update({ answer_type: answer.data })
    .eq("id", entryId.data);

  if (error) {
    console.error("Admin cache answer update failed", error);
    return await redirectAdminResult("error", "cache_update_failed", "puzzles");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "cache_entry_updated", "puzzles");
}

export async function approveCacheEntry(formData: FormData) {
  await requireAdmin();

  const entryId = cacheEntryIdSchema.safeParse(formData.get("entryId"));
  if (!entryId.success) {
    return await redirectAdminResult("error", "invalid_cache_entry", "puzzles");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("puzzle_qa_cache")
    .update({ status: "approved" })
    .eq("id", entryId.data);

  if (error) {
    console.error("Admin cache approve failed", error);
    return await redirectAdminResult("error", "cache_update_failed", "puzzles");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "cache_entry_updated", "puzzles");
}

export async function updateCacheText(formData: FormData) {
  await requireAdmin();

  const entryId = cacheEntryIdSchema.safeParse(formData.get("entryId"));
  const question = cacheQuestionSchema.safeParse(formData.get("questionText"));
  if (!entryId.success || !question.success) {
    return await redirectAdminResult("error", "invalid_cache_entry", "puzzles");
  }

  const normalized = normalizeQuestion(question.data);
  if (normalized.length === 0) {
    return await redirectAdminResult("error", "invalid_cache_entry", "puzzles");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("puzzle_qa_cache")
    .update({ question_text: question.data, normalized_question: normalized })
    .eq("id", entryId.data);

  if (error) {
    console.error("Admin cache text update failed", error);
    return await redirectAdminResult("error", "cache_update_failed", "puzzles");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "cache_entry_updated", "puzzles");
}

export async function clearPuzzleCache(formData: FormData) {
  await requireAdmin();

  const puzzleId = puzzleIdSchema.safeParse(formData.get("puzzleId"));
  if (!puzzleId.success) {
    return await redirectAdminResult("error", "invalid_cache_entry", "puzzles");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("puzzle_qa_cache")
    .delete()
    .eq("puzzle_id", puzzleId.data);

  if (error) {
    console.error("Admin puzzle cache clear failed", error);
    return await redirectAdminResult("error", "cache_update_failed", "puzzles");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "cache_cleared", "puzzles");
}

export async function createAiErrorCase(formData: FormData) {
  const user = await requireAdmin();

  const aiMessageId = messageIdSchema.safeParse(formData.get("aiMessageId"));
  const parsed = aiErrorCaseSchema.safeParse({
    correctAnswer: formData.get("correctAnswer"),
    note: formData.get("note"),
  });

  if (!aiMessageId.success || !parsed.success) {
    return await redirectAdminResult("error", "invalid_ai_error_case", "messages");
  }

  const admin = createAdminClient();
  const { data: existingCase, error: existingCaseError } = await admin
    .from("ai_error_cases")
    .select("id")
    .eq("ai_message_id", aiMessageId.data)
    .maybeSingle();

  if (existingCaseError) {
    console.error("Admin AI error case duplicate check failed", existingCaseError);
    return await redirectAdminResult("error", "ai_error_case_failed", "messages");
  }

  if (existingCase) {
    return await redirectAdminResult("error", "ai_error_case_exists", "messages");
  }

  const { data: aiMessage, error: aiMessageError } = await admin
    .from("room_messages")
    .select("id, room_id, content, message_type, message_mode, puzzle_id, reply_to_id, created_at")
    .eq("id", aiMessageId.data)
    .maybeSingle();

  if (
    aiMessageError ||
    !aiMessage ||
    aiMessage.message_type !== "ai" ||
    (aiMessage.message_mode !== "ask" && aiMessage.message_mode !== "reason") ||
    aiMessage.puzzle_id == null
  ) {
    console.error("Admin AI error case source lookup failed", aiMessageError);
    return await redirectAdminResult("error", "invalid_ai_error_case_source", "messages");
  }

  type QuestionRow = { id: number; content: string };
  let questionMessage: QuestionRow | null = null;

  if (aiMessage.message_mode === "reason") {
    if (aiMessage.reply_to_id != null) {
      const { data: replyMsg, error: replyError } = await admin
        .from("room_messages")
        .select("id, content")
        .eq("id", aiMessage.reply_to_id)
        .maybeSingle();
      if (replyError || !replyMsg) {
        console.error("Admin AI error case reason question lookup failed", replyError);
        return await redirectAdminResult("error", "ai_error_question_not_found", "messages");
      }
      questionMessage = replyMsg;
    } else {
      const { data: reasonMsgs, error: reasonError } = await admin
        .from("room_messages")
        .select("id, content")
        .eq("room_id", aiMessage.room_id)
        .eq("message_type", "chat")
        .eq("message_mode", "reason")
        .eq("puzzle_id", aiMessage.puzzle_id)
        .lt("id", aiMessage.id)
        .order("created_at", { ascending: false })
        .order("id", { ascending: false })
        .limit(1);
      if (reasonError || !reasonMsgs?.[0]) {
        console.error("Admin AI error case reason question fallback failed", reasonError);
        return await redirectAdminResult("error", "ai_error_question_not_found", "messages");
      }
      questionMessage = reasonMsgs[0];
    }
  } else {
    const { data: questionMessages, error: questionError } = await admin
      .from("room_messages")
      .select("id, content")
      .eq("room_id", aiMessage.room_id)
      .eq("message_type", "chat")
      .eq("message_mode", "ask")
      .eq("puzzle_id", aiMessage.puzzle_id)
      .lt("id", aiMessage.id)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false })
      .limit(1);
    if (questionError || !questionMessages?.[0]) {
      console.error("Admin AI error case question lookup failed", questionError);
      return await redirectAdminResult("error", "ai_error_question_not_found", "messages");
    }
    questionMessage = questionMessages[0];
  }

  if (!questionMessage) {
    return await redirectAdminResult("error", "ai_error_question_not_found", "messages");
  }

  const { data: puzzle, error: puzzleError } = await admin
    .from("puzzles")
    .select("title, surface, bottom")
    .eq("id", aiMessage.puzzle_id)
    .maybeSingle();

  if (puzzleError || !puzzle) {
    console.error("Admin AI error case puzzle lookup failed", puzzleError);
    return await redirectAdminResult("error", "ai_error_puzzle_not_found", "messages");
  }

  const { error } = await admin.from("ai_error_cases").insert({
    room_id: aiMessage.room_id,
    puzzle_id: aiMessage.puzzle_id,
    question_message_id: questionMessage.id,
    ai_message_id: aiMessage.id,
    question_content: questionMessage.content,
    ai_content: aiMessage.content,
    correct_answer: parsed.data.correctAnswer,
    note: parsed.data.note,
    puzzle_title: puzzle.title,
    puzzle_surface: puzzle.surface,
    puzzle_bottom: puzzle.bottom,
    created_by: user.id,
  });

  if (error) {
    console.error("Admin AI error case create failed", error);
    const code = error.code === "23505" ? "ai_error_case_exists" : "ai_error_case_failed";
    return await redirectAdminResult("error", code, "messages");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "ai_error_case_created", "ai-errors");
}

export async function updateAiErrorCase(formData: FormData) {
  await requireAdmin();

  const caseId = caseIdSchema.safeParse(formData.get("caseId"));
  const parsed = aiErrorCaseUpdateSchema.safeParse({
    correctAnswer: formData.get("correctAnswer"),
    note: formData.get("note"),
    status: formData.get("status"),
  });

  if (!caseId.success || !parsed.success) {
    return await redirectAdminResult("error", "invalid_ai_error_case", "ai-errors");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("ai_error_cases")
    .update({
      correct_answer: parsed.data.correctAnswer,
      note: parsed.data.note,
      status: parsed.data.status,
      updated_at: new Date().toISOString(),
    })
    .eq("id", caseId.data);

  if (error) {
    console.error("Admin AI error case update failed", error);
    return await redirectAdminResult("error", "ai_error_case_failed", "ai-errors");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "ai_error_case_updated", "ai-errors");
}

export async function forceCloseRoom(formData: FormData) {
  await requireAdmin();

  const roomId = roomIdSchema.safeParse(formData.get("roomId"));

  if (!roomId.success) {
    return await redirectAdminResult("error", "invalid_room_cleanup", "rooms");
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_force_close_and_clear_room", {
    p_room_id: roomId.data,
  });

  if (error) {
    console.error("Admin room force-close failed", error);
    return await redirectAdminResult("error", "room_cleanup_failed", "rooms");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "room_cleaned", "rooms");
}

export async function clearRoomMessages(formData: FormData) {
  await requireAdmin();

  const roomIds = z.array(roomIdSchema).min(1).safeParse(formData.getAll("roomId"));

  if (!roomIds.success) {
    return await redirectAdminResult("error", "invalid_room_cleanup", "cleanup");
  }

  const admin = createAdminClient();
  for (const roomId of roomIds.data) {
    const { error } = await admin.rpc("admin_force_close_and_clear_room", {
      p_room_id: roomId,
    });

    if (error) {
      console.error("Admin room cleanup failed", error);
      return await redirectAdminResult("error", "room_cleanup_failed", "cleanup");
    }
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "room_cleaned", "cleanup");
}

export async function batchUpdateAiErrorCaseStatus(formData: FormData) {
  await requireAdmin();

  const ids = z
    .array(z.uuid())
    .min(1)
    .safeParse(formData.getAll("caseIds").map(String));
  const status = aiErrorStatusSchema.safeParse(formData.get("status"));

  if (!ids.success || !status.success) {
    return await redirectAdminResult("error", "invalid_ai_error_case", "ai-errors");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("ai_error_cases")
    .update({ status: status.data, updated_at: new Date().toISOString() })
    .in("id", ids.data);

  if (error) {
    console.error("Admin AI error cases batch update failed", error);
    return await redirectAdminResult("error", "ai_error_case_failed", "ai-errors");
  }

  revalidatePath("/admin");
  return await redirectAdminResult("message", "ai_error_cases_updated", "ai-errors");
}
