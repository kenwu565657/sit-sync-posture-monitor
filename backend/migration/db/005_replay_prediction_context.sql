BEGIN;

ALTER TABLE posture_event_replays
    ADD COLUMN IF NOT EXISTS incident_onset_offset_ms INTEGER NOT NULL DEFAULT 0
    CHECK (incident_onset_offset_ms >= 0);

COMMIT;
