//! The tray flyout and the Settings window: Windows 11's own manner (Quick
//! Settings and Settings), drawn by the viewer bundle opened with
//! `?ui=controls` and `?ui=settings` (apps/viewer/src/windows). The app sends
//! them its state (`window.flowctlControls.update`) and takes their changes
//! through the commands below. As the macOS app's control panel and Settings
//! window (apps/overlay/Sources/FlowCTL/ControlPanel.swift), in Windows' idiom.

use crate::core::choices::{Look, SoundStyle, Theme};
use crate::core::geometry::PanelSize;
use crate::overlay::{lock, log, Overlay, Shared};
use crate::system;
use serde_json::{json, Value};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent};

pub const FLYOUT: &str = "controls";
pub const SETTINGS: &str = "settings";
/// The flyout's page is 360 px wide inside a 16 px margin kept for its shadow.
const FLYOUT_WIDTH: f64 = 392.0;
/// Windows 11 leaves this much between a flyout and the taskbar (the page's margin included).
const TASKBAR_GAP: f64 = 0.0;

/// When the flyout last went away for losing the focus: a click on the tray
/// icon takes the focus first, and must not open it again at once.
static CLOSED_AT: Mutex<Option<Instant>> = Mutex::new(None);

/// What both pages draw.
pub fn state(overlay: &Overlay) -> Value {
    let p = &overlay.prefs;
    let now = system::now();
    let sessions: Vec<Value> = overlay
        .registry
        .ids()
        .iter()
        .rev()
        .filter_map(|id| {
            let session = overlay.registry.session(id)?;
            let state = overlay.registry.effective_state(session, now);
            if state == crate::core::snapshot::SessionState::Ended {
                return None;
            }
            let body: Value = serde_json::from_slice(&session.body).unwrap_or(Value::Null);
            let name = body["cwd"]
                .as_str()
                .and_then(|cwd| cwd.trim_end_matches(['/', '\\']).rsplit(['/', '\\']).next())
                .filter(|name| !name.is_empty())
                .unwrap_or("Session");
            Some(json!({ "id": id, "name": name, "state": state.as_str() }))
        })
        .collect();
    json!({
        "version": env!("CARGO_PKG_VERSION"),
        "accent": system::accent_color(),
        "overlayShown": overlay.visible,
        "sessions": sessions,
        "prefs": {
            "opacity": p.opacity,
            "alwaysOnTop": p.always_on_top,
            "showAutomatically": p.show_automatically,
            "hideWhenIdle": p.hide_when_idle,
            "showSubagents": p.show_subagents,
            "idleAnimation": p.idle_animation,
            "sound": p.sound_choice().map_or("off", |s| s.as_str()),
            "theme": p.theme.as_str(),
            "look": p.look.as_str(),
            "size": p.panel_size.title(),
        }
    })
}

/// Sends the state to whichever of the two pages is open.
pub fn push(overlay: &Overlay) {
    let script = format!("window.flowctlControls && window.flowctlControls.update({});", state(overlay));
    for label in [FLYOUT, SETTINGS] {
        if let Some(window) = overlay.app.get_webview_window(label) {
            let _ = window.eval(&script);
        }
    }
}

#[tauri::command]
pub fn controls_state(state: tauri::State<'_, Shared>) -> Value {
    self::state(&lock(&state))
}

#[tauri::command]
pub fn controls_set(key: String, value: Value, state: tauri::State<'_, Shared>) {
    let mut overlay = lock(&state);
    let p = &mut overlay.prefs;
    let text = value.as_str().unwrap_or("");
    let on = value.as_bool().unwrap_or(false);
    match key.as_str() {
        "opacity" => p.opacity = value.as_f64().unwrap_or(1.0).clamp(0.3, 1.0),
        "alwaysOnTop" => p.always_on_top = on,
        "showAutomatically" => p.show_automatically = on,
        "hideWhenIdle" => p.hide_when_idle = on,
        "showSubagents" => p.show_subagents = on,
        "idleAnimation" => p.idle_animation = on,
        "sound" => p.set_sound_choice(match text {
            "look" => Some(SoundStyle::Look),
            "smooth" => Some(SoundStyle::Smooth),
            "pixel" => Some(SoundStyle::Pixel),
            _ => None,
        }),
        "theme" => p.theme = Theme::ALL.into_iter().find(|t| t.as_str() == text).unwrap_or_default(),
        "look" => p.look = Look::ALL.into_iter().find(|l| l.as_str() == text).unwrap_or_default(),
        "size" => p.panel_size = PanelSize::ALL.into_iter().find(|s| s.title() == text).unwrap_or_default(),
        other => return log(&format!("unknown setting {other}")),
    }
    overlay.preferences_changed();
}

