import { env } from "cloudflare:test";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { upsertPost } from "../src/db.js";
import { formatWeekLabel, getPreviousWeekRange, sendPendingDigest } from "../src/digest.js";
import { applyMigrations } from "./helpers/migrate.js";

env.RESEND_API_KEY = "re_test_key";
env.WORKER_URL = "https://worker.example";

beforeAll(async () => {
  await applyMigrations(env);
});

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getPreviousWeekRange", () => {
  it("rolando de uma segunda, devolve a semana anterior completa (seg a dom)", () => {
    // 2026-09-14 é uma segunda-feira
    const { since, until } = getPreviousWeekRange(new Date("2026-09-14T11:00:00.000Z"));
    expect(since.toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(until.toISOString().slice(0, 10)).toBe("2026-09-14");
  });

  it("disparado num dia que não é segunda, rola pra segunda mais recente antes de voltar 7 dias", () => {
    // 2026-09-16 é uma quarta-feira; a segunda mais recente é 2026-09-14
    const { since, until } = getPreviousWeekRange(new Date("2026-09-16T15:00:00.000Z"));
    expect(since.toISOString().slice(0, 10)).toBe("2026-09-07");
    expect(until.toISOString().slice(0, 10)).toBe("2026-09-14");
  });
});

describe("formatWeekLabel", () => {
  it("formata dentro do mesmo mês", () => {
    expect(formatWeekLabel(new Date("2026-09-07T00:00:00.000Z"))).toBe("07 a 13 de setembro");
  });

  it("formata cruzando o mês", () => {
    expect(formatWeekLabel(new Date("2026-09-28T00:00:00.000Z"))).toBe("28 de setembro a 04 de outubro");
  });
});

describe("sendPendingDigest", () => {
  it("sem posts na semana, não envia nada", async () => {
    const result = await sendPendingDigest(env, new Date("2026-01-05T11:00:00.000Z"));
    expect(result.status).toBe("no-posts");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("com posts e assinante confirmado, envia e registra no digest_log", async () => {
    await env.DB.prepare(
      `INSERT INTO subscribers (email, status, confirm_token, unsubscribe_token, created_at, confirmed_at)
       VALUES ('digest@example.com', 'confirmed', 'tok', 'unsub-digest', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`
    ).run();
    await upsertPost(
      env.DB,
      {
        slug: "post-da-semana",
        title: "Post da semana",
        excerpt: "Resumo",
        url: "https://kapota.com.br/blog/post-da-semana/",
        category: "Categoria",
        dateISO: "2026-02-03T00:00:00.000Z",
      },
      "2026-02-03T00:00:00.000Z"
    );

    const result = await sendPendingDigest(env, new Date("2026-02-09T11:00:00.000Z"));
    expect(result.status).toBe("sent");
    expect(result.recipients).toBe(1);
    expect(result.posts).toBe(1);
    expect(fetch).toHaveBeenCalledTimes(1);

    const row = await env.DB.prepare("SELECT * FROM digest_log WHERE week_start = ?").bind(result.weekStart).first();
    expect(row.recipient_count).toBe(1);
    expect(row.post_count).toBe(1);
  });

  it("não reenvia a mesma semana duas vezes", async () => {
    await upsertPost(
      env.DB,
      {
        slug: "post-repetido-semana",
        title: "Post repetido",
        excerpt: "Resumo",
        url: "https://kapota.com.br/blog/post-repetido-semana/",
        category: "Categoria",
        dateISO: "2026-03-03T00:00:00.000Z",
      },
      "2026-03-03T00:00:00.000Z"
    );

    const first = await sendPendingDigest(env, new Date("2026-03-09T11:00:00.000Z"));
    const callsAfterFirst = fetch.mock.calls.length;
    const second = await sendPendingDigest(env, new Date("2026-03-09T11:00:00.000Z"));

    expect(first.status).toBe("sent");
    expect(second.status).toBe("already-sent");
    expect(fetch).toHaveBeenCalledTimes(callsAfterFirst);
  });
});
