import { z } from "zod";

import {
  buildAskV2Prompt,
  type ArbitrationMaterial,
  type AskV2Role,
} from "@/lib/ask-v2-prompts";
import type { PuzzleContext, PuzzleMessage } from "@/lib/deepseek";
import { isQuoteInSource, normalizeEvidenceText, type PuzzleFact } from "@/lib/puzzle-facts";

export type AskV2Purpose = "ask_v2_a" | "ask_v2_b1" | "ask_v2_arbitration";
export type AskV2Caller = (system: string, user: string, maxTokens: number, purpose: AskV2Purpose) => Promise<unknown>;

const ASK_V2_MAX_TOKENS = 320;

const answerTypeSchema = z.enum(["yes", "no", "irrelevant", "ambiguous"]);
const evidenceSchema = z.preprocess(
  (value) => value ?? [],
  z.array(z.string().trim().min(1).max(80)).max(3),
);
// Models often emit "" or null for a field that does not apply; treat that as absent.
const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);

const aResultSchema = z.object({
  proposition: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(200),
  answer_type: answerTypeSchema,
  irrelevant_reason: z.preprocess(emptyToUndefined, z.enum(["insufficient_evidence", "nonessential"]).optional()).catch(undefined),
});

const b1ResultSchema = z.object({
  proposition: z.string().trim().min(1).max(120),
  // B1 only weighs evidence; any wording problem it reports counts as "cannot be settled".
  verdict: z.preprocess(
    (value) => (value === "uninterpretable" ? "undetermined" : value),
    z.enum(["supported", "rejected", "undetermined"]),
  ),
  evidence: evidenceSchema,
  reason: z.string().trim().min(1).max(200),
}).refine(
  (value) => value.verdict === "undetermined" || value.evidence.length > 0,
  { message: "supported/rejected 需要证据" },
);

const arbitrationResultSchema = z.object({
  proposition: z.string().trim().min(1).max(120),
  reason: z.string().trim().min(1).max(200),
  answer_type: answerTypeSchema,
});

export type AskV2AnswerType = z.infer<typeof answerTypeSchema>;
export type AskV2AResult = z.infer<typeof aResultSchema>;
export type AskV2B1Result = z.infer<typeof b1ResultSchema>;
export type AskV2ArbitrationResult = z.infer<typeof arbitrationResultSchema>;

export class AskV2Error extends Error {
  constructor(
    readonly stage: AskV2Role,
    readonly code: "call_failed" | "invalid_output" | "invalid_evidence",
    message: string,
  ) {
    super(message);
    this.name = "AskV2Error";
  }
}

export type AskV2Route = "b1_agree" | "b1_conflict" | "ambiguous_direct";

type StageAudit<T> = { result: T; elapsed_ms: number };

export type AskV2Audit = {
  version: 2;
  route: AskV2Route;
  a: StageAudit<AskV2AResult>;
  b1:
    | (StageAudit<AskV2B1Result> & { used: boolean })
    | { status: "failed" | "pending"; used: false; error?: string };
  arbitration?: StageAudit<AskV2ArbitrationResult>;
  final: { answer_type: AskV2AnswerType; source: "a" | "arbitration" };
};

export type AskV2Result = {
  answerType: AskV2AnswerType;
  /** Only an A yes/no confirmed by an independent B1 evidence check may enter the cache or shared facts. */
  cacheEligible: boolean;
  audit: AskV2Audit;
};

/** Decision table: A's label against B1's independent evidence verdict. */
export function decideAfterB1(answer: "yes" | "no" | "irrelevant", verdict: AskV2B1Result["verdict"]) {
  if (answer === "yes" && verdict === "supported") return "keep" as const;
  if (answer === "no" && verdict === "rejected") return "keep" as const;
  if (answer === "irrelevant" && verdict === "undetermined") return "keep" as const;
  return "arbitrate" as const;
}

