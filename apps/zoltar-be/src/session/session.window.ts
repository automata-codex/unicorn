import { Logger } from '@nestjs/common';

import type { messages } from '../db/schema';

export type DbMessage = typeof messages.$inferSelect;

/**
 * Cap on serialized window size. Midpoint of the 32–48 KB range the roadmap
 * calls out. Configurable via env var in a future milestone if playtest data
 * warrants — today the value is a constant so the prompt shape is predictable.
 */
export const MESSAGE_WINDOW_MAX_BYTES = 40 * 1024;

const logger = new Logger('SessionWindow');

/**
 * Selects the most recent suffix of a message history that fits within
 * `maxBytes` when serialized as JSON. Walks backward from the newest message;
 * stops when including the next message would push past the cap. Returns the
 * selected messages in chronological (ASC) order.
 *
 * Exception: when the newest message alone is larger than `maxBytes`, it is
 * included anyway (a logged warning accompanies this). Truncating mid-turn is
 * worse than one oversized prompt.
 */
export function buildMessageWindow(
  messages: DbMessage[],
  maxBytes = MESSAGE_WINDOW_MAX_BYTES,
): DbMessage[] {
  if (messages.length === 0) return [];

  const window: DbMessage[] = [];
  let bytes = 0;

  for (let i = messages.length - 1; i >= 0; i--) {
    const size = Buffer.byteLength(JSON.stringify(messages[i]), 'utf8');
    if (bytes + size > maxBytes) {
      if (window.length === 0) {
        logger.warn(
          `Single message (${size} bytes) exceeds MESSAGE_WINDOW_MAX_BYTES (${maxBytes}); including anyway.`,
        );
        window.unshift(messages[i]);
        bytes += size;
      }
      break;
    }
    window.unshift(messages[i]);
    bytes += size;
  }

  return window;
}
