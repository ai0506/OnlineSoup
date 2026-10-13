import { z } from "zod";

const factIdSchema = z.string().regex(/^F[1-9]\d*$/);

export const puzzleFactSchema = z.object({
  id: factIdSchema,
  text: z.string().trim().min(1).max(120),
  kind: z.enum(["explicit", "derived"]),
  quote: z.string().trim().min(1).max(80).optional(),
  depends_on: z.array(factIdSchema).max(8).optional(),
  note: z.string().trim().max(160).optional(),
  status: z.enum(["draft", "approved", "needs_review"]),
});

export type PuzzleFact = z.infer<typeof puzzleFactSchema>;

export type PuzzleFactSource = {
  surface: string;
  bottom: string;
};

export type PuzzleFactValidation = {
  facts: PuzzleFact[];
  errors: string[];
  warnings: string[];
};

const EXCLUSION_PATTERN = /不是|而非|并非/;

/** Drops whitespace and punctuation so a verbatim quote still matches after minor formatting drift. */
export function normalizeEvidenceText(text: string) {
  return text.replace(/[\s\p{P}\p{S}]/gu, "");
}

export function isQuoteInSource(quote: string, source: PuzzleFactSource) {
  const needle = normalizeEvidenceText(quote);
  if (!needle) return false;
  return normalizeEvidenceText(source.bottom).includes(needle)
    || normalizeEvidenceText(source.surface).includes(needle);
}

function findCycle(facts: PuzzleFact[]) {
  const deps = new Map(facts.map((fact) => [fact.id, fact.depends_on ?? []]));
  const state = new Map<string, "visiting" | "done">();

  const visit = (id: string, path: string[]): string[] | null => {
    if (state.get(id) === "done") return null;
    if (state.get(id) === "visiting") return [...path.slice(path.indexOf(id)), id];
    state.set(id, "visiting");
    for (const next of deps.get(id) ?? []) {
      if (!deps.has(next)) continue;
      const cycle = visit(next, [...path, id]);
      if (cycle) return cycle;
    }
    state.set(id, "done");
    return null;
  };

  for (const fact of facts) {
    const cycle = visit(fact.id, []);
    if (cycle) return cycle;
  }
  return null;
}

export function validatePuzzleFacts(input: unknown, source: PuzzleFactSource): PuzzleFactValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (input === null || input === undefined) {
    return { facts: [], errors, warnings };
  }

  const parsed = z.array(z.unknown()).safeParse(input);
  if (!parsed.success) {
    return { facts: [], errors: ["facts 必须是数组"], warnings };
  }

  const facts: PuzzleFact[] = [];
  parsed.data.forEach((item, index) => {
    const result = puzzleFactSchema.safeParse(item);
    if (result.success) {
      facts.push(result.data);
    } else {
      errors.push(`第 ${index + 1} 条格式无效：${result.error.issues.map((issue) => issue.path.join(".") || issue.message).join("、")}`);
    }
  });

  const byId = new Map<string, PuzzleFact>();
  for (const fact of facts) {
    if (byId.has(fact.id)) errors.push(`${fact.id} 编号重复`);
    byId.set(fact.id, fact);
  }

  for (const fact of facts) {
    const deps = fact.depends_on ?? [];
    if (fact.kind === "explicit" && !fact.quote) {
      errors.push(`${fact.id} 为明说事实，缺少汤底原文 quote`);
    }
    if (fact.kind === "derived" && deps.length === 0) {
      errors.push(`${fact.id} 为推导事实，缺少 depends_on`);
    }
    if (fact.quote && !isQuoteInSource(fact.quote, source)) {
      errors.push(`${fact.id} 的 quote 在汤底和汤面中找不到`);
    }
    for (const dep of deps) {
      if (dep === fact.id) {
        errors.push(`${fact.id} 依赖自身`);
      } else if (!byId.has(dep)) {
        errors.push(`${fact.id} 依赖不存在的 ${dep}`);
      } else if (fact.status === "approved" && byId.get(dep)?.status !== "approved") {
        errors.push(`${fact.id} 已批准，但依赖的 ${dep} 未批准`);
      }
    }
    if (EXCLUSION_PATTERN.test(fact.text)) {
      warnings.push(`${fact.id} 含排除式表述（不是／而非／并非），Facts 应只陈述成立的内容`);
    }
  }

  const cycle = findCycle(facts);
  if (cycle) errors.push(`存在循环依赖：${cycle.join(" → ")}`);

  return { facts, errors, warnings };
}

/** Runtime selection: only a fully valid fact list contributes, and only its approved entries. */
export function getApprovedPuzzleFacts(input: unknown, source: PuzzleFactSource) {
  const { facts, errors } = validatePuzzleFacts(input, source);
  if (errors.length > 0) return [];
  return facts.filter((fact) => fact.status === "approved");
}

/** Derived facts keep their dependency IDs so the model can follow the chain; quotes and notes stay review-only. */
export function formatFactsForPrompt(facts: PuzzleFact[]) {
  if (facts.length === 0) return "None";
  return facts
    .map((fact) => fact.kind === "derived" && fact.depends_on?.length
      ? `${fact.id} [derived from ${fact.depends_on.join(", ")}] ${fact.text}`
      : `${fact.id} ${fact.text}`)
    .join("\n");
}
