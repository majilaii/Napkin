// iOS share extension: compact, review-first handoff.
//
// Share a VIDEO (saved file) or URL (link) → one action writes a review-mode
// pending-import manifest to the App-Group queue, then completes without an app
// switch. Nothing is saved automatically: the main app resolves the share and
// asks the user to confirm every spot. Lists and tables are chosen later in-app.
//
// The extension reads only the user id from the app's collections snapshot for
// cross-account safety. NO OCR here (~120MB cap). A movie is copied fully before
// its manifest is written.

import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    private let appGroup = "group.com.majilaii.napkin.shared"

    // Heirloom palette
    private let ink = UIColor(red: 0.110, green: 0.110, blue: 0.098, alpha: 1)
    private let taupe = UIColor(red: 0.541, green: 0.447, blue: 0.424, alpha: 1)
    private let terracotta = UIColor(red: 0.627, green: 0.247, blue: 0.157, alpha: 1)
    private let note = UIColor(red: 0.996, green: 0.992, blue: 0.973, alpha: 1)

    // Capture
    private var capturedVideoPath: String?
    private var capturedURL: String?
    private var captureKind: String? // "video" | "url"
    private var captureReady = false

    // Header (hero) labels — updated as the share resolves
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()

    // Snapshot identity (destinations deliberately stay in the main app)
    private var snapshotUserId: String?

    // UI
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.3)
        loadSnapshotIdentity()
        buildChrome()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureSharedItem()
    }

    // MARK: - Snapshot identity

    private func loadSnapshotIdentity() {
        guard
            let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
            let data = try? Data(contentsOf: container.appendingPathComponent("collections-snapshot.json")),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }
        snapshotUserId = obj["userId"] as? String
    }

    // MARK: - Compact review-first card

    private func buildChrome() {
        let card = UIView()
        card.backgroundColor = note
        card.layer.cornerRadius = 28
        card.layer.shadowColor = UIColor.black.cgColor
        card.layer.shadowOpacity = 0.10
        card.layer.shadowRadius = 30
        card.layer.shadowOffset = CGSize(width: 0, height: 8)
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let grabber = UIView()
        grabber.backgroundColor = UIColor(red: 0.867, green: 0.753, blue: 0.729, alpha: 1)
        grabber.layer.cornerRadius = 2.5
        grabber.translatesAutoresizingMaskIntoConstraints = false

        titleLabel.text = "save to napkin"
        let titleFont = UIFont(name: "Georgia-Italic", size: 31) ?? UIFont.italicSystemFont(ofSize: 31)
        titleLabel.font = UIFontMetrics(forTextStyle: .largeTitle).scaledFont(for: titleFont)
        titleLabel.textColor = ink
        titleLabel.numberOfLines = 1
        titleLabel.adjustsFontSizeToFitWidth = true
        titleLabel.adjustsFontForContentSizeCategory = true
        titleLabel.minimumScaleFactor = 0.7

        subtitleLabel.text = "reading the share…"
        subtitleLabel.font = UIFontMetrics(forTextStyle: .subheadline).scaledFont(
            for: UIFont.systemFont(ofSize: 14)
        )
        subtitleLabel.textColor = ink.withAlphaComponent(0.72)
        subtitleLabel.numberOfLines = 2
        subtitleLabel.adjustsFontForContentSizeCategory = true
        spinner.color = terracotta
        spinner.startAnimating()
        spinner.setContentHuggingPriority(.required, for: .horizontal)
        let subRow = UIStackView(arrangedSubviews: [spinner, subtitleLabel])
        subRow.axis = .horizontal
        subRow.spacing = 8
        subRow.alignment = .center

        let header = UIStackView(arrangedSubviews: [titleLabel, subRow])
        header.axis = .vertical
        header.spacing = 7

        let reviewIcon = UIImageView(image: UIImage(systemName: "checkmark.shield"))
        reviewIcon.tintColor = terracotta
        reviewIcon.contentMode = .scaleAspectFit
        reviewIcon.setContentHuggingPriority(.required, for: .horizontal)
        reviewIcon.translatesAutoresizingMaskIntoConstraints = false
        NSLayoutConstraint.activate([
            reviewIcon.widthAnchor.constraint(equalToConstant: 24),
            reviewIcon.heightAnchor.constraint(equalToConstant: 24),
        ])

        let reviewTitle = UILabel()
        reviewTitle.text = "review before saving"
        reviewTitle.font = UIFontMetrics(forTextStyle: .body).scaledFont(
            for: UIFont.systemFont(ofSize: 15, weight: .semibold)
        )
        reviewTitle.textColor = ink
        reviewTitle.numberOfLines = 0
        reviewTitle.adjustsFontForContentSizeCategory = true

        let reviewBody = UILabel()
        reviewBody.text = "Nothing is saved until you review the import in Napkin. Organise it there afterward."
        reviewBody.font = UIFontMetrics(forTextStyle: .footnote).scaledFont(
            for: UIFont.systemFont(ofSize: 13)
        )
        reviewBody.textColor = ink.withAlphaComponent(0.72)
        reviewBody.numberOfLines = 0
        reviewBody.adjustsFontForContentSizeCategory = true

        let reviewCopy = UIStackView(arrangedSubviews: [reviewTitle, reviewBody])
        reviewCopy.axis = .vertical
        reviewCopy.spacing = 3

        let reviewRow = UIStackView(arrangedSubviews: [reviewIcon, reviewCopy])
        reviewRow.axis = .horizontal
        reviewRow.alignment = .top
        reviewRow.spacing = 12
        reviewRow.translatesAutoresizingMaskIntoConstraints = false

        let reviewPanel = UIView()
        reviewPanel.backgroundColor = terracotta.withAlphaComponent(0.055)
        reviewPanel.layer.cornerRadius = 15
        reviewPanel.addSubview(reviewRow)
        NSLayoutConstraint.activate([
            reviewRow.topAnchor.constraint(equalTo: reviewPanel.topAnchor, constant: 15),
            reviewRow.bottomAnchor.constraint(equalTo: reviewPanel.bottomAnchor, constant: -15),
            reviewRow.leadingAnchor.constraint(equalTo: reviewPanel.leadingAnchor, constant: 15),
            reviewRow.trailingAnchor.constraint(equalTo: reviewPanel.trailingAnchor, constant: -15),
        ])

        doneButton.setTitle("add for review", for: .normal)
        doneButton.titleLabel?.font = UIFontMetrics(forTextStyle: .headline).scaledFont(
            for: UIFont.systemFont(ofSize: 17, weight: .semibold)
        )
        doneButton.titleLabel?.adjustsFontForContentSizeCategory = true
        doneButton.setTitleColor(.white, for: .normal)
        doneButton.setTitleColor(taupe, for: .disabled)
        doneButton.backgroundColor = terracotta.withAlphaComponent(0.16)
        doneButton.layer.cornerRadius = 15
        doneButton.isEnabled = false
        doneButton.accessibilityHint = "Adds this share to Napkin so you can review it in the app."
        doneButton.addAction(UIAction { [weak self] _ in self?.setButtonPressed(true) }, for: .touchDown)
        doneButton.addAction(
            UIAction { [weak self] _ in self?.setButtonPressed(false) },
            for: [.touchUpInside, .touchUpOutside, .touchCancel, .touchDragExit]
        )
        doneButton.addAction(UIAction { [weak self] _ in self?.onDone() }, for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [header, reviewPanel, doneButton])
        stack.axis = .vertical
        stack.spacing = 16
        stack.setCustomSpacing(20, after: header)
        stack.translatesAutoresizingMaskIntoConstraints = false
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.showsVerticalScrollIndicator = false
        scroll.alwaysBounceVertical = false
        scroll.addSubview(stack)
        card.addSubview(grabber)
        card.addSubview(scroll)

        let topGuard = card.topAnchor.constraint(
            greaterThanOrEqualTo: view.safeAreaLayoutGuide.topAnchor, constant: 8)
        let preferredHeight = card.heightAnchor.constraint(equalTo: stack.heightAnchor, constant: 52)
        preferredHeight.priority = .defaultHigh

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),
            card.heightAnchor.constraint(
                lessThanOrEqualTo: view.safeAreaLayoutGuide.heightAnchor,
                constant: -16
            ),

            grabber.topAnchor.constraint(equalTo: card.topAnchor, constant: 10),
            grabber.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            grabber.widthAnchor.constraint(equalToConstant: 40),
            grabber.heightAnchor.constraint(equalToConstant: 5),

            scroll.topAnchor.constraint(equalTo: card.topAnchor, constant: 30),
            scroll.leadingAnchor.constraint(equalTo: card.leadingAnchor),
            scroll.trailingAnchor.constraint(equalTo: card.trailingAnchor),
            scroll.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -22),

            stack.topAnchor.constraint(equalTo: scroll.contentLayoutGuide.topAnchor),
            stack.bottomAnchor.constraint(equalTo: scroll.contentLayoutGuide.bottomAnchor),
            stack.leadingAnchor.constraint(equalTo: scroll.contentLayoutGuide.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: scroll.contentLayoutGuide.trailingAnchor, constant: -22),
            stack.widthAnchor.constraint(equalTo: scroll.frameLayoutGuide.widthAnchor, constant: -44),

            topGuard,
            preferredHeight,
            doneButton.heightAnchor.constraint(greaterThanOrEqualToConstant: 52),
        ])
    }

    private func setButtonPressed(_ pressed: Bool) {
        UIView.animate(
            withDuration: 0.14,
            delay: 0,
            options: [.beginFromCurrentState, .allowUserInteraction, .curveEaseOut]
        ) {
            self.doneButton.transform = pressed
                ? CGAffineTransform(scaleX: 0.96, y: 0.96)
                : .identity
        }
    }

    // MARK: - Capture

    private func captureSharedItem() {
        // Scan ALL input items, not just the first — Google apps in particular
        // split attachments across items.
        let items = (extensionContext?.inputItems as? [NSExtensionItem]) ?? []
        let attachments = items.flatMap { $0.attachments ?? [] }
        guard !attachments.isEmpty else { markFailed(); return }

        let movieType = UTType.movie.identifier
        let urlType = UTType.url.identifier
        let textType = UTType.plainText.identifier

        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(movieType) }) {
            provider.loadFileRepresentation(forTypeIdentifier: movieType) { [weak self] (fileURL, _) in
                guard let self = self else { return }
                let dest = fileURL.flatMap { self.copyToAppGroup($0) }
                DispatchQueue.main.async {
                    if let dest = dest { self.capturedVideoPath = dest.path; self.markReady(kind: "video") }
                    else { self.markFailed() }
                }
            }
            return
        }
        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) {
            provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] (data, _) in
                guard let self = self else { return }
                let url: URL? = (data as? URL) ?? (data as? String).flatMap(URL.init(string:))
                DispatchQueue.main.async {
                    if let url = url { self.capturedURL = url.absoluteString; self.markReady(kind: "url") }
                    else { self.markFailed() }
                }
            }
            return
        }
        // Text share: Google Maps (lists, places) and some other apps put the
        // link INSIDE a plain string ("Title\nhttps://maps.app.goo.gl/…").
        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(textType) }) {
            provider.loadItem(forTypeIdentifier: textType, options: nil) { [weak self] (data, _) in
                guard let self = self else { return }
                let text = (data as? String) ?? (data as? NSAttributedString)?.string
                let url = text.flatMap(Self.firstHTTPURL(in:))
                DispatchQueue.main.async {
                    if let url = url { self.capturedURL = url.absoluteString; self.markReady(kind: "url") }
                    else { self.markFailed() }
                }
            }
            return
        }
        // Last resort: hosts that only populate attributedContentText.
        if let text = items.compactMap({ $0.attributedContentText?.string }).first(where: { !$0.isEmpty }),
           let url = Self.firstHTTPURL(in: text) {
            capturedURL = url.absoluteString
            markReady(kind: "url")
            return
        }
        markFailed()
    }

    /// First http(s) link in a shared text blob (NSDataDetector).
    /// The detector also matches bare domain-shaped tokens ("eater.com") and
    /// synthesizes http:// for them — a list TITLE containing a domain would
    /// win over the actual share link. Prefer matches the sender literally
    /// typed with a scheme; synthesized ones are only a last resort.
    private static func firstHTTPURL(in text: String) -> URL? {
        guard let detector = try? NSDataDetector(types: NSTextCheckingResult.CheckingType.link.rawValue) else { return nil }
        let range = NSRange(text.startIndex..., in: text)
        var synthesized: URL? = nil
        for match in detector.matches(in: text, options: [], range: range) {
            guard let url = match.url, url.scheme == "http" || url.scheme == "https" else { continue }
            if let r = Range(match.range, in: text), text[r].lowercased().hasPrefix("http") {
                return url
            }
            if synthesized == nil { synthesized = url }
        }
        return synthesized
    }

    private func markReady(kind: String) {
        captureKind = kind
        captureReady = true
        spinner.stopAnimating()
        spinner.isHidden = true
        let isMapsLink = capturedURL?.range(
            of: #"maps\.app\.goo\.gl|goo\.gl/maps|maps\.google\.|google\.[a-z.]+/maps"#,
            options: .regularExpression
        ) != nil
        subtitleLabel.text = kind == "video"
            ? "video ready"
            : (isMapsLink
                ? "list ready"
                : "link ready")
        doneButton.setTitle("add for review", for: .normal)
        doneButton.setTitleColor(.white, for: .normal)
        doneButton.backgroundColor = terracotta
        doneButton.accessibilityHint = "Adds this share to Napkin so you can review it in the app."
        doneButton.isEnabled = true
    }

    private func markFailed(_ message: String = "couldn't read that — try again") {
        spinner.stopAnimating()
        spinner.isHidden = true
        subtitleLabel.text = message
        doneButton.setTitle("close", for: .normal)
        doneButton.setTitleColor(ink, for: .normal)
        doneButton.backgroundColor = UIColor.systemGray4
        doneButton.accessibilityHint = "Closes the share extension."
        doneButton.isEnabled = true
    }

    private func copyToAppGroup(_ src: URL) -> URL? {
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
        let dir = container.appendingPathComponent("shared-imports", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let ext = src.pathExtension.isEmpty ? "mov" : src.pathExtension
        let dest = dir.appendingPathComponent(UUID().uuidString + "." + ext)
        do { try FileManager.default.copyItem(at: src, to: dest); return dest } catch { return nil }
    }

    // MARK: - Done → write manifest

    private func jsonOrNull(_ s: String?) -> Any {
        if let s = s { return s }
        return NSNull()
    }

    private func onDone() {
        guard captureReady, let kind = captureKind else { complete(); return }
        // Close the double-tap window before touching the queue so one share can
        // never create two review manifests.
        captureReady = false
        doneButton.isEnabled = false
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
                failToQueue()
                return
            }
        let dir = container.appendingPathComponent("import-queue", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let jobId = UUID().uuidString
        let destinations: [String: Any] = [
            "wishlist": true,
            "listIds": [],
            "newListTitles": [],
            "tableIds": [],
            "tableId": NSNull(),
        ]
        var manifest: [String: Any] = [
            "jobId": jobId,
            "kind": kind,
            "importNonce": UUID().uuidString,
            "createdAt": Date().timeIntervalSince1970 * 1000,
            "attempts": 0,
            "status": "pending",
            "mode": "review",
            "userId": jsonOrNull(snapshotUserId),
            "destinations": destinations,
        ]
        if kind == "video", let p = capturedVideoPath { manifest["videoPath"] = p }
        if kind == "url", let u = capturedURL { manifest["url"] = u }

        guard let data = try? JSONSerialization.data(withJSONObject: manifest) else {
            failToQueue()
            return
        }
        let tmp = dir.appendingPathComponent(jobId + ".json.tmp")
        let final = dir.appendingPathComponent(jobId + ".json")
        do {
            try data.write(to: tmp)
            try FileManager.default.moveItem(at: tmp, to: final)
        } catch {
            try? FileManager.default.removeItem(at: tmp)
            failToQueue()
            return
        }
        titleLabel.text = "added for review"
        subtitleLabel.text = "open Napkin when you're ready to check the spots"
        doneButton.setTitle("added", for: .normal)
        doneButton.setTitleColor(.white, for: .disabled)
        doneButton.accessibilityHint = nil
        doneButton.isEnabled = false
        doneButton.transform = .identity
        UINotificationFeedbackGenerator().notificationOccurred(.success)
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.8) { [weak self] in
            self?.complete()
        }
    }

    private func failToQueue() {
        if let path = capturedVideoPath {
            try? FileManager.default.removeItem(atPath: path)
            capturedVideoPath = nil
        }
        markFailed("couldn't add that to Napkin — try sharing again")
    }

    private func complete() {
        DispatchQueue.main.async { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}
