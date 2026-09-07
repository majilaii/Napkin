import Foundation
import Speech

@main
struct VideoSpeechAuthorizationTests {
  static func main() {
    var passed = 0
    for active in [false, true] {
      for status: SFSpeechRecognizerAuthorizationStatus in [.authorized, .denied, .restricted, .notDetermined] {
        var requests = 0
        var completed: [SFSpeechRecognizerAuthorizationStatus] = []
        var deferred: ((SFSpeechRecognizerAuthorizationStatus) -> Void)?
        VideoSpeechAuthorization.resolve(status: status, applicationIsActive: active, request: { callback in
          requests += 1
          deferred = callback
        }, finish: { completed.append($0) })
        if active && status == .notDetermined {
          precondition(requests == 1 && completed.isEmpty, "Only active first use waits for authorization")
          deferred?(.authorized)
          precondition(completed == [.authorized], "Existing authorization callback reaches the bounded caller")
        } else {
          precondition(requests == 0, "Background, granted, denied and restricted paths must not request")
          precondition(completed == [status], "Existing authorization state completes immediately")
        }
        passed += 1
      }
    }
    print("Video speech authorization: \(passed) passed (no real permission requests)")
  }
}
