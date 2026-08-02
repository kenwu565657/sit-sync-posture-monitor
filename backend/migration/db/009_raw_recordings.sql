BEGIN;

CREATE TABLE IF NOT EXISTS raw_recording_sessions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    device_id VARCHAR(128) NOT NULL,
    sequence_id VARCHAR(160) NOT NULL,
    participant_id VARCHAR(160) NOT NULL,
    action_id VARCHAR(160) NOT NULL,
    split VARCHAR(16) NOT NULL CHECK (split IN ('train', 'validation', 'test')),
    status VARCHAR(24) NOT NULL DEFAULT 'recording'
        CHECK (status IN ('recording', 'completed', 'failed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    ended_at TIMESTAMPTZ,
    frame_count INTEGER NOT NULL DEFAULT 0 CHECK (frame_count >= 0),
    sample_hz DOUBLE PRECISION CHECK (sample_hz > 0),
    file_path TEXT NOT NULL,
    error_message TEXT,
    expires_at TIMESTAMPTZ NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (user_id, sequence_id)
);

CREATE TABLE IF NOT EXISTS raw_recording_chunks (
    session_id UUID NOT NULL REFERENCES raw_recording_sessions(id) ON DELETE CASCADE,
    chunk_index INTEGER NOT NULL CHECK (chunk_index >= 0),
    start_timestamp_ms BIGINT NOT NULL,
    end_timestamp_ms BIGINT NOT NULL,
    frame_count INTEGER NOT NULL CHECK (frame_count BETWEEN 1 AND 1000),
    frames JSONB NOT NULL CHECK (jsonb_typeof(frames) = 'array'),
    created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (session_id, chunk_index),
    CHECK (end_timestamp_ms >= start_timestamp_ms),
    CHECK (jsonb_array_length(frames) = frame_count)
);

CREATE INDEX IF NOT EXISTS raw_recording_sessions_user_created_idx
    ON raw_recording_sessions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS raw_recording_sessions_expiry_idx
    ON raw_recording_sessions(expires_at);
CREATE INDEX IF NOT EXISTS raw_recording_chunks_session_time_idx
    ON raw_recording_chunks(session_id, start_timestamp_ms);

COMMIT;
