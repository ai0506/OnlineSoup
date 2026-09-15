import type { RoomMessage } from "@/lib/types";

/**
 * Keep player-facing messages free of audit-only and solution-revealing
 * metadata. The bootstrap RPC applies the same rule for direct refetches.
 */
export function sanitizeRoomMessageForPlayer(message: RoomMessage): RoomMessage {
  if (message.message_type !== "ai") return message;

  try {
    const content = JSON.parse(message.content) as Record<string, unknown>;
    let changed = false;

    if ("ask_audit" in content) {
      delete content.ask_audit;
      changed = true;
    }
    if ("cache_hit" in content) {
      delete content.cache_hit;
      changed = true;
    }
    if (content.kind === "reasoning_result" && "coverage" in content) {
      delete content.coverage;
      changed = true;
    }

    return changed ? { ...message, content: JSON.stringify(content) } : message;
  } catch {
    return message;
  }
}

export function sanitizeRoomMessagesForPlayer(messages: RoomMessage[]) {
  return messages.map(sanitizeRoomMessageForPlayer);
}
