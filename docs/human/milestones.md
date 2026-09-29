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

## Milestone M3 -- Oracle Tables & Character Creation

## Milestone M4 -- Solo Blind Campaign Creation Pipeline
