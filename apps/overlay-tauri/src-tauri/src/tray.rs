//! The tray icon and its menu: the overlay's settings, as the macOS menu bar
//! item (apps/overlay/Sources/FlowCTL/StatusMenu.swift). The icon is a white
//! node, or a yellow one blinking in the panel's look while a session needs
//! the person.

use crate::core::choices::{Look, Theme, OPACITIES, SOUND_CHOICES};
use crate::core::geometry::PanelSize;
use crate::core::icon;
use crate::overlay::{lock, Overlay, Shared};
use crate::system;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::image::Image;
use tauri::menu::{CheckMenuItem, IsMenuItem, Menu, MenuEvent, MenuItem, PredefinedMenuItem, Submenu};
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
        // shows or hides the panel and a right click opens the menu.
        .show_menu_on_left_click(cfg!(target_os = "macos"))
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                if !cfg!(target_os = "macos") {
                    lock(&tray.app_handle().state::<Shared>()).toggle();
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

fn check(app: &AppHandle, id: &str, title: &str, on: bool) -> tauri::Result<CheckMenuItem<Wry>> {
    CheckMenuItem::with_id(app, id, title, true, on, None::<&str>)
}

fn submenu(app: &AppHandle, title: &str, items: Vec<CheckMenuItem<Wry>>) -> tauri::Result<Submenu<Wry>> {
    let refs: Vec<&dyn IsMenuItem<Wry>> = items.iter().map(|item| item as &dyn IsMenuItem<Wry>).collect();
    Submenu::with_items(app, title, true, &refs)
}

fn build_menu(app: &AppHandle, overlay: &Overlay) -> tauri::Result<Menu<Wry>> {
    let p = &overlay.prefs;
    let active = overlay.registry.active_count(system::now());
    let sessions = match active {
        0 => "No active sessions".to_string(),
        1 => "1 active session".to_string(),
        n => format!("{n} active sessions"),
    };
    let toggle = MenuItem::with_id(app, "toggle", if overlay.visible { "Hide Panel" } else { "Show Panel" }, true, None::<&str>)?;
    let count = MenuItem::with_id(app, "count", sessions, false, None::<&str>)?;
    let opacity = submenu(
        app,
        "Opacity",
        OPACITIES
            .iter()
            .map(|o| check(app, &format!("opacity:{o}"), &format!("{}%", (o * 100.0).round()), (o - p.opacity).abs() < 0.01))
            .collect::<tauri::Result<_>>()?,
    )?;
    let size = submenu(
        app,
        "Size",
        PanelSize::ALL
            .iter()
            .map(|s| check(app, &format!("size:{}", s.title()), s.title(), *s == p.panel_size))
            .collect::<tauri::Result<_>>()?,
    )?;
    let look = submenu(
        app,
        "Look",
        Look::ALL.iter().map(|l| check(app, &format!("look:{}", l.as_str()), l.title(), *l == p.look)).collect::<tauri::Result<_>>()?,
    )?;
    let sound = submenu(
        app,
        "Sound",
        SOUND_CHOICES
            .iter()
            .map(|(choice, title)| {
                check(app, &format!("sound:{}", choice.map_or("off", |s| s.as_str())), title, *choice == p.sound_choice())
            })
            .collect::<tauri::Result<_>>()?,
    )?;
    let theme = submenu(
        app,
        "Theme",
        Theme::ALL.iter().map(|t| check(app, &format!("theme:{}", t.as_str()), t.title(), *t == p.theme)).collect::<tauri::Result<_>>()?,
    )?;
    let subagents = check(app, "showSubagents", "Show Subagents", p.show_subagents)?;
    let idle_animation = check(app, "idleAnimation", "Idle Animation", p.idle_animation)?;
    let on_top = check(app, "alwaysOnTop", "Always on Top", p.always_on_top)?;
    let auto_show = check(app, "showAutomatically", "Show Automatically", p.show_automatically)?;
    let auto_hide = check(app, "hideWhenIdle", "Hide When Idle", p.hide_when_idle)?;
    let quit = MenuItem::with_id(app, "quit", "Quit FlowCTL", true, None::<&str>)?;
    let separator = || PredefinedMenuItem::separator(app);
    Menu::with_items(
        app,
        &[
            &toggle,
            &separator()?,
            &count,
            &separator()?,
            &opacity,
            &size,
            &look,
            &subagents,
            &sound,
            &theme,
            &idle_animation,
            &on_top,
            &auto_show,
            &auto_hide,
            &separator()?,
            &quit,
        ],
    )
}

fn on_menu(app: &AppHandle, event: MenuEvent) {
    let id = event.id().as_ref().to_string();
    if id == "quit" {
        app.exit(0);
        return;
    }
    let shared = app.state::<Shared>();
    let mut overlay = lock(&shared);
    if id == "toggle" {
        overlay.toggle();
        return;
    }
    let p = &mut overlay.prefs;
    let (key, value) = id.split_once(':').unwrap_or((id.as_str(), ""));
    match key {
        "opacity" => p.opacity = value.parse().unwrap_or(1.0),
        "size" => p.panel_size = PanelSize::ALL.into_iter().find(|s| s.title() == value).unwrap_or_default(),
        "look" => p.look = Look::ALL.into_iter().find(|l| l.as_str() == value).unwrap_or_default(),
        "theme" => p.theme = Theme::ALL.into_iter().find(|t| t.as_str() == value).unwrap_or_default(),
        "sound" => {
            let choice = SOUND_CHOICES.iter().find(|(c, _)| c.map_or("off", |s| s.as_str()) == value).and_then(|(c, _)| *c);
            p.set_sound_choice(choice);
        }
        "showSubagents" => p.show_subagents = !p.show_subagents,
        "idleAnimation" => p.idle_animation = !p.idle_animation,
        "alwaysOnTop" => p.always_on_top = !p.always_on_top,
        "showAutomatically" => p.show_automatically = !p.show_automatically,
        "hideWhenIdle" => p.hide_when_idle = !p.hide_when_idle,
        _ => return,
    }
    overlay.preferences_changed();
    // A check item toggles itself when clicked; the rebuilt menu says what is true.
    STATE.lock().unwrap_or_else(|p| p.into_inner()).menu_key.clear();
    refresh(&overlay);
}
