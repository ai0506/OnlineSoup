import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type AiErrorStatus = "open" | "reviewed" | "fixed" | "ignored";

type ExportAiErrorCase = {
  id: string;
  status: AiErrorStatus;
  puzzle_title: string;
  puzzle_surface: string;
  puzzle_bottom: string;
  question_content: string;
  ai_content: string;
  correct_answer: string;
  note: string;
  created_at: string;
  updated_at: string;
  rooms: { code: string; name: string } | null;
};

const csvColumns: Array<[string, (c: ExportAiErrorCase) => string]> = [
  ["id", (c) => c.id],
  ["status", (c) => c.status],
  ["created_at", (c) => c.created_at],
  ["updated_at", (c) => c.updated_at],
  ["room_code", (c) => c.rooms?.code ?? ""],
  ["room_name", (c) => c.rooms?.name ?? ""],
  ["puzzle_title", (c) => c.puzzle_title],
  ["question_content", (c) => c.question_content],
  ["ai_content", (c) => c.ai_content],
  ["correct_answer", (c) => c.correct_answer],
  ["note", (c) => c.note],
];

function escapeCsv(value: string) {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function buildCsv(cases: ExportAiErrorCase[]) {
  const header = csvColumns.map(([label]) => label).join(",");
  const rows = cases.map((c) =>
    csvColumns.map(([, getter]) => escapeCsv(getter(c))).join(","),
  );
  return `﻿${[header, ...rows].join("\r\n")}\r\n`;
}

export async function GET() {
  await requireAdmin();
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("ai_error_cases")
    .select(
      "id, status, puzzle_title, puzzle_surface, puzzle_bottom, question_content, ai_content, correct_answer, note, created_at, updated_at, rooms(code, name)",
    )
    .order("created_at", { ascending: true })
    .returns<ExportAiErrorCase[]>();

  if (error) {
    console.error("Admin AI error cases export failed", error);
    return Response.json({ error: "导出失败，请稍后重试。" }, { status: 500 });
  }

  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  const fileName = `ai-errors-${timestamp}.csv`;

  return new Response(buildCsv(data ?? []), {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
