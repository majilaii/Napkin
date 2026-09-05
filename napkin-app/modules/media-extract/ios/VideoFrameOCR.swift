import Foundation
@preconcurrency import AVFoundation
@preconcurrency import Vision

/// Kept separate from Expo/UIKit so the real scheduler and deadline runner can
/// be compiled and exercised on macOS as well as in the iOS module.
struct VideoOCRFrame: Equatable {
  let timeSec: Double
  let lines: [String]
}

struct VideoDecodedFrame<Image> {
  let requestedTimeSec: Double
  let actualTimeSec: Double
  let image: Image
}

/// One batch owns one generator/request. Completion atomically claims and clears
/// its payload before cancellation or resumption; late callbacks cannot append,
/// resume twice, or cancel the next batch's generator.
final class VideoOCRBatchGate<Payload>: @unchecked Sendable {
  private let lock = NSLock()
  private var remaining: Int
  private var payloads: [Payload] = []
  private var completion: (([Payload]) -> Void)?
  private var watchdog: DispatchWorkItem?

  init(count: Int, completion: @escaping ([Payload]) -> Void) {
    remaining = count
    self.completion = completion
  }

  var isFinished: Bool {
    lock.lock(); defer { lock.unlock() }
    return completion == nil
  }

  func setWatchdog(_ item: DispatchWorkItem) {
    lock.lock()
    if completion == nil { lock.unlock(); item.cancel(); return }
    watchdog = item
    lock.unlock()
  }

  func accept(_ payload: Payload?) {
    lock.lock()
    guard completion != nil else { lock.unlock(); return }
    if let payload = payload { payloads.append(payload) }
    remaining -= 1
    let complete = remaining == 0
    lock.unlock()
    if complete { finish() }
  }

  @discardableResult
  func finish(cancelBeforeResume: () -> Void = {}) -> Bool {
    lock.lock()
    guard let callback = completion else { lock.unlock(); return false }
    completion = nil
    let result = payloads
    payloads = []
    let item = watchdog
    watchdog = nil
    lock.unlock()
    item?.cancel()
    cancelBeforeResume()
    callback(result)
    return true
  }
}

enum VideoFrameOCR {
  // These native fallbacks mirror importBudgets.ts; the parity regression reads
  // that committed source, so changing either language alone fails the test.
  static let defaultMaxFrames = 240
  static let defaultFPS = 2.0
  static let defaultBudgetMs = 45_000
  static let batchSize = 4
  static let tailDurationSec = 8.0

  /// Processing priority is ending -> distributed full-clip coverage -> the
  /// remaining grid. Reserve the final 0.2s explicitly, including short clips.
  /// The tail keeps 2fps even when a long clip forces a coarser overall grid.
  static func sampleTimes(durationSec: Double, fps: Double, maxFrames: Int) -> [Double] {
    guard durationSec.isFinite, durationSec > 0 else { return [] }
    let cap = min(defaultMaxFrames, max(1, maxFrames))
    let rate = fps.isFinite && fps > 0 ? fps : defaultFPS
    let last = max(0, durationSec - 0.2)
    let tailStart = max(0, durationSec - tailDurationSec)
    var tail: [Double] = []
    var t = last
    while t >= tailStart, tail.count < cap {
      tail.append(t)
      t -= 0.5
    }
    if tail.isEmpty { tail = [last] }
    guard tail.count < cap, let earliestTail = tail.last, earliestTail > 0 else { return tail }

    // Clamp before converting to Int (including very large finite durations).
    let target = max(tail.count + 1, Int(min(Double(cap), ceil(durationSec * rate))))
    let earlyCount = min(cap - tail.count, target - tail.count)
    let earlyEnd = max(0, earliestTail - 0.5)
    let early = (0..<earlyCount).map { index -> Double in
      earlyCount <= 1 ? 0 : earlyEnd * Double(index) / Double(earlyCount - 1)
    }
    var seen = Set<Int>()
    var ordered = tail
    // Twenty-four samples establish coverage before sequential fill can spend
    // the budget. They come from the same grid and consume no extra frames.
    let coverageCount = min(24, earlyCount)
    var coverage: [Int] = []
    for index in 0..<coverageCount {
      let gridIndex = coverageCount <= 1 ? 0 : Int(
        (Double(index) * Double(earlyCount - 1) / Double(coverageCount - 1)).rounded()
      )
      if seen.insert(gridIndex).inserted { coverage.append(gridIndex) }
    }
    // Endpoints and breadth-first midpoints cover the whole clip even when
    // only the first distributed batch fits after the ending pass.
    if let first = coverage.first { ordered.append(early[first]) }
    if coverage.count > 1 { ordered.append(early[coverage[coverage.count - 1]]) }
    var ranges = [(1, coverage.count - 2)]
    while !ranges.isEmpty {
      let (lower, upper) = ranges.removeFirst()
      if lower > upper { continue }
      let midpoint = (lower + upper) / 2
      ordered.append(early[coverage[midpoint]])
      ranges.append((lower, midpoint - 1))
      ranges.append((midpoint + 1, upper))
    }
    for index in early.indices where seen.insert(index).inserted {
      ordered.append(early[index])
    }
    return ordered
  }

