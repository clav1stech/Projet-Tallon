import Foundation
import WebKit

/// Sert le dossier `www` de l'app sous `tallon://app/…`. Contrairement à
/// `file://`, l'origine n'est pas nulle : modules ES et `fetch('data/…')`
/// fonctionnent sans modification de la page.
final class BundleSchemeHandler: NSObject, WKURLSchemeHandler {
    static let scheme = "tallon"
    static let startURL = URL(string: "tallon://app/index.html")!

    private let root = Bundle.main.resourceURL!
        .appendingPathComponent("www", isDirectory: true).standardizedFileURL

    // Les modules ES sont refusés sans type JavaScript.
    private static let mimeTypes: [String: String] = [
        "html": "text/html; charset=utf-8",
        "js": "text/javascript; charset=utf-8",
        "mjs": "text/javascript; charset=utf-8",
        "css": "text/css; charset=utf-8",
        "json": "application/json; charset=utf-8",
        "webmanifest": "application/manifest+json; charset=utf-8",
        "csv": "text/csv; charset=utf-8",
        "png": "image/png",
        "jpg": "image/jpeg",
        "jpeg": "image/jpeg",
        "svg": "image/svg+xml",
        "ico": "image/x-icon",
        "woff2": "font/woff2"
    ]

    func webView(_ webView: WKWebView, start urlSchemeTask: WKURLSchemeTask) {
        guard let url = urlSchemeTask.request.url else {
            urlSchemeTask.didFailWithError(URLError(.badURL))
            return
        }
        let path = url.path.isEmpty || url.path == "/" ? "index.html" : String(url.path.dropFirst())
        let file = root.appendingPathComponent(path).standardizedFileURL
        // Refuse toute sortie du dossier www (`..`).
        guard file.path.hasPrefix(root.path + "/"), let data = try? Data(contentsOf: file) else {
            // 404 explicite : la page traite l'absence comme sur le web (res.ok).
            respond(urlSchemeTask, url: url, status: 404, type: "text/plain; charset=utf-8", data: Data())
            return
        }
        let type = Self.mimeTypes[file.pathExtension.lowercased()] ?? "application/octet-stream"
        respond(urlSchemeTask, url: url, status: 200, type: type, data: data)
    }

    func webView(_ webView: WKWebView, stop urlSchemeTask: WKURLSchemeTask) {}

    private func respond(_ task: WKURLSchemeTask, url: URL, status: Int, type: String, data: Data) {
        let headers = ["Content-Type": type, "Content-Length": String(data.count), "Cache-Control": "no-cache"]
        guard let response = HTTPURLResponse(url: url, statusCode: status, httpVersion: "HTTP/1.1",
                                             headerFields: headers) else {
            task.didFailWithError(URLError(.cannotParseResponse))
            return
        }
        task.didReceive(response)
        task.didReceive(data)
        task.didFinish()
    }
}
