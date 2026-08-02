CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash VARCHAR(255) NOT NULL,
    role VARCHAR(50) DEFAULT 'user',
    baseline_cva NUMERIC(5,2) DEFAULT 55,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Posture Events
CREATE TABLE IF NOT EXISTS posture_events (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    event_type VARCHAR(20) NOT NULL,
    duration_seconds INTEGER NOT NULL,
    peak_rula_score INTEGER NOT NULL,
    minimum_cva_angle NUMERIC(5,2)
        CHECK (minimum_cva_angle BETWEEN 20 AND 60),
    sensor_snapshot JSONB,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Backwards-compatible ownership columns. `user_id` remains available for
-- installations that previously stored arbitrary strings/device IDs.
ALTER TABLE posture_events ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);
ALTER TABLE posture_events ADD COLUMN IF NOT EXISTS device_id VARCHAR(128);
UPDATE posture_events
SET owner_user_id = user_id::UUID
WHERE owner_user_id IS NULL
  AND user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND EXISTS (SELECT 1 FROM users WHERE users.id::TEXT = posture_events.user_id);

-- Device credentials are SHA-256 hashes (`sha256:<hex>`), never plaintext.
-- Ownership is explicit and survives reconnects/restarts.
CREATE TABLE IF NOT EXISTS devices (
    id VARCHAR(128) PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    credential_hash VARCHAR(71) NOT NULL,
    display_name VARCHAR(100),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    revoked_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS devices_user_id_idx ON devices(user_id);
CREATE INDEX IF NOT EXISTS posture_events_owner_logged_idx
    ON posture_events(owner_user_id, logged_at DESC);
CREATE INDEX IF NOT EXISTS posture_events_device_logged_idx
    ON posture_events(device_id, logged_at DESC);

-- Replay timelines are stored separately so event-list queries do not return
-- potentially large frame arrays. Each event has at most one 5 Hz replay.
CREATE TABLE IF NOT EXISTS posture_event_replays (
    event_id INTEGER PRIMARY KEY REFERENCES posture_events(id) ON DELETE CASCADE,
    sample_hz SMALLINT NOT NULL DEFAULT 5 CHECK (sample_hz BETWEEN 1 AND 20),
    reference_sensors JSONB NOT NULL,
    frames JSONB NOT NULL,
    truncated BOOLEAN NOT NULL DEFAULT FALSE,
    incident_onset_offset_ms INTEGER NOT NULL DEFAULT 0
        CHECK (incident_onset_offset_ms >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- 3. Daily Dashboard Summaries
CREATE TABLE IF NOT EXISTS daily_summaries (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) NOT NULL,
    summary_date DATE DEFAULT CURRENT_DATE,
    avg_rula FLOAT,
    total_sitting_time_minutes INT,
    posture_good_pct INT,
    posture_warning_pct INT,
    posture_critical_pct INT
);

ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);

-- 4. User-controlled posture sensitivity. These values are consumed by the
-- live telemetry assessment and completed-incident tracker.
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    warning_rula_threshold INTEGER NOT NULL DEFAULT 2
        CHECK (warning_rula_threshold BETWEEN 2 AND 6),
    warning_cva_threshold INTEGER NOT NULL DEFAULT 50
        CHECK (warning_cva_threshold BETWEEN 20 AND 60),
    incident_duration_seconds INTEGER NOT NULL DEFAULT 15
        CHECK (incident_duration_seconds BETWEEN 5 AND 60),
    personalization_consent BOOLEAN NOT NULL DEFAULT FALSE,
    telemetry_training_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    personalized_model_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    consent_updated_at TIMESTAMPTZ,
    forecast_model_variant VARCHAR(32) NOT NULL DEFAULT 'rula'
        CHECK (forecast_model_variant IN ('rula', 'combined_strict')),
    alert_consecutive_predictions INTEGER NOT NULL DEFAULT 2
        CHECK (alert_consecutive_predictions BETWEEN 1 AND 5),
    alert_cooldown_seconds INTEGER NOT NULL DEFAULT 300
        CHECK (alert_cooldown_seconds BETWEEN 30 AND 1800),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS personalization_consent_audit (
    id BIGSERIAL PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    consented BOOLEAN NOT NULL,
    telemetry_training_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    personalized_model_opt_in BOOLEAN NOT NULL DEFAULT FALSE,
    source VARCHAR(32) NOT NULL DEFAULT 'settings',
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS personalization_consent_audit_user_idx
    ON personalization_consent_audit(user_id, created_at DESC);

-- Feature-only personalization storage. Never store raw sensor payloads or
-- quaternions in this table.
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

-- Physical sensor placement is a data/model compatibility boundary.
ALTER TABLE posture_events ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24)
    NOT NULL DEFAULT 'shoulder_top'
    CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));
ALTER TABLE posture_event_replays ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24)
    NOT NULL DEFAULT 'shoulder_top'
    CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));
ALTER TABLE personalization_sequences ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24)
    NOT NULL DEFAULT 'shoulder_top'
    CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));
ALTER TABLE user_forecast_models ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24)
    NOT NULL DEFAULT 'shoulder_top'
    CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));
ALTER TABLE personalization_training_jobs ADD COLUMN IF NOT EXISTS mounting_mode VARCHAR(24)
    NOT NULL DEFAULT 'shoulder_top'
    CHECK (mounting_mode IN ('shoulder_top', 'upper_arm'));
