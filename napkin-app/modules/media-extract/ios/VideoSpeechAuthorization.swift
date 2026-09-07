import Speech

/// Called on main immediately before a possible permission request. Keep the
/// caller's existing deadline; an import never waits for a background prompt.
enum VideoSpeechAuthorization {
  static func resolve(
    status: SFSpeechRecognizerAuthorizationStatus,
    applicationIsActive: Bool,
    request: (@escaping (SFSpeechRecognizerAuthorizationStatus) -> Void) -> Void,
    finish: @escaping (SFSpeechRecognizerAuthorizationStatus) -> Void
  ) {
    if status == .notDetermined && applicationIsActive {
      request(finish)
    } else {
      // Authorized callers continue on-device STT, including in background.
      // Denied/restricted/undetermined-in-background callers skip immediately.
      finish(status)
    }
  }
}
