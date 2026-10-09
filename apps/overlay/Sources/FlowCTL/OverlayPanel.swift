import AppKit

/// The floating panel: no frame, no shadow, no background of its own, so the
/// graph floats over the screen. It never activates the app (the terminal
/// keeps focus) and shows on every Space and over full-screen apps. The page
/// fills it: its top bar holds the close button and the grip the panel is
/// dragged by, both drawn by the viewer (see PageView). Its size is set by the
/// person (Size in the menu bar), not by the page.
final class OverlayPanel: NSPanel {
    /// Hides the panel: ⌘W, the viewer's × and closing the window.
    var onHide: (() -> Void)?

    init(content: NSView) {
        super.init(
            contentRect: NSRect(x: 0, y: 0, width: 120, height: 120),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        title = "FlowCTL"
        isFloatingPanel = true
        hidesOnDeactivate = false
        // Key only once the person clicks the grip (see canBecomeKey), never when
        // it pops up: a key non-activating panel would take the terminal's typing.
        becomesKeyOnlyIfNeeded = false
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false
        // Nodes react to hover (summary cards) while the app stays inactive.
        acceptsMouseMovedEvents = true

        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.clear.cgColor
        contentView = root

        content.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(content)
        NSLayoutConstraint.activate([
            content.topAnchor.constraint(equalTo: root.topAnchor),
            content.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
    }

    /// Set by a click on the grip, cleared when the panel stops being key.
    private var keyAllowed = false

    override var canBecomeKey: Bool { keyAllowed }

    /// A press on the grip makes the panel key, so ⌘Q and ⌘W reach it; the app
    /// still does not activate. A click on the graph does not: it goes to the
    /// page, and the terminal keeps the keyboard.
    func allowKey() {
        guard !isKeyWindow else { return }
        keyAllowed = true
        makeKey()
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

    /// Closing means hiding, so the person's choice is recorded.
    override func close() {
        if let onHide { onHide() } else { super.close() }
    }
}
