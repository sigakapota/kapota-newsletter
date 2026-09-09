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
