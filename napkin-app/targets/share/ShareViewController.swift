// TICKET-082 / TICKET-083 — iOS share extension for wishlist import.
//
// VIDEO (saved from Photos) → in-extension modal, NO app-switch (Part B inc3):
//   copy the .mov into the App Group, write a pending-import manifest, show ✓.
//   The main app drains the queue (OCR + resolve + save) on its next open.
// URL (TikTok/Maps link) → deep-link napkin://import?url=… (caption path; the
//   spots live in the video, not the link, so this stays the lighter path).
//
// Order matters (review #3): the .mov is copied FULLY first, THEN the manifest is
// written .tmp→rename — so a manifest never references a half-copied video.
// No OCR in the extension (≈120MB memory cap) — capture + enqueue only.

import UIKit
import Social
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    private let appGroup = "group.com.majilaii.napkin.shared"

    private let card = UIView()
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let doneButton = UIButton(type: .system)

    // Heirloom palette
    private let ink = UIColor(red: 0.110, green: 0.110, blue: 0.098, alpha: 1)     // #1c1c19
    private let taupe = UIColor(red: 0.541, green: 0.447, blue: 0.424, alpha: 1)   // #8a726c
    private let terracotta = UIColor(red: 0.627, green: 0.247, blue: 0.157, alpha: 1) // #a03f28
    private let note = UIColor(red: 0.996, green: 0.992, blue: 0.973, alpha: 1)    // #fffdf8

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.25)
        setupCard()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        handleShare()
    }

    // MARK: - UI

    private func setupCard() {
        card.backgroundColor = note
        card.layer.cornerRadius = 20
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let title = UILabel()
        title.text = "Napkin"
        title.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        title.textColor = ink
        title.textAlignment = .center

        statusLabel.text = "saving…"
        statusLabel.font = UIFont.systemFont(ofSize: 15)
        statusLabel.textColor = taupe
        statusLabel.textAlignment = .center
        statusLabel.numberOfLines = 0

        spinner.color = terracotta
        spinner.startAnimating()

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        doneButton.setTitleColor(terracotta, for: .normal)
        doneButton.addTarget(self, action: #selector(onDone), for: .touchUpInside)
        doneButton.isHidden = true

        let stack = UIStackView(arrangedSubviews: [title, spinner, statusLabel, doneButton])
        stack.axis = .vertical
        stack.alignment = .center
        stack.spacing = 14
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(stack)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 280),
            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 28),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -24),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 24),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -24),
        ])
    }

    private func showResult(success: Bool) {
        spinner.stopAnimating()
        spinner.isHidden = true
        statusLabel.text = success
            ? "saved ✓\nopen Napkin to see your spots"
            : "couldn't save — try again"
        doneButton.isHidden = false
    }

    @objc private func onDone() {
        complete()
    }

    // MARK: - Share handling

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
                // Copy synchronously inside this callback — fileURL is a temp the
                // system reclaims once the closure returns. .mov first, then manifest.
                var ok = false
                if let src = fileURL, let dest = self.copyToAppGroup(src) {
                    ok = self.enqueue(dest)
                }
                DispatchQueue.main.async { self.showResult(success: ok) }
            }
            return
        }

        // Else a web URL (the link → caption/oEmbed path) → deep-link the app.
        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) {
            provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] (data, _) in
                guard let self = self else { return }
                let url: URL? = (data as? URL) ?? (data as? String).flatMap(URL.init(string:))
                DispatchQueue.main.async {
                    if let shared = url {
                        self.openMainApp(query: [URLQueryItem(name: "url", value: shared.absoluteString)])
                    } else {
                        self.complete()
                    }
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

    /// Write a pending-import manifest (the .mov is already fully copied).
    /// .tmp → rename = atomic publish; the app's processor drains it on next open.
    private func enqueue(_ videoDest: URL) -> Bool {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return false }
        let dir = container.appendingPathComponent("import-queue", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let jobId = UUID().uuidString
        let manifest: [String: Any] = [
            "jobId": jobId,
            "kind": "video",
            "videoPath": videoDest.path,
            "importNonce": UUID().uuidString,
            "createdAt": Date().timeIntervalSince1970 * 1000,
            "attempts": 0,
            "status": "pending",
        ]
        guard let data = try? JSONSerialization.data(withJSONObject: manifest) else { return false }

        let tmp = dir.appendingPathComponent(jobId + ".json.tmp")
        let final = dir.appendingPathComponent(jobId + ".json")
        do {
            try data.write(to: tmp)
            try FileManager.default.moveItem(at: tmp, to: final)
            return true
        } catch {
            try? FileManager.default.removeItem(at: tmp)
            return false
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
