import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';

import { CampaignController } from './campaign.controller';
import { CampaignRepository } from './campaign.repository';
import { CampaignService } from './campaign.service';

@Module({
  imports: [AuthModule],
  controllers: [CampaignController],
  providers: [CampaignRepository, CampaignService],
  exports: [CampaignService, CampaignRepository],
})
export class CampaignModule {}
