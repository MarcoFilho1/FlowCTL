//! The overlay: the sessions it knows, its settings, and the floating panel
//! that shows the viewer. As apps/overlay/Sources/FlowCTL/AppDelegate.swift
//! and WebBridge.swift: snapshots in, pushed to the page; the panel shows
//! itself when a session works and fades out after five idle minutes.

use crate::core::choices::{Anchor, Preferences};
use crate::core::geometry::{self, Rect};
use crate::core::http::{Request, Response};
use crate::core::registry::{self, HiddenBy, Outcome, Registry};
use crate::core::{files, snapshot};
use crate::{system, tray};
use serde_json::Value;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewWindow};

pub const PANEL: &str = "panel";

pub type Shared = Arc<Mutex<Overlay>>;

pub fn lock(shared: &Shared) -> MutexGuard<'_, Overlay> {
    shared.lock().unwrap_or_else(|poisoned| poisoned.into_inner())
}

/// Runs `job` with the overlay on the main thread, later (it does not wait).
///
/// Window, tray and menu calls made from any other thread wait for the main
/// thread to run them. A thread holding the lock while making one would wait
/// for the main thread while the main thread waits for the lock (a page
/// message, the panel moving, a tray click): both stop for good, and if the
/// panel was being dragged, Windows leaves the mouse captured by it. So the
/// lock is only ever held on the main thread; other threads hand it the work.
pub fn on_main(app: &AppHandle, job: impl FnOnce(&mut Overlay) + Send + 'static) {
    let handle = app.clone();
    if let Err(error) = app.run_on_main_thread(move || {
        let shared = handle.state::<Shared>();
        job(&mut lock(&shared));
    }) {
        log(&format!("could not reach the main thread: {error}"));
    }
}

pub fn log(message: &str) {
    eprintln!("[flowctl {:.3}] {message}", system::now());
}

pub struct Overlay {
    pub app: AppHandle,
    pub registry: Registry,
    pub prefs: Preferences,
    prefs_path: PathBuf,
    pub hidden_by: HiddenBy,
    pub visible: bool,
    /// The page has its bridge (window.flowctl) and has been sent everything.
    page_ready: bool,
    /// Bumped by every show and hide, so a fade-out a later show overtook does not hide the panel.
    fade: u64,
    /// The panel is being dragged by its grip: its next resting place becomes the anchor.
    pub dragging: bool,
    moved: u64,
}

impl Overlay {
    pub fn new(app: AppHandle) -> Self {
        let prefs_path = app.path().app_config_dir().unwrap_or_else(|_| system::flowctl_dir()).join("preferences.json");
        let prefs = std::fs::read(&prefs_path).map(|data| Preferences::parse(&data)).unwrap_or_default();
        let idle_after = std::env::var("FLOWCTL_IDLE_SECONDS")
            .ok()
            .filter(|_| std::env::var("FLOWCTL_DEBUG").as_deref() == Ok("1"))
            .and_then(|s| s.parse().ok())
            .unwrap_or(registry::IDLE_AFTER);
        Self {
            app,
            registry: Registry::new(system::now(), idle_after, Box::new(system::is_alive)),
            prefs,
            prefs_path,
            hidden_by: HiddenBy::Nobody,
            visible: false,
            page_ready: false,
            fade: 0,
            dragging: false,
            moved: 0,
        }
    }

    pub fn panel(&self) -> Option<WebviewWindow> {
        self.app.get_webview_window(PANEL)
    }

    fn eval(&self, script: &str) {
        if let Some(panel) = self.panel() {
            if let Err(error) = panel.eval(script) {
                log(&format!("page call failed: {error}"));
            }
        }
    }

    // MARK: snapshots

