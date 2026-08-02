BEGIN;

ALTER TABLE raw_recording_sessions
    ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24) NOT NULL
        DEFAULT 'shoulder_top'
        CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));

ALTER TABLE posture_events
    ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24) NOT NULL
        DEFAULT 'shoulder_top'
        CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));

ALTER TABLE posture_event_replays
    ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24) NOT NULL
        DEFAULT 'shoulder_top'
        CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));

ALTER TABLE personalization_sequences
    ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24) NOT NULL
        DEFAULT 'shoulder_top'
        CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));

ALTER TABLE user_forecast_models
    ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24) NOT NULL
        DEFAULT 'shoulder_top'
        CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));

ALTER TABLE personalization_training_jobs
    ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24) NOT NULL
        DEFAULT 'shoulder_top'
        CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));

DROP INDEX IF EXISTS personalization_training_jobs_one_active_idx;
CREATE UNIQUE INDEX IF NOT EXISTS personalization_training_jobs_one_active_mode_idx
    ON personalization_training_jobs(user_id, mounting_mode)
    WHERE status IN ('queued', 'running');

CREATE INDEX IF NOT EXISTS personalization_sequences_user_mode_created_idx
    ON personalization_sequences(user_id, mounting_mode, created_at DESC);
CREATE INDEX IF NOT EXISTS raw_recording_sessions_user_mode_created_idx
    ON raw_recording_sessions(user_id, mounting_mode, created_at DESC);

COMMIT;
