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

const SAID = {
  "wk.profileCount": "Cần từ 1 đến {max} hồ sơ",
  "wk.profileId": "Mã hồ sơ không hợp lệ",
  "wk.profileName": "Tên hồ sơ cần từ 1 đến {max} ký tự",
  "wk.pinFormat": "Mã PIN cần đúng 6 chữ số",
  "wk.mainProfile": "Không xoá được hồ sơ chính",
  "wk.profileGone": "Hồ sơ này không còn",
  "wk.profileLocked": "Hồ sơ đang khoá, hãy chọn lại hồ sơ và nhập mã PIN",
  "wk.badPrefs": "Cài đặt không hợp lệ",
  "wk.prefsTooBig": "Cài đặt quá lớn",
  "wk.pinWrong": "Sai mã PIN",
  "wk.pinNeeded": "Cần mã PIN của hồ sơ {name} để sửa hoặc xoá",
  "wk.pinNeededMain": "Cần mã PIN của hồ sơ chính để sửa hoặc xoá",
  "wk.badIds": "Danh sách mã không hợp lệ",
  "wk.badChanges": "Thay đổi không hợp lệ",
  "wk.badItem": "Mục thư viện không hợp lệ",
  "wk.itemTooBig": "Mục thư viện quá lớn",
  "wk.libraryFull": "Thư viện hồ sơ đã đầy",
  "wk.badMedia": "Phim không hợp lệ",
  "wk.noRoom": "Không có phòng này hoặc phòng đã đóng",
  "wk.badRequest": "Yêu cầu không hợp lệ",
  "wk.badHostKey": "Mã chủ phòng không đúng",
  "wk.roomFull": "Phòng đã đủ người",
  "wk.hostClosed": "Chủ phòng đã đóng phòng",
  "wk.roomExpired": "Phòng đã mở quá {n} giờ",
  "wk.hostLeft": "Chủ phòng đã rời phòng",
  "wk.sessionExpired": "Phiên đăng nhập Stremio đã hết hạn",
  "wk.roomCreateFail": "Chưa tạo được phòng, hãy thử lại",
  "wk.needWebSocket": "Cần kết nối WebSocket",
  "wk.badRoomCode": "Mã phòng không hợp lệ",
  "wk.roomPwFormat": "Mật khẩu phòng cần từ 4 đến 32 ký tự",
  "wk.roomPwTries": "Nhập sai mật khẩu quá nhiều lần, hãy thử lại sau",
};
const said = (key, params) => (SAID[key] || key).replace(/\{(\w+)\}/g, (m, k) => (params && params[k] != null ? String(params[k]) : m));
const coded = (key, params) => (SAID[key] ? { message: said(key, params), key, ...(params ? { params } : {}) } : { message: key });
const fail = (key, status = 400, params) => reply({ error: coded(key, params) }, status);
const enc = (s) => new TextEncoder().encode(s);

