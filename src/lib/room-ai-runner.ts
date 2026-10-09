import { NextResponse } from "next/server";

import { askDeepSeekHost, requestFactSummary } from "@/lib/deepseek";
import {
  checkCacheHit,
  fetchPuzzleQaCache,
  isCacheWorthy,
  normalizeQuestion,
  recordCacheHit,
  saveToPuzzleQaCache,
} from "@/lib/qa-cache";
import { sanitizeRoomMessageForPlayer } from "@/lib/room-message";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MessageMode, RoomMessage } from "@/lib/types";

export type AiRequestResult = {
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

function puzzleChangedResponse() {
  return NextResponse.json(
    { error: "题目已经变化，本次 AI 请求已取消并退回积分，请刷新后重试" },
    { status: 409 },
  );
}

async function refundAiRequest(requestId: number) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("finish_room_ai_request", {
    request_message_id: requestId,
    ai_content: "",
    is_success: false,
  });
  if (error) throw new Error("AI_REFUND_UNCONFIRMED");
}

export async function runRoomAiRequest(requestResult: AiRequestResult, code: string, content: string,
  message_mode: Extract<MessageMode, "ask" | "hint" | "reason">, expected_puzzle_id?: number | null) {
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
      let cacheHit = false;

      {
        const cacheEntries = await fetchPuzzleQaCache(admin, requestResult.puzzle_id);
        const hit = cacheEntries.length > 0
          ? await checkCacheHit(normalizedQ, content, cacheEntries, zhipuKey)
          : null;

        if (hit) {
          console.info("[qa-cache] hit", { puzzleId: requestResult.puzzle_id, entryId: hit.id, answerType: hit.answer_type });
          cacheHit = true;
          await recordCacheHit(admin, hit.id);
          const factSummary = (hit.answer_type === "yes" || hit.answer_type === "no")
            ? await requestFactSummary(process.env.DEEPSEEK_API_KEY!, content, hit.answer_type, [])
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
          const answerType = result.answerType;
          if (
            result.cacheEligible &&
            (answerType === "yes" || answerType === "no") &&
            isCacheWorthy(content, answerType)
          ) {
            await saveToPuzzleQaCache(admin, requestResult.puzzle_id, content, normalizedQ, answerType);
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

  const aiMessageForPlayer = sanitizeRoomMessageForPlayer(aiMessage as RoomMessage);

  return NextResponse.json(
    {
      message: requestResult.message,
      aiMessage: aiMessageForPlayer,
    },
    { status: 201 },
  );
}
