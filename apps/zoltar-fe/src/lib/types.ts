export type Campaign = {
  id: string;
  name: string;
  visibility: string;
  diceMode: string;
  createdAt: string;
};

export type Adventure = {
  id: string;
  campaignId: string;
  status: string;
  mode: string;
  callerId: string;
  openingNarration: string | null;
  createdAt: string;
  completedAt: string | null;
};

export type CoherenceConflict = {
  category: string;
  description: string;
};

export type CharacterSheet = {
  id: string;
  campaignId: string;
  system: string;
  data: {
    name: string;
    class: string;
    pronouns?: string;
    entityId: string;
    stats: Record<string, number>;
    saves: Record<string, number>;
    maxHp: number;
    maxStress: number;
    skills: string[];
    equipment: string[];
    notes?: string;
  };
};
