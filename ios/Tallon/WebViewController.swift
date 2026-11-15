import UIKit
import WebKit

/// Affiche la PWA embarquée en plein écran. Toute la logique reste dans la page :
/// le natif ne fournit que le chargement des fichiers et le bridge SNCF.
final class WebViewController: UIViewController, WKNavigationDelegate {
    private var webView: WKWebView!

    override func loadView() {
        let configuration = WKWebViewConfiguration()
        configuration.setURLSchemeHandler(BundleSchemeHandler(), forURLScheme: BundleSchemeHandler.scheme)
        configuration.userContentController.addScriptMessageHandler(
            SncfBridge(), contentWorld: .page, name: SncfBridge.name)

        webView = WKWebView(frame: .zero, configuration: configuration)
        webView.navigationDelegate = self
        webView.allowsLinkPreview = false
        // Sans barre de navigation, le balayage latéral est le seul retour
        // depuis une page liée (éditeur de points).
        webView.allowsBackForwardNavigationGestures = true
        // La page gère elle-même les marges d'encoche (viewport-fit=cover,
        // env(safe-area-inset-*)), comme en PWA plein écran.
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.isOpaque = false
        webView.backgroundColor = UIColor(red: 0xF4 / 255, green: 0xF1 / 255, blue: 0xED / 255, alpha: 1)
        #if DEBUG
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        #endif
        view = webView
    }

    override func viewDidLoad() {
        super.viewDidLoad()
        webView.load(URLRequest(url: BundleSchemeHandler.startURL))
    }

    // Page claire (color-scheme: light) quel que soit le thème du système.
    override var preferredStatusBarStyle: UIStatusBarStyle { .darkContent }

    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction,
                 decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url,
              let scheme = url.scheme?.lowercased(),
              scheme != BundleSchemeHandler.scheme, scheme != "about" else {
            decisionHandler(.allow)
            return
        }
        // Un lien externe quitterait l'app sans retour possible : Safari.
        decisionHandler(.cancel)
        UIApplication.shared.open(url)
    }

    // iOS peut tuer le processus web en arrière-plan : sans rechargement, page blanche.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }
}
