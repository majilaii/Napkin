// TICKET-082 / TICKET-083 — iOS share extension for wishlist import.
//
// In-extension destination card, NO app-switch:
//   • VIDEO (saved from Photos) → copy the .mov into the App Group
//   • URL  (TikTok/Maps link)   → keep the link
// then the user picks destinations (Wishlist always + their lists + one Table),
// taps Done, and we write a pending-import manifest into the App-Group queue +
// completeRequest. The main app drains the queue (OCR/caption → resolve →
// auto-save → route to destinations) on its next open. No redirect, ever.
//
// The picker is rendered from a snapshot the main app publishes to the App Group
// (the extension can't read the app's cache). NO OCR in the extension (~120MB cap).
// .mov is copied FULLY before the manifest is written (manifest never references a
// half-copied file).

import UIKit
import UniformTypeIdentifiers

class ShareViewController: UIViewController {
    private let appGroup = "group.com.majilaii.napkin.shared"

    // Heirloom palette
    private let ink = UIColor(red: 0.110, green: 0.110, blue: 0.098, alpha: 1)
    private let taupe = UIColor(red: 0.541, green: 0.447, blue: 0.424, alpha: 1)
    private let terracotta = UIColor(red: 0.627, green: 0.247, blue: 0.157, alpha: 1)
    private let note = UIColor(red: 0.996, green: 0.992, blue: 0.973, alpha: 1)
    private let rule = UIColor(red: 0.867, green: 0.753, blue: 0.729, alpha: 1)

    // Captured source
    private var capturedVideoPath: String?
    private var capturedURL: String?
    private var captureKind: String? // "video" | "url"
    private var captureReady = false

    // Selections (wishlist is always on)
    private var selectedListIds = Set<String>()
    private var selectedTableId: String?
    private var listChecks: [String: UILabel] = [:]
    private var tableChecks: [String: UILabel] = [:]

    // Snapshot
    private var lists: [(id: String, title: String)] = []
    private var tables: [(id: String, name: String)] = []
    private var snapshotUserId: String?

