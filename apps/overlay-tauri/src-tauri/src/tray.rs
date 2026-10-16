//! The tray icon: a left click opens the flyout with the overlay's settings
//! (controls.rs), a right click a short menu, as Windows' own tray icons. The
//! icon is a white node, or a yellow one blinking in the panel's look while a
//! session needs the person.

use crate::controls;
use crate::core::choices::Look;
use crate::core::icon;
use crate::overlay::{lock, Overlay, Shared};
use crate::system;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Manager, Wry};

const TRAY: &str = "flowctl";
const ICON_PX: usize = 32;

/// What the icon thread draws, and the menu last built (rebuilt only when it changes).
struct TrayState {
    waiting: bool,
    look: Look,
    menu_key: String,
}

static STATE: Mutex<TrayState> = Mutex::new(TrayState { waiting: false, look: Look::Pixel, menu_key: String::new() });

fn image(look: Look, color: [u8; 3], opacity: f64) -> Image<'static> {
    Image::new_owned(icon::draw(look, color, ICON_PX, opacity), ICON_PX as u32, ICON_PX as u32)
}

pub fn create(app: &AppHandle, overlay: &Overlay) -> tauri::Result<TrayIcon> {
    let menu = build_menu(app, overlay)?;
    TrayIconBuilder::with_id(TRAY)
        .icon(image(overlay.prefs.look, icon::WHITE, 1.0))
        .tooltip("FlowCTL")
        .menu(&menu)
        // The macOS menu bar opens menus on a click; on Windows a left click
        // opens the flyout (Quick Settings' manner) and a right click the menu.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, rect, .. } = event {
                if !cfg!(target_os = "macos") {
                    let scale = 1.0;
                    let position = rect.position.to_physical::<f64>(scale);
                    let size = rect.size.to_physical::<f64>(scale);
                    controls::toggle_flyout(tray.app_handle(), Some((position.x, position.y, size.width, size.height)));
                }
            }
        })
        .on_menu_event(on_menu)
        .build(app)
}

/// Starts the thread that draws the icon: still while nobody waits, blinking while someone does.
pub fn animate(app: AppHandle) {
    std::thread::spawn(move || {
        let mut shown: Option<(bool, Look, u8)> = None;
        let mut since = Instant::now();
        loop {
            let (waiting, look) = {
                let state = STATE.lock().unwrap_or_else(|p| p.into_inner());
                (state.waiting, state.look)
            };
            if waiting && shown.is_none_or(|s| !s.0) {
                since = Instant::now();
            }
            let alpha = if waiting && !system::reduce_motion() { icon::alpha(look, since.elapsed().as_secs_f64()) } else { 1.0 };
            let key = (waiting, look, (alpha * 100.0).round() as u8);
            if shown != Some(key) {
                if let Some(tray) = app.tray_by_id(TRAY) {
                    let color = if waiting { icon::YELLOW } else { icon::WHITE };
                    let _ = tray.set_icon(Some(image(look, color, alpha)));
                    let _ = tray.set_tooltip(Some(if waiting { "FlowCTL: a session needs you" } else { "FlowCTL" }));
                }
                shown = Some(key);
            }
            std::thread::sleep(Duration::from_secs_f64(if waiting { icon::frame_interval(look) } else { 0.25 }));
        }
    });
}

/// After anything the icon or the menu shows changed.
pub fn refresh(overlay: &Overlay) {
    controls::push(overlay);
    let now = system::now();
    let waiting = overlay.registry.is_any_waiting(now);
    let key = format!("{}|{}|{}", String::from_utf8_lossy(&overlay.prefs.to_json()), overlay.visible, overlay.registry.active_count(now));
    let rebuild = {
        let mut state = STATE.lock().unwrap_or_else(|p| p.into_inner());
        state.waiting = waiting;
        state.look = overlay.prefs.look;
        let changed = state.menu_key != key;
        state.menu_key = key;
        changed
    };
    if rebuild {
        if let (Some(tray), Ok(menu)) = (overlay.app.tray_by_id(TRAY), build_menu(&overlay.app, overlay)) {
            let _ = tray.set_menu(Some(menu));
        }
    }
}

/// The right-click menu, short as Windows' own tray menus: the panel, Settings, Quit.
/// Everything else is in the flyout and the Settings window (controls.rs).
fn build_menu(app: &AppHandle, overlay: &Overlay) -> tauri::Result<Menu<Wry>> {
    let toggle = MenuItem::with_id(app, "toggle", if overlay.visible { "Hide panel" } else { "Show panel" }, true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit FlowCTL", true, None::<&str>)?;
    Menu::with_items(app, &[&toggle, &settings, &PredefinedMenuItem::separator(app)?, &quit])
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    match event.id().as_ref() {
        "quit" => app.exit(0),
        "toggle" => lock(&app.state::<Shared>()).toggle(),
        "settings" => controls::open_settings(app),
        _ => {}
    }
}
