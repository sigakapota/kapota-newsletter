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
