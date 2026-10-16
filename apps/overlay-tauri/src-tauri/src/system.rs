//! What the overlay asks the system: where ~/.flowctl is, whether a process
//! still runs, whether motion should be reduced.

use std::path::PathBuf;

/// The person's home folder: HOME, else USERPROFILE (Windows), as the mod reads it.
pub fn home() -> PathBuf {
    let read = |name: &str| std::env::var_os(name).filter(|value| !value.is_empty());
    read("HOME").or_else(|| read("USERPROFILE")).map(PathBuf::from).unwrap_or_else(|| PathBuf::from("."))
}

/// ~/.flowctl, shared with the mod, private to the person.
pub fn flowctl_dir() -> PathBuf {
    home().join(".flowctl")
}

pub fn now() -> f64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs_f64()).unwrap_or(0.0)
}

/// Creates ~/.flowctl and its sessions folder, and keeps them the person's alone.
pub fn prepare_dirs() -> std::io::Result<()> {
    let dir = flowctl_dir();
    std::fs::create_dir_all(dir.join("sessions"))?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(&dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

/// Whether the process still runs. A process of another user counts as running.
#[cfg(unix)]
pub fn is_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    // SAFETY: signal 0 only checks that the pid exists and may be signalled.
    let result = unsafe { libc::kill(pid as i32, 0) };
    result == 0 || std::io::Error::last_os_error().raw_os_error() == Some(libc::EPERM)
}

#[cfg(windows)]
pub fn is_alive(pid: u32) -> bool {
    use windows_sys::Win32::Foundation::{CloseHandle, GetLastError, ERROR_ACCESS_DENIED, STILL_ACTIVE};
    use windows_sys::Win32::System::Threading::{GetExitCodeProcess, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION};
    if pid == 0 {
        return false;
    }
    // SAFETY: plain Win32 calls on a handle this function opens and closes.
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if handle.is_null() {
            return GetLastError() == ERROR_ACCESS_DENIED;
        }
        let mut code = 0u32;
        let ok = GetExitCodeProcess(handle, &mut code);
        CloseHandle(handle);
        ok != 0 && code == STILL_ACTIVE as u32
    }
}

/// Whether the person asked the system for less motion: the tray node then holds still.
#[cfg(windows)]
pub fn reduce_motion() -> bool {
    use windows_sys::Win32::UI::WindowsAndMessaging::{SystemParametersInfoW, SPI_GETCLIENTAREAANIMATION};
    let mut animate: i32 = 1;
    // SAFETY: SPI_GETCLIENTAREAANIMATION writes one BOOL to the pointer.
    let ok = unsafe { SystemParametersInfoW(SPI_GETCLIENTAREAANIMATION, 0, &mut animate as *mut i32 as *mut _, 0) };
    ok != 0 && animate == 0
}

#[cfg(not(windows))]
pub fn reduce_motion() -> bool {
    false
}

/// Windows' accent color as "#rrggbb" (Settings > Personalization > Colors),
/// read where the shell keeps it; Windows 11's default blue when it is not there.
#[cfg(windows)]
pub fn accent_color() -> String {
    use windows_sys::Win32::System::Registry::{RegGetValueW, HKEY_CURRENT_USER, RRF_RT_REG_DWORD};
    let wide = |s: &str| s.encode_utf16().chain(std::iter::once(0)).collect::<Vec<u16>>();
    let (key, name) = (wide("Software\\Microsoft\\Windows\\DWM"), wide("AccentColor"));
    let mut value: u32 = 0;
    let mut size = std::mem::size_of::<u32>() as u32;
    // SAFETY: RRF_RT_REG_DWORD writes at most `size` bytes (one DWORD) to `value`.
    let status = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            key.as_ptr(),
            name.as_ptr(),
            RRF_RT_REG_DWORD,
            std::ptr::null_mut(),
            &mut value as *mut u32 as *mut _,
            &mut size,
        )
    };
    if status != 0 {
        return DEFAULT_ACCENT.to_string();
    }
    // Stored as 0xAABBGGRR.
    format!("#{:02x}{:02x}{:02x}", value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff)
}

#[cfg(not(windows))]
pub fn accent_color() -> String {
    DEFAULT_ACCENT.to_string()
}

const DEFAULT_ACCENT: &str = "#0067c0";

/// A random token for the Windows endpoint, 32 hex digits.
pub fn token() -> String {
    let mut bytes = [0u8; 16];
    getrandom::fill(&mut bytes).expect("the system has randomness");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// Writes a file whole: to a temporary name first, then renamed over, so a reader never sees half of it.
pub fn write_atomically(path: &std::path::Path, data: &[u8]) -> std::io::Result<()> {
    let temp = path.with_extension(format!("tmp{}", std::process::id()));
    std::fs::write(&temp, data)?;
    std::fs::rename(&temp, path)
}

#[cfg(test)]
mod tests {
    #[test]
    fn this_process_is_alive_and_pid_zero_is_not() {
        assert!(super::is_alive(std::process::id()));
        assert!(!super::is_alive(0));
    }

    #[test]
    fn tokens_are_long_and_differ() {
        let (a, b) = (super::token(), super::token());
        assert_eq!(a.len(), 32);
        assert_ne!(a, b);
    }
}
