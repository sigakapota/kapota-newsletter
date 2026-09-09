# Newsletter do blog kapota.com.br — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deixar visitantes do blog `kapota.com.br/blog/` se cadastrarem com o email e receberem um aviso automático sempre que um post novo for publicado.

**Architecture:** Um Cloudflare Worker novo (repositório `sigakapota/kapota-newsletter`) expõe 4 endpoints HTTP e usa D1 pra guardar assinantes e o histórico de avisos já enviados. O site `sigakapota/kapota-site` (GitHub Pages) ganha um widget de cadastro injetado por JS no rodapé de cada post e da listagem do blog, e a Action que já existe nesse repo passa a chamar o Worker depois de publicar. Resend cuida do envio dos emails.

**Tech Stack:** Cloudflare Workers + D1 (JavaScript puro, sem TypeScript), Wrangler, Vitest + `@cloudflare/vitest-pool-workers` pros testes, Resend (API HTTP), GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-09-09-newsletter-blog-design.md` (neste mesmo repositório).

## Global Constraints

- CORS do Worker restrito a `https://kapota.com.br` (só o `/subscribe` precisa de CORS, os outros endpoints não são chamados por JS de página).
- `ADMIN_SECRET`, a API key do Resend e o token do Cloudflare nunca vão em texto plano em nenhum arquivo versionado — sempre via `wrangler secret put` ou secrets do GitHub Actions.
- A tabela `sent_campaigns` é a única fonte de verdade sobre "esse post já foi avisado" — nunca reenviar pra quem já recebeu.
- Materiais completos em `conteudos.kapota.com.br` (ex.: Direito Autoral x Direito Conexo) **não** disparam esse aviso — fora de escopo.
- Não existe feed RSS público (`.xml`) nesse projeto — fora de escopo.
- Todo email enviado a um assinante confirmado carrega um link de descadastro individual (LGPD).

---

## Task 1: Scaffold do projeto Worker + schema D1

**Files:**
- Create: `package.json`
- Create: `wrangler.toml`
- Create: `vitest.config.js`
- Create: `migrations/0001_init.sql`
- Create: `test/apply-migrations.js`
- Create: `src/index.js` (handler mínimo, só pra validar o esqueleto)
- Test: `test/smoke.test.js`

**Interfaces:**
- Produces: binding D1 `env.DB` disponível em qualquer handler; schema com tabelas `subscribers` e `sent_campaigns` (colunas conforme spec).

- [ ] **Step 1: Criar o banco D1 real no Cloudflare**

```bash
cd /Users/kapota/Desktop/kapota-newsletter
npx wrangler d1 create kapota_newsletter
```

Anote o `database_id` que aparece no output — vai ser usado no `wrangler.toml` do próximo step.

- [ ] **Step 2: Criar `package.json`**

```json
{
  "name": "kapota-newsletter",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "dev": "wrangler dev",
    "deploy": "wrangler deploy"
  },
  "devDependencies": {
    "@cloudflare/vitest-pool-workers": "^0.6.0",
    "vitest": "^2.1.0",
    "wrangler": "^3.90.0"
  }
}
```

- [ ] **Step 3: Instalar dependências**

```bash
npm install
```

- [ ] **Step 4: Criar `wrangler.toml`** (substitua `database_id` pelo valor real do Step 1)

```toml
name = "kapota-newsletter"
main = "src/index.js"
compatibility_date = "2026-09-09"

[[d1_databases]]
binding = "DB"
database_name = "kapota_newsletter"
database_id = "COLE_AQUI_O_ID_DO_STEP_1"
```

- [ ] **Step 5: Criar `migrations/0001_init.sql`**

```sql
CREATE TABLE subscribers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email TEXT UNIQUE NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','confirmed','unsubscribed')),
  confirm_token TEXT NOT NULL,
  unsubscribe_token TEXT NOT NULL,
  created_at TEXT NOT NULL,
  confirmed_at TEXT
);

CREATE TABLE sent_campaigns (
  slug TEXT PRIMARY KEY,
  sent_at TEXT NOT NULL,
  recipient_count INTEGER NOT NULL
);
```

- [ ] **Step 6: Aplicar a migração no banco remoto**

```bash
npx wrangler d1 execute kapota_newsletter --remote --file=migrations/0001_init.sql
```

- [ ] **Step 7: Criar `test/apply-migrations.js`** (aplica a mesma migração no D1 local usado pelos testes)

```js
import { env } from "cloudflare:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const dir = join(process.cwd(), "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

for (const file of files) {
  const sql = readFileSync(join(dir, file), "utf8");
  const statements = sql.split(";").map((s) => s.trim()).filter(Boolean);
  for (const stmt of statements) {
    await env.DB.prepare(stmt).run();
  }
}
```

- [ ] **Step 8: Criar `vitest.config.js`**

```js
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    setupFiles: ["./test/apply-migrations.js"],
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
      },
    },
  },
});
```

- [ ] **Step 9: Criar `src/index.js`** (mínimo, só responde 404 por enquanto)

```js
export default {
  async fetch() {
    return new Response("Not found", { status: 404 });
  },
};
```

- [ ] **Step 10: Escrever o teste de fumaça**

