//! The tray icon: a node in the panel's look, white while nothing needs the
//! person, yellow and blinking while a session waits on them. As
//! apps/overlay/Sources/FlowCTLCore/AttentionIcon.swift, drawn to RGBA here
//! because the Windows tray has no template images.

use super::choices::Look;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Part {
    Outline,
    Body,
    Light,
    Shade,
}

/// The pixel node, `size` cells across, row by row (None outside the disc).
/// The same disc the viewer draws: an outline rim, a light corner top left,
/// a shade corner bottom right.
pub fn pixel_disc(size: usize) -> Vec<Vec<Option<Part>>> {
    let c = (size as f64 - 1.0) / 2.0;
    let radius = size as f64 / 2.0 - 0.15;
    let inside = |x: isize, y: isize| {
        x >= 0 && y >= 0 && (x as usize) < size && (y as usize) < size && (x as f64 - c).powi(2) + (y as f64 - c).powi(2) <= radius * radius
    };
    (0..size as isize)
        .map(|y| {
            (0..size as isize)
                .map(|x| {
                    if !inside(x, y) {
                        return None;
                    }
                    if !inside(x - 1, y) || !inside(x + 1, y) || !inside(x, y - 1) || !inside(x, y + 1) {
                        return Some(Part::Outline);
                    }
                    let d = x as f64 - c + y as f64 - c;
                    Some(if d <= -(size as f64 * 0.42) {
                        Part::Light
                    } else if d >= size as f64 * 0.38 {
                        Part::Shade
                    } else {
                        Part::Body
                    })
                })
                .collect()
        })
        .collect()
}

/// Pixel art blinks in whole steps, as the viewer's "!" does.
pub const PIXEL_STEP: f64 = 0.4;
/// The smooth node pulses, as the viewer's waiting dot does.
pub const SMOOTH_PERIOD: f64 = 1.4;
pub const DIMMEST: f64 = 0.3;

/// How opaque the node is `t` seconds into its blinking.
pub fn alpha(look: Look, t: f64) -> f64 {
    match look {
        Look::Pixel => {
            if ((t.max(0.0) / PIXEL_STEP).floor() as i64) % 2 == 0 {
                1.0
            } else {
                DIMMEST
            }
        }
        Look::Smooth => DIMMEST + (1.0 - DIMMEST) * ((2.0 * std::f64::consts::PI * t / SMOOTH_PERIOD).cos() + 1.0) / 2.0,
    }
}

/// How often the icon redraws while it blinks, in seconds.
pub fn frame_interval(look: Look) -> f64 {
    match look {
        Look::Pixel => PIXEL_STEP,
        Look::Smooth => 1.0 / 20.0,
    }
}

pub const YELLOW: [u8; 3] = [0xf2, 0xc9, 0x4c];
pub const WHITE: [u8; 3] = [0xf4, 0xf5, 0xf7];
pub const INK: [u8; 3] = [0x14, 0x16, 0x1b];

fn blend(a: [u8; 3], b: [u8; 3], amount: f64) -> [u8; 3] {
    let mix = |x: u8, y: u8| (x as f64 + (y as f64 - x as f64) * amount).round() as u8;
    [mix(a[0], b[0]), mix(a[1], b[1]), mix(a[2], b[2])]
}

