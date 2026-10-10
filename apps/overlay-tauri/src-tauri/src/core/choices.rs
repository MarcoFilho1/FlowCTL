//! The tray menu's settings and where they are kept: the same keys and
//! defaults as the macOS app's UserDefaults (apps/overlay/Sources/FlowCTL/Preferences.swift).

use super::geometry::{Corner, PanelSize};
use serde::{Deserialize, Serialize};

/// How the viewer draws: pixel art (the default) or smooth.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Look {
    #[default]
    Pixel,
    Smooth,
}

impl Look {
    pub const ALL: [Look; 2] = [Look::Pixel, Look::Smooth];
    pub fn as_str(self) -> &'static str {
        match self {
            Look::Pixel => "pixel",
            Look::Smooth => "smooth",
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            Look::Pixel => "Pixel",
            Look::Smooth => "Smooth",
        }
    }
}

/// The viewer's palette: follow the system's (the default), or dark or light.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum Theme {
    #[default]
    Auto,
    Dark,
    Light,
}

impl Theme {
    pub const ALL: [Theme; 3] = [Theme::Auto, Theme::Dark, Theme::Light];
    pub fn as_str(self) -> &'static str {
        match self {
            Theme::Auto => "auto",
            Theme::Dark => "dark",
            Theme::Light => "light",
        }
    }
    pub fn title(self) -> &'static str {
        match self {
            Theme::Auto => "Auto",
            Theme::Dark => "Dark",
            Theme::Light => "Light",
        }
    }
}

/// What the viewer's sounds sound like: off, or one of three styles. The
/// viewer takes it as `setSound(on)` and `setSoundStyle(style)`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub enum SoundStyle {
    /// The same style as the look.
    #[default]
    Look,
    /// Clean sounds.
    Smooth,
    /// 8-bit sounds.
    Pixel,
}

impl SoundStyle {
    pub fn as_str(self) -> &'static str {
        match self {
            SoundStyle::Look => "look",
            SoundStyle::Smooth => "smooth",
            SoundStyle::Pixel => "pixel",
        }
    }
}

/// The Sound submenu: Off, or a style. Off keeps the style for when sound comes back.
pub const SOUND_CHOICES: [(Option<SoundStyle>, &str); 4] =
    [(None, "Off"), (Some(SoundStyle::Look), "Same as Look"), (Some(SoundStyle::Smooth), "Clean"), (Some(SoundStyle::Pixel), "8-bit")];

pub const OPACITIES: [f64; 5] = [1.0, 0.9, 0.8, 0.7, 0.5];

#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct Anchor {
    pub corner: Corner,
    pub x: f64,
    pub y: f64,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Preferences {
    pub opacity: f64,
    pub always_on_top: bool,
    pub show_automatically: bool,
    pub hide_when_idle: bool,
    pub show_subagents: bool,
    pub sound: bool,
    pub sound_style: SoundStyle,
    pub theme: Theme,
    pub idle_animation: bool,
    pub look: Look,
    pub panel_size: PanelSize,
    pub anchor: Option<Anchor>,
}

impl Default for Preferences {
    fn default() -> Self {
        Self {
            opacity: 1.0,
            always_on_top: true,
            show_automatically: true,
            hide_when_idle: true,
            show_subagents: true,
            sound: true,
            sound_style: SoundStyle::Look,
            theme: Theme::Auto,
            idle_animation: true,
            look: Look::Pixel,
            panel_size: PanelSize::Medium,
            anchor: None,
        }
    }
}

impl Preferences {
    /// Reads the saved file; a missing or broken one, or a broken field, is the default.
    pub fn parse(data: &[u8]) -> Self {
        let mut prefs: Self = serde_json::from_slice::<serde_json::Value>(data)
            .ok()
            .and_then(|value| {
                // Field by field, so one unknown value keeps the others.
                let object = value.as_object()?.clone();
                let mut out = serde_json::to_value(Self::default()).ok()?;
                for (key, field) in object {
                    let mut trial = out.clone();
                    trial[&key] = field;
                    if serde_json::from_value::<Self>(trial.clone()).is_ok() {
                        out = trial;
                    }
                }
                serde_json::from_value(out).ok()
            })
            .unwrap_or_default();
        if !OPACITIES.iter().any(|o| (o - prefs.opacity).abs() < 0.01) {
            prefs.opacity = 1.0;
        }
        prefs
    }

    pub fn to_json(&self) -> Vec<u8> {
        serde_json::to_vec_pretty(self).unwrap_or_default()
    }

    /// The Sound submenu's current entry.
    pub fn sound_choice(&self) -> Option<SoundStyle> {
        self.sound.then_some(self.sound_style)
    }

    pub fn set_sound_choice(&mut self, choice: Option<SoundStyle>) {
        self.sound = choice.is_some();
        if let Some(style) = choice {
            self.sound_style = style;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_mac_app() {
        let prefs = Preferences::parse(b"");
        assert_eq!(prefs, Preferences::default());
        assert!(prefs.always_on_top && prefs.show_automatically && prefs.hide_when_idle && prefs.sound && prefs.idle_animation);
        assert_eq!((prefs.look, prefs.theme, prefs.panel_size), (Look::Pixel, Theme::Auto, PanelSize::Medium));
    }

    #[test]
    fn a_bad_value_falls_back_alone() {
        let prefs = Preferences::parse(br#"{"theme":"purple","look":"smooth","opacity":0.33}"#);
        assert_eq!(prefs.theme, Theme::Auto);
        assert_eq!(prefs.look, Look::Smooth);
        assert_eq!(prefs.opacity, 1.0);
    }

    #[test]
    fn round_trip_with_an_anchor() {
        let mut prefs = Preferences { anchor: Some(Anchor { corner: Corner::BottomLeft, x: 10.0, y: 900.0 }), ..Preferences::default() };
        prefs.set_sound_choice(Some(SoundStyle::Pixel));
        prefs.set_sound_choice(None);
        let back = Preferences::parse(&prefs.to_json());
        assert_eq!(back, prefs);
        assert_eq!(back.sound_style, SoundStyle::Pixel, "off keeps the style");
        assert_eq!(back.sound_choice(), None);
    }
}
