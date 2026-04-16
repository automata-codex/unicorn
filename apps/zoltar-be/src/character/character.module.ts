import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CampaignModule } from '../campaign/campaign.module';

import { CharacterController } from './character.controller';
import { CharacterRepository } from './character.repository';
import { CharacterService } from './character.service';

@Module({
  imports: [AuthModule, CampaignModule],
  controllers: [CharacterController],
  providers: [CharacterRepository, CharacterService],
  exports: [CharacterService],
})
export class CharacterModule {}
