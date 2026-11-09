import json
import os
import re
import subprocess
import sys
from datetime import datetime, timezone

TAG, VERSION = sys.argv[1], sys.argv[2]
ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MARK = re.compile(r"<!-- wistv-notes (.*?) -->", re.S)
KINDS = {"feat": "Mới", "fix": "Sửa", "perf": "Nhanh hơn"}
SCOPES = {"ios": {"ios"}, "android": {"android"}, "windows": {"windows"}, "desktop": {"windows"}, "mobile": {"ios", "android"}}
OTHER = {
    "ios": ["plugins/video/android", "src-tauri/src/android.rs"],
    "android": ["plugins/video/ios"],
    "windows": ["plugins/video/android", "plugins/video/ios", "src-tauri/src/android.rs"],
}
TITLES = {"ios": "WiS TV cho iPhone", "windows": "WiS TV cho Windows", "android": "WiS TV cho Android"}
INTRO = {
    "ios": "Cài bằng Sideloadly, ký lại mỗi 7 ngày.",
    "windows": "Bản cài đặt cho Windows. Ứng dụng tự cập nhật khi mở.",
    "android": "Bản cài đặt cho Android (arm64).",
}
KEEP = 15
FIRST = 12


def run(*args):
    return subprocess.run(args, cwd=ROOT, capture_output=True, check=True).stdout.decode("utf-8")


def history():
    try:
        body = json.loads(run("gh", "release", "view", TAG, "--json", "body")).get("body") or ""
    except subprocess.CalledProcessError:
        return []
    m = MARK.search(body)
    if not m:
        return []
    try:
        data = json.loads(m.group(1).replace("--\u003e", "-->"))
    except ValueError:
        return []
    return data if isinstance(data, list) else []


def reachable(sha):
    try:
        run("git", "merge-base", "--is-ancestor", sha, "HEAD")
        return True
    except subprocess.CalledProcessError:
        return False


def changes(since):
    with open(os.path.join(ROOT, ".github", "changelog-vi.json"), encoding="utf-8") as f:
        vi = json.load(f)
    spec = ["src-tauri", "plugins", "ui", f".github/workflows/{TAG}.yml"] + [f":(exclude){p}" for p in OTHER[TAG]]
    rng = [f"{since}..HEAD"] if since else ["-n", "200", "HEAD"]
    raw = run("git", "log", "--no-merges", "--format=%H%x1f%s%x1f%(trailers:key=Changelog-vi,valueonly,separator=%x20)%x1e", *rng, "--", *spec)
    out = []
    for rec in raw.split("\x1e"):
        parts = rec.strip("\n").split("\x1f")
        if len(parts) < 3:
            continue
        sha, subject, trailer = parts[0], parts[1], parts[2].strip()
        m = re.match(r"^(\w+)(?:\(([^)]*)\))?!?:\s*(.+)$", subject)
        if not m or m.group(1) not in KINDS:
            continue
        scope = (m.group(2) or "").lower()
        if scope in SCOPES and TAG not in SCOPES[scope]:
            continue
        note = vi.get(sha[:7])
        if isinstance(note, dict):
            if TAG not in note.get("only", [TAG]):
                continue
            note = note.get("text")
        text = trailer or note or m.group(3)
        out.append({"kind": KINDS[m.group(1)], "text": text, "commit": sha[:7]})
        if not since and len(out) >= FIRST:
            break
    return out


def markdown(items):
    lines = [INTRO[TAG], ""]
    for it in items:
        lines.append(f"## {it['version']} · {it['date'][:10]}")
        lines += [f"- {c['kind']}: {c['text']}" for c in it["changes"]] or ["- Cập nhật nhỏ"]
        lines.append("")
    blob = json.dumps(items, ensure_ascii=False, separators=(",", ":")).replace("-->", "--\u003e")
    lines.append(f"<!-- wistv-notes {blob} -->")
    return "\n".join(lines)


def main():
    past = [h for h in history() if isinstance(h, dict) and h.get("version") and h.get("version") != VERSION]
    since = next((h["commit"] for h in past if h.get("commit") and reachable(h["commit"])), None)
    entry = {
        "version": VERSION,
        "date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "commit": run("git", "rev-parse", "HEAD").strip(),
        "changes": changes(since),
    }
    items = [entry] + past[: KEEP - 1]
    path = os.path.join(os.environ.get("RUNNER_TEMP", "."), f"notes-{TAG}.md")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        f.write(markdown(items))
    run("gh", "release", "edit", TAG, "--title", TITLES[TAG], "--notes-file", path)
    print(f"{TAG} {VERSION}: {len(entry['changes'])} changes since {since or 'start'}")


main()
