# Milestones

Milestones are presented in the order they were completed, which is not necessarily numerical or alphabetical order. A suggested structure for each section:

1. **Purpose:** why this milestone existed, in one sentence.
2. **Result:** what the system could do at the end that it couldn't at the start.
3. **Notable decisions:** anything that shaped later work.

## Milestone 1.0 -- Playtest Prototype

The goal for this milestone was to prove that an AI-powered GM for solo TTRPGs could be written and that it would provide a fun and satisfying experience. We built a front-end-only application that made calls directly to the Claude API. The application provides basic oracles[^1] and a chat interface. We ran six playtests. After each one, we updated the prompts, oracle tables, data model, and tool schemas. By the sixth iteration, we had a system that was fun to play.

[^1]: Oracles are random generation tables that provide inspiration and constraints for solo RPGs.

## Milestone M1 -- Local dev environment

This milestone's goal was to set up the local developer environment, including stubbing many modules for the back-end. The modules and their interfaces provide seams where the self-hosted and SaaS versions of the application will diverge later. Flyway is used to version and migrate the schema, and the Drizzle ORM package's schema is written to match the applied Flyway migrations. This milestone also added Dockerfiles for different ways to run the application stack, initial Taskfiles, and GitHub CI actions. By the end of this milestone, the whole application stack can be brought up locally with a single command, and CI actions run on every PR.  

## Milestone M2 -- Auth & CRUD

This milestone's purpose was to add an authentication flow and create basic CRUD endpoints for the back-end application. The auth flow consists of a magic-link sign-in process, fully implemented by this milestone. MailHog and Traefik (with HTTPS) were added to the Docker Compose stack. The back-end gained endpoints for adventures and campaigns, which write to the database via a repository layer. The initial front-end app was implemented using Svelte in SPA mode instead of SvelteKit[^2].

[^2]: The back-end drives the whole game and owns auth, and there's no SEO requirement, so SvelteKit's server-side rendering added complexity with no benefit.

## Milestone M2.5 -- Design

The goal for this milestone was to establish a design system for the front-end. Mobile-first was a guiding principle for this milestone. By the end of the milestone, we had a themable token-based design system and several reusable components. The reusable components can be composed to build complicated designs. Different themes can be used to establish tone and mood for different game systems. The token system has two layers: _primitives_ are raw values like sizes and colors, and _semantic_ tokens are roles like "danger" or "surface" that point at primitives. Themes only touch the semantic layer. The existing theme is "science fiction" tailored for the _Mothership_ RPG. 

## Milestone M3 -- Oracle Tables & Character Creation

This milestone's goal was enabling character creation and selectable oracles. Functionality was added to the frontend to allow a player to create a basic character for the _Mothership_ TTRPG, which is persisted to the back-end via the endpoints added in this milestone. The front-end also displays a number of oracles, which are configurable via JSON files in a shared package, which makes them available to both front- and back-ends. The player can enable or disable different options within each oracle table, allowing them to customize the experience of their solo RPG session. Each oracle entry provides two texts: a short description that the player sees and a complete description that is shown only to the AI. 

## Milestone M4 -- Solo Blind Campaign Creation Pipeline

The goal for this milestone was to create the beginning of an adventure from oracle selection to GM context[^3] stored in the database. The type of play implemented by this milestone is referred to as "solo blind," which means that Claude writes the GM context and the player never sees it. This milestone adds a "coherence check," which is a lightweight Claude call to make sure the selected oracles all work together; if a contradiction is found, the check suggests rerolling one of the oracles. This milestone also adds the synthesis prompt and step. The step takes the synthesis prompt, which instructs Claude on how to create the setup for an adventure, combines it with the selected oracle options, and sends it to Claude for synthesis. The response from Claude includes the GM context for the adventure plus the starting text for the player. The response is structured via the `submit_gm_context` tool, whose output is validated by the back-end before being written to the database. With this milestone complete, a player can go from character creation to a ready-to-play adventure, but the adventure was not yet playable. 

[^3]: The "GM context" is the Warden's private notes for the adventure, such as NPCs and their agendas, secrets, and the flags that track progress. The player never sees it.

