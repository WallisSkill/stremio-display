use std::time::{Duration, Instant};

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Rect {
    pub x: u32,
    pub y: u32,
    pub w: u32,
    pub h: u32,
}

impl Rect {
    fn union(self, o: Rect) -> Rect {
        let x = self.x.min(o.x);
        let y = self.y.min(o.y);
        let r = (self.x + self.w).max(o.x + o.w);
        let b = (self.y + self.h).max(o.y + o.h);
        Rect { x, y, w: r - x, h: b - y }
    }

    fn near(self, o: Rect) -> bool {
        let d = |a: u32, b: u32| a.abs_diff(b) <= 4;
        d(self.x, o.x) && d(self.y, o.y) && d(self.x + self.w, o.x + o.w) && d(self.y + self.h, o.y + o.h)
    }
}

pub struct Frame<'a> {
    pub w: u32,
    pub h: u32,
    pub stride: usize,
    pub data: &'a [u8],
}

const LIT: u8 = 40;

fn lit(px: &[u8]) -> bool {
    px[0].max(px[1]).max(px[2]) > LIT
}

pub fn content(f: &Frame) -> Option<Rect> {
    let (w, h) = (f.w as usize, f.h as usize);
    if w < 16 || h < 16 || f.stride < w * 4 || f.data.len() < f.stride * (h - 1) + w * 4 {
        return None;
    }
    let px = |x: usize, y: usize| &f.data[y * f.stride + x * 4..y * f.stride + x * 4 + 4];
    let row_lit = |y: usize| {
        let need = (w / 2 / 100).max(4);
        (0..w).step_by(2).filter(|&x| lit(px(x, y))).take(need).count() >= need
    };
    let top = (0..h).find(|&y| row_lit(y))?;
    let bottom = (0..h).rev().find(|&y| row_lit(y))?;
    let col_lit = |x: usize| {
        let span = bottom - top + 1;
        let need = (span / 2 / 100).max(4);
        (top..=bottom).step_by(2).filter(|&y| lit(px(x, y))).take(need).count() >= need
    };
    let left = (0..w).find(|&x| col_lit(x))?;
    let right = (0..w).rev().find(|&x| col_lit(x))?;
    Some(Rect {
        x: left as u32,
        y: top as u32,
        w: (right - left + 1) as u32,
        h: (bottom - top + 1) as u32,
    })
}

fn even(r: Rect, fw: u32, fh: u32) -> Rect {
    let x = r.x & !1;
    let y = r.y & !1;
    let w = ((r.x + r.w - x + 1) & !1).min(fw - x);
    let h = ((r.y + r.h - y + 1) & !1).min(fh - y);
    Rect { x, y, w, h }
}

fn plausible(r: Rect, fw: u32, fh: u32) -> bool {
    let kept_w = r.w as f64 / fw as f64;
    let kept_h = r.h as f64 / fh as f64;
    let aspect = r.w as f64 / r.h.max(1) as f64;
    let balanced = |lead: u32, len: u32, full: u32| {
        let trail = full - lead - len;
        lead.abs_diff(trail) as f64 <= full as f64 * 0.04
    };
    kept_w >= 0.7 && kept_h >= 0.7 && (1.2..=2.8).contains(&aspect) && balanced(r.x, r.w, fw) && balanced(r.y, r.h, fh)
}

pub enum Change {
    Crop(Rect),
    Clear,
}

pub struct AutoCrop {
    frame: Option<(u32, u32)>,
    seen: Option<Rect>,
    samples: u32,
    applied: Option<Rect>,
    next: Instant,
    done: bool,
}

impl AutoCrop {
    pub fn new() -> Self {
        Self { frame: None, seen: None, samples: 0, applied: None, next: Instant::now() + Duration::from_secs(2), done: false }
    }

    pub fn due(&self) -> bool {
        !self.done && Instant::now() >= self.next
    }

    pub fn skip(&mut self) {
        self.next = Instant::now() + Duration::from_secs(1);
    }