    /// The HTTP routes. Runs on a connection's thread, which never holds the
    /// lock: the work goes to the main thread (see `on_main`).
    pub fn route(app: &AppHandle, request: Request) -> Response {
        match (request.method.as_str(), request.path.as_str()) {
            ("GET", "/health") => Response::ok("ok\n"),
            ("POST", "/snapshot") => match snapshot::parse(&request.body) {
                Err(error) => Response::bad_request(&format!("not a schema 1 snapshot: {error}")),
                Ok(info) => {
                    // Answer at once; the page is updated after, in the order snapshots came.
                    on_main(app, move |overlay| overlay.receive(info, request.body));
                    Response::ok("accepted\n")
                }
            },
            // What automated checks read, without screen access (FLOWCTL_DEBUG=1 only).
            ("GET", "/debug/state") if std::env::var("FLOWCTL_DEBUG").as_deref() == Ok("1") => {
                let (sent, state) = std::sync::mpsc::channel();
                on_main(app, move |overlay| {
                    let _ = sent.send(overlay.debug_state());
                });
                match state.recv_timeout(Duration::from_secs(5)) {
                    Ok(state) => Response::ok(&format!("{state}\n")),
                    Err(_) => Response::bad_request("the main thread did not answer"),
                }
            }
            // Opening the app again (the Start menu, a second launch) shows the panel.
            ("POST", "/show") => {
                on_main(app, |overlay| {
                    if registry::reopen_shows(overlay.hidden_by) {
                        overlay.show();
                    }
                });
                Response::ok("ok\n")
            }
            (_, "/health" | "/snapshot" | "/show") => Response::method_not_allowed(),
            _ => Response::not_found(),
        }
    }

    fn receive(&mut self, info: snapshot::Info, body: Vec<u8>) {
        let state = info.state;
        let outcome = self.registry.accept(info, body, system::now());
        if outcome == Outcome::Stale {
            return;
        }
        self.flush();
        if registry::should_show(outcome, state, self.prefs.show_automatically, self.hidden_by) {
            self.show();
        }
        tray::refresh(self);
    }

    /// Sends the page what changed. Before the page is ready, it waits for `page_ready`.
    fn flush(&mut self) {
        if !self.page_ready {
            return;
        }
        for body in self.registry.pending_pushes(system::now()) {
            self.push(&body);
        }
    }

    fn push(&self, body: &[u8]) {
        // The body is JSON the server parsed, and JSON is a JavaScript expression.
        let json = String::from_utf8_lossy(body);
        self.eval(&format!("window.flowctl && window.flowctl.push({json});"));
    }

    /// Every five seconds: sessions whose process left end, ended tabs expire,
    /// and the panel fades out after five minutes without work.
    pub fn tick(&mut self) {
        let now = system::now();
        self.registry.reconcile(now);
        for id in self.registry.expire_ended(now) {
            let id = serde_json::to_string(&id).unwrap_or_default();
            self.eval(&format!("window.flowctl && window.flowctl.remove({id});"));
        }
        self.flush();
        if self.prefs.hide_when_idle && self.visible && self.registry.is_idle(now) {
            self.hide(HiddenBy::Idle);
        }
        tray::refresh(self);
    }

    /// Sessions the mod wrote while the overlay was closed; old and ended ones are deleted.
    pub fn restore_sessions(&mut self) {
        let dir = system::flowctl_dir().join("sessions");
        let plan = files::plan(files::read(&dir), system::now(), system::is_alive);
        for name in &plan.delete {
            let _ = std::fs::remove_file(dir.join(name));
        }
        for entry in plan.show {
            if let Ok(info) = snapshot::parse(&entry.data) {
                self.registry.accept(info, entry.data, entry.modified);
            }
        }
        self.flush();
    }

    // MARK: the page

