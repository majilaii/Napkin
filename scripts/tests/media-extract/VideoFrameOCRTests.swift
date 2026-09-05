import Foundation
import AVFoundation
import CoreText

struct RegressionFailure: Error, CustomStringConvertible {
  let description: String
}

func expect(_ value: @autoclosure () -> Bool, _ message: String) throws {
  if !value() { throw RegressionFailure(description: message) }
}

/// Generates local pixels, with a venue card ONLY in the last 0.3s. No network,
/// production data, microphone authorization, or simulator is involved.
func makeEndCardVideo(at url: URL) async throws {
  let writer = try AVAssetWriter(outputURL: url, fileType: .mp4)
  let width = 960
  let height = 540
  let input = AVAssetWriterInput(mediaType: .video, outputSettings: [
    AVVideoCodecKey: AVVideoCodecType.h264,
    AVVideoWidthKey: width, AVVideoHeightKey: height,
  ])
  let adaptor = AVAssetWriterInputPixelBufferAdaptor(assetWriterInput: input, sourcePixelBufferAttributes: [
    kCVPixelBufferPixelFormatTypeKey as String: kCVPixelFormatType_32ARGB,
    kCVPixelBufferWidthKey as String: width,
    kCVPixelBufferHeightKey as String: height,
    kCVPixelBufferCGImageCompatibilityKey as String: true,
    kCVPixelBufferCGBitmapContextCompatibilityKey as String: true,
  ])
  writer.add(input)
  try expect(writer.startWriting(), "fixture writer starts: \(String(describing: writer.error))")
  writer.startSession(atSourceTime: .zero)
  for frameIndex in 0..<20 {
    let readyDeadline = ProcessInfo.processInfo.systemUptime + 5
    while !input.isReadyForMoreMediaData {
      try expect(ProcessInfo.processInfo.systemUptime < readyDeadline, "fixture writer readiness bounded")
      try await Task.sleep(nanoseconds: 1_000_000)
    }
    var buffer: CVPixelBuffer?
    let status = CVPixelBufferPoolCreatePixelBuffer(nil, adaptor.pixelBufferPool!, &buffer)
    try expect(status == kCVReturnSuccess && buffer != nil, "fixture allocates frame")
    let pixel = buffer!
    CVPixelBufferLockBaseAddress(pixel, [])
    let context = CGContext(
      data: CVPixelBufferGetBaseAddress(pixel), width: width, height: height,
      bitsPerComponent: 8, bytesPerRow: CVPixelBufferGetBytesPerRow(pixel),
      space: CGColorSpaceCreateDeviceRGB(), bitmapInfo: CGImageAlphaInfo.noneSkipFirst.rawValue
    )!
    context.setFillColor(CGColor(gray: 0.95, alpha: 1))
    context.fill(CGRect(x: 0, y: 0, width: width, height: height))
    if frameIndex >= 17 {
      let attributes: [NSAttributedString.Key: Any] = [
        NSAttributedString.Key(kCTFontAttributeName as String): CTFontCreateWithName("Helvetica-Bold" as CFString, 112, nil),
        NSAttributedString.Key(kCTForegroundColorAttributeName as String): CGColor(gray: 0.05, alpha: 1),
      ]
      let line = CTLineCreateWithAttributedString(NSAttributedString(string: "LOTTA", attributes: attributes))
      context.textPosition = CGPoint(x: 280, y: 230)
      CTLineDraw(line, context)
    }
    CVPixelBufferUnlockBaseAddress(pixel, [])
    try expect(adaptor.append(pixel, withPresentationTime: CMTime(value: Int64(frameIndex), timescale: 10)), "fixture appends frame")
  }
  input.markAsFinished()
  await writer.finishWriting()
  try expect(writer.status == .completed, "fixture writer completes: \(String(describing: writer.error))")
}

