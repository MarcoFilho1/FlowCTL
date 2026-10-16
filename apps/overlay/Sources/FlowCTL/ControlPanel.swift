import AppKit
import FlowCTLCore
import SwiftUI

// What the menu bar icon opens: in place of a plain menu, a glass panel in the
// manner of Control Center, with the sessions, round toggles and the look.

/// A session as the panel lists it.
struct SessionRow: Identifiable, Equatable {
    let id: String
    /// The project folder's name, as the viewer's tab.
    let name: String
    let state: SessionState
}

/// What the panel and the Settings window read and change.
final class ControlModel: ObservableObject {
    /// Drives the panel's appear and disappear animation.
    @Published var visible = false
    /// Where the menu bar icon sits along the panel's top edge (0…1): the panel grows from there.
    @Published var anchorX = 0.5

    weak var actions: StatusMenuActions?

    var prefs: Preferences? { actions?.preferences }
    var sessions: [SessionRow] { actions?.sessionRows ?? [] }
    var isOverlayShown: Bool { actions?.isPanelVisible ?? false }
    var version: String { Bundle.main.object(forInfoDictionaryKey: "CFBundleShortVersionString") as? String ?? "dev" }

    /// Something the views read changed elsewhere (a session, a preference, the overlay shown or hidden).
    func refresh() { objectWillChange.send() }

    /// A binding to one preference: setting it saves it and applies it everywhere.
    func binding<Value>(_ key: ReferenceWritableKeyPath<Preferences, Value>, fallback: Value) -> Binding<Value> {
        Binding(
            get: { [weak self] in self?.prefs?[keyPath: key] ?? fallback },
            set: { [weak self] value in
                guard let self, let prefs = self.prefs else { return }
                prefs[keyPath: key] = value
                self.actions?.preferencesChanged()
                self.refresh()
            }
        )
    }

    func toggle(_ key: ReferenceWritableKeyPath<Preferences, Bool>) {
        guard let prefs else { return }
        prefs[keyPath: key].toggle()
        actions?.preferencesChanged()
        refresh()
    }

    // The panel's buttons; the status item fills these in.
    var toggleOverlay: () -> Void = {}
    var focusSession: (String) -> Void = { _ in }
    var openSettings: () -> Void = {}
    var showAbout: () -> Void = {}
    var quit: () -> Void = {}
}

struct ControlPanelView: View {
    static let width: CGFloat = 320
    /// Room around the glass for its shadow.
    static let margin: CGFloat = 26
    /// Four session rows, always: a session that comes or goes does not move the buttons below.
    static let sessionRows = 4
    static let sessionsHeight: CGFloat = CGFloat(sessionRows) * 24 + CGFloat(sessionRows - 1) * 6

