-- 1. Users Table
CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    baseline_cva FLOAT DEFAULT 55.0,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Posture Events
CREATE TABLE IF NOT EXISTS posture_events (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(id),
    event_type VARCHAR(50), 
    duration_seconds INT,
    peak_rula_score INT,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 3. Daily Dashboard Summaries
CREATE TABLE IF NOT EXISTS daily_summaries (
    id SERIAL PRIMARY KEY,
    user_id VARCHAR(50) REFERENCES users(id),
    summary_date DATE DEFAULT CURRENT_DATE,
    avg_rula FLOAT,
    total_sitting_time_minutes INT,
    posture_good_pct INT,
    posture_warning_pct INT,
    posture_critical_pct INT
);

-- Insert a dummy user for testing
INSERT INTO users (id, name, baseline_cva) 
VALUES ('user_01', 'Test User', 55.5)
ON CONFLICT (id) DO NOTHING;