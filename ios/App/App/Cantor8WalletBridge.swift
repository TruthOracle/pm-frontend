import SwiftUI
import WebKit

/// Hosts the browser Cantor8 SDK inside WKWebView and forwards its result to Swift.
/// The native app never imports the TypeScript SDK and the Cantor8 website is untouched.
struct Cantor8WalletBridge: UIViewRepresentable {
    @Binding var isConnected: Bool
    @Binding var connectRequest: Int
    @Binding var errorMessage: String?

    func makeCoordinator() -> Coordinator { Coordinator(isConnected: $isConnected, errorMessage: $errorMessage) }
    func makeUIView(context: Context) -> UIView { context.coordinator.makeContainer() }
    func updateUIView(_ container: UIView, context: Context) {
        guard connectRequest != context.coordinator.lastConnectRequest else { return }
        context.coordinator.lastConnectRequest = connectRequest
        context.coordinator.connect()
    }

    final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate, WKScriptMessageHandler {
        private var isConnected: Binding<Bool>
        private var errorMessage: Binding<String?>
        private var webView: WKWebView?
        private weak var container: UIView?
        private var popupWebViews: [WKWebView] = []
        var lastConnectRequest = 0

        init(isConnected: Binding<Bool>, errorMessage: Binding<String?>) {
            self.isConnected = isConnected
            self.errorMessage = errorMessage
        }

        func makeContainer() -> UIView {
            let container = UIView(frame: .zero)
            container.isHidden = true
            self.container = container

            let configuration = WKWebViewConfiguration()
            configuration.preferences.javaScriptEnabled = true
            configuration.preferences.javaScriptCanOpenWindowsAutomatically = true
            configuration.websiteDataStore = .default()
            configuration.userContentController.add(self, name: "cantor8")
            let webView = WKWebView(frame: .zero, configuration: configuration)
            webView.navigationDelegate = self
            webView.uiDelegate = self
            container.addSubview(webView)
            webView.translatesAutoresizingMaskIntoConstraints = false
            NSLayoutConstraint.activate([
                webView.widthAnchor.constraint(equalToConstant: 1),
                webView.heightAnchor.constraint(equalToConstant: 1),
                webView.leadingAnchor.constraint(equalTo: container.leadingAnchor),
                webView.topAnchor.constraint(equalTo: container.topAnchor),
            ])
            self.webView = webView
            webView.loadHTMLString(Self.bridgeHTML, baseURL: URL(string: "https://truthoracle.app"))
            return container
        }

        func connect() {
            webView?.evaluateJavaScript("window.cantor8Bridge && window.cantor8Bridge.connect()") { [weak self] _, error in
                if let error { DispatchQueue.main.async { self?.errorMessage.wrappedValue = error.localizedDescription } }
            }
        }

        func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
            guard message.name == "cantor8", let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
            DispatchQueue.main.async { [weak self] in
                guard let self else { return }
                switch type {
                case "connected": self.isConnected.wrappedValue = true; self.errorMessage.wrappedValue = nil
                case "disconnected": self.isConnected.wrappedValue = false
                case "error": self.errorMessage.wrappedValue = body["message"] as? String ?? "Could not connect to Cantor8 wallet"
                default: break
                }
            }
        }

        // Cantor8 opens its approval UI with window.open. WKWebView needs a child
        // web view explicitly, otherwise the wallet screen is silently discarded.
        func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
            let popup = WKWebView(frame: .zero, configuration: configuration)
            popup.navigationDelegate = self
            popup.uiDelegate = self
            popup.translatesAutoresizingMaskIntoConstraints = false
            container?.isHidden = false
            let host = container?.window ?? container
            host?.addSubview(popup)
            if let host {
                NSLayoutConstraint.activate([
                    popup.leadingAnchor.constraint(equalTo: host.leadingAnchor), popup.trailingAnchor.constraint(equalTo: host.trailingAnchor),
                    popup.topAnchor.constraint(equalTo: host.topAnchor), popup.bottomAnchor.constraint(equalTo: host.bottomAnchor),
                ])
            }
            popupWebViews.append(popup)
            return popup
        }

        func webViewDidClose(_ webView: WKWebView) {
            popupWebViews.removeAll { $0 === webView }
            webView.removeFromSuperview()
            container?.isHidden = true
        }

        func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) { decisionHandler(.allow) }

        private static let bridgeHTML = """
        <!doctype html><meta name="viewport" content="width=device-width, initial-scale=1">
        <script>window.cantor8Bridge = { connect: () => { window.__cantor8ConnectRequested = true; } };</script>
        <script type="module">
          import { C8WalletProvider } from 'https://cdn.jsdelivr.net/npm/@cantor8/wallet-connect-sdk@0.5.0/dist/index.esm.js';
          const native = payload => window.webkit.messageHandlers.cantor8.postMessage(payload);
          const wallet = new C8WalletProvider({ dappName: 'TruthOracle', dappUrl: 'https://truthoracle.app', network: 'devnet' });
          wallet.on('connected', async () => {
            try { const result = await wallet.getAccounts(); native({ type: 'connected', accounts: result.accounts || [] }); }
            catch (error) { native({ type: 'error', message: String(error?.message || error) }); }
          });
          wallet.on('disconnected', () => native({ type: 'disconnected' }));
          window.cantor8Bridge = {
            async connect() {
              try { await wallet.connect(); const result = await wallet.getAccounts(); native({ type: 'connected', accounts: result.accounts || [] }); }
              catch (error) { native({ type: 'error', message: String(error?.message || error) }); }
            }
          };
          if (window.__cantor8ConnectRequested) window.cantor8Bridge.connect();
        </script>
        """
    }
}
