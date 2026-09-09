// test/smoke.test.js
import { SELF, env } from "cloudflare:test";
import { describe, expect, it, beforeAll } from "vitest";
import { applyMigrations } from "./helpers/migrate.js";

describe("smoke", () => {
  beforeAll(async () => {
    // Apply migrations read from migrations/ directory at module load time
    await applyMigrations(env);
  });

  it("responde 404 numa rota desconhecida", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(404);
  });
});
