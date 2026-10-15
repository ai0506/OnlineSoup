// 管理端消息审计：把 AI 消息 content 中的各版本审计结构统一解析成展示用数据。
// 只在管理端使用；玩家侧输出在写入前已剥离这些字段。

export type AuditAnswerType = "yes" | "no" | "irrelevant" | "ambiguous" | string;

export type ReasoningCoverage = {
  id: number;
  text?: string;
  covered: boolean;
};

export type AskCacheHit = {
  entryId: number;
  questionText: string;
  normalizedQuestion: string | null;
  answerType: string;
  matchType: "exact" | "equivalent" | "unknown";
};

export type AskV1AuditEntry = {
  label: string;
  answerType: string;
  text: string;
  factSummary: string | null;
  reason: string | null;
};

export type AskV2Stage = {
  proposition: string | null;
  answerType: string | null;
  reason: string | null;
  elapsedMs: number | null;
};

export type AskV2B1 =
  | (AskV2Stage & { status: "done"; verdict: string | null; evidence: string[]; used: boolean })
  | { status: "failed" | "pending"; error: string | null };

export type AskAudit =
  | { kind: "none" }
  | { kind: "truncated" }
  | {
      kind: "v2";
      route: "b1_agree" | "b1_conflict" | "ambiguous_direct" | string;
      a: AskV2Stage | null;
      b1: AskV2B1 | null;
      arbitration: AskV2Stage | null;
      finalAnswerType: string | null;
      finalSource: "a" | "arbitration" | string | null;
    }
  | {
      kind: "v1";
      entries: AskV1AuditEntry[];
      usedArbitration: boolean;
      v2Failure: { stage: string | null; code: string } | null;
    };

export type AskAnswerDetails = {
  text: string;
  factSummary: string | null;
  factSummarySource: "glm" | "deepseek" | "unknown";
  cacheHit: AskCacheHit | null;
  audit: AskAudit;
};

export type AuditVerdict = {
  label: string;
  tone: "ok" | "warn" | "info" | "muted";
};

export const answerTypeLabels: Record<string, string> = {
  yes: "是",
  no: "否",
  irrelevant: "与此无关",
  ambiguous: "模糊问题",
};

export const b1VerdictLabels: Record<string, string> = {
  supported: "支持",
  rejected: "否定",
  undetermined: "无法判定",
};

export const v2RouteLabels: Record<string, string> = {
  b1_agree: "B1 一致",
  b1_conflict: "冲突→仲裁",
  ambiguous_direct: "模糊直出",
};

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : null;
}

function asNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseMessageJson(content: string): Record<string, unknown> | null {
  if (!content.startsWith("{")) return null;
  try {
    return asRecord(JSON.parse(content));
  } catch {
    return null;
  }
}

function parseV2Stage(value: unknown): AskV2Stage | null {
  const stage = asRecord(value);
  const result = asRecord(stage?.result);
  if (!stage || !result) return null;
  return {
    proposition: asString(result.proposition),
    answerType: asString(result.answer_type),
    reason: asString(result.reason),
    elapsedMs: asNumber(stage.elapsed_ms),
  };
}

function parseV2B1(value: unknown): AskV2B1 | null {
  const b1 = asRecord(value);
  if (!b1) return null;
  if (b1.status === "failed" || b1.status === "pending") {
    return { status: b1.status, error: asString(b1.error) };
  }
  const result = asRecord(b1.result);
  if (!result) return null;
  return {
    status: "done",
    used: b1.used === true,
    proposition: asString(result.proposition),
    answerType: null,
    reason: asString(result.reason),
    elapsedMs: asNumber(b1.elapsed_ms),
    verdict: asString(result.verdict),
    evidence: Array.isArray(result.evidence)
      ? result.evidence.filter((item): item is string => typeof item === "string")
      : [],
  };
}

function parseAudit(value: unknown): AskAudit {
  const audit = asRecord(value);
  if (!audit) return { kind: "none" };
  if (audit.truncated === true) return { kind: "truncated" };

  if (audit.version === 2) {
    const final = asRecord(audit.final);
    return {
      kind: "v2",
      route: asString(audit.route) ?? "unknown",
      a: parseV2Stage(audit.a),
      b1: parseV2B1(audit.b1),
      arbitration: parseV2Stage(audit.arbitration),
      finalAnswerType: asString(final?.answer_type),
      finalSource: asString(final?.source),
    };
  }

  const labels: Array<[string, string]> = [
    ["strict", "严格"],
    ["inferential", "推断"],
    ["final", "仲裁"],
  ];
  const entries = labels
    .map(([key, label]): AskV1AuditEntry | null => {
      const record = asRecord(audit[key]);
      if (!record) return null;
      const answerType = asString(record.answer_type);
      const text = asString(record.text);
      if (!answerType || !text) return null;
      return {
        label,
        answerType,
        text,
        factSummary: asString(record.fact_summary),
        reason: asString(record.reason),
      };
    })
    .filter((item): item is AskV1AuditEntry => item !== null);

  const failure = asRecord(audit.v2_failure);
  return {
    kind: "v1",
    entries,
    usedArbitration: entries.some((item) => item.label === "仲裁"),
    v2Failure: failure
      ? { stage: asString(failure.stage), code: asString(failure.code) ?? "unexpected" }
      : null,
  };
}

