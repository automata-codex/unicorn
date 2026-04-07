// --- Character ---

export type MothershipCharacter = {
	id: string;
	name: string;
	class: 'marine' | 'android' | 'scientist' | 'teamster';
	stats: {
		strength: number;
		speed: number;
		intellect: number;
		combat: number;
	};
	saves: {
		fear: number;
		sanity: number;
		body: number;
		armor: number;
	};
	maxHp: number;
	skills: string[];
};

// --- Resource Pools ---

export type ResourcePool = {
	current: number;
	max: number | null;
};

export type ResourcePools = Record<string, ResourcePool>;

// --- Entities ---

export type EntityStatus = 'alive' | 'dead' | 'unknown';

export type EntityState = {
	position?: { x: number; y: number };
	visible: boolean;
	status: EntityStatus;
	npcState?: string;
};

// --- Flags ---

export type Flags = Record<string, boolean>;

// --- GM Context ---

export type GmContextStructured = {
	entities: Array<{
		id: string;
		type: 'npc' | 'threat' | 'feature';
		startingPosition?: { x: number; y: number };
		visible: boolean;
		status?: EntityStatus;
		tags: string[];
	}>;
	initialFlags: Record<string, boolean>;
	flagTriggers: Record<string, string>;
	initialState: Record<string, unknown>;
};

// --- Messages ---

export type GameMessage = {
	role: 'user' | 'assistant';
	content: string;
	turn: number;
	timestamp: string; // ISO 8601
};

// --- Turn Log ---

export type TurnLogEntry = {
	turn: number;
	snapshotSent: object;
	stateChanges: object | null;
	diceRolls: Array<{
		purpose: string;
		notation: string;
		result: number;
		source: 'system' | 'player';
	}>;
	tokens: {
		promptTokens: number;
		completionTokens: number;
	};
};

// --- App State ---

export type AppState = {
	// Setup
	apiKey: string;
	character: MothershipCharacter | null;
	gmContextBlob: string | null;
	gmContextStructured: GmContextStructured | null;
	openingNarration: string | null;

	// Play
	resourcePools: ResourcePools;
	wounds: Record<string, string[]>;
	entities: Record<string, EntityState>;
	flags: Flags;
	flagTriggers: Record<string, string>;
	npcStates: Record<string, string>;
	pendingCanon: Array<{ summary: string; context: string }>;

	// Conversation
	messages: GameMessage[];
	canonLog: Array<{ turn: number; summary: string; context: string }>;
	turnLog: TurnLogEntry[];
	turn: number;

	// UI
	view: 'setup' | 'play';
	loading: boolean;
	pendingDiceRequests: DiceRequest[];
	errors: string[];
};

// --- Oracle Tables ---

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

// --- Dice ---

export type RollDiceOutput = {
	notation: string;
	results: number[];
	modifier: number;
	total: number;
};

export type DiceRequest = {
	notation: string;
	purpose: string;
	target: number | null;
};

// --- API Response Types ---

export type SubmitGmResponse = {
	playerText: string;
	stateChanges?: {
		resourcePools?: Record<string, { delta: number }>;
		entities?: Record<
			string,
			{
				position?: { x: number; y: number };
				visible?: boolean;
				status?: EntityStatus;
			}
		>;
		flags?: Record<string, boolean>;
		flagTriggers?: Record<string, string>;
	};
	gmUpdates?: {
		npcStates?: Record<string, string>;
		notes?: string;
		proposedCanon?: Array<{ summary: string; context: string }>;
	};
	diceRequests?: DiceRequest[];
};

export type SubmitGmContext = {
	narrative: {
		location: string;
		atmosphere: string;
		npcAgendas: Record<string, string>;
		hiddenTruth: string;
		oracleConnections: string;
	};
	structured: GmContextStructured;
	openingNarration: string;
};
