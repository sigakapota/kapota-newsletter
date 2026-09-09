CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','unsubscribed')),
  confirm_token TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE sent_campaigns (
  slug TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  recipient_count INTEGER NOT NULL
);
