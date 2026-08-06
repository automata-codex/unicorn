import { Injectable, Logger } from '@nestjs/common';

import { VoyageService } from '../voyage/voyage.service';

import { preprocessQuery } from './query-preprocess';
import { RulesRepository } from './rules.repository';

import type {
  RulesLookupInput,
  RulesLookupOutput,
} from '../session/session.schema';

/**
 * What `lookup()` hands back: the tool payload, plus what preprocessing did
 * to the query on the way.
 *
 * The preprocessed query is deliberately *outside* `output`. `output` is
 * serialized straight into the `tool_result` Claude reads, and adding a field
 * there would change what reaches the Warden — a prompt change smuggled in as
 * a retrieval change, invalidating frozen eval artifacts for no benefit. It
 * belongs in telemetry, where it answers "did this lookup miss because the
 * Warden phrased it badly, or because preprocessing trimmed the wrong word?"
 */
export interface RulesLookupResult {
  output: RulesLookupOutput;
  /** The string actually embedded, when it differed from the input. */
  preprocessedQuery?: string;
}

@Injectable()
export class RulesLookupService {
  private readonly logger = new Logger(RulesLookupService.name);

  constructor(
    private readonly repo: RulesRepository,
    private readonly voyage: VoyageService,
  ) {}

  /**
   * Semantic lookup against the rules index for a given game system. The
   * Voyage embedding call still fires even when the index is empty — every
   * lookup attempt is telemetry input for ingestion prioritization, and
   * short-circuiting would hide which queries the Warden made.
   */
  async lookup(
    systemId: string,
    input: RulesLookupInput,
  ): Promise<RulesLookupResult> {
    const preprocessed = await this.preprocess(systemId, input.query);

    const embedding = await this.voyage.embed(preprocessed.query, 'query');
    const limit = input.limit ?? 3;
    const matches = await this.repo.findByCosineSimilarity({
      systemId,
      embedding,
      limit,
    });

    return {
      output: {
        results: matches.map((m) => ({
          text: m.content,
          source: m.source,
          similarity: m.similarity,
        })),
      },
      ...(preprocessed.applied
        ? { preprocessedQuery: preprocessed.query }
        : {}),
    };
  }

  /**
   * Trim high-document-frequency terms out of the query before embedding.
   *
   * Failure here is never fatal: preprocessing is a retrieval *improvement*,
   * so a broken frequency query should degrade to the unprocessed lookup that
   * shipped in M7 rather than fail the Warden's turn. It is logged at warn so
   * a persistently broken path is visible rather than silently costing recall.
   */
  private async preprocess(
    systemId: string,
    query: string,
  ): Promise<{ query: string; applied: boolean }> {
    try {
      const terms = await this.repo.queryTermFrequencies({ systemId, query });
      const result = preprocessQuery(query, terms);
      if (result.applied) {
        this.logger.debug(
          `rules_lookup query trimmed: dropped [${result.dropped.join(', ')}]`,
        );
      }
      return { query: result.query, applied: result.applied };
    } catch (err) {
      this.logger.warn(
        `query preprocessing failed, embedding the raw query instead: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return { query, applied: false };
    }
  }
}
