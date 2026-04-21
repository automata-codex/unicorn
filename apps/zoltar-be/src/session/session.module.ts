import { Module } from '@nestjs/common';

import { AdventureModule } from '../adventure/adventure.module';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { AuthModule } from '../auth/auth.module';
import { CampaignModule } from '../campaign/campaign.module';
import { SynthesisModule } from '../synthesis/synthesis.module';

import { SessionController } from './session.controller';
import { SessionRepository } from './session.repository';
import { SessionService } from './session.service';

/**
 * Session-time Claude integration. Turn loop: state snapshot assembly, prompt
 * caching, message window trimming, `submit_gm_response` parsing. State
 * mutation, canon routing, and telemetry writes are M6.
 */
@Module({
  imports: [
    AnthropicModule,
    AuthModule,
    AdventureModule,
    CampaignModule,
    SynthesisModule,
  ],
  controllers: [SessionController],
  providers: [SessionRepository, SessionService],
  exports: [SessionService],
})
export class SessionModule {}
