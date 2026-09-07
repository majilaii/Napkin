import Foundation
import PhotosUI
import UIKit
import UniformTypeIdentifiers

/// The selected provider and its download outlive the picker and any JS sheet.
/// PHPicker grants access only to selected assets; no Photos authorization call.
final class VideoImportCapture: NSObject, PHPickerViewControllerDelegate {
  static let shared = VideoImportCapture()
  private var picker: PHPickerViewController?
  private var selection: (userId: String, completion: (Result<[String: Any], Error>) -> Void)?
  private var downloads: [String: Download] = [:]
  var onPrepared: ((String) -> Void)?

  private final class Download {
    let job: VideoImportPreparationStore.Job
    let provider: NSItemProvider
    var progress: Progress?
    let lease = VideoImportRuntimeLease { raw in
      let identifier = UIBackgroundTaskIdentifier(rawValue: raw)
      if identifier != .invalid { UIApplication.shared.endBackgroundTask(identifier) }
    }
    init(job: VideoImportPreparationStore.Job, provider: NSItemProvider) {
      self.job = job; self.provider = provider
    }
  }

  enum Failure: Error { case unavailable, pickerBusy, invalidVideo }

  func present(from presenter: UIViewController, userId: String, completion: @escaping (Result<[String: Any], Error>) -> Void) throws {
    guard UUID(uuidString: userId) != nil else { throw VideoImportPreparationStore.Failure.invalidOwner }
    guard VideoImportPreparationStore.shared != nil else { throw Failure.unavailable }
    guard picker == nil, !presenter.isBeingDismissed, !presenter.isBeingPresented,
          presenter.presentedViewController == nil, presenter.viewIfLoaded?.window != nil else { throw Failure.pickerBusy }
    var configuration = PHPickerConfiguration()
    configuration.filter = .videos
    configuration.selectionLimit = 1
    configuration.preferredAssetRepresentationMode = .current
    let controller = PHPickerViewController(configuration: configuration)
    controller.delegate = self
    controller.modalPresentationStyle = .fullScreen
    picker = controller
    selection = (userId, completion)
    presenter.present(controller, animated: true)
  }

  func picker(_ picker: PHPickerViewController, didFinishPicking results: [PHPickerResult]) {
    guard picker === self.picker, let request = selection else { return }
    selection = nil
    guard let result = results.first else {
      dismiss(picker) { request.completion(.success(["canceled": true])) }
      return
    }
    let provider = result.itemProvider
    guard let type = provider.registeredTypeIdentifiers.first(where: { UTType($0)?.conforms(to: .movie) == true }),
          let store = VideoImportPreparationStore.shared else {
      dismiss(picker) { request.completion(.failure(Failure.invalidVideo)) }
      return
    }
    do {
      let job = try store.prepare(userId: request.userId, fileExtension: UTType(type)?.preferredFilenameExtension ?? "mov")
      let download = Download(job: job, provider: provider)
      downloads[job.id] = download
      download.lease.start(begin: { expiration in
        UIApplication.shared.beginBackgroundTask(withName: "napkin.video-source", expirationHandler: expiration).rawValue
      }, expire: { [weak self] in self?.finish(download, failed: true) })
      // Resolve the JS picker promise after dismissal, without awaiting iCloud.
      dismiss(picker) { request.completion(.success(["canceled": false, "jobId": job.id])) }
      download.progress = provider.loadFileRepresentation(forTypeIdentifier: type) { [weak self] url, error in
        var failed = true
        if error == nil, let url {
          // Apple's temporary representation disappears when this callback returns.
          // Copy synchronously here, on the provider callback queue, not main.
          failed = (try? store.receive(url, for: job)) != true
        }
        let copyFailed = failed
        DispatchQueue.main.async { self?.finish(download, failed: copyFailed) }
      }
      if downloads[job.id] == nil { download.progress?.cancel() }
    } catch {
      dismiss(picker) { request.completion(.failure(error)) }
    }
  }

  private func dismiss(_ controller: PHPickerViewController, completion: @escaping () -> Void) {
    controller.dismiss(animated: true) { [weak self] in
      self?.picker = nil
      completion()
    }
  }

  func cancel(jobId: String) {
    guard let download = downloads.removeValue(forKey: jobId) else { return }
    download.progress?.cancel()
    download.lease.finish()
  }

  private func finish(_ download: Download, failed: Bool) {
    guard downloads.removeValue(forKey: download.job.id) != nil else { return }
    if failed {
      _ = try? VideoImportPreparationStore.shared?.fail(download.job)
      download.progress?.cancel()
    }
    download.lease.finish()
    if VideoImportPreparationStore.shared?.isTerminal(download.job) == true {
      onPrepared?(download.job.id)
    }
  }
}
