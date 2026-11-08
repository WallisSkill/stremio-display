import { web, onWebEvent } from "./web.js";

const TAURI = window.__TAURI__;
const TOUCH = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
const ANDROID = /Android/i.test(navigator.userAgent);
const listen = (name, fn) => (TAURI ? TAURI.event.listen(name, fn) : onWebEvent(name, fn));

const JUNK = new Set(["null", "undefined", ""]);
const junk = (v) => typeof v === "string" && JUNK.has(v.trim().toLowerCase());
function tidy(m) {
  if (!m || typeof m !== "object") return m;
  for (const [k, v] of Object.entries(m)) {
    if (junk(v)) delete m[k];
    else if (Array.isArray(v) && v.every((x) => x == null || typeof x === "string")) m[k] = v.filter((x) => x != null && !junk(x));
  }
  for (const v of Array.isArray(m.videos) ? m.videos : []) {
    for (const [k, x] of Object.entries(v || {})) if (junk(x)) delete v[k];
  }
  return m;
}

const call = (cmd, args = {}) => {
  const p = TAURI ? TAURI.core.invoke(cmd, args) : web[cmd](args);
  if (cmd === "catalog") return p.then((list) => list.map(tidy));
  if (cmd === "meta") return p.then(tidy);
  return p;
};

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style") el.style.cssText = v;
    else if (k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : v);
  }
  for (const kid of kids.flat()) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return el;
}

const ICON = {
  play: '<svg viewBox="0 0 24 24"><path d="M7 4.5v15a1 1 0 0 0 1.52.85l12-7.5a1 1 0 0 0 0-1.7l-12-7.5A1 1 0 0 0 7 4.5Z" fill="currentColor"/></svg>',
  plus: '<svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  check: '<svg viewBox="0 0 24 24"><path d="m5 12.5 4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  info: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v6M12 7.5v.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  left: '<svg viewBox="0 0 24 24"><path d="m15 5-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  right: '<svg viewBox="0 0 24 24"><path d="m9 5 7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" width="24" height="24"><circle cx="10.5" cy="10.5" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M15.5 15.5 21 21" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><rect x="6" y="4.5" width="4.2" height="15" rx="1.3" fill="currentColor"/><rect x="13.8" y="4.5" width="4.2" height="15" rx="1.3" fill="currentColor"/></svg>',
  back10: '<svg viewBox="0 0 24 24"><path d="M4.5 12a7.5 7.5 0 1 0 2.2-5.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M4 3.5v4.2h4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.6" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor" font-family="Segoe UI, sans-serif">10</text></svg>',
  fwd10: '<svg viewBox="0 0 24 24"><path d="M19.5 12a7.5 7.5 0 1 1-2.2-5.3" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M20 3.5v4.2h-4.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><text x="12" y="15.6" text-anchor="middle" font-size="7.6" font-weight="700" fill="currentColor" font-family="Segoe UI, sans-serif">10</text></svg>',
  next: '<svg viewBox="0 0 24 24"><path d="M5 5.2v13.6a.9.9 0 0 0 1.4.75l9.6-6.8a.9.9 0 0 0 0-1.5L6.4 4.45A.9.9 0 0 0 5 5.2Z" fill="currentColor"/><rect x="16.6" y="4.5" width="2.6" height="15" rx="1.1" fill="currentColor"/></svg>',
  vol: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.6l4.9 4V5.5L7.6 9.5H4Z" fill="currentColor"/><path d="M15.5 9a4.2 4.2 0 0 1 0 6M18 6.5a7.8 7.8 0 0 1 0 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  mute: '<svg viewBox="0 0 24 24"><path d="M4 9.5v5h3.6l4.9 4V5.5L7.6 9.5H4Z" fill="currentColor"/><path d="m15.5 9.5 5 5m0-5-5 5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  cc: '<svg viewBox="0 0 24 24"><rect x="3" y="5" width="18" height="14" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M10.4 10.2a2.3 2.3 0 1 0 0 3.6M17 10.2a2.3 2.3 0 1 0 0 3.6" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
  speed: '<svg viewBox="0 0 24 24"><path d="M4.6 17.5a8.5 8.5 0 1 1 14.8 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="m12 13.5 4-5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="13.5" r="1.6" fill="currentColor"/></svg>',
  lock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 7 0v2.7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  unlock: '<svg viewBox="0 0 24 24"><rect x="5" y="10.5" width="14" height="10" rx="2.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8.5 10.5V7.8a3.5 3.5 0 0 1 6.8-1.2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  fill: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M7 10.5V9h2M17 13.5V15h-2M17 10.5V9h-2M7 13.5V15h2" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  fit: '<svg viewBox="0 0 24 24"><rect x="3" y="6" width="18" height="12" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="7.5" y="9.5" width="9" height="5" rx="1" fill="currentColor"/></svg>',
  full: '<svg viewBox="0 0 24 24"><path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  unfull: '<svg viewBox="0 0 24 24"><path d="M9 4v3.5A1.5 1.5 0 0 1 7.5 9H4M20 9h-3.5A1.5 1.5 0 0 1 15 7.5V4M15 20v-3.5a1.5 1.5 0 0 1 1.5-1.5H20M4 15h3.5A1.5 1.5 0 0 1 9 16.5V20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  up: '<svg viewBox="0 0 24 24"><path d="m6 15 6-6 6 6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  down: '<svg viewBox="0 0 24 24"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  list: '<svg viewBox="0 0 24 24"><rect x="3.5" y="5" width="12" height="8.5" rx="1.8" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18.5 7v9.5a2 2 0 0 1-2 2H6.5M3.5 17h0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  close: '<svg viewBox="0 0 24 24"><path d="m6.5 6.5 11 11m0-11-11 11" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/></svg>',
  cog: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3.2" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3 5.5 5.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
};

const TYPE_LABEL = { movie: "Phim", series: "Phim bộ", channel: "Kênh", tv: "Truyền hình", anime: "Anime" };

const app = {
  user: null,
  guest: false,
  addons: [],
  library: [],
  stack: [],
  heroTimer: null,
  previewTimer: null,
};

const isImdb = (id) => typeof id === "string" && /^tt\d+$/.test(id);
const bgOf = (m) => m.background || (isImdb(m.id) ? `https://images.metahub.space/background/medium/${m.id}/img` : m.poster);
const PORTRAIT = window.matchMedia("(orientation: portrait) and (max-width: 760px)");
const posterArt = (m) => (isImdb(m.id) ? `https://images.metahub.space/poster/large/${m.id}/img` : m.poster || bgOf(m));
const artOf = (m) => (PORTRAIT.matches ? posterArt(m) : bgOf(m));
const thumbOf = (m) => String(bgOf(m) || "").replace(/(images\.metahub\.space\/background\/)(medium|large)\//, "$1small/");
const logoOf = (m) => m.logo || (isImdb(m.id) ? `https://images.metahub.space/logo/medium/${m.id}/img` : null);
const yearOf = (m) => m.releaseInfo || (m.released ? String(m.released).slice(0, 4) : m.year || "");

function fmtTime(ms) {
  const s = Math.floor(ms / 1000);
  const hh = Math.floor(s / 3600), mm = Math.floor((s % 3600) / 60), ss = s % 60;
  return hh ? `${hh}:${String(mm).padStart(2, "0")}:${String(ss).padStart(2, "0")}` : `${mm}:${String(ss).padStart(2, "0")}`;
}

let toastTimer;
function toast(msg, bad = false) {
  const t = $("#toast");
  t.textContent = String(msg);
  t.classList.toggle("bad", bad);
  t.hidden = false;
  t.style.animation = "none";
  void t.offsetWidth;
  t.style.animation = "";
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), bad ? 6000 : 3200);
}

const bd = { front: "a", url: null, item: null };
function showArt(m) {
  bd.item = m;
  setBackdrop(artOf(m));
}
PORTRAIT.addEventListener?.("change", () => { if (bd.item) setBackdrop(artOf(bd.item)); });
function setBackdrop(url) {
  if (!url || url === bd.url) return;
  bd.url = url;
  const img = new Image();
  img.onload = () => {
    if (bd.url !== url) return;
    const next = bd.front === "a" ? "b" : "a";
    const nextEl = $(`#bd-${next}`), curEl = $(`#bd-${bd.front}`);
    nextEl.style.backgroundImage = `url("${url}")`;
    nextEl.classList.add("on");
    curEl.classList.remove("on");
    bd.front = next;
  };
  img.src = url;
}

function image(src, alt, onFail) {
  const img = h("img", { alt: alt || "", loading: "lazy", decoding: "async", draggable: "false" });
  img.onload = () => img.classList.add("ok");
  img.onerror = () => { img.remove(); onFail && onFail(); };
  if (src) img.src = src; else queueMicrotask(() => img.onerror());
  return img;
}

function titleBlock(m, cls = "title-text") {
  const wrap = h("div");
  const fallback = () => wrap.replaceChildren(h("h1", { class: cls }, m.name));
  const src = logoOf(m);
  if (src) {
    const img = h("img", { class: "logo-img", alt: m.name, draggable: "false" });
    img.onerror = fallback;
    img.src = src;
    wrap.append(img);
  } else fallback();
  return wrap;
}

function metaLine(m) {
  const parts = [];
  if (m.imdbRating) parts.push(h("span", { class: "imdb" }, `IMDb ${m.imdbRating}`));
  const y = yearOf(m);
  if (y) parts.push(h("span", {}, y));
  if (m.runtime) parts.push(h("span", {}, m.runtime));
  if (m.type) parts.push(h("span", {}, TYPE_LABEL[m.type] || m.type));
  const genres = (m.genres || m.genre || []).slice(0, 3);
  if (genres.length) parts.push(h("span", {}, genres.join(" · ")));
  const out = h("div", { class: "meta-line" });
  parts.forEach((p, i) => { if (i) out.append(h("i", { class: "dot" })); out.append(p); });
  return out;
}

function catalogsOf(filterType, { search = false } = {}) {
  const out = [];
  for (const addon of app.addons) {
    for (const cat of addon.manifest.catalogs || []) {
      const extras = cat.extra || [];
      const hasSearch = extras.some((e) => e.name === "search") || (cat.extraSupported || []).includes("search");
      const required = extras.some((e) => e.isRequired) || (cat.extraRequired || []).length > 0;
      if (filterType && cat.type !== filterType) continue;
      if (search) { if (hasSearch) out.push({ addon, cat }); continue; }
      if (required) continue;
      out.push({ addon, cat });
    }
  }
  return out;
}

const libItems = () => app.library.filter((i) => !i.removed && !i.temp);
const continueItems = () =>
  app.library
    .filter((i) => (!i.removed || i.temp) && i.state && i.state.timeOffset > 0)
    .sort((a, b) => String(b.state.lastWatched || "").localeCompare(String(a.state.lastWatched || "")));
const libEntry = (id) => app.library.find((i) => i._id === id);
const inLibrary = (id) => { const e = libEntry(id); return !!e && !e.removed && !e.temp; };

const CACHE = "wistv.cache.";
const cacheGet = (k) => { try { return JSON.parse(localStorage.getItem(CACHE + k)); } catch (e) { return null; } };
function cacheSet(k, v) {
  const value = JSON.stringify({ at: Date.now(), v });
  try { localStorage.setItem(CACHE + k, value); return; } catch (e) {}
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(CACHE + "cat:")) localStorage.removeItem(key);
    localStorage.setItem(CACHE + k, value);
  } catch (e) {}
}
function cacheClear() {
  try { for (const key of Object.keys(localStorage)) if (key.startsWith(CACHE)) localStorage.removeItem(key); } catch (e) {}
}

const bootKey = () => `boot:${app.user?._id || app.user?.email || "guest"}`;
const saveBoot = () => cacheSet(bootKey(), { addons: app.addons, library: app.library });

async function refreshLibrary() {
  try { app.library = await call("library"); saveBoot(); } catch (e) { app.library = []; }
}

const LIGHT = ["id", "type", "name", "poster", "posterShape", "background", "logo", "description", "releaseInfo", "year", "imdbRating", "genres", "genre", "runtime", "released"];
const light = (m) => Object.fromEntries(LIGHT.filter((k) => m[k] != null).map((k) => [k, m[k]]));
const CATALOG_FRESH_MS = 30 * 60 * 1000;

function cachedCatalog(addon, cat) {
  const key = `cat:${addon.transportUrl}|${cat.type}|${cat.id}`;
  const fresh = () => call("catalog", { url: addon.transportUrl, kind: cat.type, id: cat.id, extra: [] })
    .then((list) => { const items = list.slice(0, 100).map(light); cacheSet(key, items); return items; });
  const hit = cacheGet(key);
  if (hit && Array.isArray(hit.v) && hit.v.length) {
    if (Date.now() - hit.at > CATALOG_FRESH_MS) fresh().catch(() => {});
    return Promise.resolve(hit.v);
  }
  return fresh();
}

function card(m, shape = "poster", opts = {}) {
  const art = h("div", { class: "art" });
  const fallback = h("div", { class: "fallback" }, m.name);
  const src = shape === "wide" ? thumbOf(m) : m.poster;
  art.append(image(src, m.name, () => art.append(fallback)));
  if (shape === "wide") {
    const label = h("div", { class: "label" }, opts.label || m.name);
    if (opts.progress != null) {
      label.classList.add("has-progress");
      art.append(label, h("div", { class: "progress" }, h("i", { style: `width:${Math.max(3, Math.min(100, opts.progress * 100))}%` })));
    } else art.append(label);
  }
  const cap = shape === "wide" ? null : h("div", { class: "cap" }, m.name, yearOf(m) ? h("small", {}, yearOf(m)) : null);
  const el = h("button", { class: `card ${shape} focusable`, title: m.name }, art, cap);
  el.addEventListener("click", opts.onClick || (() => go("detail", { kind: m.type, id: m.id, video: opts.video })));
  if (opts.onFocus) {
    el.addEventListener("focus", () => opts.onFocus(m));
    el.addEventListener("mouseenter", () => opts.onFocus(m));
  }
  return el;
}

function skeletonRow(shape, n = 8) {
  return Array.from({ length: n }, () => h("div", { class: `card ${shape} skeleton` }, h("div", { class: "art" })));
}

