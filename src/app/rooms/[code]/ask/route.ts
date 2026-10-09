import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { runRoomAiRequest, type AiRequestResult } from "@/lib/room-ai-runner";
import { createClient } from "@/lib/supabase/server";
import type { MessageMode } from "@/lib/types";
type AskRouteContext = { params: Promise<{ code: string }> };

const askSchema = z.object({
  content: z.string().trim().min(1),
  message_mode: z.enum(["ask", "hint", "reason"]),
  use_personal_points: z.boolean().default(false),
  expected_puzzle_id: z.number().int().positive().nullable().optional(),
});

const modeMaxLength: Record<Extract<MessageMode, "ask" | "hint" | "reason">, number> = {
  ask: 100,
  hint: 50,
  reason: 300,
};

function aiErrorResponse(error: { message: string }) {
  const msg = error.message;
  const status = msg.includes("room_membership_required")
    ? 403
    : msg.includes("room_not_found")
      ? 404
      : msg.includes("room_closed")
        ? 410
        : msg.includes("invalid_message")
          ? 400
          : msg.includes("insufficient_seat_points") || msg.includes("insufficient_points") || msg.includes("insufficient_hint_tokens")
            ? 402
            : msg.includes("rate_limited") || msg.includes("room_ai_busy")
              ? 429
              : msg.includes("no_active_puzzle")
                ? 409
                : 500;

  const text =
    status === 403 ? "你已经不在这个房间中"
    : status === 404 ? "没有找到这个房间"
    : status === 410 ? "房间已经关闭"
    : status === 400 ? "消息内容超出该模式的字数限制"
    : status === 402 ? (msg.includes("insufficient_hint_tokens") ? "没有可用的提示机会，提问 3 次或完成一次推理可获得" : "积分不足，无法发送")
    : status === 429 ? "AI 主持正在处理，请稍后再试"
    : status === 409 ? "需要先开始题目才能询问 AI"
    : "AI 主持暂时不可用";

  return NextResponse.json({ error: text }, { status });
}

async function getGuestToken(code: string) {
  const cookieStore = await cookies();
  return cookieStore.get(`guest_room_${code}`)?.value ?? null;
}

export async function POST(request: Request, { params }: AskRouteContext) {
  const { code: rawCode } = await params;
  const code = rawCode.trim().toUpperCase();

  if (!/^[A-Z0-9]{6}$/.test(code)) {
    return NextResponse.json({ error: "房间码格式不正确" }, { status: 400 });
  }

  const parsed = askSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "消息格式不正确" }, { status: 400 });
  }

  const { content, message_mode, use_personal_points, expected_puzzle_id } = parsed.data;
  if (content.length > modeMaxLength[message_mode]) {
    return NextResponse.json(
      { error: "消息内容超出该模式的字数限制" },
      { status: 400 },
    );
  }

  if (!process.env.DEEPSEEK_API_KEY || !process.env.SUPABASE_SECRET_KEY) {
    return NextResponse.json(
      { error: "AI 主持尚未配置，请联系管理员" },
      { status: 503 },
    );
  }

  const supabase = await createClient();
  const guestToken = await getGuestToken(code);
  const { data, error } = await supabase.rpc("send_room_ai_request", {
    room_code: code,
    message_content: content,
    guest_token: guestToken,
    message_mode,
    use_personal_points,
  });

  if (error) {
    return aiErrorResponse(error);
  }

  const requestResult = data as AiRequestResult;
  try {
    return await runRoomAiRequest(requestResult, code, content, message_mode, expected_puzzle_id);
  } catch {
    return NextResponse.json({ error: "请求结果或退款尚未确认，请稍后刷新房间查看" }, { status: 503 });
  }
}
