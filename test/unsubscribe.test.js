import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertPendingSubscriber, confirmByToken, getSubscriberByEmail } from "../src/db.js";
import { applyMigrations } from "./helpers/migrate.js";

beforeAll(async () => {
  await applyMigrations(env);
});

describe("GET /unsubscribe", () => {
  it("descadastra um token válido", async () => {
    await insertPendingSubscriber(env.DB, "y@example.com", "tok-y", "unsub-y", "2026-09-09T00:00:00.000Z");
    await confirmByToken(env.DB, "tok-y", "2026-09-09T00:00:00.000Z");
    const res = await SELF.fetch("https://worker.example/unsubscribe?token=unsub-y");
    expect(res.status).toBe(200);
    const row = await getSubscriberByEmail(env.DB, "y@example.com");
    expect(row.status).toBe("unsubscribed");
  });

  it("responde 400 pra token inválido", async () => {
    const res = await SELF.fetch("https://worker.example/unsubscribe?token=nao-existe");
    expect(res.status).toBe(400);
  });
});
