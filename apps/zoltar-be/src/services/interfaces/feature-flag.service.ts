export abstract class FeatureFlagService {
  abstract isEnabled(
    flag: string,
    context?: Record<string, unknown>,
  ): Promise<boolean>;
}
