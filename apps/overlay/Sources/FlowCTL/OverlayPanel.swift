import AppKit

/// The floating panel: never activates the app (the terminal keeps focus),
/// shows on every Space and over full-screen apps, translucent. The title bar
/// is transparent and only its close button shows; the page starts below it.
final class OverlayPanel: NSPanel {
    static let titleBarHeight: CGFloat = 28
    static let defaultSize = NSSize(width: 360, height: 480)
    private static let autosaveName = "FlowCTL.panel"

    /// Close button, ⌘W: the panel hides, the app keeps running.
    var onHide: (() -> Void)?

    init(content: NSView) {
        super.init(
            contentRect: NSRect(origin: .zero, size: Self.defaultSize),
            styleMask: [.titled, .closable, .resizable, .fullSizeContentView, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        title = "FlowCTL"
        titleVisibility = .hidden
        titlebarAppearsTransparent = true
        isFloatingPanel = true
        hidesOnDeactivate = false
        // Key only once the person clicks it (see canBecomeKey), never when it
        // pops up: a key non-activating panel would take the terminal's typing.
        becomesKeyOnlyIfNeeded = false
        isMovableByWindowBackground = true
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        minSize = NSSize(width: 240, height: 200)
        isOpaque = false
        backgroundColor = .clear
        standardWindowButton(.miniaturizeButton)?.isHidden = true
        standardWindowButton(.zoomButton)?.isHidden = true
        standardWindowButton(.closeButton)?.toolTip = "Hide panel (⌘W)"

        let blur = NSVisualEffectView()
        blur.material = .popover
        blur.blendingMode = .behindWindow
        blur.state = .active
        contentView = blur

        let label = NSTextField(labelWithString: "FlowCTL")
        label.font = .systemFont(ofSize: 11, weight: .semibold)
        label.textColor = .secondaryLabelColor
        label.translatesAutoresizingMaskIntoConstraints = false
        content.translatesAutoresizingMaskIntoConstraints = false
        blur.addSubview(label)
        blur.addSubview(content)
        NSLayoutConstraint.activate([
            label.centerXAnchor.constraint(equalTo: blur.centerXAnchor),
            label.centerYAnchor.constraint(equalTo: blur.topAnchor, constant: Self.titleBarHeight / 2),
            content.topAnchor.constraint(equalTo: blur.topAnchor, constant: Self.titleBarHeight),
            content.leadingAnchor.constraint(equalTo: blur.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: blur.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: blur.bottomAnchor)
        ])

        restoreFrame()
    }

    /// Size and place from last time (NSWindow keeps it in UserDefaults), or
    /// the top-right corner of the main screen when that place is off screen.
    private func restoreFrame() {
        setFrameAutosaveName(Self.autosaveName)
        let restored = setFrameUsingName(Self.autosaveName)
        let onScreen = NSScreen.screens.contains { $0.visibleFrame.intersects(frame) }
        if !restored || !onScreen {
            let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
            let size = Self.defaultSize
            setFrame(NSRect(x: screen.maxX - size.width - 16, y: screen.maxY - size.height - 16, width: size.width, height: size.height), display: false)
        }
    }

    /// Set by a click on the panel, cleared when it stops being key.
    private var keyAllowed = false

    override var canBecomeKey: Bool { keyAllowed }

    /// A click makes the panel key, so ⌘Q and ⌘W reach it; the app still
    /// does not activate.
    override func sendEvent(_ event: NSEvent) {
        if [.leftMouseDown, .rightMouseDown, .otherMouseDown].contains(event.type), !isKeyWindow {
            keyAllowed = true
            makeKey()
        }
        super.sendEvent(event)
    }

    override func resignKey() {
        super.resignKey()
        keyAllowed = false
    }

    /// ⌘Q quits and ⌘W hides even though the app never becomes active, so
    /// its main menu would not see them.
    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        let flags = event.modifierFlags.intersection(.deviceIndependentFlagsMask)
        if flags == .command {
            switch event.charactersIgnoringModifiers {
            case "q":
                NSApp.terminate(nil)
                return true
            case "w":
                onHide?()
                return true
            default:
                break
            }
        }
        return super.performKeyEquivalent(with: event)
    }

    override func performClose(_ sender: Any?) {
        onHide?()
    }

    /// The title bar's close button closes the window directly, past
    /// performClose: closing means hiding, so the person's choice is recorded.
    override func close() {
        if let onHide { onHide() } else { super.close() }
    }
}
