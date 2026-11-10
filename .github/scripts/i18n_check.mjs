import { readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ui = join(root, "ui");
const { DICTS } = await import(pathToFileURL(join(ui, "i18n.js")).href);

const problems = [];
const base = DICTS.vi;
const forms = (v) => (v && typeof v === "object" ? Object.entries(v) : [["", v]]);
const holes = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");

for (const [lang, dict] of Object.entries(DICTS)) {
  for (const [key, value] of Object.entries(dict)) {
    if (!(key in base)) problems.push(`${lang}: "${key}" is not in vi`);
    if (value && typeof value === "object" && !("other" in value)) problems.push(`${lang}: "${key}" plural has no "other" form`);
    for (const [form, text] of forms(value)) {
      if (typeof text !== "string" || !text) problems.push(`${lang}: "${key}"${form ? `.${form}` : ""} is empty`);
    }
  }
  if (lang === "vi") continue;
  for (const [key, value] of Object.entries(base)) {
    if (!(key in dict)) { problems.push(`${lang}: missing "${key}"`); continue; }
    const want = holes(forms(value)[0][1]);
    for (const [form, text] of forms(dict[key])) {
      if (holes(text) !== want) problems.push(`${lang}: "${key}"${form ? `.${form}` : ""} has {${holes(text)}}, vi has {${want}}`);
    }
  }
}

const sources = ["app.js", "web.js", "index.html"].map((f) => [f, readFileSync(join(ui, f), "utf8")]);
for (const [file, text] of sources) {
  for (const m of text.matchAll(/(?<![\w$.])tr\("([\w.]+)"/g)) if (!(m[1] in base)) problems.push(`${file}: tr("${m[1]}") has no vi entry`);
  for (const m of text.matchAll(/(?<![\w$.])tr\(`([\w.]+)\$\{/g)) if (!Object.keys(base).some((k) => k.startsWith(m[1]))) problems.push(`${file}: no vi entry starts with "${m[1]}"`);
  for (const m of text.matchAll(/data-i18n(?:-aria)?="([\w.]+)"/g)) if (!(m[1] in base)) problems.push(`${file}: data-i18n "${m[1]}" has no vi entry`);
}

const VI = "àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ";
const viChar = new RegExp(`[${VI}${VI.toUpperCase()}]`);
const literal = /"(?:[^"\\\n]|\\.)*"|'(?:[^'\\\n]|\\.)*'|`(?:[^`\\]|\\.)*`/g;
const left = sources.filter(([f]) => f.endsWith(".js")).map(([f, text]) => [f, [...text.matchAll(literal)].filter((m) => viChar.test(m[0])).length]);
console.log(`keys: ${Object.keys(base).length} · Vietnamese literals not yet moved: ${left.map(([f, n]) => `${f} ${n}`).join(", ")}`);

if (problems.length) {
  for (const p of problems) console.log(`FAIL ${p}`);
  process.exit(1);
}
console.log("i18n ok");
