import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { join, relative, extname, sep } from "node:path";

const [dir, stamp, api, out] = process.argv.slice(2);
const v = Number(stamp);
const level = Number(api);
if (!dir || !out || !Number.isSafeInteger(v) || v <= 0 || !Number.isSafeInteger(level) || level <= 0) {
  console.error("usage: ui_bundle.mjs <ui dir> <unix time> <api level> <out file>");
  process.exit(2);
}

const TEXT = new Set([".html", ".js", ".css", ".json", ".webmanifest", ".svg", ".txt"]);
const files = {};
const walk = (d) => {
  for (const name of readdirSync(d).sort()) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (TEXT.has(extname(name).toLowerCase())) files["/" + relative(dir, p).split(sep).join("/")] = readFileSync(p, "utf8");
  }
};
walk(dir);
if (!files["/index.html"]) {
  console.error("index.html is missing");
  process.exit(1);
}
writeFileSync(out, JSON.stringify({ v, api: level, files }));
console.log(`bundle v=${v} api=${level} files=${Object.keys(files).length} bytes=${statSync(out).size}`);
