import AppKit
import WebKit

final class AppDelegate: NSObject, NSApplicationDelegate, WKScriptMessageHandler, WKNavigationDelegate {
    private var panel: NSPanel!
    private var webView: WKWebView!
    private var server: SocketServer?
    private var isPageReady = false
    private var pendingScripts: [String] = []

    /// receivedAt (nowMs) of each POST still waiting for its paint ack.
    private var inFlight: [Int: Double] = [:]
    private var nextPushId = 0
    private var samples: [(eval: Double, paint: Double)] = []
    private let statsLock = NSLock()

    func applicationDidFinishLaunching(_ notification: Notification) {
        buildPanel()
        loadPage()
        startServer()
    }

    func applicationWillTerminate(_ notification: Notification) {
        server?.stop()
    }

    // MARK: Window

    private func buildPanel() {
        let size = NSSize(width: 360, height: 480)
        let screen = NSScreen.main?.visibleFrame ?? NSRect(x: 0, y: 0, width: 1440, height: 900)
        let origin = NSPoint(x: screen.maxX - size.width - 16, y: screen.maxY - size.height - 16)

        panel = NSPanel(
            contentRect: NSRect(origin: origin, size: size),
            styleMask: [.nonactivatingPanel, .titled, .fullSizeContentView, .resizable],
            backing: .buffered,
            defer: false)
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isFloatingPanel = true
        panel.hidesOnDeactivate = false
        panel.becomesKeyOnlyIfNeeded = true
        panel.titleVisibility = .hidden
        panel.titlebarAppearsTransparent = true
        panel.isMovableByWindowBackground = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.title = "FlowCTL"

        let blur = NSVisualEffectView(frame: NSRect(origin: .zero, size: size))
        blur.material = .hudWindow
        blur.blendingMode = .behindWindow
        blur.state = .active
        blur.autoresizingMask = [.width, .height]

        let config = WKWebViewConfiguration()
        config.userContentController.add(self, name: "flowctl")
        webView = WKWebView(frame: blur.bounds, configuration: config)
        webView.autoresizingMask = [.width, .height]
        webView.navigationDelegate = self
        // Private KVC, the usual way to let the blur show through a WKWebView.
        webView.setValue(false, forKey: "drawsBackground")
        blur.addSubview(webView)

        panel.contentView = blur
        panel.orderFrontRegardless()
        log("panel shown at \(NSStringFromRect(panel.frame))")
    }

    private func loadPage() {
        let dir = webDirectory()
        let index = dir.appendingPathComponent("index.html")
        log("loading \(index.path)")
        webView.loadFileURL(index, allowingReadAccessTo: dir)
    }

    private func webDirectory() -> URL {
        if let override = ProcessInfo.processInfo.environment["FLOWCTL_WEB_DIR"] {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return Bundle.main.resourceURL!.appendingPathComponent("web", isDirectory: true)
    }

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        isPageReady = true
        log("page ready; flushing \(pendingScripts.count) queued push(es)")
        pendingScripts.forEach(run)
        pendingScripts.removeAll()
    }

    // MARK: Server

    private func startServer() {
        let path = (NSHomeDirectory() as NSString).appendingPathComponent(".flowctl/overlay.sock")
        let server = SocketServer(path: path) { [weak self] request in
            self?.route(request) ?? .notFound
        }
        do {
            try server.start()
            self.server = server
        } catch {
            log("server failed: \(error)")
        }
    }

    /// Runs on the socket queue.
    private func route(_ request: HTTPRequest) -> HTTPResponse {
        switch (request.method, request.path) {
        case ("GET", "/health"):
            return .ok()
        case ("GET", "/stats"):
            return .ok(statsText())
        case ("GET", "/debug/capture"):
            // Spike only: proves what the page painted without needing the
            // Screen Recording permission that screencapture asks for.
            return capture().map { .ok($0 + "\n") } ?? .badRequest("capture failed\n")
        case ("POST", "/snapshot"):
            // Re-serialized after parsing, so what reaches the page is always a
            // valid JSON literal and never script text from the request.
            guard let object = try? JSONSerialization.jsonObject(with: request.body),
                  object is [String: Any],
                  let json = try? JSONSerialization.data(withJSONObject: object),
                  let literal = String(data: json, encoding: .utf8)
            else { return .badRequest("body must be a JSON object\n") }

            DispatchQueue.main.async { self.push(literal, receivedAt: request.receivedAt) }
            return .ok("accepted\n")
        default:
            return .notFound
        }
    }

    /// Runs on the socket queue; waits for the main-thread snapshot.
    private func capture() -> String? {
        let done = DispatchSemaphore(value: 0)
        var written: String?
        DispatchQueue.main.async {
            self.webView.takeSnapshot(with: nil) { image, error in
                defer { done.signal() }
                // The page is transparent over the blur: flatten it onto the
                // window background so light text stays readable in the file.
                let flattened = image.map { image in
                    NSImage(size: image.size, flipped: false) { rect in
                        NSColor.windowBackgroundColor.setFill()
                        rect.fill()
                        image.draw(in: rect)
                        return true
                    }
                }
                guard let tiff = flattened?.tiffRepresentation,
                      let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:])
                else { return log("capture failed: \(String(describing: error))") }
                let url = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("flowctl-spike-capture.png")
                if (try? png.write(to: url)) != nil { written = url.path }
            }
        }
        _ = done.wait(timeout: .now() + 5)
        return written
    }

    // MARK: Push and latency

    private func push(_ literal: String, receivedAt: Double) {
        nextPushId += 1
        let id = nextPushId
        statsLock.withLock { inFlight[id] = receivedAt }
        let script = "window.flowctl.push(\(literal)); window.flowctl.ackPaint(\(id));"
        if isPageReady { run(script) } else { pendingScripts.append(script) }
    }

    private func run(_ script: String) {
        webView.evaluateJavaScript(script) { _, error in
            if let error { log("evaluateJavaScript failed: \(error.localizedDescription)") }
        }
    }

    /// The page posts `{ id, phase }`: `eval` once push() returned, `paint`
    /// after the frame that shows it (two requestAnimationFrame callbacks).
    func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let id = body["id"] as? Int,
              let phase = body["phase"] as? String else { return }
        let at = nowMs()
        statsLock.withLock {
            guard let receivedAt = inFlight[id] else { return }
            if phase == "eval" {
                inFlight[-id] = at - receivedAt
            } else if phase == "paint" {
                let eval = inFlight.removeValue(forKey: -id) ?? .nan
                inFlight.removeValue(forKey: id)
                let paint = at - receivedAt
                samples.append((eval, paint))
                log(String(format: "push #%d: received→eval %.2f ms, received→paint %.2f ms", id, eval, paint))
            }
        }
    }

    private func statsText() -> String {
        statsLock.withLock {
            guard !samples.isEmpty else { return "no samples\n" }
            func summary(_ values: [Double]) -> String {
                let sorted = values.sorted()
                let p = { (q: Double) in sorted[min(sorted.count - 1, Int(Double(sorted.count) * q))] }
                return String(format: "min %.2f  p50 %.2f  p95 %.2f  max %.2f ms", sorted[0], p(0.5), p(0.95), sorted.last!)
            }
            return "samples \(samples.count)\n"
                + "received→eval   \(summary(samples.map(\.eval)))\n"
                + "received→paint  \(summary(samples.map(\.paint)))\n"
        }
    }
}
