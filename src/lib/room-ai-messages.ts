import type { RoomMessage } from "@/lib/types";

type ReplyMessage = Pick<RoomMessage, "message_type"> & Partial<Pick<RoomMessage, "reply_to_id">>;

/** Reveal/system messages must not settle another player's pending request. */
export function getAiRepliesByRequestId<T extends ReplyMessage>(messages: T[]) {
  const replies = new Map<number, T>();
  for (const message of messages) {
    if (message.message_type === "ai" && message.reply_to_id != null) {
      replies.set(message.reply_to_id, message);
    }
  }
  return replies;
}

export function getPendingAiMessageIds(
  messages: RoomMessage[],
  now: number,
  timeoutMs: number,
  failedSends: Record<number, unknown>,
  currentPuzzleId?: number | null,
) {
  const replies = getAiRepliesByRequestId(messages);
  return new Set(messages.filter((message) =>
    message.message_type === "chat" && message.message_mode !== "chat"
    && !failedSends[message.id] && !replies.has(message.id)
    && (currentPuzzleId === undefined || message.puzzle_id === currentPuzzleId)
    && now - new Date(message.created_at).getTime() < timeoutMs,
  ).map((message) => message.id));
}
