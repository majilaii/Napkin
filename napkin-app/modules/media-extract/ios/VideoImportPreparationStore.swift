import Foundation

/// Durable source preparation, independent of UIKit so expiry/relaunch races
/// can be tested with local files. File copying never holds the manifest lock.
final class VideoImportPreparationStore {
  static let appGroup = "group.com.majilaii.napkin.shared"
  static let shared: VideoImportPreparationStore? = {
    #if canImport(Darwin)
    guard let root = FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
    return VideoImportPreparationStore(root: root)
    #else
    return nil // File/state tests inject their own root; no UIKit or App Group required.
    #endif
  }()

  struct Job {
    let id: String
    let userId: String
    let video: URL
    var partial: URL { video.appendingPathExtension("partial") }
  }

  enum Failure: Error { case invalidOwner, missingManifest, emptyVideo }
  let root: URL
  private let lock = NSRecursiveLock()
  private var active = Set<String>()
  private var removed = Set<String>()
  private let copyFile: (URL, URL) throws -> Void
  private var queue: URL { root.appendingPathComponent("import-queue", isDirectory: true) }
  private var videos: URL { root.appendingPathComponent("import-videos", isDirectory: true) }

  init(root: URL, copyFile: @escaping (URL, URL) throws -> Void = { try FileManager.default.copyItem(at: $0, to: $1) }) {
    self.root = root
    self.copyFile = copyFile
  }

  func prepare(userId: String, fileExtension: String) throws -> Job {
    guard UUID(uuidString: userId) != nil else { throw Failure.invalidOwner }
    lock.lock(); defer { lock.unlock() }
    try FileManager.default.createDirectory(at: queue, withIntermediateDirectories: true)
    try FileManager.default.createDirectory(at: videos, withIntermediateDirectories: true)
    let id = UUID().uuidString.lowercased()
    let ext = fileExtension.range(of: "^[a-zA-Z0-9]{1,8}$", options: .regularExpression) == nil ? "mov" : fileExtension.lowercased()
    let job = Job(id: id, userId: userId, video: videos.appendingPathComponent(id).appendingPathExtension(ext))
    let manifest: [String: Any] = [
      "jobId": id, "kind": "video", "videoPath": job.video.path,
      "importNonce": UUID().uuidString.lowercased(), "protocolGeneration": "v2",
      "destinationNonces": ["wishlist": UUID().uuidString.lowercased(), "tables": [:], "lists": [:], "newLists": [:]] as [String: Any],
      "createdAt": Date().timeIntervalSince1970 * 1000,
      "attempts": 0, "userId": userId, "status": "pending", "mode": "review",
      "destinations": ["wishlist": true, "listIds": [], "newListTitles": [], "tableId": NSNull(), "tableIds": []] as [String: Any],
      "sourcePreparation": "pending", "stage": "downloading video",
    ]
    try save(manifest, id: id)
    active.insert(id)
    return job
  }

  /// Copy before NSItemProvider's completion returns; its temporary URL then expires.
  /// Only a complete, nonempty sibling file is renamed into the published path.
  func receive(_ source: URL, for job: Job) throws -> Bool {
    lock.lock()
    let permitted = active.contains(job.id)
    lock.unlock()
    guard permitted else { return false }
    defer { try? FileManager.default.removeItem(at: job.partial) }
    try copyFile(source, job.partial)
    let attributes = try FileManager.default.attributesOfItem(atPath: job.partial.path)
    guard (attributes[.size] as? NSNumber)?.int64Value ?? 0 > 0 else { throw Failure.emptyVideo }
    lock.lock(); defer { lock.unlock() }
    guard active.contains(job.id), var manifest = read(job.id),
          manifest["userId"] as? String == job.userId,
          manifest["sourcePreparation"] as? String == "pending",
          manifest["status"] as? String == "pending" else {
      active.remove(job.id)
      return false
    }
    try FileManager.default.moveItem(at: job.partial, to: job.video)
    manifest["sourcePreparation"] = "ready"
    manifest["stage"] = "reading the video"
    do { try save(manifest, id: job.id) }
    catch { try? FileManager.default.removeItem(at: job.video); throw error }
    active.remove(job.id)
    return true
  }

