// TICKET-082 — iOS share extension for wishlist import.
// Accepts EITHER:
//   • a web URL (TikTok/Maps/etc. link) → napkin://import?url=…   (caption path)
//   • a saved VIDEO file (Photos)       → napkin://import?video=… (on-device OCR)
// The video is copied into the shared App Group container so the main app can
// read it (the extension's temp file is sandboxed + deleted after the callback).
// Then we open the main app and completeRequest. No UI rendered (Phase A; the
// in-extension modal is Phase B).
//
// ARCH-REVIEW-2: Only the UIApplication-typed responder-chain branch is kept
// (App Store 2.5.1 prohibits the private openURL: selector fallback).

import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    private let appGroup = "group.com.majilaii.napkin.shared"

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

        let movieType = UTType.movie.identifier
        let urlType = UTType.url.identifier

        // Prefer a video file — the spots live IN the video, not the link.
        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(movieType) }) {
            provider.loadFileRepresentation(forTypeIdentifier: movieType) { [weak self] (fileURL, _) in
                guard let self = self else { return }
                // Must copy synchronously inside this callback — fileURL is a
                // temp the system reclaims once the closure returns.
                if let src = fileURL, let dest = self.copyToAppGroup(src) {
                    self.openMainApp(query: [URLQueryItem(name: "video", value: dest.path)])
                } else {
                    self.complete()
                }
            }
            return
        }

        // Else a web URL (the link → caption/oEmbed path).
        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) {
            provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] (data, _) in
                guard let self = self else { return }
                let url: URL? = (data as? URL) ?? (data as? String).flatMap(URL.init(string:))
                if let shared = url {
                    self.openMainApp(query: [URLQueryItem(name: "url", value: shared.absoluteString)])
                } else {
                    self.complete()
                }
            }
            return
        }

        complete()
    }

    /// Copy a shared video into the App Group container (readable by the main app).
    private func copyToAppGroup(_ src: URL) -> URL? {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        let dir = container.appendingPathComponent("shared-imports", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let ext = src.pathExtension.isEmpty ? "mov" : src.pathExtension
        let dest = dir.appendingPathComponent(UUID().uuidString + "." + ext)
        do {
            try FileManager.default.copyItem(at: src, to: dest)
            return dest
        } catch {
            return nil
        }
    }

    private func openMainApp(query: [URLQueryItem]) {
        guard var components = URLComponents(string: "napkin://import") else {
            complete()
            return
        }
        components.queryItems = query
        guard let deepLink = components.url else {
            complete()
            return
        }

        // Walk the responder chain to find a UIApplication-shaped object.
        // extensionContext.open() silently fails on iOS 17+ for share extensions.
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
        complete()
    }

    private func complete() {
        DispatchQueue.main.async { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}
