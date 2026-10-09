import Foundation

/// The terminal a session runs in, as the mod writes it in the snapshot's
/// optional `terminal` field.
public struct TerminalInfo: Equatable {
    /// Bundle id of the terminal app.
    public let app: String?
    /// TERM_PROGRAM.
    public let program: String?
    /// The session's tty, `ttys021` or `/dev/ttys021`.
    public let tty: String?
    /// ITERM_SESSION_ID, TERM_SESSION_ID, MAESTRI_TERMINAL_ID when set.
    public let ids: [String: String]

    public init(app: String? = nil, program: String? = nil, tty: String? = nil, ids: [String: String] = [:]) {
        self.app = app
        self.program = program
        self.tty = tty
        self.ids = ids
    }

    /// Reads `snapshot.terminal`; nil when absent or not an object.
    public static func from(snapshot data: Data) -> TerminalInfo? {
        guard let object = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any],
              let terminal = object["terminal"] as? [String: Any]
        else { return nil }
        let ids = (terminal["ids"] as? [String: Any] ?? [:]).compactMapValues { $0 as? String }
        return TerminalInfo(app: terminal["app"] as? String, program: terminal["program"] as? String, tty: terminal["tty"] as? String, ids: ids)
    }
}

/// What clicking a node does to reach its session.
public enum FocusAction: Equatable {
    /// Terminal.app: select the tab whose tty matches.
    case terminalTab(tty: String)
    /// iTerm2: select the session with this unique id, or else this tty.
    case iTermSession(uniqueId: String?, tty: String?)
    /// Any other terminal: bring the app forward.
    case activate(bundleId: String)
    /// Nothing known about the terminal.
    case none

    public static let terminalApp = "com.apple.Terminal"
    public static let iTerm = "com.googlecode.iterm2"

    /// TERM_PROGRAM values and the apps that set them, for snapshots without `app`.
    static let programs: [String: String] = [
        "Apple_Terminal": terminalApp,
        "iTerm.app": iTerm,
        "Maestri": "com.evercraftlabs.Maestro",
        "vscode": "com.microsoft.VSCode",
        "ghostty": "com.mitchellh.ghostty",
        "WezTerm": "com.github.wez.wezterm",
        "WarpTerminal": "dev.warp.Warp-Stable",
        "kitty": "net.kovidgoyal.kitty"
    ]

    public static func plan(for terminal: TerminalInfo?) -> FocusAction {
        guard let terminal else { return .none }
        let bundleId = terminal.app.flatMap(validBundleId) ?? terminal.program.flatMap { programs[$0] }
        let tty = terminal.tty.flatMap(devicePath)
        switch bundleId {
        case terminalApp?:
            return tty.map { .terminalTab(tty: $0) } ?? .activate(bundleId: terminalApp)
        case iTerm?:
            let uniqueId = terminal.ids["ITERM_SESSION_ID"].flatMap(iTermUniqueId)
            return uniqueId == nil && tty == nil ? .activate(bundleId: iTerm) : .iTermSession(uniqueId: uniqueId, tty: tty)
        case let other?:
            return .activate(bundleId: other)
        case nil:
            return .none
        }
    }

    /// `/dev/ttysNNN` from `ttysNNN` or `/dev/ttysNNN`; nil for anything else,
    /// so only a plain device path ever reaches a script.
    public static func devicePath(_ tty: String) -> String? {
        let name = tty.hasPrefix("/dev/") ? String(tty.dropFirst(5)) : tty
        guard name.range(of: #"^ttys?[0-9]{1,4}$"#, options: .regularExpression) != nil else { return nil }
        return "/dev/" + name
    }

    /// The UUID of `w0t1p0:UUID`, the form iTerm2 puts in ITERM_SESSION_ID.
    public static func iTermUniqueId(_ sessionId: String) -> String? {
        let uuid = sessionId.split(separator: ":").last.map(String.init) ?? sessionId
        return UUID(uuidString: uuid) != nil ? uuid.uppercased() : nil
    }

    static func validBundleId(_ id: String) -> String? {
        id.range(of: #"^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)+$"#, options: .regularExpression) != nil ? id : nil
    }

    /// The AppleScript for the scripted cases; nil for the rest. It returns
    /// "found" or "missing". Values in it come only from devicePath and
    /// iTermUniqueId, which allow no quotes.
    public var appleScript: String? {
        switch self {
        case .terminalTab(let tty):
            return """
            tell application id "\(Self.terminalApp)"
                repeat with w in windows
                    repeat with t in tabs of w
                        if tty of t is "\(tty)" then
                            set selected of t to true
                            set index of w to 1
                            activate
                            return "found"
                        end if
                    end repeat
                end repeat
            end tell
            return "missing"
            """
        case .iTermSession(let uniqueId, let tty):
            return """
            tell application id "\(Self.iTerm)"
                repeat with w in windows
                    repeat with t in tabs of w
                        repeat with s in sessions of t
                            if (unique id of s is "\(uniqueId ?? "-")") or (tty of s is "\(tty ?? "-")") then
                                select w
                                select t
                                select s
                                activate
                                return "found"
                            end if
                        end repeat
                    end repeat
                end repeat
            end tell
            return "missing"
            """
        case .activate, .none:
            return nil
        }
    }

    /// The app to bring forward when the script cannot run (no permission,
    /// tab not found) or there is none.
    public var fallbackBundleId: String? {
        switch self {
        case .terminalTab: return Self.terminalApp
        case .iTermSession: return Self.iTerm
        case .activate(let bundleId): return bundleId
        case .none: return nil
        }
    }
}
