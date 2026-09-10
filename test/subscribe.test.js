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
    expect(res.headers.get("Access-Control-Allow-Origin")).toBe("https://kapota.com.br");
    const body = await res.json();
    expect(typeof body.error).toBe("string");
  });

  it("reenvia confirmação quando email já está pending, sem gerar novo token", async () => {
    const confirmToken = "existing-confirm-token";
    const unsubscribeToken = "existing-unsub-token";
    await insertPendingSubscriber(env.DB, "pending@example.com", confirmToken, unsubscribeToken, "2026-09-09T00:00:00.000Z");
    const beforeRow = await getSubscriberByEmail(env.DB, "pending@example.com");
    expect(beforeRow.status).toBe("pending");
    expect(beforeRow.confirm_token).toBe(confirmToken);

    const res = await SELF.fetch("https://worker.example/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "pending@example.com" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("pending");

    const afterRow = await getSubscriberByEmail(env.DB, "pending@example.com");
    expect(afterRow.status).toBe("pending");
    expect(afterRow.confirm_token).toBe(confirmToken);
  });

  it("limita a 5 tentativas por IP na mesma janela, e libera pra outro IP", async () => {
    const ip = "1.2.3.4";
    for (let i = 0; i < 5; i++) {
      const res = await SELF.fetch("https://worker.example/subscribe", {
        method: "POST",
        headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
        body: JSON.stringify({ email: `rate-limit-${i}@example.com` }),
      });
      expect(res.status).toBe(200);
    }

    const sixthRes = await SELF.fetch("https://worker.example/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
      body: JSON.stringify({ email: "rate-limit-6@example.com" }),
    });
    expect(sixthRes.status).toBe(429);
    const sixthBody = await sixthRes.json();
    expect(typeof sixthBody.error).toBe("string");

    const otherIpRes = await SELF.fetch("https://worker.example/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json", "CF-Connecting-IP": "5.6.7.8" },
      body: JSON.stringify({ email: "rate-limit-other-ip@example.com" }),
    });
    expect(otherIpRes.status).toBe(200);
  });
});
