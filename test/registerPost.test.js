import { env, SELF } from "cloudflare:test";
import { beforeAll, describe, expect, it } from "vitest";
import { applyMigrations } from "./helpers/migrate.js";

env.ADMIN_SECRET = "segredo-de-teste";

const POST = {
  slug: "post-registrado",
  title: "Post registrado",
  excerpt: "Resumo",
  url: "https://kapota.com.br/blog/post-registrado/",
  category: "Categoria",
  dateISO: "2026-09-08",
};

describe("POST /admin/register-post", () => {
  beforeAll(async () => {
    await applyMigrations(env);
  });

  it("rejeita sem o Bearer correto", async () => {
    const res = await SELF.fetch("https://worker.example/admin/register-post", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(POST),
    });
    expect(res.status).toBe(401);
  });

  it("registra o post no banco", async () => {
    const res = await SELF.fetch("https://worker.example/admin/register-post", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
      body: JSON.stringify(POST),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("registered");

    const row = await env.DB.prepare("SELECT title FROM posts WHERE slug = ?").bind(POST.slug).first();
    expect(row.title).toBe("Post registrado");
  });

  it("registrar de novo o mesmo slug atualiza em vez de duplicar", async () => {
    await SELF.fetch("https://worker.example/admin/register-post", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
      body: JSON.stringify({ ...POST, slug: "post-repetido", title: "Título 1" }),
    });
    await SELF.fetch("https://worker.example/admin/register-post", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
      body: JSON.stringify({ ...POST, slug: "post-repetido", title: "Título 2" }),
    });
    const { results } = await env.DB.prepare("SELECT title FROM posts WHERE slug = ?").bind("post-repetido").all();
    expect(results).toHaveLength(1);
    expect(results[0].title).toBe("Título 2");
  });

  it("rejeita payload sem dateISO", async () => {
    const res = await SELF.fetch("https://worker.example/admin/register-post", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: "Bearer segredo-de-teste" },
      body: JSON.stringify({ slug: "x", title: "x", url: "x" }),
    });
    expect(res.status).toBe(400);
  });
});
