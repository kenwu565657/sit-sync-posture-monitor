BEGIN;

ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS personalization_consent BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS telemetry_training_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS personalized_model_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE user_preferences
    ADD COLUMN IF NOT EXISTS consent_updated_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS personalization_consent_audit (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consented BOOLEAN NOT NULL,
    source VARCHAR(32) NOT NULL DEFAULT 'settings',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE personalization_consent_audit
    ADD COLUMN IF NOT EXISTS telemetry_training_opt_in BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE personalization_consent_audit
    ADD COLUMN IF NOT EXISTS personalized_model_opt_in BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS personalization_consent_audit_user_idx
    ON personalization_consent_audit(user_id, created_at DESC);

-- Privacy boundary: these chunks contain only the eight calibrated forecast
-- features. Raw sensor payloads and quaternions must never be stored here.
CREATE TABLE IF NOT EXISTS personalization_sequences (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(128) NOT NULL,
    started_at TIMESTAMPTZ NOT NULL,
    ended_at TIMESTAMPTZ NOT NULL,
    sample_interval_ms INTEGER NOT NULL CHECK (sample_interval_ms BETWEEN 50 AND 60000),
    frame_count INTEGER NOT NULL CHECK (frame_count BETWEEN 2 AND 1000),
    feature_sequences JSONB NOT NULL CHECK (jsonb_typeof(feature_sequences) = 'array'),
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (ended_at >= started_at)
);

CREATE INDEX IF NOT EXISTS personalization_sequences_user_created_idx
    ON personalization_sequences(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS personalization_sequences_expiry_idx
    ON personalization_sequences(expires_at);

CREATE TABLE IF NOT EXISTS user_forecast_models (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_version VARCHAR(128),
    status VARCHAR(24) NOT NULL
        CHECK (status IN ('training', 'ready', 'failed', 'retired')),
    artifact_uri TEXT,
    metadata JSONB NOT NULL DEFAULT '{}'::JSONB,
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS user_forecast_models_user_status_idx
    ON user_forecast_models(user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS personalization_training_jobs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    model_id UUID REFERENCES user_forecast_models(id) ON DELETE SET NULL,
    status VARCHAR(24) NOT NULL
        CHECK (status IN ('queued', 'running', 'succeeded', 'failed')),
    sequence_count INTEGER NOT NULL DEFAULT 0 CHECK (sequence_count >= 0),
    frame_count INTEGER NOT NULL DEFAULT 0 CHECK (frame_count >= 0),
    error_message TEXT,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    started_at TIMESTAMPTZ,
    completed_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS personalization_training_jobs_user_idx
    ON personalization_training_jobs(user_id, requested_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS personalization_training_jobs_one_active_idx
    ON personalization_training_jobs(user_id)
    WHERE status IN ('queued', 'running');

COMMIT;
