BEGIN;

CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    warning_rula_threshold INTEGER NOT NULL DEFAULT 2
        CHECK (warning_rula_threshold BETWEEN 2 AND 6),
    incident_duration_seconds INTEGER NOT NULL DEFAULT 15
        CHECK (incident_duration_seconds BETWEEN 5 AND 60),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

COMMIT;
