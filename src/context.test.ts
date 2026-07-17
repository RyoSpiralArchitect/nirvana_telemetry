import { describe, expect, it } from "vitest";
import { boundConversationContext } from "./context";
import type { Message } from "./types";

function message(index: number, chars = 8): Message {
  return {
    id: String(index),
    role: index % 2 === 0 ? "user" : "assistant",
    content: `${index}`.padEnd(chars, "x"),
    createdAt: "2026-07-17T00:00:00.000Z",
  };
}

describe("model context bounds", () => {
  it("keeps the visible run independent from a recent provider window", () => {
    const fullRun = Array.from({ length: 52 }, (_, index) => message(index));
    const result = boundConversationContext(fullRun);

    expect(fullRun).toHaveLength(52);
    expect(result.trimmed).toBe(true);
    expect(result.messages.length).toBeLessThanOrEqual(44);
    expect(result.messages.at(-1)?.id).toBe("51");
    expect(result.messages[0]?.role).toBe("user");
  });

  it("drops oversized older messages and stays under the character budget", () => {
    const fullRun = [message(0, 20), message(1, 16_000), message(2, 20)];
    const result = boundConversationContext(fullRun, {
      messages: 44,
      messageChars: 15_000,
      totalChars: 70_000,
    });

    expect(result.trimmed).toBe(true);
    expect(result.messages.map((item) => item.id)).toEqual(["2"]);
  });
});
