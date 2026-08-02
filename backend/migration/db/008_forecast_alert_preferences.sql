BEGIN;

ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS forecast_model_variant VARCHAR(32) NOT NULL DEFAULT 'rula'
        CHECK (forecast_model_variant IN ('rula', 'combined_strict')),
    ADD COLUMN IF NOT EXISTS alert_consecutive_predictions INTEGER NOT NULL DEFAULT 2
        CHECK (alert_consecutive_predictions BETWEEN 1 AND 5),
    ADD COLUMN IF NOT EXISTS alert_cooldown_seconds INTEGER NOT NULL DEFAULT 300
        CHECK (alert_cooldown_seconds BETWEEN 30 AND 1800);

COMMIT;
