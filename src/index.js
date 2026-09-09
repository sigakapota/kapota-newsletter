import { handleSubscribe } from "./handlers/subscribe.js";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/subscribe") return handleSubscribe(request, env);
    return new Response("Not found", { status: 404 });
  },
};