```js
// test/smoke.test.js
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("smoke", () => {
  it("responde 404 numa rota desconhecida", async () => {
    const res = await SELF.fetch("https://example.com/");
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 11: Rodar os testes**

Run: `npm test`
Expected: 1 teste passando.

- [ ] **Step 12: Commit**

```bash
git add package.json wrangler.toml vitest.config.js migrations/ test/ src/index.js
git commit -m "Scaffold do Worker kapota-newsletter + schema D1"
```

---

## Task 2: Helpers de banco (`src/db.js`)

**Files:**
- Create: `src/db.js`
- Test: `test/db.test.js`

**Interfaces:**
- Consumes: `env.DB` (binding D1 do Task 1).
- Produces: `getSubscriberByEmail(db, email)`, `insertPendingSubscriber(db, email, confirmToken, unsubscribeToken, now)`, `reopenAsPending(db, email, confirmToken, now)`, `confirmByToken(db, token, now)`, `unsubscribeByToken(db, token)`, `getConfirmedSubscribers(db)`, `hasSentCampaign(db, slug)`, `recordSentCampaign(db, slug, now, recipientCount)` — usados pelos handlers dos Tasks 4-7.

- [ ] **Step 1: Escrever os testes primeiro**

```js
// test/db.test.js
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  confirmByToken,
  getConfirmedSubscribers,
  getSubscriberByEmail,
  hasSentCampaign,
  insertPendingSubscriber,
  recordSentCampaign,
  reopenAsPending,
  unsubscribeByToken,
} from "../src/db.js";

const NOW = "2026-09-09T12:00:00.000Z";

describe("db", () => {
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

  it("hasSentCampaign e recordSentCampaign", async () => {
    expect(await hasSentCampaign(env.DB, "post-x")).toBe(false);
    await recordSentCampaign(env.DB, "post-x", NOW, 3);
    expect(await hasSentCampaign(env.DB, "post-x")).toBe(true);
  });
});
```

- [ ] **Step 2: Rodar os testes e confirmar que falham** (módulo `../src/db.js` ainda não existe)

Run: `npm test -- test/db.test.js`
Expected: FAIL com "Cannot find module '../src/db.js'" ou similar.

- [ ] **Step 3: Implementar `src/db.js`**

```js
export async function getSubscriberByEmail(db, email) {
  const row = await db.prepare("SELECT * FROM subscribers WHERE email = ?").bind(email).first();
  return row ?? null;
}

export async function insertPendingSubscriber(db, email, confirmToken, unsubscribeToken, now) {
  await db
    .prepare(
      `INSERT INTO subscribers (email, status, confirm_token, unsubscribe_token, created_at)
       VALUES (?, 'pending', ?, ?, ?)`
    )
    .bind(email, confirmToken, unsubscribeToken, now)
    .run();
}

export async function reopenAsPending(db, email, confirmToken, now) {
  await db
    .prepare(
      `UPDATE subscribers
       SET status = 'pending', confirm_token = ?, confirmed_at = NULL, created_at = ?
       WHERE email = ?`
    )
    .bind(confirmToken, now, email)
    .run();
}

export async function confirmByToken(db, token, now) {
  const result = await db
    .prepare(
      `UPDATE subscribers SET status = 'confirmed', confirmed_at = ?
       WHERE confirm_token = ? AND status = 'pending'`
    )
    .bind(now, token)
    .run();
  return result.meta.rows_written > 0;
}

export async function unsubscribeByToken(db, token) {
  const result = await db
    .prepare("UPDATE subscribers SET status = 'unsubscribed' WHERE unsubscribe_token = ?")
    .bind(token)
    .run();
  return result.meta.rows_written > 0;
}

export async function getConfirmedSubscribers(db) {
  const { results } = await db
    .prepare("SELECT email, unsubscribe_token FROM subscribers WHERE status = 'confirmed'")
    .all();
  return results;
}

export async function hasSentCampaign(db, slug) {
  const row = await db.prepare("SELECT slug FROM sent_campaigns WHERE slug = ?").bind(slug).first();
  return row != null;
}

export async function recordSentCampaign(db, slug, now, recipientCount) {
  await db
    .prepare("INSERT INTO sent_campaigns (slug, sent_at, recipient_count) VALUES (?, ?, ?)")
    .bind(slug, now, recipientCount)
    .run();
}
```

- [ ] **Step 4: Rodar os testes de novo**

Run: `npm test -- test/db.test.js`
Expected: 8 testes passando.

- [ ] **Step 5: Commit**

```bash
git add src/db.js test/db.test.js
git commit -m "Adiciona helpers de banco (subscribers e sent_campaigns)"
```

---

## Task 3: Tokens e envio de email (`src/tokens.js`, `src/email.js`)

**Files:**
- Create: `src/tokens.js`
- Create: `src/email.js`
- Test: `test/email.test.js`

**Interfaces:**
- Produces: `generateToken()` (string aleatória), `sendConfirmationEmail(env, email, confirmUrl)`, `sendPostNotification(env, email, unsubscribeUrl, post)` — usados pelos handlers dos Tasks 4-7.
- Consumes: `env.RESEND_API_KEY` (secret do Worker, configurado no Task 9).

- [ ] **Step 1: Implementar `src/tokens.js`** (trivial, sem teste dedicado — é uma linha em volta de uma API nativa)

```js
export function generateToken() {
  return crypto.randomUUID().replace(/-/g, "");
}
```

- [ ] **Step 2: Escrever o teste de `src/email.js` primeiro** (mocka `fetch` global)

```js
// test/email.test.js
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendConfirmationEmail, sendPostNotification } from "../src/email.js";

const env = { RESEND_API_KEY: "re_test_key" };

beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({ id: "abc" }), { status: 200 })));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("email", () => {
  it("sendConfirmationEmail chama a API do Resend com o link certo", async () => {
    await sendConfirmationEmail(env, "a@example.com", "https://worker.example/confirm?token=xyz");
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.headers.Authorization).toBe("Bearer re_test_key");
    const body = JSON.parse(init.body);
    expect(body.to).toBe("a@example.com");
    expect(body.html).toContain("https://worker.example/confirm?token=xyz");
  });

  it("sendPostNotification inclui título, link do post e link de descadastro", async () => {
    await sendPostNotification(env, "b@example.com", "https://worker.example/unsubscribe?token=u1", {
      title: "Post de teste",
      url: "https://kapota.com.br/blog/post-de-teste/",
      excerpt: "Um resumo.",
      category: "Frase Comentada",
    });
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.subject).toContain("Post de teste");
    expect(body.html).toContain("https://kapota.com.br/blog/post-de-teste/");
    expect(body.html).toContain("https://worker.example/unsubscribe?token=u1");
  });

  it("lança erro se o Resend responder com falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro interno", { status: 500 })));
    await expect(
      sendConfirmationEmail(env, "a@example.com", "https://worker.example/confirm?token=xyz")
    ).rejects.toThrow(/Resend falhou/);
  });
});
```

- [ ] **Step 3: Rodar e confirmar que falha**

Run: `npm test -- test/email.test.js`
Expected: FAIL, `../src/email.js` não existe.

- [ ] **Step 4: Implementar `src/email.js`**

```js
const FROM = "Klysman Kley <novidades@kapota.com.br>";

async function sendEmail(env, { to, subject, html }) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.RESEND_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Resend falhou (${res.status}): ${body}`);
  }
  return res.json();
}

export async function sendConfirmationEmail(env, email, confirmUrl) {
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <p style="font-weight:700;font-size:18px;margin:0 0 24px;">kapota</p>
      <h1 style="font-size:22px;margin:0 0 16px;">Confirma sua inscrição</h1>
      <p style="font-size:15px;line-height:1.6;color:#333;">Clica no botão abaixo pra confirmar que quer receber os avisos de post novo do blog.</p>
      <a href="${confirmUrl}" style="display:inline-block;margin-top:16px;background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:700;">Confirmar inscrição</a>
      <p style="font-size:13px;color:#888;margin-top:24px;">Se você não pediu isso, pode ignorar este email.</p>
    </div>`;
  return sendEmail(env, { to: email, subject: "Confirma sua inscrição — blog do Kapota", html });
}

export async function sendPostNotification(env, email, unsubscribeUrl, post) {
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;">
      <p style="font-weight:700;font-size:18px;margin:0 0 24px;">kapota</p>
      <p style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#b3711f;font-weight:700;margin:0 0 8px;">${post.category ?? "Novo post"}</p>
      <h1 style="font-size:22px;margin:0 0 12px;">${post.title}</h1>
      <p style="font-size:15px;line-height:1.6;color:#333;">${post.excerpt ?? ""}</p>
      <a href="${post.url}" style="display:inline-block;margin-top:16px;background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:700;">Ler artigo</a>
      <p style="font-size:12px;color:#888;margin-top:32px;border-top:1px solid #eee;padding-top:16px;">
        Não quer mais receber esses avisos? <a href="${unsubscribeUrl}" style="color:#888;">Descadastrar</a>
      </p>
    </div>`;
  return sendEmail(env, { to: email, subject: `Novo no blog: ${post.title}`, html });
}
```

- [ ] **Step 5: Rodar de novo**

Run: `npm test -- test/email.test.js`
Expected: 3 testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/tokens.js src/email.js test/email.test.js
git commit -m "Adiciona geração de token e envio de email via Resend"
```

---

## Task 4: Endpoint `POST /subscribe`

**Files:**
- Create: `src/handlers/subscribe.js`
- Modify: `src/index.js`
- Test: `test/subscribe.test.js`

**Interfaces:**
- Consumes: `db.js` (Task 2), `email.js`/`tokens.js` (Task 3).
- Produces: `handleSubscribe(request, env)` — usado pelo router no Task 8.

- [ ] **Step 1: Escrever os testes primeiro**

```js
// test/subscribe.test.js
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getSubscriberByEmail, insertPendingSubscriber, confirmByToken, unsubscribeByToken } from "../src/db.js";

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
});
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- test/subscribe.test.js`
Expected: FAIL — rota `/subscribe` ainda devolve 404 (handler não existe).

- [ ] **Step 3: Implementar `src/handlers/subscribe.js`**

```js
import { getSubscriberByEmail, insertPendingSubscriber, reopenAsPending } from "../db.js";
import { sendConfirmationEmail } from "../email.js";
import { generateToken } from "../tokens.js";

const ALLOWED_ORIGIN = "https://kapota.com.br";
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", "Access-Control-Allow-Origin": ALLOWED_ORIGIN },
  });
}

export async function handleSubscribe(request, env) {
  if (request.method === "OPTIONS") {
    return new Response(null, {
      headers: {
        "Access-Control-Allow-Origin": ALLOWED_ORIGIN,
        "Access-Control-Allow-Methods": "POST",
        "Access-Control-Allow-Headers": "Content-Type",
      },
    });
  }

  const payload = await request.json().catch(() => ({}));
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!EMAIL_RE.test(email)) {
    return json({ error: "Email inválido" }, 400);
  }

  const now = new Date().toISOString();
  const workerOrigin = new URL(request.url).origin;
  const existing = await getSubscriberByEmail(env.DB, email);

  if (!existing) {
    const confirmToken = generateToken();
    const unsubscribeToken = generateToken();
    await insertPendingSubscriber(env.DB, email, confirmToken, unsubscribeToken, now);
    await sendConfirmationEmail(env, email, `${workerOrigin}/confirm?token=${confirmToken}`);
    return json({ status: "pending" });
  }

  if (existing.status === "confirmed") {
    return json({ status: "already-confirmed" });
  }

  if (existing.status === "pending") {
    await sendConfirmationEmail(env, email, `${workerOrigin}/confirm?token=${existing.confirm_token}`);
    return json({ status: "pending" });
  }

  const confirmToken = generateToken();
  await reopenAsPending(env.DB, email, confirmToken, now);
  await sendConfirmationEmail(env, email, `${workerOrigin}/confirm?token=${confirmToken}`);
  return json({ status: "pending" });
}
```

- [ ] **Step 4: Ligar a rota em `src/index.js`**

```js
import { handleSubscribe } from "./handlers/subscribe.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/subscribe") return handleSubscribe(request, env);
    return new Response("Not found", { status: 404 });
  },
};
```

- [ ] **Step 5: Rodar os testes de novo**

Run: `npm test -- test/subscribe.test.js`
Expected: 5 testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/subscribe.js src/index.js test/subscribe.test.js
git commit -m "Implementa POST /subscribe"
```