function shelf(title, sub, shape, load, opts = {}) {
  const row = h("div", { class: "row" }, skeletonRow(shape));
  const wrap = h("div", { class: "shelf-wrap" },
    h("button", { class: "row-arrow l", tabindex: "-1", html: ICON.left, onclick: () => row.scrollBy({ left: -row.clientWidth * 0.8 }) }),
    row,
    h("button", { class: "row-arrow r", tabindex: "-1", html: ICON.right, onclick: () => row.scrollBy({ left: row.clientWidth * 0.8 }) }));
  const sec = h("section", { class: "shelf" },
    h("div", { class: "shelf-head" }, h("h2", { class: "shelf-title" }, title), sub ? h("span", { class: "shelf-sub" }, sub) : null),
    wrap);
  let started = false;
  const start = async () => {
    if (started) return;
    started = true;
    try {
      const items = await load();
      if (!items.length) { sec.remove(); return; }
      row.replaceChildren(...items.map((m) => (opts.render ? opts.render(m) : card(m, shape, opts))));
      opts.onLoaded && opts.onLoaded(items);
    } catch (e) {
      sec.remove();
    }
  };
  if (opts.eager) start();
  else {
    const io = new IntersectionObserver((ents) => { if (ents.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { rootMargin: "400px" });
    io.observe(sec);
  }
  return sec;
}

function setHero(m, info, dots, idx) {
  showArt(m);
  info.dataset.cur = m.id;
  if (!m.description && !m._rich && m.id && m.type) {
    m._rich = true;
    call("meta", { kind: m.type, id: m.id })
      .then((full) => {
        Object.assign(m, full, { _rich: true });
        if (info.isConnected && info.dataset.cur === m.id) setHero(m, info, dots, idx);
      })
      .catch(() => {});
  }
  info.classList.add("fade");
  setTimeout(() => {
    const focusedIdx = $$(".btn", info).indexOf(document.activeElement);
    info.replaceChildren(
      h("div", { class: "kicker" }, TYPE_LABEL[m.type] || "Nổi bật"),
      titleBlock(m),
      metaLine(m),
      m.description ? h("p", { class: "desc" }, m.description) : null,
      h("div", { class: "actions" },
        h("button", { class: "btn primary focusable", html: `${ICON.play}<span>Xem ngay</span>`, onclick: () => go("detail", { kind: m.type, id: m.id, autoplay: true }) }),
        h("button", { class: "btn focusable", html: `${ICON.info}<span>Chi tiết</span>`, onclick: () => go("detail", { kind: m.type, id: m.id }) })));
    if (focusedIdx >= 0) $$(".btn", info)[focusedIdx]?.focus({ preventScroll: true });
    info.classList.remove("fade");
  }, 260);
  if (dots && idx != null) $$("i", dots).forEach((d, i) => d.classList.toggle("on", i === idx));
}

function renderBrowse(view, filterType) {
  document.body.classList.remove("dim");
  const info = h("div", { class: "hero-info" });
  const dots = h("div", { class: "hero-dots" });
  const hero = h("section", { class: "hero" }, info, dots);
  const shelves = h("div", { class: "shelves" });
  view.append(h("div", { class: "page" }, hero, shelves));

  let featured = [];
  let fi = 0;
  const rotate = () => {
    clearInterval(app.heroTimer);
    app.heroTimer = setInterval(() => {
      if (!featured.length || !document.hasFocus() || pl.open) return;
      fi = (fi + 1) % featured.length;
      setHero(featured[fi], info, dots, fi);
    }, 9000);
  };
  const preview = (m) => {
    clearTimeout(app.previewTimer);
    app.previewTimer = setTimeout(() => {
      clearInterval(app.heroTimer);
      setHero(m, info, null, null);
      $$("i", dots).forEach((d) => d.classList.remove("on"));
    }, 420);
  };

  if (!filterType) {
    const cont = continueItems();
    if (cont.length) {
      shelves.append(shelf("Xem tiếp", null, "wide", async () => cont.slice(0, 20), {
        eager: true,
        render: (li) => {
          const st = li.state || {};
          const m = { id: li._id, type: li.type, name: li.name, poster: li.poster };
          const ep = li.type === "series" ? epLabelFromId(st.video_id) : "";
          return card(m, "wide", {
            label: ep ? `${li.name} · ${ep}` : li.name,
            progress: st.duration ? st.timeOffset / st.duration : 0,
            onClick: () => go("detail", { kind: li.type, id: li._id, video: st.video_id, autoplay: true }),
            onFocus: preview,
          });
        },
      }));
    }
  }

  const cats = catalogsOf(filterType).slice(0, 16);
  if (!cats.length) {
    info.append(h("h1", { class: "title-text" }, "Chưa có danh mục"), h("p", { class: "desc" }, "Mở mục Addon để cài thêm addon có danh mục phim."));
  }
  cats.forEach(({ addon, cat }, i) => {
    const shape = i === 0 ? "wide" : "poster";
    const title = cat.name || cat.id;
    const sub = `${TYPE_LABEL[cat.type] || cat.type} · ${addon.manifest.name}`;
    shelves.append(shelf(title, sub, shape, () => cachedCatalog(addon, cat), {
      eager: i < 2,
      onFocus: preview,
      onLoaded: i === 0 ? (items) => {
        featured = items.filter((m) => m.description || m.background).slice(0, 7);
        if (!featured.length) featured = items.slice(0, 7);
        dots.replaceChildren(...featured.map(() => h("i")));
        fi = 0;
        setHero(featured[0], info, dots, 0);
        rotate();
        queueMicrotask(() => { if (!document.activeElement || document.activeElement === document.body) $(".hero .btn.primary")?.focus({ preventScroll: true }); });
      } : null,
    }));
  });
}

function epLabelFromId(vid) {
  const m = /:(\d+):(\d+)$/.exec(vid || "");
  return m ? `M${m[1]} · T${m[2]}` : "";
}

async function renderDetail(view, { kind, id, video, autoplay }) {
  document.body.classList.remove("dim");
  const page = h("div", { class: "page detail" }, h("div", { class: "spinner", style: "margin-top:40vh" }));
  view.append(page);
  let m;
  try { m = await call("meta", { kind, id }); }
  catch (e) { page.replaceChildren(h("div", { class: "empty", style: "padding-top:40vh" }, String(e))); return; }
  if (!view.contains(page)) return;
  showArt(m);

  const libBtn = h("button", { class: "btn focusable" });
  const syncLib = () => { libBtn.innerHTML = inLibrary(m.id) ? `${ICON.check}<span>Trong thư viện</span>` : `${ICON.plus}<span>Thư viện</span>`; };
  syncLib();
  libBtn.addEventListener("click", async () => {
    try {
      const now = await call("library_toggle", { meta: { id: m.id, name: m.name, type: m.type, poster: m.poster } });
      await refreshLibrary();
      syncLib();
      toast(now ? "Đã thêm vào Thư viện" : "Đã xóa khỏi Thư viện");
    } catch (e) { toast(e, true); }
  });

  const videos = (m.videos || []).filter((v) => v.id);
  const isSeries = m.type === "series" || videos.length > 1;
  const entry = libEntry(m.id);
  const lastVid = video || entry?.state?.video_id;

  const playTarget = () => {
    if (!isSeries) return { vid: m.id, label: m.name };
    const v = videos.find((x) => x.id === lastVid) || videos.filter((x) => x.season > 0).sort(epSort)[0] || videos[0];
    return v ? { vid: v.id, label: epName(v), video: v } : { vid: m.id, label: m.name };
  };
  const target = playTarget();
  const resumeMs = entry?.state?.video_id === target.vid ? entry.state.timeOffset : 0;
  const playLabel = resumeMs > 0 ? `Tiếp tục ${isSeries && target.video ? epShort(target.video) : ""}`.trim() : isSeries && target.video ? `Xem ${epShort(target.video)}` : "Xem";
  const playBtn = h("button", { class: "btn primary focusable", html: `${ICON.play}<span>${playLabel}</span>`, onclick: () => openStreams(m, target.vid, target.label) });

  const cast = (m.cast || []).slice(0, 5).join(", ");
  const dir = (m.director || []).join(", ");
  const top = h("section", { class: "detail-top" },
    titleBlock(m),
    metaLine(m),
    m.description ? h("p", { class: "desc" }, m.description) : null,
    cast || dir ? h("div", { class: "credits" }, cast ? h("div", {}, h("b", {}, "Diễn viên "), cast) : null, dir ? h("div", {}, h("b", {}, "Đạo diễn "), dir) : null) : null,
    h("div", { class: "actions" }, playBtn, libBtn));
  page.replaceChildren(top);

  if (isSeries && videos.length) {
    const seasons = [...new Set(videos.map((v) => v.season ?? 0))].sort((a, b) => (a === 0) - (b === 0) || a - b);
    let cur = (videos.find((v) => v.id === target.vid) || {}).season ?? seasons[0];
    const pills = h("div", { class: "seasons" });
    const row = h("div", { class: "row" });
    const drawSeason = () => {
      pills.replaceChildren(...seasons.map((s) => h("button", { class: `pill focusable ${s === cur ? "on" : ""}`, onclick: () => { cur = s; drawSeason(); } }, s === 0 ? "Đặc biệt" : `Mùa ${s}`)));
      const eps = videos.filter((v) => (v.season ?? 0) === cur).sort(epSort);
      row.replaceChildren(...eps.map((v) => episodeCard(m, v, entry)));
      row.scrollLeft = 0;
      const curEl = $$(".card", row).find((c) => c.dataset.vid === target.vid);
      if (curEl) setTimeout(() => curEl.scrollIntoView({ inline: "center", block: "nearest" }), 50);
    };
    drawSeason();
    page.append(h("section", { class: "shelf", style: "padding-bottom:80px" },
      h("div", { class: "shelf-head", style: "padding:0" }, h("h2", { class: "shelf-title" }, "Các tập")),
      pills, row));
  } else {
    page.lastChild.style.paddingBottom = "80px";
  }

  playBtn.focus({ preventScroll: true });
  if (autoplay) {
    const top = app.stack[app.stack.length - 1];
    if (top && top.params) top.params.autoplay = false;
    openStreams(m, target.vid, target.label);
  }
}

const epSort = (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0);
const epShort = (v) => `M${v.season ?? 0}:T${v.episode ?? v.number ?? "?"}`;
const epName = (v) => `${epShort(v)} · ${v.title || v.name || "Tập " + (v.episode ?? "")}`;

function episodeCard(m, v, entry) {
  const thumb = v.thumbnail || thumbOf(m);
  const art = h("div", { class: "art" }, image(thumb, v.title));
  if (entry?.state?.video_id === v.id && entry.state.timeOffset > 0 && entry.state.duration) {
    art.append(h("div", { class: "progress" }, h("i", { style: `width:${Math.min(100, (entry.state.timeOffset / entry.state.duration) * 100)}%` })));
  }
  const released = v.released ? new Date(v.released) : null;
  const future = released && released > new Date();
  const el = h("button", { class: "card ep focusable", "data-vid": v.id },
    art,
    h("div", { class: "ep-num" }, `Tập ${v.episode ?? v.number ?? "?"}${future ? " · " + released.toLocaleDateString("vi-VN") : ""}`),
    h("div", { class: "ep-title" }, v.title || v.name || ""),
    v.overview || v.description ? h("div", { class: "ep-over" }, v.overview || v.description) : null);
  el.addEventListener("click", () => openStreams(m, v.id, epName(v)));
  return el;
}

function quality(s) {
  const text = `${s.name || ""} ${s.title || ""} ${s.description || ""}`;
  const tags = [];
  if (/2160p|\b4k\b|uhd/i.test(text)) tags.push(["4K", true]);
  else if (/1080p/i.test(text)) tags.push(["1080p", false]);
  else if (/720p/i.test(text)) tags.push(["720p", false]);
  else if (/480p/i.test(text)) tags.push(["480p", false]);
  if (/dolby ?vision|\bdv\b/i.test(text)) tags.push(["DV", false]);
  else if (/hdr/i.test(text)) tags.push(["HDR", false]);
  if (/atmos/i.test(text)) tags.push(["Atmos", false]);
  const size = /(?:💾\s*)?(\d+(?:[.,]\d+)?\s?(?:GB|MB))/i.exec(text);
  const seeds = /👤\s*(\d+)/.exec(text);
  return { tags, size: size ? size[1] : "", seeds: seeds ? seeds[1] : "" };
}

function closeSheet() {
  $("#sheet").hidden = true;
  $("#scrim").hidden = true;
  $("#sheet").replaceChildren();
  app.sheetReturn?.focus?.({ preventScroll: true });
  navSync();
}

async function openStreams(m, vid, label) {
  app.sheetReturn = document.activeElement;
  const sheet = $("#sheet");
  const body = h("div", { class: "sheet-body" }, h("div", { class: "spinner" }));
  const entry = libEntry(m.id);
  const resumeMs = entry?.state?.video_id === vid ? entry.state.timeOffset || 0 : 0;
  let resume = resumeMs > 0;
  const tools = h("div", { class: "sheet-tools" });
  const drawTools = () => {
    tools.replaceChildren();
    if (resumeMs > 0) {
      tools.append(
        h("button", { class: `pill focusable ${resume ? "on" : ""}`, onclick: () => { resume = true; drawTools(); } }, `Tiếp tục từ ${fmtTime(resumeMs)}`),
        h("button", { class: `pill focusable ${!resume ? "on" : ""}`, onclick: () => { resume = false; drawTools(); } }, "Xem từ đầu"));
    }
  };
  drawTools();
  sheet.replaceChildren(h("div", { class: "sheet-head" }, h("h2", {}, "Chọn nguồn phát"), h("p", {}, label || m.name), tools), body);
  sheet.hidden = false;
  $("#scrim").hidden = false;
  navSync();

  let groups;
  try { groups = await call("streams", { kind: m.type, id: vid }); }
  catch (e) { body.replaceChildren(h("div", { class: "empty" }, String(e))); return; }
  if (sheet.hidden) return;
  if (!groups.length) {
    body.replaceChildren(h("div", { class: "empty" }, "Không addon nào trả về nguồn cho mục này.\nHãy cài addon nguồn phát trong mục Addon."));
    return;
  }
  body.replaceChildren();
  for (const g of groups) {
    body.append(h("div", { class: "group-title" }, g.logo ? h("img", { src: g.logo, alt: "" }) : null, g.addon));
    for (const s of g.streams) {
      const q = quality(s);
      const firstLine = (s.name || g.addon).replace(/\n/g, " ");
      const sub = s.title || s.description || "";
      const metaBits = [q.size, q.seeds ? `${q.seeds} seed` : ""].filter(Boolean).join(" · ");
      const btn = h("button", { class: "stream focusable" },
        h("div", { class: "s-name" }, q.tags.map(([t, solid]) => h("span", { class: `badge ${solid ? "solid" : ""}` }, t)), firstLine),
        h("div", { class: "s-meta" }, metaBits || (s.infoHash ? "Torrent" : s.externalUrl ? "Mở ngoài" : "")),
        sub ? h("div", { class: "s-sub" }, sub) : null);
      btn.addEventListener("click", () => startPlayback(m, vid, label, s, resume ? resumeMs : 0, g.addon));
      body.append(btn);
    }
  }
  $(".stream", body)?.focus({ preventScroll: true });
}

const pl = { session: 0, open: false, s: {}, tracks: [], subs: null, added: new Set(), menu: null, fs: false, drag: null, seekUntil: 0, seekTarget: 0, hideTimer: null, ctx: null, ui: null, returnFocus: null };

const LANG = { vi: "Tiếng Việt", vie: "Tiếng Việt", vn: "Tiếng Việt", en: "English", eng: "English", ja: "日本語", jpn: "日本語", ko: "한국어", kor: "한국어", zh: "中文", chi: "中文", zho: "中文", fr: "Français", fre: "Français", fra: "Français", es: "Español", spa: "Español", de: "Deutsch", ger: "Deutsch", deu: "Deutsch", it: "Italiano", ita: "Italiano", pt: "Português", por: "Português", pob: "Português (BR)", ru: "Русский", rus: "Русский", th: "ไทย", tha: "ไทย", id: "Bahasa Indonesia", ind: "Bahasa Indonesia", ar: "العربية", ara: "العربية" };
const langName = (code) => (code ? LANG[String(code).toLowerCase()] || String(code).toUpperCase() : "");
const LANG_RANK = ["vi", "vie", "vn", "en", "eng"];
const langRank = (code) => { const i = LANG_RANK.indexOf(String(code || "").toLowerCase()); return i < 0 ? 99 : i; };
const secs = (s) => fmtTime(Math.max(0, s || 0) * 1000);

function iconBtn(icon, title, onclick, cls = "") {
  return h("button", { class: `pl-btn ${cls}`, tabindex: "-1", title, "aria-label": title, html: ICON[icon], onclick: (e) => { e.stopPropagation(); onclick(e); } });
}

function buildPlayer() {
  const ui = {};
  ui.bg = h("div", { class: "pl-loading-bg" });
  ui.hit = h("div", { class: "pl-hit" });
  ui.title = h("b", { class: "pl-title" });
  ui.sub = h("span", { class: "pl-sub" });
  ui.spin = h("div", { class: "pl-spin" }, h("div", { class: "spinner" }), ui.bufText = h("span"));
  ui.flash = h("div", { class: "pl-flash" });
  ui.buf = h("div", { class: "pl-buf" });
  ui.fill = h("div", { class: "pl-fill" });
  ui.knob = h("div", { class: "pl-knob" });
  ui.hover = h("div", { class: "pl-hover" });
  ui.tip = h("div", { class: "pl-tip" });
  ui.seek = h("div", { class: "pl-seek" }, h("div", { class: "pl-track" }, ui.buf, ui.hover, ui.fill), ui.knob, ui.tip);
  ui.play = iconBtn("pause", "Dừng (Space)", togglePause, "big");
  ui.next = iconBtn("next", "Tập tiếp (N)", () => playNext(false));
  ui.time = h("span", { class: "pl-time" });
  ui.volBtn = iconBtn("vol", "Tắt tiếng (M)", () => call("player_command", { args: ["cycle", "mute"] }).catch(() => {}));
  ui.vol = h("input", { type: "range", min: "0", max: "150", step: "1", value: "100", tabindex: "-1", class: "pl-vol" });
  ui.vol.addEventListener("input", () => setVolume(Number(ui.vol.value)));
  ui.vol.addEventListener("pointerdown", (e) => e.stopPropagation());
  ui.cc = iconBtn("cc", "Âm thanh và phụ đề (C)", () => toggleMenu("tracks"));
  ui.eps = iconBtn("list", "Các tập (E)", () => toggleMenu("episodes"));
  ui.nextUp = h("button", { class: "pl-nextup", tabindex: "-1", hidden: true, onclick: (e) => { e.stopPropagation(); playNext(false); } });
  ui.speedVal = h("span", {}, "1×");
  ui.speed = h("button", { class: "pl-btn pl-speed", tabindex: "-1", title: "Tốc độ", onclick: (e) => { e.stopPropagation(); toggleMenu("speed"); } }, ...(TOUCH ? [h("span", { html: ICON.speed }), h("span", { class: "pl-label" }, "Tốc độ (", ui.speedVal, ")")] : [ui.speedVal]));
  ui.fs = iconBtn("full", "Toàn màn hình (F)", toggleFullscreen);
  ui.menu = h("div", { class: "pl-menu", hidden: true });
  ui.menu.addEventListener("pointerdown", (e) => e.stopPropagation());
  ui.menu.addEventListener("click", (e) => e.stopPropagation());
  ui.stretch = iconBtn(fillMode ? "fit" : "fill", fillMode ? "Giữ đúng tỉ lệ (Z)" : "Dãn kín màn hình (Z)", () => setFill(!fillMode, true));
  ui.clock = h("span", { class: "pl-clock" });
  ui.batt = h("span", { class: "pl-batt", hidden: true });
  const top = h("div", { class: "pl-top" }, iconBtn("left", "Quay lại (Esc)", () => closePlayer()), h("div", { class: "pl-titles" }, ui.title, ui.sub), h("div", { class: "pl-status" }, ui.clock, ui.batt));
  const back10 = iconBtn("back10", "Lùi 10 giây (←)", () => seekBy(-10));
  const fwd10 = iconBtn("fwd10", "Tới 10 giây (→)", () => seekBy(10));
  const seekRow = h("div", { class: "pl-seekrow" }, ui.seek, ui.time);
  let center = null;
  let bottom;
  if (TOUCH) {
    for (const [btn, text] of [[ui.eps, "Các tập"], [ui.cc, "Phụ đề"], [ui.next, "Tập tiếp"]]) {
      btn.classList.add("act");
      btn.append(h("span", { class: "pl-label" }, text));
    }
    ui.speed.classList.add("act");
    ui.fillIcon = h("span", { html: ICON[fillMode ? "fit" : "fill"] });
    ui.fillLabel = h("span", { class: "pl-label" }, fillMode ? "Vừa hình" : "Dãn hình");
    ui.stretch.classList.add("act");
    ui.stretch.replaceChildren(ui.fillIcon, ui.fillLabel);
    ui.lock = iconBtn("lock", "Khoá màn hình", () => setLock(true));
    ui.lock.classList.add("act");
    ui.lock.append(h("span", { class: "pl-label" }, "Khoá"));
    ui.unlock = h("button", { class: "pl-unlock", tabindex: "-1", onclick: (e) => { e.stopPropagation(); setLock(false); } }, h("span", { html: ICON.unlock }), h("span", {}, "Mở khoá"));
    ui.play.classList.add("huge");
    back10.classList.add("big");
    fwd10.classList.add("big");
    center = h("div", { class: "pl-center" }, back10, ui.play, fwd10);
    bottom = h("div", { class: "pl-bottom" }, seekRow, h("div", { class: "pl-actions" }, ui.lock, ui.stretch, ui.speed, ui.eps, ui.cc, ui.next));
  } else {
    bottom = h("div", { class: "pl-bottom" },
      seekRow,
      h("div", { class: "pl-row" },
        h("div", { class: "pl-group" }, ui.play, back10, fwd10, ui.next, h("div", { class: "pl-volwrap" }, ui.volBtn, ui.vol)),
        h("div", { class: "pl-group" }, ui.stretch, ui.eps, ui.cc, ui.speed, ui.fs)));
  }
  for (const el of [bottom, center].filter(Boolean)) {
    el.addEventListener("click", (e) => e.stopPropagation());
    el.addEventListener("dblclick", (e) => e.stopPropagation());
  }
  ui.root = h("div", { id: "player", class: TOUCH ? "touch" : "", hidden: true }, ui.bg, ui.hit, h("div", { class: "pl-shade" }), ui.spin, ui.flash, top, ...(center ? [center] : []), bottom, ui.nextUp, ui.menu, ...(ui.unlock ? [ui.unlock] : []));
  let lastTap = 0;
  let tapTimer = null;
  let swipe = null;
  let swipedAt = 0;
  const swipeTip = () => {
    const d = pl.s.duration || 0;
    const delta = (pl.drag - swipe.from) * d;
    ui.tip.textContent = `${secs(pl.drag * d)} · ${delta < 0 ? "−" : "+"}${secs(Math.abs(delta))}`;
    ui.tip.style.left = `${Math.min(92, Math.max(8, pl.drag * 100))}%`;
  };
  let pinch = null;
  const span = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  ui.hit.addEventListener("touchstart", (e) => { if (e.touches.length === 2 && !pl.locked) { pinch = { from: span(e.touches), ratio: 1 }; swipe = null; } }, { passive: true });
  ui.hit.addEventListener("touchmove", (e) => { if (pinch && e.touches.length === 2) { pinch.ratio = span(e.touches) / pinch.from; e.preventDefault(); } }, { passive: false });
  ui.hit.addEventListener("touchend", (e) => {
    if (!pinch || e.touches.length) return;
    const r = pinch.ratio;
    pinch = null;
    swipedAt = Date.now();
    if (r > 1.15 && !fillMode) setFill(true, true);
    else if (r < 0.87 && fillMode) setFill(false, true);
  });
  ui.hit.addEventListener("pointerdown", (e) => {
    if (e.pointerType === "mouse" || pinch || pl.locked || pl.menu || !pl.s.loaded || !(pl.s.duration > 0)) return;
    swipe = { id: e.pointerId, x: e.clientX, y: e.clientY, from: curTime() / pl.s.duration, on: false };
  });
  ui.hit.addEventListener("pointermove", (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const dx = e.clientX - swipe.x;
    if (!swipe.on) {
      const dy = e.clientY - swipe.y;
      if (Math.abs(dy) > 16 && Math.abs(dy) > Math.abs(dx)) { swipe = null; return; }
      if (Math.abs(dx) < 14 || Math.abs(dx) < Math.abs(dy) * 1.3) return;
      swipe.on = true;
      swipe.x = e.clientX;
      try { ui.hit.setPointerCapture(e.pointerId); } catch (err) {}
      ui.seek.classList.add("dragging");
      pl.drag = swipe.from;
      wake();
      return;
    }
    const width = ui.seek.getBoundingClientRect().width || window.innerWidth;
    pl.drag = Math.min(1, Math.max(0, swipe.from + dx / width));
    swipeTip();
    paintTime();
  });
  const endSwipe = (e) => {
    if (!swipe || e.pointerId !== swipe.id) return;
    const done = swipe.on;
    swipe = null;
    if (!done) return;
    swipedAt = Date.now();
    const target = pl.drag * (pl.s.duration || 0);
    pl.drag = null;
    ui.seek.classList.remove("dragging");
    if (e.type === "pointerup") seekTo(target);
    paintTime();
    wake();
  };
  ui.hit.addEventListener("pointerup", endSwipe);
  ui.hit.addEventListener("pointercancel", endSwipe);
  ui.hit.addEventListener("click", (e) => {
    if (pl.locked) { showUnlock(); return; }
    if (Date.now() - swipedAt < 400) return;
    if (pl.menu) { toggleMenu(null); return; }
    if (!TOUCH) { togglePause(); return; }
    const now = Date.now();
    const x = e.clientX / window.innerWidth;
    if (now - lastTap < 300) {
      clearTimeout(tapTimer);
      lastTap = 0;
      if (x < 0.35) seekBy(-10);
      else if (x > 0.65) seekBy(10);
      else togglePause();
      return;
    }
    lastTap = now;
    tapTimer = setTimeout(() => {
      if (ui.root.classList.contains("idle")) wake();
      else { clearTimeout(pl.hideTimer); ui.root.classList.add("idle"); }
    }, 280);
  });
  ui.hit.addEventListener("dblclick", () => { if (!TOUCH) toggleFullscreen(); });
  ui.root.addEventListener("mousemove", wake);
  ui.root.addEventListener("mouseleave", () => {
    if (!pl.open || pl.menu || pl.drag != null) return;
    clearTimeout(pl.hideTimer);
    ui.root.classList.add("idle");
  });
  ui.root.addEventListener("wheel", (e) => { if (!e.target.closest(".pl-menu")) setVolume(Math.round((pl.s.volume ?? 100) - Math.sign(e.deltaY) * 5)); }, { passive: true });
  const frac = (e) => { const r = ui.seek.getBoundingClientRect(); return Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)); };
  ui.seek.addEventListener("pointermove", (e) => {
    const f = frac(e);
    const d = pl.s.duration || 0;
    ui.tip.textContent = secs(f * d);
    ui.tip.style.left = `${f * 100}%`;
    ui.hover.style.width = `${f * 100}%`;
    if (pl.drag != null) { pl.drag = f; paintTime(); }
  });
  ui.seek.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !(pl.s.duration > 0)) return;
    e.stopPropagation();
    ui.seek.setPointerCapture(e.pointerId);
    ui.seek.classList.add("dragging");
    pl.drag = frac(e);
    paintTime();
  });
  const release = (e) => {
    if (pl.drag == null) return;
    const target = pl.drag * (pl.s.duration || 0);
    pl.drag = null;
    ui.seek.classList.remove("dragging");
    if (e.type === "pointerup") seekTo(target);
    paintTime();
  };
  ui.seek.addEventListener("pointerup", release);
  ui.seek.addEventListener("pointercancel", release);
  document.body.append(ui.root);
  pl.ui = ui;
}

