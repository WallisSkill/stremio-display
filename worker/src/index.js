const GET_USER = "https://api.strem.io/api/getUser";
const TUNNEL = /^https:\/\/[a-z0-9-]+\.trycloudflare\.com$/;
const TOKEN = /^[0-9a-f]{64}$/;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-auth-key",
  "access-control-max-age": "86400",
};

const reply = (body, status = 200) =>
  new Response(typeof body === "string" ? body : JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store", ...CORS },
  });

async function userId(authKey) {
  if (typeof authKey !== "string" || authKey.length < 8 || authKey.length > 256) return null;
  const res = await fetch(GET_USER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "GetUser", authKey }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const id = data && data.result && data.result._id;
  return typeof id === "string" && id ? id : null;
}

async function register(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return reply({ error: "bad request" }, 400);
  if (typeof body.url !== "string" || !TUNNEL.test(body.url)) return reply({ error: "bad tunnel url" }, 400);
  if (typeof body.token !== "string" || !TOKEN.test(body.token)) return reply({ error: "bad token" }, 400);
  const uid = await userId(body.authKey);
  if (!uid) return reply({ error: "unauthorized" }, 401);
  await env.RELAY.put(`relay:${uid}`, JSON.stringify({ url: body.url, token: body.token, at: Date.now() }), { expirationTtl: 1800 });
  return reply({ ok: true });
}

async function lookup(request, env) {
  const uid = await userId(request.headers.get("x-auth-key"));
  if (!uid) return reply({ error: "unauthorized" }, 401);
  const value = await env.RELAY.get(`relay:${uid}`);
  return value ? reply(value) : reply({ error: "offline" }, 404);
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (pathname !== "/api/relay") return reply({ error: "not found" }, 404);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (request.method === "POST") return register(request, env);
    if (request.method === "GET") return lookup(request, env);
    return reply({ error: "method not allowed" }, 405);
  },
};
