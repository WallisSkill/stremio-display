const TAURI = window.__TAURI__;
const CINEMETA = "https://v3-cinemeta.strem.io/manifest.json";

const web = {
  _addons: null,
  async session() { return null; },
  async login() { throw "Đăng nhập chỉ có trong ứng dụng WiS TV"; },
  async logout() {},
  async addons() {
    if (!this._addons) {
      const manifest = await (await fetch(CINEMETA)).json();
      this._addons = [{ transportUrl: CINEMETA, manifest }];
    }
    return this._addons;
  },
  async catalog({ url, kind, id, extra }) {
    const base = url.replace(/\/manifest\.json$/, "");
    const ex = extra && extra.length ? "/" + extra.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&") : "";
    const r = await (await fetch(`${base}/catalog/${encodeURIComponent(kind)}/${encodeURIComponent(id)}${ex}.json`)).json();
    return r.metas || [];
  },
  async meta({ kind, id }) {
    const r = await (await fetch(`https://v3-cinemeta.strem.io/meta/${kind}/${id}.json`)).json();
    if (!r.meta) throw "Không tìm thấy thông tin phim";
    return r.meta;
  },
  async streams() { return []; },
  async library() { return []; },
  async library_toggle() { throw "Thư viện chỉ có trong ứng dụng WiS TV"; },
  async play() { throw "Phát phim chỉ có trong ứng dụng WiS TV"; },
};

const call = (cmd, args = {}) => (TAURI ? TAURI.core.invoke(cmd, args) : web[cmd](args));

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

const bd = { front: "a", url: null };
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

async function refreshLibrary() {
  try { app.library = await call("library"); } catch (e) { app.library = []; }
}

function card(m, shape = "poster", opts = {}) {
  const art = h("div", { class: "art" });
  const fallback = h("div", { class: "fallback" }, m.name);
  const src = shape === "wide" ? bgOf(m) : m.poster;
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
  setBackdrop(bgOf(m));
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
      if (!featured.length || !document.hasFocus()) return;
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
    info.append(h("h1", { class: "title-text" }, "Chưa có danh mục"), h("p", { class: "desc" }, "Cài thêm addon trong Stremio, WiS TV sẽ tự đồng bộ."));
  }
  cats.forEach(({ addon, cat }, i) => {
    const shape = i === 0 ? "wide" : "poster";
    const title = cat.name || cat.id;
    const sub = `${TYPE_LABEL[cat.type] || cat.type} · ${addon.manifest.name}`;
    shelves.append(shelf(title, sub, shape, () => call("catalog", { url: addon.transportUrl, kind: cat.type, id: cat.id, extra: [] }), {
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
  setBackdrop(bgOf(m));

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
  if (autoplay) openStreams(m, target.vid, target.label);
}

const epSort = (a, b) => (a.season ?? 0) - (b.season ?? 0) || (a.episode ?? a.number ?? 0) - (b.episode ?? b.number ?? 0);
const epShort = (v) => `M${v.season ?? 0}:T${v.episode ?? v.number ?? "?"}`;
const epName = (v) => `${epShort(v)} · ${v.title || v.name || "Tập " + (v.episode ?? "")}`;

function episodeCard(m, v, entry) {
  const thumb = v.thumbnail || bgOf(m);
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

  let groups;
  try { groups = await call("streams", { kind: m.type, id: vid }); }
  catch (e) { body.replaceChildren(h("div", { class: "empty" }, String(e))); return; }
  if (sheet.hidden) return;
  if (!groups.length) {
    body.replaceChildren(h("div", { class: "empty" }, TAURI ? "Không addon nào trả về nguồn cho mục này.\nHãy cài addon nguồn phát trong Stremio." : "Mở bằng ứng dụng WiS TV để xem nguồn phát."));
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
      btn.addEventListener("click", () => startPlayback(m, vid, label, s, resume ? resumeMs : 0));
      body.append(btn);
    }
  }
  $(".stream", body)?.focus({ preventScroll: true });
}

async function startPlayback(m, vid, label, stream, start) {
  toast(stream.infoHash ? "Đang kết nối torrent…" : "Đang mở trình phát…");
  try {
    await call("play", {
      stream,
      ctx: { id: m.id, kind: m.type, name: m.type === "series" && label ? `${m.name} · ${label}` : m.name, poster: m.poster || null, video: vid, start: Math.floor(start || 0) },
    });
    closeSheet();
  } catch (e) { toast(e, true); }
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
    if (term.length < 2) { results.replaceChildren(h("div", { class: "empty" }, "Nhập ít nhất 2 ký tự để tìm.")); return; }
    const cats = catalogsOf(null, { search: true });
    if (!cats.length) { results.replaceChildren(h("div", { class: "empty" }, "Không addon nào hỗ trợ tìm kiếm.")); return; }
    results.replaceChildren(...cats.map(({ addon, cat }) =>
      shelf(`${TYPE_LABEL[cat.type] || cat.type}`, `${cat.name || cat.id} · ${addon.manifest.name}`, "poster",
        async () => (mine === token ? call("catalog", { url: addon.transportUrl, kind: cat.type, id: cat.id, extra: [["search", term]] }) : []),
        { eager: true })));
  };
  input.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(run, 450); });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { clearTimeout(timer); run(); } });
  run();
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
        ? h("button", { class: "btn focusable", onclick: async () => { await call("logout"); app.user = null; app.library = []; app.addons = []; go("login", {}, true); } }, "Đăng xuất")
        : h("button", { class: "btn primary focusable", onclick: () => go("login", {}, true) }, "Đăng nhập")));
  const list = h("div", { class: "panel" }, h("h3", {}, `Addon (${app.addons.length})`),
    app.addons.map((a) => {
      const mf = a.manifest || {};
      return h("div", { class: "addon" },
        mf.logo ? h("img", { src: mf.logo, alt: "" }) : h("div", { class: "ph" }, (mf.name || "?")[0]),
        h("div", {}, h("b", {}, mf.name || a.transportUrl), mf.description ? h("p", {}, mf.description) : null),
        h("span", { class: "ver" }, mf.version ? `v${mf.version}` : ""));
    }),
    h("div", { style: "margin-top:14px;display:flex;gap:12px;align-items:center;flex-wrap:wrap" },
      h("button", { class: "btn focusable", onclick: async () => { try { app.addons = await call("addons", { refresh: true }); toast("Đã đồng bộ addon"); go("settings", {}, true); } catch (e) { toast(e, true); } } }, "Đồng bộ lại"),
      h("span", { class: "hint" }, "Cài hoặc gỡ addon trong Stremio như bình thường, WiS TV dùng đúng danh sách đó.")));
  const help = h("div", { class: "panel" }, h("h3", {}, "Điều khiển"),
    h("div", { class: "hint" },
      "Mũi tên để di chuyển, Enter để chọn, Esc hoặc Backspace để quay lại.", h("br"),
      "Trong trình phát: Space dừng/tiếp, ← → tua 5 giây, ↑ ↓ tua 1 phút, F toàn màn hình, J đổi phụ đề, # đổi âm thanh, Q thoát."));
  view.append(h("div", { class: "page plain" }, h("h1", {}, "Cài đặt"), account, list, help));
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
};