function wake() {
  if (!pl.open) return;
  if (pl.locked) { showUnlock(); return; }
  pl.ui.root.classList.remove("idle");
  clearTimeout(pl.hideTimer);
  pl.hideTimer = setTimeout(() => {
    if (pl.open && !pl.s.paused && !pl.menu && pl.drag == null && !pl.ui.root.querySelector(".pl-bottom:hover, .pl-top:hover")) pl.ui.root.classList.add("idle");
    else wake();
  }, 3000);
}

function flash(icon) {
  const f = pl.ui.flash;
  f.innerHTML = ICON[icon];
  f.classList.remove("on");
  void f.offsetWidth;
  f.classList.add("on");
}

const SUB_BASE = 20;
const SUB_DEFAULT = { scale: 1, height: SUB_BASE, color: "#FFFFFF", box: false, font: "Segoe UI Semibold", bold: false, italic: false, outline: 2.4, shadow: 1 };
const SUB_FONTS = [["Segoe UI Semibold", "Segoe"], ["Arial", "Arial"], ["Tahoma", "Tahoma"], ["Verdana", "Verdana"], ["Calibri", "Calibri"], ["Times New Roman", "Times"], ["Georgia", "Georgia"]];
const SUB_COLORS = [["#FFFFFF", "Trắng"], ["#FFE14D", "Vàng"], ["#7FE3FF", "Xanh"]];
const subPrefs = (() => {
  try {
    const saved = JSON.parse(localStorage.getItem("wistv.sub") || "{}");
    if (saved.height == null && saved.pos != null) saved.height = SUB_BASE + (100 - saved.pos);
    delete saved.pos;
    return { ...SUB_DEFAULT, ...saved };
  } catch (e) { return { ...SUB_DEFAULT }; }
})();
const subPlacement = (v) => (v <= SUB_BASE ? { pos: 100, margin: Math.round((v / SUB_BASE) * 60) } : { pos: 100 - (v - SUB_BASE), margin: 60 });
const saveSubPrefs = () => { try { localStorage.setItem("wistv.sub", JSON.stringify(subPrefs)); } catch (e) {} };
const quietSet = (name, value) => call("player_set", { name, value: String(value) }).then(() => true, () => false);

