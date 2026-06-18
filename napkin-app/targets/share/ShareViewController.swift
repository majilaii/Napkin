// TICKET-082 / TICKET-083 — iOS share extension: in-extension destination card.
//
// Share a VIDEO (saved file) or a URL (link) → a card lets you pick destinations
// — Wishlist (always) + your lists (multi) + one table — taps Done, writes a
// pending-import manifest to the App-Group queue, completeRequest. NO app-switch.
// The main app drains the queue (OCR/caption → resolve → auto-save → route) next open.
//
// Picker is rendered from a snapshot the app publishes (extension can't read the
// app cache). Max 3 per level; "show all" swaps to a scrollable full picker.
// "new list" → a tiny alert to type a name (created on the fly when the app saves).
// NO OCR here (~120MB cap). .mov is copied fully before the manifest is written.

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

    // Selections
    private var selectedListIds = Set<String>()
    private var selectedTableId: String?
    private var newListTitles: [String] = []
    private var autoSaveOn = true // toggle off → mode "review" (confirm in-app)

    // Header (hero) labels — updated as the share resolves
    private let titleLabel = UILabel()
    private let subtitleLabel = UILabel()

    // Snapshot data
    private var lists: [(id: String, title: String)] = []
    private var tables: [(id: String, name: String)] = []
    private var snapshotUserId: String?

    private enum Screen { case main, allLists, allTables }
    private var screen: Screen = .main

    // UI
    private let contentContainer = UIView()
    private let spinner = UIActivityIndicatorView(style: .medium)
    private let doneButton = UIButton(type: .system)

    override func viewDidLoad() {
        super.viewDidLoad()
        view.backgroundColor = UIColor.black.withAlphaComponent(0.3)
        loadSnapshot()
        buildChrome()
        render()
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

    // MARK: - Chrome (card + header + swappable content + pinned Done)

    private func buildChrome() {
        // Bottom-anchored sheet — larger, more breathable, hero header up top.
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

        // Hero header — big serif-italic title + subtitle (resolve status).
        titleLabel.text = "save to napkin"
        titleLabel.font = UIFont(name: "Georgia-Italic", size: 31) ?? UIFont.italicSystemFont(ofSize: 31)
        titleLabel.textColor = ink
        titleLabel.numberOfLines = 1
        titleLabel.adjustsFontSizeToFitWidth = true
        titleLabel.minimumScaleFactor = 0.7

        subtitleLabel.text = "reading the share…"
        subtitleLabel.font = UIFont.systemFont(ofSize: 14)
        subtitleLabel.textColor = taupe
        subtitleLabel.numberOfLines = 2
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

        // Swappable content lives in a height-capped scroll so the sheet never
        // overruns the screen — it hugs short content, scrolls when tall.
        contentContainer.translatesAutoresizingMaskIntoConstraints = false
        let contentScroll = UIScrollView()
        contentScroll.translatesAutoresizingMaskIntoConstraints = false
        contentScroll.showsVerticalScrollIndicator = false
        contentScroll.addSubview(contentContainer)

        doneButton.setTitle("done", for: .normal)
        doneButton.titleLabel?.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        doneButton.setTitleColor(.white, for: .normal)
        doneButton.setTitleColor(taupe, for: .disabled)
        doneButton.backgroundColor = terracotta
        doneButton.layer.cornerRadius = 15
        doneButton.isEnabled = false
        doneButton.addAction(UIAction { [weak self] _ in self?.onDone() }, for: .touchUpInside)

        let stack = UIStackView(arrangedSubviews: [header, rule(), contentScroll, doneButton])
        stack.axis = .vertical
        stack.spacing = 14
        stack.setCustomSpacing(16, after: header)
        stack.translatesAutoresizingMaskIntoConstraints = false
        card.addSubview(grabber)
        card.addSubview(stack)

        // Hug content when short; cap (and scroll) when tall.
        let scrollHug = contentScroll.heightAnchor.constraint(equalTo: contentContainer.heightAnchor)
        scrollHug.priority = .defaultLow
        let scrollCap = contentScroll.heightAnchor.constraint(
            lessThanOrEqualTo: view.heightAnchor, multiplier: 0.55)
        // On the smallest screens, keep the card (hero title) below the status bar.
        let topGuard = card.topAnchor.constraint(
            greaterThanOrEqualTo: view.safeAreaLayoutGuide.topAnchor, constant: 8)
        topGuard.priority = .defaultHigh

        NSLayoutConstraint.activate([
            card.leadingAnchor.constraint(equalTo: view.leadingAnchor, constant: 10),
            card.trailingAnchor.constraint(equalTo: view.trailingAnchor, constant: -10),
            card.bottomAnchor.constraint(equalTo: view.safeAreaLayoutGuide.bottomAnchor, constant: -8),

            grabber.topAnchor.constraint(equalTo: card.topAnchor, constant: 10),
            grabber.centerXAnchor.constraint(equalTo: card.centerXAnchor),
            grabber.widthAnchor.constraint(equalToConstant: 40),
            grabber.heightAnchor.constraint(equalToConstant: 5),

            stack.topAnchor.constraint(equalTo: card.topAnchor, constant: 30),
            stack.leadingAnchor.constraint(equalTo: card.leadingAnchor, constant: 22),
            stack.trailingAnchor.constraint(equalTo: card.trailingAnchor, constant: -22),
            stack.bottomAnchor.constraint(equalTo: card.bottomAnchor, constant: -22),

            contentContainer.topAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.topAnchor),
            contentContainer.bottomAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.bottomAnchor),
            contentContainer.leadingAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.leadingAnchor),
            contentContainer.trailingAnchor.constraint(equalTo: contentScroll.contentLayoutGuide.trailingAnchor),
            contentContainer.widthAnchor.constraint(equalTo: contentScroll.frameLayoutGuide.widthAnchor),

            scrollHug,
            scrollCap,
            topGuard,
            doneButton.heightAnchor.constraint(equalToConstant: 52),
        ])
    }

    private func updateDoneTitle() {
        let n = selectedListIds.count + newListTitles.count + (selectedTableId != nil ? 1 : 0)
        doneButton.setTitle(n > 0 ? "done · \(n)" : "done", for: .normal)
    }

    // MARK: - Render (swap content per screen)

    private func render() {
        contentContainer.subviews.forEach { $0.removeFromSuperview() }
        let body: UIView
        switch screen {
        case .main: body = buildMain()
        case .allLists: body = buildAllPicker(isLists: true)
        case .allTables: body = buildAllPicker(isLists: false)
        }
        body.translatesAutoresizingMaskIntoConstraints = false
        contentContainer.addSubview(body)
        NSLayoutConstraint.activate([
            body.topAnchor.constraint(equalTo: contentContainer.topAnchor),
            body.bottomAnchor.constraint(equalTo: contentContainer.bottomAnchor),
            body.leadingAnchor.constraint(equalTo: contentContainer.leadingAnchor),
            body.trailingAnchor.constraint(equalTo: contentContainer.trailingAnchor),
        ])
        updateDoneTitle()
    }

    // MARK: - Screens

    private func buildMain() -> UIView {
        let s = UIStackView()
        s.axis = .vertical
        s.spacing = 2

        s.addArrangedSubview(rule())
        s.addArrangedSubview(makeRow(text: "Wishlist", checked: true, serif: true, onTap: nil))

        // Auto-save toggle — on (default) saves silently in-app; off holds the
        // import for you to confirm the spots on next open (mode "review").
        s.addArrangedSubview(makeToggleRow(
            text: "auto-save",
            sub: autoSaveOn ? "we'll add the spots for you" : "you'll confirm them in the app",
            isOn: autoSaveOn,
            onToggle: { [weak self] on in self?.autoSaveOn = on; self?.render() }
        ))

        // Lists: max 3 + show all
        s.addArrangedSubview(kicker("your lists", count: lists.count, showAll: lists.count > 3, onShowAll: { [weak self] in
            self?.screen = .allLists; self?.render()
        }))
        for l in lists.prefix(3) {
            s.addArrangedSubview(makeRow(text: l.title, checked: selectedListIds.contains(l.id), serif: true, onTap: { [weak self] in
                self?.toggleList(l.id)
            }))
        }
        for (i, t) in newListTitles.enumerated() {
            s.addArrangedSubview(makeRow(text: "\(t)  ·  new", checked: true, serif: true, onTap: { [weak self] in
                self?.newListTitles.remove(at: i); self?.render()
            }))
        }
        s.addArrangedSubview(addRow(text: "new list", onTap: { [weak self] in self?.promptNewList() }))

        // Tables: max 3 + show all (single-select for now)
        if !tables.isEmpty {
            s.addArrangedSubview(kicker("share to a table", count: tables.count, showAll: tables.count > 3, onShowAll: { [weak self] in
                self?.screen = .allTables; self?.render()
            }))
            for t in tables.prefix(3) {
                s.addArrangedSubview(makeRow(text: t.name, checked: selectedTableId == t.id, serif: true, onTap: { [weak self] in
                    self?.toggleTable(t.id)
                }))
            }
        }
        return s
    }

    private func buildAllPicker(isLists: Bool) -> UIView {
        let outer = UIStackView()
        outer.axis = .vertical
        outer.spacing = 6

        let back = UIButton(type: .system)
        back.setTitle("‹ back", for: .normal)
        back.titleLabel?.font = UIFont.systemFont(ofSize: 14, weight: .semibold)
        back.setTitleColor(terracotta, for: .normal)
        back.contentHorizontalAlignment = .left
        back.addAction(UIAction { [weak self] _ in self?.screen = .main; self?.render() }, for: .touchUpInside)
        outer.addArrangedSubview(back)

        let header = UILabel()
        header.text = isLists ? "all lists" : "all tables"
        header.font = UIFont.systemFont(ofSize: 16, weight: .semibold)
        header.textColor = ink
        outer.addArrangedSubview(header)

        // Rows go straight into the stack — the card's content scroll (buildChrome)
        // handles overflow, so no nested scroll here.
        if isLists {
            for l in lists {
                outer.addArrangedSubview(makeRow(text: l.title, checked: selectedListIds.contains(l.id), serif: true, onTap: { [weak self] in
                    self?.toggleList(l.id)
                }))
            }
        } else {
            for t in tables {
                outer.addArrangedSubview(makeRow(text: t.name, checked: selectedTableId == t.id, serif: true, onTap: { [weak self] in
                    self?.toggleTable(t.id)
                }))
            }
        }
        return outer
    }

    // MARK: - Row builders

    private func rule() -> UIView {
        let v = UIView()
        v.backgroundColor = UIColor(red: 0.867, green: 0.753, blue: 0.729, alpha: 0.45)
        v.heightAnchor.constraint(equalToConstant: 1).isActive = true
        return v
    }

    private func kicker(_ text: String, count: Int, showAll: Bool, onShowAll: @escaping () -> Void) -> UIView {
        let k = UILabel()
        k.text = text.uppercased()
        k.font = UIFont.systemFont(ofSize: 10, weight: .semibold)
        k.textColor = taupe
        let row = UIStackView(arrangedSubviews: [k, UIView()])
        row.axis = .horizontal
        row.alignment = .firstBaseline
        if showAll {
            let b = UIButton(type: .system)
            b.setTitle("show all \(count)", for: .normal)
            b.titleLabel?.font = UIFont.systemFont(ofSize: 12, weight: .bold)
            b.setTitleColor(terracotta, for: .normal)
            b.addAction(UIAction { _ in onShowAll() }, for: .touchUpInside)
            row.addArrangedSubview(b)
        }
        let wrap = UIView()
        row.translatesAutoresizingMaskIntoConstraints = false
        wrap.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: wrap.topAnchor, constant: 12),
            row.bottomAnchor.constraint(equalTo: wrap.bottomAnchor, constant: -4),
            row.leadingAnchor.constraint(equalTo: wrap.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
        ])
        return wrap
    }

    private func makeRow(text: String, checked: Bool, serif: Bool, onTap: (() -> Void)?) -> UIView {
        let label = UILabel()
        label.text = text
        label.font = serif
            ? (UIFont(name: "Georgia-Italic", size: 17) ?? UIFont.italicSystemFont(ofSize: 17))
            : UIFont.systemFont(ofSize: 16)
        label.textColor = ink
        label.numberOfLines = 1

        let check = UILabel()
        check.text = checked ? "✓" : ""
        check.font = UIFont.systemFont(ofSize: 17, weight: .semibold)
        check.textColor = checked ? terracotta : taupe
        let checkWrap = UIView()
        checkWrap.layer.cornerRadius = 11.5
        checkWrap.layer.borderWidth = checked ? 0 : 2
        checkWrap.layer.borderColor = UIColor(red: 0.867, green: 0.753, blue: 0.729, alpha: 1).cgColor
        checkWrap.backgroundColor = checked ? terracotta : .clear
        check.textColor = checked ? .white : .clear
        checkWrap.translatesAutoresizingMaskIntoConstraints = false
        check.translatesAutoresizingMaskIntoConstraints = false
        checkWrap.addSubview(check)
        NSLayoutConstraint.activate([
            checkWrap.widthAnchor.constraint(equalToConstant: 23),
            checkWrap.heightAnchor.constraint(equalToConstant: 23),
            check.centerXAnchor.constraint(equalTo: checkWrap.centerXAnchor),
            check.centerYAnchor.constraint(equalTo: checkWrap.centerYAnchor),
        ])

        let row = UIStackView(arrangedSubviews: [label, UIView(), checkWrap])
        row.axis = .horizontal
        row.alignment = .center
        row.translatesAutoresizingMaskIntoConstraints = false
        row.heightAnchor.constraint(equalToConstant: 44).isActive = true

        let wrap = UIView()
        wrap.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: wrap.topAnchor),
            row.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
            row.leadingAnchor.constraint(equalTo: wrap.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
        ])
        if let onTap = onTap {
            let btn = UIButton(type: .system)
            btn.translatesAutoresizingMaskIntoConstraints = false
            btn.addAction(UIAction { _ in onTap() }, for: .touchUpInside)
            wrap.addSubview(btn)
            NSLayoutConstraint.activate([
                btn.topAnchor.constraint(equalTo: wrap.topAnchor),
                btn.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
                btn.leadingAnchor.constraint(equalTo: wrap.leadingAnchor),
                btn.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
            ])
        }
        return wrap
    }

    private func makeToggleRow(text: String, sub: String, isOn: Bool, onToggle: @escaping (Bool) -> Void) -> UIView {
        let label = UILabel()
        label.text = text
        label.font = UIFont.systemFont(ofSize: 16)
        label.textColor = ink

        let subLabel = UILabel()
        subLabel.text = sub
        subLabel.font = UIFont.systemFont(ofSize: 12)
        subLabel.textColor = taupe
        subLabel.numberOfLines = 1

        let texts = UIStackView(arrangedSubviews: [label, subLabel])
        texts.axis = .vertical
        texts.spacing = 1

        let toggle = UISwitch()
        toggle.isOn = isOn
        toggle.onTintColor = terracotta
        toggle.setContentHuggingPriority(.required, for: .horizontal)
        toggle.addAction(UIAction { [weak toggle] _ in onToggle(toggle?.isOn ?? false) }, for: .valueChanged)

        let row = UIStackView(arrangedSubviews: [texts, UIView(), toggle])
        row.axis = .horizontal
        row.alignment = .center
        row.translatesAutoresizingMaskIntoConstraints = false
        row.heightAnchor.constraint(greaterThanOrEqualToConstant: 48).isActive = true

        let wrap = UIView()
        wrap.addSubview(row)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: wrap.topAnchor),
            row.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
            row.leadingAnchor.constraint(equalTo: wrap.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
        ])
        return wrap
    }

    private func addRow(text: String, onTap: @escaping () -> Void) -> UIView {
        let plus = UILabel()
        plus.text = "+"
        plus.font = UIFont.systemFont(ofSize: 20, weight: .regular)
        plus.textColor = terracotta
        let label = UILabel()
        label.text = text
        label.font = UIFont.systemFont(ofSize: 15, weight: .semibold)
        label.textColor = terracotta
        let row = UIStackView(arrangedSubviews: [plus, label, UIView()])
        row.axis = .horizontal
        row.alignment = .center
        row.spacing = 8
        row.translatesAutoresizingMaskIntoConstraints = false
        row.heightAnchor.constraint(equalToConstant: 42).isActive = true
        let wrap = UIView()
        wrap.addSubview(row)
        let btn = UIButton(type: .system)
        btn.translatesAutoresizingMaskIntoConstraints = false
        btn.addAction(UIAction { _ in onTap() }, for: .touchUpInside)
        wrap.addSubview(btn)
        NSLayoutConstraint.activate([
            row.topAnchor.constraint(equalTo: wrap.topAnchor),
            row.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
            row.leadingAnchor.constraint(equalTo: wrap.leadingAnchor),
            row.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
            btn.topAnchor.constraint(equalTo: wrap.topAnchor),
            btn.bottomAnchor.constraint(equalTo: wrap.bottomAnchor),
            btn.leadingAnchor.constraint(equalTo: wrap.leadingAnchor),
            btn.trailingAnchor.constraint(equalTo: wrap.trailingAnchor),
        ])
        return wrap
    }

    // MARK: - Selection

    private func toggleList(_ id: String) {
        if selectedListIds.contains(id) { selectedListIds.remove(id) } else { selectedListIds.insert(id) }
        render()
    }

    private func toggleTable(_ id: String) {
        selectedTableId = (selectedTableId == id) ? nil : id // single-select for now
        render()
    }

    private func promptNewList() {
        let alert = UIAlertController(title: "new list", message: nil, preferredStyle: .alert)
        alert.addTextField { tf in
            tf.placeholder = "name your list"
            tf.autocapitalizationType = .none
        }
        alert.addAction(UIAlertAction(title: "cancel", style: .cancel))
        alert.addAction(UIAlertAction(title: "create", style: .default) { [weak self, weak alert] _ in
            let name = alert?.textFields?.first?.text?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            guard !name.isEmpty else { return }
            self?.newListTitles.append(name)
            self?.render()
        })
        present(alert, animated: true)
    }

    // MARK: - Capture

    private func captureSharedItem() {
        guard
            let item = (extensionContext?.inputItems as? [NSExtensionItem])?.first,
            let attachments = item.attachments
        else { markFailed(); return }

        let movieType = UTType.movie.identifier
        let urlType = UTType.url.identifier

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
        markFailed()
    }

    private func markReady(kind: String) {
        captureKind = kind
        captureReady = true
        spinner.stopAnimating()
        spinner.isHidden = true
        subtitleLabel.text = kind == "video"
            ? "pick where it lands — we'll pull the spots in the app"
            : "got the link — save the video for the full list"
        doneButton.isEnabled = true
    }

    private func markFailed() {
        spinner.stopAnimating()
        spinner.isHidden = true
        subtitleLabel.text = "couldn't read that — try again"
        doneButton.setTitle("close", for: .normal)
        doneButton.backgroundColor = UIColor.systemGray4
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
        guard let container = FileManager.default
            .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { complete(); return }
        let dir = container.appendingPathComponent("import-queue", isDirectory: true)
        try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)

        let jobId = UUID().uuidString
        let destinations: [String: Any] = [
            "wishlist": true,
            "listIds": Array(selectedListIds),
            "newListTitles": newListTitles,
            "tableId": jsonOrNull(selectedTableId),
        ]
        var manifest: [String: Any] = [
            "jobId": jobId,
            "kind": kind,
            "importNonce": UUID().uuidString,
            "createdAt": Date().timeIntervalSince1970 * 1000,
            "attempts": 0,
            "status": "pending",
            "mode": autoSaveOn ? "auto" : "review",
            "userId": jsonOrNull(snapshotUserId),
            "destinations": destinations,
        ]
        if kind == "video", let p = capturedVideoPath { manifest["videoPath"] = p }
        if kind == "url", let u = capturedURL { manifest["url"] = u }

        if let data = try? JSONSerialization.data(withJSONObject: manifest) {
            let tmp = dir.appendingPathComponent(jobId + ".json.tmp")
            let final = dir.appendingPathComponent(jobId + ".json")
            do { try data.write(to: tmp); try FileManager.default.moveItem(at: tmp, to: final) }
            catch { try? FileManager.default.removeItem(at: tmp) }
        }
        complete()
    }

    private func complete() {
        DispatchQueue.main.async { [weak self] in
            self?.extensionContext?.completeRequest(returningItems: [], completionHandler: nil)
        }
    }
}
