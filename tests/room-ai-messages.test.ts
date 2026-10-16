import { describe, expect, it } from "vitest";
import { getAiRepliesByRequestId, getPendingAiMessageIds } from "@/lib/room-ai-messages";
import type { RoomMessage } from "@/lib/types";

const now = Date.parse("2026-10-16T10:00:00Z");
function message(id: number, overrides: Partial<RoomMessage> = {}): RoomMessage {
  return {
    id, room_id: "room", seat_id: `seat-${id}`, sender_name: `player${id}`,
    sender_seat_number: id, sender_type: "guest", message_type: "chat",
    message_mode: "ask", content: "问题", puzzle_id: 1,
    created_at: new Date(now - 10_000).toISOString(), ...overrides,
  };
}

describe("concurrent AI reply correlation", () => {
  it("maps out-of-order replies to their own questions and keeps the other request pending", () => {
    const messages = [message(1), message(2), message(3, {
      message_type: "ai", reply_to_id: 2, content: '{"kind":"answer","text":"否"}',
    })];
    expect(getAiRepliesByRequestId(messages).get(2)?.id).toBe(3);
    expect([...getPendingAiMessageIds(messages, now, 120_000, {}, 1)]).toEqual([1]);
    messages.push(message(4, { message_type: "ai", reply_to_id: 1 }));
    expect(getPendingAiMessageIds(messages, now, 120_000, {}, 1).size).toBe(0);
  });

  it("does not let unlinked reveals or hints settle an unrelated ask", () => {
    const messages = [message(1), message(2, { message_mode: "hint" }),
      message(3, { message_type: "ai", message_mode: "hint", reply_to_id: 2 }),
      message(4, { message_type: "ai", message_mode: "reason", content: '{"kind":"reveal"}' })];
    expect([...getPendingAiMessageIds(messages, now, 120_000, {}, 1)]).toEqual([1]);
  });

  it("excludes failed optimistic sends, old puzzles, chat, and expired requests", () => {
    const messages = [message(-1), message(-2), message(3, { puzzle_id: 2 }),
      message(4, { message_mode: "chat" }), message(5, { created_at: new Date(now - 120_000).toISOString() })];
    expect([...getPendingAiMessageIds(messages, now, 120_000, { [-1]: {} }, 1)]).toEqual([-2]);
    expect(getPendingAiMessageIds(messages, now, 120_000, {}, null).size).toBe(0);
  });
});
