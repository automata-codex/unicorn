import { Module } from '@nestjs/common';

import { AdventureModule } from '../adventure/adventure.module';
import { AnthropicModule } from '../anthropic/anthropic.module';
import { AuthModule } from '../auth/auth.module';
import { CampaignModule } from '../campaign/campaign.module';
import { CharacterModule } from '../character/character.module';

import { SynthesisController } from './synthesis.controller';
import { SynthesisRepository } from './synthesis.repository';
import { SynthesisService } from './synthesis.service';

@Module({
  imports: [
    AnthropicModule,
    AuthModule,
    AdventureModule,
    CampaignModule,
    CharacterModule,
  ],
  controllers: [SynthesisController],
  providers: [SynthesisRepository, SynthesisService],
  exports: [SynthesisService],
})
export class SynthesisModule {}
