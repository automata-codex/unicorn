import { Injectable, Logger } from '@nestjs/common';
import { EntitlementsService } from '@uv/service-interfaces';

@Injectable()
export class NoopEntitlementsService extends EntitlementsService {
  private readonly logger = new Logger(NoopEntitlementsService.name);
  private warned = false;

  async canCreateAdventure(_userId: string): Promise<boolean> {
    if (!this.warned) {
      this.logger.debug(
        'NoopEntitlementsService active — all adventure creation requests will be permitted.',
      );
      this.warned = true;
    }
    return true;
  }
}