class Refused extends Error {
  constructor(key, params) {
    super(said(key, params));
    this.key = key;
    this.params = params;
  }
}

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
  if (!Array.isArray(list) || !list.length || list.length > MAX_PROFILES) throw new Refused("wk.profileCount", { max: MAX_PROFILES });
  const seen = new Set();
  const out = list.map((p, pos) => {
    const id = p && typeof p.id === "string" ? p.id : "";
    if (!PROFILE_ID.test(id) || seen.has(id)) throw new Refused("wk.profileId");
    seen.add(id);
    const name = typeof p.name === "string" ? p.name.trim().replace(/\s+/g, " ") : "";
    if ([...name].length > MAX_NAME || (!name && id !== MAIN)) throw new Refused("wk.profileName", { max: MAX_NAME });
    const color = Number.isInteger(p.color) && p.color >= 0 && p.color < COLORS ? p.color : 0;
    let pin;
    if (p.pin === null) pin = null;
    else if (p.pin !== undefined) {
      if (typeof p.pin !== "string" || !PIN.test(p.pin)) throw new Refused("wk.pinFormat");
      pin = p.pin;
    }
    return { id, name, color, pos, pin };
  });
  if (!seen.has(MAIN)) throw new Refused("wk.mainProfile");
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
    if (!row) throw new Refused("wk.profileGone");
    if (!(await this.allowed(row, token))) throw new Refused("wk.profileLocked");
    return profile;
  }

  async member(profile, token) {
    const row = this.rows().find((r) => r.id === profile);
    if (!row && !(profile === MAIN && !this.rows().length)) throw new Refused("wk.profileGone");
    if (row && !(await this.allowed(row, token))) throw new Refused("wk.profileLocked");
    return profile;
  }

  async prefsGet({ profile, token }) {
    const pid = await this.member(profile, token);
    const row = this.sql.exec("SELECT data FROM prefs WHERE profile = ?", pid).toArray()[0];
    return row ? JSON.parse(row.data) : null;
  }

  async prefsSet({ profile, token, prefs }) {
    const pid = await this.member(profile, token);
    if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) throw new Refused("wk.badPrefs");
    const data = JSON.stringify(prefs);
    if (data.length > MAX_PREFS_BYTES) throw new Refused("wk.prefsTooBig");
    const at = Number.isFinite(prefs._at) ? prefs._at : Date.now();
    const old = this.sql.exec("SELECT at FROM prefs WHERE profile = ?", pid).toArray()[0];
    if (old && old.at > at) return { success: false, stale: true };
    this.sql.exec("INSERT OR REPLACE INTO prefs (profile, at, data) VALUES (?, ?, ?)", pid, at, data);
    return { success: true };
  }

  async run(method, body) {
    if (!METHODS.has(method)) return { refused: { key: "not found" } };
    try {
      return await this[method](body);
    } catch (e) {
      if (e instanceof Refused) return { refused: { key: e.key, params: e.params } };
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
      throw new Refused("wk.profileGone");
    }
    if (!row.hash) return { token: "" };
    const ok = typeof pin === "string" && PIN.test(pin) && same(await pinHash(pin, row.salt), row.hash);
    if (!ok) throw new Refused("wk.pinWrong");
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
      if (changed && !(await this.allowed(o, keys[o.id]))) throw o.name ? new Refused("wk.pinNeeded", { name: o.name }) : new Refused("wk.pinNeededMain");
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
    if (!Array.isArray(ids) || ids.length > MAX_IDS) throw new Refused("wk.badIds");
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
    if (!Array.isArray(changes) || changes.length > MAX_CHANGES) throw new Refused("wk.badChanges");
    const rows = changes.map((item) => {
      const id = item && typeof item._id === "string" ? item._id : "";
      if (!id || id.length > 200) throw new Refused("wk.badItem");
      const data = JSON.stringify(item);
      if (data.length > MAX_ITEM_BYTES) throw new Refused("wk.itemTooBig");
      return { id, data, mtime: typeof item._mtime === "string" ? item._mtime : new Date().toISOString() };
    });
    this.ctx.storage.transactionSync(() => {
      for (const r of rows) {
        const old = this.sql.exec("SELECT mtime FROM items WHERE profile = ? AND id = ?", pid, r.id).toArray()[0];
        if (old && old.mtime > r.mtime) continue;
        if (!old && this.sql.exec("SELECT COUNT(*) AS n FROM items WHERE profile = ?", pid).one().n >= MAX_ITEMS) throw new Refused("wk.libraryFull");
        this.sql.exec("INSERT OR REPLACE INTO items (profile, id, mtime, data) VALUES (?, ?, ?, ?)", pid, r.id, r.mtime, r.data);
      }
    });
    return { success: true };
  }
}