function parseCacheHit(value: unknown): AskCacheHit | null {
  const record = asRecord(value);
  if (!record) return null;
  const entryId =
    asNumber(record.entry_id) ?? Number.parseInt(String(record.entry_id ?? ""), 10);
  const questionText = asString(record.question_text);
  const answerType = asString(record.answer_type);
  if (!Number.isFinite(entryId) || !questionText || !answerType) return null;
  return {
    entryId,
    questionText,
    normalizedQuestion: asString(record.normalized_question),
    answerType,
    matchType:
      record.match_type === "exact" || record.match_type === "equivalent"
        ? record.match_type
        : "unknown",
  };
}

export function getAskAnswerDetails(content: string): AskAnswerDetails | null {
  const parsed = parseMessageJson(content);
  if (!parsed || parsed.kind !== "answer" || typeof parsed.text !== "string") {
    return null;
  }
  return {
    text: parsed.text,
    factSummary: asString(parsed.fact_summary),
    factSummarySource:
      parsed.fact_summary_source === "glm" || parsed.fact_summary_source === "deepseek"
        ? parsed.fact_summary_source
        : "unknown",
    cacheHit: parseCacheHit(parsed.cache_hit),
    audit: parseAudit(parsed.ask_audit),
  };
}

export function getReasoningCoverage(content: string): ReasoningCoverage[] {
  const parsed = parseMessageJson(content);
  if (!parsed || parsed.kind !== "reasoning_result" || !Array.isArray(parsed.coverage)) {
    return [];
  }
  return parsed.coverage
    .map((item): ReasoningCoverage | null => {
      const record = asRecord(item);
      if (!record || typeof record.covered !== "boolean") return null;
      const id = asNumber(record.id) ?? Number.parseInt(String(record.id ?? ""), 10);
      if (!Number.isFinite(id)) return null;
      return {
        id,
        covered: record.covered,
        text: asString(record.text) ?? undefined,
      };
    })
    .filter((item): item is ReasoningCoverage => item !== null);
}

/** 列表里一行展示用的正文：结构化消息取 text 字段，其余原样 */
export function getMessagePreview(content: string) {
  const parsed = parseMessageJson(content);
  if (!parsed) return content;
  const text = asString(parsed.text);
  if (text) return text;
  const actor = `${asString(parsed.actor_name) ?? "?"}[${asNumber(parsed.actor_seat) ?? "?"}]`;
  const target = `${asString(parsed.target_name) ?? "?"}[${asNumber(parsed.target_seat) ?? "?"}]`;
  if (parsed.kind === "points_gifted") {
    return `${actor} 赠送了 ${asNumber(parsed.amount) ?? "?"} 积分给 ${target}`;
  }
  if (parsed.kind === "seat_moved") {
    return `${actor} 把 ${target} 移到了 ${asNumber(parsed.to_seat) ?? "?"} 号位`;
  }
  return content;
}

export function getAskVerdict(details: AskAnswerDetails): AuditVerdict {
  if (details.cacheHit) {
    return {
      label: details.cacheHit.matchType === "equivalent" ? "缓存·等价" : "缓存命中",
      tone: "info",
    };
  }
  const { audit } = details;
  switch (audit.kind) {
    case "v2":
      if (audit.b1?.status === "failed") return { label: "B1 失败", tone: "warn" };
      return {
        label: v2RouteLabels[audit.route] ?? audit.route,
        tone: audit.route === "b1_conflict" ? "warn" : audit.route === "b1_agree" ? "ok" : "muted",
      };
    case "v1":
      if (audit.v2Failure) return { label: "v2 失败→v1", tone: "warn" };
      if (audit.entries.length === 0) return { label: "无审计", tone: "muted" };
      return audit.usedArbitration
        ? { label: "v1 已仲裁", tone: "warn" }
        : { label: "v1 两路一致", tone: "ok" };
    case "truncated":
      return { label: "审计过长", tone: "muted" };
    default:
      return { label: "无审计", tone: "muted" };
  }
}