    @ObservedObject var model: ControlModel
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: 10) {
            header
            overlayTile
            sessionsTile
            HStack(spacing: 10) {
                ToggleTile(symbol: soundOn ? "speaker.wave.2.fill" : "speaker.slash.fill", on: soundOn,
                           title: "Sound", subtitle: model.prefs?.soundChoice.title ?? "") { toggleSound() }
                ToggleTile(symbol: "pin.fill", on: model.prefs?.alwaysOnTop ?? true,
                           title: "On Top", subtitle: onOff(model.prefs?.alwaysOnTop)) { model.toggle(\.alwaysOnTop) }
            }
            HStack(spacing: 10) {
                ToggleTile(symbol: "rectangle.inset.topright.filled", on: model.prefs?.showAutomatically ?? true,
                           title: "Auto Show", subtitle: onOff(model.prefs?.showAutomatically)) { model.toggle(\.showAutomatically) }
                ToggleTile(symbol: "moon.zzz.fill", on: model.prefs?.hideWhenIdle ?? true,
                           title: "Auto Hide", subtitle: onOff(model.prefs?.hideWhenIdle)) { model.toggle(\.hideWhenIdle) }
            }
            lookTile
            Divider().padding(.horizontal, 6).padding(.top, 2)
            VStack(spacing: 0) {
                TextRow(title: "Settings…", shortcut: "⌘,", action: model.openSettings)
                TextRow(title: "About FlowCTL", action: model.showAbout)
                TextRow(title: "Quit FlowCTL", shortcut: "⌘Q", action: model.quit)
            }
        }
        .padding(12)
        .frame(width: Self.width)
        .modifier(GlassBackground(cornerRadius: 24))
        .shadow(color: .black.opacity(0.22), radius: 18, y: 8)
        .scaleEffect(model.visible ? 1 : (reduceMotion ? 0.98 : 0.5), anchor: UnitPoint(x: model.anchorX, y: 0))
        .opacity(model.visible ? 1 : 0)
        .padding(.horizontal, Self.margin)
        .padding(.top, 2)
        .padding(.bottom, Self.margin)
    }

    private var soundOn: Bool { model.prefs?.sound ?? true }

    /// Off goes back to what the person had before (the look's sounds the first time).
    private func toggleSound() {
        guard let prefs = model.prefs else { return }
        prefs.soundChoice = prefs.sound ? .off : SoundChoice.from(sound: true, style: prefs.soundStyle)
        model.actions?.preferencesChanged()
        model.refresh()
    }

    private func onOff(_ on: Bool?) -> String { on ?? false ? "On" : "Off" }

    private var header: some View {
        HStack(spacing: 8) {
            Image(nsImage: NSApp.applicationIconImage)
                .resizable()
                .frame(width: 22, height: 22)
            Text("FlowCTL")
                .font(.system(size: 13, weight: .semibold))
            Spacer()
            Text(model.version)
                .font(.system(size: 11).monospacedDigit())
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 6)
        .padding(.top, 2)
    }

    /// The overlay itself: the big round button shows or hides it.
    private var overlayTile: some View {
        let shown = model.isOverlayShown
        let waiting = model.sessions.filter { $0.state == .waitingYou }.count
        let working = model.sessions.filter { $0.state == .working }.count
        return Button(action: model.toggleOverlay) {
            HStack(spacing: 12) {
                ZStack {
                    Circle().fill(shown ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Color.primary.opacity(0.1)))
                    Image(systemName: "point.3.connected.trianglepath.dotted")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(shown ? AnyShapeStyle(.white) : AnyShapeStyle(.secondary))
                }
                .frame(width: 38, height: 38)
                VStack(alignment: .leading, spacing: 2) {
                    Text(shown ? "Overlay Shown" : "Overlay Hidden")
                        .font(.system(size: 13, weight: .semibold))
                    HStack(spacing: 5) {
                        Circle().fill(waiting > 0 ? StateColor.waiting : working > 0 ? StateColor.working : Color.secondary)
                            .frame(width: 6, height: 6)
                        Text(summary(working: working, waiting: waiting))
                            .font(.system(size: 11))
                            .foregroundStyle(.secondary)
                            .lineLimit(1)
                    }
                }
                Spacer(minLength: 0)
                Text(shown ? "Hide" : "Show")
                    .font(.system(size: 12, weight: .semibold))
                    .padding(.horizontal, 12)
                    .padding(.vertical, 5)
                    .foregroundStyle(shown ? AnyShapeStyle(.primary) : AnyShapeStyle(.white))
                    .background(shown ? AnyShapeStyle(Color.primary.opacity(0.1)) : AnyShapeStyle(Color.accentColor), in: Capsule())
            }
            .padding(12)
            .background(Tile())
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private func summary(working: Int, waiting: Int) -> String {
        if waiting > 0 { return waiting == 1 ? "A session needs you" : "\(waiting) sessions need you" }
        if working > 0 { return working == 1 ? "1 session working" : "\(working) sessions working" }
        return "Nothing running"
    }

    private var sessionsTile: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Sessions")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.secondary)
            VStack(alignment: .leading, spacing: 6) {
                ForEach(model.sessions.prefix(Self.sessionRows)) { session in
                    SessionLine(session: session) { model.focusSession(session.id) }
                }
            }
            .frame(maxWidth: .infinity, minHeight: Self.sessionsHeight, maxHeight: Self.sessionsHeight, alignment: .top)
            .overlay {
                if model.sessions.isEmpty {
                    VStack(spacing: 6) {
                        Image(systemName: "terminal")
                            .font(.system(size: 20))
                            .foregroundStyle(.tertiary)
                        Text("Start Claude Code in a terminal.")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .clipped()
            if model.sessions.count > Self.sessionRows {
                Text("and \(model.sessions.count - Self.sessionRows) more in the overlay")
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(Tile())
    }

    private var lookTile: some View {
        HStack(spacing: 10) {
            Text("Look")
                .font(.system(size: 12, weight: .semibold))
            Spacer(minLength: 8)
            Picker("Look", selection: model.binding(\.look, fallback: .standard)) {
                ForEach(PageLook.allCases, id: \.self) { Text($0.title).tag($0) }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .frame(width: 150)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 9)
        .background(Tile())
    }
}

/// The viewer's state colors: blue working, yellow waiting on the person.
enum StateColor {
    static let working = Color(red: 0x4c / 255, green: 0x8d / 255, blue: 0xff / 255)
    static let waiting = Color(red: 0xf2 / 255, green: 0xc9 / 255, blue: 0x4c / 255)

    static func of(_ state: SessionState) -> Color {
        switch state {
        case .working: return working
        case .waitingYou: return waiting
        case .idle, .ended: return Color.secondary.opacity(0.6)
        }
    }

    static func text(_ state: SessionState) -> String {
        switch state {
        case .working: return "Working"
        case .waitingYou: return "Needs you"
        case .idle: return "Idle"
        case .ended: return "Ended"
        }
    }
}

/// One session: its state dot, its folder and what it is doing. A click brings its terminal forward.
private struct SessionLine: View {
    let session: SessionRow
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                Circle().fill(StateColor.of(session.state)).frame(width: 8, height: 8)
                Text(session.name)
                    .font(.system(size: 12))
                    .lineLimit(1)
                    .truncationMode(.middle)
                Spacer(minLength: 4)
                Text(StateColor.text(session.state))
                    .font(.system(size: 11))
                    .foregroundStyle(.secondary)
                Image(systemName: "arrow.up.forward.app")
                    .font(.system(size: 10))
                    .foregroundStyle(.tertiary)
                    .opacity(hover ? 1 : 0)
            }
            .frame(height: 24)
            .padding(.horizontal, 6)
            .background(RoundedRectangle(cornerRadius: 7, style: .continuous).fill(Color.primary.opacity(hover ? 0.08 : 0)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .help("Bring this session's terminal forward")
    }
}

/// The modules' ground, as Control Center's.
private struct Tile: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.primary.opacity(0.06))
    }
}

/// A round button that turns blue when on, as Control Center's.
private struct ToggleTile: View {
    let symbol: String
    let on: Bool
    let title: String
    let subtitle: String
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack(spacing: 9) {
                ZStack {
                    Circle().fill(on ? AnyShapeStyle(Color.accentColor) : AnyShapeStyle(Color.primary.opacity(0.1)))
                    Image(systemName: symbol)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(on ? AnyShapeStyle(.white) : AnyShapeStyle(.primary))
                }
                .frame(width: 30, height: 30)
                VStack(alignment: .leading, spacing: 1) {
                    Text(title).font(.system(size: 12, weight: .semibold)).lineLimit(1)
                    Text(subtitle).font(.system(size: 11)).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(10)
            .frame(maxWidth: .infinity)
            .background(RoundedRectangle(cornerRadius: 16, style: .continuous).fill(Color.primary.opacity(hover ? 0.1 : 0.06)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
        .animation(.easeOut(duration: 0.2), value: on)
    }
}

/// A line of text at the bottom, as Control Center's "Control Center Settings…".
private struct TextRow: View {
    let title: String
    var shortcut: String?
    let action: () -> Void
    @State private var hover = false

    var body: some View {
        Button(action: action) {
            HStack {
                Text(title).font(.system(size: 13))
                Spacer()
                if let shortcut {
                    Text(shortcut).font(.system(size: 12)).foregroundStyle(.tertiary)
                }
            }
            .padding(.horizontal, 8)
            .padding(.vertical, 5)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(Color.primary.opacity(hover ? 0.08 : 0)))
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .onHover { hover = $0 }
    }
}

/// macOS 26's glass (Control Center's) over a blur of what is behind the
/// window, so the text stays readable on any background. Earlier systems get
/// the blur with a thin light edge.
struct GlassBackground: ViewModifier {
    let cornerRadius: CGFloat

    func body(content: Content) -> some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
        let frosted = content.background(BehindWindowBlur().clipShape(shape))
        #if compiler(>=6.2)
        if #available(macOS 26, *) {
            frosted.glassEffect(.regular, in: shape)
        } else {
            frosted.overlay(shape.strokeBorder(.white.opacity(0.15)))
        }
        #else
        frosted.overlay(shape.strokeBorder(.white.opacity(0.15)))
        #endif
    }
}

struct BehindWindowBlur: NSViewRepresentable {
    func makeNSView(context: Context) -> NSVisualEffectView {
        let view = NSVisualEffectView()
        view.material = .popover
        view.blendingMode = .behindWindow
        view.state = .active
        return view
    }

    func updateNSView(_ view: NSVisualEffectView, context: Context) {}
}

// MARK: Window

/// Takes the keyboard (Esc closes it) without activating the app or taking
/// the focus from where the person is.
private final class ControlPanelWindow: NSPanel {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { false }
}

final class ControlPanelController {
    let model: ControlModel
    var onVisibleChange: (Bool) -> Void = { _ in }

    private let window: ControlPanelWindow
    private let hosting: NSHostingView<ControlPanelView>
    private var monitors: [Any] = []
    /// Debug hooks: a click elsewhere does not close it.
    var keepOpen = false

    init(model: ControlModel) {
        self.model = model
        window = ControlPanelWindow(contentRect: .zero, styleMask: [.borderless, .nonactivatingPanel], backing: .buffered, defer: true)
        window.isOpaque = false
        window.backgroundColor = .clear
        window.hasShadow = false
        window.level = .popUpMenu
        window.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary, .transient, .ignoresCycle]
        window.isReleasedWhenClosed = false
        window.hidesOnDeactivate = false
        window.animationBehavior = .none
        hosting = NSHostingView(rootView: ControlPanelView(model: model))
        window.contentView = hosting
    }

    var isVisible: Bool { model.visible }
    var debugWindow: NSWindow { window }

    func toggle(below icon: NSRect) {
        model.visible ? hide() : show(below: icon)
    }

    func show(below icon: NSRect) {
        model.refresh()
        place(below: icon)
        window.makeKeyAndOrderFront(nil)
        onVisibleChange(true)
        withAnimation(.spring(response: 0.36, dampingFraction: 0.82)) { model.visible = true }
        if keepOpen { return }
        // A click anywhere else, or Esc, closes it, as a menu.
        monitors = [
            NSEvent.addGlobalMonitorForEvents(matching: [.leftMouseDown, .rightMouseDown]) { [weak self] _ in self?.hide() },
            NSEvent.addLocalMonitorForEvents(matching: .keyDown) { [weak self] event in
                guard event.keyCode == 53 else { return event }
                self?.hide()
                return nil
            }
        ].compactMap { $0 }
    }

    func hide() {
        guard model.visible else { return }
        monitors.forEach(NSEvent.removeMonitor)
        monitors = []
        withAnimation(.easeIn(duration: 0.16)) { model.visible = false }
        onVisibleChange(false)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) { [weak self] in
            guard let self, !self.model.visible else { return }
            self.window.orderOut(nil)
        }
    }

    /// Below the icon, hung from its top, centred on it without leaving the screen.
    private func place(below icon: NSRect) {
        let size = hosting.fittingSize
        let screen = NSScreen.screens.first { NSMouseInRect(NSPoint(x: icon.midX, y: icon.midY), $0.frame, false) } ?? NSScreen.main
        let bounds = screen?.frame ?? icon
        let width = ControlPanelView.width
        let glassX = min(max(icon.midX - width / 2, bounds.minX + 8), bounds.maxX - 8 - width)
        window.setFrame(NSRect(x: glassX - ControlPanelView.margin, y: icon.minY - 6 - size.height, width: size.width, height: size.height), display: true)
        model.anchorX = min(max((icon.midX - glassX) / width, 0), 1)
    }
}
