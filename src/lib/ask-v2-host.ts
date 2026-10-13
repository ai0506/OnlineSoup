import { AskV2Error, runAskV2 } from "@/lib/ask-v2";
import {
  askDeepSeekHost,
  createAskV2DeepSeekCaller,
  requestFactSummary,
  type AskCrossCheckResult,
  type PuzzleContext,
  type PuzzleMessage,
} from "@/lib/deepseek";
import type { PuzzleFact } from "@/lib/puzzle-facts";

const answerLabel = { yes: "是", no: "否", irrelevant: "与此无关", ambiguous: "模糊问题" } as const;

export type AskEngine = "v1" | "v2";

export function getAskEngine(): AskEngine {
  return process.env.ASK_ENGINE === "v2" ? "v2" : "v1";
}

export type AskV2HostResult = AskCrossCheckResult & { engine: "v2" | "v1_fallback" };

/**
 * Production entry for ask engine v2. If v2 cannot finish its own verification, the
 * request is answered by the existing v1 engine instead of being refunded; that answer
 * is never cached and its audit records why v2 was skipped.
 */
export async function askV2Host({
  puzzle,
  facts,
  content,
  puzzleMessages,
}: {
  puzzle: PuzzleContext;
  facts: PuzzleFact[];
  content: string;
  puzzleMessages: PuzzleMessage[];
}): Promise<AskV2HostResult> {
  try {
    const result = await runAskV2({
      caller: createAskV2DeepSeekCaller(),
      puzzle,
      facts,
      question: content,
      puzzleMessages,
    });
    const factSummary = result.cacheEligible && (result.answerType === "yes" || result.answerType === "no")
      ? await requestFactSummary(process.env.DEEPSEEK_API_KEY!, content, result.answerType, []).catch(() => null)
      : null;
    return {
      content: JSON.stringify({
        kind: "answer",
        text: answerLabel[result.answerType],
        fact_summary: factSummary?.fact ?? null,
        fact_summary_source: factSummary ? factSummary.source : null,
        ask_audit: result.audit,
      }),
      cacheEligible: result.cacheEligible,
      answerType: result.answerType,
      engine: "v2",
    };
  } catch (error) {
    const failure = error instanceof AskV2Error
      ? { stage: error.stage, code: error.code }
      : { stage: null, code: "unexpected" };
    console.error("[ask-v2] falling back to v1", failure);

    const fallback = await askDeepSeekHost({ mode: "ask", puzzle, content, puzzleMessages });
    if (typeof fallback === "string") throw new Error("ask 返回格式异常");
    const payload = JSON.parse(fallback.content) as { ask_audit?: Record<string, unknown> | null };
    payload.ask_audit = { ...(payload.ask_audit ?? {}), v2_failure: failure };
    return {
      content: JSON.stringify(payload),
      cacheEligible: false,
      answerType: fallback.answerType,
      engine: "v1_fallback",
    };
  }
}