/// The node `px` pixels square, as RGBA rows, `color` its body, `opacity` 0...1.
pub fn draw(look: Look, color: [u8; 3], px: usize, opacity: f64) -> Vec<u8> {
    let mut out = vec![0u8; px * px * 4];
    let mut put = |x: usize, y: usize, rgb: [u8; 3], a: f64| {
        let i = (y * px + x) * 4;
        out[i..i + 3].copy_from_slice(&rgb);
        out[i + 3] = (a.clamp(0.0, 1.0) * opacity * 255.0).round() as u8;
    };
    match look {
        Look::Pixel => {
            let disc = pixel_disc(8);
            let cell = (px / 8).max(1);
            let offset = (px - cell * 8) / 2;
            for (cy, row) in disc.iter().enumerate() {
                for (cx, part) in row.iter().enumerate() {
                    let Some(part) = part else { continue };
                    let rgb = match part {
                        Part::Outline => INK,
                        Part::Body => color,
                        Part::Light => blend(color, [255, 255, 255], 0.45),
                        Part::Shade => blend(color, [0, 0, 0], 0.30),
                    };
                    for y in 0..cell {
                        for x in 0..cell {
                            put(offset + cx * cell + x, offset + cy * cell + y, rgb, 1.0);
                        }
                    }
                }
            }
        }
        Look::Smooth => {
            // A disc with a darker rim and a shine top left, 4x4 supersampled.
            let scale = px as f64 / 18.0;
            let (cx, cy, r) = (9.0 * scale, 9.0 * scale, 7.0 * scale);
            let rim = blend(color, [0, 0, 0], 0.35);
            for y in 0..px {
                for x in 0..px {
                    let (mut body, mut edge, mut shine) = (0.0, 0.0, 0.0);
                    for sy in 0..4 {
                        for sx in 0..4 {
                            let fx = x as f64 + (sx as f64 + 0.5) / 4.0;
                            let fy = y as f64 + (sy as f64 + 0.5) / 4.0;
                            let d = ((fx - cx).powi(2) + (fy - cy).powi(2)).sqrt();
                            if d <= r {
                                body += 1.0 / 16.0;
                                if d > r - scale {
                                    edge += 1.0 / 16.0;
                                }
                                let (hx, hy) = ((fx - 7.25 * scale) / (2.25 * scale), (fy - 6.25 * scale) / (1.75 * scale));
                                if hx * hx + hy * hy <= 1.0 {
                                    shine += 1.0 / 16.0;
                                }
                            }
                        }
                    }
                    if body == 0.0 {
                        continue;
                    }
                    let base = blend(color, rim, if body > 0.0 { edge / body } else { 0.0 });
                    let rgb = blend(base, [255, 255, 255], 0.35 * if body > 0.0 { shine / body } else { 0.0 });
                    put(x, y, rgb, body);
                }
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_pixel_disc_matches_the_viewer() {
        let disc = pixel_disc(8);
        let text: Vec<String> = disc
            .iter()
            .map(|row| {
                row.iter()
                    .map(|p| match p {
                        None => '.',
                        Some(Part::Outline) => '#',
                        Some(Part::Body) => 'o',
                        Some(Part::Light) => '+',
                        Some(Part::Shade) => '-',
                    })
                    .collect()
            })
            .collect();
        assert_eq!(text, vec!["..####..", ".#+ooo#.", "#+ooooo#", "#oooooo#", "#oooooo#", "#ooooo-#", ".#ooo-#.", "..####.."]);
    }

    #[test]
    fn blinking() {
        assert_eq!(alpha(Look::Pixel, 0.0), 1.0);
        assert_eq!(alpha(Look::Pixel, 0.5), DIMMEST);
        assert_eq!(alpha(Look::Pixel, 0.8), 1.0);
        assert!((alpha(Look::Smooth, 0.0) - 1.0).abs() < 1e-9);
        assert!((alpha(Look::Smooth, 0.7) - DIMMEST).abs() < 1e-9);
        assert_eq!(frame_interval(Look::Smooth), 0.05);
    }

    #[test]
    fn drawing_fills_the_disc_only() {
        for look in [Look::Pixel, Look::Smooth] {
            let rgba = draw(look, YELLOW, 32, 1.0);
            assert_eq!(rgba.len(), 32 * 32 * 4);
            assert_eq!(rgba[3], 0, "the corner is clear");
            let center = (16 * 32 + 16) * 4;
            assert_eq!(rgba[center + 3], 255, "{look:?} center is opaque");
        }
        let dim = draw(Look::Pixel, YELLOW, 32, 0.3);
        assert_eq!(dim[(16 * 32 + 16) * 4 + 3], 77);
    }
}
