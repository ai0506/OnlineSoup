import { afterEach, describe, expect, it, vi } from "vitest";

import { askDeepSeekHost } from "@/lib/deepseek";
import { sanitizeRoomMessageForPlayer } from "@/lib/room-message";

const puzzle = {
  title: "判定边界",
  surface: "他听到声音后报警。",
  bottom: "他听到碎玻璃声，确认窗户被打破后报警。",
};

function reply(answer_type: string) {
  return Response.json({ choices: [{ finish_reason: "stop", message: {
    content: JSON.stringify({ answer_type, reason: "内部判定依据" }),
  } }] });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("ask provider and inference contract", () => {
  it("pairs concurrent Q&A by request id when constructing hint history", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ choices: [{
      finish_reason: "stop", message: { content: JSON.stringify({ hint: "想想声音来源", summary: "声音来源是线索" }) },
    }] }));
    vi.stubGlobal("fetch", fetchMock);
    await askDeepSeekHost({ mode: "hint", puzzle, content: "提示", puzzleMessages: [
      { id: 1, sender_name: "甲", message_type: "chat", message_mode: "ask", content: "窗户破了吗？" },
      { id: 2, sender_name: "乙", message_type: "chat", message_mode: "ask", content: "下雨了吗？" },
      { id: 3, reply_to_id: 2, sender_name: "AI主持", message_type: "ai", message_mode: "ask", content: '{"kind":"answer","text":"否"}' },
      { id: 4, reply_to_id: 1, sender_name: "AI主持", message_type: "ai", message_mode: "ask", content: '{"kind":"answer","text":"是"}' },
    ] });
    const system = JSON.parse(fetchMock.mock.calls[0][1].body).messages[0].content;
    expect(system).toContain('Question - 甲: <player_message>窗户破了吗？</player_message>\nAnswer - host: 是');
    expect(system).toContain('Question - 乙: <player_message>下雨了吗？</player_message>\nAnswer - host: 否');
  });

  it("uses non-thinking short verdicts for both readings and arbitration, retaining player redaction", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(reply("no"))
      .mockResolvedValueOnce(reply("irrelevant"))
      .mockResolvedValueOnce(reply("no"));
    vi.stubGlobal("fetch", fetchMock);

    const result = await askDeepSeekHost({ mode: "ask", puzzle, content: "他因为下雨报警吗？", puzzleMessages: [
      { sender_name: "玩家", message_type: "chat", message_mode: "ask", content: "他因为下雨报警吗？" },
      { sender_name: "AI主持", message_type: "ai", message_mode: "ask", content: JSON.stringify({ kind: "answer", text: "是" }) },
    ] });
    if (typeof result === "string") throw new Error("Expected ask result");
    expect(result.answerType).toBe("no");
    expect(result.cacheEligible).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchMock.mock.calls) {
      const body = JSON.parse(init.body);
      expect(body.thinking).toEqual({ type: "disabled" });
      expect(body.response_format).toEqual({ type: "json_object" });
    }
    const systems = fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body).messages[0].content);
    expect(systems[0]).not.toContain("Answer - host: 是");
    expect(systems[1]).not.toContain("Answer - host: 是");
    expect(systems[2]).not.toContain("Answer - host: 是");
    for (const system of systems) expect(system).toContain("他因为下雨报警吗？");
    const internal = JSON.parse(result.content);
    expect(internal.ask_audit.final.answer_type).toBe("no");
    const safe = JSON.parse(sanitizeRoomMessageForPlayer({
      id: 1, room_id: "room", seat_id: "seat", sender_name: "AI主持", message_type: "ai",
      content: result.content, created_at: "2026-10-10T00:00:00Z", sender_seat_number: 0,
      sender_type: "registered", message_mode: "ask", puzzle_id: 1,
    }).content);
    expect(safe.ask_audit).toBeUndefined();
    expect(safe.text).toBe("否");
  });

  it("does not treat a failed reading as cacheable agreement", async () => {
    vi.stubEnv("DEEPSEEK_API_KEY", "test-key");
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ finish_reason: "length", message: { content: "" } }] }))
      .mockResolvedValueOnce(reply("irrelevant"));
    vi.stubGlobal("fetch", fetchMock);
    const result = await askDeepSeekHost({ mode: "ask", puzzle, content: "他穿红衣服吗？", puzzleMessages: [] });
    if (typeof result === "string") throw new Error("Expected ask result");
    expect(result.answerType).toBe("irrelevant");
    expect(result.cacheEligible).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