function render() {
  const { route, params } = app.stack[app.stack.length - 1];
  clearInterval(app.heroTimer);
  clearTimeout(app.previewTimer);
  if (!$("#sheet").hidden) closeSheet();
  const view = $("#view");
  view.replaceChildren();
  view.scrollTop = 0;
  const top = ["home", "movie", "series", "library", "search", "settings"];
  $("#topbar").hidden = route === "login";
  $$("[data-route]", $("#topbar")).forEach((b) => b.classList.toggle("active", b.dataset.route === route));
  ROUTES[route](view, params || {});
  if (!top.includes(route)) $$(".tab").forEach((t) => t.classList.remove("active"));
}

function go(route, params = {}, replace = false) {
  const tops = ["home", "movie", "series", "library", "search", "settings", "login"];
  if (tops.includes(route)) app.stack = [];
  else if (replace) app.stack.pop();
  app.stack.push({ route, params });
  render();
}

function back() {
  if (!$("#sheet").hidden) { closeSheet(); return; }
  if (app.stack.length > 1) { app.stack.pop(); render(); return; }
  const cur = app.stack[0]?.route;
  if (cur && cur !== "home" && cur !== "login") go("home");
}

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

$("#scrim").addEventListener("click", closeSheet);
$$("[data-route]", $("#topbar")).forEach((b) => b.addEventListener("click", () => go(b.dataset.route)));
$("#view").addEventListener("scroll", () => $("#topbar").classList.toggle("solid", $("#view").scrollTop > 40), { passive: true });
document.addEventListener("mouseup", (e) => { if (e.button === 3) back(); });

if (TAURI) {
  TAURI.event.listen("player-ended", ({ payload }) => {
    if (payload.error) toast(`Trình phát: ${payload.error}`, true);
  });
  TAURI.event.listen("library-changed", async ({ payload }) => {
    if (payload && payload.error) toast(`Không lưu được tiến độ: ${payload.error}`, true);
    await refreshLibrary();
    const cur = app.stack[app.stack.length - 1];
    if (cur && cur.route === "home") render();
  });
}

async function boot() {
  try {
    app.addons = await call("addons");
  } catch (e) {
    app.addons = [];
    toast(`Không tải được addon: ${e}`, true);
  }
  await refreshLibrary();
  $("#avatar").textContent = initial();
  go("home");
}

(async () => {
  try { app.user = await call("session"); } catch (e) { app.user = null; }
  if (app.user) await boot();
  else go("login");
})();