    fn debug_state(&self) -> Value {
        let panel = self.panel();
        let frame = panel.as_ref().and_then(|p| {
            let (pos, size, scale) = (p.outer_position().ok()?, p.outer_size().ok()?, p.scale_factor().ok()?);
            Some([pos.x as f64 / scale, pos.y as f64 / scale, size.width as f64 / scale, size.height as f64 / scale])
        });
        let now = system::now();
        serde_json::json!({
            "visible": self.visible,
            "windowVisible": panel.as_ref().and_then(|p| p.is_visible().ok()),
            "hiddenBy": format!("{:?}", self.hidden_by),
            "pageReady": self.page_ready,
            "frame": frame,
            "activeSessions": self.registry.active_count(now),
            "waiting": self.registry.is_any_waiting(now),
            "prefs": self.prefs,
        })
    }

    /// The page has its bridge: send it the settings and every session.
    pub fn page_ready(&mut self) {
        log("page ready");
        self.page_ready = true;
        self.send_options();
        for body in self.registry.replay_bodies(system::now()) {
            self.push(&body);
        }
        self.apply_opacity(false);
    }

    fn send_options(&self) {
        let p = &self.prefs;
        self.eval(&format!(
            "(() => {{ const f = window.flowctl; if (!f) return; \
             f.setLook && f.setLook({look:?}); f.setTheme && f.setTheme({theme:?}); \
             f.setShowSubagents && f.setShowSubagents({subagents}); f.setSound && f.setSound({sound}); \
             f.setSoundStyle && f.setSoundStyle({style:?}); f.setIdleAnimation && f.setIdleAnimation({idle}); }})();",
            look = p.look.as_str(),
            theme = p.theme.as_str(),
            subagents = p.show_subagents,
            sound = p.sound,
            style = p.sound_style.as_str(),
            idle = p.idle_animation,
        ));
    }

    /// What the page tells the app (store.ts NativeMessage).
    pub fn message(&mut self, message: &Value) {
        match message["type"].as_str() {
            Some("close") => self.hide(HiddenBy::User),
            Some("focus") => {
                let session = message["sessionId"].as_str().unwrap_or("");
                if let Some(found) = self.registry.session(session) {
                    crate::focus::bring_forward(snapshot::terminal(&found.body));
                }
            }
            // The grip is handled in the page (the init script); the size is legacy.
            Some("grip" | "size") => {}
            other => log(&format!("unknown page message {other:?}")),
        }
    }

    // MARK: the panel

    /// Opacity is the page's: the window is transparent and the page draws all of it.
    fn apply_opacity(&self, animated: bool) {
        let seconds = if animated { 0.25 } else { 0.0 };
        self.eval(&format!(
            "document.documentElement.style.transition = 'opacity {seconds}s'; document.documentElement.style.opacity = '{}';",
            self.prefs.opacity
        ));
    }

    pub fn show(&mut self) {
        self.hidden_by = HiddenBy::Nobody;
        self.fade += 1;
        let Some(panel) = self.panel() else { return };
        if !self.visible {
            self.eval("document.documentElement.style.transition = 'none'; document.documentElement.style.opacity = '0';");
            let _ = panel.show();
            self.visible = true;
            // Two frames later, so the page has drawn at 0 before it fades in.
            self.eval(&format!(
                "requestAnimationFrame(() => requestAnimationFrame(() => {{ document.documentElement.style.transition = 'opacity 0.25s'; document.documentElement.style.opacity = '{}'; }}));",
                self.prefs.opacity
            ));
        }
        tray::refresh(self);
    }

