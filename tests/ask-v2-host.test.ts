import { afterEach, describe, expect, it, vi } from "vitest";

import { askV2Host, getAskEngine } from "@/lib/ask-v2-host";
import type { PuzzleFact } from "@/lib/puzzle-facts";
import { sanitizeRoomMessageForPlayer } from "@/lib/room-message";
import type { RoomMessage } from "@/lib/types";

const puzzle = {
  title: "深夜报警",
  surface: "他听到声音后报警。",
  bottom: "他是盲人。深夜他听到碎玻璃声，确认窗户被打破后报警。",
};
const facts: PuzzleFact[] = [
  { id: "F1", text: "他是盲人", kind: "explicit", quote: "他是盲人", status: "approved" },
];

function reply(content: unknown) {
  return Response.json({ choices: [{ finish_reason: "stop", message: { content: JSON.stringify(content) } }] });
}

type Route = { match: string; content: unknown | Error };

function mockFetch(routes: Route[]) {
  const seen: string[] = [];
  const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { messages?: Array<{ content: string }> };
    const system = body.messages?.[0]?.content ?? "";
    const route = routes.find((item) => system.includes(item.match));
    if (!route) throw new Error("unexpected request");
    seen.push(route.match);
    if (route.content instanceof Error) throw route.content;
    return reply(route.content);
  });
  vi.stubGlobal("fetch", fetchMock);
  return seen;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ask engine switch", () => {
  it("defaults to v1 and only enables v2 explicitly", () => {
    vi.stubEnv("ASK_ENGINE", "");
    expect(getAskEngine()).toBe("v1");
    vi.stubEnv("ASK_ENGINE", "v2");
    expect(getAskEngine()).toBe("v2");
  });
});

describe("askV2Host", () => {
  it("answers with v2, attaches a fact summary for a confirmed yes, and stores the v2 audit", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("ZHIPU_API_KEY", "");
    mockFetch([
      { match: "reviewer A", content: { proposition: "他是盲人", reason: "F1", answer_type: "yes" } },
      { match: "reviewer B1", content: { proposition: "他是盲人", verdict: "supported", evidence: ["F1"], reason: "F1" } },
      { match: "事实", content: { fact: "他是盲人" } },
    ]);
    const result = await askV2Host({ puzzle, facts, content: "他是盲人吗？", puzzleMessages: [] });
    expect(result).toMatchObject({ engine: "v2", answerType: "yes", cacheEligible: true });
    const payload = JSON.parse(result.content);
    expect(payload).toMatchObject({ kind: "answer", text: "是", fact_summary: "他是盲人", ask_audit: { version: 2, route: "b1_agree" } });
  });

  it("falls back to v1 when v2 cannot finish, never marking the answer cacheable", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    vi.stubEnv("ZHIPU_API_KEY", "");
    vi.stubEnv("GLM_FALLBACK_ENABLED", "false");
    const seen = mockFetch([
      { match: "reviewer A", content: { proposition: "他是盲人", reason: "F1", answer_type: "yes" } },
      { match: "reviewer B1", content: { proposition: "他是盲人", verdict: "supported", evidence: ["汤底里没有这句话"], reason: "x" } },
      { match: "Strict literal reading", content: { answer_type: "yes", reason: "汤底明说" } },
      { match: "Inferential reading", content: { answer_type: "yes", reason: "汤底明说" } },
      { match: "事实", content: { fact: "他是盲人" } },
    ]);
    const result = await askV2Host({ puzzle, facts, content: "他是盲人吗？", puzzleMessages: [] });
    expect(result).toMatchObject({ engine: "v1_fallback", answerType: "yes", cacheEligible: false });
    const payload = JSON.parse(result.content);
    expect(payload.ask_audit.v2_failure).toEqual({ stage: "b1", code: "invalid_evidence" });
    expect(payload.ask_audit.strict.answer_type).toBe("yes");
    expect(seen).toContain("Strict literal reading");
  });

  it("keeps the v2 audit away from players", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    mockFetch([
      { match: "reviewer A", content: { proposition: "他吃了晚饭", reason: "未提及", answer_type: "irrelevant" } },
      { match: "reviewer B1", content: { proposition: "他吃了晚饭", verdict: "undetermined", evidence: [], reason: "未提及" } },
    ]);
    const result = await askV2Host({ puzzle, facts, content: "他吃了晚饭吗？", puzzleMessages: [] });
    const message = { id: 1, content: result.content, message_type: "ai", message_mode: "ask" } as unknown as RoomMessage;
    const sanitized = sanitizeRoomMessageForPlayer(message);
    expect(sanitized.content).not.toContain("ask_audit");
    expect(sanitized.content).not.toContain("未提及");
    expect(JSON.parse(sanitized.content)).toMatchObject({ kind: "answer", text: "与此无关" });
  });
});
