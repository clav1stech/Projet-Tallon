import Foundation
import WebKit

/// Requête native vers l'API du routeur WiFi SNCF, hors du contexte CORS de la page.
///
/// JS : `await webkit.messageHandlers.tallonNative.postMessage({ op: 'sncf', url, timeoutMs })`
/// → `{ ok: true, status, body, location? }` ou `{ ok: false, kind, detail }`.
/// L'interprétation (portail captif, unités, fraîcheur) reste dans js/sncf-telemetry.js.
final class SncfBridge: NSObject, WKScriptMessageHandlerWithReply, URLSessionTaskDelegate {
    static let name = "tallonNative"
    /// Seul hôte joignable : le bridge ne doit pas devenir un proxy générique.
    private static let allowedHost = "wifi.sncf"

    private lazy var session: URLSession = {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.requestCachePolicy = .reloadIgnoringLocalCacheData
        configuration.urlCache = nil
        configuration.waitsForConnectivity = false
        return URLSession(configuration: configuration, delegate: self, delegateQueue: nil)
    }()

    func userContentController(_ userContentController: WKUserContentController,
                               didReceive message: WKScriptMessage,
                               replyHandler: @escaping (Any?, String?) -> Void) {
        guard message.frameInfo.isMainFrame,
              message.frameInfo.securityOrigin.protocol == BundleSchemeHandler.scheme,
              let body = message.body as? [String: Any], body["op"] as? String == "sncf",
              let raw = body["url"] as? String, let url = URL(string: raw),
              let scheme = url.scheme?.lowercased(), scheme == "https" || scheme == "http",
              url.host?.lowercased() == Self.allowedHost else {
            replyHandler(["ok": false, "kind": "refused", "detail": "requête hors liste blanche"], nil)
            return
        }
        let timeoutMs = (body["timeoutMs"] as? NSNumber)?.doubleValue ?? 3000
        var request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData,
                                 timeoutInterval: min(max(timeoutMs / 1000, 0.5), 30))
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        session.dataTask(with: request) { data, response, error in
            let reply: [String: Any]
            if let error = error as NSError? {
                reply = ["ok": false, "kind": Self.kind(of: error), "detail": "\(error.domain) \(error.code)"]
            } else {
                let http = response as? HTTPURLResponse
                var success: [String: Any] = [
                    "ok": true,
                    "status": http?.statusCode ?? 0,
                    "body": String(decoding: data ?? Data(), as: UTF8.self)
                ]
                if let location = http?.value(forHTTPHeaderField: "Location") { success["location"] = location }
                reply = success
            }
            DispatchQueue.main.async { replyHandler(reply, nil) }
        }.resume()
    }

    /// Le portail captif redirige vers un autre hôte : la redirection n'est pas
    /// suivie (liste blanche) et la réponse 3xx est rendue telle quelle à la page.
    /// Appelée sur la file de URLSession, hors du fil principal.
    nonisolated func urlSession(_ session: URLSession, task: URLSessionTask,
                    willPerformHTTPRedirection response: HTTPURLResponse,
                    newRequest request: URLRequest,
                    completionHandler: @escaping (URLRequest?) -> Void) {
        completionHandler(nil)
    }

    /// Catégories traduites en messages par js/sncf-telemetry.js.
    nonisolated private static func kind(of error: NSError) -> String {
        guard error.domain == NSURLErrorDomain else { return "unreachable" }
        // Refus de l'autorisation « Réseau local » : seule la description du
        // chemin réseau le distingue d'une absence de WiFi.
        if String(describing: error.userInfo).contains("Local network prohibited") { return "local-network" }
        switch error.code {
        case NSURLErrorTimedOut:
            return "timeout"
        case NSURLErrorAppTransportSecurityRequiresSecureConnection:
            return "ats"
        case NSURLErrorSecureConnectionFailed, NSURLErrorServerCertificateHasBadDate,
             NSURLErrorServerCertificateUntrusted, NSURLErrorServerCertificateHasUnknownRoot,
             NSURLErrorServerCertificateNotYetValid, NSURLErrorClientCertificateRejected,
             NSURLErrorClientCertificateRequired:
            return "tls"
        case NSURLErrorNotConnectedToInternet:
            return "offline"
        default:
            return "unreachable"
        }
    }
}
