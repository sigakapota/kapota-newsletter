// test/smoke.test.js
import { SELF, env } from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";

describe("smoke", () => {
  beforeAll(async () => {
    // Apply migrations in Worker environment
    const migrations = [
      `CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','unsubscribed')),
  confirm_token TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);`,
      `CREATE TABLE sent_campaigns (
  slug TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  recipient_count INTEGER NOT NULL
);`
    ];

    for (const stmt of migrations) {
      await env.DB.prepare(stmt).run();
    }
  });

  it("responde 404 numa rota desconhecida", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(404);
  });
});
