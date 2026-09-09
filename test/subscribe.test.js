import { env, SELF } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { getSubscriberByEmail, insertPendingSubscriber, confirmByToken, unsubscribeByToken } from "../src/db.js";
import { applyMigrations } from "./helpers/migrate.js";

beforeAll(async () => {
  await applyMigrations(env);
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (typeof url === "string" && url.includes("api.resend.com")) {
      return new Response(JSON.stringify({ id: "mock" }), { status: 200 });
    }
    return SELF.fetch.wrappedOriginal ? SELF.fetch.wrappedOriginal(url, init) : fetch(url, init);
  }));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("POST /subscribe", () => {
  it("cadastra um email novo como pending e manda confirmação", async () => {
    const res = await SELF.fetch("https://worker.example/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "novo@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");
    const row = await getSubscriberByEmail(env.DB, "novo@example.com");
    expect(row.status).toBe("pending");
  });

  it("rejeita email inválido", async () => {
    const res = await SELF.fetch("https://worker.example/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "isso-nao-e-email" }),
    });
    expect(res.status).toBe(400);
  });

  it("avisa que já está confirmado, sem mandar novo email", async () => {
    await insertPendingSubscriber(env.DB, "ja@example.com", "tok-a", "unsub-a", "2026-09-09T00:00:00.000Z");
    await confirmByToken(env.DB, "tok-a", "2026-09-09T00:00:00.000Z");
    const res = await SELF.fetch("https://worker.example/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ja@example.com" }),
    });
    const body = await res.json();
    expect(body.status).toBe("already-confirmed");
  });

  it("reabre como pending quando o email já tinha se descadastrado", async () => {
    await insertPendingSubscriber(env.DB, "voltou@example.com", "tok-b", "unsub-b", "2026-09-09T00:00:00.000Z");
    await confirmByToken(env.DB, "tok-b", "2026-09-09T00:00:00.000Z");
    await unsubscribeByToken(env.DB, "unsub-b");
    const res = await SELF.fetch("https://worker.example/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "voltou@example.com" }),
    });
    const body = await res.json();
    expect(body.status).toBe("pending");
    const row = await getSubscriberByEmail(env.DB, "voltou@example.com");
    expect(row.status).toBe("pending");
  });

  it("responde o preflight OPTIONS com CORS", async () => {
    const res = await SELF.fetch("https://worker.example/subscribe", { method: "OPTIONS" });
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://kapota.com.br");
  });

  it("devolve 503 com JSON quando o Resend está fora do ar", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => {
      throw new Error("network down");
    }));
    const res = await SELF.fetch("https://worker.example/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "resend-fora@example.com" }),
    });
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });
});
