import { Global, Module } from '@nestjs/common';
import {
  AssetStorageService,
  EmailService,
  EntitlementsService,
  FeatureFlagService,
  MeteringService,
  RealtimeService,
} from '@uv/service-interfaces';

import { AdventureModule } from './adventure/adventure.module';
import { AuthModule } from './auth/auth.module';
import { CampaignModule } from './campaign/campaign.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { GridModule } from './grid/grid.module';
import { HealthModule } from './health/health.module';
import { NoopAssetStorageService } from './services/noop/noop-asset-storage.service';
import { NoopEntitlementsService } from './services/noop/noop-entitlements.service';
import { NoopFeatureFlagService } from './services/noop/noop-feature-flag.service';
import { NoopMeteringService } from './services/noop/noop-metering.service';
import { NoopRealtimeService } from './services/noop/noop-realtime.service';
import { SmtpEmailService } from './services/smtp-email.service';

const deferredServiceProviders = [
  { provide: EntitlementsService, useClass: NoopEntitlementsService },
  { provide: MeteringService, useClass: NoopMeteringService },
  { provide: EmailService, useClass: SmtpEmailService },
  { provide: AssetStorageService, useClass: NoopAssetStorageService },
  { provide: RealtimeService, useClass: NoopRealtimeService },
  { provide: FeatureFlagService, useClass: NoopFeatureFlagService },
];

@Global()
@Module({
  imports: [
    ConfigModule,
    DbModule,
    HealthModule,
    CampaignModule,
    AdventureModule,
    AuthModule,
    GridModule,
  ],
  providers: deferredServiceProviders,
  exports: deferredServiceProviders,
})
export class AppModule {}
