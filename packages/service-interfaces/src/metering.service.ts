export abstract class MeteringService {
  abstract recordTokenUsage(
    adventureId: string,
    promptTokens: number,
    completionTokens: number,
  ): Promise<void>;
}
