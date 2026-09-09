import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { insertPendingSubscriber, getSubscriberByEmail } from "../src/db.js";
import { applyMigrations } from "./helpers/migrate.js";

beforeAll(async () => {
  await applyMigrations(env);
});

describe("GET /confirm", () => {
  it("confirma um token válido", async () => {
    await insertPendingSubscriber(env.DB, "x@example.com", "tok-x", "unsub-x", "2026-09-09T00:00:00.000Z");
    const res = await SELF.fetch("https://worker.example/confirm?token=tok-x");
    expect(res.status).toBe(200);
    const row = await getSubscriberByEmail(env.DB, "x@example.com");
    expect(row.status).toBe("confirmed");
  });

  it("responde 400 pra token inválido", async () => {
    const res = await SELF.fetch("https://worker.example/confirm?token=nao-existe");
    expect(res.status).toBe(400);
  });

  it("responde 400 sem token", async () => {
    const res = await SELF.fetch("https://worker.example/confirm");
    expect(res.status).toBe(400);
  });
});
