import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { insertPendingSubscriber, confirmByToken, hasSentCampaign } from "../src/db.js";
import { handleAdminSend } from "../src/handlers/adminSend.js";
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

  it("recusa com 500 se ADMIN_SECRET não estiver configurado, mesmo mandando literalmente 'Bearer undefined'", async () => {
    const req = new Request("https://worker.example/admin/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer undefined" },
      body: JSON.stringify(POST),
    });
    const res = await handleAdminSend(req, { ...env, ADMIN_SECRET: undefined });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.status).not.toBe("sent");
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
    const fetchCallsAfterFirst = fetch.mock.calls.length;

    const res2 = await SELF.fetch("https://worker.example/admin/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
      body: JSON.stringify({ ...POST, slug: "post-repetido" }),
    });
    const body2 = await res2.json();
    expect(body2.status).toBe("already-sent");
    expect(fetch).toHaveBeenCalledTimes(fetchCallsAfterFirst);
  });

  it("duas chamadas simultâneas pro mesmo slug novo (Action sobreposta): só uma reserva e envia", async () => {
    await insertPendingSubscriber(env.DB, "conc1@example.com", "tok-conc1", "unsub-conc1", "2026-09-09T00:00:00.000Z");
    await confirmByToken(env.DB, "tok-conc1", "2026-09-09T00:00:00.000Z");
    await insertPendingSubscriber(env.DB, "conc2@example.com", "tok-conc2", "unsub-conc2", "2026-09-09T00:00:00.000Z");
    await confirmByToken(env.DB, "tok-conc2", "2026-09-09T00:00:00.000Z");

    const slug = "post-concorrente";
    const makeRequest = () =>
      SELF.fetch("https://worker.example/admin/send", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
        body: JSON.stringify({ ...POST, slug }),
      });

    const [res1, res2] = await Promise.all([makeRequest(), makeRequest()]);
    const [body1, body2] = await Promise.all([res1.json(), res2.json()]);
    const statuses = [body1.status, body2.status].sort();

    expect(statuses).toEqual(["already-sent", "sent"]);
    const sentBody = body1.status === "sent" ? body1 : body2;
    expect(sentBody.recipients).toBe(2);
    // O Resend só deve ter sido chamado pros 2 confirmados de UMA das chamadas, nunca 4.
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("se todos os envios falharem, responde send-failed com 502 mas mantém a reserva (recipient_count = 0)", async () => {
    await insertPendingSubscriber(env.DB, "fail1@example.com", "tok-fail1", "unsub-fail1", "2026-09-09T00:00:00.000Z");
    await confirmByToken(env.DB, "tok-fail1", "2026-09-09T00:00:00.000Z");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro interno do Resend", { status: 500 })));

    const slug = "post-tudo-falha";
    const res = await SELF.fetch("https://worker.example/admin/send", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
      body: JSON.stringify({ ...POST, slug }),
    });

    expect(res.status).toBe(502);
    const body = await res.json();
    expect(body.status).toBe("send-failed");
    expect(body.recipients).toBe(0);

    const row = await env.DB.prepare("SELECT * FROM sent_campaigns WHERE slug = ?").bind(slug).first();
    expect(row).not.toBeNull();
    expect(row.recipient_count).toBe(0);
  });
});
