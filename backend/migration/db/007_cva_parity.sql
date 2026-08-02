BEGIN;

ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS warning_cva_threshold INTEGER NOT NULL DEFAULT 50
        CHECK (warning_cva_threshold BETWEEN 20 AND 60);

ALTER TABLE posture_events
    ADD COLUMN IF NOT EXISTS minimum_cva_angle NUMERIC(5,2)
        CHECK (minimum_cva_angle BETWEEN 20 AND 60);

COMMIT;
