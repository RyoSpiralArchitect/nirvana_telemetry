import type { Message } from "./types";

export const MODEL_CONTEXT_LIMITS = {
  messages: 44,
  messageChars: 15_000,
  totalChars: 70_000,
} as const;

export type BoundedContext = {
  messages: Message[];
  trimmed: boolean;
};

type ContextLimits = {
  messages: number;
  messageChars: number;
  totalChars: number;
};

/**
 * Keep the visible transcript intact while sending only a safe, recent window
 * to the provider. The server owns the hard limits; this leaves headroom for
 * gateway differences and avoids a long-running experiment failing suddenly.
 */
export function boundConversationContext(
  messages: Message[],
  limits: ContextLimits = MODEL_CONTEXT_LIMITS,
): BoundedContext {
  const kept: Message[] = [];
  let totalChars = 0;
  let trimmed = false;

  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    const messageChars = message.content.length;
    const wouldOverflow =
      kept.length >= limits.messages ||
      messageChars > limits.messageChars ||
      totalChars + messageChars > limits.totalChars;

    if (wouldOverflow) {
      trimmed = true;
      break;
    }

    kept.unshift(message);
    totalChars += messageChars;
  }

  while (kept[0]?.role === "assistant") {
    kept.shift();
    trimmed = true;
  }

  return {
    messages: kept,
    trimmed: trimmed || kept.length !== messages.length,
  };
}
