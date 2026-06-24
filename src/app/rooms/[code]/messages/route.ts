import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { createClient } from "@/lib/supabase/server";
import type { RoomChatBootstrap, RoomMessage } from "@/lib/types";

function stripAuditField(msg: RoomMessage): RoomMessage {
  if (msg.message_type !== "ai") return msg;
  try {
    const parsed = JSON.parse(msg.content) as Record<string, unknown>;
    if ("ask_audit" in parsed) {
      delete parsed.ask_audit;
      return { ...msg, content: JSON.stringify(parsed) };
    }
  } catch { /* not JSON, leave as is */ }
  return msg;
}

type MessageRouteContext = {
  params: Promise<{ code: string }>;
};

const messageSchema = z.object({
  content: z.string().trim().min(1).max(300),
  message_mode: z.enum(["chat", "ask", "hint", "reason"]).default("chat"),
  use_personal_points: z.boolean().default(false),
});

function chatErrorResponse(error: { message: string }) {
  const msg = error.message;
  const status = msg.includes("room_membership_required")
    ? 403
    : msg.includes("room_not_found")
      ? 404
      : msg.includes("room_closed")
        ? 410
        : msg.includes("invalid_message")
          ? 400
          : msg.includes("insufficient_seat_points") || msg.includes("insufficient_points")
            ? 402
            : msg.includes("rate_limited")
              ? 429
              : 500;

  const text =
    status === 403 ? "你已经不在这个房间中"
    : status === 404 ? "没有找到这个房间"
    : status === 410 ? "房间已经关闭"
    : status === 400 ? "消息内容超出该模式的字数限制"
    : status === 402 ? "积分不足，无法发送"
    : status === 429 ? "发送太频繁，请稍后再试"
    : "聊天服务暂时不可用";

  return NextResponse.json({ error: text }, { status });
}

async function getGuestToken(code: string) {
  const cookieStore = await cookies();
  return cookieStore.get(`guest_room_${code}`)?.value ?? null;
}

export async function GET(
  _request: Request,
  { params }: MessageRouteContext,
) {
  const { code: rawCode } = await params;
  const code = rawCode.trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "房间码格式不正确" }, { status: 400 });
  }

  const supabase = await createClient();
  const { data, error } = await supabase.rpc("get_room_chat_bootstrap", {
    room_code: code,
    guest_token: await getGuestToken(code),
  });

  if (error) {
    return chatErrorResponse(error);
  }

  const bootstrap = data as RoomChatBootstrap;
  return NextResponse.json({ messages: bootstrap.messages.map(stripAuditField) });
}

export async function POST(
  request: Request,
  { params }: MessageRouteContext,
) {
  const { code: rawCode } = await params;
  const code = rawCode.trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "房间码格式不正确" }, { status: 400 });
  }

  const parsed = messageSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "消息内容超出该模式的字数限制" },
      { status: 400 },
    );
  }

  const { content, message_mode, use_personal_points } = parsed.data;

  const supabase = await createClient();
  const guestToken = await getGuestToken(code);
  const { data, error } = await supabase.rpc("send_room_chat_message", {
    room_code: code,
    message_content: content,
    guest_token: guestToken,
    message_mode,
    use_personal_points,
  });

  if (error) {
    return chatErrorResponse(error);
  }

  return NextResponse.json({ message: data as RoomMessage }, { status: 201 });
}
