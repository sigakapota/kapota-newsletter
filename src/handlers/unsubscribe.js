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
