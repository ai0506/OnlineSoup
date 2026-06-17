"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { usernameSchema } from "@/lib/validation";

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

function resultUrl(
  type: "error" | "message",
  code: string,
  tab?: AdminResultTab,
) {
  const params = new URLSearchParams([[type, code]]);
  if (tab) params.set("tab", tab);
  return `/admin?${params.toString()}`;
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

export async function updateUserPoints(formData: FormData) {
  await requireAdmin();

  const userId = userIdSchema.safeParse(formData.get("userId"));
  const points = pointsSchema.safeParse(formData.get("points"));

  if (!userId.success || !points.success) {
    redirect(resultUrl("error", "invalid_points"));
  }

  const admin = createAdminClient();
  const { error } = await admin
    .from("profiles")
    .update({ points: points.data, updated_at: new Date().toISOString() })
    .eq("id", userId.data);

  if (error) {
    console.error("Admin points update failed", error);
    redirect(resultUrl("error", "points_update_failed"));
  }

  revalidatePath("/admin");
  revalidatePath("/");
  redirect(resultUrl("message", "points_updated"));
}

export async function updateUserUsername(formData: FormData) {
  await requireAdmin();

  const userId = userIdSchema.safeParse(formData.get("userId"));
  const username = usernameSchema.safeParse(formData.get("username"));

  if (!userId.success || !username.success) {
    redirect(resultUrl("error", "invalid_username"));
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
    redirect(resultUrl("error", code));
  }

  revalidatePath("/admin");
  revalidatePath("/");
  redirect(resultUrl("message", "username_updated"));
}

export async function sendPasswordReset(formData: FormData) {
  await requireAdmin();

  const userId = userIdSchema.safeParse(formData.get("userId"));

  if (!userId.success) {
    redirect(resultUrl("error", "invalid_user"));
  }

  const admin = createAdminClient();
  const { data, error: userError } = await admin.auth.admin.getUserById(
    userId.data,
  );

  if (userError || !data.user.email) {
    console.error("Admin user lookup failed", userError);
    redirect(resultUrl("error", "password_reset_failed"));
  }

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
    "http://localhost:3000";
  const { error } = await admin.auth.resetPasswordForEmail(data.user.email, {
    redirectTo: `${siteUrl}/auth/callback?next=/reset-password`,
  });

  if (error) {
    console.error("Admin password reset email failed", error);
    redirect(resultUrl("error", "password_reset_failed"));
  }

  redirect(resultUrl("message", "password_reset_sent"));
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
    redirect(resultUrl("error", "invalid_puzzle", tab));
  }

  const parsed = puzzleSchema.safeParse({
    title: formData.get("title"),
    surface: formData.get("surface"),
    bottom: formData.get("bottom"),
    difficulty: formData.get("difficulty"),
    isActive: true,
  });

  if (!parsed.success) {
    redirect(resultUrl("error", "invalid_puzzle", tab));
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
    redirect(resultUrl("error", puzzleErrorCode(error), tab));
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  redirect(resultUrl("message", "puzzle_created", tab));
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
    redirect(resultUrl("error", "invalid_puzzle", tab));
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
    redirect(resultUrl("error", "invalid_puzzle", tab));
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
    redirect(resultUrl("error", puzzleErrorCode(error), tab));
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  redirect(resultUrl("message", "puzzle_updated", tab));
}

export async function importPuzzles(formData: FormData) {
  await requireAdmin();
  const tab = resultTab(formData);

  const confirmed = formData.get("confirmReplace") === "on";
  const file = formData.get("file");

  if (!confirmed || !(file instanceof File) || file.size === 0) {
    redirect(resultUrl("error", "invalid_puzzle_import", tab));
  }

  let parsedJson: unknown;
  try {
    const text = await file.text();
    parsedJson = JSON.parse(text);
  } catch {
    redirect(resultUrl("error", "invalid_puzzle_import_json", tab));
  }

  const normalized = Array.isArray(parsedJson)
    ? parsedJson.map(normalizeImportItem)
    : parsedJson;
  const parsed = importPuzzlesSchema.safeParse(normalized);

  if (!parsed.success) {
    redirect(resultUrl("error", "invalid_puzzle_import", tab));
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_replace_all_puzzles", {
    p_puzzles: parsed.data,
  });

  if (error) {
    console.error("Admin puzzle import failed", error);
    redirect(resultUrl("error", puzzleErrorCode(error), tab));
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  redirect(resultUrl("message", "puzzles_imported", tab));
}

export async function deletePuzzle(formData: FormData) {
  await requireAdmin();
  const tab = resultTab(formData);

  const puzzleId = puzzleIdSchema.safeParse(formData.get("puzzleId"));
  const confirmed = formData.get("confirmDelete") === "on";

  if (!puzzleId.success || !confirmed) {
    redirect(resultUrl("error", "invalid_puzzle_delete", tab));
  }

  const admin = createAdminClient();
  const { error } = await admin.rpc("admin_delete_puzzle", {
    p_puzzle_id: puzzleId.data,
  });

  if (error) {
    console.error("Admin puzzle delete failed", error);
    redirect(resultUrl("error", puzzleErrorCode(error), tab));
  }

  revalidatePath("/admin");
  revalidatePath("/", "layout");
  redirect(resultUrl("message", "puzzle_deleted", tab));
}

export async function clearRoomMessages(formData: FormData) {
  await requireAdmin();

  const roomIds = z.array(roomIdSchema).min(1).safeParse(formData.getAll("roomId"));

  if (!roomIds.success) {
    redirect(resultUrl("error", "invalid_room_cleanup", "cleanup"));
  }

  const admin = createAdminClient();
  for (const roomId of roomIds.data) {
    const { error } = await admin.rpc("admin_force_close_and_clear_room", {
      p_room_id: roomId,
    });

    if (error) {
      console.error("Admin room cleanup failed", error);
      redirect(resultUrl("error", "room_cleanup_failed", "cleanup"));
    }
  }

  revalidatePath("/admin");
  redirect(resultUrl("message", "room_cleaned", "cleanup"));
}
