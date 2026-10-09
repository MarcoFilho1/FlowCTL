import Darwin

/// Whether a process is still running, for the pid a snapshot names.
public enum ProcessLiveness {
    /// `kill(pid, 0)` sends no signal: it only asks. ESRCH is the one answer
    /// that means the process is gone; EPERM means it exists under another user.
    public static func isAlive(_ pid: Int32) -> Bool {
        guard pid > 0 else { return false }
        if kill(pid, 0) == 0 { return true }
        return errno == EPERM
    }
}
