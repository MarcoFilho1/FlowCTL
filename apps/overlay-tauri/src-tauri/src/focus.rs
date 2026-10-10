//! Clicking a node brings its session's terminal forward. On Windows: the
//! first window owned by the Claude Code process or one of its ancestors
//! (Windows Terminal, VS Code, a console host). Tabs inside it are not
//! selected. On macOS this app is for development only: it activates the
//! terminal app; the Swift app selects the exact tab.

use serde_json::{Map, Value};

#[cfg(windows)]
pub fn bring_forward(terminal: Map<String, Value>) {
    let Some(pid) = terminal.get("pid").and_then(Value::as_u64).and_then(|p| u32::try_from(p).ok()) else { return };
    std::thread::spawn(move || {
        if !windows::focus_process_window(pid) {
            crate::overlay::log(&format!("no window found for pid {pid} or its parents"));
        }
    });
}

#[cfg(target_os = "macos")]
pub fn bring_forward(terminal: Map<String, Value>) {
    if let Some(app) =
        terminal.get("app").and_then(Value::as_str).filter(|a| a.chars().all(|c| c.is_ascii_alphanumeric() || c == '.' || c == '-'))
    {
        let _ = std::process::Command::new("open").args(["-b", app]).spawn();
    }
}

#[cfg(not(any(windows, target_os = "macos")))]
pub fn bring_forward(_terminal: Map<String, Value>) {}

#[cfg(windows)]
mod windows {
    use std::collections::HashMap;
    use windows_sys::Win32::Foundation::{CloseHandle, BOOL, HWND, INVALID_HANDLE_VALUE, LPARAM};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W, TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::UI::Input::KeyboardAndMouse::{keybd_event, KEYEVENTF_KEYUP, VK_MENU};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetWindow, GetWindowThreadProcessId, IsIconic, IsWindowVisible, SetForegroundWindow, ShowWindow, GW_OWNER, SW_RESTORE,
    };

    /// Each process's parent.
    fn parents() -> HashMap<u32, u32> {
        let mut out = HashMap::new();
        // SAFETY: a ToolHelp snapshot walked with a correctly sized entry, then closed.
        unsafe {
            let snapshot = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
            if snapshot == INVALID_HANDLE_VALUE {
                return out;
            }
            let mut entry: PROCESSENTRY32W = std::mem::zeroed();
            entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
            let mut more = Process32FirstW(snapshot, &mut entry);
            while more != 0 {
                out.insert(entry.th32ProcessID, entry.th32ParentProcessID);
                more = Process32NextW(snapshot, &mut entry);
            }
            CloseHandle(snapshot);
        }
        out
    }

    struct Search {
        pid: u32,
        found: HWND,
    }

    unsafe extern "system" fn visit(hwnd: HWND, data: LPARAM) -> BOOL {
        let search = &mut *(data as *mut Search);
        let mut owner = 0u32;
        GetWindowThreadProcessId(hwnd, &mut owner);
        if owner == search.pid && IsWindowVisible(hwnd) != 0 && GetWindow(hwnd, GW_OWNER).is_null() {
            search.found = hwnd;
            return 0;
        }
        1
    }

    fn window_of(pid: u32) -> Option<HWND> {
        let mut search = Search { pid, found: std::ptr::null_mut() };
        // SAFETY: the callback only reads windows and writes to `search`, which outlives the call.
        unsafe { EnumWindows(Some(visit), &mut search as *mut Search as LPARAM) };
        (!search.found.is_null()).then_some(search.found)
    }

    pub fn focus_process_window(pid: u32) -> bool {
        let parents = parents();
        let mut current = pid;
        for _ in 0..16 {
            if let Some(hwnd) = window_of(current) {
                // SAFETY: plain Win32 calls on a window handle EnumWindows returned.
                unsafe {
                    if IsIconic(hwnd) != 0 {
                        ShowWindow(hwnd, SW_RESTORE);
                    }
                    // Windows lets only the foreground process move focus; a
                    // tap of Alt counts as input and lifts that lock.
                    keybd_event(VK_MENU as u8, 0, 0, 0);
                    keybd_event(VK_MENU as u8, 0, KEYEVENTF_KEYUP, 0);
                    SetForegroundWindow(hwnd);
                }
                return true;
            }
            match parents.get(&current) {
                Some(&parent) if parent != 0 && parent != current => current = parent,
                _ => break,
            }
        }
        false
    }
}
