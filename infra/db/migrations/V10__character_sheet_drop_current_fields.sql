-- Remove currentHp and flatten stress.{current,max} → maxStress on existing
-- character_sheet rows. Live mutable state lives in campaign_state.data.resourcePools;
-- the character sheet only stores ceilings.

UPDATE character_sheet
SET data = (data - 'currentHp' - 'stress') || jsonb_build_object(
  'maxStress', COALESCE((data -> 'stress' ->> 'max')::int, 3)
)
WHERE data ? 'currentHp' OR data ? 'stress';
