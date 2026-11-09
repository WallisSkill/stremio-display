import { DurableObject } from "cloudflare:workers";

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

async function userId(authKey, env) {
  if (typeof authKey !== "string" || authKey.length < 8 || authKey.length > 256) return null;
  const res = await fetch((env && env.STREMIO_GET_USER) || GET_USER, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "GetUser", authKey }),
  });
  if (!res.ok) return null;
  const data = await res.json().catch(() => null);
  const id = data && data.result && data.result._id;
  return typeof id === "string" && id ? id : null;
}

const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

async function cachedUserId(authKey, env) {
  if (typeof authKey !== "string" || authKey.length < 8 || authKey.length > 256) return null;
  const digest = hex(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(authKey)));
  const key = new Request(`https://auth.wistv.invalid/${digest}`);
  const cache = typeof caches !== "undefined" ? caches.default : null;
  const hit = cache && (await cache.match(key));
  if (hit) return hit.text();
  const uid = await userId(authKey, env);
  if (uid && cache) await cache.put(key, new Response(uid, { headers: { "cache-control": "max-age=600" } }));
  return uid;
}

const MAIN = "main";
const PROFILE_ID = /^[a-z0-9]{1,16}$/;
const PIN = /^\d{6}$/;
const MAX_PROFILES = 8;
const COLORS = 8;
const MAX_NAME = 20;
const MAX_ITEMS = 5000;
const MAX_ITEM_BYTES = 64 * 1024;
const MAX_CHANGES = 200;
const MAX_IDS = 500;
const MAX_PREFS_BYTES = 64 * 1024;
const METHODS = new Set(["profilesGet", "profilesSet", "profileUnlock", "datastoreGet", "datastorePut", "prefsGet", "prefsSet"]);

const fail = (message, status = 400) => reply({ error: { message } }, status);
const enc = (s) => new TextEncoder().encode(s);

class Refused extends Error {}

async function pinHash(pin, salt) {
  const key = await crypto.subtle.importKey("raw", enc(pin), "PBKDF2", false, ["deriveBits"]);
  return hex(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: enc(salt), iterations: 100000 }, key, 256));
}

const tokenOf = async (row) => hex(await crypto.subtle.digest("SHA-256", enc(`${row.id}:${row.hash}`)));

function same(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  return crypto.subtle.timingSafeEqual(enc(a), enc(b));
}

function cleanProfiles(list) {
  if (!Array.isArray(list) || !list.length || list.length > MAX_PROFILES) throw new Refused(`Cần từ 1 đến ${MAX_PROFILES} hồ sơ`);
  const seen = new Set();
  const out = list.map((p, pos) => {
    const id = p && typeof p.id === "string" ? p.id : "";
    if (!PROFILE_ID.test(id) || seen.has(id)) throw new Refused("Mã hồ sơ không hợp lệ");
    seen.add(id);
    const name = typeof p.name === "string" ? p.name.trim().replace(/\s+/g, " ") : "";
    if ([...name].length > MAX_NAME || (!name && id !== MAIN)) throw new Refused(`Tên hồ sơ cần từ 1 đến ${MAX_NAME} ký tự`);
    const color = Number.isInteger(p.color) && p.color >= 0 && p.color < COLORS ? p.color : 0;
    let pin;
    if (p.pin === null) pin = null;
    else if (p.pin !== undefined) {
      if (typeof p.pin !== "string" || !PIN.test(p.pin)) throw new Refused("Mã PIN cần đúng 6 chữ số");
      pin = p.pin;
    }
    return { id, name, color, pos, pin };
  });
  if (!seen.has(MAIN)) throw new Refused("Không xoá được hồ sơ chính");
  return out;
}

