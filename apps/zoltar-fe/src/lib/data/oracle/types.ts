export type OracleEntry = {
  id: string;
  player_text: string;
  claude_text: string;
  interfaces: Array<{
    condition: string;
    note: string;
  }>;
  tags: string[];
};

export type OracleTable = {
  id: string;
  system: string;
  category: string;
  version: string;
  entries: OracleEntry[];
};

export type OracleCategory = {
  id: string;
  label: string;
  entries: OracleEntry[];
};
