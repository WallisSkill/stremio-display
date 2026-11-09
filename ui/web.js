const API = "https://api.strem.io/api/";
const CINEMETA = "https://v3-cinemeta.strem.io/manifest.json";
const COLLECTIONS = ["https://api.strem.io/addonsofficialcollection.json", "https://api.strem.io/addonscollection.json"];
const HLS_JS = "https://cdnjs.cloudflare.com/ajax/libs/hls.js/1.5.13/hls.min.js";
const LOCAL_SERVER = "http://127.0.0.1:11470";
const SAVE_EVERY_MS = 30000;
const MAX_STEP_MS = 5000;

const store = {
  get(key, fallback = null) {
    try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch (e) { return fallback; }
  },
  set(key, value) {
    try { if (value == null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  },
};

const listeners = new Map();
export function onWebEvent(name, fn) {
  if (!listeners.has(name)) listeners.set(name, []);
  listeners.get(name).push(fn);
}
function emit(name, payload) {
  for (const fn of listeners.get(name) || []) {
    try { fn({ payload }); } catch (e) {}
  }
}

async function api(method, body) {
  let res;
  try {
    res = await fetch(API + method, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (e) {
    throw "Không kết nối được Stremio";
  }
  const data = await res.json().catch(() => null);
  if (!data) throw "Phản hồi Stremio không hợp lệ";
  if (data.error) throw (data.error.message || "Lỗi API Stremio");
  return data.result;
}

const session = () => store.get("wistv.session");
const authKey = () => session()?.authKey || null;

const CREDIT_WORDS = new Set(["sub", "subs", "subbed", "subber", "vietsub", "engsub", "fansub", "dịch", "fix", "fixed", "sync", "synced", "resync", "resynced", "rip", "ripped", "encoded", "edited", "corrected", "credit", "credits"]);
const CREDIT_PREFIXES = ["subtit", "translat", "vietsub", "fansub"];
const CREDIT_PHRASES = ["phụ đề", "biên dịch", "người dịch"];
const SUB_ADS = ["opensubtitles", "osdb.link", "vip member", "advertise"];

function subStamp(s) {
  const t = String(s || "").trim().split(/\s+/)[0].replace(",", ".");
  const [hms, frac = "0"] = t.split(".");
  let secs = 0;
  for (const part of hms.split(":")) { if (!/^\d+$/.test(part)) return null; secs = secs * 60 + Number(part); }
  if (!/^\d*$/.test(frac)) return null;
  return secs * 1000 + Number(frac.slice(0, 3).padEnd(3, "0"));
}

const stripBraces = (s) => s.replace(/\{[^}]*\}/g, "");
const stripTags = (s) => stripBraces(s.replace(/<[^>]*>/g, ""));

function isUrlToken(token) {
  const t = token.replace(/^[()[\]<>{}"',;:|]+|[()[\]<>{}"',;:|]+$/g, "").toLowerCase();
  if (t.includes("://") || t.startsWith("www.")) return true;
  const host = t.split("/")[0];
  const i = host.lastIndexOf(".");
  if (i <= 0) return false;
  const tld = host.slice(i + 1);
  return tld.length >= 2 && tld.length <= 6 && /^[a-z]+$/.test(tld);
}

function isCredit(text) {
  const low = stripTags(text).toLowerCase();
  if (SUB_ADS.some((a) => low.includes(a))) return false;
  if (CREDIT_PHRASES.some((p) => low.includes(p))) return true;
  return low.split(/\s+/).some((tok) => {
    if (!tok) return false;
    if (isUrlToken(tok)) return true;
    const w = tok.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, "");
    return CREDIT_WORDS.has(w) || CREDIT_PREFIXES.some((p) => w.startsWith(p));
  });
}

function cleanCredit(text) {
  const lines = [];
  for (const line of stripTags(text).split("\n")) {
    const s = line.split(/\s+/).filter((t) => t && !isUrlToken(t)).join(" ").replaceAll("()", "").replaceAll("[]", "").replace(/^[\s\-|:·,]+|[\s\-|:·,]+$/g, "");
    if (/[\p{L}\p{N}]/u.test(s)) lines.push(s);
  }
  const joined = lines.join(" · ");
  return [...joined].length > 140 ? [...joined].slice(0, 139).join("") + "…" : joined;
}

function parseSubCues(raw) {
  const text = raw.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n");
  const cues = [];
  if (text.includes("[Events]") || /^Dialogue:/m.test(text)) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("Dialogue:")) continue;
      const f = line.slice(9).split(",");
      if (f.length < 10) continue;
      const a = subStamp(f[1]), b = subStamp(f[2]);
      const body = stripBraces(f.slice(9).join(",")).replace(/\\[Nn]/g, "\n").trim();
      if (a != null && b != null && body) cues.push({ start: a, end: b, text: body });
    }
  } else {
    for (const block of text.split("\n\n")) {
      const lines = block.split("\n");
      const at = lines.findIndex((l) => l.includes("-->"));
      if (at < 0) continue;
      const [x, y] = lines[at].split("-->");
      const a = subStamp(x), b = subStamp(y);
      const body = lines.slice(at + 1).map((l) => l.trim()).filter(Boolean);
      if (a != null && b != null && body.length) cues.push({ start: a, end: b, text: body.join("\n") });
    }
  }
  return cues.sort((p, q) => p.start - q.start);
}

function summarizeSub(raw) {
  const cues = parseSubCues(raw);
  const n = cues.length;
  const credits = [];
  cues.forEach((c, i) => {
    if (i >= 3 && i + 3 < n) return;
    if (!isCredit(c.text)) return;
    const line = cleanCredit(c.text);
    if (line && !credits.includes(line)) credits.push(line);
  });
  return { credits, cues: n, start: n ? Math.min(...cues.map((c) => c.start)) : null, end: n ? Math.max(...cues.map((c) => c.end)) : null };
}

async function getJson(url) {
  let res;
  try { res = await fetch(url); } catch (e) { throw "Không kết nối được addon"; }
  if (!res.ok) throw `HTTP ${res.status}`;
  return res.json();
}

const addonBase = (a) => String(a.transportUrl || "").trim().replace(/\/manifest\.json$/, "").replace(/\/+$/, "");
const addonName = (a) => a.manifest?.name || addonBase(a);
const strs = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : null);

