import * as schema from '../db/schema';

import type Anthropic from '@anthropic-ai/sdk';
import type { CallSessionParams } from '../anthropic/anthropic.service';
import type { DbOrTx } from '../db/db.provider';
import type { SubmitGmResponse } from './session.schema';
import type {
  ThresholdCrossing,
  ValidationRejection,
  ValidationResult,
} from './session.validator';

/**
 * One entry per roll executed during a turn — whether issued by Claude via
 * `roll_dice` (`source: 'system_generated'`) or submitted by the player via a
 * `diceResult` action (`source: 'player_entered'`). Populated by the inner
 * tool loop and written out as part of the telemetry row in Part 10.
 *
 * `sequenceNumber` is the `game_events.sequence_number` assigned when the
 * row lands in the DB — known only at transaction time, so the inner loop
 * emits records with `sequenceNumber: 0` as a placeholder and the write path
 * fills in real values.
 */
export interface ExecutedRollRecord {
  source: 'system_generated' | 'player_entered';
  sequenceNumber: number;
  notation: string;
  purpose: string;
  results: number[];
  modifier: number;
  total: number;
  requestId?: string;
}

/**
 * One entry per `rules_lookup` call the Warden made during a turn. Captures
 * the query, how many chunks came back, and the top similarity — but **not**
 * the chunk text. Re-running the query at review time reproduces the chunks
 * deterministically (until the index is re-ingested), so storing full text
 * would bloat `adventure_telemetry.payload` without marginal benefit.
 *
 * Zero-result lookups (`resultCount: 0`) are preserved faithfully — they are
 * the primary signal M7.2 uses to prioritize ingestion coverage.
 */
export interface RulesLookupRecord {
  query: string;
  limit: number;
  resultCount: number;
  topSimilarity: number | null;
  sources: string[];
}

/**
 * One row per turn in `adventure_telemetry`, keyed to the `gm_response`
 * event's sequence number. Captures everything playtest review (M7.1) needs
 * to replay a turn: the prompt the snapshot carried, the Claude request/
 * response shape and token usage, the validator output, and — when a
 * correction fired — the rejection list plus the corrected response.
 *
 * `diceRolls` is empty in M6 (dice work ships in M7); the field is present
 * now so the payload shape stays stable. Part 10 of M7 populates it.
 */
export interface AdventureTelemetryPayload {
  playerMessage: string;
  snapshotSent: string;
  originalRequest: {
    model: string;
    systemBlocks: number;
    messageCount: number;
    promptTokens: number | null;
    completionTokens: number | null;
  };
  originalResponse: SubmitGmResponse;
  notes: {
    original: string | null;
    correction: string | null;
  };
  correction?: {
    rejections: ValidationRejection[];
    correctionRequest: {
      promptTokens: number | null;
      completionTokens: number | null;
    };
    correctionResponse: SubmitGmResponse;
  };
  applied: ValidationResult['applied'];
  thresholds: ThresholdCrossing[];
  diceRolls: never[];
}

export function buildAdventureTelemetryPayload(input: {
  playerMessage: string;
  snapshotSent: string;
  originalRequest: CallSessionParams;
  originalResponse: Anthropic.Message;
  originalParsed: SubmitGmResponse;
  correction?: {
    rejections: ValidationRejection[];
    response: Anthropic.Message;
    parsed: SubmitGmResponse;
  };
  applied: ValidationResult['applied'];
  thresholds: ThresholdCrossing[];
}): AdventureTelemetryPayload {
  const originalUsage = input.originalResponse.usage;

  const payload: AdventureTelemetryPayload = {
    playerMessage: input.playerMessage,
    snapshotSent: input.snapshotSent,
    originalRequest: {
      model: input.originalResponse.model,
      systemBlocks: input.originalRequest.systemBlocks.length,
      messageCount: input.originalRequest.messages.length,
      promptTokens: originalUsage?.input_tokens ?? null,
      completionTokens: originalUsage?.output_tokens ?? null,
    },
    originalResponse: input.originalParsed,
    notes: {
      original: input.originalParsed.gmUpdates?.notes ?? null,
      correction: input.correction?.parsed.gmUpdates?.notes ?? null,
    },
    applied: input.applied,
    thresholds: input.thresholds,
    diceRolls: [],
  };

  if (input.correction) {
    const correctionUsage = input.correction.response.usage;
    payload.correction = {
      rejections: input.correction.rejections,
      correctionRequest: {
        promptTokens: correctionUsage?.input_tokens ?? null,
        completionTokens: correctionUsage?.output_tokens ?? null,
      },
      correctionResponse: input.correction.parsed,
    };
  }

  return payload;
}

export async function writeAdventureTelemetry(args: {
  tx: DbOrTx;
  adventureId: string;
  sequenceNumber: number;
  payload: AdventureTelemetryPayload;
}): Promise<void> {
  await args.tx.insert(schema.adventureTelemetry).values({
    adventureId: args.adventureId,
    sequenceNumber: args.sequenceNumber,
    payload: args.payload,
  });
}
