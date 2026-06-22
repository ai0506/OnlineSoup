import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";

import { askDeepSeekHost, extractKnownFacts, requestFactSummary } from "@/lib/deepseek";
import {
  checkCacheHit,
  fetchPuzzleQaCache,
  isCacheWorthy,
  normalizeQuestion,
  recordCacheHit,
  saveToPuzzleQaCache,
} from "@/lib/qa-cache";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { MessageMode, RoomMessage } from "@/lib/types";

type AskRouteContext = {
  params: Promise<{ code: string }>;
};

type AiRequestResult = {
  message: RoomMessage;
  request_id: number;
  room_id: string;
  puzzle_id: number;
};

type PuzzleRow = {
  title: string;
  surface: string;
  bottom: string;
  key_points: unknown;
  examples: unknown;
};

type RecentMessageRow = Pick<
  RoomMessage,
  "sender_name" | "message_type" | "message_mode" | "content"
>;

const askSchema = z.object({
  content: z.string().trim().min(1),
  message_mode: z.enum(["ask", "hint", "reason"]),
  use_personal_points: z.boolean().default(false),
  expected_puzzle_id: z.number().int().positive().nullable().optional(),
});

const modeMaxLength: Record<Extract<MessageMode, "ask" | "hint" | "reason">, number> = {
  ask: 50,
  hint: 50,
  reason: 200,
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

function puzzleChangedResponse() {
  return NextResponse.json(
    { error: "题目已经变化，本次 AI 请求已取消并退回积分，请刷新后重试" },
    { status: 409 },
  );
}

async function refundAiRequest(requestId: number) {
  const admin = createAdminClient();
  await admin.rpc("finish_room_ai_request", {
    request_message_id: requestId,
    ai_content: "",
    is_success: false,
  });
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
  const admin = createAdminClient();

  const { data: roomState, error: roomStateError } = await admin
    .from("rooms")
    .select("current_puzzle_id")
    .eq("id", requestResult.room_id)
    .maybeSingle();

  if (
    roomStateError ||
    !roomState ||
    roomState.current_puzzle_id !== requestResult.puzzle_id ||
    (expected_puzzle_id != null && expected_puzzle_id !== requestResult.puzzle_id)
  ) {
    await refundAiRequest(requestResult.request_id);
    return puzzleChangedResponse();
  }

  const { data: puzzle, error: puzzleError } = await admin
    .from("puzzles")
    .select("title, surface, bottom, key_points, examples")
    .eq("id", requestResult.puzzle_id)
    .maybeSingle();

  if (puzzleError || !puzzle) {
    await refundAiRequest(requestResult.request_id);
    return NextResponse.json(
      { error: "题目数据暂时不可用，已退回本次积分" },
      { status: 500 },
    );
  }

  // Scoped to this puzzle (not just this room) so a puzzle switch can't leak
  // facts/hints from a previous puzzle into the prompt, and capped generously
  // so known facts and given hints can be extracted from the puzzle's full
  // history rather than just the last couple of exchanges.
  const { data: puzzleMessages, error: puzzleMessagesError } = await admin
    .from("room_messages")
    .select("sender_name, message_type, message_mode, content")
    .eq("room_id", requestResult.room_id)
    .eq("puzzle_id", requestResult.puzzle_id)
    .order("created_at", { ascending: false })
    .order("id", { ascending: false })
    .limit(60);

  if (puzzleMessagesError) {
    // Non-fatal: the AI host still works without context, just with no
    // known facts / recent messages / given hints, so log and continue
    // instead of failing the whole request.
    console.error("Failed to load puzzle messages for AI context", {
      roomCode: code,
      mode: message_mode,
      message: puzzleMessagesError.message,
    });
  }

  const reversedMessages = ((puzzleMessages ?? []) as RecentMessageRow[]).reverse();

  let aiContent = "";
  try {
    if (message_mode === "ask") {
      // --- Q&A cache check ---
      const zhipuKey = process.env.ZHIPU_API_KEY;
      const normalizedQ = normalizeQuestion(content);
      const knownFacts = extractKnownFacts(reversedMessages);
      let cacheHit = false;

      if (zhipuKey) {
        const cacheEntries = await fetchPuzzleQaCache(admin, requestResult.puzzle_id);
        const hit = cacheEntries.length > 0
          ? await checkCacheHit(normalizedQ, content, cacheEntries, zhipuKey)
          : null;

        if (hit) {
          console.info("[qa-cache] hit", { puzzleId: requestResult.puzzle_id, entryId: hit.id, answerType: hit.answer_type });
          cacheHit = true;
          void recordCacheHit(admin, hit.id);
          const factSummary = (hit.answer_type === "yes" || hit.answer_type === "no")
            ? await requestFactSummary(process.env.DEEPSEEK_API_KEY!, content, hit.answer_type, knownFacts)
            : null;
          const answerLabel: Record<string, string> = { yes: "是", no: "否", irrelevant: "与此无关", ambiguous: "模糊问题" };
          aiContent = JSON.stringify({
            kind: "answer",
            text: answerLabel[hit.answer_type],
            fact_summary: factSummary?.fact ?? null,
            fact_summary_source: factSummary ? factSummary.source : null,
            ask_audit: null,
            cache_hit: {
              entry_id: hit.id,
              question_text: hit.question_text,
              normalized_question: hit.normalized_question,
              answer_type: hit.answer_type,
              match_type: hit.match_type,
            },
          });
        }
      }

      if (!cacheHit) {
        // No cache hit — call DeepSeek
        const result = await askDeepSeekHost({
          mode: message_mode,
          puzzle: puzzle as PuzzleRow,
          content,
          puzzleMessages: reversedMessages,
        });
        if (typeof result === "string") {
          aiContent = result;
        } else {
          aiContent = result.content;
          // Save to cache only on high-confidence (strict===inferential) answers
          if (result.cacheEligible && zhipuKey && isCacheWorthy(content, result.answerType)) {
            void saveToPuzzleQaCache(admin, requestResult.puzzle_id, content, normalizedQ, result.answerType);
          }
        }
      }
    } else {
      const result = await askDeepSeekHost({
        mode: message_mode,
        puzzle: puzzle as PuzzleRow,
        content,
        puzzleMessages: reversedMessages,
      });
      aiContent = typeof result === "string" ? result : result.content;
    }
  } catch (err) {
    console.error("DeepSeek host failed", {
      roomCode: code,
      mode: message_mode,
      message: err instanceof Error ? err.message : String(err),
    });
    await refundAiRequest(requestResult.request_id);
    return NextResponse.json(
      { error: "AI 主持暂时没有回应，已退回本次积分" },
      { status: 502 },
    );
  }

  const { data: latestRoomState, error: latestRoomStateError } = await admin
    .from("rooms")
    .select("current_puzzle_id")
    .eq("id", requestResult.room_id)
    .maybeSingle();

  if (
    latestRoomStateError ||
    !latestRoomState ||
    latestRoomState.current_puzzle_id !== requestResult.puzzle_id
  ) {
    await refundAiRequest(requestResult.request_id);
    return puzzleChangedResponse();
  }

  const { data: aiMessage, error: finishError } = await admin.rpc(
    "finish_room_ai_request",
    {
      request_message_id: requestResult.request_id,
      ai_content: aiContent,
      is_success: true,
    },
  );

  if (finishError || !aiMessage) {
    await refundAiRequest(requestResult.request_id).catch(() => undefined);
    return NextResponse.json(
      { error: "AI 回复写入失败，已尝试退回本次积分" },
      { status: 500 },
    );
  }

  const aiMessageForPlayer = (() => {
    const msg = aiMessage as RoomMessage;
    if (msg.message_type !== "ai") return msg;
    try {
      const parsed = JSON.parse(msg.content) as Record<string, unknown>;
      if ("ask_audit" in parsed) {
        delete parsed.ask_audit;
        return { ...msg, content: JSON.stringify(parsed) };
      }
    } catch { /* not JSON */ }
    return msg;
  })();

  return NextResponse.json(
    {
      message: requestResult.message,
      aiMessage: aiMessageForPlayer,
    },
    { status: 201 },
  );
}