function supports(a, resource, kind, id) {
  const m = a.manifest || {};
  for (const r of m.resources || []) {
    const name = typeof r === "string" ? r : r?.name;
    if (name !== resource) continue;
    const types = (typeof r === "object" && strs(r.types)) || strs(m.types);
    const prefixes = (typeof r === "object" && strs(r.idPrefixes)) || strs(m.idPrefixes);
    const typeOk = !!types && types.includes(kind);
    const idOk = !prefixes || prefixes.some((p) => id.startsWith(p));
    if (typeOk && idOk) return true;
  }
  return false;
}

function resourceUrl(a, resource, kind, id, extra = []) {
  const ex = extra.length ? "/" + extra.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
  return `${addonBase(a)}/${resource}/${encodeURIComponent(kind)}/${encodeURIComponent(id)}${ex}.json`;
}

let addonCache = null;
async function loadAddons(refresh = false) {
  if (addonCache && !refresh) return addonCache;
  const key = authKey();
  if (key) {
    const res = await api("addonCollectionGet", { type: "AddonCollectionGet", authKey: key, update: true });
    addonCache = res.addons || [];
  } else {
    addonCache = [{ transportUrl: CINEMETA, manifest: await getJson(CINEMETA), flags: { official: true, protected: true } }];
  }
  return addonCache;
}

async function rawCollection(key) {
  const res = await api("addonCollectionGet", { type: "AddonCollectionGet", authKey: key, update: true });
  return res.addons || [];
}

async function setCollection(key, list) {
  await api("addonCollectionSet", { type: "AddonCollectionSet", authKey: key, addons: list });
  return loadAddons(true);
}

const needKey = (msg) => { const k = authKey(); if (!k) throw msg; return k; };

let libraryCache = [];
const nowIso = () => new Date().toISOString();

function newItem(id, name, kind, poster, now) {
  return {
    _id: id, name, type: kind, poster, posterShape: "poster", removed: true, temp: true, _ctime: now, _mtime: now,
    state: { lastWatched: null, timeWatched: 0, timeOffset: 0, overallTimeWatched: 0, timesWatched: 0, flaggedWatched: 0, duration: 0, video_id: null, watched: null, noNotif: false },
    behaviorHints: { defaultVideoId: null, featuredVideoId: null, hasScheduledVideos: false },
  };
}

function cacheItem(item) {
  const i = libraryCache.findIndex((x) => x._id === item._id);
  if (i >= 0) libraryCache[i] = item; else libraryCache.push(item);
}

async function libraryPut(key, item) {
  await api("datastorePut", { authKey: key, collection: "libraryItem", changes: [item] });
  cacheItem(item);
}

let relay = { base: null, at: 0 };
async function serverBase(force = false) {
  const manual = store.get("wistv.server");
  if (manual) return manual.replace(/\/+$/, "");
  if (!force && Date.now() - relay.at < 60000) return relay.base;
  const key = authKey();
  relay = { base: null, at: Date.now() };
  if (!key) return null;
  try {
    const api = document.querySelector('meta[name="wistv-relay-api"]')?.content || "api/relay";
    const res = await fetch(api, { headers: { "x-auth-key": key }, cache: "no-store" });
    if (res.ok) {
      const j = await res.json();
      if (j.url && j.token) relay.base = `${j.url}/${j.token}`;
    }
  } catch (e) {}
  return relay.base;
}

async function serverAlive(base) {
  if (!base) return false;
  try {
    const ctl = new AbortController();
    const t = setTimeout(() => ctl.abort(), 6000);
    const res = await fetch(`${base}/settings`, { signal: ctl.signal, cache: "no-store" });
    clearTimeout(t);
    return res.ok;
  } catch (e) { return false; }
}