---

## Task 5: Endpoint `GET /confirm`

**Files:**
- Create: `src/handlers/confirm.js`
- Modify: `src/index.js`
- Test: `test/confirm.test.js`

**Interfaces:**
- Consumes: `confirmByToken` (Task 2).
- Produces: `handleConfirm(request, env)`.

- [ ] **Step 1: Escrever o teste primeiro**

```js
// test/confirm.test.js
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { insertPendingSubscriber, getSubscriberByEmail } from "../src/db.js";

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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- test/confirm.test.js`
Expected: FAIL (404 em vez de 200/400 com corpo esperado).

- [ ] **Step 3: Implementar `src/handlers/confirm.js`**

```js
import { confirmByToken } from "../db.js";

function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function handleConfirm(request, env) {
  const token = new URL(request.url).searchParams.get("token");
  const ok = token ? await confirmByToken(env.DB, token, new Date().toISOString()) : false;
  if (!ok) return html("<p>Link inválido ou já usado.</p>", 400);
  return html("<p>Inscrição confirmada! Pode fechar essa aba.</p>");
}
```

- [ ] **Step 4: Ligar a rota em `src/index.js`**

```js
import { handleConfirm } from "./handlers/confirm.js";
// ...
    if (url.pathname === "/confirm") return handleConfirm(request, env);
```

- [ ] **Step 5: Rodar de novo**

