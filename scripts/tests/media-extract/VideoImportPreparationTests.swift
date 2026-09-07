import Foundation

private struct TestFailure: Error { let message: String }
private func expect(_ value: @autoclosure () throws -> Bool, _ message: String) throws {
  if try !value() { throw TestFailure(message: message) }
}
private func manifest(_ store: VideoImportPreparationStore) throws -> [String: Any] {
  guard let raw = store.listManifests().first,
        let row = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? [String: Any] else {
    throw TestFailure(message: "expected durable manifest")
  }
  return row
}
private func json(_ row: [String: Any]) throws -> String {
  String(data: try JSONSerialization.data(withJSONObject: row), encoding: .utf8)!
}

@main
struct VideoImportPreparationTests {
  static func main() throws {
    let root = FileManager.default.temporaryDirectory.appendingPathComponent("napkin-capture-tests-" + UUID().uuidString)
    defer { try? FileManager.default.removeItem(at: root) }
    let owner = UUID().uuidString
    var passed = 0
    func test(_ name: String, _ run: (URL) throws -> Void) throws {
      let directory = root.appendingPathComponent(String(passed))
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      try run(directory)
      passed += 1
      print("PASS \(name)")
    }
    func source(_ directory: URL) throws -> URL {
      let file = directory.appendingPathComponent("provider.mp4")
      try Data("local video fixture".utf8).write(to: file)
      return file
    }

    try test("selection persists owned review manifest and stable nonces before source exists") { directory in
      let store = VideoImportPreparationStore(root: directory)
      let job = try store.prepare(userId: owner, fileExtension: "mp4")
      let row = try manifest(store)
      try expect(row["videoPath"] as? String == job.video.path, "reserved file path")
      try expect(row["userId"] as? String == owner, "fixed owner")
      try expect(row["mode"] as? String == "review", "review only")
      try expect(row["protocolGeneration"] as? String == "v2", "v2 fixed at selection")
      try expect(row["sourcePreparation"] as? String == "pending", "preparing before source")
      try expect(row["stage"] as? String == "downloading video", "honest source stage")
      try expect(!FileManager.default.fileExists(atPath: job.video.path), "no false-ready file")
      let second = try manifest(store)
      try expect(row["importNonce"] as? String == second["importNonce"] as? String, "stable import nonce")
      try expect((row["destinationNonces"] as? [String: Any])?["wishlist"] as? String == (second["destinationNonces"] as? [String: Any])?["wishlist"] as? String, "stable destination nonce")
    }

    try test("polling leaves active downloads pending; completion merges current manifest") { directory in
      let store = VideoImportPreparationStore(root: directory)
      let job = try store.prepare(userId: owner, fileExtension: "mov")
      var row = try manifest(store)
      row["notificationOutcome"] = "seen"
      try expect(store.writeManifest(id: job.id, json: try json(row)), "persist concurrent metadata")
      for _ in 0..<3 { try expect(try manifest(store)["sourcePreparation"] as? String == "pending", "active is not orphaned") }
      try expect(try store.receive(source(directory), for: job), "copy commits")
      let ready = try manifest(store)
      try expect(ready["sourcePreparation"] as? String == "ready", "ready after file commit")
      try expect(ready["stage"] as? String == "reading the video", "OCR stage after copy")
      try expect(ready["notificationOutcome"] as? String == "seen", "fresh metadata preserved")
      try expect(FileManager.default.fileExists(atPath: job.video.path), "complete file exists")
      try expect(!FileManager.default.fileExists(atPath: job.partial.path), "no partial residue")
    }

    try test("expiration persists failure and fences late provider completion") { directory in
      let store = VideoImportPreparationStore(root: directory)
      let job = try store.prepare(userId: owner, fileExtension: "mp4")
      try store.fail(job)
      try expect(try store.receive(source(directory), for: job) == false, "late callback refused")
      let row = try manifest(store)
      try expect(row["status"] as? String == "failed", "failure durable")
      try expect(row["sourcePreparation"] as? String == "failed", "source failure durable")
      try expect(!FileManager.default.fileExists(atPath: job.video.path), "no resurrected output")
    }

    try test("empty source fails without a published movie") { directory in
      let store = VideoImportPreparationStore(root: directory)
      let job = try store.prepare(userId: owner, fileExtension: "mp4")
      let empty = directory.appendingPathComponent("empty.mp4")
      try Data().write(to: empty)
      do { _ = try store.receive(empty, for: job); throw TestFailure(message: "empty source accepted") }
      catch VideoImportPreparationStore.Failure.emptyVideo { try store.fail(job) }
      try expect(try manifest(store)["status"] as? String == "failed", "empty-source failure")
      try expect(!FileManager.default.fileExists(atPath: job.partial.path), "partial removed")
    }

    try test("cold relaunch fails abandoned preparation even if a complete-looking file exists") { directory in
      let old = VideoImportPreparationStore(root: directory)
      let job = try old.prepare(userId: owner, fileExtension: "mp4")
      try Data("incomplete".utf8).write(to: job.video)
      try Data("partial".utf8).write(to: job.partial)
      let unrelated = try source(directory)
      let restored = VideoImportPreparationStore(root: directory)
      let row = try manifest(restored)
      try expect(row["status"] as? String == "failed", "abandoned status failed")
      try expect(row["sourcePreparation"] as? String == "failed", "never infer ready from file")
      try expect(!FileManager.default.fileExists(atPath: job.video.path), "own orphan removed")
      try expect(!FileManager.default.fileExists(atPath: job.partial.path), "own partial removed")
      try expect(FileManager.default.fileExists(atPath: unrelated.path), "provider/other files untouched")
    }

    try test("cold relaunch preserves committed ready source") { directory in
      let old = VideoImportPreparationStore(root: directory)
      let job = try old.prepare(userId: owner, fileExtension: "mp4")
      _ = try old.receive(source(directory), for: job)
      let restored = VideoImportPreparationStore(root: directory)
      try expect(try manifest(restored)["sourcePreparation"] as? String == "ready", "committed source stays ready")
      try expect(FileManager.default.fileExists(atPath: job.video.path), "ready movie retained")
    }

    try test("stale JS snapshot cannot undo readiness or change source owner/path") { directory in
      let store = VideoImportPreparationStore(root: directory)
      let job = try store.prepare(userId: owner, fileExtension: "mov")
      var stale = try manifest(store)
      let originalNonce = stale["importNonce"] as? String
      _ = try store.receive(source(directory), for: job)
      stale["userId"] = UUID().uuidString
      stale["videoPath"] = "/tmp/other-video.mov"
      stale["importNonce"] = UUID().uuidString
      try expect(store.writeManifest(id: job.id, json: try json(stale)), "JS metadata update accepted")
      let ready = try manifest(store)
      try expect(ready["sourcePreparation"] as? String == "ready", "stale pending cannot replace ready")
      try expect(ready["stage"] as? String == "reading the video", "stale downloading cannot replace stage")
      try expect(ready["userId"] as? String == owner, "owner immutable")
      try expect(ready["videoPath"] as? String == job.video.path, "path immutable")
      try expect(ready["importNonce"] as? String == originalNonce, "nonce immutable")
    }

    try test("stale snapshots cannot undo failure or recreate a discarded capture") { directory in
      let store = VideoImportPreparationStore(root: directory)
      let job = try store.prepare(userId: owner, fileExtension: "mp4")
      let stale = try json(manifest(store))
      try store.fail(job)
      try expect(store.writeManifest(id: job.id, json: stale), "stale metadata fenced")
      try expect(try manifest(store)["status"] as? String == "failed", "failure not reset")
      _ = store.removeManifest(id: job.id)
      try expect(!store.writeManifest(id: job.id, json: stale), "discard tombstone fences JS")
      try expect(try store.receive(source(directory), for: job) == false, "discard fences provider")
      try expect(store.listManifests().isEmpty, "no recreated JSON")
    }

    try test("queue can fail a ready source only after native missing/empty validation") { directory in
      for state in ["intact", "missing", "empty"] {
        let store = VideoImportPreparationStore(root: directory.appendingPathComponent(state))
        let job = try store.prepare(userId: owner, fileExtension: "mp4")
        _ = try store.receive(source(directory), for: job)
        var failure = try manifest(store)
        if state == "missing" { try FileManager.default.removeItem(at: job.video) }
        if state == "empty" { try Data().write(to: job.video) }
        failure["sourcePreparation"] = "failed"
        failure["status"] = "failed"
        try expect(store.writeManifest(id: job.id, json: try json(failure)), "queue failure write")
        let stored = try manifest(store)
        try expect(stored["sourcePreparation"] as? String == (state == "intact" ? "ready" : "failed"), "validated source state")
        try expect(stored["status"] as? String == (state == "intact" ? "pending" : "failed"), "validated status")
      }
    }

    try test("upgraded API 4 Documents capture can fail when its persisted source disappears") { directory in
      let store = VideoImportPreparationStore(root: directory)
      let job = try store.prepare(userId: owner, fileExtension: "mp4")
      _ = try store.receive(source(directory), for: job)
      var legacy = try manifest(store)
      let documentsFile = directory.appendingPathComponent("Documents/video-imports/" + UUID().uuidString + ".mov")
      legacy["videoPath"] = documentsFile.path
      // Seed a pre-upgrade manifest directly, as the older app persisted it.
      try Data(json(legacy).utf8).write(to: directory.appendingPathComponent("import-queue/" + job.id + ".json"), options: .atomic)
      let restored = VideoImportPreparationStore(root: directory)
      var failed = try manifest(restored)
      failed["sourcePreparation"] = "failed"
      failed["status"] = "failed"
      try expect(restored.writeManifest(id: job.id, json: try json(failed)), "legacy ready failure persisted")
      try expect(try manifest(restored)["sourcePreparation"] as? String == "failed", "legacy source requires reselection")
      try expect(try manifest(restored)["videoPath"] as? String == documentsFile.path, "legacy path preserved")
    }

    try test("expiration while provider copy is delayed does not block or resurrect output") { directory in
      let copyEntered = DispatchSemaphore(value: 0)
      let resumeCopy = DispatchSemaphore(value: 0)
      let done = DispatchSemaphore(value: 0)
      let store = VideoImportPreparationStore(root: directory) { input, output in
        copyEntered.signal()
        _ = resumeCopy.wait(timeout: .now() + 5)
        try FileManager.default.copyItem(at: input, to: output)
      }
      let job = try store.prepare(userId: owner, fileExtension: "mp4")
      let input = try source(directory)
      DispatchQueue.global().async { _ = try? store.receive(input, for: job); done.signal() }
      try expect(copyEntered.wait(timeout: .now() + 2) == .success, "copy starts")
      try store.fail(job)
      try expect(try manifest(store)["status"] as? String == "failed", "expiry does not wait on copy")
      resumeCopy.signal()
      try expect(done.wait(timeout: .now() + 2) == .success, "late callback finishes")
      try expect(!FileManager.default.fileExists(atPath: job.video.path), "no late publication")
      try expect(!FileManager.default.fileExists(atPath: job.partial.path), "late partial cleaned")
    }

    try test("runtime grant ends once on completion, expiration and synchronous denial") { _ in
      for expireImmediately in [false, true] {
        var ends: [Int] = []
        var expirations = 0
        var expire: (() -> Void)?
        let lease = VideoImportRuntimeLease { ends.append($0) }
        lease.start(begin: { handler in expire = handler; if expireImmediately { handler() }; return 7 },
                    expire: { expirations += 1 })
        if !expireImmediately { lease.finish(); expire?() }
        lease.finish()
        try expect(ends == [7], "balanced grant")
        try expect(expirations == 1, "single expiration callback")
      }
    }
    print("Video import preparation: \(passed) passed")
  }
}
