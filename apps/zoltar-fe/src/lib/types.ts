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

export type Character = {
  id: string;
  name: string;
  class: string;
  pronouns?: string;
  stats?: Record<string, number>;
};