async function torrentMedia(base, stream) {
  const hash = String(stream.infoHash).toLowerCase();
  const sources = Array.isArray(stream.sources) && stream.sources.length ? stream.sources : [`dht:${hash}`];
  const body = { torrent: { infoHash: hash }, peerSearch: { sources, min: 40, max: 150 } };
  if (stream.fileIdx == null) body.guessFileIdx = {};
  let created;
  try {
    const res = await fetch(`${base}/${hash}/create`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    created = await res.json();
  } catch (e) { throw "Không mở được torrent qua máy tính"; }
  let idx = stream.fileIdx ?? created?.guessedFileIdx;
  if (idx == null && Array.isArray(created?.files)) {
    let best = -1;
    created.files.forEach((f, i) => { if (best < 0 || (f.length || 0) > (created.files[best].length || 0)) best = i; });
    idx = best >= 0 ? best : null;
  }
  if (idx == null) throw "Không tìm thấy tệp video trong torrent";
  return `${LOCAL_SERVER}/${hash}/${idx}`;
}

let hlsLoading = null;
function loadHls() {
  if (window.Hls) return Promise.resolve(window.Hls);
  if (!hlsLoading) {
    hlsLoading = new Promise((resolve, reject) => {
      const s = document.createElement("script");
      s.src = HLS_JS;
      s.crossOrigin = "anonymous";
      s.onload = () => resolve(window.Hls);
      s.onerror = () => { hlsLoading = null; reject("Không tải được thư viện phát HLS"); };
      document.head.append(s);
    });
  }
  return hlsLoading;
}

function parseTime(s) {
  const m = /(?:(\d+):)?(\d{1,2}):(\d{1,2})[.,](\d{1,3})/.exec(s || "");
  if (!m) return NaN;
  const frac = Number(m[4]) / 10 ** m[4].length;
  return Number(m[1] || 0) * 3600 + Number(m[2]) * 60 + Number(m[3]) + frac;
}

const cleanText = (t) => t.replace(/\\N/gi, "\n").replace(/\{[^}]*\}/g, "").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();

function parseSubs(raw) {
  const text = raw.replace(/^﻿/, "").replace(/\r/g, "");
  const cues = [];
  if (/^\[Script Info\]/im.test(text)) {
    for (const line of text.split("\n")) {
      if (!line.startsWith("Dialogue:")) continue;
      const parts = line.slice(9).split(",");
      if (parts.length < 10) continue;
      const body = cleanText(parts.slice(9).join(","));
      if (body) cues.push({ start: parseTime(parts[1]), end: parseTime(parts[2]), text: body });
    }
  } else {
    for (const block of text.split(/\n{2,}/)) {
      const lines = block.split("\n");
      const i = lines.findIndex((l) => l.includes("-->"));
      if (i < 0) continue;
      const [a, b] = lines[i].split("-->");
      const body = cleanText(lines.slice(i + 1).join("\n"));
      if (body) cues.push({ start: parseTime(a), end: parseTime(b), text: body });
    }
  }
  return cues.filter((c) => !isNaN(c.start) && !isNaN(c.end)).sort((x, y) => x.start - y.start);
}

const SUB_STYLE = { scale: 1, pos: 100, margin: 60, color: "#FFFFFF", font: "Segoe UI Semibold", bold: false, italic: false, outline: 2.4, shadow: 1, box: false };

function mpvColor(v) {
  const m = /^#([0-9a-f]{2})?([0-9a-f]{6})$/i.exec(v || "");
  if (!m) return "#ffffff";
  const alpha = m[1] ? parseInt(m[1], 16) / 255 : 1;
  const rgb = m[2];
  return `rgba(${parseInt(rgb.slice(0, 2), 16)},${parseInt(rgb.slice(2, 4), 16)},${parseInt(rgb.slice(4, 6), 16)},${alpha.toFixed(3)})`;
}

const P = {
  root: null, video: null, subsEl: null, hls: null, ctx: null, session: 0, base: null, hlsId: null,
  loaded: false, buffering: true, ended: false, finished: true, timer: null, raf: 0,
  ext: [], sid: null, subDelay: 0, style: { ...SUB_STYLE }, sig: "", watch: null, saving: Promise.resolve(),
};

function ensureDom() {
  if (P.root) return;
  P.video = document.createElement("video");
  P.video.setAttribute("playsinline", "");
  P.video.setAttribute("webkit-playsinline", "");
  P.video.preload = "auto";
  P.subsEl = document.createElement("div");
  P.subsEl.id = "wv-subs";
  P.root = document.createElement("div");
  P.root.id = "wv";
  P.root.append(P.video, P.subsEl);
  document.body.prepend(P.root);
  const v = P.video;
  watchVideoFs(v);
  v.addEventListener("loadedmetadata", () => {
    if (P.finished) return;
    P.loaded = true;
    if (P.ctx.start > 0 && v.currentTime < 1) v.currentTime = P.ctx.start / 1000;
  });
  v.addEventListener("waiting", () => { P.buffering = true; });
  v.addEventListener("playing", () => { P.buffering = false; });
  v.addEventListener("canplay", () => { P.buffering = false; });
  v.addEventListener("seeking", () => { P.buffering = true; });
  v.addEventListener("seeked", () => { P.buffering = false; });
  v.addEventListener("ended", () => finish({ ended: true }));
  v.addEventListener("error", () => {
    if (P.finished || !v.error) return;
    if (useFallback()) return;
    finish({ error: P.base ? "Không phát được nguồn này" : "Trình duyệt không phát được định dạng này. Bật WiS TV Relay trên máy tính để xem mọi định dạng." });
  });
  window.addEventListener("resize", paintStyle);
}

