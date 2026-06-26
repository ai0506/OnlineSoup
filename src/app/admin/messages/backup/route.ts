import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type MessageMode = "chat" | "ask" | "hint" | "reason";
type SenderType = "registered" | "guest";

type BackupMessage = {
  id: number;
  room_id: string;
  seat_id: string | null;
  sender_name: string;
  sender_seat_number: number | null;
  sender_type: SenderType | null;
  message_type: "chat" | "system" | "ai";
  message_mode: MessageMode;
  content: string;
  puzzle_id: number | null;
  created_at: string;
  rooms: {
    code: string;
    name: string;
    status: "waiting" | "playing" | "closed";
  } | null;
};

const csvColumns: Array<[string, (message: BackupMessage) => string]> = [
  ["message_id", (message) => String(message.id)],
  ["created_at", (message) => message.created_at],
  ["room_code", (message) => message.rooms?.code ?? ""],
  ["room_name", (message) => message.rooms?.name ?? ""],
  ["room_status", (message) => message.rooms?.status ?? ""],
  ["sender_name", (message) => message.sender_name],
  [
    "sender_seat_number",
    (message) =>
      message.sender_seat_number === null
        ? ""
        : String(message.sender_seat_number),
  ],
  ["sender_type", (message) => message.sender_type ?? ""],
  ["message_type", (message) => message.message_type],
  ["message_mode", (message) => message.message_mode],
  ["puzzle_id", (message) => message.puzzle_id?.toString() ?? ""],
  ["room_id", (message) => message.room_id],
  ["seat_id", (message) => message.seat_id ?? ""],
  ["content", (message) => message.content],
];

function escapeCsv(value: string) {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function buildCsv(messages: BackupMessage[]) {
  const header = csvColumns.map(([label]) => label).join(",");
  const rows = messages.map((message) =>
    csvColumns.map(([, getter]) => escapeCsv(getter(message))).join(","),
  );

  return `﻿${[header, ...rows].join("\r\n")}\r\n`;
}

// 校验 YYYY-MM-DD 并以 Asia/Shanghai（UTC+8，无夏令时）边界换算成 UTC 区间。
function getDayRange(value: string | null) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return null;
  }

  const start = new Date(`${value}T00:00:00+08:00`);
  if (Number.isNaN(start.getTime())) {
    return null;
  }
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);

  return { date: value, startIso: start.toISOString(), endIso: end.toISOString() };
}

export async function GET(request: Request) {
  await requireAdmin();

  const searchParams = new URL(request.url).searchParams;
  const range = getDayRange(searchParams.get("date"));
  if (!range) {
    return Response.json({ error: "日期参数不正确。" }, { status: 400 });
  }

  const admin = createAdminClient();
  const messages: BackupMessage[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    const { data, error } = await admin
      .from("room_messages")
      .select(
        "id, room_id, seat_id, sender_name, sender_seat_number, sender_type, message_type, message_mode, content, puzzle_id, created_at, rooms!inner(code, name, status)",
      )
      .gte("created_at", range.startIso)
      .lt("created_at", range.endIso)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1)
      .returns<BackupMessage[]>();

    if (error) {
      console.error("Admin daily chat backup failed", error);
      return Response.json(
        { error: "导出当日聊天记录失败，请稍后重试。" },
        { status: 500 },
      );
    }

    messages.push(...(data ?? []));

    if (!data || data.length < pageSize) {
      break;
    }
  }

  const { error: markError } = await admin.rpc(
    "admin_mark_chat_backup_downloaded",
    { p_backup_date: range.date },
  );
  if (markError) {
    console.error("Mark chat backup downloaded failed", markError);
  }

  return new Response(buildCsv(messages), {
    headers: {
      "Content-Disposition": `attachment; filename="online-soup-chat-${range.date}.csv"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