#[tauri::command]
pub fn controls_action(request: Value, app: AppHandle, state: tauri::State<'_, Shared>) {
    match request["action"].as_str() {
        Some("toggleOverlay") => lock(&state).toggle(),
        Some("focus") => {
            close_flyout(&app);
            let mut overlay = lock(&state);
            overlay.show();
            let id = request["id"].as_str().unwrap_or("");
            if let Some(session) = overlay.registry.session(id) {
                crate::focus::bring_forward(crate::core::snapshot::terminal(&session.body));
            }
        }
        Some("settings") => {
            close_flyout(&app);
            open_settings(&app);
        }
        Some("close") => close_flyout(&app),
        Some("quit") => app.exit(0),
        other => log(&format!("unknown flyout action {other:?}")),
    }
}

/// The flyout's page asks for the height its content takes; it grows upward from the taskbar.
#[tauri::command]
pub fn controls_height(height: f64, window: WebviewWindow) {
    let Ok(size) = window.inner_size() else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let current = size.height as f64 / scale;
    if (current - height).abs() < 1.0 {
        return;
    }
    let bottom = window.outer_position().map(|p| p.y as f64 / scale + current).ok();
    let _ = window.set_size(LogicalSize::new(FLYOUT_WIDTH, height));
    if let (Some(bottom), Ok(position)) = (bottom, window.outer_position()) {
        let _ = window.set_position(LogicalPosition::new(position.x as f64 / scale, bottom - height));
    }
}

/// A left click on the tray icon: opens the flyout above it, or closes it.
/// `icon` is the icon's box in physical pixels, when the system gave it.
pub fn toggle_flyout(app: &AppHandle, icon: Option<(f64, f64, f64, f64)>) {
    if let Some(window) = app.get_webview_window(FLYOUT) {
        if window.is_visible().unwrap_or(false) {
            close_flyout(app);
            return;
        }
    }
    let just_closed = CLOSED_AT.lock().unwrap_or_else(|p| p.into_inner()).is_some_and(|at| at.elapsed() < Duration::from_millis(300));
    if just_closed {
        return;
    }
    let window = match app.get_webview_window(FLYOUT) {
        Some(window) => window,
        None => match build_flyout(app) {
            Ok(window) => window,
            Err(error) => return log(&format!("could not open the flyout: {error}")),
        },
    };
    place_flyout(&window, icon);
    push(&lock(&app.state::<Shared>()));
    let _ = window.show();
    let _ = window.set_focus();
}

pub fn close_flyout(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(FLYOUT) {
        if window.is_visible().unwrap_or(false) {
            let _ = window.hide();
        }
    }
}

fn build_flyout(app: &AppHandle) -> tauri::Result<WebviewWindow> {
    let window = WebviewWindowBuilder::new(app, FLYOUT, WebviewUrl::App("index.html?ui=controls".into()))
        .title("FlowCTL")
        .inner_size(FLYOUT_WIDTH, 560.0)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .resizable(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .visible(false)
        .build()?;
    let handle = app.clone();
    window.on_window_event(move |event| {
        // As any flyout: a click elsewhere closes it.
        if let WindowEvent::Focused(false) = event {
            *CLOSED_AT.lock().unwrap_or_else(|p| p.into_inner()) = Some(Instant::now());
            close_flyout(&handle);
        }
    });
    Ok(window)
}

/// Above the tray icon, right-aligned to it and inside the work area: where
/// Windows opens its own flyouts. A taskbar at the top puts it below instead.
fn place_flyout(window: &WebviewWindow, icon: Option<(f64, f64, f64, f64)>) {
    let Ok(size) = window.inner_size() else { return };
    let scale = window.scale_factor().unwrap_or(1.0);
    let height = size.height as f64 / scale;
    let monitor =
        icon.and_then(|(x, y, _, _)| window.monitor_from_point(x, y).ok().flatten()).or_else(|| window.primary_monitor().ok().flatten());
    let Some(monitor) = monitor else { return };
    let s = monitor.scale_factor();
    let area = monitor.work_area();
    let (ax, ay, aw, ah) =
        (area.position.x as f64 / s, area.position.y as f64 / s, area.size.width as f64 / s, area.size.height as f64 / s);
    let (icon_x, icon_y) = icon.map_or((ax + aw, ay + ah), |(x, y, w, _)| ((x + w / 2.0) / s, y / s));
    let x = (icon_x - FLYOUT_WIDTH / 2.0).clamp(ax, ax + aw - FLYOUT_WIDTH);
    let taskbar_on_top = icon_y < ay + ah / 2.0;
    let y = if taskbar_on_top { ay + TASKBAR_GAP } else { ay + ah - height - TASKBAR_GAP };
    let _ = window.set_position(LogicalPosition::new(x, y));
}

/// Opens the Settings window, or brings it forward.
pub fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS) {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
        return;
    }
    let built = WebviewWindowBuilder::new(app, SETTINGS, WebviewUrl::App("index.html?ui=settings".into()))
        .title("FlowCTL Settings")
        .inner_size(760.0, 720.0)
        .min_inner_size(520.0, 420.0)
        .center()
        .build();
    match built {
        Ok(window) => {
            let _ = window.set_focus();
        }
        Err(error) => log(&format!("could not open Settings: {error}")),
    }
}