    pub fn hide(&mut self, by: HiddenBy) {
        self.hidden_by = by;
        if !self.visible {
            return;
        }
        self.fade += 1;
        let fade = self.fade;
        let seconds = if by == HiddenBy::Idle { 0.8 } else { 0.25 };
        self.eval(&format!(
            "document.documentElement.style.transition = 'opacity {seconds}s'; document.documentElement.style.opacity = '0';"
        ));
        let app = self.app.clone();
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_secs_f64(seconds + 0.05));
            on_main(&app, move |overlay| {
                if overlay.fade == fade {
                    if let Some(panel) = overlay.panel() {
                        let _ = panel.hide();
                    }
                    overlay.visible = false;
                    tray::refresh(overlay);
                }
            });
        });
    }

    pub fn toggle(&mut self) {
        if self.visible {
            self.hide(HiddenBy::User);
        } else {
            self.show();
        }
    }

    /// The screen the anchor is on, as a logical work area, else the primary one.
    fn screen_for(&self, panel: &WebviewWindow, point: Option<(f64, f64)>) -> Option<Rect> {
        let logical = |m: &tauri::Monitor| {
            let area = m.work_area();
            let s = m.scale_factor();
            Rect {
                x: area.position.x as f64 / s,
                y: area.position.y as f64 / s,
                w: area.size.width as f64 / s,
                h: area.size.height as f64 / s,
            }
        };
        let monitors = panel.available_monitors().unwrap_or_default();
        if let Some((x, y)) = point {
            if let Some(found) = monitors.iter().map(logical).find(|r| r.holds(x, y)) {
                return Some(found);
            }
        }
        panel.primary_monitor().ok().flatten().map(|m| logical(&m)).or_else(|| monitors.first().map(logical))
    }

    /// Places the panel: its size from the menu, its anchor corner where it was left.
    pub fn lay_out(&self) {
        let Some(panel) = self.panel() else { return };
        let anchor = self.prefs.anchor.map(|a| (a.corner, (a.x, a.y)));
        let Some(screen) = self.screen_for(&panel, anchor.map(|a| a.1)) else { return };
        let (corner, point) = anchor.filter(|(_, (x, y))| screen.holds(*x, *y)).unwrap_or_else(|| geometry::default_anchor(screen));
        let size = geometry::fit(self.prefs.panel_size.size(), screen);
        let frame = geometry::frame(size, corner, point, screen);
        let _ = panel.set_size(LogicalSize::new(frame.w, frame.h));
        let _ = panel.set_position(LogicalPosition::new(frame.x, frame.y));
    }

    /// After the panel moved: once it rests, the dragged-to corner becomes the anchor.
    /// Called on the main thread (a window event, the drag command).
    pub fn moved(shared: &Shared) {
        let (generation, app) = {
            let mut overlay = lock(shared);
            if !overlay.dragging {
                return;
            }
            overlay.moved += 1;
            (overlay.moved, overlay.app.clone())
        };
        std::thread::spawn(move || {
            std::thread::sleep(Duration::from_millis(400));
            on_main(&app, move |overlay| {
                if overlay.moved == generation {
                    overlay.dragging = false;
                    overlay.reanchor();
                }
            });
        });
    }

    fn reanchor(&mut self) {
        let Some(panel) = self.panel() else { return };
        let (Ok(position), Ok(size), Ok(scale)) = (panel.outer_position(), panel.outer_size(), panel.scale_factor()) else { return };
        let frame = Rect {
            x: position.x as f64 / scale,
            y: position.y as f64 / scale,
            w: size.width as f64 / scale,
            h: size.height as f64 / scale,
        };
        let Some(screen) = self.screen_for(&panel, Some((frame.mid_x(), frame.mid_y()))) else { return };
        let (corner, (x, y)) = geometry::reanchor(frame, screen);
        self.prefs.anchor = Some(Anchor { corner, x, y });
        self.save();
    }

    pub fn save(&self) {
        if let Some(dir) = self.prefs_path.parent() {
            let _ = std::fs::create_dir_all(dir);
        }
        if let Err(error) = system::write_atomically(&self.prefs_path, &self.prefs.to_json()) {
            log(&format!("could not save preferences: {error}"));
        }
    }

    /// After a menu change: save, and apply everything that may have changed.
    pub fn preferences_changed(&mut self) {
        self.save();
        if let Some(panel) = self.panel() {
            let _ = panel.set_always_on_top(self.prefs.always_on_top);
        }
        self.apply_opacity(true);
        self.send_options();
        self.lay_out();
        tray::refresh(self);
    }
}