## Milestone M5 -- Claude API Client & Prompt Assembly

The goal for this milestone was to assemble the prompt and send it to Claude via Anthropic's TypeScript SDK. The prompt consists of the GM context (which is cached in the Claude API), a state snapshot, and a rolling window of recent messages. The state snapshot is visibility-filtered, meaning it didn't include entities that were marked as hidden. The front-end was migrated to `svelte-spa-router`. In addition to assembling the prompt and sending it to Claude, this milestone adds a `submit_gm_response` tool to the back-end. Claude calls the tool to submit its response for a turn. The data sent from the AI is received but not applied to the game state. 

## Milestone M6 -- State Management

This milestone's goal was to apply Claude's responses to game state and close the play loop. The back-end receives output from the model via the `submit_gm_response` tool implemented in M5. The response is validated, and validated deltas are applied to the game state. If validation fails, Claude is reprompted once, including details about what was wrong with the first response. Any further validation errors cause the turn to be aborted. The player's message is kept, so they can retry without retyping it. Game events, including the player action, GM's response, and state updates, are recorded in the database. Both a rejected response and its corresponding correction are recorded in the game events log. Claude is able to propose new facts about the game world, which are referred to as "proposed canon." Claude's responses are also stored as adventure telemetry, for future use. The front-end was updated with a "play" view that supports chat-like interactions with the Warden.

## Milestone M7 -- AI Tools

The purpose of this milestone was to add additional tools for the AI to use when adjudicating results in the game. The inner tool loop was added, which allows Claude to make several tool calls before ending the turn. Claude always ends the turn with a response, which can include a request for the player to roll dice. One of the tools added in this milestone allows the AI to roll dice using the standard "1d20+2" notation. There is also a rules-lookup tool that operates a vector search over embeddings from the rules text. Since Mothership TTRPG rules are well represented in Claude's training data, the index was left empty to see what rules questions Claude would ask.

## Milestone M7.1 -- Playtest review tooling

The goal for this milestone was to enable turn-by-turn readback of game events and adventure telemetry for playtest analysis. It moved the prompt text out of code and into a standalone plain text file. Every telemetry row now records which prompt file was used, along with a hash of its text. We expected to change the prompt between turns during a playtest, so the review needed to show which prompt produced which turn. This is where `promptHash` was first introduced. This milestone also added SQL views that combined game events and adventure telemetry. A CLI review script uses these views to produce a markdown summary of an adventure for review by a human. Functionality was also added to export and import adventure synthesis data, allowing the exact scenario to be played repeatedly.

## Milestone M7.3 -- Turn-state replay

This milestone's goal was to rebuild the game state as it existed at any turn of a playtest adventure, so the adventure can be replayed. This replaces the `save-synthesis` script of M7.1, which only captured adventures with zero turns played. Only the starting state (turn 0) is saved, automatically, when the adventure is synthesized. To get the state at turn N, reconstructStateAsOfTurn starts from turn 0 and replays the game-events log forward. Saving a snapshot at every turn was considered and rejected, because it would mean more storage and more to keep in sync. This milestone consolidated the state-update functions, so that both play and replay use the same functions. Starting-state snapshots are now automatically stored in the database, and the `load-synthesis` script works with the database to duplicate an existing adventure synthesis for replaying. 

## Milestone M7.4 -- Eval harness

Creating a running eval harness was the goal for this milestone. It includes a `capture-fixture` CLI tool for constructing fixtures from game state saved in the database. A fixture is one moment from a real playtest -- the state at turn N -- the player's input, and a failure-mode tag naming the mistake the Warden made there. The harness replays that turn through the real turn code and checks whether the mistake happens again. The goal is to test a prompt change against mistakes you've already seen. The harness includes checks for both structural and judge checks. A structural check is code inspecting the output, with no LLM involved. A judged check is a second Claude call that grades the output against a written rubric. Several checks of both types were implemented as a part of this milestone. This milestone remains open, and the harness has been expanded by later developments; see [Eval Harness](./eval-harness.md) for the current state.
