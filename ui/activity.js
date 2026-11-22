export const ACTIVITY = /\.discordsays\.com$/i.test(location.hostname);
export const DISCORD_CLIENT_ID = document.querySelector('meta[name="wistv-discord-client"]')?.content || "";

const WIS = "/.proxy/wis";
const RD = /^([a-z0-9-]+)\.download\.real-debrid\.com$/i;

const pack = (text) => {
  let bin = "";
  for (const b of new TextEncoder().encode(text)) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

export function proxify(raw, media = false) {
  if (!ACTIVITY || raw == null) return raw;
  const text = String(raw);
  if (!/^(https?|wss?):/i.test(text) && !text.startsWith("//")) return raw;
  let u;
  try { u = new URL(text, location.href); } catch (e) { return raw; }
  if (u.host === location.host) return raw;
  if (u.host === "film.wis237.online") {
    const path = `${WIS}${u.pathname}${u.search}`;
    return /^wss?:$/.test(u.protocol) ? `wss://${location.host}${path}` : path;
  }
  const rd = RD.exec(u.host);
  if (rd) return `/.proxy/rd/${rd[1]}${u.pathname}${u.search}`;
  if (!/^https?:$/.test(u.protocol)) return raw;
  return `${WIS}/api/fetch?b=${pack(u.href)}${media ? "&media=1" : ""}`;
}

function patchProp(proto, name, media = false) {
  const d = proto && Object.getOwnPropertyDescriptor(proto, name);
  if (!d || !d.set) return;
  Object.defineProperty(proto, name, { ...d, set(v) { d.set.call(this, proxify(v, media)); } });
}

if (ACTIVITY) {
  for (const [name, path] of [["wistv-room-api", "/api/room/"], ["wistv-profile-api", "/api/profile/"], ["wistv-relay-api", "/api/relay"]]) {
    let m = document.querySelector(`meta[name="${name}"]`);
    if (!m) {
      m = document.createElement("meta");
      m.name = name;
      document.head.append(m);
    }
    m.content = `${WIS}${path}`;
  }
  document.documentElement.classList.add("activity");

  const realFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    if (typeof input === "string" || input instanceof URL) return realFetch(proxify(String(input)), init);
    if (input instanceof Request) {
      const to = proxify(input.url);
      return realFetch(to === input.url ? input : new Request(to, input), init);
    }
    return realFetch(input, init);
  };

  const open = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    return open.call(this, method, proxify(url), ...rest);
  };

  const RealSocket = window.WebSocket;
  const Socket = function (url, protocols) {
    return protocols === undefined ? new RealSocket(proxify(url)) : new RealSocket(proxify(url), protocols);
  };
  Socket.prototype = RealSocket.prototype;
  for (const k of ["CONNECTING", "OPEN", "CLOSING", "CLOSED"]) Socket[k] = RealSocket[k];
  window.WebSocket = Socket;

  patchProp(HTMLImageElement.prototype, "src");
  patchProp(HTMLMediaElement.prototype, "src", true);
  patchProp(HTMLScriptElement.prototype, "src");
  patchProp(HTMLSourceElement.prototype, "src", true);
  patchProp(HTMLTrackElement.prototype, "src");

  const setAttr = Element.prototype.setAttribute;
  Element.prototype.setAttribute = function (name, value) {
    return setAttr.call(this, name, String(name).toLowerCase() === "src" ? proxify(value, this instanceof HTMLMediaElement || this instanceof HTMLSourceElement) : value);
  };

  const fixStyle = (el) => {
    const s = el.getAttribute?.("style");
    if (!s || !/url\(/i.test(s)) return;
    const t = s.replace(/url\((["']?)([^"')]+)\1\)/gi, (m, q, u) => `url("${proxify(u)}")`);
    if (t !== s) setAttr.call(el, "style", t);
  };
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "attributes") fixStyle(m.target);
      else for (const n of m.addedNodes) if (n.nodeType === 1) { fixStyle(n); n.querySelectorAll("[style]").forEach(fixStyle); }
    }
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["style"], childList: true, subtree: true });

  if (DISCORD_CLIENT_ID) {
    import("./discord-sdk.js")
      .then(({ DiscordSDK }) => {
        const sdk = new DiscordSDK(DISCORD_CLIENT_ID);
        window.__discord = sdk;
        return sdk.ready();
      })
      .catch(() => {});
  }
}
