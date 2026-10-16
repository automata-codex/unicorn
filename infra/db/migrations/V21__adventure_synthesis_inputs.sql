-- ADR-0124 — keep the inputs an adventure was synthesized from.
--
-- The oracle draws, the filter they were drawn from, and the addendum were
-- validated and used, then discarded. Written by
-- `SynthesisRepository.writeSynthesisInputs` once the coherence check passes,
-- before Claude is called, so an adventure whose synthesis fails keeps them too.
--
-- Nullable: adventures created before this column have no record, and nothing
-- can recover one for them.

ALTER TABLE adventure
  ADD COLUMN synthesis_inputs JSONB;
