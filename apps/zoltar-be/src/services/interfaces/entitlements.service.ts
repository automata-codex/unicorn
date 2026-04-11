export abstract class EntitlementsService {
  abstract canCreateAdventure(userId: string): Promise<boolean>;
}
