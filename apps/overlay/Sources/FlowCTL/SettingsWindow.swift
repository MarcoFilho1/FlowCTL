import AppKit
import FlowCTLCore
import SwiftUI

// FlowCTL Settings: every preference in one window, grouped as System
// Settings groups its own.

struct SettingsView: View {
    @ObservedObject var model: ControlModel

    var body: some View {
        Form {
            Section {
                Picker(selection: model.binding(\.view, fallback: .standard)) {
                    ForEach(OverlayView.allCases, id: \.self) { Text($0.title).tag($0) }
                } label: {
                    Text("View")
                    Text("Only the snail: it works while your sessions work, celebrates when they finish and rattles when one needs you. Click it to see the graph.")
                }
                .pickerStyle(.segmented)
                Picker("Size", selection: model.binding(\.panelSize, fallback: .standard)) {
                    ForEach(PanelSize.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                Picker("Opacity", selection: model.binding(\.opacity, fallback: 1)) {
                    ForEach(Preferences.opacities, id: \.self) { Text("\(Int(($0 * 100).rounded()))%").tag($0) }
                }
                Toggle("Always on top", isOn: model.binding(\.alwaysOnTop, fallback: true))
                Toggle(isOn: model.binding(\.showAutomatically, fallback: true)) {
                    Text("Show automatically")
                    Text("When a session starts working or needs you.")
                }
                Toggle(isOn: model.binding(\.hideWhenIdle, fallback: true)) {
                    Text("Hide when idle")
                    Text("After five minutes with no session working.")
                }
            } header: {
                Label("Overlay", systemImage: "macwindow")
            }

            Section {
                Picker("Look", selection: model.binding(\.look, fallback: .standard)) {
                    ForEach(PageLook.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                .pickerStyle(.segmented)
                Picker("Theme", selection: model.binding(\.themeChoice, fallback: .standard)) {
                    ForEach(ThemeChoice.allCases, id: \.self) { Text($0.title).tag($0) }
                }
                Toggle(isOn: model.binding(\.showSubagents, fallback: true)) {
                    Text("Show subagents")
                    Text("Draw the agents a session starts as their own nodes.")
                }
                Toggle(isOn: model.binding(\.idleAnimation, fallback: true)) {
                    Text("Idle animation")
                    Text("The graph moves gently after a minute with nothing working.")
                }
                Picker(selection: model.binding(\.idleStyle, fallback: .standard)) {
                    ForEach(IdleStyle.allCases, id: \.self) { Text($0.title).tag($0) }
                } label: {
                    Text("Idle style")
                    Text("Shapes in the overlay, or a snail that walks along the bottom of the screen.")
                }
                .pickerStyle(.segmented)
                .disabled(!(model.prefs?.idleAnimation ?? true))
            } header: {
                Label("Graph", systemImage: "point.3.connected.trianglepath.dotted")
            }

            Section {
                Picker("Sound", selection: model.binding(\.soundChoice, fallback: .standard)) {
                    ForEach(SoundChoice.allCases, id: \.self) { Text($0.title).tag($0) }
                }
            } header: {
                Label("Sound", systemImage: "speaker.wave.2")
            } footer: {
                Text("A quiet cue when a step starts, finishes or needs you.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }

            Section {
                LabeledContent("Version", value: model.version)
                LabeledContent("Source") {
                    Link("github.com/MarcoFilho1/FlowCTL", destination: URL(string: "https://github.com/MarcoFilho1/FlowCTL")!)
                }
            } header: {
                Label("About", systemImage: "info.circle")
            }
        }
        .formStyle(.grouped)
        .frame(width: 480)
        .fixedSize(horizontal: false, vertical: true)
    }
}

final class SettingsWindowController: NSObject, NSWindowDelegate {
    private var window: NSWindow?
    private let model: ControlModel

    init(model: ControlModel) {
        self.model = model
    }

    var debugWindow: NSWindow? { window }

    /// Opens the window (once) and brings FlowCTL forward, as Settings… does in any app.
    func show() {
        if window == nil {
            let hosting = NSHostingController(rootView: SettingsView(model: model))
            let window = NSWindow(contentViewController: hosting)
            window.title = "FlowCTL Settings"
            window.styleMask = [.titled, .closable, .miniaturizable]
            window.isReleasedWhenClosed = false
            window.toolbarStyle = .unified
            window.delegate = self
            window.center()
            window.setFrameAutosaveName("FlowCTL.settings")
            self.window = window
        }
        model.refresh()
        NSApp.activate(ignoringOtherApps: true)
        window?.makeKeyAndOrderFront(nil)
    }

    func close() { window?.close() }
}
