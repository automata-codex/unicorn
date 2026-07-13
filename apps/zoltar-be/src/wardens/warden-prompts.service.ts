import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { Injectable, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  hashPromptText,
  promptsDir,
  type SystemSlug,
  type WardenPromptFile,
} from './prompt-paths';

export type { SystemSlug, WardenPromptFile } from './prompt-paths';

const KNOWN_SYSTEMS: readonly SystemSlug[] = ['mothership'] as const;

function overrideEnvVar(system: SystemSlug): string {
  return `WARDEN_PROMPT_OVERRIDE_${system.toUpperCase()}`;
}

/**
 * Compares two version suffixes like `m7`, `m7a`, `m7b`, `m10`. Splits into
 * leading digit run and trailing alphabetic run; compares numerically first,
 * lexically second. Enough for the playtest-app convention; a real semver
 * parser lands the first time the shape produces a wrong answer in practice.
 */
function compareVersionSuffix(a: string, b: string): number {
  const parse = (s: string): { num: number; rest: string } => {
    const m = /^[a-z]*?(\d+)(.*)$/.exec(s);
    if (!m) return { num: 0, rest: s };
    return { num: parseInt(m[1], 10), rest: m[2] };
  };
  const pa = parse(a);
  const pb = parse(b);
  if (pa.num !== pb.num) return pa.num - pb.num;
  return pa.rest.localeCompare(pb.rest);
}

function extractVersionSuffix(system: SystemSlug, filename: string): string {
  return filename.slice(system.length + 1, -'.txt'.length);
}

/**
 * Loads every `<system>-*.txt` prompt from `src/wardens/prompts/` once at
 * module init, hashes each, and resolves the per-system selection honoring
 * the `WARDEN_PROMPT_OVERRIDE_<SYSTEM>` env var. The loaded triple is cached
 * for the lifetime of the process — editing a file at runtime does not hot-
 * reload; a restart picks up the change. This is deliberate: mid-process
 * swaps would make telemetry interpretation impossible.
 */
@Injectable()
export class WardenPromptsService implements OnModuleInit {
  private readonly prompts = new Map<SystemSlug, WardenPromptFile[]>();
  private readonly selected = new Map<SystemSlug, WardenPromptFile>();

  constructor(private readonly config: ConfigService) {}

  onModuleInit(): void {
    this.loadAll();
    this.resolveSelections();
  }

  getSelected(system: SystemSlug): WardenPromptFile {
    const hit = this.selected.get(system);
    if (!hit) {
      throw new Error(
        `No Warden prompt available for system '${system}'. Add a file at ${join(promptsDir(), `${system}-<version>.txt`)}.`,
      );
    }
    return hit;
  }

  getAll(system: SystemSlug): WardenPromptFile[] {
    return [...(this.prompts.get(system) ?? [])];
  }

  getByFilename(system: SystemSlug, filename: string): WardenPromptFile | null {
    const list = this.prompts.get(system) ?? [];
    return list.find((p) => p.filename === filename) ?? null;
  }

  private loadAll(): void {
    let entries: string[];
    try {
      entries = readdirSync(promptsDir());
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
        // Directory doesn't exist — leave all systems unloaded, getSelected
        // will throw with a clear message on first use.
        return;
      }
      throw err;
    }

    for (const entry of entries) {
      if (!entry.endsWith('.txt')) continue;
      const dashIdx = entry.indexOf('-');
      if (dashIdx <= 0) continue;
      const slug = entry.slice(0, dashIdx) as SystemSlug;
      if (!KNOWN_SYSTEMS.includes(slug)) {
        console.warn(
          `[WardenPromptsService] ignoring prompt file with unknown system prefix: ${entry}`,
        );
        continue;
      }
      const text = readFileSync(join(promptsDir(), entry), 'utf8');
      const file: WardenPromptFile = {
        filename: entry,
        hash: hashPromptText(text),
        text,
      };
      const list = this.prompts.get(slug) ?? [];
      list.push(file);
      this.prompts.set(slug, list);
    }

    for (const [slug, list] of this.prompts) {
      list.sort((a, b) =>
        compareVersionSuffix(
          extractVersionSuffix(slug, a.filename),
          extractVersionSuffix(slug, b.filename),
        ),
      );
    }
  }

  private resolveSelections(): void {
    for (const system of KNOWN_SYSTEMS) {
      const override = this.config.get<string>(overrideEnvVar(system));
      const list = this.prompts.get(system) ?? [];
      if (override && override.length > 0) {
        const match = list.find((p) => p.filename === override);
        if (!match) {
          throw new Error(
            `${overrideEnvVar(system)}=${override} does not match any file in ${promptsDir()}.`,
          );
        }
        this.selected.set(system, match);
        continue;
      }
      if (list.length === 0) continue;
      this.selected.set(system, list[list.length - 1]);
    }
  }
}
