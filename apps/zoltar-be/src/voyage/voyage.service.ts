import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type EmbeddingInputType = 'query' | 'document';

export class VoyageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoyageError';
  }
}

/**
 * Thin wrapper around the Voyage AI embeddings endpoint. Uses `fetch` directly
 * rather than the Voyage SDK — the request is a single well-documented POST.
 *
 * `input_type` matters:
 *   - `query`    — at rules_lookup time (exercised in M7 runtime).
 *   - `document` — at ingestion time (exercised by the Python pipeline in M7.2,
 *     not the runtime TypeScript path; supported here for symmetry).
 *
 * The configured `VOYAGE_EMBED_MODEL` must match whatever model was used to
 * embed the `rules_chunk` rows. Mismatched models produce meaningless cosine
 * distances.
 */
@Injectable()
export class VoyageService {
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: ConfigService) {
    this.apiKey = config.getOrThrow<string>('VOYAGE_API_KEY');
    this.model = config.getOrThrow<string>('VOYAGE_EMBED_MODEL');
  }

  async embed(input: string, inputType: EmbeddingInputType): Promise<number[]> {
    const response = await fetch('https://api.voyageai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        input: [input],
        model: this.model,
        input_type: inputType,
      }),
    });

    if (!response.ok) {
      const body = await response.text();
      throw new VoyageError(`Voyage API error ${response.status}: ${body}`);
    }

    const json = (await response.json()) as {
      data?: Array<{ embedding?: number[] }>;
    };
    const embedding = json.data?.[0]?.embedding;
    if (!embedding) {
      throw new VoyageError('Voyage API returned no embedding');
    }
    return embedding;
  }
}