export class ProfileStore extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec("CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, name TEXT NOT NULL, color INTEGER NOT NULL, pos INTEGER NOT NULL, salt TEXT, hash TEXT)");
    this.sql.exec("CREATE TABLE IF NOT EXISTS items (profile TEXT NOT NULL, id TEXT NOT NULL, mtime TEXT NOT NULL, data TEXT NOT NULL, PRIMARY KEY (profile, id))");
    this.sql.exec("CREATE TABLE IF NOT EXISTS prefs (profile TEXT PRIMARY KEY, at INTEGER NOT NULL, data TEXT NOT NULL)");
  }

  rows() {
    return this.sql.exec("SELECT id, name, color, salt, hash FROM profiles ORDER BY pos").toArray();
  }

  list() {
    const rows = this.rows();
    if (!rows.length) return [{ id: MAIN, name: "", color: 0, locked: false }];
    return rows.map((r) => ({ id: r.id, name: r.name, color: r.color, locked: !!r.hash }));
  }

  async allowed(row, token) {
    return !row.hash || same(await tokenOf(row), token);
  }

  async extra(profile, token) {
    const row = profile === MAIN ? null : this.rows().find((r) => r.id === profile);
    if (!row) throw new Refused("Hồ sơ này không còn");
    if (!(await this.allowed(row, token))) throw new Refused("Hồ sơ đang khoá, hãy chọn lại hồ sơ và nhập mã PIN");
    return profile;
  }

  async member(profile, token) {
    const row = this.rows().find((r) => r.id === profile);
    if (!row && !(profile === MAIN && !this.rows().length)) throw new Refused("Hồ sơ này không còn");
    if (row && !(await this.allowed(row, token))) throw new Refused("Hồ sơ đang khoá, hãy chọn lại hồ sơ và nhập mã PIN");
    return profile;
  }

  async prefsGet({ profile, token }) {
    const pid = await this.member(profile, token);
    const row = this.sql.exec("SELECT data FROM prefs WHERE profile = ?", pid).toArray()[0];
    return row ? JSON.parse(row.data) : null;
  }

  async prefsSet({ profile, token, prefs }) {
    const pid = await this.member(profile, token);
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) throw new Refused("Cài đặt không hợp lệ");
    const data = JSON.stringify(prefs);
    if (data.length > MAX_PREFS_BYTES) throw new Refused("Cài đặt quá lớn");
    const at = Number.isFinite(prefs._at) ? prefs._at : Date.now();
    const old = this.sql.exec("SELECT at FROM prefs WHERE profile = ?", pid).toArray()[0];
    if (old && old.at > at) return { success: false, stale: true };
    this.sql.exec("INSERT OR REPLACE INTO prefs (profile, at, data) VALUES (?, ?, ?)", pid, at, data);
    return { success: true };
  }

  async run(method, body) {
    if (!METHODS.has(method)) return { refused: "not found" };
    try {
      return await this[method](body);
    } catch (e) {
      if (e instanceof Refused) return { refused: e.message };
      throw e;
    }
  }

  profilesGet() {
    return this.list();
  }

  async profileUnlock({ profile, pin }) {
    const row = this.rows().find((r) => r.id === profile);
    if (!row) {
      if (profile === MAIN) return { token: "" };
      throw new Refused("Hồ sơ này không còn");
    }
    if (!row.hash) return { token: "" };
    const ok = typeof pin === "string" && PIN.test(pin) && same(await pinHash(pin, row.salt), row.hash);
    if (!ok) throw new Refused("Sai mã PIN");
    return { token: await tokenOf(row) };
  }

  async profilesSet({ profiles, tokens }) {
    const next = cleanProfiles(profiles);
    const old = this.rows();
    const keys = tokens && typeof tokens === "object" ? tokens : {};
    for (const o of old) {
      if (!o.hash) continue;
      const n = next.find((p) => p.id === o.id);
      const changed = !n || n.name !== o.name || n.color !== o.color || n.pin !== undefined;
      if (changed && !(await this.allowed(o, keys[o.id]))) throw new Refused(`Cần mã PIN của hồ sơ ${o.name || "chính"} để sửa hoặc xoá`);
    }
    for (const n of next) {
      const o = old.find((r) => r.id === n.id);
      if (typeof n.pin === "string") {
        n.salt = crypto.randomUUID();
        n.hash = await pinHash(n.pin, n.salt);
      } else if (n.pin === null) {
        n.salt = null;
        n.hash = null;
      } else {
        n.salt = o ? o.salt : null;
        n.hash = o ? o.hash : null;
      }
    }
    const keep = new Set(next.map((p) => p.id));
    this.ctx.storage.transactionSync(() => {
      for (const o of old) if (!keep.has(o.id)) {
        this.sql.exec("DELETE FROM items WHERE profile = ?", o.id);
        this.sql.exec("DELETE FROM prefs WHERE profile = ?", o.id);
      }
      this.sql.exec("DELETE FROM profiles");
      for (const p of next) this.sql.exec("INSERT INTO profiles (id, name, color, pos, salt, hash) VALUES (?, ?, ?, ?, ?, ?)", p.id, p.name, p.color, p.pos, p.salt, p.hash);
    });
    return this.list();
  }

  async datastoreGet({ profile, token, ids, all }) {
    const pid = await this.extra(profile, token);
    if (all) return this.sql.exec("SELECT data FROM items WHERE profile = ?", pid).toArray().map((r) => JSON.parse(r.data));
    if (!Array.isArray(ids) || ids.length > MAX_IDS) throw new Refused("Danh sách mã không hợp lệ");
    const out = [];
    for (const id of ids) {
      if (typeof id !== "string") continue;
      const row = this.sql.exec("SELECT data FROM items WHERE profile = ? AND id = ?", pid, id).toArray()[0];
      if (row) out.push(JSON.parse(row.data));
    }
    return out;
  }

  async datastorePut({ profile, token, changes }) {
    const pid = await this.extra(profile, token);
    if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw new Refused("Thay đổi không hợp lệ");
    const rows = changes.map((item) => {
      const id = item && typeof item._id === "string" ? item._id : "";
      if (!id || id.length > 200) throw new Refused("Mục thư viện không hợp lệ");
      const data = JSON.stringify(item);
      if (data.length > MAX_ITEM_BYTES) throw new Refused("Mục thư viện quá lớn");
      return { id, data, mtime: typeof item._mtime === "string" ? item._mtime : new Date().toISOString() };
    });
    this.ctx.storage.transactionSync(() => {
      for (const r of rows) {
        const old = this.sql.exec("SELECT mtime FROM items WHERE profile = ? AND id = ?", pid, r.id).toArray()[0];
        if (old && old.mtime > r.mtime) continue;
        if (!old && this.sql.exec("SELECT COUNT(*) AS n FROM items WHERE profile = ?", pid).one().n >= MAX_ITEMS) throw new Refused("Thư viện hồ sơ đã đầy");
        this.sql.exec("INSERT OR REPLACE INTO items (profile, id, mtime, data) VALUES (?, ?, ?, ?)", pid, r.id, r.mtime, r.data);
      }
    });
    return { success: true };
  }
}

