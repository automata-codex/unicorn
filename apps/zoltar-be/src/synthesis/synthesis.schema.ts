import { MothershipCrewRoleEnum } from '@uv/game-systems';
import { z } from 'zod';

const entitySchema = z
  .object({
    id: z
      .string()
      .min(1)
      .describe(
        "The entity's canonical identifier, and the string every other part " +
          'of the context refers to it by — pool owners in `initialState`, ' +
          'keys in `npcAgendas`, mentions in a flag `trigger`. Lowercase, ' +
          'underscores only, no dots or hyphens: `corporate_spy_1`, ' +
          '`dr_chen`. It is not a display name and is never narrated; the ' +
          'name the players hear belongs in `tags` or the agenda text. Pick ' +
          'it from the oracle entry id the entity came from where one exists.',
      ),
    type: z
      .enum(['npc', 'threat', 'feature'])
      .describe(
        'What kind of thing this is. `npc` is a person who can be talked to ' +
          'and who wants something — every `npc` should have an entry in ' +
          '`npcAgendas`. `threat` is what the adventure is dangerous because ' +
          'of: it need not be a creature, but it acts. `feature` is a fixed ' +
          'part of the location that the crew interacts with and that does ' +
          'not act on its own — a sealed hatch, a reactor, a terminal. If it ' +
          'wants something it is not a feature.',
      ),
    /**
     * The Contractor's crew role (`ADR-0100`). `npc` only.
     *
     * **`instinctRoll` is deliberately absent from this schema.** The backend
     * rolls Instinct; synthesis has no `roll_dice`, so a number the model
     * supplied would be a fabrication rather than a roll. Leaving the field out
     * means `.strip()` drops it rather than trusting a prompt instruction not to
     * send one — `ADR-0097` is the precedent for not relying on the prompt where
     * a schema can enforce it.
     */
    crewRole: MothershipCrewRoleEnum.optional().describe(
      'The job this person holds aboard, drawn from a fixed list. `npc` ' +
        'only — threats and features never take a role. Most NPCs are crew ' +
        'and should have one. Leave it unset for an NPC who is not crew at ' +
        'all: a passenger, a corporate observer, a stranger. Setting it does ' +
        'not give the entity any stats — do not supply Instinct or any other ' +
        'number anywhere on this entity, because the backend rolls Instinct ' +
        'for every NPC and discards whatever you send.',
    ),
    /**
     * **`x`/`y`/`z` are deliberately left undescribed**, against the
     * schema-is-the-home policy, because no axis convention exists to state.
     * Nothing documents whether `y` runs up or down the grid or whether `z`
     * is positive-up, and `grid_cell` carries both a `z` and an `elevation`
     * (`db/schema.ts:283,288`) with nothing distinguishing them. A
     * description here would be an invented convention arriving as
     * documentation, which is worse than the gap. Describe them when the 2D
     * renderer fixes the axes — that is the change that makes the field
     * readable at all.
     */
    startingPosition: z
      .object({
        x: z.number().int(),
        y: z.number().int(),
        z: z.number().int().default(0),
      })
      .optional()
      .describe(
        'Grid coordinates for the future 2D renderer, not a description of ' +
          'where the entity is. Nothing reads it during play: it is written ' +
          'to a table the Warden never sees, and no snapshot carries it. ' +
          'Where an entity is in the fiction is carried by `worldFacts` and ' +
          'by narration, so omit this unless the scenario genuinely has a ' +
          'grid in mind. Omitting it costs nothing.',
      ),
    visible: z
      .boolean()
      .describe(
        'Line of sight at the moment play begins: can the crew see this entity ' +
          'in the opening scene? Transient — it changes in both directions ' +
          'during play as entities move in and out of view. Whether the crew ' +
          'knows the entity exists at all is `revealed`.',
      ),

    /**
     * Discovery (`ADR-0101`). Optional here, unlike on `EntitySchema`, and
     * defaulted to `visible` by `buildEntityMap` when omitted — at synthesis the
     * two usually coincide, and asking the author for a second boolean they will
     * almost always set to the first is how a field stops being read.
     *
     * It is offered at all because one combination is genuinely useful:
     * `visible: false, revealed: true` is an entity the crew already knows about
     * but cannot currently see — the cartographer in another compartment. The
     * mirror image is incoherent and rejected below: an entity in line of sight
     * has necessarily been discovered.
     */
    revealed: z
      .boolean()
      .optional()
      .describe(
        'Do the players know this entity exists when play begins? Omit it and ' +
          'it follows `visible`, which is almost always right. Set it ' +
          'explicitly for the one case that differs: `visible: false, ' +
          'revealed: true` is someone the crew already knows about who is not ' +
          'in the room — the cartographer in another compartment. ' +
          '`visible: true, revealed: false` is rejected: something in sight ' +
          'has been discovered.',
      ),

    tags: z
      .array(z.string())
      .describe(
        'Short lowercase keywords the Warden can pattern-match on: `crew`, ' +
          '`stowaway`, `armed`, `aft`. These are handles, not description — ' +
          "the entity's substance belongs in `npcAgendas` or `hiddenTruth`, " +
          'and a tag that reads like a sentence is doing the wrong job. Pass ' +
          'an empty array rather than inventing filler.',
      ),
  })
  .superRefine((entity, ctx) => {
    if (entity.visible && entity.revealed === false) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revealed'],
        message:
          'an entity in line of sight has been discovered: `visible: true` with `revealed: false` is not a state that exists',
      });
    }
  });

