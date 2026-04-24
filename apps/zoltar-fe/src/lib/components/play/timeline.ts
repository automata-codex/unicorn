/**
 * Play-view timeline primitives. The backend returns two parallel streams
 * (narrative messages + dice_roll events) ordered by their own keys; the FE
 * merges them into a single chronologically-ordered list the `MessageLog`
 * renders.
 *
 * Ordering key: `createdAt` (ISO string). Both streams share this field —
 * dice_roll events pick it up from `game_event.created_at`. Stable sort
 * preserves original order on ties, which matters when two rows land within
 * the same transaction and get millisecond-adjacent timestamps.
 */

export interface NarrativeTimelineEntry {
  type: 'message';
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface DiceRollTimelineEntry {
  type: 'dice_roll';
  id: string;
  sequenceNumber: number;
  createdAt: string;
  source: 'system_generated' | 'player_entered';
  notation: string;
  purpose: string;
  results: number[];
  total: number;
  target: number | null;
}

export type TimelineEntry = NarrativeTimelineEntry | DiceRollTimelineEntry;

export interface MessageWire {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
}

export interface DiceRollWire {
  id: string;
  sequenceNumber: number;
  createdAt: string;
  source: 'system_generated' | 'player_entered';
  notation: string;
  purpose: string;
  results: number[];
  total: number;
  target: number | null;
}

export function mergeTimeline(
  messages: MessageWire[],
  diceRolls: DiceRollWire[],
): TimelineEntry[] {
  const tagged: TimelineEntry[] = [
    ...messages.map(
      (m): NarrativeTimelineEntry => ({
        type: 'message',
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt,
      }),
    ),
    ...diceRolls.map(
      (d): DiceRollTimelineEntry => ({
        type: 'dice_roll',
        id: d.id,
        sequenceNumber: d.sequenceNumber,
        createdAt: d.createdAt,
        source: d.source,
        notation: d.notation,
        purpose: d.purpose,
        results: d.results,
        total: d.total,
        target: d.target,
      }),
    ),
  ];
  // Array.prototype.sort is stable in modern engines; ties preserve insertion
  // order, which means messages come before same-ms dice rolls if both share
  // a timestamp. That's the conservative default — neither order is wrong
  // visually.
  tagged.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return tagged;
}
