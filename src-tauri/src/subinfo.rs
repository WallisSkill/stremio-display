use serde_json::{json, Value};

const EDGE: usize = 3;
pub const MAX_BYTES: usize = 4 << 20;

const WORDS: &[&str] = &[
    "sub", "subs", "subbed", "subber", "vietsub", "engsub", "fansub", "dịch", "fix", "fixed", "sync", "synced",
    "resync", "resynced", "rip", "ripped", "encoded", "edited", "corrected", "credit", "credits",
];
const PREFIXES: &[&str] = &["subtit", "translat", "vietsub", "fansub"];
const PHRASES: &[&str] = &["phụ đề", "biên dịch", "người dịch"];
const ADS: &[&str] = &["opensubtitles", "osdb.link", "vip member", "advertise"];

struct Cue {
    start: u64,
    end: u64,
    text: String,
}

pub fn summarize(raw: &str) -> Value {
    let cues = parse(raw);
    let mut credits: Vec<String> = Vec::new();
    let n = cues.len();
    let edge = cues.iter().enumerate().filter(|(i, _)| *i < EDGE || *i + EDGE >= n);
    for (_, cue) in edge {
        if !is_credit(&cue.text) {
            continue;
        }
        let line = clean(&cue.text);
        if !line.is_empty() && !credits.contains(&line) {
            credits.push(line);
        }
    }
    json!({
        "credits": credits,
        "cues": n,
        "start": cues.iter().map(|c| c.start).min(),
        "end": cues.iter().map(|c| c.end).max(),
    })
}

fn parse(raw: &str) -> Vec<Cue> {
    let text = raw.trim_start_matches('\u{feff}').replace("\r\n", "\n").replace('\r', "\n");
    if text.contains("[Events]") || text.lines().any(|l| l.starts_with("Dialogue:")) {
        return parse_ass(&text);
    }
    let mut out = Vec::new();
    for block in text.split("\n\n") {
        let mut lines = block.lines().skip_while(|l| !l.contains("-->"));
        let Some(timing) = lines.next() else { continue };
        let mut parts = timing.split("-->");
        let (Some(a), Some(b)) = (parts.next().and_then(stamp), parts.next().and_then(stamp)) else { continue };
        let body: Vec<&str> = lines.map(str::trim).filter(|l| !l.is_empty()).collect();
        if !body.is_empty() {
            out.push(Cue { start: a, end: b, text: body.join("\n") });
        }
    }
    out.sort_by_key(|c| c.start);
    out
}

fn parse_ass(text: &str) -> Vec<Cue> {
    let mut out = Vec::new();
    for line in text.lines() {
        let Some(rest) = line.strip_prefix("Dialogue:") else { continue };
        let f: Vec<&str> = rest.splitn(10, ',').collect();
        if f.len() < 10 {
            continue;
        }
        let (Some(a), Some(b)) = (stamp(f[1]), stamp(f[2])) else { continue };
        let body = strip_braces(f[9]).replace("\\N", "\n").replace("\\n", "\n");
        if !body.trim().is_empty() {
            out.push(Cue { start: a, end: b, text: body.trim().to_string() });
        }
    }
    out.sort_by_key(|c| c.start);
    out
}

fn stamp(s: &str) -> Option<u64> {
    let s = s.trim().split_whitespace().next()?;
    let s = s.replace(',', ".");
    let (hms, frac) = s.split_once('.').unwrap_or((&s, "0"));
    let mut secs = 0u64;
    for part in hms.split(':') {
        secs = secs * 60 + part.parse::<u64>().ok()?;
    }
    let digits: String = frac.chars().take(3).collect();
    let ms = format!("{digits:0<3}").parse::<u64>().ok()?;
    Some(secs * 1000 + ms)
}

fn strip_braces(s: &str) -> String {
    let mut out = String::new();
    let mut depth = 0;
    for ch in s.chars() {
        match ch {
            '{' => depth += 1,
            '}' if depth > 0 => depth -= 1,
            _ if depth == 0 => out.push(ch),
            _ => {}
        }
    }
    out
}

fn strip_tags(s: &str) -> String {
    let mut out = String::new();
    let mut inside = false;
    for ch in s.chars() {
        match ch {
            '<' => inside = true,
            '>' if inside => inside = false,
            _ if !inside => out.push(ch),
            _ => {}
        }
    }
    strip_braces(&out)
}

