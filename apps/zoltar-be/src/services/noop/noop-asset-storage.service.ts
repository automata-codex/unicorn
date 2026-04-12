import { Injectable, Logger } from '@nestjs/common';
import { AssetStorageService } from '@uv/service-interfaces';

@Injectable()
export class NoopAssetStorageService extends AssetStorageService {
  private readonly logger = new Logger(NoopAssetStorageService.name);
  private warned = false;

  async upload(
    key: string,
    _data: Buffer,
    _contentType: string,
  ): Promise<string> {
    this.warnOnce();
    return key;
  }

  async getSignedUrl(key: string): Promise<string> {
    this.warnOnce();
    return `noop://${key}`;
  }

  private warnOnce(): void {
    if (!this.warned) {
      this.logger.debug(
        'NoopAssetStorageService active — uploads are dropped and URLs are placeholders.',
      );
      this.warned = true;
    }
  }
}
