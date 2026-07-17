ALTER TABLE pending_canon ADD COLUMN sequence_number integer;
CREATE INDEX pending_canon_adventure_seq_idx ON pending_canon (adventure_id, sequence_number);
