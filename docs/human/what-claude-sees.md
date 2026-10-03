# What Claude Sees

The data that is sent to Claude varies between the initial request and what Claude receives in response to calling tools (covered in the "[Tool Loop and Corrections](./tool-loop-and-corrections.md)" article). 

## Initial Request

The initial request is organized into the following sections:

1. System prompt (cached):
   1. Formatted GM context
   2. Warden Prompt
2. Messages
   1. State snapshot
   2. Message window
   3. Dice results
   4. Player Message
3. Tool choice
4. Tools

### System Prompt

The system prompt rarely changes between turns, allowing it to be partially or completely cached by the Anthropic API. Caching reduces the cost of each API request.

#### Formatted GM Context

The GM context is formatted into the following sections, each of which is optional:

- **Narrative:** A description of the storyline including the scenario premise, atmosphere, NPC agendas, hidden truths, and connections from the story oracles. 
- **Entities:** Things in the adventure apart from the PC and the setting, including NPCs and threats.
- **Flags:** Flags are conditions that are set during the adventure synthesis step. For example, if there's a risk of the ship's reactor melting down, then there would be a `reactor_meltdown` flag that could be `true` or `false`. This section stores the immutable parts of a flag, such as its trigger condition, and its starting value.

The GM context is formatted as plain key/value lines separated into sections with XML tags like `<narrative>...</narrative>`. 

#### Warden Prompt

The Warden prompt is included verbatim from a file in the `apps/zoltar-be/src/wardens/prompts` directory. The filename consists of the system slug and a version suffix. The system chooses the file with the highest version unless a specific file is specified via an environment variable. The prompt is stored as a plain text file because every telemetry row records the filename and a hash of its text.

### Messages

The content of this section is revised on every turn, so caching is not possible. 

#### State Snapshot

The state is stored as JSONB data in the database, which is validated with the `MothershipCampaignStateSchema` Zod schema. This is the "typed envelope + JSONB" pattern. The state snapshot includes:

- **Resource pools:** HP, stress, stats, saves and so on, as `owner.pool: current/max`.
- **Character attributes:** Per-entity state that is neither a pool nor immutable creation data: conditions, skills, equipment, worn armor, minimum stress, bleeding, and a pending Death Save.
- **Entities:** Variable state for things in the adventure apart from the setting such as the PC, NPCs, and threats. Variable state includes visibility and status.
- **Flags:** The current value for a flag is stored here because it is mutable data. The triggers for flags are immutable and stored in the system prompt. Flags created during play aren't in the GM context, so their trigger appears here in the snapshot.
- **Scenario state:** Scenario counters, like a countdown, with an optional note.
- **World facts:** Facts about the world that the Warden creates during play.

The state snapshot is included as plain key/value lines separated into sections with XML tags.

#### Message Window 

All messages from the chat history are included in the payload up to a limit of 40 KB. The first message that would cause the JSON representation to exceed this size and all prior messages are dropped. If the most recent message exceeds this size, then that's the only message included. It's included in its entirety on the grounds that it's better to exceed the limit than cut the message in the middle. Messages arrive from the database oldest first; the code walks backward from the newest to decide which to keep, and returns them oldest first. Messages are returned in chronological order (most recent last). 

#### Dice Results

Player-submitted `dice_roll` events, if any, form the next part of the request. This includes rolls that the player rolled themselves and then entered manually and rolls that the player requested the front-end to roll for them. In no case does the LLM generate random dice results. Dice results are joined to corresponding dice requests, so each result carries the purpose and target of the request it answers.

#### Player Message

The message entered by the player in the UI is rendered verbatim on a regular turn and omitted on an auto-advance turn. An auto-advance turn happens when submitting the last pending dice result starts the next turn. In that case, the dice results block is the last thing in the request.


### Tools

The tools section forms a third part of the request, next to the system prompt and messages.

#### Tool Choice

In the request, tool choice is set to `{ type: 'any' }`, which means that Claude must call a tool for any response it wants to make.

#### Available Tools

The following tools are available to Claude:

- **`submit_gm_response`:** This tool ends Claude's turn. It is used to submit narration, requests for the player to roll dice, changes to the game state, and so on.
- **`roll_dice`:** This tool allows Claude to roll dice. The full flow is detailed in the "[Tool Loop and Corrections](./tool-loop-and-corrections.md)" article.
- **`rules_lookup`:** This tool is used to look up rules text via RAG. The full flow is detailed in the "[Rules Lookup](./rules-lookup.md)" article.

Each tool is submitted with a JSON schema generated from a corresponding Zod schema. The Zod schemas include descriptions for many of their fields, and these descriptions are provided to Claude so it knows how to use each individual field. Thus, editing a description may change the Warden's behavior even though it looks like an ordinary code change.
