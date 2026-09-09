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
