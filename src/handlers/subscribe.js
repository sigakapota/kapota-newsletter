import {
  getSubscriberByEmail,
  insertPendingSubscriber,
  reopenAsPending,
  countRecentAttempts,
  recordAttempt,
} from "../db.js";
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

async function sendConfirmationSafely(env, email, confirmUrl) {
  try {
    await sendConfirmationEmail(env, email, confirmUrl);
    return null;
  } catch {
    return json(
      { error: "Não foi possível enviar o email de confirmação, tenta de novo em um instante." },
      503
    );
  }
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

  const now = new Date().toISOString();
  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const oneHourAgo = new Date(Date.parse(now) - 60 * 60 * 1000).toISOString();
  const recentAttempts = await countRecentAttempts(env.DB, ip, oneHourAgo);
  if (recentAttempts >= 5) {
    return json({ error: "Muitas tentativas. Tenta de novo mais tarde." }, 429);
  }

  const payload = await request.json().catch(() => ({}));
  const email = typeof payload.email === "string" ? payload.email.trim() : "";
  if (!EMAIL_RE.test(email)) {
    return json({ error: "Email inválido" }, 400);
  }

  const workerOrigin = new URL(request.url).origin;
  const existing = await getSubscriberByEmail(env.DB, email);

  if (!existing) {
    const confirmToken = generateToken();
    const unsubscribeToken = generateToken();
    await insertPendingSubscriber(env.DB, email, confirmToken, unsubscribeToken, now);
    const emailError = await sendConfirmationSafely(env, email, `${workerOrigin}/confirm?token=${confirmToken}`);
    await recordAttempt(env.DB, ip, now);
    if (emailError) return emailError;
    return json({ status: "pending" });
  }

  if (existing.status === "confirmed") {
    await recordAttempt(env.DB, ip, now);
    return json({ status: "already-confirmed" });
  }

  if (existing.status === "pending") {
    const emailError = await sendConfirmationSafely(env, email, `${workerOrigin}/confirm?token=${existing.confirm_token}`);
    await recordAttempt(env.DB, ip, now);
    if (emailError) return emailError;
    return json({ status: "pending" });
  }

  const confirmToken = generateToken();
  await reopenAsPending(env.DB, email, confirmToken, now);
  const emailError = await sendConfirmationSafely(env, email, `${workerOrigin}/confirm?token=${confirmToken}`);
  await recordAttempt(env.DB, ip, now);
  if (emailError) return emailError;
  return json({ status: "pending" });
}
