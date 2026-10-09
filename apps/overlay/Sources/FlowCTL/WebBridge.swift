import FlowCTLCore
import WebKit

/// The viewer page and the one way into it: `window.flowctl.push(snapshot)`.
/// The snapshot crosses as an argument, never spliced into script text.
final class WebBridge: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    private let page: URL
    private var isReady = false
    private var queued: [Data] = []
    /// Asked for every snapshot to push again when the page had to load anew.
    var currentBodies: () -> [Data] = { [] }

    init(page: URL) {
        self.page = page
        let configuration = WKWebViewConfiguration()
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        webView.navigationDelegate = self
        webView.setAccessibilityLabel("FlowCTL task graph")
        // Let the panel's blur show through: the page itself is transparent.
        // `drawsBackground` is private; skip it rather than crash if it is ever gone.
        if webView.responds(to: NSSelectorFromString("_setDrawsBackground:")) || webView.responds(to: NSSelectorFromString("setDrawsBackground:")) {
            webView.setValue(false, forKey: "drawsBackground")
        }
        webView.underPageBackgroundColor = .clear
        load()
    }

    func push(_ body: Data) {
        if isReady { send(body) } else { queued.append(body) }
    }

    /// Loads the page again and pushes `bodies` once it is up: how a tab is
    /// removed, since the viewer only adds and updates sessions.
    func reload(replaying bodies: [Data]) {
        queued = bodies
        load()
    }

    private func load() {
        isReady = false
        log("loading \(page.path)")
        webView.loadFileURL(page, allowingReadAccessTo: page.deletingLastPathComponent())
    }

    private func send(_ body: Data) {
        let script = "return window.flowctl ? window.flowctl.push(JSON.parse(snapshot)) : false"
        webView.callAsyncJavaScript(script, arguments: ["snapshot": String(decoding: body, as: UTF8.self)], in: nil, in: .page) { result in
            switch result {
            case .failure(let error): log("push failed: \(error.localizedDescription)")
            case .success(let value): if (value as? Bool) == false { log("the page dropped a snapshot") }
            }
        }
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        // The page's script may still be setting up window.flowctl when the
        // load finishes: wait for it (up to a second) before pushing.
        let wait = "for (let i = 0; i < 50 && !window.flowctl; i++) await new Promise((r) => setTimeout(r, 20)); return !!window.flowctl"
        webView.callAsyncJavaScript(wait, arguments: [:], in: nil, in: .page) { [weak self] result in
            guard let self else { return }
            if case .success(let value) = result, (value as? Bool) == true {} else { log("window.flowctl never appeared") }
            self.isReady = true
            let pending = self.queued
            self.queued.removeAll()
            pending.forEach(self.send)
        }
    }

    func webView(_ webView: WKWebView, didFail navigation: WKNavigation!, withError error: Error) {
        log("page failed: \(error.localizedDescription)")
    }

    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        log("web content process ended; reloading")
        reload(replaying: currentBodies())
    }
}
