import ExpoModulesCore
import AVFoundation
import Vision
import Speech

// On-device extraction of text from a video:
//   • frames sampled across the whole clip → Vision OCR (the on-screen overlay
//     text — "1. SALVO", "10. ALBERT CUYP MARKT", …)
//   • audio → SFSpeechRecognizer transcript (the voiceover naming each spot)
// All on the Neural Engine — zero network, zero per-import API cost. The caller
// ships only the resulting text to the (cheap) server extractor.

public class MediaExtractModule: Module {
  public func definition() -> ModuleDefinition {
    Name("MediaExtract")

    // uri: file:// or absolute path to the picked/shared video.
    // Returns { ocr: [String], transcript: String, durationSec: Double }.
    AsyncFunction("extractFromVideo") {
      (uri: String, maxFrames: Int?, fps: Double?, transcribe: Bool?) async throws -> [String: Any] in
      guard let url = Self.resolveURL(uri) else {
        throw Exception(name: "ERR_BAD_URI", description: "Could not resolve video uri: \(uri)")
      }
      let asset = AVURLAsset(url: url)
      let cap = max(1, maxFrames ?? 60)
      let rate = (fps ?? 1.0) > 0 ? (fps ?? 1.0) : 1.0

      let ocr = try await Self.ocrFrames(asset: asset, fps: rate, maxFrames: cap)
      var transcript = ""
      if transcribe ?? true {
        transcript = (try? await Self.transcribe(url: url)) ?? ""
      }
      let durationSec = CMTimeGetSeconds(asset.duration)

      return [
        "ocr": ocr,
        "transcript": transcript,
        "durationSec": durationSec.isFinite ? durationSec : 0,
      ]
    }
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

  private static func ocrFrames(asset: AVURLAsset, fps: Double, maxFrames: Int) async throws -> [String] {
    // Synchronous duration — AVAsset.duration works on iOS 15 (the async
    // load(.duration) API is iOS 16+; the app's deployment target is 15.1).
    let totalSec = CMTimeGetSeconds(asset.duration)
    guard totalSec.isFinite, totalSec > 0 else { return [] }

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

    let images: [CGImage] = await withCheckedContinuation { cont in
      var collected: [CGImage] = []
      var remaining = times.count
      generator.generateCGImagesAsynchronously(forTimes: times) { _, image, _, result, _ in
        if result == .succeeded, let image = image { collected.append(image) }
        remaining -= 1
        if remaining == 0 { cont.resume(returning: collected) }
      }
    }

    // Dedupe exact repeats (handles, persistent captions) while preserving order.
    var seen = Set<String>()
    var ordered: [String] = []
    for cg in images {
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

  private static func transcribe(url: URL) async throws -> String {
    let status: SFSpeechRecognizerAuthorizationStatus = await withCheckedContinuation { cont in
      SFSpeechRecognizer.requestAuthorization { cont.resume(returning: $0) }
    }
    guard status == .authorized else { return "" }
    guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: "en-US")), recognizer.isAvailable else {
      return ""
    }
    // On-device ONLY — never send audio off the phone (keeps the privacy promise
    // in NSSpeechRecognitionUsageDescription true). If the device/locale can't do
    // local STT, skip the transcript; OCR still carries the spots.
    guard recognizer.supportsOnDeviceRecognition else { return "" }
    let request = SFSpeechURLRecognitionRequest(url: url)
    request.requiresOnDeviceRecognition = true
    request.shouldReportPartialResults = false

    return await withCheckedContinuation { (cont: CheckedContinuation<String, Never>) in
      var done = false
      recognizer.recognitionTask(with: request) { result, error in
        if error != nil {
          if !done { done = true; cont.resume(returning: "") }  // best-effort: never fail the whole extract
          return
        }
        if let result = result, result.isFinal, !done {
          done = true
          cont.resume(returning: result.bestTranscription.formattedString)
        }
      }
    }
  }
}
