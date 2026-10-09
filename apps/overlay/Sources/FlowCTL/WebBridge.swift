import FlowCTLCore
import WebKit

/// The viewer page and the ways in and out of it. In: `window.flowctl.push(snapshot)`,
/// the snapshot crossing as an argument, never spliced into script text. Out:
/// `window.webkit.messageHandlers.flowctl.postMessage(...)` with
/// `{ type: "size", width, height }` (the room the graph wants, in points) or
/// `{ type: "focus", sessionId, nodeId }` (a node was clicked).
final class WebBridge: NSObject, WKNavigationDelegate {
    let webView: WKWebView
    private let page: URL
    private var isReady = false
    private var queued: [Data] = []
    /// Asked for every snapshot to push again when the page had to load anew.
    var currentBodies: () -> [Data] = { [] }
    /// The page asked for this much room.
    var onSize: ((CGSize) -> Void)?
    /// A node was clicked.
    var onFocus: ((_ sessionId: String, _ nodeId: String?) -> Void)?

    init(page: URL) {
        self.page = page
        let configuration = WKWebViewConfiguration()
        let messages = MessageProxy()
        configuration.userContentController.add(messages, name: "flowctl")
        webView = WKWebView(frame: .zero, configuration: configuration)
        super.init()
        messages.bridge = self
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

    fileprivate func receive(_ body: Any) {
        guard let message = body as? [String: Any], let type = message["type"] as? String else { return }
        switch type {
        case "size":
            guard let width = (message["width"] as? NSNumber)?.doubleValue,
                  let height = (message["height"] as? NSNumber)?.doubleValue,
                  width.isFinite, height.isFinite, width > 0, height > 0
            else { return log("ignored a size message: \(message)") }
            onSize?(CGSize(width: width, height: height))
        case "focus":
            guard let sessionId = message["sessionId"] as? String, !sessionId.isEmpty else { return }
            onFocus?(sessionId, message["nodeId"] as? String)
        default:
            log("ignored a \(type) message from the page")
        }
    }

    /// Posts a message from inside the page, as the viewer does (debug hooks).
    func postFromPage(_ message: [String: Any]) {
        webView.callAsyncJavaScript("window.webkit.messageHandlers.flowctl.postMessage(message)", arguments: ["message": message], in: nil, in: .page) { result in
            if case .failure(let error) = result { log("postMessage failed: \(error.localizedDescription)") }
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

/// The script message handler, held weakly: WKUserContentController keeps its
/// handlers alive, and the bridge owns the web view.
private final class MessageProxy: NSObject, WKScriptMessageHandler {
    weak var bridge: WebBridge?

    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        bridge?.receive(message.body)
    }
}