    // UI
    private let statusLabel = UILabel()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.3)
        loadSnapshot()
        setupUI()
    }

    override func viewDidAppear(_ animated: Bool) {
        super.viewDidAppear(animated)
        captureSharedItem()
    }

    // MARK: - Snapshot

    private func loadSnapshot() {
        guard
            let container = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup),
            let data = try? Data(contentsOf: container.appendingPathComponent("collections-snapshot.json")),
            let obj = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        else { return }

        snapshotUserId = obj["userId"] as? String
        if let ls = obj["lists"] as? [[String: Any]] {
            lists = ls.compactMap { d in
                guard let id = d["id"] as? String, let title = d["title"] as? String else { return nil }
                return (id, title)
            }
        }
        if let ts = obj["tables"] as? [[String: Any]] {
            tables = ts.compactMap { d in
                guard let id = d["id"] as? String, let name = d["name"] as? String else { return nil }
                return (id, name)
            }
        }
    }

    // MARK: - UI

    private func setupUI() {
        let card = UIView()
        card.backgroundColor = note
        card.layer.cornerRadius = 20
        card.translatesAutoresizingMaskIntoConstraints = false
        view.addSubview(card)

        let title = UILabel()
        title.text = "save to napkin"
        title.font = UIFont.systemFont(ofSize: 20, weight: .semibold)
        title.textColor = ink

        statusLabel.text = "reading the share…"
        statusLabel.font = UIFont.systemFont(ofSize: 13)
        statusLabel.textColor = taupe

        spinner.color = terracotta
        spinner.startAnimating()

        let headerRow = UIStackView(arrangedSubviews: [title, UIView(), spinner])
        headerRow.axis = .horizontal
        headerRow.alignment = .center

        let content = UIStackView()
        content.axis = .vertical
        content.spacing = 2
        content.translatesAutoresizingMaskIntoConstraints = false
        content.addArrangedSubview(headerRow)
        content.addArrangedSubview(statusLabel)
        content.setCustomSpacing(14, after: statusLabel)

        // Wishlist — always on (static checked row).
        content.addArrangedSubview(makeStaticRow(text: "Wishlist"))

        if !lists.isEmpty {
            content.addArrangedSubview(makeKicker("YOUR LISTS"))
            for l in lists {
                content.addArrangedSubview(makeToggleRow(id: l.id, text: l.title, store: .list))
            }
        }
        if !tables.isEmpty {
            content.addArrangedSubview(makeKicker("SHARE TO A TABLE"))
            for t in tables {
                content.addArrangedSubview(makeToggleRow(id: t.id, text: t.name, store: .table))
            }
        }

        // Scroll wraps the content so long collection lists stay usable.
        let scroll = UIScrollView()
        scroll.translatesAutoresizingMaskIntoConstraints = false
        scroll.showsVerticalScrollIndicator = false
        scroll.addSubview(content)

        doneButton.setTitle("Done", for: .normal)
        doneButton.titleLabel?.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        doneButton.setTitleColor(UIColor.white, for: .normal)
        doneButton.setTitleColor(taupe, for: .disabled)
        doneButton.backgroundColor = terracotta
        doneButton.layer.cornerRadius = 12
        doneButton.isEnabled = false
        doneButton.translatesAutoresizingMaskIntoConstraints = false
        doneButton.addAction(UIAction { [weak self] _ in self?.onDone() }, for: .touchUpInside)
        card.addSubview(doneButton)
        card.addSubview(scroll)

        NSLayoutConstraint.activate([
            card.centerXAnchor.constraint(equalTo: view.centerXAnchor),
            card.centerYAnchor.constraint(equalTo: view.centerYAnchor),
            card.widthAnchor.constraint(equalToConstant: 320),
            card.heightAnchor.constraint(lessThanOrEqualTo: view.heightAnchor, multiplier: 0.7),

            scroll.topAnchor.constraint(equalTo: card.topAnchor, constant: 22),
            scroll.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            scroll.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),

            content.topAnchor.constraint(equalTo: scroll.topAnchor),
            content.bottomAnchor.constraint(equalTo: scroll.bottomAnchor),
            content.leadingAnchor.constraint(equalTo: scroll.leadingAnchor),
            content.trailingAnchor.constraint(equalTo: scroll.trailingAnchor),
            content.widthAnchor.constraint(equalTo: scroll.widthAnchor),

            doneButton.topAnchor.constraint(equalTo: scroll.bottomAnchor, constant: 16),
            doneButton.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 20),
            doneButton.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -20),
            doneButton.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -20),
            doneButton.heightAnchor.constraint(equalToConstant: 48),
        ])
    }

    private enum Store { case list, table }

    private func makeKicker(_ text: String) -> UIView {
        let l = UILabel()
        l.text = text
        l.font = UIFont.systemFont(ofSize: 10, weight: .semibold)
        l.textColor = taupe
        l.heightAnchor.constraint(equalToConstant: 30).isActive = true
        return l
    }

    private func makeStaticRow(text: String) -> UIView {
        let label = UILabel()
        label.text = text
        label.font = UIFont.systemFont(ofSize: 16)
        label.textColor = ink
        let check = UILabel()
        check.text = "✓"
        check.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        check.textColor = terracotta
        let row = UIStackView(arrangedSubviews: [label, UIView(), check])
        row.axis = .horizontal
        row.alignment = .center
        row.heightAnchor.constraint(equalToConstant: 44).isActive = true
        return row
    }

    private func makeToggleRow(id: String, text: String, store: Store) -> UIView {
        let label = UILabel()
        label.text = text
        label.font = UIFont.systemFont(ofSize: 16)
        label.textColor = ink
        label.numberOfLines = 1

        let check = UILabel()
        check.text = "✓"
        check.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        check.textColor = terracotta
        check.alpha = 0

        if store == .list { listChecks[id] = check } else { tableChecks[id] = check }

        let row = UIStackView(arrangedSubviews: [label, UIView(), check])
        row.axis = .horizontal
        row.alignment = .center
        row.isLayoutMarginsRelativeArrangement = true
        row.heightAnchor.constraint(equalToConstant: 44).isActive = true

        let button = UIButton(type: .system)
        button.translatesAutoresizingMaskIntoConstraints = false
        button.addAction(UIAction { [weak self] _ in
            if store == .list { self?.toggleList(id) } else { self?.toggleTable(id) }
        }, for: .touchUpInside)
        row.addSubview(button)
        NSLayoutConstraint.activate([
            button.topAnchor.constraint(equalTo: row.topAnchor),
            button.bottomAnchor.constraint(equalTo: row.bottomAnchor),
            button.leadingAnchor.constraint(equalTo: row.leadingAnchor),
            button.trailingAnchor.constraint(equalTo: row.trailingAnchor),
        ])
        return row
    }

    private func toggleList(_ id: String) {
        if selectedListIds.contains(id) {
            selectedListIds.remove(id)
            listChecks[id]?.alpha = 0
        } else {
            selectedListIds.insert(id)
            listChecks[id]?.alpha = 1
        }
    }

    private func toggleTable(_ id: String) {
        if selectedTableId == id {
            selectedTableId = nil
            tableChecks[id]?.alpha = 0
        } else {
            selectedTableId = id
            for (tid, lbl) in tableChecks { lbl.alpha = (tid == id) ? 1 : 0 } // radio
        }
    }

    private func markReady(kind: String) {
        captureKind = kind
        captureReady = true
        spinner.stopAnimating()
        spinner.isHidden = true
        statusLabel.text = kind == "video" ? "ready to save" : "got the link — save the video for the full list"
        doneButton.isEnabled = true
    }

    private func markFailed() {
        spinner.stopAnimating()
        spinner.isHidden = true
        statusLabel.text = "couldn't read that — try again"
        doneButton.setTitle("Close", for: .normal)
        doneButton.backgroundColor = UIColor.systemGray4
        doneButton.isEnabled = true // lets the user dismiss
    }

    // MARK: - Capture

    private func captureSharedItem() {
        guard
            let item = (extensionContext?.inputItems as? [NSExtensionItem])?.first,
            let attachments = item.attachments
        else {
            markFailed()
            return
        }

        let movieType = UTType.movie.identifier
        let urlType = UTType.url.identifier

        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(movieType) }) {
            provider.loadFileRepresentation(forTypeIdentifier: movieType) { [weak self] (fileURL, _) in
                guard let self = self else { return }
                let dest = fileURL.flatMap { self.copyToAppGroup($0) }
                DispatchQueue.main.async {
                    if let dest = dest {
                        self.capturedVideoPath = dest.path
                        self.markReady(kind: "video")
                    } else {
                        self.markFailed()
                    }
                }
            }
            return
        }

        if let provider = attachments.first(where: { $0.hasItemConformingToTypeIdentifier(urlType) }) {
            provider.loadItem(forTypeIdentifier: urlType, options: nil) { [weak self] (data, _) in
                guard let self = self else { return }
                let url: URL? = (data as? URL) ?? (data as? String).flatMap(URL.init(string:))
                DispatchQueue.main.async {
                    if let url = url {
                        self.capturedURL = url.absoluteString
                        self.markReady(kind: "url")
                    } else {
                        self.markFailed()
                    }
                }
            }
            return
        }

        markFailed()
    }

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

    // MARK: - Done → write manifest

    private func onDone() {
        guard captureReady, let kind = captureKind else {
            complete()
            return
        }
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else {
            complete()
            return
        }
        let dir = container.appendingPathComponent("import-queue", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let jobId = UUID().uuidString
        var manifest: [String: Any] = [
            "jobId": jobId,
            "kind": kind,
            "importNonce": UUID().uuidString,
            "createdAt": Date().timeIntervalSince1970 * 1000,
            "attempts": 0,
            "status": "pending",
            "mode": "auto",
            "userId": snapshotUserId ?? NSNull(),
            "destinations": [
                "wishlist": true,
                "listIds": Array(selectedListIds),
                "tableId": selectedTableId ?? NSNull(),
            ],
        ]
        if kind == "video" { manifest["videoPath"] = capturedVideoPath }
        if kind == "url" { manifest["url"] = capturedURL }

        if let data = try? JSONSerialization.data(withJSONObject: manifest) {
            let tmp = dir.appendingPathComponent(jobId + ".json.tmp")
            let final = dir.appendingPathComponent(jobId + ".json")
            do {
                try data.write(to: tmp)
                try FileManager.default.moveItem(at: tmp, to: final)
            } catch {
                try? FileManager.default.removeItem(at: tmp)
            }
        }
        complete()
    }

    private func complete() {
        DispatchQueue.main.async { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}
