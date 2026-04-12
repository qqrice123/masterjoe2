-- Master Joe Racing: Phase 2.0 Database Schema
-- 用於建立 AI 學習權重表

CREATE TABLE IF NOT EXISTS ai_weights (
    race_type VARCHAR(50) PRIMARY KEY,
    base_prob_weight REAL NOT NULL,
    ev_weight REAL NOT NULL,
    ratio_weight REAL NOT NULL,
    large_bet_weight REAL NOT NULL,
    learn_count INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 寫入預設的權重 (如果沒有資料的話)
INSERT INTO ai_weights (race_type, base_prob_weight, ev_weight, ratio_weight, large_bet_weight, learn_count)
VALUES 
    ('BANKER', 1.0, -0.5, 1.5, 0.5, 0),
    ('SPLIT', 1.0, -0.2, 1.2, 0.8, 0),
    ('CHAOTIC', 0.2, 1.5, 2.0, 1.5, 0),
    ('UNKNOWN', 1.0, 0.0, 0.0, 0.0, 0)
ON CONFLICT (race_type) DO NOTHING;

-- 建立 Web Push 訂閱表
CREATE TABLE IF NOT EXISTS push_subscriptions (
    id SERIAL PRIMARY KEY,
    endpoint TEXT UNIQUE NOT NULL,
    auth TEXT,
    p256dh TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 建立警報紀錄表 (Alerts)
CREATE TABLE IF NOT EXISTS alerts (
    id SERIAL PRIMARY KEY,
    alert_id VARCHAR(100) UNIQUE NOT NULL,
    venue VARCHAR(10) NOT NULL,
    race_no INTEGER NOT NULL,
    race_name VARCHAR(100),
    runner_number VARCHAR(10) NOT NULL,
    runner_name VARCHAR(100) NOT NULL,
    alert_type VARCHAR(20) NOT NULL, -- LARGE_BET, LARGE_BET_QIN, QIN_OVERFLOW, DRIFT
    severity VARCHAR(10) NOT NULL,   -- CRITICAL, HIGH, MEDIUM
    prev_odds REAL,
    current_odds REAL,
    drop_pct REAL,
    qin_ratio REAL,
    detected_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    date DATE NOT NULL DEFAULT CURRENT_DATE
);

-- 建立索引以加速查詢
CREATE INDEX IF NOT EXISTS idx_alerts_date ON alerts(date);
CREATE INDEX IF NOT EXISTS idx_alerts_detected_at ON alerts(detected_at DESC);