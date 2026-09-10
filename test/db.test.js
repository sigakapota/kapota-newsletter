import { env } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import {
  confirmByToken,
  getConfirmedSubscribers,
  getPostsInRange,
  getSubscriberByEmail,
  insertPendingSubscriber,
  reopenAsPending,
  reserveDigestWeek,
  unsubscribeByToken,
  updateDigestStats,
  upsertPost,
} from "../src/db.js";
import { applyMigrations } from "./helpers/migrate.js";

const NOW = "2026-09-09T12:00:00.000Z";

describe("db", () => {
  beforeAll(async () => {
    await applyMigrations(env);
  });
  it("getSubscriberByEmail retorna null se não existe", async () => {
    const row = await getSubscriberByEmail(env.DB, "ninguem@example.com");
    expect(row).toBeNull();
  });

  it("insertPendingSubscriber grava com status pending", async () => {
    await insertPendingSubscriber(env.DB, "a@example.com", "tok-confirm", "tok-unsub", NOW);
    const row = await getSubscriberByEmail(env.DB, "a@example.com");
    expect(row.status).toBe("pending");
    expect(row.confirm_token).toBe("tok-confirm");
  });

  it("confirmByToken confirma e retorna true", async () => {
    await insertPendingSubscriber(env.DB, "b@example.com", "tok-b", "unsub-b", NOW);
    const ok = await confirmByToken(env.DB, "tok-b", NOW);
    expect(ok).toBe(true);
    const row = await getSubscriberByEmail(env.DB, "b@example.com");
    expect(row.status).toBe("confirmed");
  });

  it("confirmByToken com token inválido retorna false", async () => {
    const ok = await confirmByToken(env.DB, "token-que-nao-existe", NOW);
    expect(ok).toBe(false);
  });

  it("unsubscribeByToken marca como unsubscribed", async () => {
    await insertPendingSubscriber(env.DB, "c@example.com", "tok-c", "unsub-c", NOW);
    await confirmByToken(env.DB, "tok-c", NOW);
    const ok = await unsubscribeByToken(env.DB, "unsub-c");
    expect(ok).toBe(true);
    const row = await getSubscriberByEmail(env.DB, "c@example.com");
    expect(row.status).toBe("unsubscribed");
  });

  it("reopenAsPending reabre um email descadastrado", async () => {
    await insertPendingSubscriber(env.DB, "d@example.com", "tok-d1", "unsub-d", NOW);
    await confirmByToken(env.DB, "tok-d1", NOW);
    await unsubscribeByToken(env.DB, "unsub-d");
    await reopenAsPending(env.DB, "d@example.com", "tok-d2", NOW);
    const row = await getSubscriberByEmail(env.DB, "d@example.com");
    expect(row.status).toBe("pending");
    expect(row.confirm_token).toBe("tok-d2");
    expect(row.confirmed_at).toBeNull();
  });

  it("getConfirmedSubscribers só traz confirmados", async () => {
    await insertPendingSubscriber(env.DB, "e1@example.com", "tok-e1", "unsub-e1", NOW);
    await insertPendingSubscriber(env.DB, "e2@example.com", "tok-e2", "unsub-e2", NOW);
    await confirmByToken(env.DB, "tok-e1", NOW);
    const list = await getConfirmedSubscribers(env.DB);
    const emails = list.map((r) => r.email);
    expect(emails).toContain("e1@example.com");
    expect(emails).not.toContain("e2@example.com");
  });

  it("upsertPost insere e depois atualiza o mesmo slug", async () => {
    const post = {
      slug: "post-teste",
      title: "Título original",
      excerpt: "Resumo",
      url: "https://kapota.com.br/blog/post-teste/",
      category: "Teste",
      dateISO: "2026-09-08",
    };
    await upsertPost(env.DB, post, NOW);
    await upsertPost(env.DB, { ...post, title: "Título atualizado" }, NOW);
    const { results } = await env.DB.prepare("SELECT title FROM posts WHERE slug = ?").bind("post-teste").all();
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Título atualizado");
  });

  it("getPostsInRange só traz posts dentro do intervalo", async () => {
    await upsertPost(env.DB, { slug: "post-dentro", title: "t", excerpt: "e", url: "u", category: "c", dateISO: "2026-09-10" }, NOW);
    await upsertPost(env.DB, { slug: "post-fora", title: "t", excerpt: "e", url: "u", category: "c", dateISO: "2026-09-20" }, NOW);
    const posts = await getPostsInRange(env.DB, "2026-09-08T00:00:00.000Z", "2026-09-15T00:00:00.000Z");
    const slugs = posts.map((p) => p.slug);
    expect(slugs).toContain("post-dentro");
    expect(slugs).not.toContain("post-fora");
  });

  it("reserveDigestWeek reserva uma vez só", async () => {
    const first = await reserveDigestWeek(env.DB, "2026-09-08", NOW);
    const second = await reserveDigestWeek(env.DB, "2026-09-08", NOW);
    expect(first).toBe(true);
    expect(second).toBe(false);
  });

  it("updateDigestStats grava recipient_count e post_count", async () => {
    await reserveDigestWeek(env.DB, "2026-09-15", NOW);
    await updateDigestStats(env.DB, "2026-09-15", 7, 2);
    const row = await env.DB.prepare("SELECT recipient_count, post_count FROM digest_log WHERE week_start = ?").bind("2026-09-15").first();
    expect(row.recipient_count).toBe(7);
    expect(row.post_count).toBe(2);
  });
});
