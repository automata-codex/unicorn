import { Injectable } from '@nestjs/common';

import { VoyageService } from '../voyage/voyage.service';

import { RulesRepository } from './rules.repository';

import type {
  RulesLookupInput,
  RulesLookupOutput,
} from '../session/session.schema';

@Injectable()
export class RulesLookupService {
  constructor(
    private readonly repo: RulesRepository,
    private readonly voyage: VoyageService,
  ) {}

  /**
   * Semantic lookup against the rules index for a given game system. The
   * Voyage embedding call still fires even when the index is empty — every
   * lookup attempt is telemetry input for M7.2 ingestion prioritization, and
   * short-circuiting would hide which queries the Warden made.
   */
  async lookup(
    systemId: string,
    input: RulesLookupInput,
  ): Promise<RulesLookupOutput> {
    const embedding = await this.voyage.embed(input.query, 'query');
    const limit = input.limit ?? 3;
    const matches = await this.repo.findByCosineSimilarity({
      systemId,
      embedding,
      limit,
    });
    return {
      results: matches.map((m) => ({
        text: m.content,
        source: m.source,
        similarity: m.similarity,
      })),
    };
  }
}
