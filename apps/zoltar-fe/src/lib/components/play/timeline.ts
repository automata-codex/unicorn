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
  turnNumber: number | null;
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
  /**
   * 1-based ordinal of the turn this message belongs to — the number
   * `task playtest:review` prints as `### Turn N`, so a note taken against
   * the UI mid-playtest resolves against the review report without counting.
   * Both messages of a turn carry the same number; the player's is labelled
   * with the turn it initiates.
   *
   * `null` when no turn has closed over the message: the optimistic append
   * before a turn returns, a turn that never completed, and the synthetic
   * opening narration, which precedes turn 1. Those render unlabelled.
   */
  turnNumber: number | null;
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
        turnNumber: m.turnNumber,
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
