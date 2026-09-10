import { handleSubscribe } from "./handlers/subscribe.js";
import { handleConfirm } from "./handlers/confirm.js";
import { handleUnsubscribe } from "./handlers/unsubscribe.js";
import { handleRegisterPost } from "./handlers/registerPost.js";
import { sendPendingDigest } from "./digest.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/subscribe") return handleSubscribe(request, env);
    if (url.pathname === "/confirm") return handleConfirm(request, env);
    if (url.pathname === "/unsubscribe") return handleUnsubscribe(request, env);
    if (url.pathname === "/admin/register-post") return handleRegisterPost(request, env);
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env) {
    const result = await sendPendingDigest(env, new Date(event.scheduledTime));
    console.log(`Resumo semanal: ${JSON.stringify(result)}`);
  },
};
