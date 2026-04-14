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
  createdAt: string;
  completedAt: string | null;
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
    currentHp: number;
    maxHp: number;
    stress: { current: number; max: number };
    skills: string[];
    equipment: string[];
    notes?: string;
  };
};
