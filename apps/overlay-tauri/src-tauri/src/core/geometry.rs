//! Where the panel sits: one corner (its anchor) stays put, so a size change
//! grows or shrinks it away from that corner. As
//! apps/overlay/Sources/FlowCTLCore/PanelGeometry.swift, but in logical
//! pixels with y growing downward, as Windows and Tauri count.

use serde::{Deserialize, Serialize};

/// Kept between the panel and the screen's edges.
pub const MARGIN: f64 = 12.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Rect {
    pub x: f64,
    pub y: f64,
    pub w: f64,
    pub h: f64,
}

impl Rect {
    pub fn max_x(&self) -> f64 {
        self.x + self.w
    }
    pub fn max_y(&self) -> f64 {
        self.y + self.h
    }
    pub fn mid_x(&self) -> f64 {
        self.x + self.w / 2.0
    }
    pub fn mid_y(&self) -> f64 {
        self.y + self.h / 2.0
    }
    /// Whether the point is on this rect, its edges included.
    pub fn holds(&self, x: f64, y: f64) -> bool {
        x >= self.x - 1.0 && x <= self.max_x() + 1.0 && y >= self.y - 1.0 && y <= self.max_y() + 1.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Corner {
    TopLeft,
    TopRight,
    BottomLeft,
    BottomRight,
}

/// The panel's fixed sizes, picked in the tray menu (Size).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum PanelSize {
    Small,
    #[default]
    Medium,
    Large,
}

impl PanelSize {
    pub const ALL: [PanelSize; 3] = [PanelSize::Small, PanelSize::Medium, PanelSize::Large];

    /// The whole window, in logical pixels.
    pub fn size(self) -> (f64, f64) {
        match self {
            PanelSize::Small => (280.0, 180.0),
            PanelSize::Medium => (360.0, 220.0),
            PanelSize::Large => (480.0, 300.0),
        }
    }

    pub fn title(self) -> &'static str {
        match self {
            PanelSize::Small => "Small",
            PanelSize::Medium => "Medium",
            PanelSize::Large => "Large",
        }
    }
}

/// `size`, cut to fit a screen smaller than it.
pub fn fit((w, h): (f64, f64), screen: Rect) -> (f64, f64) {
    (w.min(screen.w), h.min(screen.h))
}

pub fn point_of(corner: Corner, frame: Rect) -> (f64, f64) {
    match corner {
        Corner::TopLeft => (frame.x, frame.y),
        Corner::TopRight => (frame.max_x(), frame.y),
        Corner::BottomLeft => (frame.x, frame.max_y()),
        Corner::BottomRight => (frame.max_x(), frame.max_y()),
    }
}

/// A frame of `size` whose `corner` sits at `point`, moved inside `screen`
/// if it would stick out. A top-right anchor grows left and down.
pub fn frame((w, h): (f64, f64), corner: Corner, (px, py): (f64, f64), screen: Rect) -> Rect {
    let (x, y) = match corner {
        Corner::TopLeft => (px, py),
        Corner::TopRight => (px - w, py),
        Corner::BottomLeft => (px, py - h),
        Corner::BottomRight => (px - w, py - h),
    };
    Rect { x: x.max(screen.x).min(screen.max_x() - w), y: y.max(screen.y).min(screen.max_y() - h), w, h }
}

/// The screen corner nearest the panel's center: the anchor after a drag.
pub fn nearest_corner(frame: Rect, screen: Rect) -> Corner {
    let left = frame.mid_x() < screen.mid_x();
    let top = frame.mid_y() <= screen.mid_y();
    match (top, left) {
        (true, true) => Corner::TopLeft,
        (true, false) => Corner::TopRight,
        (false, true) => Corner::BottomLeft,
        (false, false) => Corner::BottomRight,
    }
}

/// The anchor after a drag: the nearest corner and that corner's point, kept on the screen.
pub fn reanchor(frame: Rect, screen: Rect) -> (Corner, (f64, f64)) {
    let corner = nearest_corner(frame, screen);
    let (x, y) = point_of(corner, frame);
    (corner, (x.max(screen.x).min(screen.max_x()), y.max(screen.y).min(screen.max_y())))
}

/// Where a panel first appears: the top-right corner, inside the margin.
pub fn default_anchor(screen: Rect) -> (Corner, (f64, f64)) {
    (Corner::TopRight, (screen.max_x() - MARGIN, screen.y + MARGIN))
}

#[cfg(test)]
mod tests {
    use super::*;

    const SCREEN: Rect = Rect { x: 0.0, y: 0.0, w: 1920.0, h: 1040.0 };

    #[test]
    fn the_default_is_top_right_inside_the_margin() {
        let (corner, point) = default_anchor(SCREEN);
        assert_eq!(frame(PanelSize::Medium.size(), corner, point, SCREEN), Rect { x: 1548.0, y: 12.0, w: 360.0, h: 220.0 });
    }

    #[test]
    fn a_size_change_grows_away_from_the_anchor() {
        let point = (1908.0, 1028.0);
        let small = frame(PanelSize::Small.size(), Corner::BottomRight, point, SCREEN);
        let large = frame(PanelSize::Large.size(), Corner::BottomRight, point, SCREEN);
        assert_eq!((small.max_x(), small.max_y()), point);
        assert_eq!((large.max_x(), large.max_y()), point);
    }

    #[test]
    fn a_frame_stays_on_the_screen_and_fits_it() {
        assert_eq!(frame((360.0, 220.0), Corner::TopLeft, (-50.0, 2000.0), SCREEN), Rect { x: 0.0, y: 820.0, w: 360.0, h: 220.0 });
        assert_eq!(fit((480.0, 300.0), Rect { x: 0.0, y: 0.0, w: 400.0, h: 900.0 }), (400.0, 300.0));
    }

    #[test]
    fn a_drag_anchors_to_the_nearest_corner() {
        let dragged = Rect { x: 100.0, y: 700.0, w: 360.0, h: 220.0 };
        assert_eq!(reanchor(dragged, SCREEN), (Corner::BottomLeft, (100.0, 920.0)));
        let top_right = Rect { x: 1500.0, y: 20.0, w: 360.0, h: 220.0 };
        assert_eq!(reanchor(top_right, SCREEN), (Corner::TopRight, (1860.0, 20.0)));
    }

    #[test]
    fn edges_count_as_on_the_screen() {
        assert!(SCREEN.holds(1920.5, 0.0));
        assert!(!SCREEN.holds(1922.0, 0.0));
    }
}
