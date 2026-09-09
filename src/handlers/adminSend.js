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
