CREATE TABLE subscribe_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_subscribe_attempts_ip_time ON subscribe_attempts (ip, created_at);
