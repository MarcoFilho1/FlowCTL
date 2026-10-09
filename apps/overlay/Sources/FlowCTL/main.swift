import AppKit

let app = NSApplication.shared
// No Dock icon or menu bar of its own (LSUIElement in the bundle; this covers `swift run`).
app.setActivationPolicy(.accessory)
let delegate = AppDelegate()
app.delegate = delegate
app.run()