async function profileApi(request, env, method) {
  if (!METHODS.has(method)) return fail("not found", 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail("bad request");
  const uid = await cachedUserId(body.authKey, env);
  if (!uid) return fail("Phiên đăng nhập Stremio đã hết hạn", 401);
  const store = env.PROFILES.get(env.PROFILES.idFromName(uid));
  const out = await store.run(method, body);
  if (out && typeof out.refused === "string") return fail(out.refused);
  return reply({ result: out });
}

async function register(request, env) {
  const body = await request.json().catch(() => null);
  if (!body) return reply({ error: "bad request" }, 400);
  if (typeof body.url !== "string" || !TUNNEL.test(body.url)) return reply({ error: "bad tunnel url" }, 400);
  if (typeof body.token !== "string" || !TOKEN.test(body.token)) return reply({ error: "bad token" }, 400);
  const uid = await userId(body.authKey, env);
  if (!uid) return reply({ error: "unauthorized" }, 401);
  await env.RELAY.put(`relay:${uid}`, JSON.stringify({ url: body.url, token: body.token, at: Date.now() }), { expirationTtl: 1800 });
  return reply({ ok: true });
}

async function lookup(request, env) {
  const uid = await userId(request.headers.get("x-auth-key"), env);
  if (!uid) return reply({ error: "unauthorized" }, 401);
  const value = await env.RELAY.get(`relay:${uid}`);
  return value ? reply(value) : reply({ error: "offline" }, 404);
}

async function site(request, env) {
  if (request.method !== "GET" && request.method !== "HEAD") return reply({ error: "method not allowed" }, 405);
  const { pathname, search } = new URL(request.url);
  const origin = String(env.SITE_ORIGIN || "").replace(/\/+$/, "");
  if (!origin) return reply({ error: "not found" }, 404);
  const page = pathname.endsWith("/") || /\.(html|webmanifest)$/.test(pathname);
  const init = { method: request.method, redirect: "manual" };
  const res = await fetch(`${origin}${pathname}${search}`, page ? { ...init, cache: "no-store" } : { ...init, cf: { cacheTtl: 300 } });
  const headers = new Headers(res.headers);
  const moved = headers.get("location");
  if (moved && moved.startsWith(origin)) headers.set("location", moved.slice(origin.length) || "/");
  if (res.ok) {
    const versioned = /(^|&)v=[0-9a-f]{6,}/.test(search.slice(1));
    headers.set("cache-control", versioned ? "public, max-age=31536000, immutable" : page ? "no-cache" : "public, max-age=3600");
  }
  return new Response(res.body, { status: res.status, headers });
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/")) return site(request, env);
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    if (pathname.startsWith("/api/profile/")) {
      if (request.method !== "POST") return fail("method not allowed", 405);
      return profileApi(request, env, pathname.slice("/api/profile/".length));
    }
    if (pathname !== "/api/relay") return reply({ error: "not found" }, 404);
    if (request.method === "POST") return register(request, env);
    if (request.method === "GET") return lookup(request, env);
    return reply({ error: "method not allowed" }, 405);
  },
};
