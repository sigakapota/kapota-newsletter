import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { insertPendingSubscriber, confirmByToken, hasSentCampaign } from "../src/db.js";
import { applyMigrations } from "./helpers/migrate.js";

beforeAll(async () => {
  await applyMigrations(env);
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "mock" }), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const POST = {
  slug: "post-teste-admin-send",
  title: "Post de teste",
  excerpt: "Resumo curto",
  category: "Categoria X",
  url: "https://kapota.com.br/blog/post-teste-admin-send/",
};

describe("POST /admin/send", () => {
  it("rejeita sem o Bearer correto", async () => {
    const res = await SELF.fetch("https://worker.example/admin/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(POST),
    });
    expect(res.status).toBe(401);
  });

  it("envia pra todos os confirmados e registra a campanha", async () => {
    await insertPendingSubscriber(env.DB, "z1@example.com", "tok-z1", "unsub-z1", "2026-09-09T00:00:00.000Z");
    await confirmByToken(env.DB, "tok-z1", "2026-09-09T00:00:00.000Z");
    await insertPendingSubscriber(env.DB, "z2@example.com", "tok-z2", "unsub-z2", "2026-09-09T00:00:00.000Z");
    // z2 fica pending, não deve receber

    const res = await SELF.fetch("https://worker.example/admin/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
      body: JSON.stringify(POST),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("sent");
    expect(body.recipients).toBe(1);
    expect(await hasSentCampaign(env.DB, POST.slug)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("não reenvia se o slug já foi avisado", async () => {
    await insertPendingSubscriber(env.DB, "z3@example.com", "tok-z3", "unsub-z3", "2026-09-09T00:00:00.000Z");
    await confirmByToken(env.DB, "tok-z3", "2026-09-09T00:00:00.000Z");

    await SELF.fetch("https://worker.example/admin/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
      body: JSON.stringify({ ...POST, slug: "post-repetido" }),
    });
    const res2 = await SELF.fetch("https://worker.example/admin/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
      body: JSON.stringify({ ...POST, slug: "post-repetido" }),
    });
    const body2 = await res2.json();
    expect(body2.status).toBe("already-sent");
  });
});
