-- Migration: 001_initial
-- Description: Create initial hookpipe schema
-- Date: 2024-01-01

BEGIN;

-- Migration tracking
CREATE TABLE IF NOT EXISTS migrations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Webhook delivery records
CREATE TABLE IF NOT EXISTS deliveries (
  id TEXT PRIMARY KEY,
  pipeline_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  payload TEXT NOT NULL,
  headers TEXT NOT NULL,
  source_ip TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Individual delivery attempt records
CREATE TABLE IF NOT EXISTS delivery_attempts (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  destination_id TEXT NOT NULL,
  attempt_number INTEGER NOT NULL,
  status TEXT NOT NULL,
  status_code INTEGER,
  response_body TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  attempted_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(delivery_id, destination_id, attempt_number)
);

-- Failed deliveries moved to DLQ
CREATE TABLE IF NOT EXISTS dead_letters (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  pipeline_id TEXT NOT NULL,
  destination_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  headers TEXT NOT NULL,
  error_message TEXT,
  attempts INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- In-process queue backing table
CREATE TABLE IF NOT EXISTS queue_jobs (
  id TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL REFERENCES deliveries(id),
  destination_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  headers TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  max_attempts INTEGER NOT NULL DEFAULT 3,
  next_attempt_at TEXT NOT NULL DEFAULT (datetime('now')),
  locked_at TEXT,
  locked_by TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Per-pipeline statistics
CREATE TABLE IF NOT EXISTS pipeline_stats (
  pipeline_id TEXT PRIMARY KEY,
  total_received INTEGER NOT NULL DEFAULT 0,
  total_delivered INTEGER NOT NULL DEFAULT 0,
  total_failed INTEGER NOT NULL DEFAULT 0,
  total_filtered INTEGER NOT NULL DEFAULT 0,
  last_received_at TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Indexes: deliveries
CREATE INDEX IF NOT EXISTS idx_deliveries_pipeline_created
  ON deliveries(pipeline_id, created_at);
CREATE INDEX IF NOT EXISTS idx_deliveries_status
  ON deliveries(status);

-- Indexes: delivery_attempts
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_delivery_id
  ON delivery_attempts(delivery_id);
CREATE INDEX IF NOT EXISTS idx_delivery_attempts_attempted_at
  ON delivery_attempts(attempted_at);

-- Indexes: dead_letters
CREATE INDEX IF NOT EXISTS idx_dead_letters_pipeline_created
  ON dead_letters(pipeline_id, created_at);

-- Indexes: queue_jobs
CREATE INDEX IF NOT EXISTS idx_queue_jobs_status_next_attempt
  ON queue_jobs(status, next_attempt_at);
CREATE INDEX IF NOT EXISTS idx_queue_jobs_delivery_id
  ON queue_jobs(delivery_id);

COMMIT;
