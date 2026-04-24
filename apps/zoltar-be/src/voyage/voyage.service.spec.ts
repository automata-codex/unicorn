import { ConfigService } from '@nestjs/config';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { VoyageError, VoyageService } from './voyage.service';

function makeConfig(overrides: Record<string, string> = {}): ConfigService {
  const values: Record<string, string> = {
    VOYAGE_API_KEY: 'pa-voyage-test',
    VOYAGE_EMBED_MODEL: 'voyage-3-lite',
    ...overrides,
  };
  return {
    getOrThrow: <T>(key: string) => values[key] as unknown as T,
  } as unknown as ConfigService;
}

function stubEmbeddingResponse(embedding: number[]): Response {
  return new Response(JSON.stringify({ data: [{ embedding }] }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('VoyageService.embed', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts to the Voyage embeddings endpoint with the expected body for a query', async () => {
    const embedding = Array(1024).fill(0.01);
    fetchMock.mockResolvedValueOnce(stubEmbeddingResponse(embedding));

    const service = new VoyageService(makeConfig());
    const result = await service.embed('panic check result of 73', 'query');

    expect(result).toEqual(embedding);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://api.voyageai.com/v1/embeddings');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'Content-Type': 'application/json',
      Authorization: 'Bearer pa-voyage-test',
    });
    expect(JSON.parse(init.body as string)).toEqual({
      input: ['panic check result of 73'],
      model: 'voyage-3-lite',
      input_type: 'query',
    });
  });

  it('passes input_type: document when embedding a document chunk', async () => {
    fetchMock.mockResolvedValueOnce(stubEmbeddingResponse([0.1, 0.2, 0.3]));

    const service = new VoyageService(makeConfig());
    await service.embed('Panic table — 71–80: …', 'document');

    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body as string).input_type).toBe('document');
  });

  it('uses the configured VOYAGE_EMBED_MODEL override', async () => {
    fetchMock.mockResolvedValueOnce(stubEmbeddingResponse([0.1]));

    const service = new VoyageService(
      makeConfig({ VOYAGE_EMBED_MODEL: 'voyage-3' }),
    );
    await service.embed('hello', 'query');

    const init = fetchMock.mock.calls[0][1];
    expect(JSON.parse(init.body as string).model).toBe('voyage-3');
  });

  it('throws VoyageError on a non-2xx response', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(new Response('rate limited', { status: 429 })),
    );

    const service = new VoyageService(makeConfig());
    await expect(service.embed('x', 'query')).rejects.toBeInstanceOf(
      VoyageError,
    );
    await expect(service.embed('x', 'query')).rejects.toThrow(/429/);
  });

  it('throws VoyageError when the response has no embedding', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(
        new Response(JSON.stringify({ data: [] }), { status: 200 }),
      ),
    );

    const service = new VoyageService(makeConfig());
    await expect(service.embed('x', 'query')).rejects.toBeInstanceOf(
      VoyageError,
    );
    await expect(service.embed('x', 'query')).rejects.toThrow(/no embedding/);
  });
});
