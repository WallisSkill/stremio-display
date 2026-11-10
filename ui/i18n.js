import vi from "./locales/vi.js";
import en from "./locales/en.js";
import zh from "./locales/zh.js";

export const DICTS = { vi, en, zh };
export const LANGS = [["vi", "Tiếng Việt"], ["en", "English"], ["zh", "中文"]];
const LOCALES = { vi: "vi-VN", en: "en-US", zh: "zh-CN" };
const HTML_LANG = { vi: "vi", en: "en", zh: "zh-Hans" };
const STORE = "wistv.lang";

let lang = "vi";
const plurals = {};

export const getLang = () => lang;
export const locale = () => LOCALES[lang];

export function savedLang() {
  try {
    const v = localStorage.getItem(STORE);
    return DICTS[v] ? v : "vi";
  } catch (e) {
    return "vi";
  }
}

export function setLang(next, root = document) {
  const v = DICTS[next] ? next : "vi";
  const changed = v !== lang;
  lang = v;
  try { localStorage.setItem(STORE, v); } catch (e) {}
  document.documentElement.lang = HTML_LANG[v];
  translateDom(root);
  return changed;
}

function pick(entry, params) {
  if (entry && typeof entry === "object") {
    const n = Number(params?.n);
    plurals[lang] ??= new Intl.PluralRules(LOCALES[lang]);
    return entry[plurals[lang].select(Number.isFinite(n) ? n : 0)] ?? entry.other;
  }
  return entry;
}

export function t(key, params) {
  let s = pick(DICTS[lang][key], params);
  if (s == null) s = pick(DICTS.vi[key], params);
  if (s == null) return key;
  return params ? s.replace(/\{(\w+)\}/g, (m, k) => (params[k] == null ? m : String(params[k]))) : s;
}

export const formatDate = (d, opts) => d.toLocaleDateString(LOCALES[lang], opts);

export function translateDom(root = document) {
  for (const el of root.querySelectorAll("[data-i18n]")) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll("[data-i18n-aria]")) el.setAttribute("aria-label", t(el.dataset.i18nAria));
}
