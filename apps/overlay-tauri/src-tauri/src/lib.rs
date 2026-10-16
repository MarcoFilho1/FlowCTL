//! FlowCTL's overlay for Windows (and, for development, macOS): a floating
//! panel showing the viewer (apps/viewer), fed by the mod over a local
//! endpoint. The macOS release keeps the Swift app in apps/overlay; this one
//! follows its behavior, setting for setting.

pub mod controls;
pub mod core;
pub mod focus;
pub mod overlay;
pub mod server;
pub mod system;
pub mod tray;

use overlay::{lock, log, on_main, Overlay, Shared, PANEL};
use serde_json::Value;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Manager, RunEvent, WebviewUrl, WebviewWindowBuilder, WindowEvent};

/// Runs in the page before its own scripts: the viewer's way to the app
/// (`window.flowctlNative.postMessage`, see apps/viewer/src/store.ts), the
/// window drag from the top bar's grip, and the signal that the bridge is up.
const PAGE_SCRIPT: &str = r#"
(() => {
  const invoke = (cmd, args) => window.__TAURI_INTERNALS__.invoke(cmd, args).catch(() => {});
  let grip = null;
  const onGrip = (e) =>
    grip !== null && e.clientX >= grip.x && e.clientX <= grip.x + grip.width && e.clientY >= grip.y && e.clientY <= grip.y + grip.height;
  window.flowctlNative = {
    postMessage(message) {
      if (message && message.type === "grip") grip = message.width > 0 && message.height > 0 ? message : null;
      invoke("native_message", { message });
    }
  };
  document.addEventListener("mousedown", (e) => {
    if (e.button === 0 && onGrip(e)) {
      e.preventDefault();
      e.stopPropagation();
      invoke("start_drag");
    }
  }, true);
  document.addEventListener("mousemove", (e) => {
    if (document.documentElement) document.documentElement.style.cursor = onGrip(e) ? "grab" : "";
  }, true);
  const ready = () => (window.flowctl ? invoke("page_ready") : setTimeout(ready, 20));
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", ready);
  else ready();
})();
"#;

#[tauri::command]
fn native_message(message: Value, state: tauri::State<'_, Shared>) {
    // The page sends the grip's box at every layout change; the init script uses it, the app does not.
    if matches!(message["type"].as_str(), Some("grip" | "size")) {
        return;
    }
    lock(&state).message(&message);
}

#[tauri::command]
fn page_ready(state: tauri::State<'_, Shared>) {
    lock(&state).page_ready();
}

#[tauri::command]
fn start_drag(window: tauri::WebviewWindow, state: tauri::State<'_, Shared>) {
    lock(&state).dragging = true;
    if let Err(error) = window.start_dragging() {
        log(&format!("drag failed: {error}"));
    }
    // On Windows the drag runs here until the button is up; a move after it settles the anchor.
    Overlay::moved(&state);
}

pub fn run() {
    if let Err(error) = system::prepare_dirs() {
        log(&format!("could not prepare ~/.flowctl: {error}"));
    }
    let dir = system::flowctl_dir();
    // One overlay at a time: a second launch shows the first one's panel and leaves.
    if server::call(&dir, "GET", "/health") {
        log("another FlowCTL is running; showing its panel");
        server::call(&dir, "POST", "/show");
        return;
    }

    let app = tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            native_message,
            page_ready,
            start_drag,
            controls::controls_state,
            controls::controls_set,
            controls::controls_action,
            controls::controls_height
        ])
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            let shared: Shared = Arc::new(Mutex::new(Overlay::new(app.handle().clone())));
            app.manage(shared.clone());

            let builder = WebviewWindowBuilder::new(app, PANEL, WebviewUrl::App("index.html".into()))
                .title("FlowCTL")
                .inner_size(360.0, 220.0)
                .decorations(false)
                .transparent(true)
                .shadow(false)
                .resizable(false)
                .always_on_top(lock(&shared).prefs.always_on_top)
                .skip_taskbar(true)
                .visible(false)
                .focused(false)
                // Clicks reach the page without taking the keyboard from the terminal.
                .focusable(false)
                .visible_on_all_workspaces(true)
                .initialization_script(PAGE_SCRIPT);
            // Sounds play without a click first; the rest are Tauri's own defaults.
            #[cfg(windows)]
            let builder = builder.additional_browser_args(
                "--disable-features=msWebOOUI,msPdfOOUI,msSmartScreenProtection --autoplay-policy=no-user-gesture-required",
            );
            let panel = builder.build()?;
            let moved = shared.clone();
            panel.on_window_event(move |event| {
                if let WindowEvent::Moved(_) = event {
                    Overlay::moved(&moved);
                }
            });

            {
                let mut overlay = lock(&shared);
                overlay.lay_out();
                tray::create(app.handle(), &overlay)?;
                overlay.restore_sessions();
            }
            tray::animate(app.handle().clone());

            // The endpoint's and the timers' threads never take the lock themselves:
            // they hand the work to the main thread (see overlay::on_main).
            let routes = app.handle().clone();
            let endpoint = server::serve(&dir, Arc::new(move |request| Overlay::route(&routes, request)))?;
            app.manage(endpoint);

            let ticking = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(5));
                on_main(&ticking, Overlay::tick);
            });
            let cleaning = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(Duration::from_secs(3600));
                on_main(&cleaning, Overlay::restore_sessions);
            });

            lock(&shared).show();
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("FlowCTL could not start");

    app.run(|app, event| match event {
        // The panel hides, never closes; the app quits from the tray.
        RunEvent::WindowEvent { label, event: WindowEvent::CloseRequested { api, .. }, .. } if label == PANEL => {
            api.prevent_close();
            lock(&app.state::<Shared>()).hide(core::registry::HiddenBy::User);
        }
        RunEvent::Exit => {
            if let Some(endpoint) = app.try_state::<server::Endpoint>() {
                endpoint.close();
            }
        }
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => {
            let shared = app.state::<Shared>();
            let mut overlay = lock(&shared);
            if core::registry::reopen_shows(overlay.hidden_by) {
                overlay.show();
            }
        }
        _ => {}
    });
}