let unlockTimer = null;
function showUnlock() {
  if (!pl.ui?.unlock) return;
  pl.ui.root.classList.add("unlock-shown");
  clearTimeout(unlockTimer);
  unlockTimer = setTimeout(() => pl.ui.root.classList.remove("unlock-shown"), 3000);
}
function setLock(on) {
  pl.locked = on;
  if (!pl.ui) return;
  pl.ui.root.classList.toggle("locked", on);
  pl.ui.root.classList.remove("unlock-shown");
  clearTimeout(unlockTimer);
  if (on) {
    if (pl.menu) toggleMenu(null);
    clearTimeout(pl.hideTimer);
    pl.ui.root.classList.add("idle");
    showUnlock();
  } else wake();
}

let fillMode = (() => { try { const v = localStorage.getItem("wistv.fill"); return v == null ? TOUCH : v === "1"; } catch (e) { return TOUCH; } })();
function setFill(on, announce) {
  fillMode = on;
  try { localStorage.setItem("wistv.fill", on ? "1" : "0"); } catch (e) {}
  if (pl.open) quietSet("keepaspect", on ? "no" : "yes");
  if (pl.ui) {
    pl.ui.stretch.title = on ? "Giữ đúng tỉ lệ (Z)" : "Dãn kín màn hình (Z)";
    if (pl.ui.fillIcon) { pl.ui.fillIcon.innerHTML = ICON[on ? "fit" : "fill"]; pl.ui.fillLabel.textContent = on ? "Vừa hình" : "Dãn hình"; }
    else pl.ui.stretch.innerHTML = ICON[on ? "fit" : "fill"];
  }
  if (announce) toast(on ? "Dãn kín màn hình" : "Giữ đúng tỉ lệ hình");
}

const pad2 = (n) => String(n).padStart(2, "0");
let battTimer = null;
async function paintStatus() {
  if (!pl.ui || !pl.open) return;
  const now = new Date();
  pl.ui.clock.textContent = `${pad2(now.getHours())}:${pad2(now.getMinutes())}`;
  let b = null;
  try {
    if (TAURI) b = await call("device_battery");
    if (!b && navigator.getBattery) {
      const nb = await navigator.getBattery();
      if (nb.level < 1 || !nb.charging || Number.isFinite(nb.dischargingTime)) b = { level: nb.level, charging: nb.charging };
    }
  } catch (e) {}
  const el = pl.ui.batt;
  if (!b || typeof b.level !== "number") { el.hidden = true; return; }
  const pct = Math.round(Math.min(1, Math.max(0, b.level)) * 100);
  el.hidden = false;
  el.classList.toggle("low", pct <= 20 && !b.charging);
  el.replaceChildren(h("span", {}, `${pct}%`), h("i", { class: "pl-cell" }, h("b", { style: `width:${pct}%` }), b.charging ? h("em", { html: '<svg viewBox="0 0 10 14"><path d="M6 0 0 8h4l-1 6 6-8H5z" fill="currentColor"/></svg>' }) : null));
}
function startStatus() {
  clearInterval(battTimer);
  paintStatus();
  battTimer = setInterval(() => { if (pl.open) paintStatus(); else clearInterval(battTimer); }, 15000);
}

const SUB_LANGS = [["", "Tắt"], ["vi", "Tiếng Việt"], ["en", "English"], ["zh", "中文"], ["ko", "한국어"], ["ja", "日本語"]];
const sameLang = (a, b) => !!a && !!b && langName(a) === langName(b);
let subLang = (() => { try { const v = localStorage.getItem("wistv.sublang"); return v == null ? "vi" : v; } catch (e) { return "vi"; } })();
const setSubLang = (v) => { subLang = v; try { localStorage.setItem("wistv.sublang", v); } catch (e) {} };
const subPicks = () => { try { return JSON.parse(localStorage.getItem("wistv.subpick") || "{}"); } catch (e) { return {}; } };
function rememberSub(choice) {
  const id = pl.ctx?.m?.id;
  if (!id) return;
  const all = subPicks();
  delete all[id];
  all[id] = { ...choice, at: Date.now() };
  const keys = Object.keys(all);
  for (const k of keys.slice(0, Math.max(0, keys.length - 300))) delete all[k];
  try { localStorage.setItem("wistv.subpick", JSON.stringify(all)); } catch (e) {}
}

function loadAddonSubs() {
  if (pl.subs !== null && pl.subs !== "loading") return Promise.resolve(pl.subs);
  if (pl.subsJob) return pl.subsJob;
  if (!pl.ctx?.m?.type || String(pl.ctx.vid).startsWith("local:")) { pl.subs = []; return Promise.resolve(pl.subs); }
  pl.subs = "loading";
  const session = pl.session;
  pl.subsJob = call("subtitles", { kind: pl.ctx.m.type, id: pl.ctx.vid })
    .then((list) => { if (pl.session === session) { pl.subs = list; pl.subsJob = null; if (pl.menu === "tracks") renderMenu(); } return list; })
    .catch(() => { if (pl.session === session) { pl.subs = []; pl.subsJob = null; } return []; });
  return pl.subsJob;
}

function addAddonSub(s, quiet) {
  pl.added.add(s.url);
  const args = ["sub-add", s.url, "select", `${langName(s.lang)} · ${s.addon}`, s.lang || ""];
  return quiet ? call("player_command", { args }).catch(() => {}) : cmd(...args);
}

async function autoSub(session) {
  const pick = subPicks()[pl.ctx?.m?.id];
  const want = pick || (subLang ? { lang: subLang } : null);
  if (!want || pl.session !== session) return;
  if (want.off) { quietSet("sid", "no"); return; }
  const tracks = pl.tracks.filter((t) => t.type === "sub" && !t.external);
  const inFile = tracks.find((t) => sameLang(t.lang, want.lang) && (!want.title || t.title === want.title)) || tracks.find((t) => sameLang(t.lang, want.lang));
  if (inFile && !want.url) { quietSet("sid", inFile.id); return; }
  const list = await loadAddonSubs();
  if (pl.session !== session || !Array.isArray(list)) return;
  const fromAddon = (want.url && list.find((s) => s.url === want.url)) || list.find((s) => sameLang(s.lang, want.lang));
  if (fromAddon) { if (!pl.added.has(fromAddon.url)) addAddonSub(fromAddon, true); return; }
  if (inFile) quietSet("sid", inFile.id);
}

async function applySubStyle(keys) {
  const all = !keys;
  if (all || keys.includes("scale")) quietSet("sub-scale", subPrefs.scale.toFixed(2));
  if (all || keys.includes("height")) {
    const p = subPlacement(subPrefs.height);
    quietSet("sub-margin-y", p.margin);
    quietSet("sub-pos", p.pos);
  }
  if (all || keys.includes("color")) quietSet("sub-color", subPrefs.color);
  if (all || keys.includes("font")) quietSet("sub-font", subPrefs.font);
  if (all || keys.includes("bold")) quietSet("sub-bold", subPrefs.bold ? "yes" : "no");
  if (all || keys.includes("italic")) quietSet("sub-italic", subPrefs.italic ? "yes" : "no");
  if (all || keys.includes("outline")) {
    if (!(await quietSet("sub-outline-size", subPrefs.outline.toFixed(1)))) quietSet("sub-border-size", subPrefs.outline.toFixed(1));
  }
  if (all || keys.includes("shadow")) quietSet("sub-shadow-offset", subPrefs.shadow.toFixed(1));
  if (all || keys.includes("box")) {
    const edge = subPrefs.box ? "#B4000000" : "#FF000000";
    if (subPrefs.box) {
      if (!(await quietSet("sub-border-style", "background-box"))) await quietSet("sub-border-style", "opaque-box");
      quietSet("sub-back-color", "#B4000000");
    } else if (!all) {
      await quietSet("sub-border-style", "outline-and-shadow");
      quietSet("sub-back-color", "#00000000");
    }
    if (subPrefs.box || !all) {
      quietSet("sub-outline-color", edge);
      quietSet("sub-border-color", edge);
    }
  }
}

function subSlider(label, min, max, step, value, show, onChange) {
  const out = h("b", {}, show(value));
  const input = h("input", { type: "range", min: String(min), max: String(max), step: String(step), value: String(value), tabindex: "-1", class: "pl-range" });
  const paint = () => input.style.setProperty("--v", `${((Number(input.value) - min) / (max - min)) * 100}%`);
  paint();
  input.addEventListener("input", () => { const v = Number(input.value); out.textContent = show(v); paint(); onChange(v); });
  input.addEventListener("change", () => input.blur());
  return h("div", { class: "pl-slider" }, h("div", { class: "pl-slider-head" }, h("span", {}, label), out), input);
}

function subStylePanel() {
  const pick = (label, on, fn) => h("button", { class: `pl-mini ${on ? "on" : ""}`, tabindex: "-1", onclick: fn }, label);
  const set = (key, value) => { subPrefs[key] = value; saveSubPrefs(); applySubStyle([key]); renderMenu(); };
  return h("div", { class: "pl-substyle" },
    h("h4", {}, "Kiểu phụ đề"),
    subSlider("Cỡ chữ", 50, 250, 5, Math.round(subPrefs.scale * 100), (v) => `${v}%`, (v) => { subPrefs.scale = v / 100; saveSubPrefs(); applySubStyle(["scale"]); }),
    subSlider("Vị trí", 0, 100, 1, Math.round(subPrefs.height), (v) => (v === 0 ? "Sát mép dưới" : v === SUB_BASE ? "Mặc định" : v < SUB_BASE ? `Thấp ${SUB_BASE - v}` : `Cao ${v - SUB_BASE}`), (v) => { subPrefs.height = v; saveSubPrefs(); applySubStyle(["height"]); }),
    h("div", { class: "pl-choice wrap" }, h("span", {}, "Font"),
      SUB_FONTS.map(([font, label]) => h("button", { class: `pl-mini ${subPrefs.font === font ? "on" : ""}`, tabindex: "-1", style: `font-family:'${font}'`, onclick: () => set("font", font) }, label))),
    h("div", { class: "pl-choice" }, h("span", {}, "Kiểu chữ"),
      pick("Thường", !subPrefs.bold && !subPrefs.italic, () => { subPrefs.italic = false; set("bold", false); applySubStyle(["italic"]); }),
      h("button", { class: `pl-mini ${subPrefs.bold ? "on" : ""}`, tabindex: "-1", style: "font-weight:800", onclick: () => set("bold", !subPrefs.bold) }, "Đậm"),
      h("button", { class: `pl-mini ${subPrefs.italic ? "on" : ""}`, tabindex: "-1", style: "font-style:italic", onclick: () => set("italic", !subPrefs.italic) }, "Nghiêng")),
    h("div", { class: "pl-choice" }, h("span", {}, "Màu chữ"),
      SUB_COLORS.map(([c, label]) => pick(label, subPrefs.color === c, () => set("color", c)))),
    h("div", { class: "pl-choice" }, h("span", {}, "Nền"),
      pick("Viền", !subPrefs.box, () => set("box", false)),
      pick("Nền tối", subPrefs.box, () => set("box", true))),
    subSlider("Độ dày viền", 0, 6, 0.2, subPrefs.outline, (v) => (v === 0 ? "Không viền" : v.toFixed(1)), (v) => { subPrefs.outline = v; saveSubPrefs(); applySubStyle(["outline"]); }),
    subSlider("Bóng chữ", 0, 4, 0.5, subPrefs.shadow, (v) => (v === 0 ? "Không bóng" : v.toFixed(1)), (v) => { subPrefs.shadow = v; saveSubPrefs(); applySubStyle(["shadow"]); }),
    h("div", { class: "pl-choice" },
      h("button", { class: "pl-mini", tabindex: "-1", onclick: () => { Object.assign(subPrefs, SUB_DEFAULT); saveSubPrefs(); applySubStyle(); applySubStyle(["box"]); renderMenu(); } }, "Đặt lại")),
    h("p", { class: "pl-none" }, "Lưu cho mọi phim. Phụ đề ASS có kiểu riêng chỉ đổi được cỡ chữ."));
}

const cmd = (...args) => call("player_command", { args: args.map(String) }).catch((e) => toast(e, true));
const setProp = (name, value) => call("player_set", { name, value: String(value) }).catch((e) => toast(e, true));

function curTime() {
  if (pl.drag != null) return pl.drag * (pl.s.duration || 0);
  if (Date.now() < pl.seekUntil) return pl.seekTarget;
  return pl.s.time || 0;
}

function togglePause() {
  if (!pl.s.loaded) return;
  flash(pl.s.paused ? "play" : "pause");
  pl.s.paused = !pl.s.paused;
  paintState();
  cmd("cycle", "pause");
  wake();
}

