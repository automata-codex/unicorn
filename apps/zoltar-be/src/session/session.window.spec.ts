import { describe, expect, it } from 'vitest';

import { buildMessageWindow, MESSAGE_WINDOW_MAX_BYTES } from './session.window';

import type { DbMessage } from './session.window';

function makeMessage(
  index: number,
  opts: { role?: DbMessage['role']; content?: string } = {},
): DbMessage {
  const content = opts.content ?? `message ${index}`;
  return {
    id: `00000000-0000-0000-0000-00000000${String(index).padStart(4, '0')}`,
    adventureId: '00000000-0000-0000-0000-0000000000aa',
    role: opts.role ?? (index % 2 === 0 ? 'player' : 'gm'),
    content,
    createdAt: new Date(2026, 0, 1, 0, 0, index),
  };
}

describe('buildMessageWindow', () => {
  it('returns an empty window for empty input', () => {
    expect(buildMessageWindow([])).toEqual([]);
  });

  it('preserves chronological order of selected messages', () => {
    const msgs = [makeMessage(1), makeMessage(2), makeMessage(3)];
    const window = buildMessageWindow(msgs, 10 * 1024);
    expect(window.map((m) => m.content)).toEqual([
      'message 1',
      'message 2',
      'message 3',
    ]);
  });

  it('drops the oldest messages when the cap would be exceeded', () => {
    // Each message content is ~2 KB; cap of 5 KB fits two messages.
    const bigContent = 'x'.repeat(2 * 1024);
    const msgs = [
      makeMessage(1, { content: bigContent }),
      makeMessage(2, { content: bigContent }),
      makeMessage(3, { content: bigContent }),
    ];
    const window = buildMessageWindow(msgs, 5 * 1024);
    expect(window).toHaveLength(2);
    expect(window[0].id).toBe(msgs[1].id);
    expect(window[1].id).toBe(msgs[2].id);
  });

  it('includes a single oversized message anyway', () => {
    const huge = 'x'.repeat(100 * 1024);
    const msgs = [makeMessage(1, { content: huge })];
    const window = buildMessageWindow(msgs, 10 * 1024);
    expect(window).toHaveLength(1);
    expect(window[0].content).toBe(huge);
  });

  it('drops older messages but keeps the newest oversized one', () => {
    const normal = makeMessage(1, { content: 'small' });
    const huge = makeMessage(2, { content: 'y'.repeat(100 * 1024) });
    const window = buildMessageWindow([normal, huge], 10 * 1024);
    expect(window).toHaveLength(1);
    expect(window[0].id).toBe(huge.id);
  });

  it('defaults to MESSAGE_WINDOW_MAX_BYTES when no cap is passed', () => {
    expect(MESSAGE_WINDOW_MAX_BYTES).toBe(40 * 1024);
    // A single tiny message should always fit under the default cap.
    const msgs = [makeMessage(1)];
    expect(buildMessageWindow(msgs)).toEqual(msgs);
  });
});
