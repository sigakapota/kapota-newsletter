CREATE TABLE posts (
  slug TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  excerpt TEXT NOT NULL,
  url TEXT NOT NULL,
  category TEXT NOT NULL,
  date_iso TEXT NOT NULL,
  registered_at TEXT NOT NULL
);

CREATE INDEX idx_posts_date_iso ON posts (date_iso);

CREATE TABLE digest_log (
  week_start TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  recipient_count INTEGER NOT NULL,
  post_count INTEGER NOT NULL
);
