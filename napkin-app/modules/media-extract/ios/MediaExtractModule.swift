import ExpoModulesCore
import AVFoundation
import Vision
import Speech
import UIKit

// On-device extraction of text from a video:
//   • frames sampled across the whole clip → Vision OCR (the on-screen overlay
//     text — "1. SALVO", "10. ALBERT CUYP MARKT", …)
//   • audio → SFSpeechRecognizer transcript (the voiceover naming each spot)
// All on the Neural Engine — zero network, zero per-import API cost. The caller
// ships only the resulting text to the (cheap) server extractor.

public class MediaExtractModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MediaExtract")

    // TICKET-164 [R4]: capability constant. Bumped to 2 when extractFromVideo grew
    // the OCR/STT budget params — the JS wrapper calls the 7-arg signature only
    // when it sees this, else the legacy 4-arg call (OTA JS on a pre-164 binary
    // must never throw an ExpoModulesCore arg-count mismatch).
    // TICKET-176: bumped to 3 when extractFromImages was ADDED — the JS wrapper
    // calls it only on a >= 3 binary, else returns null so photo-slide OCR falls
    // back to the {url} resolve (a v2 binary lacks the function entirely).
    Constants([
      "apiVersion": 3
    ])

    // uri: file:// or absolute path to the picked/shared video.
    // Returns { ocr: [String], transcript: String, durationSec: Double }.
    // TICKET-164: the trailing three params are the wall-clock budgets (nil → the
    // Self.default* fallbacks that mirror lib/importBudgets.ts). No stage can hang.
    AsyncFunction("extractFromVideo") {
      (uri: String, maxFrames: Int?, fps: Double?, transcribe: Bool?,
       ocrBudgetMs: Int?, sttTimeoutMs: Int?, sttMaxDurationSec: Int?) async throws -> [String: Any] in
      guard let url = Self.resolveURL(uri) else {
        throw Exception(name: "ERR_BAD_URI", description: "Could not resolve video uri: \(uri)")
      }
      let asset = AVURLAsset(url: url)
      let cap = max(1, maxFrames ?? 60)
      let rate = (fps ?? 1.0) > 0 ? (fps ?? 1.0) : 1.0
      let durationSec = CMTimeGetSeconds(asset.duration)

      // OCR under a wall-clock budget spanning frame GENERATION + the Vision pass.
      let ocrBudget = max(1000, ocrBudgetMs ?? Self.defaultOcrBudgetMs)
      let ocr = try await Self.ocrFrames(asset: asset, fps: rate, maxFrames: cap, budgetMs: ocrBudget)

      // STT: skipped entirely above the duration ceiling (its real-time tail
      // dominates wall clock; OCR still carries the spots), else bounded by a hard
      // timeout that cancels the task and resumes with the latest partial.
      var transcript = ""
      let sttMaxDur = Double(sttMaxDurationSec ?? Self.defaultSttMaxDurationSec)
      if (transcribe ?? true), durationSec.isFinite, durationSec <= sttMaxDur {
        let sttTimeout = max(1000, sttTimeoutMs ?? Self.defaultSttTimeoutMs)
        transcript = (try? await Self.transcribe(url: url, timeoutMs: sttTimeout)) ?? ""
      }

      return [
        "ocr": ocr,
        "transcript": transcript,
        "durationSec": durationSec.isFinite ? durationSec : 0,
      ]
    }

    // TICKET-176: OCR a set of photo-mode slide images entirely on-device — the
    // SAME Vision pass as extractFromVideo's frame OCR (.accurate + language
    // correction + cross-image dedupe), fed by UIImage(contentsOfFile:) instead
    // of AVAsset frames. A photo-mode TikTok list renders its spots ON the slides
    // and its caption is name-free, so this is the only channel. Returns
    // { ocr: [String] }.
    //
    // Deliberately a fully synchronous loop inside the async function: there is
    // nothing async to bound (Vision's perform is synchronous per image), so NO
    // continuation / generator / watchdog machinery is needed (unlike ocrFrames,
    // which bounds AVAssetImageGenerator). A single wall-clock deadline is checked
    // BETWEEN images and the lines gathered so far are returned on expiry —
    // partial OCR still carries most spots.
    AsyncFunction("extractFromImages") {
      (uris: [String], ocrBudgetMs: Int?) async throws -> [String: Any] in
      let budget = max(1000, ocrBudgetMs ?? Self.defaultOcrBudgetMs)
      let deadline = Date().addingTimeInterval(Double(budget) / 1000.0)
      // Cross-image dedupe (persistent handles/watermarks repeat across slides),
      // preserving first-seen order — same Set pattern as ocrFrames.
      var seen = Set<String>()
      var ordered: [String] = []
      for uri in uris {
        if Date() >= deadline { break } // partial results on expiry
        guard let url = Self.resolveURL(uri),
              let image = UIImage(contentsOfFile: url.path),
              let cg = image.cgImage else { continue }
        let req = VNRecognizeTextRequest()
        req.recognitionLevel = .accurate
        req.usesLanguageCorrection = true
        let handler = VNImageRequestHandler(cgImage: cg, options: [:])
        try? handler.perform([req])
        for obs in (req.results ?? []) {
          guard let s = obs.topCandidates(1).first?.string else { continue }
          let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
          if !trimmed.isEmpty, !seen.contains(trimmed) {
            seen.insert(trimmed)
            ordered.append(trimmed)
          }
        }
      }
      return ["ocr": ordered]
    }

    // ── App-Group import queue (TICKET-083 Part B inc3) ──────────────────────
    // The share extension writes pending-import manifests into the shared App
    // Group container (it CANNOT call JS); the main app reads/updates/removes
    // them here. expo-file-system can't reach the App-Group path, so these native
    // file ops are the only way the JS queue can touch it. All synchronous + fast.

    // All manifest JSON strings currently in the queue dir.
    Function("listImportManifests") { () -> [String] in
      guard let dir = Self.queueDir() else { return [] }
      let files = (try? FileManager.default.contentsOfDirectory(
        at: dir, includingPropertiesForKeys: nil)) ?? []
      var out: [String] = []
      for f in files where f.pathExtension == "json" {
        if let data = try? Data(contentsOf: f),
           let s = String(data: data, encoding: .utf8) {
          out.append(s)
        }
      }
      return out
    }

    // Write/overwrite a manifest atomically. Data's atomic option writes a
    // sibling temporary file and replaces the destination without deleting the
    // last good manifest first.
    Function("writeImportManifest") { (jobId: String, json: String) -> Bool in
      guard let dir = Self.queueDir(), let data = json.data(using: .utf8) else { return false }
      let final = dir.appendingPathComponent(jobId + ".json")
      do {
        try data.write(to: final, options: .atomic)
        return true
      } catch {
        return false
      }
    }

    Function("removeImportManifest") { (jobId: String) -> Bool in
      guard let dir = Self.queueDir() else { return false }
      try? FileManager.default.removeItem(at: dir.appendingPathComponent(jobId + ".json"))
      return true
    }

    // { exists: Bool, size: Int } for an absolute App-Group file path.
    Function("appGroupFileInfo") { (path: String) -> [String: Any] in
      let exists = FileManager.default.fileExists(atPath: path)
      let attrs = try? FileManager.default.attributesOfItem(atPath: path)
      let size = (attrs?[.size] as? NSNumber)?.intValue ?? 0
      return ["exists": exists, "size": size]
    }

    Function("deleteAppGroupFile") { (path: String) -> Bool in
      try? FileManager.default.removeItem(atPath: path)
      return true
    }

    // ── App-Group shared scalar prefs (TICKET-113 Part B) ──────────────────────
    // The share EXTENSION can't read AsyncStorage; the app mirrors small prefs
    // (e.g. the import default mode, key "import.defaultMode") into the app group's
    // UserDefaults here so the extension can seed its UI at launch. Same suite the
    // queue uses — no new entitlement.
    Function("setSharedDefault") { (key: String, value: String) -> Bool in
      guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return false }
      defaults.set(value, forKey: key)
      return true
    }

    Function("getSharedDefault") { (key: String) -> String? in
      guard let defaults = UserDefaults(suiteName: Self.appGroup) else { return nil }
      return defaults.string(forKey: key)
    }

    // The main app publishes a snapshot of the user's collections (lists + tables)
    // so the share EXTENSION can render the destination picker (it can't read the
    // app's cache). Written atomically; the extension reads it directly.
    Function("writeAppGroupSnapshot") { (json: String) -> Bool in
      guard
        let container = FileManager.default
          .containerURL(forSecurityApplicationGroupIdentifier: Self.appGroup),
        let data = json.data(using: .utf8)
      else { return false }
      let url = container.appendingPathComponent("collections-snapshot.json")
      do {
        try data.write(to: url, options: .atomic)
        return true
      } catch {
        return false
      }
    }

    // ── Background-runtime grant (TICKET-120) ─────────────────────────────────
    // iOS suspends JS a few seconds after backgrounding. The import drain asks for
    // ~30s more here so a job that finished while suspended can post its completion
    // notification. Returns the task's raw id (the JS wrapper is guarded — an absent
    // module degrades to no-op). The expiration handler MUST end the task itself or
    // iOS kills the app.
    Function("beginBackgroundTask") { () -> Int in
      var taskId: UIBackgroundTaskIdentifier = .invalid
      taskId = UIApplication.shared.beginBackgroundTask(withName: "napkin.import-drain") {
        // iOS is reclaiming the time — end the task so the app isn't killed.
        UIApplication.shared.endBackgroundTask(taskId)
        taskId = .invalid
      }
      return taskId.rawValue
    }

    // Release a grant. No-op-safe on an invalid/already-ended id.
    Function("endBackgroundTask") { (taskId: Int) -> Bool in
      let identifier = UIBackgroundTaskIdentifier(rawValue: taskId)
      guard identifier != .invalid else { return false }
      UIApplication.shared.endBackgroundTask(identifier)
      return true
    }
  }

  // MARK: - Stage-budget fallbacks (TICKET-164)

  // Used ONLY when a budget param arrives nil — the JS caller threads the
  // canonical values from lib/importBudgets.ts, which are authoritative. Kept in
  // sync with that file by hand (no shared source across the language boundary).
  private static let defaultOcrBudgetMs = 45_000
  private static let defaultSttTimeoutMs = 90_000
  private static let defaultSttMaxDurationSec = 300

  // MARK: - App Group queue dir

  private static let appGroup = "group.com.majilaii.napkin.shared"

  private static func queueDir() -> URL? {
    guard let container = FileManager.default
      .containerURL(forSecurityApplicationGroupIdentifier: appGroup) else { return nil }
    let dir = container.appendingPathComponent("import-queue", isDirectory: true)
    try? FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
    return dir
  }

  // MARK: - URL resolution

  private static func resolveURL(_ uri: String) -> URL? {
    if uri.hasPrefix("file://") || uri.hasPrefix("http://") || uri.hasPrefix("https://") {
      return URL(string: uri)
    }
    if uri.hasPrefix("/") {
      return URL(fileURLWithPath: uri)
    }
    return URL(string: uri)
  }

  // MARK: - Frame OCR

  private static func ocrFrames(asset: AVURLAsset, fps: Double, maxFrames: Int, budgetMs: Int) async throws -> [String] {
    // Synchronous duration — AVAsset.duration works on iOS 15 (the async
    // load(.duration) API is iOS 16+; the app's deployment target is 15.1).
    let totalSec = CMTimeGetSeconds(asset.duration)
    guard totalSec.isFinite, totalSec > 0 else { return [] }

    // TICKET-164 [R8]: ONE wall-clock deadline for the WHOLE stage — frame
    // generation AND the Vision loop below. A long clip on a busy Neural Engine
    // could otherwise stall either phase and hang the import; on expiry we cancel
    // in-flight generation and return whatever lines we have (partial OCR still
    // carries most spots).
    let deadline = Date().addingTimeInterval(Double(budgetMs) / 1000.0)

    // Spread up to `maxFrames` samples EVENLY across the whole clip so a spot in
    // the last 10s is captured just like one in the first 10s (a fixed 1fps would
    // otherwise blow past the cap and only cover the opening seconds).
    let stepByRate = 1.0 / fps
    let stepEven = totalSec / Double(maxFrames)
    let step = max(stepByRate, stepEven)

    var times: [NSValue] = []
    var t = 0.0
    while t < totalSec, times.count < maxFrames {
      times.append(NSValue(time: CMTime(seconds: t, preferredTimescale: 600)))
      t += step
    }
    if times.isEmpty { times.append(NSValue(time: .zero)) }

    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    generator.requestedTimeToleranceBefore = CMTime(seconds: 0.4, preferredTimescale: 600)
    generator.requestedTimeToleranceAfter = CMTime(seconds: 0.4, preferredTimescale: 600)
    // Cap decode size — Vision is plenty accurate at ~1080px and it keeps OCR fast.
    generator.maximumSize = CGSize(width: 1080, height: 1080)

    // Frame generation under the deadline. `collected`/`remaining` are touched by
    // the generator callback thread AND the watchdog thread, so an NSLock guards
    // every access; the continuation resumes EXACTLY once (a double-resume on a
    // CheckedContinuation is a hard crash) via the `resumed` check-and-set.
    let images: [CGImage] = await withCheckedContinuation { (cont: CheckedContinuation<[CGImage], Never>) in
      let lock = NSLock()
      var resumed = false
      var collected: [CGImage] = []
      var remaining = times.count

      func finish(_ result: [CGImage]) {
        lock.lock()
        if resumed { lock.unlock(); return }
        resumed = true
        lock.unlock()
        cont.resume(returning: result)
      }

      // [review-1 Codex-6] Deadline already spent (e.g. the app was suspended
      // between computing it and reaching here) → never START generation; an
      // unstarted generator has nothing to cancel and no watchdog would bound it.
      let remainingSec = deadline.timeIntervalSinceNow
      if remainingSec <= 0 {
        finish([])
        return
      }

      // Watchdog: at the deadline, cancel in-flight generation + resume the
      // partial. A DispatchWorkItem so normal completion CANCELS it — otherwise
      // the closure retains every decoded frame until the deadline fires
      // (review-1 NIT-1: up to 240 CGImages held ~42s after a fast pass).
      let watchdog = DispatchWorkItem {
        lock.lock(); let already = resumed; let snapshot = collected; lock.unlock()
        if already { return }
        generator.cancelAllCGImageGeneration()
        finish(snapshot)
      }
      DispatchQueue.global().asyncAfter(deadline: .now() + remainingSec, execute: watchdog)

      generator.generateCGImagesAsynchronously(forTimes: times) { _, image, _, result, _ in
        lock.lock()
        if result == .succeeded, let image = image { collected.append(image) }
        remaining -= 1
        let done = remaining == 0
        let snapshot = collected
        lock.unlock()
        // A cancelled generation still fires per remaining time with .cancelled,
        // so `remaining` reaches 0 either way; `finish` is idempotent.
        if done {
          watchdog.cancel()
          finish(snapshot)
          // [review-2 Codex-2] cancel() prevents EXECUTION but the queue still
          // retains the cancelled closure — and its captured vars — until the
          // deadline passes. Rebind `collected` so that capture stops pinning
          // up to 240 decoded frames for the rest of the budget (`snapshot`
          // carries them forward to the Vision loop, which is their real user).
          lock.lock(); collected = []; lock.unlock()
        }
      }
    }

    // Dedupe exact repeats (handles, persistent captions) while preserving order.
    // Also bounded by the SAME deadline — a 240-frame .accurate pass can itself
    // outrun the budget; stop early and return the partial lines.
    var seen = Set<String>()
    var ordered: [String] = []
    for cg in images {
      if Date() >= deadline { break }
      let req = VNRecognizeTextRequest()
      req.recognitionLevel = .accurate
      req.usesLanguageCorrection = true
      let handler = VNImageRequestHandler(cgImage: cg, options: [:])
      try? handler.perform([req])
      for obs in (req.results ?? []) {
        guard let s = obs.topCandidates(1).first?.string else { continue }
        let trimmed = s.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmed.isEmpty, !seen.contains(trimmed) {
          seen.insert(trimmed)
          ordered.append(trimmed)
        }
      }
    }
    return ordered
  }

  // MARK: - Voiceover transcription (on-device when supported)

  // Prefer the device's own locale (a London user gets en-GB's far better read
  // on London names/accents than hardcoded en-US), falling back through en-GB
  // then en-US. On-device support is per-locale, so probe each.
  private static func pickRecognizer() -> SFSpeechRecognizer? {
    var locales: [Locale] = [Locale.current]
    locales.append(Locale(identifier: "en-GB"))
    locales.append(Locale(identifier: "en-US"))
    for locale in locales {
      if let r = SFSpeechRecognizer(locale: locale), r.isAvailable, r.supportsOnDeviceRecognition {
        return r
      }
    }
    return nil
  }

  private static func transcribe(url: URL, timeoutMs: Int) async throws -> String {
    // [review-1 Codex-1] ONE deadline covers the WHOLE stage, INCLUDING the
    // authorization wait — an unanswered permission prompt (first-ever import,
    // or backgrounded mid-prompt) previously sat OUTSIDE any timeout and hung
    // the import indefinitely. The auth continuation is exactly-once guarded;
    // an unanswered prompt at the deadline reads as not-authorized → skip STT
    // (OCR still carries the spots). If the user later answers, the late
    // callback hits the guard and is dropped.
    let deadlineAt = Date().addingTimeInterval(Double(timeoutMs) / 1000.0)
    let status: SFSpeechRecognizerAuthorizationStatus = await withCheckedContinuation {
      (cont: CheckedContinuation<SFSpeechRecognizerAuthorizationStatus, Never>) in
      let authLock = NSLock()
      var authResumed = false
      func finishAuth(_ s: SFSpeechRecognizerAuthorizationStatus) {
        authLock.lock()
        if authResumed { authLock.unlock(); return }
        authResumed = true
        authLock.unlock()
        cont.resume(returning: s)
      }
      DispatchQueue.global().asyncAfter(deadline: .now() + Double(timeoutMs) / 1000.0) {
        finishAuth(.notDetermined)
      }
      SFSpeechRecognizer.requestAuthorization { finishAuth($0) }
    }
    guard status == .authorized else { return "" }
    // Whatever the auth wait consumed comes out of the recognition budget.
    let recognitionBudgetSec = deadlineAt.timeIntervalSinceNow
    guard recognitionBudgetSec > 0 else { return "" }
    // On-device ONLY — never send audio off the phone (keeps the privacy promise
    // in NSSpeechRecognitionUsageDescription true). If no locale can do local
    // STT, skip the transcript; OCR still carries the spots.
    guard let recognizer = Self.pickRecognizer() else { return "" }
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.requiresOnDeviceRecognition = true
    // TICKET-164 [R8]: retain partials so a hard-timeout resumes with the latest
    // text (previously the recognizer only resumed on isFinal — a stalled/never-
    // final task hung the whole import forever).
    request.shouldReportPartialResults = true
    if #available(iOS 16.0, *) {
      request.addsPunctuation = true
    }

    return await withCheckedContinuation { (cont: CheckedContinuation<String, Never>) in
      // `done` is touched by the recognizer callback thread AND the timeout thread.
      // The NSLock wraps BOTH the check-and-set AND the decision to resume, so the
      // continuation resumes EXACTLY once — a double-resume is a fatalError.
      let lock = NSLock()
      var done = false
      var latest = ""
      var task: SFSpeechRecognitionTask?

      func finish(_ text: String) {
        lock.lock()
        if done { lock.unlock(); return }
        done = true
        lock.unlock()
        cont.resume(returning: text)
      }

      // Hard timeout at the REMAINING stage budget (the auth wait already
      // consumed its share): cancel the task, resume with the latest partial.
      // [review-1 NIT-2] `task` is read under the same lock it is assigned
      // under — the optional-chain on a torn read was benign, but free to fix.
      DispatchQueue.global().asyncAfter(deadline: .now() + recognitionBudgetSec) {
        // [review-3 Codex-2] CLAIM completion inside the snapshot's critical
        // section. Snapshot-unlock-then-finish left a window where the task
        // assignment below read done == false while this timeout was already
        // committed to resuming — neither side cancelled the task (zombie
        // reading a file the queue then deletes). Claiming `done` here means
        // the assignment ALWAYS observes it and cancels the late-created task.
        lock.lock()
        if done { lock.unlock(); return }
        done = true
        let partial = latest
        let t = task
        lock.unlock()
        t?.cancel()
        cont.resume(returning: partial)
      }

      let started = recognizer.recognitionTask(with: request) { result, error in
        if let result = result {
          lock.lock(); latest = result.bestTranscription.formattedString; lock.unlock()
          if result.isFinal { finish(result.bestTranscription.formattedString) }
        }
        if error != nil {
          // Best-effort: never fail the whole extract — resume with the latest
          // partial (idempotent if a final/timeout already resumed).
          lock.lock(); let partial = latest; lock.unlock()
          finish(partial)
        }
      }
      lock.lock()
      task = started
      let timedOutBeforeAssignment = done
      lock.unlock()
      // [review-2 Codex-3] the timeout is scheduled BEFORE the task exists; when
      // the auth wait ate nearly the whole budget it can fire in that window,
      // see task == nil, and resume — leaving the task created HERE as a zombie
      // that outlives the stage and reads a file the queue then deletes. The
      // continuation already resumed (exactly-once holds); just kill the task.
      if timedOutBeforeAssignment { started.cancel() }
    }
  }
}
