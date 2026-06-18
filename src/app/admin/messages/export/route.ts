import { requireAdmin } from "@/lib/admin";
import { createAdminClient } from "@/lib/supabase/admin";

export const dynamic = "force-dynamic";

type MessageMode = "chat" | "ask" | "hint" | "reason";
type SenderType = "registered" | "guest";

type AdminExportMessage = {
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

const csvColumns: Array<[string, (message: AdminExportMessage) => string]> = [
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

function getModeFilter(value: string | null) {
  return value === "chat" ||
    value === "ask" ||
    value === "hint" ||
    value === "reason"
    ? value
    : "";
}

function getSenderTypeFilter(value: string | null) {
  return value === "registered" || value === "guest" ? value : "";
}

function escapeCsv(value: string) {
  if (!/[",\r\n]/.test(value)) {
    return value;
  }

  return `"${value.replaceAll('"', '""')}"`;
}

function buildCsv(messages: AdminExportMessage[]) {
  const header = csvColumns.map(([label]) => label).join(",");
  const rows = messages.map((message) =>
    csvColumns.map(([, getter]) => escapeCsv(getter(message))).join(","),
  );

  return `\uFEFF${[header, ...rows].join("\r\n")}\r\n`;
}

function buildFileName(roomCodeFilter: string) {
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "")
    .replace(/\.\d{3}Z$/, "Z");
  const scope = roomCodeFilter ? `-${roomCodeFilter}` : "";

  return `online-soup-messages${scope}-${timestamp}.csv`;
}

export async function GET(request: Request) {
  await requireAdmin();

  const searchParams = new URL(request.url).searchParams;
  const roomCodeFilter = searchParams.get("roomCode")?.trim().toUpperCase() ?? "";
  const senderFilter = searchParams.get("sender")?.trim() ?? "";
  const senderTypeFilter = getSenderTypeFilter(searchParams.get("senderType"));
  const modeFilter = getModeFilter(searchParams.get("mode"));
  const admin = createAdminClient();
  const messages: AdminExportMessage[] = [];
  const pageSize = 1000;

  for (let from = 0; ; from += pageSize) {
    let query = admin
      .from("room_messages")
      .select(
        "id, room_id, seat_id, sender_name, sender_seat_number, sender_type, message_type, message_mode, content, puzzle_id, created_at, rooms!inner(code, name, status)",
      );

    if (roomCodeFilter) {
      query =
        roomCodeFilter.length === 6
          ? query.eq("rooms.code", roomCodeFilter)
          : query.ilike("rooms.code", `${roomCodeFilter}%`);
    }

    if (senderFilter) {
      query = query.ilike("sender_name", `%${senderFilter}%`);
    }

    if (senderTypeFilter) {
      query = query.eq("sender_type", senderTypeFilter);
    }

    if (modeFilter) {
      query = query.eq("message_mode", modeFilter);
    }

    const { data, error } = await query
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1)
      .returns<AdminExportMessage[]>();

    if (error) {
      console.error("Admin message export failed", error);
      return Response.json(
        { error: "导出消息失败，请稍后重试。" },
        { status: 500 },
      );
    }

    messages.push(...(data ?? []));

    if (!data || data.length < pageSize) {
      break;
    }
  }

  const fileName = buildFileName(roomCodeFilter);

  return new Response(buildCsv(messages), {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "text/csv; charset=utf-8",
    },
  });
}
