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
 * One row per turn in `adventure_telemetry`, keyed to the `gm_response`
 * event's sequence number. Captures everything playtest review (M7.1) needs
 * to replay a turn: the prompt the snapshot carried, the Claude request/
 * response shape and token usage, the validator output, and — when a
 * correction fired — the rejection list plus the corrected response.
 *
 * `diceRolls` is empty in M6 (dice work ships in M7); the field is present
 * now so the payload shape stays stable.
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