function seekTo(t) {
  const d = pl.s.duration || 0;
  const target = Math.max(0, d ? Math.min(d - 1, t) : t);
  pl.seekTarget = target;
  pl.seekUntil = Date.now() + 2500;
  paintTime();
  cmd("seek", target.toFixed(2), "absolute");
}

function seekBy(dt) {
  if (!pl.s.loaded) return;
  flash(dt < 0 ? "back10" : "fwd10");
  seekTo(curTime() + dt);
  wake();
}

function setVolume(v) {
  const vol = Math.max(0, Math.min(150, v));
  pl.s.volume = vol;
  pl.ui.vol.value = String(vol);
  paintState();
  setProp("volume", vol);
  if (pl.s.mute) cmd("set", "mute", "no");
}

const IOS_IPA = "https://github.com/WallisSkill/stremio-display/releases/download/ios/WiSTV.ipa";
const IPHONE_FS =!TAURI && !document.documentElement.requestFullscreen && !document.documentElement.webkitRequestFullscreen;
const STANDALONE = !TAURI && (navigator.standalone === true || window.matchMedia("(display-mode: standalone)").matches);

async function toggleFullscreen() {
  if (IPHONE_FS && !pl.fs) { toggleMenu("fullscreen"); return; }
  try { pl.fs = await call("player_fullscreen", {}); } catch (e) { toast(e, true); }
  pl.ui.fs.innerHTML = pl.fs ? ICON.unfull : ICON.full;
}

function nativeFullscreen() {
  const p = call("player_fullscreen", { on: true });
  pl.menu = null;
  renderMenu();
  p.then((on) => { pl.fs = on; pl.ui.fs.innerHTML = on ? ICON.unfull : ICON.full; }, (e) => toast(e, true));
}

function paintTime() {
  const ui = pl.ui;
  const d = pl.s.duration || 0;
  const t = curTime();
  const f = d > 0 ? Math.min(1, t / d) : 0;
  ui.fill.style.width = `${f * 100}%`;
  ui.knob.style.left = `${f * 100}%`;
  const cacheEnd = pl.s.cache != null ? pl.s.cache : t;
  ui.buf.style.width = d > 0 ? `${Math.min(100, (Math.max(cacheEnd, t) / d) * 100)}%` : "0%";
  ui.time.textContent = d > 0 ? `${secs(t)} / ${secs(d)}` : pl.s.loaded ? secs(t) : "";
  ui.seek.classList.toggle("off", !(d > 0));
}

function paintState() {
  const ui = pl.ui;
  const s = pl.s;
  ui.play.innerHTML = s.paused ? ICON.play : ICON.pause;
  ui.play.title = s.paused ? "Phát (Space)" : "Dừng (Space)";
  const showSpin = !s.loaded || s.buffering;
  ui.spin.hidden = !showSpin;
  ui.bufText.textContent = !s.loaded ? (pl.ctx?.stream?.infoHash ? "Đang tải torrent…" : "Đang mở…") : s.cachePercent != null && s.cachePercent < 100 ? `Đang tải ${Math.round(s.cachePercent)}%` : "";
  if (document.activeElement !== ui.vol && s.volume != null) ui.vol.value = String(Math.round(s.volume));
  ui.volBtn.innerHTML = s.mute || s.volume === 0 ? ICON.mute : ICON.vol;
  ui.vol.style.setProperty("--v", `${((s.mute ? 0 : s.volume ?? 100) / 150) * 100}%`);
  ui.speedVal.textContent = `${s.speed && s.speed !== 1 ? +s.speed.toFixed(2) : 1}×`;
  const nx = nextEpisode();
  ui.next.hidden = !nx;
  ui.eps.hidden = !((pl.ctx?.m?.videos || []).length > 1);
  const left = (s.duration || 0) - (s.time || 0);
  const showUp = !!nx && s.loaded && s.duration > 300 && left > 0 && left <= 90;
  if (showUp && ui.nextUp.hidden) ui.nextUp.innerHTML = `${ICON.next}<span>Tập tiếp · ${epShort(nx)}</span>`;
  ui.nextUp.hidden = !showUp;
  ui.root.classList.toggle("paused", !!s.paused);
  paintTime();
}

function onPlayerState(s) {
  if (!pl.open || s.session !== pl.session) return;
  if (s.tracks) pl.tracks = s.tracks;
  const wasLoaded = pl.s.loaded;
  pl.s = { ...pl.s, ...s };
  if (Date.now() < pl.seekUntil && Math.abs((s.time || 0) - pl.seekTarget) < 1.5 && !s.buffering) pl.seekUntil = 0;
  if (s.loaded && !wasLoaded) {
    const session = pl.session;
    if (fillMode) quietSet("keepaspect", "no");
    setTimeout(() => autoSub(session), 600);
    pl.ui.root.classList.remove("loading");
    document.body.classList.add("see-through");
    wake();
  }
  paintState();
  if (pl.menu === "tracks" && s.tracks) renderMenu();
}

function nextEpisode() {
  const c = pl.ctx;
  if (!c || !c.m || !Array.isArray(c.m.videos)) return null;
  const list = c.m.videos.filter((v) => v.id).sort(epSort);
  const i = list.findIndex((v) => v.id === c.vid);
  if (i < 0) return null;
  const curSeason = list[i].season ?? 0;
  const now = new Date();
  return list.slice(i + 1).find((v) => ((v.season ?? 0) !== 0 || curSeason === 0) && (!v.released || new Date(v.released) <= now)) || null;
}

function sameSource(groups, c) {
  const bg = c.stream?.behaviorHints?.bingeGroup;
  if (bg) {
    for (const g of groups) {
      const s = g.streams.find((x) => x.behaviorHints?.bingeGroup === bg);
      if (s) return { stream: s, addon: g.addon };
    }
  }
  const g = c.addon && groups.find((x) => x.addon === c.addon);
  if (!g || !g.streams.length) return null;
  const tag = quality(c.stream || {}).tags[0]?.[0];
  const s = (tag && g.streams.find((x) => quality(x).tags[0]?.[0] === tag)) || g.streams[0];
  return { stream: s, addon: g.addon };
}

async function playEpisode(v, auto) {
  const c = pl.ctx;
  if (!c || !v) return false;
  const session = ++pl.session;
  call("player_stop").catch(() => {});
  pl.menu = null;
  renderMenu();
  pl.ui.root.classList.add("loading");
  document.body.classList.remove("see-through");
  pl.s = { ...pl.s, loaded: false };
  pl.ui.title.textContent = c.m.name;
  pl.ui.sub.textContent = epName(v);
  paintState();
  let groups = [];
  try { groups = await call("streams", { kind: c.m.type, id: v.id }); } catch (e) { groups = []; }
  if (pl.session !== session) return true;
  const pick = sameSource(groups, c);
  if (pick) {
    const entry = libEntry(c.m.id);
    const resume = entry?.state?.video_id === v.id ? entry.state.timeOffset || 0 : 0;
    startPlayback(c.m, v.id, epName(v), pick.stream, resume, pick.addon);
  } else {
    closePlayer(false);
    openStreams(c.m, v.id, epName(v));
    toast(auto ? "Chọn nguồn cho tập tiếp theo" : "Không có cùng nguồn cho tập này, hãy chọn nguồn khác");
  }
  return true;
}

const playNext = (auto) => playEpisode(nextEpisode(), auto);

function renderEpisodes(box) {
  const c = pl.ctx;
  const vids = (c?.m?.videos || []).filter((v) => v.id).sort(epSort);
  const seasons = [...new Set(vids.map((v) => v.season ?? 0))].sort((a, b) => (a === 0) - (b === 0) || a - b);
  if (pl.epSeason == null || !seasons.includes(pl.epSeason)) pl.epSeason = (vids.find((v) => v.id === c.vid) || {}).season ?? seasons[0];
  const now = new Date();
  const list = h("div", { class: "pl-eps" }, vids.filter((v) => (v.season ?? 0) === pl.epSeason).map((v) => {
    const cur = v.id === c.vid;
    const date = v.released ? new Date(v.released) : null;
    const future = date && date > now;
    const note = cur ? "Đang xem" : future ? `Ra ngày ${date.toLocaleDateString("vi-VN")}` : date && !isNaN(date) ? date.toLocaleDateString("vi-VN") : "";
    return h("button", { class: `pl-ep ${cur ? "on" : ""}`, tabindex: "-1", disabled: future || null, onclick: () => { if (!cur) playEpisode(v, false); } },
      h("span", { class: "pl-ep-n" }, v.episode ?? v.number ?? "?"),
      h("div", {}, h("b", {}, v.title || v.name || `Tập ${v.episode ?? ""}`), note ? h("small", {}, note) : null));
  }));
  box.className = "pl-menu episodes";
  box.replaceChildren(
    h("h4", {}, "Các tập"),
    seasons.length > 1 ? h("div", { class: "pl-seasons" }, seasons.map((s) => h("button", { class: `pl-mini ${s === pl.epSeason ? "on" : ""}`, tabindex: "-1", onclick: () => { pl.epSeason = s; renderMenu(); } }, s === 0 ? "Đặc biệt" : `Mùa ${s}`))) : null,
    list);
  requestAnimationFrame(() => list.querySelector(".pl-ep.on")?.scrollIntoView({ block: "center" }));
}

function toggleMenu(kind) {
  pl.menu = kind && pl.menu !== kind ? kind : null;
  if (pl.menu === "tracks" && pl.subs === null) loadAddonSubs();
  renderMenu();
  wake();
}

function trackLabel(t) {
  const bits = [langName(t.lang), t.title && t.title !== t.lang ? t.title : ""].filter(Boolean);
  if (t.type === "audio") {
    if (t.codec) bits.push(String(t.codec).toUpperCase());
    if (t.channels) bits.push(`${t.channels}ch`);
  }
  if (t.external) bits.push("ngoài");
  return bits.join(" · ") || `${t.type === "audio" ? "Âm thanh" : "Phụ đề"} ${t.id}`;
}

function menuItem(label, on, onclick, extra) {
  return h("button", { class: `pl-item ${on ? "on" : ""}`, tabindex: "-1", onclick }, h("i", { html: on ? ICON.check : "" }), h("span", {}, label), extra ? h("small", {}, extra) : null);
}

function renderMenu() {
  const box = pl.ui.menu;
  box.hidden = !pl.menu;
  if (!pl.menu) { box.replaceChildren(); return; }
  fillMenu(box);
  box.prepend(h("button", { class: "pl-menu-x", tabindex: "-1", "aria-label": "Đóng", title: "Đóng", html: ICON.close, onclick: () => toggleMenu(null) }));
}

function fillMenu(box) {
  if (pl.menu === "episodes") { renderEpisodes(box); return; }
  if (pl.menu === "fullscreen") {
    box.className = "pl-menu narrow";
    box.replaceChildren(h("h4", {}, "Toàn màn hình"),
      h("p", { class: "pl-note" }, STANDALONE
        ? "Bạn đang mở WiS TV từ Màn hình chính: chỉ cần xoay ngang điện thoại là phim kín màn hình, phụ đề vẫn theo kiểu bạn đã chỉnh."
        : "Safari trên iPhone không cho trang web tự vào toàn màn hình. Muốn kín màn hình mà vẫn giữ kiểu phụ đề của bạn: bấm nút Chia sẻ của Safari → Thêm vào MH chính, mở WiS TV từ biểu tượng đó rồi xoay ngang điện thoại."),
      menuItem("Dùng toàn màn hình của iPhone", false, nativeFullscreen, "phụ đề theo kiểu iPhone"));
    return;
  }
  if (pl.menu === "speed") {
    const cur = pl.s.speed || 1;
    box.className = "pl-menu narrow";
    box.replaceChildren(h("h4", {}, "Tốc độ phát"),
      ...[0.5, 0.75, 1, 1.25, 1.5, 1.75, 2].map((v) => menuItem(v === 1 ? "Bình thường" : `${v}×`, Math.abs(cur - v) < 0.01, () => { pl.s.speed = v; setProp("speed", v); renderMenu(); paintState(); })));
    return;
  }
  box.className = "pl-menu";
  const audio = pl.tracks.filter((t) => t.type === "audio");
  const subs = pl.tracks.filter((t) => t.type === "sub");
  const sid = pl.s.sid;
  const audioCol = h("div", { class: "pl-col" }, h("h4", {}, "Âm thanh"),
    audio.length ? audio.map((t) => menuItem(trackLabel(t), t.selected, () => { setProp("aid", t.id); })) : h("p", { class: "pl-none" }, "Chưa có thông tin"));
  const subCol = h("div", { class: "pl-col" }, h("h4", {}, "Phụ đề"),
    menuItem("Tắt", !sid || sid === "no" || sid === "false", () => { rememberSub({ off: true }); setProp("sid", "no"); }),
    subs.map((t) => menuItem(trackLabel(t), t.selected, () => { rememberSub(t.external ? { lang: t.lang, url: t.file || undefined } : { lang: t.lang, title: t.title }); setProp("sid", t.id); })),
    h("div", { class: "pl-delay" }, h("span", {}, "Độ trễ"),
      h("button", { class: "pl-mini", tabindex: "-1", onclick: () => cmd("add", "sub-delay", "-0.1") }, "−0.1s"),
      h("b", {}, `${(pl.s.subDelay || 0).toFixed(1)}s`),
      h("button", { class: "pl-mini", tabindex: "-1", onclick: () => cmd("add", "sub-delay", "0.1") }, "+0.1s")),
    subStylePanel());
  const addonCol = h("div", { class: "pl-col" }, h("h4", {}, "Phụ đề từ addon"));
  if (pl.subs === "loading") addonCol.append(h("div", { class: "spinner small" }));
  else if (!pl.subs || !pl.subs.length) addonCol.append(h("p", { class: "pl-none" }, "Không addon nào có phụ đề cho mục này"));
  else {
    const seen = new Set();
    const list = pl.subs.filter((s) => !seen.has(s.url) && seen.add(s.url)).sort((a, b) => langRank(a.lang) - langRank(b.lang) || String(a.lang).localeCompare(String(b.lang))).slice(0, 60);
    addonCol.append(...list.map((s) => {
      const done = pl.added.has(s.url);
      return menuItem(langName(s.lang) || "Không rõ", done, () => {
        if (done) return;
        rememberSub({ lang: s.lang, url: s.url });
        addAddonSub(s, false);
        renderMenu();
      }, s.addon);
    }));
  }
  box.replaceChildren(audioCol, subCol, addonCol);
}

