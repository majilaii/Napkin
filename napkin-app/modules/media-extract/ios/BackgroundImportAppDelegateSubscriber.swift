import ExpoModulesCore
import UIKit

public final class BackgroundImportAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication,
                          handleEventsForBackgroundURLSession identifier: String,
                          completionHandler: @escaping () -> Void) {
    // TICKET-248: a share's wake upload, or an import's video/slide download
    // (expo-file-system background sessions are named with a bare UUID), just
    // woke Napkin. Hold time so the woken import can run rather than suspend.
    if identifier.hasPrefix(BackgroundImportTransfer.sessionPrefix) || UUID(uuidString: identifier) != nil {
      ImportWakeRuntime.hold()
    }
    // The callback is forwarded to every Expo subscriber; finish unrelated ones.
    BackgroundImportTransfer.reconnect(identifier: identifier, completion: completionHandler)
  }
}

/// TICKET-248: when a background transfer finishes, iOS launches or resumes Napkin
/// in the background, and it may suspend the app as soon as UIKit's session
/// completion handler runs: before React Native has started a shared import, or
/// before a finished video download reaches OCR. This grant bridges that gap; a
/// new drain releases it once it holds its own (beginBackgroundTask), otherwise
/// iOS reclaims it when background time runs out. Main-thread state only.
enum ImportWakeRuntime {
  private static var lease: VideoImportRuntimeLease?

  /// Called by UIKit on main, so the grant exists before the session's events
  /// finish and its completion handler runs.
  static func hold() {
    onMain {
      if let current = lease, !current.isFinished { return }
      let next = VideoImportRuntimeLease { raw in
        let identifier = UIBackgroundTaskIdentifier(rawValue: raw)
        if identifier != .invalid { UIApplication.shared.endBackgroundTask(identifier) }
      }
      lease = next
      next.start(begin: { expiration in
        UIApplication.shared.beginBackgroundTask(withName: "napkin.import-wake", expirationHandler: expiration).rawValue
      }, expire: {})
    }
  }

  static func release() {
    onMain {
      lease?.finish()
      lease = nil
    }
  }

  private static func onMain(_ work: @escaping () -> Void) {
    if Thread.isMainThread { work() } else { DispatchQueue.main.async(execute: work) }
  }
}
