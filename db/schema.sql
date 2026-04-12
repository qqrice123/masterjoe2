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