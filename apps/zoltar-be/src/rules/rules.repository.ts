import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DB_TOKEN, type Db } from '../db/db.provider';

export interface RulesChunkMatch {
  source: string;
  content: string;
  similarity: number;
}

/**
 * Serializes a JS number[] to a pgvector text literal (`'[0.1,0.2,…]'`) so the
 * `::vector` cast can parse it. The `pg` driver would otherwise send a JS
 * array as a postgres array literal `'{0.1,0.2,…}'`, which the `vector` type
 * does not accept.
 */
function vectorLiteral(embedding: number[]): string {
  return `[${embedding.join(',')}]`;
}

@Injectable()
export class RulesRepository {
  constructor(@Inject(DB_TOKEN) private readonly db: Db) {}

  /**
   * Cosine-similarity search over `rules_chunk`, filtered by `system_id`.
   * Returns rows ordered by decreasing similarity; empty array when the index
   * has no rows for the requested system (the expected M7 runtime state —
   * ingestion ships in M7.2).
   *
   * `<=>` is pgvector's cosine-distance operator; similarity = 1 - distance.
   */
  async findByCosineSimilarity(args: {
    systemId: string;
    embedding: number[];
    limit: number;
  }): Promise<RulesChunkMatch[]> {
    const vec = vectorLiteral(args.embedding);
    const result = await this.db.execute<{
      source: string;
      content: string;
      similarity: number;
    }>(sql`
      SELECT source,
             content,
             1 - (embedding <=> ${vec}::vector) AS similarity
      FROM rules_chunk
      WHERE system_id = ${args.systemId}
        AND embedding IS NOT NULL
      ORDER BY embedding <=> ${vec}::vector
      LIMIT ${args.limit}
    `);
    return result.rows.map((r) => ({
      source: r.source,
      content: r.content,
      similarity: Number(r.similarity),
    }));
  }
}