const flagSchema = z.object({
  value: z
    .boolean()
    .describe(
      'What the flag reads at the moment play begins. Almost always ' +
        '`false` — a flag exists to record something that has not happened ' +
        'yet. Set it `true` only for a condition the scenario opens with ' +
        'already satisfied.',
    ),
  trigger: z
    .string()
    .describe(
      'The specific in-fiction action or event that flips this flag, written ' +
        'so the Warden can tell mid-scene whether it has happened yet. Name ' +
        'the act and, where it is easy to confuse, the near miss that does ' +
        'not count: "Flip to true when the player or an NPC activates the ' +
        'beacon at the bridge console. Approaching the console is not ' +
        'sufficient." A trigger that restates the flag name ("when the ' +
        'beacon is active") tells the Warden nothing it did not have.',
    ),
});

export const submitGmContextSchema = z.object({
  openingNarration: z
    .string()
    .optional()
    .describe(
      'The ambient scene at the moment the player character enters the ' +
        'adventure, before any player agency. Establish the immediate ' +
        'physical situation, convey the atmosphere, and include one concrete ' +
        'detail the player did not put there — something that signals the ' +
        'world has already been in motion without them. This is the first ' +
        'thing the player reads and the only field here they ever see ' +
        'verbatim; everything else is written for the Warden.',
    ),

  /**
   * Authored prose that ships in the Warden's cached system block on every
   * turn of the adventure (`session.prompt.ts`, `formatGmContextBlob`). It is
   * fixed at synthesis and never revised during play, which is why each field
   * below says what it is *for* rather than only what it holds — a field the
   * Warden reads 50 times and misreads once is a defect that compounds.
   */
  narrative: z
    .object({
      location: z
        .string()
        .describe(
          'What this adventure is about: the situation the crew is in and ' +
            'why it matters, in two or three sentences. Scenario-level and ' +
            'fixed for the whole adventure — "The colony transport ESV ' +
            'Halbrecht, three weeks out from the nearest relay beacon, ' +
            'running silent since the last watch failed to report." It is ' +
            'NOT where anyone currently is: nothing here tracks the crew as ' +
            'they move, and the layout of the space belongs in `worldFacts`. ' +
            'Write the premise, not a position.',
        ),
      atmosphere: z
        .string()
        .describe(
          'How the place feels to be in — the sensory register the Warden ' +
            'should narrate in. Light, sound, smell, temperature, what the ' +
            'silence is like. One or two sentences. This is tone, not fact: ' +
            'anything the crew could be wrong about, or that the Warden ' +
            'needs to stay consistent on, belongs in `worldFacts` instead.',
        ),
      npcAgendas: z
        .record(z.string(), z.string())
        .describe(
          'Durable motivation, keyed by entity id: what this person wants, ' +
            'what they will not do to get it, and the condition under which ' +
            'they change course. Written once and true for the whole ' +
            'adventure — "withholding what they know out of guilt and fear ' +
            'of being blamed; they will only reveal it if pushed hard, or if ' +
            'the situation becomes lethal enough that silence is worse than ' +
            'confession." NOT a mood or a current state: "shaken but ' +
            'functional" is disposition, it changes every turn, and it has ' +
            'its own field during play. An agenda that could stop being true ' +
            'by the next scene is written at the wrong altitude.',
        ),
      hiddenTruth: z
        .string()
        .describe(
          'The answer to the mystery — what is actually going on, stated ' +
            'plainly, including whatever the crew is wrong about. The Warden ' +
            'reads this every turn and withholds it behaviourally, revealing ' +
            'it only as the fiction earns it, so write the truth itself and ' +
            'not a hint toward it. If the crew can never discover it, it is ' +
            'not this field.',
        ),
      oracleConnections: z
        .string()
        .describe(
          'How the oracle entries wire together into one scenario — which ' +
            'entry explains which, and what the causal spine is. This is the ' +
            'reasoning behind the premise rather than the premise itself, ' +
            'and it exists so the Warden extends the adventure along the ' +
            'seams you actually intended instead of guessing at them mid- ' +
            'session: "the signal in the sealed compartment is what the ' +
            'survivor fled, and the vessel type is why nobody answered it."',
        ),
    })
    .describe(
      'Authored prose the Warden reads on every turn. Fixed at synthesis and ' +
        'never revised during play.',
    ),

  structured: z
    .object({
      entities: z
        .array(entitySchema)
        .describe(
          'Everyone and everything in the adventure that the Warden runs: ' +
            'people, dangers, and the fixed parts of the location worth ' +
            'interacting with. Include entities the crew has not met and ' +
            'cannot yet see — the Warden needs them in order to run them ' +
            'off-screen, and `visible` / `revealed` are what control ' +
            'disclosure. Do not include the player character; they already ' +
            'exist.',
        ),
      flags: z
        .record(z.string(), flagSchema)
        .describe(
          'Named booleans tracking whether a scenario beat has happened yet, ' +
            'keyed in descriptive snake_case. Use one where the Warden needs ' +
            'to know later whether something already occurred — a door ' +
            'opened, a truth told, a beacon lit. Narrative secrets with no ' +
            'entity attached belong here; a secret that is *about* an entity ' +
            "is that entity's `revealed` instead.",
        ),
      initialState: z
        .record(z.string(), z.unknown())
        .describe(
          'Numeric state that changes over the adventure, as resource pools. ' +
            'Every key is a two-part address, "{owner}.{pool_name}" — the ' +
            'owning entity id, a dot, then the bare pool name: ' +
            '"crewman_wick.hp": { current: 12, max: 12 }. The owner must be ' +
            "an entity id declared in `entities`, or the player character's " +
            'entity id. A composite single-part key like "crewman_wick_hp" ' +
            'is discarded.\n\n' +
            'Pools belonging to no entity — station subsystems, ' +
            'environmental readings, adventure-wide countdowns — take the ' +
            'reserved owner "_scenario": "_scenario.reactor_pressure": ' +
            '{ current: 8, max: 8 }. "_scenario" is the only owner that may ' +
            'begin with an underscore; entity ids never do.\n\n' +
            'Anything that counts down over the adventure must be a pool ' +
            'here rather than a sentence somewhere else. Name it "timer" ' +
            'under the entity it belongs to — "crewman_wick.timer": ' +
            '{ current: 4, max: 4 } — or under "_scenario" when the ' +
            'countdown belongs to the adventure rather than to any one ' +
            'entity.\n\n' +
            "The player character's hp and stress pools already exist, " +
            'written at character creation. Do not re-create them: a second ' +
            'spelling produces two competing pools for one character. Any ' +
            'additional player-character pool must use that same entity id ' +
            'as its owner.',
        ),
      worldFacts: z
        .record(z.string(), z.string())
        .optional()
        .describe(
          'Non-numeric state the Warden must remember across turns, keyed in ' +
            'descriptive snake_case with plain string values. Numeric state ' +
            'goes in `initialState` instead.\n\n' +
            'The main use is the spatial layout of the adventure location — ' +
            'the connective tissue that keeps the Warden from contradicting ' +
            'itself about where things are relative to each other. Capture ' +
            'the overall shape of the space (a single ship, a station with ' +
            'several modules, a planet-side installation), the named areas ' +
            'that matter and how they connect, and notable features like ' +
            'chokepoints, hazards, landmarks or barriers. This is not a ' +
            'room-by-room description, not an inventory, and not entity ' +
            "placements — those live in `entities`. It is the Warden's " +
            'mental map.\n\n' +
            'For a simple scenario (one ship, a handful of compartments), ' +
            'use a single entry keyed descriptively. For a complex one ' +
            '(multi-module station, multi-level structure), split into ' +
            'several entries along whatever axis fits the fiction — per ' +
            'deck, per module, per zone. There is no required template.\n\n' +
            'Form — write the layout as an indexed list, not as a paragraph. ' +
            'A single prose run forces the Warden to re-parse the whole ' +
            'thing on every turn to answer "which level is X on", and that ' +
            'lookup is where it goes wrong. Open with one line naming the ' +
            'overall shape and the numbering convention, then one line per ' +
            'level or zone, then the connections between them as their own ' +
            'line. Where the space is stacked vertically, NUMBER THE DECKS ' +
            'FROM THE TOP DOWN — DECK 1 is the topmost — and keep the ' +
            'familiar name alongside the number, because the fiction will ' +
            'use both. Separate the lines with newlines inside the single ' +
            'string value.\n\n' +
            'Examples:\n' +
            '- ship_layout: "A light freighter with three decks, numbered ' +
            'from the top down and connected by a central ladder shaft.\n' +
            "DECK 1 (upper): bridge, comms array, captain's quarters.\n" +
            'DECK 2 (mid): crew berths, mess hall, medbay.\n' +
            'DECK 3 (lower): cargo bay, engine room, airlock.\n' +
            'Between decks: the ladder shaft is the only path, and it passes ' +
            'through the DECK 2 corridor."\n' +
            '- station_core: "A toroidal hub with four radial spokes, all on ' +
            'one level.\nSPOKE A: docking.\nSPOKE B: hydroponics.\n' +
            'SPOKE C: command.\nSPOKE D: sealed — hull breach.\n' +
            'Between spokes: all four meet at the hub ring, which is ' +
            'pressurized but unlit."\n\n' +
            'Other uses: environmental detail that must stay consistent ' +
            '(specific graffiti text, console readout content), NPC cover ' +
            'identities, the starting location name, and any other ' +
            'non-numeric fact the Warden must hold across turns.',
        ),
    })
    .describe(
      'The mechanical half of the context: what the backend stores as state ' +
        'and re-derives every turn, as opposed to `narrative`, which is ' +
        'prose the Warden reads.',
    ),
});