function openPlayer(c) {
  if (!pl.ui) buildPlayer();
  if (!pl.open) pl.returnFocus = document.activeElement;
  pl.open = true;
  navSync();
  pl.ctx = c;
  pl.s = { loaded: false, volume: pl.s.volume ?? 100 };
  pl.tracks = [];
  pl.subs = null;
  pl.subsJob = null;
  pl.added = new Set();
  setLock(false);
  pl.menu = null;
  pl.epSeason = null;
  pl.drag = null;
  pl.seekUntil = 0;
  const ui = pl.ui;
  const isEp = c.m.type === "series" && c.label;
  ui.title.textContent = c.m.name || "";
  ui.sub.textContent = isEp ? c.label : yearOf(c.m) || "";
  const bg = bgOf(c.m);
  ui.bg.style.backgroundImage = bg ? `url("${bg}")` : "";
  ui.root.classList.add("loading");
  ui.root.classList.remove("idle");
  ui.root.hidden = false;
  startStatus();
  renderMenu();
  document.body.classList.add("playing");
  document.body.classList.remove("see-through");
  clearInterval(app.heroTimer);
  paintState();
  wake();
}

function closePlayer(stop = true) {
  if (!pl.open) return;
  pl.open = false;
  navSync();
  pl.session++;
  clearTimeout(pl.hideTimer);
  if (stop) call("player_stop").catch(() => {});
  if (pl.fs) { call("player_fullscreen", { on: false }).catch(() => {}); pl.fs = false; pl.ui.fs.innerHTML = ICON.full; }
  pl.menu = null;
  pl.ui.root.hidden = true;
  document.body.classList.remove("playing", "see-through");
  pl.returnFocus?.focus?.({ preventScroll: true });
}

async function startPlayback(m, vid, label, stream, start, addon) {
  const ctx = (session) => ({ id: m.id, kind: m.type, name: m.type === "series" && label ? `${m.name} · ${label}` : m.name, poster: m.poster || null, video: vid, start: Math.floor(start || 0), session });
  if ((stream.externalUrl || (!TAURI && stream.ytId)) && !stream.url && !stream.infoHash) {
    try { await call("play", { stream, ctx: ctx(0) }); closeSheet(); } catch (e) { toast(e, true); }
    return;
  }
  closeSheet();
  const session = ++pl.session;
  openPlayer({ m, vid, label, stream, addon });
  if (TOUCH && !pl.fs) {
    call("player_fullscreen", { on: true }).then((on) => { pl.fs = on; pl.ui.fs.innerHTML = on ? ICON.unfull : ICON.full; }).catch(() => {});
  }
  try {
    await call("play", { stream, ctx: ctx(session) });
    if (pl.session === session) applySubStyle();
  } catch (e) {
    if (pl.session === session) closePlayer(false);
    toast(e, true);
  }
}

function playerKey(e) {
  if (e.target instanceof HTMLInputElement && e.target.type !== "range") return false;
  const k = e.key;
  const handled = () => { e.preventDefault(); wake(); return true; };
  if (k === " " || k === "k" || k === "K" || k === "MediaPlayPause") { togglePause(); return handled(); }
  if (k === "ArrowLeft" || k === "j" || k === "J") { seekBy(e.shiftKey ? -60 : -10); return handled(); }
  if (k === "ArrowRight" || k === "l" || k === "L") { seekBy(e.shiftKey ? 60 : 10); return handled(); }
  if (k === "ArrowUp") { setVolume(Math.round((pl.s.volume ?? 100) + 5)); return handled(); }
  if (k === "ArrowDown") { setVolume(Math.round((pl.s.volume ?? 100) - 5)); return handled(); }
  if (k === "f" || k === "F") { toggleFullscreen(); return handled(); }
  if (k === "z" || k === "Z") { setFill(!fillMode, true); return handled(); }
  if (k === "m" || k === "M") { cmd("cycle", "mute"); return handled(); }
  if (k === "n" || k === "N" || k === "MediaTrackNext") { playNext(false); return handled(); }
  if (k === "c" || k === "C") { toggleMenu("tracks"); return handled(); }
  if ((k === "e" || k === "E") && !pl.ui.eps.hidden) { toggleMenu("episodes"); return handled(); }
  if (k === "Escape") {
    if (pl.menu) toggleMenu(null);
    else if (pl.fs) toggleFullscreen();
    else closePlayer();
    return handled();
  }
  if (k === "Backspace") { closePlayer(); return handled(); }
  if (k === "Enter") return handled();
  return false;
}

function renderGridPage(view, title, items, emptyText) {
  document.body.classList.add("dim");
  const grid = h("div", { class: "grid" }, items.map((m) => card(m, "poster")));
  view.append(h("div", { class: "page plain" }, h("h1", {}, title), items.length ? grid : h("div", { class: "empty" }, emptyText)));
  $(".grid .card")?.focus({ preventScroll: true });
}

async function renderLibrary(view) {
  await refreshLibrary();
  const items = libItems()
    .sort((a, b) => String(b._mtime || "").localeCompare(String(a._mtime || "")))
    .map((i) => ({ id: i._id, type: i.type, name: i.name, poster: i.poster }));
  renderGridPage(view, "Thư viện", items, app.user ? "Thư viện trống. Bấm “Thư viện” ở trang phim để thêm." : "Đăng nhập tài khoản Stremio để dùng Thư viện.");
}

let addonsAt = 0;
const addonKey = (list) => JSON.stringify((list || []).map((a) => a.transportUrl));
async function syncAddons(maxAge) {
  if (!TAURI || Date.now() - addonsAt < maxAge) return false;
  addonsAt = Date.now();
  try {
    const list = await call("addons", { refresh: true });
    const changed = addonKey(list) !== addonKey(app.addons);
    app.addons = list;
    return changed;
  } catch (e) { return false; }
}

const searchHistory = () => { try { const v = JSON.parse(localStorage.getItem("wistv.searches") || "[]"); return Array.isArray(v) ? v.filter((x) => typeof x === "string") : []; } catch (e) { return []; } };
const saveSearches = (list) => { try { localStorage.setItem("wistv.searches", JSON.stringify(list.slice(0, 10))); } catch (e) {} };
function rememberSearch(term) {
  const t = String(term || "").trim();
  if (t.length < 2) return;
  saveSearches([t, ...searchHistory().filter((x) => x.toLowerCase() !== t.toLowerCase())]);
}

function renderSearch(view, { q = "" } = {}) {
  document.body.classList.add("dim");
  const input = h("input", { placeholder: "Phim, phim bộ, diễn viên…", value: q, spellcheck: "false" });
  const results = h("div");
  view.append(h("div", { class: "page plain" }, h("div", { class: "search-box", html: ICON.search }, input), results));
  input.focus();
  let timer, token = 0;
  const run = () => {
    const term = input.value.trim();
    const mine = ++token;
    if (app.stack.length) app.stack[app.stack.length - 1].params = { q: term };
    if (term.length < 2) { showHistory(); return; }
    const cats = catalogsOf(null, { search: true });
    if (!cats.length) { results.replaceChildren(h("div", { class: "empty" }, "Không addon nào hỗ trợ tìm kiếm.")); return; }
    results.replaceChildren(...cats.map(({ addon, cat }) =>
      shelf(`${TYPE_LABEL[cat.type] || cat.type}`, `${cat.name || cat.id} · ${addon.manifest.name}`, "poster",
        async () => (mine === token ? call("catalog", { url: addon.transportUrl, kind: cat.type, id: cat.id, extra: [["search", term]] }) : []),
        { eager: true })));
  };
  const showHistory = () => {
    const list = searchHistory();
    if (!list.length) { results.replaceChildren(h("div", { class: "empty" }, "Nhập ít nhất 2 ký tự để tìm.")); return; }
    const pick = (t) => { input.value = t; clearTimeout(timer); rememberSearch(t); run(); };
    const drop = (t) => { saveSearches(searchHistory().filter((x) => x !== t)); showHistory(); };
    results.replaceChildren(h("div", { class: "search-history" },
      h("div", { class: "sh-head" }, h("h3", {}, "Tìm kiếm gần đây"), h("button", { class: "link focusable", onclick: () => { saveSearches([]); showHistory(); } }, "Xoá hết")),
      ...list.map((t) => h("div", { class: "sh-row" },
        h("button", { class: "sh-term focusable", onclick: () => pick(t) }, h("span", { html: ICON.search }), h("span", {}, t)),
        h("button", { class: "sh-x focusable", title: "Xoá", "aria-label": `Xoá ${t}`, html: ICON.close, onclick: () => drop(t) })))));
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 450); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); rememberSearch(input.value); run(); } });
  results.addEventListener("click", (e) => { if (input.value.trim().length >= 2 && e.target.closest(".card, a, button") && !e.target.closest(".search-history")) rememberSearch(input.value); }, true);
  run();
  syncAddons(60000).then((changed) => { if (changed && input.isConnected) run(); });
}

async function renderSettings(view) {
  document.body.classList.add("dim");
  const name = app.user?.fullname || app.user?.email || "Khách";
  const account = h("div", { class: "panel" },
    h("h3", {}, "Tài khoản"),
    h("div", { class: "account" },
      h("div", { class: "avatar" }, initial()),
      h("div", { class: "who" }, h("b", {}, name), h("span", {}, app.user ? "Đã đồng bộ với Stremio" : "Chế độ khách · chỉ có Cinemeta")),
      app.user
        ? h("button", { class: "btn focusable", onclick: async () => { await call("logout"); cacheClear(); app.user = null; app.library = []; app.addons = []; go("login", {}, true); } }, "Đăng xuất")
        : h("button", { class: "btn primary focusable", onclick: () => go("login", {}, true) }, "Đăng nhập")));
  const list = h("div", { class: "panel" }, h("h3", {}, `Addon (${app.addons.length})`),
    h("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap" },
      h("button", { class: "btn primary focusable", onclick: () => go("addons") }, "Quản lý addon"),
      h("span", { class: "hint" }, "Cài, gỡ, sắp xếp addon ngay trong WiS TV. Danh sách đồng bộ với tài khoản Stremio.")));
  const help = h("div", { class: "panel" }, h("h3", {}, "Điều khiển"),
    h("div", { class: "hint" },
      "Mũi tên để di chuyển, Enter để chọn, Esc hoặc Backspace để quay lại. Giữ chuột trái và kéo để cuộn các hàng phim.", h("br"),
      "Trong trình phát: Space hoặc bấm vào hình để dừng/tiếp, ← → tua 10 giây (Shift: 1 phút), ↑ ↓ hoặc lăn chuột chỉnh âm lượng, M tắt tiếng, F hoặc bấm đúp để toàn màn hình, C chọn âm thanh và phụ đề, N tập tiếp, Esc quay lại."));
  const pc = TAURI ? null : h("div", { class: "panel" }, h("h3", {}, "Máy tính phát phim"));
  if (pc) {
    const status = h("div", { class: "pc-status" }, h("div", { class: "spinner small" }));
    const check = async (force) => {
      status.replaceChildren(h("div", { class: "spinner small" }));
      let s = { linked: false, online: false };
      try { s = await call("server_status", { force }); } catch (e) {}
      const dot = h("i", { class: `pc-dot ${s.online ? "on" : ""}` });
      const msg = s.online
        ? "Đã kết nối. Xem được torrent và mọi định dạng phim qua máy tính."
        : s.linked
          ? "Máy tính đã đăng ký nhưng không trả lời. Kiểm tra máy còn bật và WiS TV Relay đang chạy."
          : app.user
            ? "Chưa thấy máy tính. Bật máy, đăng nhập app WiS TV trên máy tính và chạy WiS TV Relay."
            : "Đăng nhập tài khoản Stremio để kết nối với máy tính.";
      status.replaceChildren(dot, h("span", {}, msg));
    };
    pc.append(status, h("div", { style: "margin-top:14px" }, h("button", { class: "btn focusable", onclick: () => check(true) }, "Kiểm tra lại")),
      h("p", { class: "hint" }, "Không có máy tính thì vẫn xem được các nguồn có link trực tiếp mà trình duyệt phát được (MP4, HLS)."));
    check(false);
  }
  const ios = TAURI ? null : h("div", { class: "panel" }, h("h3", {}, "Ứng dụng cho iPhone"),
    h("p", { class: "hint" }, "Bản app phát được mọi định dạng (MKV, HEVC, phụ đề trong file) và tự phát torrent ngay trên iPhone, không cần máy tính."),
    h("div", { style: "display:flex;gap:12px;align-items:center;flex-wrap:wrap;margin-top:12px" },
      h("a", { class: "btn primary focusable", href: IOS_IPA, download: "WiSTV.ipa", rel: "noopener" }, "Tải WiS TV cho iPhone (.ipa)")),
    h("p", { class: "hint" }, "Cài từ máy tính bằng Sideloadly với Apple ID của bạn. Mỗi 7 ngày ký lại một lần, app và dữ liệu vẫn giữ nguyên."));
  const touchHelp = h("div", { class: "hint" }, "Trên điện thoại: chạm vào hình để hiện/ẩn điều khiển, chạm đúp bên trái/phải để tua 10 giây, chạm đúp giữa để dừng/tiếp.");
  const subs = h("div", { class: "panel" }, h("h3", {}, "Phụ đề"));
  const paintSubs = () => subs.replaceChildren(h("h3", {}, "Phụ đề"),
    h("p", { class: "hint" }, "Ngôn ngữ phụ đề mặc định. Phim có sẵn phụ đề ngôn ngữ này thì dùng luôn, không có thì tự lấy từ addon. Phụ đề bạn chọn trong lúc xem được nhớ riêng cho từng phim."),
    h("div", { class: "pl-pick", style: "display:flex;gap:8px;flex-wrap:wrap;margin-top:12px" },
      SUB_LANGS.map(([code, label]) => h("button", { class: `btn focusable ${subLang === code ? "primary" : ""}`, onclick: () => { setSubLang(code); paintSubs(); } }, label))));
  paintSubs();
  const version = h("p", { class: "hint", style: "margin-top:18px" });
  if (TAURI?.app?.getVersion) TAURI.app.getVersion().then((v) => { version.textContent = `WiS TV phiên bản ${v}`; }).catch(() => {});
  view.append(h("div", { class: "page plain" }, h("h1", {}, "Cài đặt"), account, ios, pc, subs, list, TOUCH ? h("div", { class: "panel" }, h("h3", {}, "Điều khiển"), touchHelp) : help, version));
  $(".panel .btn")?.focus({ preventScroll: true });
}

