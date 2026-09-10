import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendConfirmationEmail, sendWeeklyDigest } from "../src/email.js";

const env = { RESEND_API_KEY: "re_test_key" };

const POST_A = {
  title: "Post de teste",
  url: "https://kapota.com.br/blog/post-de-teste/",
  excerpt: "Um resumo.",
  category: "Frase Comentada",
};

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

  it("sendWeeklyDigest inclui um card por post, com link e descadastro", async () => {
    await sendWeeklyDigest(env, "b@example.com", "https://worker.example/unsubscribe?token=u1", [POST_A], "08 a 14 de setembro");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.subject).toContain("1 post novo");
    expect(body.html).toContain("Post de teste");
    expect(body.html).toContain("https://kapota.com.br/blog/post-de-teste/");
    expect(body.html).toContain("https://worker.example/unsubscribe?token=u1");
    expect(body.html).toContain("08 a 14 de setembro");
  });

  it("sendWeeklyDigest lista múltiplos posts e usa plural no assunto", async () => {
    const postB = { ...POST_A, title: "Segundo post", url: "https://kapota.com.br/blog/segundo/" };
    await sendWeeklyDigest(env, "b@example.com", "https://worker.example/unsubscribe?token=u1", [POST_A, postB], "08 a 14 de setembro");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.subject).toContain("2 posts novos");
    expect(body.html).toContain("Post de teste");
    expect(body.html).toContain("Segundo post");
  });

  it("lança erro se o Resend responder com falha", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("erro interno", { status: 500 })));
    await expect(
      sendConfirmationEmail(env, "a@example.com", "https://worker.example/confirm?token=xyz")
    ).rejects.toThrow(/Resend falhou/);
  });

  it("escapa caracteres HTML especiais em título, resumo e categoria", async () => {
    await sendWeeklyDigest(env, "c@example.com", "https://worker.example/unsubscribe?token=u1", [
      {
        title: "<script>alert(1)</script>",
        url: "https://kapota.com.br/blog/test/",
        excerpt: "Resumo com <tags> & \"aspas\"",
        category: "<b>Categoria</b>",
      },
    ], "08 a 14 de setembro");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.html).not.toContain("<script>alert(1)</script>");
    expect(body.html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(body.html).toContain("&lt;tags&gt;");
    expect(body.html).toContain("&amp;");
    expect(body.html).toContain("&quot;");
    expect(body.html).toContain("&lt;b&gt;");
    // URLs should not contain the raw unescaped attribute-breaking sequence
    expect(body.html).toContain("https://kapota.com.br/blog/test/");
  });

  it("escapa aspas em post.url pra não quebrar o atributo href", async () => {
    await sendWeeklyDigest(env, "d@example.com", "https://worker.example/unsubscribe?token=u1", [
      {
        title: "Post com URL maliciosa",
        url: 'https://kapota.com.br/blog/x" onmouseover="alert(1)',
        excerpt: "Resumo normal.",
        category: "Categoria",
      },
    ], "08 a 14 de setembro");
    const body = JSON.parse(fetch.mock.calls[0][1].body);
    expect(body.html).not.toContain('x" onmouseover="alert(1)');
    expect(body.html).toContain("x&quot; onmouseover=&quot;alert(1)");
  });
});
