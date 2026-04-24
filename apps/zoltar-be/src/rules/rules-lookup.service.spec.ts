import { describe, expect, it, vi } from 'vitest';

import { VoyageService } from '../voyage/voyage.service';

import { type RulesChunkMatch, RulesRepository } from './rules.repository';
import { RulesLookupService } from './rules-lookup.service';

function makeMocks(
  embedding: number[],
  matches: RulesChunkMatch[],
): {
  voyage: VoyageService;
  repo: RulesRepository;
  embed: ReturnType<typeof vi.fn>;
  findByCosineSimilarity: ReturnType<typeof vi.fn>;
} {
  const embed = vi.fn().mockResolvedValue(embedding);
  const findByCosineSimilarity = vi.fn().mockResolvedValue(matches);
  return {
    voyage: { embed } as unknown as VoyageService,
    repo: { findByCosineSimilarity } as unknown as RulesRepository,
    embed,
    findByCosineSimilarity,
  };
}

describe('RulesLookupService.lookup', () => {
  it('embeds the query with input_type: query and passes it to the repo', async () => {
    const { voyage, repo, embed, findByCosineSimilarity } = makeMocks(
      [0.1, 0.2, 0.3],
      [],
    );
    const service = new RulesLookupService(repo, voyage);

    await service.lookup('system-uuid', {
      query: 'panic check result of 73',
      limit: 3,
    });

    expect(embed).toHaveBeenCalledWith('panic check result of 73', 'query');
    expect(findByCosineSimilarity).toHaveBeenCalledWith({
      systemId: 'system-uuid',
      embedding: [0.1, 0.2, 0.3],
      limit: 3,
    });
  });

  it('defaults limit to 3 when omitted', async () => {
    const { voyage, repo, findByCosineSimilarity } = makeMocks([0.1], []);
    const service = new RulesLookupService(repo, voyage);

    // Simulate the Zod-parsed shape where limit fell through as undefined —
    // the service's ?? 3 guard covers callers that bypass the default.
    await service.lookup('s', {
      query: 'q',
    } as unknown as Parameters<typeof service.lookup>[1]);

    expect(findByCosineSimilarity).toHaveBeenCalledWith({
      systemId: 's',
      embedding: [0.1],
      limit: 3,
    });
  });

  it('maps repository matches into RulesLookupOutput shape', async () => {
    const matches: RulesChunkMatch[] = [
      {
        source: 'Player Survival Guide p.42',
        content: 'On a panic result of 71–80…',
        similarity: 0.87,
      },
      {
        source: 'Player Survival Guide p.38',
        content: 'Stress accumulates when…',
        similarity: 0.74,
      },
    ];
    const { voyage, repo } = makeMocks([0.1], matches);
    const service = new RulesLookupService(repo, voyage);

    const result = await service.lookup('s', { query: 'panic', limit: 5 });

    expect(result).toEqual({
      results: [
        {
          text: 'On a panic result of 71–80…',
          source: 'Player Survival Guide p.42',
          similarity: 0.87,
        },
        {
          text: 'Stress accumulates when…',
          source: 'Player Survival Guide p.38',
          similarity: 0.74,
        },
      ],
    });
  });

  it('returns { results: [] } on the empty-index path (M7 default)', async () => {
    const { voyage, repo, embed } = makeMocks([0.1], []);
    const service = new RulesLookupService(repo, voyage);

    const result = await service.lookup('s', { query: 'panic', limit: 3 });

    expect(result).toEqual({ results: [] });
    // Voyage is still called on the empty-index path — every attempt is M7.2
    // ingestion-prioritization signal, so we do not short-circuit around it.
    expect(embed).toHaveBeenCalledTimes(1);
  });

  it('propagates VoyageService errors to the caller', async () => {
    const voyage = {
      embed: vi.fn().mockRejectedValue(new Error('Voyage API error 429')),
    } as unknown as VoyageService;
    const findByCosineSimilarity = vi.fn();
    const repo = {
      findByCosineSimilarity,
    } as unknown as RulesRepository;
    const service = new RulesLookupService(repo, voyage);

    await expect(
      service.lookup('s', { query: 'panic', limit: 3 }),
    ).rejects.toThrow(/429/);
    expect(findByCosineSimilarity).not.toHaveBeenCalled();
  });
});
