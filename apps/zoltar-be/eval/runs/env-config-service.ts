import type { ConfigService } from '@nestjs/config';

/**
 * `AnthropicService` only ever calls `config.getOrThrow('ANTHROPIC_API_KEY')`
 * — a full `ConfigService`/DI container is unnecessary just to read one env
 * var, so this stubs the one method it actually uses. Shared by every
 * script that constructs `AnthropicService` directly (no Nest DI, no
 * database) — `eval-replay.ts` and `eval-judge-variance.core.ts` — so
 * there's one definition, not a copy per script.
 */
export function envOnlyConfigService(): ConfigService {
  return {
    getOrThrow: (key: string) => {
      const value = process.env[key];
      if (!value) {
        throw new Error(`this command requires ${key} in the environment`);
      }
      return value;
    },
  } as unknown as ConfigService;
}
