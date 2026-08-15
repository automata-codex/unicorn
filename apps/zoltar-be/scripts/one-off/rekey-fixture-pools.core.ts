/**
 * M7.6 Part 1 — mechanical re-key of the eval corpus's `resourcePools` from
 * the flat `{entity_id}_{pool_name}` composite key to the nested
 * `resourcePools[owner][poolName]` shape.
 *
 * This is a one-off. It ran once, against the 15 fixtures captured before
 * M7.6, and it is committed so the transformation is reviewable as code rather
 * than inferred from a 15-file diff. `docs/eval-methodology.md` is explicit
 * that nothing may reformat `eval/fixtures/` — the corpus version is a hash
 * over raw bytes — which is why this exists at all instead of a hand-edit
 * pass, and why `stringifyFixture` below reproduces the corpus's exact byte
 * encoding rather than using `JSON.stringify` directly.
 */

import { type ResourcePool, SCENARIO_POOL_OWNER } from '@uv/game-systems';

/**
 * Pool keys whose owner cannot be recovered mechanically, resolved by hand.
 *
 * `android_memory_integrity` is a second live instance of the
 * `alvarez` / `lt_alvarez` duplicate-spelling defect: no entity is named
 * `android`, but the playtest record attaches the pool to the declared entity
 * `decommissioned_android` explicitly ("UNIT-7 at 2HP is critical — one more
 * significant hit destroys it and loses android_memory_integrity",
 * `playtests/18be155e-…-playtest-report.md:1968`), and
 * `decommissioned_android_hp` sits beside it in every fixture.
 *
 * Deliberately *not* listed, and therefore left under `_scenario`:
 * `hull_breach_timer` (a proper prefix of the declared entity
 * `hull_breach_cascade`, but `hull_breach_cascade_timer` is what the naming
 * convention would produce, so this may be a genuinely unattached clock) and
 * `contamination_spread_timer` (the playtest record describes it as the
 * player's mycotoxin exposure clock, which is neither "no owner" nor an
 * entity). Both stay ambiguous; nothing in D1-A forces resolving them.
 */
export const OWNER_OVERRIDES: Readonly<
  Record<string, { owner: string; poolName: string }>
> = {
  android_memory_integrity: {
    owner: 'decommissioned_android',
    poolName: 'memory_integrity',
  },
};

export interface RekeyResult {
  pools: Record<string, Record<string, ResourcePool>>;
  /** One line per key, for the operator to read before committing. */
  decisions: string[];
}

/**
 * Splits each flat pool key into `{owner}.{poolName}`.
 *
 * Owner resolution is longest-prefix against the declared identifier set, so
 * `veridian_contractor_alpha_hp` resolves to the entity
 * `veridian_contractor_alpha` rather than to a shorter prefix that happens to
 * also be declared. A key that resolves to no declared owner keeps its whole
 * name as the pool name under the reserved `_scenario` owner — the honest
 * answer, and one that needs no per-key judgement at re-key time.
 */
export function rekeyResourcePools(
  flatPools: Record<string, ResourcePool>,
  knownOwners: readonly string[],
): RekeyResult {
  const owners = [...knownOwners].sort((a, b) => b.length - a.length);
  const pools: Record<string, Record<string, ResourcePool>> = {};
  const decisions: string[] = [];

  for (const key of Object.keys(flatPools)) {
    const override = OWNER_OVERRIDES[key];
    if (override) {
      (pools[override.owner] ??= {})[override.poolName] = flatPools[key];
      decisions.push(
        `${key} -> ${override.owner}.${override.poolName} (override)`,
      );
      continue;
    }

    const owner = owners.find((candidate) => key.startsWith(`${candidate}_`));
    if (owner) {
      const poolName = key.slice(owner.length + 1);
      (pools[owner] ??= {})[poolName] = flatPools[key];
      decisions.push(`${key} -> ${owner}.${poolName}`);
      continue;
    }

    (pools[SCENARIO_POOL_OWNER] ??= {})[key] = flatPools[key];
    decisions.push(`${key} -> ${SCENARIO_POOL_OWNER}.${key} (no owner)`);
  }

  return { pools, decisions };
}

/**
 * Serializes a fixture exactly as the corpus already encodes them: two-space
 * indent, every non-ASCII code unit escaped as `\uXXXX`, one trailing newline.
 *
 * `JSON.stringify` emits non-ASCII literally, so using it directly would
 * rewrite every `—` in every trigger string and change `corpusVersion` for
 * fifteen files this script never meant to touch. Verified by round-tripping
 * all fifteen unmodified fixtures and asserting byte equality.
 */
export function stringifyFixture(fixture: unknown): string {
  const json = JSON.stringify(fixture, null, 2);
  const escaped = json.replace(/[\u007f-\uffff]/g, (char) => {
    const code = char.charCodeAt(0).toString(16).padStart(4, '0');
    return `\\u${code}`;
  });
  return `${escaped}\n`;
}
