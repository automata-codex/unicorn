export abstract class AssetStorageService {
  abstract upload(
    key: string,
    data: Buffer,
    contentType: string,
  ): Promise<string>;
  abstract getSignedUrl(key: string): Promise<string>;
}