  @discardableResult
  func fail(_ job: Job) throws -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard active.remove(job.id) != nil, var manifest = read(job.id),
          manifest["userId"] as? String == job.userId,
          manifest["sourcePreparation"] as? String == "pending" else { return false }
    manifest["sourcePreparation"] = "failed"
    manifest["status"] = "failed"
    defer { cleanFiles(manifest) }
    try save(manifest, id: job.id)
    return true
  }

  func isTerminal(_ job: Job) -> Bool {
    lock.lock(); defer { lock.unlock() }
    let state = read(job.id)?["sourcePreparation"] as? String
    return state == "ready" || state == "failed"
  }

  /// A prior process cannot continue its NSItemProvider request after relaunch.
  /// Never infer readiness from an orphaned file, even if it looks complete.
  func listManifests() -> [String] {
    lock.lock(); defer { lock.unlock() }
    let files = (try? FileManager.default.contentsOfDirectory(at: queue, includingPropertiesForKeys: nil)) ?? []
    return files.filter { $0.pathExtension == "json" }.compactMap { file in
      let id = file.deletingPathExtension().lastPathComponent
      guard var manifest = read(id) else { return nil }
      if manifest["kind"] as? String == "video", manifest["sourcePreparation"] as? String == "pending", !active.contains(id) {
        manifest["sourcePreparation"] = "failed"
        manifest["status"] = "failed"
        do { try save(manifest, id: id); cleanFiles(manifest) }
        catch { return try? String(contentsOf: file, encoding: .utf8) }
      }
      guard let data = try? JSONSerialization.data(withJSONObject: manifest) else { return nil }
      return String(data: data, encoding: .utf8)
    }
  }

  func writeManifest(id: String, json: String) -> Bool {
    lock.lock(); defer { lock.unlock() }
    guard !removed.contains(id), let data = json.data(using: .utf8) else { return false }
    do {
      try FileManager.default.createDirectory(at: queue, withIntermediateDirectories: true)
      if let current = read(id), let preparation = current["sourcePreparation"] as? String,
         var incoming = try JSONSerialization.jsonObject(with: data) as? [String: Any] {
        // The queue may discover a previously ready file was removed/emptied.
        // Verify its CURRENT immutable path natively before accepting failure.
        // This read also supports API 4 captures in Documents/video-imports;
        // cleanup retains the separate App Group ownership restriction below.
        let unavailable = preparation == "ready" && incoming["sourcePreparation"] as? String == "failed" &&
          incoming["status"] as? String == "failed" && sourceMissingOrEmpty(current)
        var authority = current
        if unavailable {
          authority["sourcePreparation"] = "failed"
          authority["status"] = "failed"
        }
        let authoritativePreparation = authority["sourcePreparation"] as? String
        let stalePreparation = incoming["sourcePreparation"] as? String != authoritativePreparation
        // Native source state owns these fields, including across a stale JS
        // whole-manifest write racing the provider's completion or expiration.
        for key in ["sourcePreparation", "videoPath", "userId", "importNonce", "protocolGeneration", "createdAt"] {
          incoming[key] = authority[key]
        }
        if authoritativePreparation != "ready" || stalePreparation {
          for key in ["status", "stage", "mode", "destinationNonces"] { incoming[key] = authority[key] }
        }
        try save(incoming, id: id)
        if unavailable { cleanFiles(authority) }
      } else {
        try data.write(to: queue.appendingPathComponent(id + ".json"), options: .atomic)
      }
      return true
    } catch { return false }
  }

  func removeManifest(id: String) -> Bool {
    lock.lock(); defer { lock.unlock() }
    active.remove(id)
    removed.insert(id)
    if let manifest = read(id), manifest["sourcePreparation"] != nil { cleanFiles(manifest) }
    try? FileManager.default.removeItem(at: queue.appendingPathComponent(id + ".json"))
    return true
  }

  private func read(_ id: String) -> [String: Any]? {
    guard let data = try? Data(contentsOf: queue.appendingPathComponent(id + ".json")) else { return nil }
    return (try? JSONSerialization.jsonObject(with: data)) as? [String: Any]
  }

  private func save(_ manifest: [String: Any], id: String) throws {
    try JSONSerialization.data(withJSONObject: manifest).write(to: queue.appendingPathComponent(id + ".json"), options: .atomic)
  }

  private func sourceMissingOrEmpty(_ manifest: [String: Any]) -> Bool {
    guard let path = manifest["videoPath"] as? String, path.hasPrefix("/") else { return false }
    if !FileManager.default.fileExists(atPath: path) { return true }
    guard let attributes = try? FileManager.default.attributesOfItem(atPath: path),
          let size = attributes[.size] as? NSNumber else { return false }
    return size.int64Value == 0
  }

  private func cleanFiles(_ manifest: [String: Any]) {
    guard let id = manifest["jobId"] as? String, UUID(uuidString: id) != nil,
          let path = manifest["videoPath"] as? String else { return }
    let url = URL(fileURLWithPath: path).standardizedFileURL
    guard url.deletingLastPathComponent() == videos.standardizedFileURL,
          url.deletingPathExtension().lastPathComponent == id else { return }
    try? FileManager.default.removeItem(at: url)
    try? FileManager.default.removeItem(at: url.appendingPathExtension("partial"))
  }
}

/// A single balanced UIKit runtime grant, injectable for expiry regression tests.
final class VideoImportRuntimeLease {
  private let end: (Int) -> Void
  private var identifier: Int?
  private var finished = false
  init(end: @escaping (Int) -> Void) { self.end = end }
  func start(begin: (@escaping () -> Void) -> Int, expire: @escaping () -> Void) {
    let token = begin { [weak self] in expire(); self?.finish() }
    if finished { end(token) } else { identifier = token }
  }
  func finish() {
    guard !finished else { return }
    finished = true
    if let token = identifier { identifier = nil; end(token) }
  }
}