@main
struct VideoFrameOCRTests {
  static func main() async throws {
    var passed = 0
    func test(_ name: String, _ body: () throws -> Void) throws {
      try body(); passed += 1; print("PASS \(name)")
    }
    func asyncTest(_ name: String, _ body: () async throws -> Void) async throws {
      try await body(); passed += 1; print("PASS \(name)")
    }

    try test("final 0.2s sample exists for short and long clips") {
      for duration in [0.1, 2.0, 15.76, 180.0, 360.0, 1200.0] {
        let times = VideoFrameOCR.sampleTimes(durationSec: duration, fps: 2, maxFrames: 240)
        try expect(times.first == max(0, duration - 0.2), "\(duration)s ending is first")
        try expect(times.count <= 240, "hard frame cap")
        try expect(times.allSatisfy { $0 >= 0 && $0 < duration }, "all requests in clip")
        try expect(Set(times).count == times.count, "unique requested times")
      }
    }
    try test("final eight seconds reserve sixteen half-second samples") {
      let tail = Array(VideoFrameOCR.sampleTimes(durationSec: 360, fps: 2, maxFrames: 240).prefix(16))
      try expect(tail.count == 16, "sixteen tail samples")
      try expect(tail.first == 359.8 && tail.last == 352.3, "tail bounds")
      try expect(zip(tail, tail.dropFirst()).allSatisfy { abs($0 - $1 - 0.5) < 0.0001 }, "2fps tail")
    }
    try test("first coverage batch spans the beginning middle and pre-tail end") {
      let times = VideoFrameOCR.sampleTimes(durationSec: 360, fps: 2, maxFrames: 240)
      let coverage = Array(times.dropFirst(16).prefix(4))
      try expect(coverage.first == 0, "coverage includes start")
      try expect(coverage.contains { $0 > 340 }, "coverage immediately reaches far end")
      try expect(coverage.contains { $0 > 150 && $0 < 210 }, "coverage immediately includes middle")
    }
    try test("invalid duration and pathological caps remain bounded") {
      for duration in [Double.nan, Double.infinity, 0, -1] {
        try expect(VideoFrameOCR.sampleTimes(durationSec: duration, fps: 2, maxFrames: 240).isEmpty, "invalid duration")
      }
      try expect(VideoFrameOCR.sampleTimes(durationSec: 180, fps: .nan, maxFrames: 99999).count <= 240, "native hard cap")
      try expect(VideoFrameOCR.sampleTimes(durationSec: 180, fps: 2, maxFrames: 0) == [179.8], "tiny cap keeps ending")
    }
    try test("native and TypeScript committed defaults agree") {
      let root = URL(fileURLWithPath: CommandLine.arguments[1])
      let source = try String(contentsOf: root.appendingPathComponent("napkin-app/lib/importBudgets.ts"), encoding: .utf8)
      try expect(source.contains("VIDEO_OCR_MAX_FRAMES = \(VideoFrameOCR.defaultMaxFrames);"), "frame parity")
      try expect(source.contains("VIDEO_OCR_FPS = \(Int(VideoFrameOCR.defaultFPS));"), "fps parity")
      try expect(source.contains("OCR_WALLCLOCK_BUDGET_MS = 45_000;") && VideoFrameOCR.defaultBudgetMs == 45_000, "budget parity")
    }
    try await asyncTest("generation leaves time to OCR a timed-out partial batch") {
      var clock = 0.0
      var generationAllowance = 0.0
      let frames = await VideoFrameOCR.run(times: [1.8, 1.3, 0.8, 0.3], budgetMs: 1000, now: { clock }, generate: { times, budget in
        generationAllowance = budget
        clock += budget // Simulate the batch watchdog, with one decoded frame.
        return [VideoDecodedFrame(requestedTimeSec: times[0], actualTimeSec: 1.8, image: "LOTTA")]
      }, recognize: { image, _ in clock += 0.05; return [image] })
      try expect(generationAllowance == 0.5, "generation receives half, not entire deadline")
      try expect(frames == [VideoOCRFrame(timeSec: 1.8, lines: ["LOTTA"])], "partial decoded venue gets OCR")
    }
    try await asyncTest("completed batches survive a later exhausted deadline") {
      var clock = 0.0
      var batches = 0
      let frames = await VideoFrameOCR.run(times: Array(0..<12).map(Double.init), budgetMs: 1000, now: { clock }, generate: { times, _ -> [VideoDecodedFrame<String>] in
        batches += 1
        try! expect(times.count <= 4, "small batch")
        if batches == 2 { clock = 1; return [] }
        return times.map { VideoDecodedFrame(requestedTimeSec: $0, actualTimeSec: $0, image: "venue \($0)") }
      }, recognize: { image, _ in clock += 0.1; return [image] })
      try expect(batches == 2 && frames.count == 4, "prior evidence survives; no third batch starts")
    }
    try await asyncTest("actual timestamps dedupe decode overlap and restore chronological output") {
      var recognized: [String] = []
      let frames = await VideoFrameOCR.run(times: [9.8, 9.3, 0, 4.5], budgetMs: 1000, generate: { _, _ in
        [
          VideoDecodedFrame(requestedTimeSec: 4.5, actualTimeSec: 4.4, image: "middle"),
          VideoDecodedFrame(requestedTimeSec: 9.3, actualTimeSec: 9.2, image: "duplicate"),
          VideoDecodedFrame(requestedTimeSec: 0, actualTimeSec: 0, image: "opening"),
          VideoDecodedFrame(requestedTimeSec: 9.8, actualTimeSec: 9.2, image: "ending"),
        ]
      }, recognize: { image, _ in recognized.append(image); return [image, " watermarked ", "watermarked", ""] })
      try expect(recognized == ["ending", "opening", "middle"], "priority restored; repeated actual frame recognized once")
      try expect(frames.map(\.timeSec) == [0, 4.4, 9.2], "actual chronological times")
      try expect(VideoFrameOCR.legacyLines(frames) == ["opening", "watermarked", "middle", "ending"], "legacy chronological dedupe")
    }
    try await asyncTest("no generation or OCR starts after an already-spent budget") {
      var generated = false
      let frames = await VideoFrameOCR.run(times: [1], budgetMs: 0, generate: { _, _ -> [VideoDecodedFrame<String>] in
        generated = true; return []
      }, recognize: { _, _ in ["should not run"] })
      try expect(!generated && frames.isEmpty, "zero budget starts nothing")
    }
    try test("deadline completion claims partials before cancelling and ignores late callbacks") {
      var results: [[String]] = []
      var events: [String] = []
      let gate = VideoOCRBatchGate<String>(count: 2) { results.append($0); events.append("resume") }
      gate.accept("LOTTA")
      gate.finish { events.append("cancel") }
      gate.accept("late bottle")
      gate.finish { events.append("wrong second cancel") }
      try expect(results == [["LOTTA"]], "exactly one partial result")
      try expect(events == ["cancel", "resume"], "cancel before resumption, only winner cancels")
    }
    try test("simultaneous completion and timeout resume exactly once") {
      for _ in 0..<500 {
        let lock = NSLock()
        var completions = 0
        let gate = VideoOCRBatchGate<String>(count: 1) { _ in
          lock.lock(); completions += 1; lock.unlock()
        }
        DispatchQueue.concurrentPerform(iterations: 2) { index in
          if index == 0 { gate.accept("LOTTA") } else { gate.finish() }
        }
        try expect(completions == 1, "one completion under race")
      }
    }
    try await asyncTest("real generated video recovers a venue card visible only during final 0.3s") {
      let dir = URL(fileURLWithPath: NSTemporaryDirectory()).appendingPathComponent("napkin-ocr-fixture-\(UUID().uuidString)")
      try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
      defer { try? FileManager.default.removeItem(at: dir) }
      let url = dir.appendingPathComponent("ending.mp4")
      try await makeEndCardVideo(at: url)
      let frames = await VideoFrameOCR.extract(asset: AVURLAsset(url: url), fps: 2, maxFrames: 240, budgetMs: 45000)
      let found = frames.filter { $0.lines.contains { $0.uppercased().contains("LOTTA") } }
      try expect(!found.isEmpty, "actual AVFoundation/Vision recognizes LOTTA")
      try expect(found.allSatisfy { $0.timeSec >= 1.7 }, "venue evidence is timestamped in final card")
    }
    if CommandLine.arguments.count > 2 {
      try await asyncTest("founder clip retains LOTTA with chronological actual frames") {
        let url = URL(fileURLWithPath: CommandLine.arguments[2])
        let start = ProcessInfo.processInfo.systemUptime
        let frames = await VideoFrameOCR.extract(asset: AVURLAsset(url: url), fps: 2, maxFrames: 240, budgetMs: 45000)
        try expect(frames.map(\.timeSec) == frames.map(\.timeSec).sorted(), "founder timestamps chronological")
        let lotta = frames.filter { $0.lines.contains { $0.uppercased().contains("LOTTA") } }
        try expect(!lotta.isEmpty, "founder clip LOTTA survives")
        print("  founder frames=\(frames.count), LOTTA timestamps=\(lotta.map(\.timeSec)), elapsed=\(ProcessInfo.processInfo.systemUptime - start)s")
      }
    }
    print("\(passed) native regression tests passed")
  }
}
