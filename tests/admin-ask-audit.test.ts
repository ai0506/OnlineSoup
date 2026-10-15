import { describe, expect, it } from "vitest";

import {
  getAskAnswerDetails,
  getAskVerdict,
  getMessagePreview,
  getReasoningCoverage,
} from "@/lib/admin-ask-audit";

const answer = (extra: Record<string, unknown>) =>
  JSON.stringify({ kind: "answer", text: "否", ...extra });

describe("getAskAnswerDetails", () => {
  it("parses a v2 audit with B1 evidence", () => {
    const details = getAskAnswerDetails(
      answer({
        fact_summary: "他不是因为鼓掌",
        fact_summary_source: "glm",
        ask_audit: {
          version: 2,
          route: "b1_agree",
          a: { result: { proposition: "P", answer_type: "no", reason: "R" }, elapsed_ms: 975 },
          b1: {
            used: true,
            result: { proposition: "P2", verdict: "rejected", evidence: ["F11", "F9"], reason: "R2" },
            elapsed_ms: 943,
          },
          final: { answer_type: "no", source: "a" },
        },
      }),
    );

    expect(details?.factSummarySource).toBe("glm");
    expect(details?.audit.kind).toBe("v2");
    if (details?.audit.kind !== "v2") throw new Error("expected v2");
    expect(details.audit.a).toMatchObject({ proposition: "P", answerType: "no", elapsedMs: 975 });
    expect(details.audit.b1).toMatchObject({ status: "done", verdict: "rejected", evidence: ["F11", "F9"] });
    expect(details.audit.finalSource).toBe("a");
    expect(getAskVerdict(details)).toEqual({ label: "B1 一致", tone: "ok" });
  });

  it("marks a v2 conflict that went to arbitration", () => {
    const details = getAskAnswerDetails(
      answer({
        ask_audit: {
          version: 2,
          route: "b1_conflict",
          a: { result: { answer_type: "yes" }, elapsed_ms: 1 },
          b1: { used: true, result: { verdict: "rejected", evidence: ["F1"] }, elapsed_ms: 1 },
          arbitration: { result: { proposition: "P", reason: "R", answer_type: "no" }, elapsed_ms: 2 },
          final: { answer_type: "no", source: "arbitration" },
        },
      }),
    );
    if (details?.audit.kind !== "v2") throw new Error("expected v2");
    expect(details.audit.arbitration?.answerType).toBe("no");
    expect(getAskVerdict(details)).toEqual({ label: "冲突→仲裁", tone: "warn" });
  });

  it("keeps pending B1 for ambiguous questions", () => {
    const details = getAskAnswerDetails(
      answer({
        ask_audit: {
          version: 2,
          route: "ambiguous_direct",
          a: { result: { answer_type: "ambiguous" }, elapsed_ms: 1 },
          b1: { used: false, status: "pending" },
          final: { answer_type: "ambiguous", source: "a" },
        },
      }),
    );
    if (details?.audit.kind !== "v2") throw new Error("expected v2");
    expect(details.audit.b1).toEqual({ status: "pending", error: null });
    expect(getAskVerdict(details).label).toBe("模糊直出");
  });

  it("does not report a legacy message without audit as agreement", () => {
    const details = getAskAnswerDetails(answer({}));
    expect(details?.audit.kind).toBe("none");
    expect(getAskVerdict(details!)).toEqual({ label: "无审计", tone: "muted" });
  });

  it("parses the v1 dual-path audit and the v2 fallback marker", () => {
    const details = getAskAnswerDetails(
      answer({
        ask_audit: {
          strict: { answer_type: "no", text: "否" },
          inferential: { answer_type: "yes", text: "是", reason: "推断" },
          final: { answer_type: "no", text: "否" },
          v2_failure: { stage: "b1", code: "invalid_output" },
        },
      }),
    );
    if (details?.audit.kind !== "v1") throw new Error("expected v1");
    expect(details.audit.entries.map((item) => item.label)).toEqual(["严格", "推断", "仲裁"]);
    expect(details.audit.usedArbitration).toBe(true);
    expect(details.audit.v2Failure).toEqual({ stage: "b1", code: "invalid_output" });
    expect(getAskVerdict(details).label).toBe("v2 失败→v1");
  });

  it("prefers the cache hit label over the audit", () => {
    const details = getAskAnswerDetails(
      answer({
        ask_audit: null,
        cache_hit: { entry_id: 3, question_text: "Q", answer_type: "no", match_type: "equivalent" },
      }),
    );
    expect(details?.cacheHit?.entryId).toBe(3);
    expect(getAskVerdict(details!).label).toBe("缓存·等价");
  });

  it("recognises a truncated audit", () => {
    const details = getAskAnswerDetails(answer({ ask_audit: { truncated: true } }));
    expect(details?.audit.kind).toBe("truncated");
  });

  it("ignores plain text and non-answer content", () => {
    expect(getAskAnswerDetails("纯文本")).toBeNull();
    expect(getAskAnswerDetails(JSON.stringify({ kind: "hint", text: "x" }))).toBeNull();
  });
});

describe("getReasoningCoverage", () => {
  it("reads coverage items and skips malformed ones", () => {
    const content = JSON.stringify({
      kind: "reasoning_result",
      text: "x",
      coverage: [{ id: 1, covered: true, text: "a" }, { id: "2", covered: false }, { id: 3 }],
    });
    expect(getReasoningCoverage(content)).toEqual([
      { id: 1, covered: true, text: "a" },
      { id: 2, covered: false, text: undefined },
    ]);
  });
});

describe("getMessagePreview", () => {
  it("summarises structured messages", () => {
    expect(getMessagePreview(JSON.stringify({ kind: "hint", text: "提示内容" }))).toBe("提示内容");
    expect(
      getMessagePreview(
        JSON.stringify({
          kind: "points_gifted",
          amount: 5,
          actor_name: "asw",
          actor_seat: 1,
          target_name: "ChatGPT",
          target_seat: 3,
        }),
      ),
    ).toBe("asw[1] 赠送了 5 积分给 ChatGPT[3]");
    expect(getMessagePreview("{不是 JSON")).toBe("{不是 JSON");
  });
});
