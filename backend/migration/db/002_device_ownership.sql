BEGIN;

ALTER TABLE posture_events ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);
ALTER TABLE posture_events ADD COLUMN IF NOT EXISTS device_id VARCHAR(128);

UPDATE posture_events
SET owner_user_id = user_id::UUID
WHERE owner_user_id IS NULL
  AND user_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
  AND EXISTS (SELECT 1 FROM users WHERE users.id::TEXT = posture_events.user_id);

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

ALTER TABLE daily_summaries ADD COLUMN IF NOT EXISTS owner_user_id UUID REFERENCES users(id);

COMMIT;