function bufferedEnd() {
  const v = P.video;
  for (let i = 0; i < v.buffered.length; i++) {
    if (v.buffered.start(i) <= v.currentTime + 0.5 && v.buffered.end(i) >= v.currentTime) return v.buffered.end(i);
  }
  return v.currentTime;
}

function trackList() {
  const out = [];
  if (P.hls) {
    P.hls.audioTracks.forEach((t, i) => out.push({ id: i + 1, type: "audio", title: t.name, lang: t.lang, codec: null, channels: t.channels || null, external: false, selected: P.hls.audioTrack === i }));
  }
  P.ext.forEach((s, i) => out.push({ id: i + 1, type: "sub", title: s.title, lang: s.lang, codec: null, channels: null, external: true, selected: P.sid === i + 1 }));
  return out;
}

function snapshot() {
  const v = P.video;
  const s = {
    session: P.session,
    loaded: P.loaded,
    time: v.currentTime || 0,
    duration: isFinite(v.duration) ? v.duration : 0,
    paused: v.paused,
    buffering: P.buffering || !P.loaded,
    cache: P.loaded ? bufferedEnd() : null,
    cachePercent: null,
    volume: Math.round(v.volume * 100),
    mute: v.muted,
    speed: v.playbackRate,
    sid: P.sid ? String(P.sid) : "no",
    aid: P.hls ? String(P.hls.audioTrack + 1) : "1",
    subDelay: P.subDelay,
  };
  const sig = `${P.ext.length}|${P.sid}|${P.hls ? P.hls.audioTracks.length + ":" + P.hls.audioTrack : ""}`;
  if (sig !== P.sig) { P.sig = sig; s.tracks = trackList(); }
  return s;
}

function tick() {
  if (P.finished) return;
  const s = snapshot();
  emit("player-state", s);
  if (!s.loaded) return;
  const pos = Math.round(s.time * 1000);
  const dur = Math.round(s.duration * 1000);
  const w = P.watch;
  if (w.lastPos != null && !s.paused && !s.buffering && pos > w.lastPos && pos - w.lastPos < MAX_STEP_MS) w.unsaved += pos - w.lastPos;
  w.lastPos = pos;
  const justPaused = s.paused && !w.wasPaused;
  w.wasPaused = s.paused;
  if (dur > 0 && w.unsaved > 0 && (justPaused || Date.now() - w.lastSave >= SAVE_EVERY_MS)) {
    w.lastSave = Date.now();
    const watched = w.unsaved;
    w.unsaved = 0;
    queueSave(P.ctx, { position: pos, duration: dur, watched, finished: false }, true);
  }
}

