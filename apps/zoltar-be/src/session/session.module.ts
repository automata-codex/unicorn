import { Module } from '@nestjs/common';

import { AnthropicModule } from '../anthropic/anthropic.module';

/**
 * Session-time Claude integration. Turn loop: state snapshot assembly, prompt
 * caching, message window trimming, `submit_gm_response` parsing. Controllers,
 * providers, and DB repository are filled in by Phase 5 of the M5 plan.
 */
@Module({
  imports: [AnthropicModule],
  providers: [],
  controllers: [],
  exports: [],
})
export class SessionModule {}
