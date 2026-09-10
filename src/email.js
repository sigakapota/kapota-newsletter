const FROM = "Klysman Kley <novidades@kapota.com.br>";

function escapeHtml(str) {
  if (!str) return str;
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

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

function wordmark() {
  return `<div style="background:#0a0a0a;border-radius:16px;padding:28px 24px;margin-bottom:20px;">
    <p style="font-family:Georgia,serif;font-weight:700;font-size:19px;color:#fff;margin:0;letter-spacing:-0.01em;">kapota</p>
  </div>`;
}

export async function sendConfirmationEmail(env, email, confirmUrl) {
  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#f4f3f0;">
      ${wordmark()}
      <h1 style="font-size:22px;margin:0 0 16px;">Confirma sua inscrição</h1>
      <p style="font-size:15px;line-height:1.6;color:#333;">Clica no botão abaixo pra confirmar que quer receber o resumo semanal do blog.</p>
      <a href="${confirmUrl}" style="display:inline-block;margin-top:16px;background:#0a0a0a;color:#fff;text-decoration:none;padding:12px 24px;border-radius:999px;font-weight:700;">Confirmar inscrição</a>
      <p style="font-size:13px;color:#888;margin-top:24px;">Se você não pediu isso, pode ignorar este email.</p>
    </div>`;
  return sendEmail(env, { to: email, subject: "Confirma sua inscrição — blog do Kapota", html });
}

export async function sendWeeklyDigest(env, email, unsubscribeUrl, posts, weekLabel) {
  const escapedWeekLabel = escapeHtml(weekLabel);

  const cards = posts
    .map((post) => {
      const escapedTitle = escapeHtml(post.title);
      const escapedExcerpt = escapeHtml(post.excerpt ?? "");
      const escapedCategory = escapeHtml(post.category ?? "Novo post");
      const escapedUrl = escapeHtml(post.url);
      return `
      <div style="background:#fff;border:1px solid #00000014;border-radius:14px;padding:20px 22px;margin-bottom:14px;">
        <p style="font-size:11px;letter-spacing:0.08em;text-transform:uppercase;color:#b3711f;font-weight:700;margin:0 0 8px;">${escapedCategory}</p>
        <p style="font-size:17px;font-weight:700;color:#101010;margin:0 0 8px;line-height:1.3;">${escapedTitle}</p>
        <p style="font-size:14px;line-height:1.55;color:#666;margin:0 0 12px;">${escapedExcerpt}</p>
        <a href="${escapedUrl}" style="font-size:13px;font-weight:700;color:#101010;text-decoration:none;">Ler artigo &rarr;</a>
      </div>`;
    })
    .join("");

  const intro =
    posts.length === 1
      ? "1 post novo essa semana no blog. Separei o título aqui, sem enrolação."
      : `${posts.length} posts novos essa semana no blog. Separei os títulos aqui, sem enrolação.`;

  const html = `
    <div style="font-family:-apple-system,sans-serif;max-width:520px;margin:0 auto;padding:36px 28px;background:#f4f3f0;">
      <div style="background:#0a0a0a;border-radius:16px;padding:28px 24px;margin-bottom:20px;">
        <p style="font-family:Georgia,serif;font-weight:700;font-size:19px;color:#fff;margin:0 0 6px;letter-spacing:-0.01em;">kapota</p>
        <p style="font-size:13px;color:#b8b6b1;margin:0;">Resumo da semana &middot; ${escapedWeekLabel}</p>
      </div>
      <p style="font-size:15px;line-height:1.6;color:#333;margin:0 0 24px;">${intro}</p>
      ${cards}
      <p style="font-size:12px;color:#888;text-align:center;margin:24px 0 0;padding-top:8px;border-top:1px solid #00000014;">
        Não quer mais receber esse resumo? <a href="${unsubscribeUrl}" style="color:#888;">Descadastrar</a>
      </p>
    </div>`;

  const subject =
    posts.length === 1
      ? `Resumo da semana: 1 post novo no blog`
      : `Resumo da semana: ${posts.length} posts novos no blog`;

  return sendEmail(env, { to: email, subject, html });
}
