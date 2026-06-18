"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { redirectWithFlash } from "@/lib/flash";
import { getSiteOrigin } from "@/lib/site-url";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCreateUserSchema, adminPasswordSchema, usernameSchema } from "@/lib/validation";

const NOEMAIL_DOMAIN = "@noemail.internal";

const userIdSchema = z.uuid();
const roomIdSchema = z.uuid();
const pointsSchema = z.coerce.number().int().min(0).max(1_000_000_000);
const puzzleIdSchema = z.coerce.number().int().positive();
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

// 兼容旧版 questions.json 里用 `points` 命名得分点字段的情况
function normalizeImportItem(item: unknown) {
  if (typeof item !== "object" || item === null) return item;
  const record = item as Record<string, unknown>;
  if (record.key_points === undefined && record.points !== undefined) {
    return { ...record, key_points: record.points };
  }
  return record;
}

type AdminResultTab = "puzzles" | "messages" | "cleanup";

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
  const questions = formData.getAll("exampleQuestion");
  const answers = formData.getAll("exampleAnswer");
  const reasons = formData.getAll("exampleReason");
  const summaries = formData.getAll("exampleSummary");
  const validAnswers = new Set(["是", "否", "与此无关", "模糊问题"]);

  return questions
    .map((value, index) => ({
      question: String(value ?? "").trim(),
      answer: String(answers[index] ?? "").trim(),
      reason: String(reasons[index] ?? "").trim(),
      summary: String(summaries[index] ?? "").trim() || null,
    }))
    .filter(
      (example) =>
        example.question || example.answer || example.reason || example.summary,
    )
    .map((example) => {
      if (!example.question || !validAnswers.has(example.answer)) {
        throw new Error("invalid_examples");
      }
      return example;
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

export async function updateUserPoints(formData: FormData) {
  await requireAdmin();

  const userId = userIdSchema.safeParse(formData.get("userId"));
  const points = pointsSchema.safeParse(formData.get("points"));

  if (!userId.success || !points.success) {
    return await redirectAdminResult("error", "invalid_points");
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ points: points.data, updated_at: new Date().toISOString() })
    .eq("id", userId.data);

  if (error) {
    console.error("Admin points update failed", error);
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
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    console.error(
      `Admin password reset email failed: code=${error.code ?? "unknown"} status=${error.status ?? "unknown"} message=${error.message}`,
    );
    return await redirectAdminResult("error", passwordResetErrorCode(error));
  }

  return await redirectAdminResult("message", "password_reset_sent");
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
    await admin.from("room_ai_requests").update({ user_id: null }).eq("user_id", id);
    await admin.from("points_transactions").delete().eq("user_id", id);
    await admin.from("rooms").delete().eq("owner_id", id);

    const { error } = await admin.auth.admin.deleteUser(id);
    if (error) throw error;
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