/** A citation must be a provided fact (by ID or by its wording) or a verbatim fragment of the story. */
export function findInvalidEvidence(evidence: string[], facts: PuzzleFact[], puzzle: PuzzleContext) {
  const factIds = new Set(facts.map((fact) => fact.id));
  const factTexts = facts.map((fact) => normalizeEvidenceText(fact.text));
  return evidence.filter((item) => {
    const trimmed = item.trim();
    if (/^F\d+$/.test(trimmed)) return !factIds.has(trimmed);
    const normalized = normalizeEvidenceText(trimmed);
    if (normalized && factTexts.some((text) => text.includes(normalized))) return false;
    return !isQuoteInSource(trimmed, puzzle);
  });
}

const purposeByRole: Record<AskV2Role, AskV2Purpose> = {
  a: "ask_v2_a",
  b1: "ask_v2_b1",
  arbitration: "ask_v2_arbitration",
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function runAskV2({
  caller,
  puzzle,
  facts,
  question,
  puzzleMessages,
}: {
  caller: AskV2Caller;
  puzzle: PuzzleContext;
  facts: PuzzleFact[];
  question: string;
  puzzleMessages: PuzzleMessage[];
}): Promise<AskV2Result> {
  async function runStage<T>(
    role: AskV2Role,
    schema: z.ZodType<T>,
    material?: ArbitrationMaterial,
  ): Promise<StageAudit<T>> {
    const prompt = buildAskV2Prompt({ role, puzzle, facts, question, puzzleMessages, material });
    const startedAt = Date.now();
    let raw: unknown;
    try {
      raw = await caller(prompt.system, prompt.user, ASK_V2_MAX_TOKENS, purposeByRole[role]);
    } catch (error) {
      throw new AskV2Error(role, "call_failed", errorMessage(error));
    }
    const parsed = schema.safeParse(raw);
    if (!parsed.success) {
      throw new AskV2Error(role, "invalid_output", parsed.error.issues.map((issue) => issue.message).join("; "));
    }
    const evidence = (parsed.data as { evidence?: string[] }).evidence;
    if (evidence) {
      const invalid = findInvalidEvidence(evidence, facts, puzzle);
      if (invalid.length > 0) {
        throw new AskV2Error(role, "invalid_evidence", `无效引用：${invalid.join(" | ")}`);
      }
    }
    return { result: parsed.data, elapsed_ms: Date.now() - startedAt };
  }

  // B1 never sees A's output, so both start together; B1 is only ignored when A finds the question ambiguous.
  let b1State: AskV2Audit["b1"] = { status: "pending", used: false };
  const b1Settled = runStage("b1", b1ResultSchema).then(
    (stage) => {
      b1State = { ...stage, used: false };
      return { ok: true as const, stage };
    },
    (error: unknown) => {
      b1State = { status: "failed", used: false, error: errorMessage(error) };
      return { ok: false as const, error };
    },
  );

  const a = await runStage("a", aResultSchema);
  const answer = a.result.answer_type;

  if (answer === "ambiguous") {
    return {
      answerType: "ambiguous",
      cacheEligible: false,
      audit: { version: 2, route: "ambiguous_direct", a, b1: b1State, final: { answer_type: "ambiguous", source: "a" } },
    };
  }

  const b1 = await b1Settled;
  if (!b1.ok) throw b1.error;
  const b1Audit = { ...b1.stage, used: true };

  if (decideAfterB1(answer, b1.stage.result.verdict) === "keep") {
    return {
      answerType: answer,
      cacheEligible: answer !== "irrelevant",
      audit: { version: 2, route: "b1_agree", a, b1: b1Audit, final: { answer_type: answer, source: "a" } },
    };
  }

  const arbitration = await runStage("arbitration", arbitrationResultSchema, {
    a: a.result,
    b1: b1.stage.result,
  });
  return {
    answerType: arbitration.result.answer_type,
    cacheEligible: false,
    audit: {
      version: 2,
      route: "b1_conflict",
      a,
      b1: b1Audit,
      arbitration,
      final: { answer_type: arbitration.result.answer_type, source: "arbitration" },
    },
  };
}
