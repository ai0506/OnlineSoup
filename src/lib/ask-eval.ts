import { z } from "zod";

import { AskV2Error, runAskV2 } from "@/lib/ask-v2";
import {
  askDeepSeekHost,
  createAskV2DeepSeekCaller,
  requestFactSummary,
} from "@/lib/deepseek";
import { validatePuzzleFacts } from "@/lib/puzzle-facts";

export const askEvalRequestSchema = z.object({
  engine: z.enum(["old", "new"]),
  puzzle: z.object({
    title: z.string().trim().min(1).max(100),
    surface: z.string().trim().min(1).max(4000),
    bottom: z.string().trim().min(1).max(4000),
    key_points: z.unknown().optional(),
    examples: z.unknown().optional(),
  }),
  facts: z.unknown().optional(),
  question: z.string().trim().min(1).max(100),
  history: z.array(z.object({
    sender_name: z.string().max(40),
    message_type: z.enum(["chat", "ai", "system"]),
    message_mode: z.enum(["chat", "ask", "hint", "reason"]),
    content: z.string().max(4000),
  })).max(60).default([]),
});

export type AskEvalRequest = z.infer<typeof askEvalRequestSchema>;

type UsageEntry = Record<string, unknown>;

export type AskEvalResponse = {
  engine: AskEvalRequest["engine"];
  answerType: string | null;
  cacheEligible: boolean;
  elapsedMs: number;
  judgeElapsedMs: number;
  factSummaryMs: number | null;
  fallbackUsed: boolean;
  audit: unknown;
  usage: UsageEntry[];
  error: { stage: string | null; code: string; message: string } | null;
};

function errorCategory(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const httpStatus = message.match(/请求失败：(\d{3})/)?.[1];
  if (httpStatus) return `http_${httpStatus}`;
  if (/截断/.test(message)) return "output_truncated";
  if (/超时|abort/i.test(message)) return "timeout";
  if (/JSON/.test(message)) return "json_parse";
  if (/没有返回内容/.test(message)) return "empty_content";
  return "provider_error";
}

/**
 * Captures the existing `[ai-usage]` / `[ai-fallback]` logs for one evaluation request.
 * Only for the internal evaluation tool, which runs one case per request.
 */
async function withUsageCapture<T>(run: () => Promise<T>) {
  const usage: UsageEntry[] = [];
  let fallbackUsed = false;
  const original = console.info;
  console.info = (...args: unknown[]) => {
    if (args[0] === "[ai-usage]" && args[1] && typeof args[1] === "object") {
      usage.push(args[1] as UsageEntry);
    } else if (args[0] === "[ai-fallback] GLM host used") {
      fallbackUsed = true;
    }
    original(...args);
  };
  try {
    const value = await run();
    return { value, usage, fallbackUsed };
  } finally {
    console.info = original;
  }
}

export async function runAskEvalCase(input: AskEvalRequest): Promise<AskEvalResponse> {
  const startedAt = Date.now();
  const factCheck = validatePuzzleFacts(input.facts, input.puzzle);
  if (factCheck.errors.length > 0) {
    throw new Error(`Facts 校验失败：${factCheck.errors.join("；")}`);
  }

  let judgeElapsedMs = 0;
  let factSummaryMs: number | null = null;
  const captured = await withUsageCapture(async () => {
    if (input.engine === "old") {
      // Old engine awaits its own fact summary inside askDeepSeekHost, as in production.
      const result = await askDeepSeekHost({
        mode: "ask",
        puzzle: input.puzzle,
        content: input.question,
        puzzleMessages: input.history,
      });
      judgeElapsedMs = Date.now() - startedAt;
      if (typeof result === "string") throw new Error("ask 返回格式异常");
      const payload = JSON.parse(result.content) as { ask_audit?: unknown };
      return { answerType: result.answerType, cacheEligible: result.cacheEligible, audit: payload.ask_audit ?? null };
    }

    const result = await runAskV2({
      caller: createAskV2DeepSeekCaller(),
      puzzle: input.puzzle,
      facts: factCheck.facts,
      question: input.question,
      puzzleMessages: input.history,
    });
    judgeElapsedMs = Date.now() - startedAt;
    // Mirror the production path: a confirmed yes/no still waits for its shared-fact summary.
    if (result.cacheEligible && (result.answerType === "yes" || result.answerType === "no")) {
      const summaryStartedAt = Date.now();
      await requestFactSummary(process.env.DEEPSEEK_API_KEY!, input.question, result.answerType, []).catch(() => null);
      factSummaryMs = Date.now() - summaryStartedAt;
    }
    return { answerType: result.answerType, cacheEligible: result.cacheEligible, audit: result.audit };
  }).catch((error: unknown) => ({ error }));

  if ("error" in captured) {
    const error = captured.error;
    return {
      engine: input.engine,
      answerType: null,
      cacheEligible: false,
      elapsedMs: Date.now() - startedAt,
      judgeElapsedMs: Date.now() - startedAt,
      factSummaryMs: null,
      fallbackUsed: false,
      audit: null,
      usage: [],
      error: error instanceof AskV2Error
        ? { stage: error.stage, code: error.code, message: error.code === "call_failed" ? errorCategory(error) : error.message }
        : { stage: null, code: errorCategory(error), message: errorCategory(error) },
    };
  }

  return {
    engine: input.engine,
    answerType: captured.value.answerType,
    cacheEligible: captured.value.cacheEligible,
    elapsedMs: Date.now() - startedAt,
    judgeElapsedMs,
    factSummaryMs,
    fallbackUsed: captured.fallbackUsed,
    audit: captured.value.audit,
    usage: captured.usage,
    error: null,
  };
}
