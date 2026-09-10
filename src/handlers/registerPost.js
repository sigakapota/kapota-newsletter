import { upsertPost } from "../db.js";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

export async function handleRegisterPost(request, env) {
  if (!env.ADMIN_SECRET) {
    return json({ error: "ADMIN_SECRET não configurado" }, 500);
  }

  const auth = request.headers.get("Authorization") ?? "";
  if (auth !== `Bearer ${env.ADMIN_SECRET}`) {
    return json({ error: "Unauthorized" }, 401);
  }

  const post = await request.json().catch(() => null);
  if (!post?.slug || !post?.title || !post?.url || !post?.excerpt || !post?.category) {
    return json({ error: "Payload inválido" }, 400);
  }
  if (!/^\d{4}-\d{2}-\d{2}/.test(post.dateISO ?? "")) {
    return json({ error: "dateISO precisa ser uma data no formato YYYY-MM-DD" }, 400);
  }

  await upsertPost(env.DB, post, new Date().toISOString());
  return json({ status: "registered" });
}
