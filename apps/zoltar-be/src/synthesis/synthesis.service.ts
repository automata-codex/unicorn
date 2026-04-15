import type Anthropic from '@anthropic-ai/sdk';
import { Injectable, Logger } from '@nestjs/common';
import type {
  MothershipCharacterSheet,
  MothershipOracleSelections,
  OracleEntry,
} from '@uv/game-systems';

import { AnthropicService } from '../anthropic/anthropic.service';

import {
  buildMothershipCoherenceCheckPrompt,
  buildMothershipSynthesisPrompt,
  MOTHERSHIP_COHERENCE_SYSTEM_PROMPT,
  MOTHERSHIP_ORACLE_CATEGORIES,
  MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT,
  type MothershipOracleCategory,
} from './mothership/synthesis.prompts';
import {
  CoherenceConflict,
  CoherenceReport,
  SubmitGmContext,
  coherenceReportSchema,
  submitGmContextSchema,
} from './synthesis.schema';
import { SynthesisRepository } from './synthesis.repository';
import { COHERENCE_TOOLS, SYNTHESIS_TOOLS } from './synthesis.tools';
import {
  buildCampaignStateData,
  buildGmContextBlob,
  buildGridEntityRows,
  SynthesisWriteValidationError,
  validateSubmitGmContextForWrite,
} from './synthesis.write';

export { SynthesisWriteValidationError } from './synthesis.write';

/**
 * Thrown when the coherence check surfaces a conflict the active pool cannot
 * resolve. Controller translates this to 409 in Phase 4.
 */
export class CoherenceConflictError extends Error {
  constructor(public readonly conflicts: CoherenceConflict[]) {
    super('coherence_conflict');
    this.name = 'CoherenceConflictError';
  }
}

/**
 * Thrown when Claude produces output that doesn't match the expected tool
 * shape. Always a hard failure — the adventure ends up in `failed`.
 */
export class SynthesisOutputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SynthesisOutputError';
  }
}

export interface CheckCoherenceArgs {
  selections: MothershipOracleSelections;
  activePools: Record<MothershipOracleCategory, OracleEntry[]>;
}

export interface CheckCoherenceResult {
  selections: MothershipOracleSelections;
  report: CoherenceReport;
  rerolled: boolean;
}

@Injectable()
export class SynthesisService {
  private readonly logger = new Logger(SynthesisService.name);

  constructor(
    private readonly anthropic: AnthropicService,
    private readonly repo: SynthesisRepository,
  ) {}

