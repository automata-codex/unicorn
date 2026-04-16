import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { CampaignModule } from '../campaign/campaign.module';

import { AdventureController } from './adventure.controller';
import { AdventureRepository } from './adventure.repository';
import { AdventureService } from './adventure.service';

@Module({
  imports: [AuthModule, CampaignModule],
  controllers: [AdventureController],
  providers: [AdventureRepository, AdventureService],
  exports: [AdventureService],
})
export class AdventureModule {}