export type SubmitGmContext = z.infer<typeof submitGmContextSchema>;

export const coherenceConflictSchema = z.object({
  category: z
    .string()
    .describe(
      'The oracle category the conflict originates in, as one of the ' +
        'category names given in the selections: survivor, threat, secret, ' +
        'vessel_type, tone. Where two categories collide, name the one that ' +
        'would have to change.',
    ),
  description: z
    .string()
    .describe(
      'What the contradiction is, in one or two sentences, naming both ' +
        'entries and why they cannot both hold. Concrete enough that a ' +
        'reader who has not seen the selections can judge it.',
    ),
  rerollable: z
    .boolean()
    .describe(
      'Whether swapping this one category would resolve the conflict, ' +
        'leaving the rest of the selections intact. `false` when the ' +
        'contradiction is spread across several entries, so that changing ' +
        'any single one does not fix it.',
    ),
});

export const coherenceReportSchema = z
  .object({
    conflicts: z
      .array(coherenceConflictSchema)
      .describe(
        'Every hard contradiction found — combinations the adventure cannot ' +
          'narratively support without rewriting the seed content. An empty ' +
          'array is the expected result and means the selections are ' +
          'coherent. Tension that ordinary synthesis can resolve is not a ' +
          'conflict.',
      ),
    resolution: z
      .enum(['proceed', 'reroll', 'surface'])
      .describe(
        'What should happen next. `proceed` — the selections are coherent, ' +
          'or the tension is resolvable through narrative means. `reroll` — ' +
          'one specific category could be swapped to resolve it; set ' +
          '`rerollCategory` when you choose this. `surface` — the conflict ' +
          'is unresolvable and the player must adjust their filters.',
      ),
    rerollCategory: z
      .string()
      .optional()
      .describe(
        'Which oracle category to reroll, as one of: survivor, threat, ' +
          'secret, vessel_type, tone. REQUIRED when `resolution` is ' +
          '"reroll" — a reroll report without it is rejected. Omit it for ' +
          'every other resolution.',
      ),
  })
  .refine(
    (report) => report.resolution !== 'reroll' || !!report.rerollCategory,
    { message: 'rerollCategory is required when resolution is "reroll"' },
  );

export type CoherenceConflict = z.infer<typeof coherenceConflictSchema>;
export type CoherenceReport = z.infer<typeof coherenceReportSchema>;