    pub fn observe(&mut self, f: &Frame) -> Option<Change> {
        let full = match self.applied {
            Some(a) if (f.w, f.h) == (a.w, a.h) => self.frame,
            _ => Some((f.w, f.h)),
        };
        let (fw, fh) = full?;
        if self.frame != Some((fw, fh)) {
            let reset = self.applied.is_some();
            *self = Self::new();
            self.frame = Some((fw, fh));
            if reset {
                return Some(Change::Clear);
            }
        }
        let offset = match self.applied {
            Some(a) if (f.w, f.h) == (a.w, a.h) => (a.x, a.y),
            _ => (0, 0),
        };
        let delay = [3, 4, 4, 5, 6].get(self.samples as usize).copied().unwrap_or(20);
        self.next = Instant::now() + Duration::from_secs(delay);
        let Some(mut r) = content(f) else {
            return None;
        };
        r.x += offset.0;
        r.y += offset.1;
        self.samples += 1;
        let seen = self.seen.map_or(r, |s| s.union(r));
        self.seen = Some(seen);
        if seen.w >= fw.saturating_sub(4) && seen.h >= fh.saturating_sub(4) {
            self.done = true;
            return self.applied.take().map(|_| Change::Clear);
        }
        if self.samples < 3 {
            return None;
        }
        let target = even(seen, fw, fh);
        if !plausible(target, fw, fh) {
            return self.applied.take().map(|_| Change::Clear);
        }
        if self.applied.is_some_and(|a| a.near(target)) {
            return None;
        }
        self.applied = Some(target);
        Some(Change::Crop(target))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame(w: u32, h: u32, lit: Rect) -> Vec<u8> {
        let mut d = vec![0u8; (w * h * 4) as usize];
        for y in lit.y..lit.y + lit.h {
            for x in lit.x..lit.x + lit.w {
                let i = ((y * w + x) * 4) as usize;
                d[i] = 120;
                d[i + 1] = 90;
                d[i + 2] = 60;
            }
        }
        d
    }

    #[test]
    fn finds_letterbox() {
        let inner = Rect { x: 0, y: 140, w: 1920, h: 800 };
        let d = frame(1920, 1080, inner);
        let f = Frame { w: 1920, h: 1080, stride: 1920 * 4, data: &d };
        assert_eq!(content(&f), Some(inner));
        let mut a = AutoCrop::new();
        assert!(a.observe(&f).is_none());
        assert!(a.observe(&f).is_none());
        match a.observe(&f) {
            Some(Change::Crop(r)) => assert_eq!(r, inner),
            _ => panic!("expected crop"),
        }
    }

    #[test]
    fn ignores_full_frame() {
        let d = frame(640, 360, Rect { x: 0, y: 0, w: 640, h: 360 });
        let f = Frame { w: 640, h: 360, stride: 640 * 4, data: &d };
        let mut a = AutoCrop::new();
        assert!(a.observe(&f).is_none());
        assert!(a.done);
    }

    #[test]
    fn rejects_small_centered_title() {
        let d = frame(1920, 1080, Rect { x: 760, y: 500, w: 400, h: 80 });
        let f = Frame { w: 1920, h: 1080, stride: 1920 * 4, data: &d };
        let mut a = AutoCrop::new();
        assert!(a.observe(&f).is_none());
        assert!(a.observe(&f).is_none());
        assert!(a.observe(&f).is_none());
    }

    #[test]
    fn widens_after_brighter_scene() {
        let mut a = AutoCrop::new();
        let dark = frame(1920, 1080, Rect { x: 0, y: 160, w: 1920, h: 760 });
        let f = Frame { w: 1920, h: 1080, stride: 1920 * 4, data: &dark };
        a.observe(&f);
        a.observe(&f);
        assert!(matches!(a.observe(&f), Some(Change::Crop(_))));
        let bright = frame(1920, 1080, Rect { x: 0, y: 140, w: 1920, h: 800 });
        let f2 = Frame { w: 1920, h: 1080, stride: 1920 * 4, data: &bright };
        match a.observe(&f2) {
            Some(Change::Crop(r)) => assert_eq!(r, Rect { x: 0, y: 140, w: 1920, h: 800 }),
            _ => panic!("expected wider crop"),
        }
    }

    #[test]
    fn maps_cropped_screenshots_back() {
        let mut a = AutoCrop::new();
        let inner = Rect { x: 0, y: 140, w: 1920, h: 800 };
        let d = frame(1920, 1080, inner);
        let f = Frame { w: 1920, h: 1080, stride: 1920 * 4, data: &d };
        a.observe(&f);
        a.observe(&f);
        assert!(matches!(a.observe(&f), Some(Change::Crop(_))));
        let c = frame(1920, 800, Rect { x: 0, y: 0, w: 1920, h: 800 });
        let fc = Frame { w: 1920, h: 800, stride: 1920 * 4, data: &c };
        assert!(a.observe(&fc).is_none());
        assert_eq!(a.applied, Some(inner));
    }
}
