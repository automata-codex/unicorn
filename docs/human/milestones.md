# Milestones

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