Run: `npm test -- test/confirm.test.js`
Expected: 3 testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/confirm.js src/index.js test/confirm.test.js
git commit -m "Implementa GET /confirm"
```

---

## Task 6: Endpoint `GET /unsubscribe`

**Files:**
- Create: `src/handlers/unsubscribe.js`
- Modify: `src/index.js`
- Test: `test/unsubscribe.test.js`

**Interfaces:**
- Consumes: `unsubscribeByToken` (Task 2).
- Produces: `handleUnsubscribe(request, env)`.

- [ ] **Step 1: Escrever o teste primeiro**

```js
// test/unsubscribe.test.js
import { env, SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import { insertPendingSubscriber, confirmByToken, getSubscriberByEmail } from "../src/db.js";

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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- test/unsubscribe.test.js`
Expected: FAIL (404).

- [ ] **Step 3: Implementar `src/handlers/unsubscribe.js`**

```js
import { unsubscribeByToken } from "../db.js";

function html(body, status = 200) {
  return new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8" } });
}

export async function handleUnsubscribe(request, env) {
  const token = new URL(request.url).searchParams.get("token");
  const ok = token ? await unsubscribeByToken(env.DB, token) : false;
  if (!ok) return html("<p>Link inválido.</p>", 400);
  return html("<p>Você foi descadastrado. Sem ressentimentos.</p>");
}
```

- [ ] **Step 4: Ligar a rota em `src/index.js`**

```js
import { handleUnsubscribe } from "./handlers/unsubscribe.js";
// ...
    if (url.pathname === "/unsubscribe") return handleUnsubscribe(request, env);
```

- [ ] **Step 5: Rodar de novo**

Run: `npm test -- test/unsubscribe.test.js`
Expected: 2 testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/unsubscribe.js src/index.js test/unsubscribe.test.js
git commit -m "Implementa GET /unsubscribe"
```

---

## Task 7: Endpoint `POST /admin/send`

**Files:**
- Create: `src/handlers/adminSend.js`
- Modify: `src/index.js`
- Test: `test/adminSend.test.js`

**Interfaces:**
- Consumes: `hasSentCampaign`, `getConfirmedSubscribers`, `recordSentCampaign` (Task 2), `sendPostNotification` (Task 3).
- Produces: `handleAdminSend(request, env)`.
- Consumes: `env.ADMIN_SECRET` (secret do Worker, configurado no Task 9).

- [ ] **Step 1: Escrever o teste primeiro**

```js
// test/adminSend.test.js
import { env, SELF } from "cloudflare:test";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { insertPendingSubscriber, confirmByToken, hasSentCampaign } from "../src/db.js";

env.ADMIN_SECRET = "segredo-de-teste";

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
```

- [ ] **Step 2: Rodar e confirmar que falha**

Run: `npm test -- test/adminSend.test.js`
Expected: FAIL (404).

- [ ] **Step 3: Implementar `src/handlers/adminSend.js`**

```js
import { getConfirmedSubscribers, hasSentCampaign, recordSentCampaign } from "../db.js";
import { sendPostNotification } from "../email.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function handleAdminSend(request, env) {
  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const post = await request.json().catch(() => null);
  if (!post?.slug || !post?.title || !post?.url) {
    return json({ error: "Payload inválido" }, 400);
  }

  if (await hasSentCampaign(env.DB, post.slug)) {
    return json({ status: "already-sent" });
  }

  const subscribers = await getConfirmedSubscribers(env.DB);
  const workerOrigin = new URL(request.url).origin;
  let sent = 0;

  for (const sub of subscribers) {
    try {
      await sendPostNotification(env, sub.email, `${workerOrigin}/unsubscribe?token=${sub.unsubscribe_token}`, post);
      sent += 1;
    } catch (err) {
      console.error(`Falha ao enviar pra ${sub.email}: ${err.message}`);
    }
  }

  await recordSentCampaign(env.DB, post.slug, new Date().toISOString(), sent);
  return json({ status: "sent", recipients: sent });
}
```

- [ ] **Step 4: Ligar a rota em `src/index.js`**

```js
import { handleAdminSend } from "./handlers/adminSend.js";
// ...
    if (url.pathname === "/admin/send") return handleAdminSend(request, env);
```

- [ ] **Step 5: Rodar de novo**

Run: `npm test -- test/adminSend.test.js`
Expected: 3 testes passando.

- [ ] **Step 6: Commit**

```bash
git add src/handlers/adminSend.js src/index.js test/adminSend.test.js
git commit -m "Implementa POST /admin/send"
```

---

## Task 8: Router final e suíte completa

**Files:**
- Modify: `src/index.js`

**Interfaces:**
- Consumes: os 4 handlers dos Tasks 4-7.

- [ ] **Step 1: Deixar `src/index.js` com as 4 rotas ligadas**

```js
import { handleSubscribe } from "./handlers/subscribe.js";
import { handleConfirm } from "./handlers/confirm.js";
import { handleUnsubscribe } from "./handlers/unsubscribe.js";
import { handleAdminSend } from "./handlers/adminSend.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/subscribe") return handleSubscribe(request, env);
    if (url.pathname === "/confirm") return handleConfirm(request, env);
    if (url.pathname === "/unsubscribe") return handleUnsubscribe(request, env);
    if (url.pathname === "/admin/send") return handleAdminSend(request, env);
    return new Response("Not found", { status: 404 });
  },
};
```

- [ ] **Step 2: Rodar a suíte inteira**

Run: `npm test`
Expected: todos os testes dos Tasks 1-7 passando (22 testes).

- [ ] **Step 3: Commit**

```bash
git add src/index.js
git commit -m "Liga as 4 rotas no router principal"
```

---

## Task 9: Deploy no Cloudflare + seed dos posts existentes

**Files:**
- Create: `scripts/seed-existing-posts.sql` (fora de `migrations/`, roda uma única vez, não faz parte dos testes automatizados)

**Interfaces:**
- Produces: URL pública do Worker (`https://kapota-newsletter.<subdomínio>.workers.dev`) — usada nos Tasks 11 e 12.

- [ ] **Step 1: Configurar os secrets do Worker** (usa a API key do Resend e gera o `ADMIN_SECRET`)

```bash
cd /Users/kapota/Desktop/kapota-newsletter
npx wrangler secret put RESEND_API_KEY
# cole a API key do Resend quando solicitado

node -e "console.log(crypto.randomUUID())"
# copie o valor gerado e use como ADMIN_SECRET no comando abaixo

npx wrangler secret put ADMIN_SECRET
# cole o valor gerado
```

- [ ] **Step 2: Deploy**

```bash
npx wrangler deploy
```

Anote a URL impressa no final (algo como `https://kapota-newsletter.<conta>.workers.dev`) — vai ser usada nos Tasks 11 e 12.

- [ ] **Step 3: Smoke test manual contra o Worker publicado**

```bash
curl -i https://kapota-newsletter.<conta>.workers.dev/subscribe -X OPTIONS
```
Expected: `200` com `Access-Control-Allow-Origin: https://kapota.com.br`.

- [ ] **Step 4: Criar `scripts/seed-existing-posts.sql`** (evita que os ~17 posts já publicados disparem email pra quem confirmar depois — ver lista completa em `blog/` no repositório `kapota-site`)

```sql
INSERT INTO sent_campaigns (slug, sent_at, recipient_count) VALUES
  ('contrato-vale-mais-que-medo', '2026-09-09T00:00:00.000Z', 0),
  ('esperar-oportunidade-trava-empresa', '2026-09-09T00:00:00.000Z', 0),
  ('ferramentas-mudaram-de-funcao', '2026-09-09T00:00:00.000Z', 0),
  ('forro-categoria-propria-pmb', '2026-09-09T00:00:00.000Z', 0),
  ('incomodo-malfeito-vira-negocio', '2026-09-09T00:00:00.000Z', 0),
  ('marco-legal-ia-brasil-atraso-camara', '2026-09-09T00:00:00.000Z', 0),
  ('meta-ai-conecta-google-workspace-anuncios', '2026-09-09T00:00:00.000Z', 0),
  ('nao-sao-os-mais-fortes-que-sobrevivem', '2026-09-09T00:00:00.000Z', 0),
  ('novo-ceo-apple-iphone-dobravel', '2026-09-09T00:00:00.000Z', 0),
  ('oportunidades-nao-acontecem-voce-cria', '2026-09-09T00:00:00.000Z', 0),
  ('radar-da-semana-04-09', '2026-09-09T00:00:00.000Z', 0),
  ('spotify-nasceu-pra-matar-pirataria', '2026-09-09T00:00:00.000Z', 0),
  ('time-bom-corrige-sem-drama', '2026-09-09T00:00:00.000Z', 0),
  ('tres-as-da-vida', '2026-09-09T00:00:00.000Z', 0),
  ('viral-nao-e-o-mesmo-que-ser-pago', '2026-09-09T00:00:00.000Z', 0),
  ('voce-nao-precisa-ver-o-topo', '2026-09-09T00:00:00.000Z', 0),
  ('youtube-visualizacao-engajada', '2026-09-09T00:00:00.000Z', 0);
```

**Antes de rodar este step, confirme a lista atual de slugs** com `gh api repos/sigakapota/kapota-site/contents/blog --jq '.[] | select(.type=="dir") | .name'` — se algum post novo tiver entrado desde o design, adicione a linha dele também, senão a Action do Task 12 vai avisar todo mundo sobre posts antigos na primeira execução.

- [ ] **Step 5: Aplicar o seed no banco remoto**

```bash
npx wrangler d1 execute kapota_newsletter --remote --file=scripts/seed-existing-posts.sql
```

- [ ] **Step 6: Commit**

```bash
git add scripts/seed-existing-posts.sql
git commit -m "Adiciona script de seed pra não avisar sobre posts já publicados"
git push -u origin main
```

---

## Task 10: Verificar domínio no Resend

**Files:** nenhum arquivo de código — configuração externa.

- [ ] **Step 1: Criar o domínio via API do Resend**

```bash
curl -s -X POST https://api.resend.com/domains \
  -H "Authorization: Bearer $RESEND_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"name":"kapota.com.br"}'
```

Guarde os registros DNS retornados (SPF/TXT e DKIM/CNAME).

- [ ] **Step 2: Adicionar os registros no painel do registro.br**

Mesma tela usada pra `conteudos.kapota.com.br` (Configurar Zona DNS, modo avançado) — adicionar cada registro exatamente como o Resend informou (tipo, nome, valor). Não remove nem altera o registro MX existente do Google Workspace.

- [ ] **Step 3: Confirmar a verificação**

```bash
curl -s https://api.resend.com/domains/<domain_id> \
  -H "Authorization: Bearer $RESEND_API_KEY"
```
Expected: `"status": "verified"` (pode levar alguns minutos pra propagar, igual da vez do GitHub Pages).

---

## Task 11: Widget de cadastro no site + self-heal no gerador

**Files:**
- Create: `assets/newsletter.js` (repositório `kapota-site`)
- Create: `scripts/lib/posts.mjs` (repositório `kapota-site`, extraído de `scripts/generate-site.mjs`)
- Modify: `scripts/generate-site.mjs` (repositório `kapota-site`)

**Interfaces:**
- Produces: `getPosts(rootDir)` e `SITE` exportados de `scripts/lib/posts.mjs`, consumidos pelo Task 12.

- [ ] **Step 1: Clonar o repositório do site**

```bash
cd /Users/kapota/Desktop
git clone https://github.com/sigakapota/kapota-site.git
cd kapota-site
```

- [ ] **Step 2: Ler o `scripts/generate-site.mjs` atual completo** (pra saber exatamente o que extrair)

```bash
cat scripts/generate-site.mjs
```

- [ ] **Step 3: Criar `scripts/lib/posts.mjs`** com a extração da lógica de parsing (mesma lógica que já existe em `generate-site.mjs`, hoje inline)

```js
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join } from "node:path";

export const SITE = "https://kapota.com.br";

function unescapeAttr(s) {
  return s.replace(/&quot;/g, '"').replace(/&amp;/g, "&");
}

function extract(html, regex, label, slug) {
  const m = html.match(regex);
  if (!m) throw new Error(`${label} não encontrado em blog/${slug}/index.html`);
  return m[1];
}

export function getPosts(root) {
  const blogDir = join(root, "blog");
  const slugs = readdirSync(blogDir)
    .filter((name) => {
      const full = join(blogDir, name);
      return statSync(full).isDirectory() && existsSync(join(full, "index.html"));
    })
    .sort();

  const posts = slugs.map((slug) => {
    const html = readFileSync(join(blogDir, slug, "index.html"), "utf8");
    const category = unescapeAttr(extract(html, /<span class="cat">([^<]+)<\/span>/, "categoria", slug));
    const dateDisplay = unescapeAttr(
      extract(html, /<span class="cat">[^<]+<\/span>\s*<span>([^<]+)<\/span>/, "data exibida", slug)
    );
    const dateISO = extract(html, /"datePublished":\s*"([0-9-]+)"/, "datePublished", slug);
    const title = unescapeAttr(extract(html, /<h1>([^]*?)<\/h1>/, "título", slug)).trim();
    const excerptMatch =
      html.match(/<meta name="blog-excerpt" content="([^"]*)">/) ||
      html.match(/<meta name="description" content="([^"]*)">/);
    if (!excerptMatch) throw new Error(`excerpt não encontrado em blog/${slug}/index.html`);
    const excerpt = unescapeAttr(excerptMatch[1]);
    return { slug, category, dateDisplay, dateISO, title, excerpt };
  });

  posts.sort((a, b) => (a.dateISO < b.dateISO ? 1 : a.dateISO > b.dateISO ? -1 : 0));
  return posts;
}
```

- [ ] **Step 4: Modificar `scripts/generate-site.mjs`** pra importar de `lib/posts.mjs` em vez de duplicar a lógica, e adicionar o self-heal do script da newsletter

No topo do arquivo, troque a extração inline de posts por:

```js
import { getPosts, SITE } from "./lib/posts.mjs";
// ... remova as funções unescapeAttr/extract e o bloco `const posts = slugs.map(...)` que já existiam,
// e troque por:
const posts = getPosts(ROOT);
```

E adicione, antes da seção `// ---------- sitemap.xml ----------`, a rotina de self-heal:

```js
const NEWSLETTER_SCRIPT_TAG = '<script src="/assets/newsletter.js" defer></script>';

function ensureNewsletterScript(html) {
  if (html.includes(NEWSLETTER_SCRIPT_TAG)) return html;
  return html.replace("</body>", `${NEWSLETTER_SCRIPT_TAG}\n</body>`);
}

for (const slug of slugs) {
  const path = join(BLOG_DIR, slug, "index.html");
  const original = readFileSync(path, "utf8");
  const patched = ensureNewsletterScript(original);
  if (patched !== original) writeFileSync(path, patched);
}

const blogIndexPath = join(BLOG_DIR, "index.html");
const blogIndexOriginal = readFileSync(blogIndexPath, "utf8");
const blogIndexPatched = ensureNewsletterScript(blogIndexOriginal);
if (blogIndexPatched !== blogIndexOriginal) writeFileSync(blogIndexPath, blogIndexPatched);
```

- [ ] **Step 5: Criar `assets/newsletter.js`** (troque `WORKER_URL` pela URL real anotada no Task 9, Step 2)

```js
(function () {
  const WORKER_URL = "https://kapota-newsletter.SUBSTITUA-PELA-URL-REAL.workers.dev";

  function buildWidget() {
    const wrap = document.createElement("div");
    wrap.className = "nl-widget";
    wrap.innerHTML = `
      <style>
        .nl-widget { background:#0a0a0a; color:#fff; border-top:1px solid rgba(255,255,255,0.14); padding:2.4rem 0; }
        .nl-widget .nl-wrap { max-width:900px; margin:0 auto; padding:0 1.5rem; }
        .nl-widget h3 { font-family:"Space Grotesk", ui-sans-serif, sans-serif; font-size:1.15rem; margin:0 0 0.4rem; }
        .nl-widget p { font-family:"JUST Sans", -apple-system, sans-serif; color:#9a9a9a; font-size:0.92rem; margin:0 0 1rem; }
        .nl-widget form { display:flex; gap:0.6rem; flex-wrap:wrap; }
        .nl-widget input[type="email"] { flex:1; min-width:200px; padding:0.7rem 1rem; border-radius:999px; border:1px solid rgba(255,255,255,0.2); background:transparent; color:#fff; font-size:0.92rem; }
        .nl-widget button { padding:0.7rem 1.4rem; border-radius:999px; border:none; background:#b3711f; color:#fff; font-weight:700; font-family:"Space Grotesk", sans-serif; font-size:0.9rem; cursor:pointer; }
        .nl-widget .nl-msg { margin-top:0.7rem; font-size:0.85rem; }
      </style>
      <div class="nl-wrap">
        <h3>Quer saber quando sair post novo?</h3>
        <p>Deixa seu email, eu aviso quando publicar algo por aqui.</p>
        <form class="nl-form">
          <input type="email" class="nl-email" placeholder="seu@email.com" required>
          <button type="submit">Quero receber</button>
        </form>
        <div class="nl-msg" aria-live="polite"></div>
      </div>`;
    return wrap;
  }

  function attach(wrap) {
    const form = wrap.querySelector(".nl-form");
    const emailInput = wrap.querySelector(".nl-email");
    const msg = wrap.querySelector(".nl-msg");

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      msg.textContent = "Enviando...";
      try {
        const res = await fetch(`${WORKER_URL}/subscribe`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: emailInput.value.trim() }),
        });
        const data = await res.json();
        if (!res.ok) {
          msg.textContent = data.error || "Não deu pra cadastrar, tenta de novo.";
          return;
        }
        msg.textContent =
          data.status === "already-confirmed"
            ? "Você já tá inscrito!"
            : "Quase lá! Confirma no email que a gente te mandou.";
        if (data.status !== "already-confirmed") form.reset();
      } catch {
        msg.textContent = "Não deu pra cadastrar, tenta de novo.";
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    const footer = document.querySelector("footer");
    if (!footer || footer.previousElementSibling?.classList?.contains("nl-widget")) return;
    const widget = buildWidget();
    footer.parentNode.insertBefore(widget, footer);
    attach(widget);
  });
})();
```

- [ ] **Step 6: Rodar o gerador pra aplicar o self-heal em todos os posts existentes**

```bash
node scripts/generate-site.mjs
git status
```
Expected: `assets/newsletter.js`, `scripts/lib/posts.mjs`, `scripts/generate-site.mjs` novos/modificados, e todos os `blog/*/index.html` + `blog/index.html` com a linha do script adicionada.

- [ ] **Step 7: Teste manual no navegador**

Abra `blog/index.html` localmente (ou `python3 -m http.server` na raiz do repo) e confirme visualmente que a faixa preta de cadastro aparece antes do rodapé, e que o formulário chama o Worker (teste cadastrando um email real e confirme que chega o email de confirmação).

- [ ] **Step 8: Commit e push**

```bash
git add -A
git commit -m "Adiciona widget de cadastro da newsletter em todos os posts e na listagem"
git push
```

---

## Task 12: Automatizar o aviso na Action existente

**Files:**
- Create: `scripts/notify-subscribers.mjs` (repositório `kapota-site`)
- Modify: `.github/workflows/sitemap.yml` (repositório `kapota-site`)

**Interfaces:**
- Consumes: `getPosts`, `SITE` de `scripts/lib/posts.mjs` (Task 11).

- [ ] **Step 1: Criar `scripts/notify-subscribers.mjs`**

```js
#!/usr/bin/env node
import { getPosts, SITE } from "./lib/posts.mjs";

const WORKER_URL = process.env.NEWSLETTER_WORKER_URL;
const ADMIN_SECRET = process.env.NEWSLETTER_ADMIN_SECRET;

if (!WORKER_URL || !ADMIN_SECRET) {
  console.error("Faltam NEWSLETTER_WORKER_URL / NEWSLETTER_ADMIN_SECRET no ambiente.");
  process.exit(1);
}

const posts = getPosts(process.cwd());

for (const post of posts) {
  const res = await fetch(`${WORKER_URL}/admin/send`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${ADMIN_SECRET}`,
    },
    body: JSON.stringify({
      slug: post.slug,
      title: post.title,
      excerpt: post.excerpt,
      category: post.category,
      url: `${SITE}/blog/${post.slug}/`,
    }),
  });
  const data = await res.json();
  console.log(`${post.slug}: ${res.status} ${JSON.stringify(data)}`);
}
```

- [ ] **Step 2: Modificar `.github/workflows/sitemap.yml`** — adicionar o passo novo depois de gerar o site, e incluir os posts individuais no diff que decide se commita

```yaml
      - name: Gerar sitemap.xml, blog/index.html e index.html
        run: node scripts/generate-site.mjs

      - name: Avisar assinantes de post novo
        env:
          NEWSLETTER_WORKER_URL: ${{ secrets.NEWSLETTER_WORKER_URL }}
          NEWSLETTER_ADMIN_SECRET: ${{ secrets.NEWSLETTER_ADMIN_SECRET }}
        run: node scripts/notify-subscribers.mjs

      - name: Commitar se mudou
        run: |
          if git diff --quiet sitemap.xml blog/index.html index.html blog/*/index.html assets/newsletter.js; then
            echo "Nada mudou."
            exit 0
          fi
          git config user.name "github-actions[bot]"
          git config user.email "github-actions[bot]@users.noreply.github.com"
          git add sitemap.xml blog/index.html index.html blog/*/index.html assets/newsletter.js
          git commit -m "Atualiza sitemap, listagem do blog e destaques da home automaticamente"
          git push
```

- [ ] **Step 3: Configurar os secrets da Action**

```bash
gh secret set NEWSLETTER_WORKER_URL --repo sigakapota/kapota-site --body "https://kapota-newsletter.<conta>.workers.dev"
gh secret set NEWSLETTER_ADMIN_SECRET --repo sigakapota/kapota-site --body "<o mesmo ADMIN_SECRET configurado no Worker no Task 9>"
```

- [ ] **Step 4: Commit e push**

```bash
git add scripts/notify-subscribers.mjs .github/workflows/sitemap.yml
git commit -m "Chama o Worker de newsletter depois de publicar post novo"
git push
```

- [ ] **Step 5: Rodar a Action manualmente e confirmar que não envia nada** (porque todos os posts atuais já estão em `sent_campaigns` desde o Task 9)

```bash
gh workflow run sitemap.yml --repo sigakapota/kapota-site
sleep 20
gh run list --repo sigakapota/kapota-site --workflow=sitemap.yml --limit 1
gh run view --repo sigakapota/kapota-site --log $(gh run list --repo sigakapota/kapota-site --workflow=sitemap.yml --limit 1 --json databaseId --jq '.[0].databaseId') | grep -i "already-sent\|error"
```
Expected: uma linha `already-sent` pra cada post existente, nenhum erro.

---

## Task 13: Teste ponta a ponta

**Files:** nenhum — verificação manual.

- [ ] **Step 1: Cadastrar um email real** no formulário publicado em `kapota.com.br/blog/`.

- [ ] **Step 2: Confirmar** clicando no link recebido por email.

- [ ] **Step 3: Forçar o aviso de um post "novo"** — escolha um slug de teste que não esteja em `sent_campaigns` (ou remova temporariamente uma linha do seed) e rode:

```bash
curl -s -X POST https://kapota-newsletter.<conta>.workers.dev/admin/send \
  -H "Authorization: Bearer <ADMIN_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{"slug":"post-de-teste-e2e","title":"Título de teste","url":"https://kapota.com.br/blog/tres-as-da-vida/","excerpt":"Teste ponta a ponta"}'
```

- [ ] **Step 4: Verificar** que o email chegou, com o link "Ler artigo" e o link de descadastro funcionando.

- [ ] **Step 5: Clicar em descadastrar** e confirmar que o status vira `unsubscribed`.

- [ ] **Step 6: Rodar o mesmo `curl` do Step 3 de novo** e confirmar que a resposta é `{"status":"already-sent"}` — não duplica envio.

---

## Self-Review

**1. Cobertura do spec:** endpoints `/subscribe`, `/confirm`, `/unsubscribe`, `/admin/send` (Tasks 4-7); tabelas `subscribers`/`sent_campaigns` (Task 1); Resend + domínio (Tasks 3, 10); CORS restrito (Task 4); formulário nos dois lugares (Task 11, self-heal cobre posts + listagem); automação via Action existente (Task 12); idempotência (`sent_campaigns`, testado no Task 7); segredos nunca versionados (Tasks 9, 12); seed pra não avisar sobre posts antigos (Task 9); teste ponta a ponta (Task 13). Sem lacunas encontradas.

**2. Placeholders:** nenhum "TBD"/"implementar depois" restante — o único valor que o executor precisa preencher manualmente é a URL real do Worker (Task 9 → 11 → 12), que é inerente a fazer um deploy de verdade, não uma lacuna de design.

**3. Consistência de nomes:** `handleSubscribe`/`handleConfirm`/`handleUnsubscribe`/`handleAdminSend` usados de forma consistente entre os handlers (Tasks 4-7) e o router (Task 8); funções de `db.js` (Task 2) chamadas com os mesmos nomes em todos os handlers; `getPosts`/`SITE` de `scripts/lib/posts.mjs` (Task 11) consumidos com a mesma assinatura em `generate-site.mjs` e `notify-subscribers.mjs` (Task 12).