async function renderLogin(view) {
  $("#topbar").hidden = true;
  document.body.classList.remove("dim");
  const wall = h("div", { class: "wall" });
  const email = h("input", { class: "field", type: "email", placeholder: "Email Stremio", autocomplete: "username" });
  const pass = h("input", { class: "field", type: "password", placeholder: "Mật khẩu", autocomplete: "current-password" });
  const err = h("p", { class: "err" });
  const submit = h("button", { class: "btn primary focusable", type: "submit" }, "Đăng nhập");
  const form = h("form", {}, email, pass, err, submit);
  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    err.textContent = "";
    submit.disabled = true;
    submit.textContent = "Đang đăng nhập…";
    try {
      app.user = await call("login", { email: email.value, password: pass.value });
      app.guest = false;
      await boot();
    } catch (x) {
      err.textContent = String(x);
      submit.disabled = false;
      submit.textContent = "Đăng nhập";
    }
  });
  const guest = h("button", { class: "link focusable", onclick: async () => { app.guest = true; await boot(); } }, "Dùng thử không cần tài khoản");
  view.append(h("div", { class: "login page" }, wall,
    h("div", { class: "login-card" },
      h("div", { class: "brand" }, h("span", { class: "brand-w" }, "WiS"), h("span", { class: "brand-tv" }, "TV")),
      h("p", {}, "Đăng nhập bằng tài khoản Stremio để dùng addon và thư viện của bạn."),
      form, guest)));
  email.focus({ preventScroll: true });
  try {
    const addons = await web.addons();
    const cat = addons[0].manifest.catalogs.find((c) => c.type === "movie" && !(c.extra || []).some((e) => e.isRequired));
    const metas = await web.catalog({ url: addons[0].transportUrl, kind: cat.type, id: cat.id, extra: [] });
    wall.replaceChildren(...metas.concat(metas).slice(0, 64).map((m) => h("img", { src: m.poster, alt: "" })));
  } catch (e) {}
}

function initial() {
  const n = app.user?.fullname || app.user?.email || "W";
  return n.trim()[0].toUpperCase();
}

const ROUTES = {
  login: renderLogin,
  home: (v) => renderBrowse(v, null),
  movie: (v) => renderBrowse(v, "movie"),
  series: (v) => renderBrowse(v, "series"),
  detail: renderDetail,
  library: renderLibrary,
  search: renderSearch,
  settings: renderSettings,
  calendar: renderCalendar,
  addons: renderAddons,
};

const TOP_ROUTES = ["home", "movie", "series", "calendar", "library", "addons", "search", "settings"];

async function seriesMetas(onProgress) {
  const ids = libItems().filter((i) => i.type === "series").map((i) => i._id);
  app.metaCache = app.metaCache || new Map();
  const out = [];
  let next = 0, done = 0;
  const worker = async () => {
    while (next < ids.length) {
      const id = ids[next++];
      let m = app.metaCache.get(id);
      if (!m) {
        try { m = await call("meta", { kind: "series", id }); app.metaCache.set(id, m); } catch (e) { m = null; }
      }
      done++;
      if (m) out.push(m);
      onProgress && onProgress(done, ids.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, ids.length) }, worker));
  return out;
}

const dayKey = (d) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
const WEEKDAYS = ["T2", "T3", "T4", "T5", "T6", "T7", "CN"];

function calEpisode(x, cls = "cal-ep") {
  const el = h("button", { class: `${cls} focusable`, title: `${x.m.name} · ${epName(x.v)}` },
    image(x.m.poster, x.m.name),
    h("div", {}, h("b", {}, x.m.name), h("span", {}, `${epShort(x.v)}${x.v.title || x.v.name ? " · " + (x.v.title || x.v.name) : ""}`)));
  el.addEventListener("click", () => go("detail", { kind: "series", id: x.m.id, video: x.v.id }));
  return el;
}

async function renderCalendar(view, params) {
  document.body.classList.add("dim");
  const now = new Date();
  const year = params.y ?? now.getFullYear();
  const month = params.mo ?? now.getMonth();
  const shift = (d) => { const t = new Date(year, month + d, 1); go("calendar", { y: t.getFullYear(), mo: t.getMonth() }); };
  const head = h("div", { class: "cal-head" },
    h("h1", {}, `Tháng ${month + 1}, ${year}`),
    h("div", { class: "cal-nav" },
      h("button", { class: "pill focusable", html: ICON.left, "aria-label": "Tháng trước", onclick: () => shift(-1) }),
      h("button", { class: "pill focusable", onclick: () => go("calendar", {}) }, "Hôm nay"),
      h("button", { class: "pill focusable", html: ICON.right, "aria-label": "Tháng sau", onclick: () => shift(1) })));
  const body = h("div", {}, h("div", { class: "spinner" }));
  const page = h("div", { class: "page plain cal" }, head, body);
  view.append(page);
  $(".cal-nav .pill:nth-child(2)", page)?.focus({ preventScroll: true });
  if (!app.user) { body.replaceChildren(h("div", { class: "empty" }, "Đăng nhập tài khoản Stremio để xem lịch các phim bộ trong Thư viện.")); return; }
  await refreshLibrary();
  const status = h("p", { class: "hint", style: "text-align:center" });
  body.replaceChildren(h("div", { class: "spinner" }), status);
  const metas = await seriesMetas((d, n) => { status.textContent = `Đang đọc lịch phát ${d}/${n} phim bộ…`; });
  if (!view.contains(page)) return;
  if (!metas.length) { body.replaceChildren(h("div", { class: "empty" }, "Thư viện chưa có phim bộ nào. Thêm phim bộ vào Thư viện để theo dõi lịch phát.")); return; }
  const eps = metas.flatMap((m) => (m.videos || [])
    .filter((v) => v.released && (v.season ?? 0) > 0)
    .map((v) => ({ m, v, d: new Date(v.released) })))
    .filter((x) => !isNaN(x.d))
    .sort((a, b) => a.d - b.d || epSort(a.v, b.v));
  const byDay = new Map();
  for (const x of eps) {
    const k = dayKey(x.d);
    if (!byDay.has(k)) byDay.set(k, []);
    byDay.get(k).push(x);
  }
  const first = new Date(year, month, 1);
  const lead = (first.getDay() + 6) % 7;
  const days = new Date(year, month + 1, 0).getDate();
  const cells = [];
  for (let i = 0; i < lead; i++) cells.push(h("div", { class: "cal-cell blank" }));
  for (let d = 1; d <= days; d++) {
    const date = new Date(year, month, d);
    const list = byDay.get(dayKey(date)) || [];
    const today = dayKey(date) === dayKey(now);
    cells.push(h("div", { class: `cal-cell ${today ? "today" : ""} ${list.length ? "has" : ""}` },
      h("div", { class: "cal-day" }, d),
      list.slice(0, 3).map((x) => calEpisode(x)),
      list.length > 3 ? h("div", { class: "cal-more" }, `+${list.length - 3} tập`) : null));
  }
  while (cells.length % 7) cells.push(h("div", { class: "cal-cell blank" }));
  const grid = h("div", { class: "cal-grid" }, WEEKDAYS.map((w) => h("div", { class: "cal-wd" }, w)), cells);
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const upcoming = eps.filter((x) => x.d >= start).slice(0, 24);
  const recent = eps.filter((x) => x.d < start && start - x.d <= 14 * 86400000).reverse().slice(0, 24);
  const listOf = (title, items) => items.length ? h("section", { class: "cal-list" }, h("h2", { class: "shelf-title" }, title),
    items.map((x) => h("div", { class: "cal-row" }, h("span", { class: "cal-date" }, x.d.toLocaleDateString("vi-VN", { weekday: "short", day: "2-digit", month: "2-digit" })), calEpisode(x, "cal-ep wide")))) : null;
  body.replaceChildren(grid, h("div", { class: "cal-lists" }, listOf("Sắp chiếu", upcoming), listOf("Mới ra trong 2 tuần", recent)));
}

const addonBase = (url) => String(url || "").replace(/\/manifest\.json$/, "").replace(/\/+$/, "");
const TYPE_FILTERS = [["", "Tất cả"], ["movie", "Phim"], ["series", "Phim bộ"], ["anime", "Anime"], ["tv", "Truyền hình"], ["channel", "Kênh"], ["other", "Khác"]];

function addonRow(a, actions) {
  const mf = a.manifest || {};
  const types = (mf.types || []).map((t) => TYPE_LABEL[t] || t).join(" · ");
  const res = (mf.resources || []).map((r) => (typeof r === "string" ? r : r.name)).filter(Boolean);
  const caps = [res.includes("stream") ? "Nguồn phát" : "", res.includes("catalog") || (mf.catalogs || []).length ? "Danh mục" : "", res.includes("subtitles") ? "Phụ đề" : ""].filter(Boolean).join(" · ");
  const ph = h("div", { class: "ph" });
  const letter = () => { ph.textContent = (mf.name || "?")[0]; };
  if (mf.logo) ph.append(image(mf.logo, "", letter)); else letter();
  return h("div", { class: "addon" },
    ph,
    h("div", { class: "addon-text" },
      h("b", {}, mf.name || a.transportUrl, mf.version ? h("span", { class: "ver" }, ` v${mf.version}`) : null),
      mf.description ? h("p", {}, mf.description) : null,
      types || caps ? h("small", {}, [types, caps].filter(Boolean).join("  ·  ")) : null),
    h("div", { class: "addon-actions" }, actions));
}

async function renderAddons(view) {
  document.body.classList.add("dim");
  const busy = async (btn, fn) => {
    if (btn.disabled) return;
    btn.disabled = true;
    try { await fn(); } catch (e) { toast(e, true); } finally { if (btn.isConnected) btn.disabled = false; }
  };
  const configure = (url) => call("open_url", { url: `${addonBase(url)}/configure` }).catch((e) => toast(e, true));
  const installedPanel = h("div", { class: "panel wide-panel" });
  const discoverList = h("div", { class: "addon-list" }, h("div", { class: "spinner" }));
  const input = h("input", { class: "field", placeholder: "Dán link addon: https://…/manifest.json hoặc stremio://…", spellcheck: "false" });
  const installBtn = h("button", { class: "btn primary focusable" }, "Cài addon");
  const install = (url, btn) => busy(btn, async () => {
    app.addons = await call("addon_install", { url });
    const added = app.addons.find((a) => a.transportUrl === url.trim().replace(/^stremio:\/\//, "https://"));
    toast(`Đã cài ${added?.manifest?.name || "addon"}`);
    input.value = "";
    drawInstalled();
    drawDiscover();
  });
  installBtn.addEventListener("click", () => input.value.trim() && install(input.value, installBtn));
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && input.value.trim()) install(input.value, installBtn); });
  const installPanel = h("div", { class: "panel wide-panel" }, h("h3", {}, "Cài từ đường link"),
    h("div", { class: "install-row" }, input, installBtn),
    h("p", { class: "hint" }, "Lấy link từ trang cấu hình của addon (ví dụ Torrentio: bấm Cấu hình, chọn xong thì sao chép link manifest) hoặc cài thẳng từ mục Khám phá bên dưới. Danh sách addon đồng bộ với tài khoản Stremio, nên Stremio trên các máy khác cũng thấy."));

  const drawInstalled = () => {
    const n = app.addons.length;
    installedPanel.replaceChildren(h("h3", {}, `Đã cài (${n})`),
      h("p", { class: "hint", style: "margin:-4px 0 6px" }, "Addon ở trên được hỏi nguồn phát trước. Dùng nút mũi tên để đổi thứ tự."),
      ...app.addons.map((a, i) => {
        const prot = a.flags?.protected === true;
        const mf = a.manifest || {};
        const acts = [];
        const up = h("button", { class: "pl-mini focusable", html: ICON.up, title: "Lên trên", disabled: i === 0 || null });
        const down = h("button", { class: "pl-mini focusable", html: ICON.down, title: "Xuống dưới", disabled: i === n - 1 || null });
        up.addEventListener("click", () => busy(up, async () => { app.addons = await call("addon_move", { url: a.transportUrl, delta: -1 }); drawInstalled(); }));
        down.addEventListener("click", () => busy(down, async () => { app.addons = await call("addon_move", { url: a.transportUrl, delta: 1 }); drawInstalled(); }));
        acts.push(up, down);
        if (mf.behaviorHints?.configurable) acts.push(h("button", { class: "pl-mini focusable", html: ICON.cog, title: "Cấu hình", onclick: () => configure(a.transportUrl) }));
        if (prot) acts.push(h("span", { class: "tag" }, "Mặc định"));
        else {
          const rm = h("button", { class: "pill focusable danger" }, "Gỡ");
          let armed = null;
          rm.addEventListener("click", () => {
            if (!armed) {
              rm.textContent = "Bấm lần nữa để gỡ";
              armed = setTimeout(() => { armed = null; if (rm.isConnected) rm.textContent = "Gỡ"; }, 3500);
              return;
            }
            clearTimeout(armed);
            busy(rm, async () => {
              app.addons = await call("addon_remove", { url: a.transportUrl });
              toast(`Đã gỡ ${mf.name || "addon"}`);
              drawInstalled();
              drawDiscover();
            });
          });
          acts.push(rm);
        }
        return addonRow(a, acts);
      }),
      h("div", { style: "margin-top:14px" },
        h("button", { class: "btn focusable", onclick: (e) => busy(e.currentTarget, async () => { app.addons = await call("addons", { refresh: true }); drawInstalled(); drawDiscover(); toast("Đã đồng bộ với Stremio"); }) }, "Đồng bộ lại")));
  };

  let filter = "", term = "";
  const pills = h("div", { class: "seasons" });
  const search = h("input", { class: "field", placeholder: "Tìm addon…", spellcheck: "false", style: "max-width:320px;margin:0" });
  search.addEventListener("input", () => { term = search.value.trim().toLowerCase(); drawDiscover(); });
  const drawPills = () => pills.replaceChildren(...TYPE_FILTERS.map(([k, label]) => h("button", { class: `pill focusable ${filter === k ? "on" : ""}`, onclick: () => { filter = k; drawPills(); drawDiscover(); } }, label)));
  drawPills();
  const discoverPanel = h("div", { class: "panel wide-panel" }, h("h3", {}, "Khám phá"),
    h("div", { class: "discover-tools" }, pills, search), discoverList);

  const drawDiscover = () => {
    if (!app.discover) return;
    const have = new Set(app.addons.map((a) => a.transportUrl));
    const haveIds = new Set(app.addons.map((a) => a.manifest?.id));
    const known = new Set(TYPE_FILTERS.map(([k]) => k).filter((k) => k && k !== "other"));
    const items = app.discover.filter((a) => {
      const mf = a.manifest || {};
      const types = mf.types || [];
      if (filter === "other" ? types.some((t) => known.has(t)) : filter && !types.includes(filter)) return false;
      if (term && !`${mf.name} ${mf.description}`.toLowerCase().includes(term)) return false;
      return true;
    });
    discoverList.replaceChildren(...items.slice(0, 150).map((a) => {
      const mf = a.manifest || {};
      const acts = [];
      const installed = have.has(a.transportUrl) || haveIds.has(mf.id);
      const needsConfig = mf.behaviorHints?.configurationRequired;
      if (mf.behaviorHints?.configurable || needsConfig) acts.push(h("button", { class: "pill focusable", onclick: () => configure(a.transportUrl) }, "Cấu hình"));
      if (installed) acts.push(h("span", { class: "tag on" }, "Đã cài"));
      else if (!needsConfig) {
        const b = h("button", { class: "pill focusable on" }, "Cài");
        b.addEventListener("click", () => install(a.transportUrl, b));
        acts.push(b);
      }
      return addonRow(a, acts);
    }));
    if (!items.length) discoverList.replaceChildren(h("div", { class: "empty" }, "Không có addon nào khớp."));
  };

  view.append(h("div", { class: "page plain" }, h("h1", {}, "Addon"), installPanel, installedPanel, discoverPanel));
  drawInstalled();
  input.focus({ preventScroll: true });
  if (!app.discover) {
    try { app.discover = await call("addon_discover"); }
    catch (e) { discoverList.replaceChildren(h("div", { class: "empty" }, `Không tải được danh sách addon: ${e}`)); return; }
  }
  drawDiscover();
}

