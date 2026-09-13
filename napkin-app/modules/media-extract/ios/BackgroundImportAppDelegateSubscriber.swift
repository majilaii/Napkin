import ExpoModulesCore
import UIKit

public final class BackgroundImportAppDelegateSubscriber: ExpoAppDelegateSubscriber {
  public func application(_ application: UIApplication,
                          handleEventsForBackgroundURLSession identifier: String,
                          completionHandler: @escaping () -> Void) {
    // The callback is forwarded to every Expo subscriber; finish unrelated ones.
    BackgroundImportTransfer.reconnect(identifier: identifier, completion: completionHandler)
  }
}
