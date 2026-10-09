import AppKit

/// The floating panel: no frame, no shadow, no background of its own, so the
/// graph floats over the screen. It never activates the app (the terminal
/// keeps focus) and shows on every Space and over full-screen apps. A thin
/// strip on top holds the close button and is where it is dragged from; its
/// size is set by the app from what the viewer asks for, not by the person.
final class OverlayPanel: NSPanel {
    static let stripHeight: CGFloat = 18

    /// Close button, ⌘W: the panel hides, the app keeps running.
    var onHide: (() -> Void)?
    /// The person dragged the panel somewhere else.
    var onDragEnded: (() -> Void)?

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
        // Key only once the person clicks it (see canBecomeKey), never when it
        // pops up: a key non-activating panel would take the terminal's typing.
        becomesKeyOnlyIfNeeded = false
        isReleasedWhenClosed = false
        collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        isOpaque = false
        backgroundColor = .clear
        hasShadow = false

        let root = NSView()
        root.wantsLayer = true
        root.layer?.backgroundColor = NSColor.clear.cgColor
        contentView = root

        let strip = ControlStrip()
        strip.onClose = { [weak self] in self?.onHide?() }
        strip.onDragEnded = { [weak self] in self?.onDragEnded?() }
        strip.translatesAutoresizingMaskIntoConstraints = false
        content.translatesAutoresizingMaskIntoConstraints = false
        root.addSubview(content)
        root.addSubview(strip)
        NSLayoutConstraint.activate([
            strip.topAnchor.constraint(equalTo: root.topAnchor),
            strip.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            strip.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            strip.heightAnchor.constraint(equalToConstant: Self.stripHeight),
            content.topAnchor.constraint(equalTo: strip.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: root.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: root.trailingAnchor),
            content.bottomAnchor.constraint(equalTo: root.bottomAnchor)
        ])
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

    /// Closing means hiding, so the person's choice is recorded.
    override func close() {
        if let onHide { onHide() } else { super.close() }
    }

    /// The strip's close button (the debug hooks click it as a person would).
    var closeButton: NSButton? {
        contentView?.subviews.compactMap { ($0 as? ControlStrip)?.closeButton }.first
    }
}

/// The strip above the page: a close button that is always there (faint
/// until hovered) and a handle to drag the panel by.
private final class ControlStrip: NSView {
    var onClose: (() -> Void)?
    var onDragEnded: (() -> Void)?
    let closeButton = NSButton()

    private var isHovered = false { didSet { refresh() } }

    override init(frame: NSRect) {
        super.init(frame: frame)
        wantsLayer = true
        layer?.cornerRadius = 6

        closeButton.image = NSImage(systemSymbolName: "xmark.circle.fill", accessibilityDescription: "Hide panel")
        closeButton.imagePosition = .imageOnly
        closeButton.isBordered = false
        closeButton.contentTintColor = .secondaryLabelColor
        closeButton.toolTip = "Hide panel (⌘W)"
        closeButton.setAccessibilityLabel("Hide panel")
        closeButton.target = self
        closeButton.action = #selector(closeClicked)
        closeButton.translatesAutoresizingMaskIntoConstraints = false
        addSubview(closeButton)
        NSLayoutConstraint.activate([
            closeButton.leadingAnchor.constraint(equalTo: leadingAnchor, constant: 3),
            closeButton.centerYAnchor.constraint(equalTo: centerYAnchor),
            closeButton.widthAnchor.constraint(equalToConstant: 14),
            closeButton.heightAnchor.constraint(equalToConstant: 14)
        ])
        refresh()
    }

    required init?(coder: NSCoder) { fatalError("not used") }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        trackingAreas.forEach(removeTrackingArea)
        addTrackingArea(NSTrackingArea(rect: bounds, options: [.mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self))
    }

    override func mouseEntered(with event: NSEvent) { isHovered = true }
    override func mouseExited(with event: NSEvent) { isHovered = false }

    override func mouseDown(with event: NSEvent) {
        window?.performDrag(with: event)
        onDragEnded?()
    }

    override func resetCursorRects() {
        addCursorRect(bounds, cursor: .openHand)
    }

    private func refresh() {
        closeButton.alphaValue = isHovered ? 1 : 0.55
        layer?.backgroundColor = isHovered ? NSColor.labelColor.withAlphaComponent(0.08).cgColor : NSColor.clear.cgColor
    }

    @objc private func closeClicked() { onClose?() }
}