function render() {
  const { route, params } = app.stack[app.stack.length - 1];
  clearInterval(app.heroTimer);
  clearTimeout(app.previewTimer);
  if (!$("#sheet").hidden) closeSheet();
  const view = $("#view");
  view.replaceChildren();
  view.scrollTop = 0;
  $("#topbar").hidden = route === "login";
  $$("[data-route]", $("#topbar")).forEach((b) => b.classList.toggle("active", b.dataset.route === route));
  ROUTES[route](view, params || {});
  if (!TOP_ROUTES.includes(route)) $$(".tab").forEach((t) => t.classList.remove("active"));
  const canBack = app.stack.length > 1;
  $("#back-btn").hidden = !canBack;
  $("#topbar").classList.toggle("can-back", canBack);
  navSync();
}

function go(route, params = {}, replace = false) {
  if (TOP_ROUTES.includes(route) || route === "login") app.stack = [];
  else if (replace) app.stack.pop();
  app.stack.push({ route, params });
  render();
}

const nav = { depth: 0, skip: false, queued: false };
const navLayers = () => Math.max(0, app.stack.length - 1) + ($("#sheet").hidden ? 0 : 1) + (pl.open ? 1 : 0);

function navSync() {
  if (TAURI || nav.queued) return;
  nav.queued = true;
  queueMicrotask(() => {
    nav.queued = false;
    if (nav.skip) return;
    const want = navLayers();
    while (nav.depth < want) history.pushState({ wistvDepth: ++nav.depth }, "");
    if (want < nav.depth) {
      const n = nav.depth - want;
      nav.depth = want;
      nav.skip = true;
      history.go(-n);
    }
  });
}

if (!TAURI) {
  window.addEventListener("popstate", (e) => {
    const depth = e.state?.wistvDepth || 0;
    nav.depth = depth;
    if (nav.skip) { nav.skip = false; navSync(); return; }
    while (navLayers() > depth) if (!stepBack()) break;
    navSync();
  });
}

function stepBack() {
  if (pl.open) { closePlayer(); return true; }
  if (!$("#sheet").hidden) { closeSheet(); return true; }
  if (app.stack.length > 1) { app.stack.pop(); render(); return true; }
  const cur = app.stack[0]?.route;
  if (cur && cur !== "home" && cur !== "login") { go("home"); return true; }
  return false;
}

function back() {
  if (!TAURI && nav.depth > 0 && navLayers() > 0) { history.back(); return; }
  stepBack();
}

window.__wistvBack = () => stepBack();

if (TAURI) document.addEventListener("visibilitychange", async () => {
  if (document.hidden || pl.open) return;
  const route = app.stack[app.stack.length - 1]?.route;
  if (await syncAddons(120000) && (route === "home" || route === "movie" || route === "series")) render();
});

if (TAURI && TOUCH && !ANDROID) document.addEventListener("visibilitychange", () => {
  if (!pl.open) return;
  if (document.hidden) { pl.bgVideo = true; call("player_background", { hidden: true }).catch(() => {}); }
  else if (pl.bgVideo) { pl.bgVideo = false; call("player_background", { hidden: false }).catch(() => {}); }
});

if (TAURI) listen("update-state", (e) => { if (e.payload?.version) toast(`Đang cập nhật WiS TV lên bản ${e.payload.version}…`); });

function visible(el) {
  if (el.disabled || el.offsetParent === null) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0;
}

function moveFocus(dir) {
  const scope = !$("#sheet").hidden ? $("#sheet") : document;
  const items = $$(".focusable", scope).filter(visible);
  const cur = document.activeElement;
  if (!cur || !items.includes(cur)) { items[0]?.focus(); return; }
  const a = cur.getBoundingClientRect();
  const acx = a.left + a.width / 2, acy = a.top + a.height / 2;
  const sameRow = cur.closest(".row");
  let best = null, bestScore = Infinity;
  for (const el of items) {
    if (el === cur) continue;
    const b = el.getBoundingClientRect();
    const bcx = b.left + b.width / 2, bcy = b.top + b.height / 2;
    let primary, secondary;
    if (dir === "r") { if (bcx <= acx + 2) continue; primary = b.left - a.right; secondary = Math.abs(bcy - acy); }
    else if (dir === "l") { if (bcx >= acx - 2) continue; primary = a.left - b.right; secondary = Math.abs(bcy - acy); }
    else if (dir === "d") { if (bcy <= acy + 2) continue; primary = b.top - a.bottom; secondary = Math.abs(bcx - acx); }
    else { if (bcy >= acy - 2) continue; primary = a.top - b.bottom; secondary = Math.abs(bcx - acx); }
    let score = Math.max(primary, 0) + secondary * ((dir === "l" || dir === "r") ? 3 : 0.6);
    if ((dir === "l" || dir === "r") && sameRow && el.closest(".row") === sameRow) score -= 10000;
    if (score < bestScore) { bestScore = score; best = el; }
  }
  if (!best) return;
  best.focus({ preventScroll: true });
  const row = best.closest(".row");
  if (row) {
    const rr = row.getBoundingClientRect(), br = best.getBoundingClientRect();
    const pad = 60;
    if (br.left < rr.left + pad) row.scrollBy({ left: br.left - rr.left - pad });
    else if (br.right > rr.right - pad) row.scrollBy({ left: br.right - rr.right + pad });
  }
  if (dir === "u" || dir === "d") {
    const view = $("#view");
    const target = best.closest(".shelf") || best;
    if (best.closest(".hero, .detail-top")) view.scrollTo({ top: 0 });
    else if (!best.closest("#sheet, #topbar")) target.scrollIntoView({ block: "center" });
  } else if (!row) best.scrollIntoView({ block: "nearest", inline: "nearest" });
}

document.addEventListener("keydown", (e) => {
  if (pl.open) { playerKey(e); return; }
  const inInput = e.target instanceof HTMLInputElement;
  const dirs = { ArrowLeft: "l", ArrowRight: "r", ArrowUp: "u", ArrowDown: "d" };
  if (dirs[e.key]) {
    if (inInput && (e.key === "ArrowLeft" || e.key === "ArrowRight")) return;
    e.preventDefault();
    if (inInput) e.target.blur();
    moveFocus(dirs[e.key]);
  } else if (e.key === "Escape" || (e.key === "Backspace" && !inInput)) {
    e.preventDefault();
    if (inInput && e.key === "Escape") e.target.blur();
    back();
  } else if (e.key === "/" && !inInput) {
    e.preventDefault();
    go("search");
  }
});

$("#scrim").addEventListener("click", () => back());
$("#back-btn").addEventListener("click", () => back());
$$("[data-route]", $("#topbar")).forEach((b) => b.addEventListener("click", () => go(b.dataset.route)));
$("#view").addEventListener("scroll", () => $("#topbar").classList.toggle("solid", $("#view").scrollTop > 40), { passive: true });
document.addEventListener("mouseup", (e) => { if (e.button === 3) back(); });

(() => {
  let d = null;
  let suppressUntil = 0;
  const glide = (row, v) => {
    v = Math.max(-3, Math.min(3, v));
    const step = () => {
      if (Math.abs(v) < 0.03 || !row.isConnected) { row.classList.remove("dragging"); return; }
      row.scrollLeft += v * 16;
      v *= 0.93;
      row._glide = requestAnimationFrame(step);
    };
    step();
  };
  document.addEventListener("pointerdown", (e) => {
    if (e.pointerType !== "mouse" || e.button !== 0) return;
    const row = e.target.closest(".row");
    if (!row || row.scrollWidth <= row.clientWidth + 2) return;
    cancelAnimationFrame(row._glide);
    row.classList.remove("dragging");
    d = { row, id: e.pointerId, x: e.clientX, left: row.scrollLeft, lastX: e.clientX, lastT: performance.now(), v: 0, moved: false };
  });
  document.addEventListener("pointermove", (e) => {
    if (!d || e.pointerId !== d.id) return;
    const dx = e.clientX - d.x;
    if (!d.moved) {
      if (Math.abs(dx) < 6) return;
      d.moved = true;
      d.row.classList.add("dragging");
      try { d.row.setPointerCapture(e.pointerId); } catch (err) {}
    }
    const t = performance.now();
    const dt = t - d.lastT;
    if (dt >= 8) {
      d.v = 0.7 * ((d.lastX - e.clientX) / dt) + 0.3 * d.v;
      d.lastX = e.clientX;
      d.lastT = t;
    }
    d.row.scrollLeft = d.left - dx;
    e.preventDefault();
  });
  const end = (e) => {
    if (!d || e.pointerId !== d.id) return;
    const { row, moved } = d;
    const v = performance.now() - d.lastT > 80 ? 0 : d.v;
    d = null;
    if (!moved) return;
    suppressUntil = performance.now() + 120;
    glide(row, v);
  };
  document.addEventListener("pointerup", end);
  document.addEventListener("pointercancel", end);
  document.addEventListener("click", (e) => {
    if (performance.now() < suppressUntil) { e.preventDefault(); e.stopPropagation(); suppressUntil = 0; }
  }, true);
  document.addEventListener("dragstart", (e) => { if (e.target.closest?.(".row")) e.preventDefault(); });
})();

{
  listen("player-state", ({ payload }) => onPlayerState(payload));
  listen("player-fullscreen", ({ payload }) => {
    pl.fs = !!payload?.on;
    if (pl.ui) pl.ui.fs.innerHTML = pl.fs ? ICON.unfull : ICON.full;
    if (pl.open) wake();
  });
  listen("player-ended", ({ payload }) => {
    if (!pl.open || payload.session !== pl.session) return;
    if (payload.error) toast(`Trình phát: ${payload.error}`, true);
    if (payload.ended && nextEpisode()) { playNext(true); return; }
    closePlayer(false);
  });
  listen("library-changed", async ({ payload }) => {
    if (payload && payload.error) toast(`Không lưu được tiến độ: ${payload.error}`, true);
    if (payload && payload.quiet) return;
    await refreshLibrary();
    const cur = app.stack[app.stack.length - 1];
    if (cur && !pl.open && $("#sheet").hidden && (cur.route === "home" || cur.route === "detail" || cur.route === "library")) {
      const scroll = $("#view").scrollTop;
      render();
      if (cur.route === "detail") requestAnimationFrame(() => { $("#view").scrollTop = scroll; });
    }
  });
}

async function startupOpen() {
  let url = null;
  try { url = await call("startup_open"); } catch (e) { url = null; }
  if (!url) return;
  startPlayback({ id: "local:open", type: "movie", name: "Kiểm tra trình phát" }, "local:open", "", { url }, 0);
}

const homeSig = () => JSON.stringify([
  app.addons.map((a) => a.transportUrl),
  continueItems().slice(0, 20).map((i) => [i._id, i.state?.video_id, Math.round((i.state?.timeOffset || 0) / 60000)]),
]);

async function boot() {
  const hit = cacheGet(bootKey());
  const fresh = Promise.allSettled([call("addons"), call("library")]);
  const apply = ([addons, library]) => {
    if (addons.status === "fulfilled") { app.addons = addons.value; addonsAt = Date.now(); }
    else { app.addons = app.addons || []; toast(`Không tải được addon: ${addons.reason}`, true); }
    if (library.status === "fulfilled") app.library = library.value;
    else app.library = app.library || [];
    if (addons.status === "fulfilled") saveBoot();
  };
  $("#avatar").textContent = initial();
  if (hit && Array.isArray(hit.v?.addons) && hit.v.addons.length) {
    app.addons = hit.v.addons;
    app.library = Array.isArray(hit.v.library) ? hit.v.library : [];
    go("home");
    const before = homeSig();
    apply(await fresh);
    const cur = app.stack[app.stack.length - 1];
    if (homeSig() !== before && cur?.route === "home" && !pl.open && $("#sheet").hidden && $("#view").scrollTop < 40) render();
    return;
  }
  app.addons = [];
  app.library = [];
  apply(await fresh);
  go("home");
}

(async () => {
  try { app.user = await call("session"); } catch (e) { app.user = null; }
  if (app.user) await boot();
  else go("login");
  startupOpen();
})();