fn is_url(token: &str) -> bool {
    let t = token.trim_matches(|c: char| "()[]<>{}\"',;:|".contains(c)).to_lowercase();
    if t.contains("://") || t.starts_with("www.") {
        return true;
    }
    let host = t.split('/').next().unwrap_or("");
    let Some((name, tld)) = host.rsplit_once('.') else { return false };
    !name.is_empty() && (2..=6).contains(&tld.len()) && tld.chars().all(|c| c.is_ascii_alphabetic())
}

fn is_credit(text: &str) -> bool {
    let plain = strip_tags(text);
    let low = plain.to_lowercase();
    if ADS.iter().any(|a| low.contains(a)) {
        return false;
    }
    if PHRASES.iter().any(|p| low.contains(p)) {
        return true;
    }
    low.split_whitespace().any(|tok| {
        if is_url(tok) {
            return true;
        }
        let w = tok.trim_matches(|c: char| !c.is_alphanumeric());
        WORDS.contains(&w) || PREFIXES.iter().any(|p| w.starts_with(p))
    })
}

fn clean(text: &str) -> String {
    let plain = strip_tags(text);
    let mut lines = Vec::new();
    for line in plain.lines() {
        let words: Vec<&str> = line.split_whitespace().filter(|t| !is_url(t)).collect();
        let mut s = words.join(" ").replace("()", "").replace("[]", "");
        s = s.trim_matches(|c: char| c.is_whitespace() || "-|:·,".contains(c)).to_string();
        if s.chars().any(char::is_alphanumeric) {
            lines.push(s);
        }
    }
    let joined = lines.join(" · ");
    if joined.chars().count() > 140 {
        joined.chars().take(139).collect::<String>() + "…"
    } else {
        joined
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SRT: &str = "\u{feff}1\r\n00:00:00,000 --> 00:00:02,000\r\nVietsub bởi Hồ Vũ Long (Facebook.com/vlng1210)\r\nFixed by bobbyocean\r\nFacebook.com/ImHighOnKetamine\r\n\r\n2\r\n00:00:02,500 --> 00:00:05,250\r\nĐây có phải là quyền năng\r\n\r\n3\r\n00:00:07,291 --> 00:00:09,791\r\n<i>Một biến thể đào tẩu</i>\r\n\r\n4\r\n00:00:10,000 --> 00:00:11,000\r\nGiữa phim\r\n\r\n5\r\n00:00:12,000 --> 00:00:13,000\r\nSắp hết\r\n\r\n6\r\n00:00:14,000 --> 00:00:15,000\r\nĐi thôi\r\n\r\n7\r\n00:36:10,410 --> 00:36:20,410\r\nVietsub bởi Hồ Vũ Long (Facebook.com/vlng1210)\r\nFixed by bobbyocean\r\nFacebook.com/ImHighOnKetamine\r\n";

    #[test]
    fn reads_credit_and_drops_links() {
        let v = summarize(SRT);
        assert_eq!(v["credits"], json!(["Vietsub bởi Hồ Vũ Long · Fixed by bobbyocean"]));
        assert_eq!(v["cues"], 7);
        assert_eq!(v["start"], 0);
        assert_eq!(v["end"], 2_180_410);
    }

    #[test]
    fn dialogue_is_not_a_credit() {
        let srt = "1\n00:00:01,000 --> 00:00:02,000\nTake the subway, Mr. Smith.\n\n2\n00:00:03,000 --> 00:00:04,000\nStand by me.\n";
        assert_eq!(summarize(srt)["credits"], json!([]));
    }

    #[test]
    fn skips_ads() {
        let srt = "1\n00:00:01,000 --> 00:00:02,000\nAdvertise your product or brand here\ncontact www.OpenSubtitles.org today\n";
        assert_eq!(summarize(srt)["credits"], json!([]));
    }

    #[test]
    fn reads_ass_and_vtt() {
        let ass = "[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.50,Default,,0,0,0,,{\\an8}Translated by Mai\\NSynced by Lan\n";
        let v = summarize(ass);
        assert_eq!(v["credits"], json!(["Translated by Mai · Synced by Lan"]));
        assert_eq!(v["end"], 3500);
        let vtt = "WEBVTT\n\n00:01.000 --> 00:02.000\nSubtitles: Team X\n";
        assert_eq!(summarize(vtt)["credits"], json!(["Subtitles: Team X"]));
    }

    #[test]
    fn decimals_round_trip() {
        assert_eq!(stamp("00:00:07,291"), Some(7291));
        assert_eq!(stamp("0:00:01.5"), Some(1500));
        assert_eq!(stamp("01:02.003 align:start"), Some(62_003));
    }
}
