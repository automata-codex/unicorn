import { Module } from '@nestjs/common';
import { AdventureModule } from './adventure/adventure.module';
import { AuthModule } from './auth/auth.module';
import { CampaignModule } from './campaign/campaign.module';
import { ConfigModule } from './config/config.module';
import { DbModule } from './db/db.module';
import { GridModule } from './grid/grid.module';
import { HealthModule } from './health/health.module';
import { AssetStorageService } from './services/interfaces/asset-storage.service';
import { EmailService } from './services/interfaces/email.service';
import { EntitlementsService } from './services/interfaces/entitlements.service';
import { FeatureFlagService } from './services/interfaces/feature-flag.service';
import { MeteringService } from './services/interfaces/metering.service';
import { RealtimeService } from './services/interfaces/realtime.service';
import { NoopAssetStorageService } from './services/noop/noop-asset-storage.service';
import { NoopEmailService } from './services/noop/noop-email.service';
import { NoopEntitlementsService } from './services/noop/noop-entitlements.service';
import { NoopFeatureFlagService } from './services/noop/noop-feature-flag.service';
import { NoopMeteringService } from './services/noop/noop-metering.service';
import { NoopRealtimeService } from './services/noop/noop-realtime.service';

const deferredServiceProviders = [
  { provide: EntitlementsService, useClass: NoopEntitlementsService },
  { provide: MeteringService, useClass: NoopMeteringService },
  { provide: EmailService, useClass: NoopEmailService },
  { provide: AssetStorageService, useClass: NoopAssetStorageService },
  { provide: RealtimeService, useClass: NoopRealtimeService },
  { provide: FeatureFlagService, useClass: NoopFeatureFlagService },
];

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
