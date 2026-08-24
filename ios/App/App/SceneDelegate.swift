import UIKit
import Capacitor

final class TruthOracleViewController: CAPBridgeViewController {
    override func viewDidLoad() {
        super.viewDidLoad()
        edgesForExtendedLayout = []
        extendedLayoutIncludesOpaqueBars = false
        view.backgroundColor = .white
    }
}

class SceneDelegate: UIResponder, UIWindowSceneDelegate {
    var window: UIWindow?

    func scene(_ scene: UIScene, willConnectTo session: UISceneSession, options connectionOptions: UIScene.ConnectionOptions) {
        guard let windowScene = scene as? UIWindowScene else { return }

        window = UIWindow(windowScene: windowScene)
        window?.rootViewController = TruthOracleViewController()
        window?.makeKeyAndVisible()

        // Keep web content out of the iPhone status-bar / Dynamic-Island zone.
        let topProtection = UIView()
        topProtection.translatesAutoresizingMaskIntoConstraints = false
        topProtection.backgroundColor = .white
        window?.addSubview(topProtection)
        if let window {
            NSLayoutConstraint.activate([
                topProtection.topAnchor.constraint(equalTo: window.topAnchor),
                topProtection.leadingAnchor.constraint(equalTo: window.leadingAnchor),
                topProtection.trailingAnchor.constraint(equalTo: window.trailingAnchor),
                topProtection.bottomAnchor.constraint(equalTo: window.safeAreaLayoutGuide.topAnchor),
            ])
        }

        SceneDelegateProxy.shared.scene(scene, willConnectTo: session, options: connectionOptions)
    }

    func scene(_ scene: UIScene, openURLContexts URLContexts: Set<UIOpenURLContext>) {
        SceneDelegateProxy.shared.scene(scene, openURLContexts: URLContexts)
    }

    func scene(_ scene: UIScene, continue userActivity: NSUserActivity) {
        SceneDelegateProxy.shared.scene(scene, continue: userActivity)
    }
}
