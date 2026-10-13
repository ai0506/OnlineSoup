import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { askDeepSeekHost, requestFactSummary } from "@/lib/deepseek";

const puzzle = { title: "测试", surface: "汤面", bottom: "汤底" };
const usage = {
  prompt_tokens: 100, completion_tokens: 20, total_tokens: 120,
  prompt_cache_hit_tokens: 80, prompt_cache_miss_tokens: 20,
  prompt_tokens_details: { cached_tokens: 80 },
  completion_tokens_details: { reasoning_tokens: 10 },
};

function reply(content: unknown, finish_reason = "stop", tokens: unknown = usage) {
  return Response.json({
    choices: [{ finish_reason, message: { content: typeof content === "string" ? content : JSON.stringify(content) } }],
    usage: tokens,
  });
}

beforeEach(() => {
  vi.stubEnv("DEEPSEEK_API_KEY", "private-test-key");
  vi.stubEnv("ZHIPU_API_KEY", "");
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("DeepSeek usage logging", () => {
  it("records each parallel reading and arbitration without exposing prompts or credentials", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(reply({ answer_type: "no" }))
      .mockResolvedValueOnce(reply({ answer_type: "irrelevant" }))
      .mockResolvedValueOnce(reply({ answer_type: "no" })));
    const result = await askDeepSeekHost({ mode: "ask", puzzle, content: "私密问题", puzzleMessages: [] });
    const logs = vi.mocked(console.info).mock.calls.map(([, data]) => data);
    expect(logs.map((data) => data.purpose)).toEqual(["ask_strict", "ask_inferential", "ask_arbitration"]);
    for (const data of logs) expect(data).toMatchObject({ provider: "deepseek", status: "ok", usage });
    expect(JSON.stringify(logs)).not.toMatch(/私密问题|汤底|private-test-key/);
    expect(JSON.stringify(result)).not.toContain("prompt_tokens");
  });

  it.each(["", "{", "truncated"])("retains billed usage when content is unusable: %j", async (content) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply(content, content === "truncated" ? "length" : "stop")));
    await expect(askDeepSeekHost({ mode: "hint", puzzle, content: "提示", puzzleMessages: [] })).rejects.toThrow();
    expect(console.info).toHaveBeenCalledWith("[ai-usage]", expect.objectContaining({ purpose: "hint", status: "response_error", usage }));
  });

  it.each([undefined, { prompt_tokens: -1 }])("keeps missing/invalid usage unknown without breaking the answer", async (tokens) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      choices: [{ message: { content: JSON.stringify({ hint: "提示", summary: "摘要" }) } }], usage: tokens,
    })));
    await expect(askDeepSeekHost({ mode: "hint", puzzle, content: "提示", puzzleMessages: [] })).resolves.toBeTypeOf("string");
    expect(console.info).toHaveBeenCalledWith("[ai-usage]", expect.objectContaining({ status: "ok", usage: null }));
  });

  it("captures fact summary fallback usage and strips unrecognized fields", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(reply({ fact: "一条事实" }, "stop", { ...usage, secret: "hidden" })));
    await expect(requestFactSummary("private-test-key", "问题", "yes", [])).resolves.toEqual({ fact: "一条事实", source: "deepseek" });
    expect(console.info).toHaveBeenCalledWith("[ai-usage]", expect.objectContaining({ purpose: "fact_summary", usage }));
  });

  it.each(["http", "network"])("does not fabricate zero usage for %s failures", async (failure) => {
    vi.stubGlobal("fetch", failure === "http"
      ? vi.fn().mockResolvedValue(new Response(null, { status: 429 }))
      : vi.fn().mockRejectedValue(new Error("network")));
    await expect(askDeepSeekHost({ mode: "hint", puzzle, content: "提示", puzzleMessages: [] })).rejects.toThrow();
    expect(console.info).toHaveBeenCalledWith("[ai-usage]", expect.objectContaining({ status: failure === "http" ? "http_error" : "request_error", usage: null }));
  });
});