function currentCueText() {
  const list = P.sid ? P.ext[P.sid - 1]?.cues : null;
  if (!list || !list.length) return "";
  const t = P.video.currentTime - P.subDelay;
  let lo = 0, hi = list.length - 1, idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (list[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  const out = [];
  for (let i = idx; i >= 0 && i > idx - 8; i--) if (list[i].end > t) out.unshift(list[i].text);
  return out.join("\n");
}

let lastSubText = null;
function drawSubs() {
  const text = P.finished ? "" : currentCueText();
  if (text !== lastSubText) {
    lastSubText = text;
    P.subsEl.replaceChildren(...(text ? text.split("\n").map((line) => { const span = document.createElement("span"); span.textContent = line; return span; }) : []));
  }
  P.raf = requestAnimationFrame(drawSubs);
}

function paintStyle() {
  if (!P.subsEl) return;
  const st = P.style;
  const u = (window.innerHeight || 720) / 720;
  const e = P.subsEl.style;
  e.fontSize = `${44 * st.scale * u}px`;
  e.bottom = `calc(${100 - Math.min(100, st.pos)}% + ${st.margin * u}px)`;
  e.color = mpvColor(st.color);
  e.fontFamily = `'${st.font}', 'Segoe UI', system-ui, sans-serif`;
  e.fontWeight = st.bold ? "800" : st.font.includes("Semibold") ? "600" : "400";
  e.fontStyle = st.italic ? "italic" : "normal";
  e.setProperty("--stroke", `${st.box ? 0 : st.outline * u * 2}px`);
  e.textShadow = st.shadow > 0 ? `${st.shadow * u}px ${st.shadow * u}px ${st.shadow * u}px rgba(0,0,0,0.85)` : "none";
  P.subsEl.classList.toggle("box", !!st.box);
}

function setStyleProp(name, value) {
  const st = P.style;
  const num = Number(value);
  switch (name) {
    case "sub-scale": st.scale = num || 1; break;
    case "sub-pos": st.pos = isNaN(num) ? 100 : num; break;
    case "sub-margin-y": st.margin = isNaN(num) ? 60 : num; break;
    case "sub-color": st.color = value; break;
    case "sub-font": st.font = value; break;
    case "sub-bold": st.bold = value === "yes"; break;
    case "sub-italic": st.italic = value === "yes"; break;
    case "sub-outline-size": case "sub-border-size": st.outline = isNaN(num) ? 2.4 : num; break;
    case "sub-shadow-offset": st.shadow = isNaN(num) ? 1 : num; break;
    case "sub-border-style": st.box = value === "background-box" || value === "opaque-box"; break;
    default: return false;
  }
  paintStyle();
  return true;
}

async function addSubtitle(url, title, lang) {
  const via = P.base ? `${P.base}/subtitles.vtt?from=${encodeURIComponent(url)}` : url;
  let text;
  try { const res = await fetch(via); if (!res.ok) throw 0; text = await res.text(); }
  catch (e) {
    if (via === url) throw "Không tải được phụ đề";
    try { text = await (await fetch(url)).text(); } catch (x) { throw "Không tải được phụ đề"; }
  }
  const cues = parseSubs(text);
  if (!cues.length) throw "Tệp phụ đề trống hoặc không đọc được";
  P.ext.push({ title, lang, cues });
  P.sid = P.ext.length;
}

function destroyMedia() {
  cancelAnimationFrame(P.raf);
  clearInterval(P.timer);
  if (P.hls) { try { P.hls.destroy(); } catch (e) {} P.hls = null; }
  const v = P.video;
  if (v) { v.pause(); v.removeAttribute("src"); try { v.load(); } catch (e) {} }
  if (P.base && P.hlsId) fetch(`${P.base}/hlsv2/${P.hlsId}/destroy`).catch(() => {});
  P.hlsId = null;
  lastSubText = null;
  if (P.subsEl) P.subsEl.replaceChildren();
  document.body.classList.remove("web-playing");
}

function finish({ ended = false, error = null } = {}) {
  if (P.finished) return;
  P.finished = true;
  const v = P.video;
  const duration = isFinite(v.duration) ? Math.round(v.duration * 1000) : 0;
  const position = ended ? duration : Math.round((v.currentTime || 0) * 1000);
  const ctx = P.ctx;
  const w = P.watch;
  if (w.lastPos != null && position > w.lastPos && position - w.lastPos < MAX_STEP_MS) w.unsaved += position - w.lastPos;
  destroyMedia();
  emit("player-ended", { session: ctx.session, id: ctx.id, video: ctx.video, position, duration, ended, error });
  if (!error) {
    const finishedWatching = ended || (duration > 0 && position * 10 >= duration * 9);
    queueSave(ctx, { position, duration, watched: w.unsaved, finished: finishedWatching }, false);
  }
}

function queueSave(ctx, p, quiet) {
  P.saving = P.saving.then(() => saveProgress(ctx, p)).then(
    () => emit("library-changed", { ok: true, quiet }),
    (e) => { if (!quiet) emit("library-changed", { ok: false, error: String(e) }); },
  );
}

async function saveProgress(ctx, p) {
  const key = authKey();
  if (!key || String(ctx.id).startsWith("local:") || !p.duration) return;
  const now = nowIso();
  const found = await api("datastoreGet", { authKey: key, collection: "libraryItem", ids: [ctx.id], all: false });
  const item = (Array.isArray(found) && found.find((i) => i._id === ctx.id)) || newItem(ctx.id, ctx.name, ctx.kind, ctx.poster, now);
  if (!item.state || typeof item.state !== "object") item.state = {};
  const s = item.state;
  const n = (v) => (typeof v === "number" ? v : 0);
  const same = s.video_id === ctx.video;
  s.lastWatched = now;
  s.video_id = ctx.video;
  s.duration = p.duration;
  s.timeWatched = (same ? n(s.timeWatched) : 0) + p.watched;
  s.overallTimeWatched = n(s.overallTimeWatched) + p.watched;
  if (ctx.kind === "series") {
    const m = /:(\d+):(\d+)$/.exec(ctx.video || "");
    if (m) { s.season = Number(m[1]); s.episode = Number(m[2]); }
  }
  if (!same) s.flaggedWatched = 0;
  if (p.finished) {
    s.timeOffset = 0;
    s.timesWatched = n(s.timesWatched) + 1;
    s.flaggedWatched = 1;
  } else {
    s.timeOffset = p.position;
    if (s.timesWatched == null) s.timesWatched = 0;
    if (s.flaggedWatched == null) s.flaggedWatched = 0;
  }
  if (s.noNotif == null) s.noNotif = false;
  item._mtime = now;
  await libraryPut(key, item);
}

function useFallback() {
  const src = P.fallback;
  if (!src) return false;
  P.fallback = null;
  if (P.hls) { try { P.hls.destroy(); } catch (e) {} P.hls = null; }
  if (P.base && P.hlsId) fetch(`${P.base}/hlsv2/${P.hlsId}/destroy`).catch(() => {});
  P.hlsId = null;
  P.loaded = false;
  P.buffering = true;
  attach(src, /\.m3u8(\?|$)/i.test(src))
    .then(() => {
      if (P.ctx.start > 0) P.video.addEventListener("loadedmetadata", () => { P.video.currentTime = P.ctx.start / 1000; }, { once: true });
      return P.video.play();
    })
    .catch((e) => { if (!P.finished) finish({ error: typeof e === "string" ? e : "Không phát được nguồn này" }); });
  return true;
}

async function attach(src, isHls) {
  const v = P.video;
  if (isHls) {
    let Hls = null;
    try { Hls = await loadHls(); } catch (e) { Hls = null; }
    if (Hls && Hls.isSupported()) {
      const patient = {
        default: {
          maxTimeToFirstByteMs: 90000,
          maxLoadTimeMs: 180000,
          timeoutRetry: { maxNumRetry: 3, retryDelayMs: 0, maxRetryDelayMs: 0 },
          errorRetry: { maxNumRetry: 6, retryDelayMs: 1000, maxRetryDelayMs: 8000 },
        },
      };
      const quick = { default: { ...patient.default, errorRetry: { maxNumRetry: 2, retryDelayMs: 1000, maxRetryDelayMs: 4000 } } };
      P.hls = new Hls({
        maxBufferLength: 60,
        startPosition: P.ctx.start > 0 ? P.ctx.start / 1000 : -1,
        manifestLoadPolicy: quick,
        playlistLoadPolicy: quick,
        fragLoadPolicy: patient,
      });
      P.hls.on(Hls.Events.ERROR, (_, data) => {
        if (!data.fatal || P.finished) return;
        if (!useFallback()) finish({ error: "Lỗi phát luồng HLS" });
      });
      P.hls.loadSource(src);
      P.hls.attachMedia(v);
      return;
    }
    if (!v.canPlayType("application/vnd.apple.mpegurl")) throw "Trình duyệt này không phát được luồng HLS";
  }
  v.src = src;
}

async function play({ stream, ctx }) {
  if (stream.externalUrl && !stream.url && !stream.infoHash) {
    window.open(stream.externalUrl, "_blank", "noopener");
    return;
  }
  if (stream.ytId) {
    window.open(`https://www.youtube.com/watch?v=${encodeURIComponent(stream.ytId)}`, "_blank", "noopener");
    return;
  }
  ensureDom();
  if (!P.finished) { P.finished = true; destroyMedia(); }
  P.ctx = ctx;
  P.session = ctx.session;
  P.loaded = false;
  P.buffering = true;
  P.ext = [];
  P.sid = null;
  P.subDelay = 0;
  P.sig = "";
  P.watch = { lastPos: null, unsaved: 0, lastSave: Date.now(), wasPaused: false };
  P.finished = false;
  document.body.classList.add("web-playing");
  const base = await serverBase();
  P.base = base && (await serverAlive(base)) ? base : null;
  if (!P.base && base) relay.at = 0;
  if (P.finished || P.session !== ctx.session) return;
  let media;
  if (stream.infoHash) {
    if (!P.base) { P.finished = true; destroyMedia(); throw "Phim torrent cần máy tính đang bật WiS TV Relay. Kiểm tra trong Cài đặt."; }
    media = await torrentMedia(P.base, stream);
  } else if (stream.url) {
    media = stream.url;
  } else {
    P.finished = true;
    destroyMedia();
    throw "Không hỗ trợ loại nguồn này";
  }
  if (P.finished || P.session !== ctx.session) return;
  P.fallback = P.base && !stream.infoHash && /^https?:/i.test(media) ? media : null;
  try {
    if (P.base) {
      P.hlsId = `wistv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
      const q = `mediaURL=${encodeURIComponent(media)}&videoCodecs=h264&audioCodecs=aac&audioCodecs=mp3&maxAudioChannels=2&maxWidth=1920`;
      await attach(`${P.base}/hlsv2/${P.hlsId}/master.m3u8?${q}`, true);
    } else {
      await attach(media, /\.m3u8(\?|$)/i.test(media));
    }
  } catch (e) {
    P.finished = true;
    destroyMedia();
    throw e;
  }
  paintStyle();
  P.timer = setInterval(tick, 250);
  P.raf = requestAnimationFrame(drawSubs);
  P.video.play().catch(() => {});
}

function command({ args }) {
  if (P.finished) throw "Trình phát chưa chạy";
  const v = P.video;
  const [c, a, b] = args;
  if (c === "cycle" && a === "pause") { if (v.paused) v.play().catch(() => {}); else v.pause(); return; }
  if (c === "cycle" && a === "mute") { v.muted = !v.muted; return; }
  if (c === "set" && a === "mute") { v.muted = b === "yes"; return; }
  if (c === "seek") {
    const n = Number(a);
    const dur = isFinite(v.duration) ? v.duration : Infinity;
    v.currentTime = Math.max(0, Math.min(dur - 0.5, b === "absolute" ? n : v.currentTime + n));
    return;
  }
  if (c === "add" && a === "sub-delay") { P.subDelay = Math.round((P.subDelay + Number(b)) * 10) / 10; return; }
  if (c === "sub-add") return addSubtitle(a, args[3] || "Phụ đề", args[4] || "");
  if (c === "quit") { finish({}); return; }
  throw `Lệnh không hỗ trợ: ${c}`;
}

function setProp({ name, value }) {
  if (setStyleProp(name, value)) return;
  if (P.finished) throw "Trình phát chưa chạy";
  const v = P.video;
  if (name === "volume") { v.volume = Math.max(0, Math.min(1, Number(value) / 100)); if (v.volume > 0) v.muted = false; return; }
  if (name === "speed") { v.playbackRate = Number(value) || 1; return; }
  if (name === "sid") { const n = Number(value); P.sid = n > 0 && n <= P.ext.length ? n : null; return; }
  if (name === "aid") { if (P.hls) P.hls.audioTrack = Math.max(0, Number(value) - 1); return; }
  if (name === "sub-back-color" || name === "sub-outline-color" || name === "sub-border-color") return;
  throw `Không hỗ trợ ${name}`;
}

const pageFs = () => document.fullscreenElement || document.webkitFullscreenElement || null;
let videoFs = false;

function pageFsRequest() {
  const el = document.documentElement;
  if (el.requestFullscreen) return () => el.requestFullscreen({ navigationUI: "hide" });
  if (el.webkitRequestFullscreen) return () => el.webkitRequestFullscreen();
  return null;
}

function fullscreenChanged() {
  if (!pageFs()) { try { screen.orientation.unlock(); } catch (e) {} }
  emit("player-fullscreen", { on: !!pageFs() || videoFs });
}
document.addEventListener("fullscreenchange", fullscreenChanged);
document.addEventListener("webkitfullscreenchange", fullscreenChanged);

function nativeSubs(show) {
  const v = P.video;
  if (!v || !v.addTextTrack || typeof VTTCue === "undefined") return;
  if (!P.track) P.track = v.addTextTrack("subtitles", "Phụ đề", "vi");
  const t = P.track;
  for (const c of [...(t.cues || [])]) t.removeCue(c);
  const list = show && P.sid ? P.ext[P.sid - 1]?.cues : null;
  if (list) for (const c of list) {
    const start = c.start + P.subDelay;
    const end = c.end + P.subDelay;
    if (end > 0) t.addCue(new VTTCue(Math.max(0, start), end, c.text));
  }
  t.mode = list && list.length ? "showing" : "disabled";
}

function watchVideoFs(v) {
  v.addEventListener("webkitbeginfullscreen", () => { videoFs = true; nativeSubs(true); fullscreenChanged(); });
  v.addEventListener("webkitendfullscreen", () => { videoFs = false; nativeSubs(false); fullscreenChanged(); });
}

async function fullscreen({ on }) {
  const cur = !!pageFs() || videoFs;
  const next = on == null ? !cur : !!on;
  if (next === cur) return cur;
  if (next) {
    const req = pageFsRequest();
    if (req) {
      try { await Promise.race([req(), new Promise((r) => setTimeout(r, 1500))]); } catch (e) {}
      if (pageFs()) { try { await screen.orientation.lock("landscape"); } catch (e) {} }
      return !!pageFs();
    }
    const v = P.video;
    if (!v || !v.webkitEnterFullscreen) throw "Trình duyệt này không hỗ trợ toàn màn hình";
    if (P.finished || v.readyState < 1) throw "Chờ phim tải xong rồi bấm toàn màn hình";
    nativeSubs(true);
    try { v.webkitEnterFullscreen(); } catch (e) { nativeSubs(false); throw "Không mở được toàn màn hình"; }
    return true;
  }
  if (videoFs) {
    try { P.video.webkitExitFullscreen(); } catch (e) {}
    return false;
  }
  try { screen.orientation.unlock(); } catch (e) {}
  try { await (document.exitFullscreen ? document.exitFullscreen() : document.webkitExitFullscreen()); } catch (e) {}
  return !!pageFs();
}

export const web = {
  async session() { return session()?.user || null; },
  async login({ email, password }) {
    const res = await api("login", { type: "Login", email: String(email || "").trim(), password, facebook: false });
    if (!res?.authKey) throw "Đăng nhập thất bại";
    const u = res.user || {};
    const user = { _id: u._id, email: u.email, fullname: u.fullname, avatar: u.avatar };
    store.set("wistv.session", { authKey: res.authKey, user });
    addonCache = null;
    relay = { base: null, at: 0 };
    return user;
  },
  async logout() {
    const key = authKey();
    store.set("wistv.session", null);
    addonCache = null;
    libraryCache = [];
    relay = { base: null, at: 0 };
    if (key) await api("logout", { type: "Logout", authKey: key }).catch(() => {});
  },
  async addons({ refresh } = {}) { return loadAddons(!!refresh); },
  async catalog({ url, kind, id, extra }) {
    const r = await getJson(resourceUrl({ transportUrl: url }, "catalog", kind, id, extra || []));
    return r.metas || [];
  },
  async meta({ kind, id }) {
    let lastErr = null;
    for (const a of (await loadAddons()).filter((x) => supports(x, "meta", kind, id))) {
      try { const r = await getJson(resourceUrl(a, "meta", kind, id)); if (r && r.meta) return r.meta; } catch (e) { lastErr = e; }
    }
    throw lastErr || "Không tìm thấy thông tin phim";
  },
  async streams({ kind, id }) {
    const list = (await loadAddons()).filter((a) => supports(a, "stream", kind, id));
    const results = await Promise.all(list.map((a) => getJson(resourceUrl(a, "stream", kind, id)).then((v) => [a, v], () => [a, null])));
    return results
      .filter(([, v]) => v && Array.isArray(v.streams) && v.streams.length)
      .map(([a, v]) => ({ addon: addonName(a), logo: a.manifest?.logo, streams: v.streams }));
  },
  async subtitles({ kind, id }) {
    const list = (await loadAddons()).filter((a) => supports(a, "subtitles", kind, id));
    const results = await Promise.all(list.map((a) => getJson(resourceUrl(a, "subtitles", kind, id)).then((v) => [a, v], () => [a, null])));
    const out = [];
    for (const [a, v] of results) for (const s of v?.subtitles || []) if (s.url) out.push({ ...s, addon: addonName(a) });
    return out;
  },
  async subtitle_info({ url }) {
    if (!/^https?:\/\//.test(url)) throw "Địa chỉ phụ đề không hợp lệ";
    const r = await fetch(url);
    if (!r.ok) throw `HTTP ${r.status}`;
    const text = await r.text();
    if (text.length > 4 << 20) throw "Tệp phụ đề quá lớn";
    return summarizeSub(text);
  },
  async library() {
    const key = authKey();
    if (!key) return [];
    const res = await api("datastoreGet", { authKey: key, collection: "libraryItem", ids: [], all: true });
    libraryCache = Array.isArray(res) ? res : [];
    return libraryCache;
  },
  async library_toggle({ meta }) {
    const key = needKey("Đăng nhập tài khoản Stremio để dùng Thư viện");
    if (!meta?.id) throw "Thiếu mã phim";
    const now = nowIso();
    const item = structuredClone(libraryCache.find((i) => i._id === meta.id) || newItem(meta.id, meta.name, meta.type, meta.poster, now));
    const inLib = !item.removed && !item.temp;
    item.removed = inLib;
    item.temp = false;
    item._mtime = now;
    await libraryPut(key, item);
    return !inLib;
  },
  async addon_install({ url }) {
    const key = needKey("Đăng nhập tài khoản Stremio để cài addon");
    let u = String(url || "").trim();
    if (u.startsWith("stremio://")) u = "https://" + u.slice(10);
    if (!/^https?:\/\//.test(u)) throw "Địa chỉ addon phải bắt đầu bằng https:// hoặc stremio://";
    let manifest;
    try { manifest = await getJson(u); } catch (e) { throw `Không đọc được manifest: ${e}`; }
    if (!manifest?.id) throw "Địa chỉ này không phải manifest của addon Stremio";
    const list = await rawCollection(key);
    if (list.some((a) => a.transportUrl === u)) throw `${manifest.name || manifest.id} đã được cài`;
    const entry = { transportUrl: u, transportName: "", manifest, flags: { official: false, protected: false } };
    const i = list.findIndex((a) => a.manifest?.id === manifest.id);
    if (i >= 0 && list[i].flags?.protected) throw "Không thay được addon gốc của Stremio";
    if (i >= 0) list[i] = entry; else list.push(entry);
    return setCollection(key, list);
  },
  async addon_remove({ url }) {
    const key = needKey("Đăng nhập tài khoản Stremio để gỡ addon");
    const list = await rawCollection(key);
    const i = list.findIndex((a) => a.transportUrl === url);
    if (i < 0) throw "Không tìm thấy addon này";
    if (list[i].flags?.protected) throw "Đây là addon gốc của Stremio, không gỡ được";
    list.splice(i, 1);
    return setCollection(key, list);
  },
  async addon_move({ url, delta }) {
    const key = needKey("Đăng nhập tài khoản Stremio để sắp xếp addon");
    const list = await rawCollection(key);
    const i = list.findIndex((a) => a.transportUrl === url);
    if (i < 0) throw "Không tìm thấy addon này";
    const t = Math.max(0, Math.min(list.length - 1, i + delta));
    if (t === i) return loadAddons(true);
    const [item] = list.splice(i, 1);
    list.splice(t, 0, item);
    return setCollection(key, list);
  },
  async addon_discover() {
    const lists = await Promise.all(COLLECTIONS.map((u) => getJson(u).catch(() => [])));
    const out = lists.flat().filter((a, i, all) => a && /^https?:/.test(a.transportUrl || "") && all.findIndex((b) => b.transportUrl === a.transportUrl) === i);
    if (!out.length) throw "Không tải được danh sách addon";
    return out;
  },
  async open_url({ url }) { window.open(url, "_blank", "noopener"); },
  async startup_open() {
    const u = new URLSearchParams(location.search).get("open");
    return u && /^https?:\/\//.test(u) ? u : null;
  },
  play,
  async player_command(args) { return command(args); },
  async player_set(args) { return setProp(args); },
  async player_stop() { if (!P.finished) finish({}); },
  player_fullscreen: fullscreen,
  async server_status({ force } = {}) {
    const base = await serverBase(!!force);
    return { linked: !!base, online: await serverAlive(base), manual: !!store.get("wistv.server") };
  },
};
