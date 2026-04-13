import { Injectable, Logger } from '@nestjs/common';
import { FeatureFlagService } from '@uv/service-interfaces';

@Injectable()
export class NoopFeatureFlagService extends FeatureFlagService {
  private readonly logger = new Logger(NoopFeatureFlagService.name);
  private warned = false;

  async isEnabled(
    _flag: string,
    _context?: Record<string, unknown>,
  ): Promise<boolean> {
    if (!this.warned) {
      this.logger.debug(
        'NoopFeatureFlagService active — every feature flag will report disabled.',
      );
      this.warned = true;
    }
    return false;
  }
}
