import { Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';

import { DB_TOKEN, type Db } from '../db/db.provider';

export interface RulesChunkMatch {
  source: string;
  content: string;
  similarity: number;
}

export interface QueryTermFrequency {
  position: number;
  word: string;
  lexeme: string;
  documentFrequency: number;
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

  /**
   * Tokenize a query and measure each content word's document frequency
   * within one system's chunks.
   *
   * `ts_debug` rather than `to_tsvector` because the caller needs both halves
   * of each token: the lexeme decides whether a word survives preprocessing,
   * and the original word is what gets embedded. `to_tsvector` discards the
   * original spelling, and rebuilding a query out of stems is not what any
   * measured improvement came from.
   *
   * Stopwords fall out for free — the `english` dictionary maps them to an
   * empty lexeme array, and they are filtered here.
   *
   * Computed live rather than cached in a new table: no migration, and at
   * Mothership's ~66 chunks the scan is negligible against a Voyage round
   * trip that is ~98% of the query's latency budget. The `tsv` CTE is what
   * keeps it that way — `to_tsvector` runs once per chunk, not once per chunk
   * per query term. A Phase 3 corpus of thousands of chunks changes this cost
   * profile and is flagged as a deferral rather than solved here.
   *
   * The `LEFT JOIN … ON true` is deliberate: against an empty index the terms
   * must still come back, each with frequency 0, so the caller can tell
   * "corpus has nothing to say" from "query had no content words."
   */
  async queryTermFrequencies(args: {
    systemId: string;
    query: string;
  }): Promise<QueryTermFrequency[]> {
    const result = await this.db.execute<{
      position: number;
      word: string;
      lexeme: string;
      matches: string;
      total: string;
    }>(sql`
      WITH chunk_tsv AS (
        SELECT to_tsvector('english', content) AS tsv
        FROM rules_chunk
        WHERE system_id = ${args.systemId}
      ),
      tokens AS (
        SELECT d.ord AS position, d.token, d.lexemes[1] AS lexeme
        FROM ts_debug('english', ${args.query})
             WITH ORDINALITY AS d(alias, description, token,
                                  dictionaries, dictionary, lexemes, ord)
        WHERE array_length(d.lexemes, 1) > 0
      )
      SELECT t.position::int                                            AS position,
             t.token                                                    AS word,
             t.lexeme                                                   AS lexeme,
             count(c.tsv) FILTER (
               WHERE c.tsv @@ plainto_tsquery('simple', t.lexeme)
             )                                                          AS matches,
             (SELECT count(*) FROM chunk_tsv)                           AS total
      FROM tokens t
      LEFT JOIN chunk_tsv c ON true
      GROUP BY t.position, t.token, t.lexeme
      ORDER BY t.position
    `);

    return result.rows.map((row) => {
      const total = Number(row.total);
      return {
        position: Number(row.position),
        word: row.word,
        lexeme: row.lexeme,
        documentFrequency: total > 0 ? Number(row.matches) / total : 0,
      };
    });
  }
}
