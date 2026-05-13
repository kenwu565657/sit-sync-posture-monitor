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
    sensor_snapshot JSONB,
    logged_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
