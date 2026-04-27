// TICKET-055 — iOS share extension for wishlist import.
// Receives a shared web URL, opens the main Napkin app via napkin://import?url=…,
// then calls completeRequest. No UI rendered inside the extension.
//
// ARCH-REVIEW-2: Only the UIApplication-typed responder-chain branch is kept.
// The perform(NSSelectorFromString("openURL:")) belt-and-suspenders fallback
// was removed — App Store 2.5.1 prohibits private-API selectors. If no
// UIApplication is found in the chain, fall through to complete().

import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleShare()
    }

    private func handleShare() {
        guard
            let item = (extensionContext?.inputItems as? [NSExtensionItem])?.first,
            let attachments = item.attachments
        else {
            complete()
            return
        }

        let urlType = UTType.url.identifier
        for provider in attachments where provider.hasItemConformingToTypeIdentifier(urlType) {
            provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] (data, _) in
                guard let self = self else { return }
                let url: URL? = (data as? URL) ?? (data as? String).flatMap(URL.init(string:))
                if let shared = url {
                    self.openMainApp(with: shared)
                } else {
                    self.complete()
                }
            }
            return
        }
        complete()
    }

    private func openMainApp(with sharedUrl: URL) {
        guard var components = URLComponents(string: "napkin://import") else {
            complete()
            return
        }
        components.queryItems = [URLQueryItem(name: "url", value: sharedUrl.absoluteString)]
        guard let deepLink = components.url else {
            complete()
            return
        }

        // Walk the responder chain to find a UIApplication-shaped object.
        // extensionContext.open() silently fails on iOS 17+ for share extensions —
        // the UIApplication branch is the canonical workaround (1Password, Pocket, etc.).
        var responder: UIResponder? = self
        while responder != nil {
            if let application = responder as? UIApplication {
                application.open(deepLink, options: [:]) { [weak self] _ in
                    self?.complete()
                }
                return
            }
            responder = responder?.next
        }
        // No UIApplication found in responder chain — fall through to complete().
        complete()
    }

    private func complete() {
        DispatchQueue.main.async { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}