const ROOM_CODE = /^[A-HJ-NP-Z2-9]{6}$/;
const ROOM_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const CLIENT_ID = /^[a-z0-9]{8,32}$/;
const HTTP_URL = /^https?:\/\/[^\s"'()\\<>]{1,500}$/;
const SUB_URL = /^https?:\/\/[^\s"<>\\]{1,2000}$/;
const STREAM_URL = /^(https?|magnet|rtmp|rtsp):[^\s"<>\\]{1,4000}$/;
const HEADER_NAME = /^[A-Za-z0-9-]{1,64}$/;

function cleanHeaders(h) {
  if (!h || typeof h !== "object" || Array.isArray(h)) return undefined;
  const out = {};
  for (const [k, v] of Object.entries(h).slice(0, 20)) if (HEADER_NAME.test(k) && typeof v === "string" && v.length <= 1000) out[k] = v;
  return Object.keys(out).length ? out : undefined;
}
const MAX_MEMBERS = 12;
const ROOM_LIFE_MS = 12 * 3600e3;
const HOST_GRACE_MS = 3 * 60e3;
const MAX_FRAME = 32 * 1024;
const MAX_CHAT = 300;
const CHAT_GAP_MS = 400;
const REACTIONS = ["❤️", "😂", "😮", "😢", "👏", "🔥", "😍", "🤣", "😱", "😭", "👍", "👎", "🙏", "💯", "🎉", "😴", "🤔", "😡"];

const clip = (v, n) => (typeof v === "string" ? v.trim().replace(/\s+/g, " ").slice(0, n) : "");
const httpUrl = (v) => (typeof v === "string" && HTTP_URL.test(v) ? v : undefined);
const PW_TRIES = 5;
const PW_FAIL_WINDOW_MS = 10 * 60e3;
const PW_FAIL_MAX = 30;
const pwOk = (pw) => typeof pw === "string" && [...pw].length >= 4 && [...pw].length <= 32 && !/[\u0000-\u001f\u007f]/.test(pw);
const memberName = (v) => [...clip(v, 80)].slice(0, MAX_NAME).join("") || "Khách";

function cleanMedia(m) {
  if (!m || typeof m !== "object") throw new Refused("wk.badMedia");
  const id = clip(m.id, 200);
  const type = clip(m.type, 20);
  const vid = clip(m.vid, 200);
  if (!id || !type || !vid) throw new Refused("wk.badMedia");
  const s = m.hint && typeof m.hint === "object" ? m.hint : {};
  const hint = {
    infoHash: typeof s.infoHash === "string" && /^[0-9a-f]{40}$/i.test(s.infoHash) ? s.infoHash.toLowerCase() : undefined,
    fileIdx: Number.isInteger(s.fileIdx) && s.fileIdx >= 0 ? s.fileIdx : undefined,
    sources: Array.isArray(s.sources) ? s.sources.filter((x) => typeof x === "string" && x.length <= 300).slice(0, 40) : undefined,
    filename: clip(s.filename, 300) || undefined,
    bingeGroup: clip(s.bingeGroup, 200) || undefined,
    addon: clip(s.addon, 100) || undefined,
    name: clip(s.name, 200) || undefined,
    ytId: typeof s.ytId === "string" && /^[\w-]{6,20}$/.test(s.ytId) ? s.ytId : undefined,
    url: typeof s.url === "string" && STREAM_URL.test(s.url) ? s.url : undefined,
    headers: cleanHeaders(s.headers),
    notWebReady: s.notWebReady === true || undefined,
  };
  const start = Number.isFinite(m.start) && m.start >= 0 ? Math.min(m.start, 1e9) : 0;
  return { id, type, vid, name: clip(m.name, 200), label: clip(m.label, 200), poster: httpUrl(m.poster), background: httpUrl(m.background), start, hint };
}

function cleanTrack(t, url) {
  if (!t || typeof t !== "object") return null;
  if (t.off) return { off: true };
  const out = { lang: clip(t.lang, 20), title: clip(t.title, 200) };
  if (Number.isInteger(t.idx) && t.idx >= 0 && t.idx < 200) out.idx = t.idx;
  if (url && typeof t.url === "string" && SUB_URL.test(t.url)) out.url = t.url;
  return out;
}

function cleanTracks(m, vid) {
  const delay = Number.isFinite(m.delay) ? Math.max(-600, Math.min(600, Math.round(m.delay * 10) / 10)) : 0;
  return { vid, sub: cleanTrack(m.sub, true), audio: cleanTrack(m.audio, false), delay };
}

function cleanPlay(p, now, vid) {
  const pos = Number.isFinite(p.pos) && p.pos >= 0 ? Math.min(p.pos, 1e6) : 0;
  const rate = Number.isFinite(p.rate) && p.rate >= 0.25 && p.rate <= 4 ? p.rate : 1;
  return { paused: !!p.paused, hold: !!p.hold, pos, rate, at: now, vid };
}

export class WatchRoom extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.room = undefined;
    this.play = null;
    this.tracks = null;
  }

  async load() {
    if (this.room === undefined) {
      this.room = (await this.ctx.storage.get("room")) || null;
      this.play = (await this.ctx.storage.get("play")) || null;
      this.tracks = (await this.ctx.storage.get("tracks")) || null;
    }
    return this.room;
  }

  async save() {
    await this.ctx.storage.put("room", this.room);
  }

  async schedule() {
    const r = this.room;
    await this.ctx.storage.setAlarm(Math.min(r.created + ROOM_LIFE_MS, r.hostGone ? r.hostGone + HOST_GRACE_MS : Infinity));
  }

  async init(hostKey, uid) {
    if (await this.load()) return false;
    this.room = { hostKey, uid, created: Date.now(), media: null, hostGone: null };
    this.play = null;
    this.tracks = null;
    await this.save();
    await this.schedule();
    return true;
  }

  sockets(except) {
    return this.ctx.getWebSockets().filter((ws) => { if (ws === except || ws.readyState !== 1) return false; const w = this.who(ws); return !!w.id && !w.pending; });
  }

  who(ws) {
    try { return ws.deserializeAttachment() || {}; } catch (e) { return {}; }
  }

  send(ws, msg) {
    try { ws.send(JSON.stringify(msg)); } catch (e) {}
  }

  broadcast(msg, except) {
    const data = JSON.stringify(msg);
    for (const ws of this.sockets()) if (ws !== except) try { ws.send(data); } catch (e) {}
  }

  roster(except) {
    const members = this.sockets(except).map((ws) => this.who(ws)).map(({ id, name, host, waiting }) => ({ id, name, host: !!host, waiting: !!waiting }));
    return { members, hostOnline: members.some((m) => m.host) };
  }

  shareRoster(except) {
    const data = JSON.stringify({ t: "members", ...this.roster(except) });
    for (const ws of this.sockets(except)) try { ws.send(data); } catch (e) {}
  }

  async fetch(request) {
    const url = new URL(request.url);
    const [client, server] = Object.values(new WebSocketPair());
    const refuse = (code, key) => {
      server.accept();
      server.send(JSON.stringify({ t: "error", ...coded(key) }));
      server.close(code, "refused");
      return new Response(null, { status: 101, webSocket: client });
    };
    const room = await this.load();
    if (!room) return refuse(4404, "wk.noRoom");
    const id = url.searchParams.get("id") || "";
    if (!CLIENT_ID.test(id)) return refuse(4400, "wk.badRequest");
    const key = url.searchParams.get("key") || "";
    const host = !!key && same(key, room.hostKey);
    if (key && !host) return refuse(4403, "wk.badHostKey");
    const name = memberName(url.searchParams.get("name"));
    this.ctx.acceptWebSocket(server);
    if (!host && room.pw) {
      server.serializeAttachment({ pending: true, id, name, tries: 0 });
      this.send(server, { t: "auth" });
    } else {
      await this.admit(server, id, name, host);
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async admit(ws, id, name, host) {
    const room = this.room;
    for (const s of this.ctx.getWebSockets()) {
      const w = this.who(s);
      if (s !== ws && w.pending && w.id === id) try { s.close(4001, "replaced"); } catch (e) {}
    }
    const others = this.sockets(ws);
    const stale = others.filter((s) => { const w = this.who(s); return w.id === id || (host && w.host); });
    const guests = others.filter((s) => !stale.includes(s) && !this.who(s).host);
    if (!host && guests.length >= MAX_MEMBERS - 1) {
      this.send(ws, { t: "error", ...coded("wk.roomFull") });
      try { ws.close(4409, "refused"); } catch (e) {}
      return;
    }
    for (const s of stale) {
      this.send(s, { t: "replaced" });
      try { s.close(4001, "replaced"); } catch (e) {}
    }
    ws.serializeAttachment({ id, name, host, waiting: false, chatAt: 0, reactAt: 0 });
    if (host && room.hostGone) {
      room.hostGone = null;
      await this.save();
      await this.schedule();
    }
    const roster = this.roster();
    this.send(ws, { t: "welcome", you: id, host, now: Date.now(), media: room.media, play: this.play, tracks: this.tracks, reactions: REACTIONS, locked: !!room.pw, ...roster });
    const data = JSON.stringify({ t: "members", ...roster });
    for (const s of this.sockets()) if (s !== ws) try { s.send(data); } catch (e) {}
  }

  async checkPassword(ws, me, room, msg) {
    if (msg.t !== "auth") return;
    if (!room.pw) return this.admit(ws, me.id, me.name, false);
    const now = Date.now();
    this.pwFails = (this.pwFails || []).filter((t) => now - t < PW_FAIL_WINDOW_MS);
    const refuse = () => {
      this.send(ws, { t: "error", ...coded("wk.roomPwTries") });
      try { ws.close(4429, "refused"); } catch (e) {}
    };
    if (this.pwFails.length >= PW_FAIL_MAX) return refuse();
    const pw = typeof msg.pw === "string" ? msg.pw : "";
    if (pwOk(pw) && same(await pinHash(pw, room.pw.salt), room.pw.hash)) return this.admit(ws, me.id, me.name, false);
    this.pwFails.push(now);
    const tries = (me.tries || 0) + 1;
    if (tries >= PW_TRIES) return refuse();
    ws.serializeAttachment({ ...me, tries });
    this.send(ws, { t: "auth", wrong: true, left: PW_TRIES - tries });
  }

  async webSocketMessage(ws, data) {
    if (typeof data !== "string" || data.length > MAX_FRAME) return;
    let msg;
    try { msg = JSON.parse(data); } catch (e) { return; }
    if (!msg || typeof msg !== "object") return;
    const room = await this.load();
    if (!room) {
      try { ws.close(4404, "closed"); } catch (e) {}
      return;
    }
    const me = this.who(ws);
    if (me.pending) return this.checkPassword(ws, me, room, msg);
    const now = Date.now();
    if (msg.t === "ping") {
      this.send(ws, { t: "pong", c: Number.isFinite(msg.c) ? msg.c : 0, s: now });
      return;
    }
    if (msg.t === "status") {
      const waiting = !!msg.waiting;
      if (waiting !== !!me.waiting) {
        ws.serializeAttachment({ ...me, waiting });
        this.shareRoster();
      }
      return;
    }
    if (msg.t === "chat" || msg.t === "react") {
      const slot = msg.t === "chat" ? "chatAt" : "reactAt";
      if (now - (me[slot] || 0) < CHAT_GAP_MS) return;
      const text = msg.t === "chat" ? clip(msg.text, MAX_CHAT) : "";
      if (msg.t === "chat" ? !text : !REACTIONS.includes(msg.e)) return;
      ws.serializeAttachment({ ...me, [slot]: now });
      this.broadcast(msg.t === "chat" ? { t: "chat", id: me.id, from: me.name, host: !!me.host, text, at: now } : { t: "react", id: me.id, from: me.name, e: msg.e });
      return;
    }
    if (!me.host) return;
    if (msg.t === "media") {
      let media;
      try { media = cleanMedia(msg.media); } catch (e) { return; }
      room.media = media;
      this.play = { paused: true, hold: false, pos: media.start, rate: 1, at: now, vid: media.vid };
      this.tracks = null;
      await this.ctx.storage.put({ room, play: this.play, tracks: null });
      this.broadcast({ t: "media", media, play: this.play, tracks: null });
    } else if (msg.t === "play") {
      if (!room.media) return;
      this.play = cleanPlay(msg, now, room.media.vid);
      if (!msg.beat) await this.ctx.storage.put("play", this.play);
      this.broadcast({ t: "play", play: this.play }, ws);
    } else if (msg.t === "tracks") {
      if (!room.media) return;
      this.tracks = cleanTracks(msg, room.media.vid);
      await this.ctx.storage.put("tracks", this.tracks);
      this.broadcast({ t: "tracks", tracks: this.tracks }, ws);
    } else if (msg.t === "secret") {
      if (msg.pw !== null && !pwOk(msg.pw)) {
        this.send(ws, { t: "error", ...coded("wk.roomPwFormat") });
        return;
      }
      if (msg.pw === null) delete room.pw;
      else {
        const salt = crypto.randomUUID();
        room.pw = { salt, hash: await pinHash(msg.pw, salt) };
      }
      await this.save();
      this.broadcast({ t: "secret", on: !!room.pw });
    } else if (msg.t === "close") {
      await this.closeRoom("wk.hostClosed");
    }
  }

  async webSocketClose(ws) {
    try { ws.close(1000, "bye"); } catch (e) {}
    const room = await this.load();
    if (!room) return;
    const me = this.who(ws);
    if (me.host && !this.sockets(ws).some((s) => this.who(s).host)) {
      room.hostGone = Date.now();
      await this.save();
      await this.schedule();
    }
    this.shareRoster(ws);
  }

  async webSocketError(ws) {
    await this.webSocketClose(ws);
  }

  async alarm() {
    const room = await this.load();
    if (!room) return;
    const now = Date.now();
    if (now >= room.created + ROOM_LIFE_MS) return this.closeRoom("wk.roomExpired", { n: ROOM_LIFE_MS / 3600e3 });
    if (room.hostGone && now >= room.hostGone + HOST_GRACE_MS) return this.closeRoom("wk.hostLeft");
    await this.schedule();
  }

  async closeRoom(key, params) {
    for (const ws of this.ctx.getWebSockets()) {
      this.send(ws, { t: "closed", ...coded(key, params) });
      try { ws.close(4404, "closed"); } catch (e) {}
    }
    this.room = null;
    this.play = null;
    this.tracks = null;
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.delete(["room", "play", "tracks"]);
  }
}

function roomCode() {
  return [...crypto.getRandomValues(new Uint8Array(6))].map((b) => ROOM_LETTERS[b % ROOM_LETTERS.length]).join("");
}

async function roomCreate(request, env) {
  const body = await request.json().catch(() => null);
  const uid = await cachedUserId(body && body.authKey, env);
  if (!uid) return fail("wk.sessionExpired", 401);
  for (let i = 0; i < 6; i++) {
    const code = roomCode();
    const hostKey = hex(crypto.getRandomValues(new Uint8Array(32)));
    if (await env.ROOMS.get(env.ROOMS.idFromName(code)).init(hostKey, uid)) return reply({ result: { code, hostKey } });
  }
  return fail("wk.roomCreateFail", 503);
}

function roomSocket(request, env, code) {
  if ((request.headers.get("upgrade") || "").toLowerCase() !== "websocket") return fail("wk.needWebSocket", 426);
  if (!ROOM_CODE.test(code)) return fail("wk.badRoomCode", 404);
  return env.ROOMS.get(env.ROOMS.idFromName(code)).fetch(request);
}

async function profileApi(request, env, method) {
  if (!METHODS.has(method)) return fail("not found", 404);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return fail("bad request");
  const uid = await cachedUserId(body.authKey, env);
  if (!uid) return fail("wk.sessionExpired", 401);
  const store = env.PROFILES.get(env.PROFILES.idFromName(uid));
  const out = await store.run(method, body);
  if (out && out.refused) return fail(out.refused.key, 400, out.refused.params);
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
    if (pathname === "/api/room/create") {
      if (request.method !== "POST") return fail("method not allowed", 405);
      return roomCreate(request, env);
    }
    const room = /^\/api\/room\/([A-Za-z0-9]{6})\/ws$/.exec(pathname);
    if (room) return roomSocket(request, env, room[1].toUpperCase());
    if (pathname !== "/api/relay") return reply({ error: "not found" }, 404);
    if (request.method === "POST") return register(request, env);
    if (request.method === "GET") return lookup(request, env);
    return reply({ error: "method not allowed" }, 405);
  },
};