  /// Shared with the injected regression harness. Generation receives at most
  /// half the remaining time (and at most 3s), reserving time to OCR its partial
  /// batch. Completed evidence is never discarded by a later stalled batch.
  static func run<Image>(
    times: [Double],
    budgetMs: Int,
    now: () -> TimeInterval = { ProcessInfo.processInfo.systemUptime },
    generate: ([Double], TimeInterval) async -> [VideoDecodedFrame<Image>],
    recognize: (Image, TimeInterval) async -> [String]
  ) async -> [VideoOCRFrame] {
    let deadline = now() + Double(min(defaultBudgetMs, max(0, budgetMs))) / 1000
    var frames: [VideoOCRFrame] = []
    var seenActualTimes = Set<Int64>()
    let cappedTimes = Array(times.prefix(defaultMaxFrames))
    for start in stride(from: 0, to: cappedTimes.count, by: batchSize) {
      let remaining = deadline - now()
      if remaining <= 0 { break }
      let batch = Array(cappedTimes[start..<min(start + batchSize, cappedTimes.count)])
      let generationBudget = min(3, remaining / 2)
      let decoded = await generate(batch, generationBudget)
      // Generator callback order is not an ordering contract. Restore the
      // requested priority within this small batch before spending OCR time.
      let ordered = decoded.sorted { left, right in
        (batch.firstIndex(where: { abs($0 - left.requestedTimeSec) < 1.0 / 600 }) ?? batch.count) <
          (batch.firstIndex(where: { abs($0 - right.requestedTimeSec) < 1.0 / 600 }) ?? batch.count)
      }
      for frame in ordered {
        let remainingOCR = deadline - now()
        if remainingOCR <= 0 { break }
        guard frame.actualTimeSec.isFinite, frame.actualTimeSec >= 0,
              frame.actualTimeSec < Double(Int64.max) / 600 else { continue }
        let actualKey = Int64((frame.actualTimeSec * 600).rounded())
        if !seenActualTimes.insert(actualKey).inserted { continue }
        let lines = await recognize(frame.image, remainingOCR)
        var seenLines = Set<String>()
        let cleaned = lines.compactMap { line -> String? in
          let text = line.trimmingCharacters(in: .whitespacesAndNewlines)
          return !text.isEmpty && seenLines.insert(text).inserted ? text : nil
        }
        frames.append(VideoOCRFrame(timeSec: frame.actualTimeSec, lines: cleaned))
      }
    }
    return frames.sorted { $0.timeSec < $1.timeSec }
  }

  /// The legacy field preserves its chronological first-appearance contract,
  /// independent of the reordered sampling/processing priority.
  static func legacyLines(_ frames: [VideoOCRFrame]) -> [String] {
    var seen = Set<String>()
    return frames.sorted { $0.timeSec < $1.timeSec }.flatMap(\.lines).filter {
      seen.insert($0).inserted
    }
  }

  static func extract(asset: AVURLAsset, fps: Double, maxFrames: Int, budgetMs: Int) async -> [VideoOCRFrame] {
    let duration = CMTimeGetSeconds(asset.duration)
    return await run(
      times: sampleTimes(durationSec: duration, fps: fps, maxFrames: maxFrames),
      budgetMs: budgetMs,
      generate: { times, budget in await generate(asset: asset, times: times, budgetSec: budget) },
      recognize: { image, budget in await recognize(image: image, budgetSec: budget) }
    )
  }

  private static func generate(asset: AVURLAsset, times: [Double], budgetSec: Double) async -> [VideoDecodedFrame<CGImage>] {
    guard !times.isEmpty, budgetSec > 0 else { return [] }
    let generator = AVAssetImageGenerator(asset: asset)
    generator.appliesPreferredTrackTransform = true
    // Exact requests prevent the old +/-0.4s window from skipping a brief end
    // card or collapsing neighboring samples onto the same earlier keyframe.
    generator.requestedTimeToleranceBefore = .zero
    generator.requestedTimeToleranceAfter = .zero
    generator.maximumSize = CGSize(width: 1080, height: 1080)
    return await withCheckedContinuation { continuation in
      let gate = VideoOCRBatchGate<VideoDecodedFrame<CGImage>>(count: times.count) {
        continuation.resume(returning: $0)
      }
      let watchdog = DispatchWorkItem {
        gate.finish { generator.cancelAllCGImageGeneration() }
      }
      gate.setWatchdog(watchdog)
      DispatchQueue.global().asyncAfter(deadline: .now() + budgetSec, execute: watchdog)
      if gate.isFinished { return }
      generator.generateCGImagesAsynchronously(forTimes: times.map {
        NSValue(time: CMTime(seconds: $0, preferredTimescale: 600))
      }) { requested, image, actual, result, _ in
        let payload: VideoDecodedFrame<CGImage>?
        if result == .succeeded, let image = image {
          payload = VideoDecodedFrame(
            requestedTimeSec: CMTimeGetSeconds(requested),
            actualTimeSec: CMTimeGetSeconds(actual), image: image
          )
        } else { payload = nil }
        gate.accept(payload)
      }
      // If the watchdog won between the pre-start guard and generator start,
      // cancel again: cancellation before start cannot cancel future work.
      if gate.isFinished { generator.cancelAllCGImageGeneration() }
    }
  }

  private static func recognize(image: CGImage, budgetSec: Double) async -> [String] {
    guard budgetSec > 0 else { return [] }
    let request = VNRecognizeTextRequest()
    request.recognitionLevel = .accurate
    request.usesLanguageCorrection = true
    return await withCheckedContinuation { continuation in
      let gate = VideoOCRBatchGate<[String]>(count: 1) {
        continuation.resume(returning: $0.flatMap { $0 })
      }
      let watchdog = DispatchWorkItem { gate.finish { request.cancel() } }
      gate.setWatchdog(watchdog)
      DispatchQueue.global().asyncAfter(deadline: .now() + budgetSec, execute: watchdog)
      DispatchQueue.global(qos: .userInitiated).async {
        if gate.isFinished { return }
        let handler = VNImageRequestHandler(cgImage: image, options: [:])
        try? handler.perform([request])
        gate.accept((request.results ?? []).compactMap { $0.topCandidates(1).first?.string })
      }
    }
  }
}