  /**
   * Runs the coherence check and resolves Tier 1 (silent reroll) internally.
   * Returns the (possibly rerolled) selections plus the raw report, or throws
   * CoherenceConflictError for Tier 3 surfacing. Tier 2 is the default: when
   * `proceed` is returned, the caller continues to synthesis unchanged.
   */
  async checkCoherence(
    args: CheckCoherenceArgs,
  ): Promise<CheckCoherenceResult> {
    const message = await this.anthropic.callMessages({
      system: MOTHERSHIP_COHERENCE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildMothershipCoherenceCheckPrompt(args.selections),
        },
      ],
      tools: COHERENCE_TOOLS,
      toolChoice: { type: 'any' },
    });

    const report = this.parseToolResult(
      message,
      'report_coherence',
      coherenceReportSchema,
    );

    if (report.resolution === 'surface') {
      throw new CoherenceConflictError(report.conflicts);
    }

    if (report.resolution === 'proceed') {
      return { selections: args.selections, report, rerolled: false };
    }

    // resolution === 'reroll' — attempt silent substitution.
    const category = report.rerollCategory as
      | MothershipOracleCategory
      | undefined;
    if (
      !category ||
      !(MOTHERSHIP_ORACLE_CATEGORIES as readonly string[]).includes(category)
    ) {
      this.logger.warn(
        `Coherence check requested reroll with invalid category: ${String(
          category,
        )}`,
      );
      throw new CoherenceConflictError(report.conflicts);
    }

    const substitute = this.pickRerollReplacement(
      args.activePools[category],
      args.selections[category].id,
    );
    if (!substitute) {
      this.logger.debug(
        `Coherence reroll requested for ${category} but no alternative exists; escalating to surface.`,
      );
      throw new CoherenceConflictError(report.conflicts);
    }

    this.logger.debug(
      `Coherence reroll: ${category} ${args.selections[category].id} -> ${substitute.id}`,
    );
    const nextSelections: MothershipOracleSelections = {
      ...args.selections,
      [category]: substitute,
    };
    return { selections: nextSelections, report, rerolled: true };
  }

  /**
   * Calls Claude to synthesize a GM context. Returns the validated tool input.
   * No DB writes — Phase 3 adds the write path.
   */
  async runSynthesis(args: {
    characterSheet: MothershipCharacterSheet;
    selections: MothershipOracleSelections;
    addendum?: string;
  }): Promise<SubmitGmContext> {
    const message = await this.anthropic.callMessages({
      system: MOTHERSHIP_SYNTHESIS_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: buildMothershipSynthesisPrompt(
            args.characterSheet,
            args.selections,
            args.addendum,
          ),
        },
      ],
      tools: SYNTHESIS_TOOLS,
      toolChoice: { type: 'any' },
    });

    return this.parseToolResult(
      message,
      'submit_gm_context',
      submitGmContextSchema,
    );
  }

  /**
   * Persists a validated `submit_gm_context` payload. On validation or write
   * failure, flips `adventure.status` to `failed` and rethrows.
   *
   * Note: this is a no-op for the on-disk Anthropic call — that lives in
   * `runSynthesis`. The controller (Phase 4) wires them together.
   */
  async commitGmContext(args: {
    adventureId: string;
    campaignId: string;
    input: SubmitGmContext;
  }): Promise<void> {
    try {
      validateSubmitGmContextForWrite(args.input);

      const existingData = await this.repo.getCampaignStateData(args.campaignId);
      const campaignStateData = buildCampaignStateData(
        existingData,
        args.input,
      );
      const gmContextBlob = buildGmContextBlob(args.input);
      const gridEntities = buildGridEntityRows(args.input);

      await this.repo.writeGmContextAtomic({
        adventureId: args.adventureId,
        campaignId: args.campaignId,
        gmContextBlob,
        campaignStateData,
        gridEntities,
      });
    } catch (err) {
      const detail =
        err instanceof SynthesisWriteValidationError
          ? err.message
          : err instanceof Error
            ? `synthesis write failed: ${err.message}`
            : 'synthesis write failed';
      this.logger.warn(
        `commitGmContext failed for adventure=${args.adventureId}: ${detail}`,
      );
      try {
        await this.repo.setAdventureFailed(args.adventureId, detail);
      } catch (markErr) {
        this.logger.error(
          `Failed to mark adventure ${args.adventureId} as failed`,
          markErr instanceof Error ? markErr.stack : String(markErr),
        );
      }
      throw err;
    }
  }

  /**
   * Standalone auto-promote helper. `commitGmContext` performs the same
   * promotion inside its transaction; M6's `submit_gm_response` handler will
   * reuse this method after each turn in Solo Blind campaigns.
   */
  async autoPromoteCanon(adventureId: string): Promise<void> {
    await this.repo.autoPromoteCanon(adventureId);
  }

  private parseToolResult<T>(
    message: Anthropic.Message,
    expectedToolName: string,
    schema: { parse: (input: unknown) => T },
  ): T {
    const toolUse = message.content.find(
      (block): block is Anthropic.ToolUseBlock =>
        block.type === 'tool_use' && block.name === expectedToolName,
    );
    if (!toolUse) {
      throw new SynthesisOutputError(
        `Claude did not call ${expectedToolName}`,
      );
    }
    try {
      return schema.parse(toolUse.input);
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      throw new SynthesisOutputError(
        `${expectedToolName} input failed validation: ${detail}`,
      );
    }
  }

  private pickRerollReplacement(
    pool: OracleEntry[] | undefined,
    currentId: string,
  ): OracleEntry | null {
    if (!pool || pool.length === 0) return null;
    const candidates = pool.filter((entry) => entry.id !== currentId);
    if (candidates.length === 0) return null;
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  }
}
