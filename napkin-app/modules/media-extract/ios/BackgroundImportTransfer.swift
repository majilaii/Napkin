import Foundation
import Security

// Compiled by the app module and copied into the share target at prebuild.
// This file uses extension-safe APIs only. No Supabase session enters this store.
struct BackgroundImportCredential: Codable {
  let credentialId: String
  let token: String
  let userId: String
  let installationId: String
  let expiresAt: Double
  let endpoint: String
  let anonKey: String

  var isValid: Bool {
    guard UUID(uuidString: credentialId) != nil, UUID(uuidString: userId) != nil,
          UUID(uuidString: installationId) != nil, expiresAt.isFinite,
          token.range(of: "^nbi_[0-9a-f]{64}$", options: .regularExpression) != nil,
          anonKey.count >= 20, anonKey.count <= 4096,
          let url = URL(string: endpoint), url.scheme == "https", url.host != nil,
          url.user == nil, url.password == nil, url.query == nil, url.fragment == nil,
          url.path == "/functions/v1/background-imports" else { return false }
    return true
  }
}

enum BackgroundImportCredentialStore {
  static let appGroup = "group.com.majilaii.napkin.shared"
  private static let service = "napkin.background-import-intake"
  private static let ownerKey = "background-import-active-owner"
  private static let revocationLock = NSRecursiveLock()
  private static var defaults: UserDefaults? { UserDefaults(suiteName: appGroup) }

  private static var query: [String: Any] {
    [kSecClass as String: kSecClassGenericPassword,
     kSecAttrService as String: service, kSecAttrAccount as String: "intake",
     kSecAttrAccessGroup as String: appGroup]
  }

  static var root: URL? {
    FileManager.default.containerURL(forSecurityApplicationGroupIdentifier: appGroup)
  }

  static func installationId() -> String {
    if let id = defaults?.string(forKey: "background-import-installation"), UUID(uuidString: id) != nil { return id }
    let id = UUID().uuidString.lowercased()
    defaults?.set(id, forKey: "background-import-installation")
    return id
  }

  static func read() -> BackgroundImportCredential? {
    var lookup = query
    lookup[kSecReturnData as String] = true
    lookup[kSecMatchLimit as String] = kSecMatchLimitOne
    var result: CFTypeRef?
    guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data,
          let value = try? JSONDecoder().decode(BackgroundImportCredential.self, from: data),
          value.isValid else { return nil }
    return value
  }

  @discardableResult static func write(_ value: BackgroundImportCredential) -> Bool {
    guard value.isValid, value.userId == defaults?.string(forKey: ownerKey),
          value.installationId == installationId(), let data = try? JSONEncoder().encode(value) else { return false }
    let attributes: [String: Any] = [kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    let status = SecItemUpdate(query as CFDictionary, attributes as CFDictionary)
    if status == errSecSuccess { return true }
    guard status == errSecItemNotFound else { return false }
    return SecItemAdd(query.merging(attributes) { _, new in new } as CFDictionary, nil) == errSecSuccess
  }

  static func setOwner(_ userId: String?) {
    let owner = userId.flatMap { UUID(uuidString: $0) == nil ? nil : $0 }
    defaults?.set(owner, forKey: ownerKey)
    if read()?.userId != owner { clear() }
  }

  static func clear() {
    if let previous = read() { queueRevocation(previous) }
    SecItemDelete(query as CFDictionary)
  }

  private static var revocationQuery: [String: Any] {
    query.merging([kSecAttrAccount as String: "pending-revocations"]) { _, new in new }
  }

  static func pendingRevocations() -> [BackgroundImportCredential] {
    var lookup = revocationQuery
    lookup[kSecReturnData as String] = true
    var result: CFTypeRef?
    guard SecItemCopyMatching(lookup as CFDictionary, &result) == errSecSuccess,
          let data = result as? Data else { return [] }
    return (try? JSONDecoder().decode([BackgroundImportCredential].self, from: data)) ?? []
  }

  private static func writeRevocations(_ records: [BackgroundImportCredential]) {
    guard let data = try? JSONEncoder().encode(records) else { return }
    let attributes: [String: Any] = [kSecValueData as String: data,
      kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly]
    if SecItemUpdate(revocationQuery as CFDictionary, attributes as CFDictionary) == errSecItemNotFound {
      SecItemAdd(revocationQuery.merging(attributes) { _, new in new } as CFDictionary, nil)
    }
  }

  static func queueRevocation(_ credential: BackgroundImportCredential) {
    revocationLock.lock(); defer { revocationLock.unlock() }
    guard credential.isValid else { return }
    var records = pendingRevocations()
    if !records.contains(where: { $0.credentialId == credential.credentialId }) { records.append(credential) }
    writeRevocations(records)
  }

  private static func finishRevocation(_ credentialId: String) {
    revocationLock.lock(); defer { revocationLock.unlock() }
    writeRevocations(pendingRevocations().filter { $0.credentialId != credentialId })
  }

  static func revoke(_ credential: BackgroundImportCredential) async -> Bool {
    guard credential.isValid else { return false }
    queueRevocation(credential)
    var request = URLRequest(url: URL(string: credential.endpoint + "?action=revoke_intake")!)
    request.httpMethod = "POST"
    request.timeoutInterval = 8
    request.httpBody = Data("{}".utf8)
    request.setValue("application/json", forHTTPHeaderField: "Content-Type")
    request.setValue("Bearer " + credential.token, forHTTPHeaderField: "Authorization")
    request.setValue(credential.anonKey, forHTTPHeaderField: "apikey")
    let configuration = URLSessionConfiguration.ephemeral
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    // A scoped token only reaches its originally registered endpoint.
    let session = URLSession(configuration: configuration, delegate: BackgroundImportNoRedirect(), delegateQueue: nil)
    defer { session.invalidateAndCancel() }
    do {
      let (_, response) = try await session.data(for: request)
      guard let status = (response as? HTTPURLResponse)?.statusCode,
            (200...299).contains(status) || [401, 403].contains(status) else { return false }
      finishRevocation(credential.credentialId)
      return true
    } catch { return false }
  }

  static func activeCredential(for owner: String?) -> BackgroundImportCredential? {
    guard let owner, owner == defaults?.string(forKey: ownerKey), let value = read(),
          value.userId == owner, value.expiresAt > Date().timeIntervalSince1970 * 1000 + 60_000 else { return nil }
    return value
  }
}

private final class BackgroundImportNoRedirect: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask,
                  willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }
}

struct BackgroundImportTransferRecord: Codable {
  let jobId: String
  let userId: String
  let sessionIdentifier: String
  var status: String
  var httpStatus: Int?
  var updatedAt: Double
}

enum BackgroundImportTransferOutcome {
  static func classify(status: Int?, failed: Bool, response: Data, jobId: String) -> String {
    let envelope = (try? JSONSerialization.jsonObject(with: response)) as? [String: Any]
    let result = envelope?["data"] as? [String: Any]
    let matches = (result?["job_id"] as? String)?.lowercased() == jobId.lowercased()
    if !failed, let status, (200...299).contains(status), matches { return "accepted" }
    if !failed, let status, [400, 401, 403, 404, 409, 413, 422].contains(status) { return "rejected" }
    // A timeout, lost response or server error can occur after acceptance.
    return "uncertain"
  }
}

/// One persisted request file and session per share. Uploads are owned by iOS
/// after resume(), so dismissing the extension does not cancel the wake.
final class BackgroundImportTransfer: NSObject, URLSessionDataDelegate {
  static let sessionPrefix = "com.majilaii.napkin.import-intake."
  private static var retained: [String: BackgroundImportTransfer] = [:]
  private static let retentionLock = NSLock()
  static var onCompletion: ((String) -> Void)?
  private let identifier: String
  private var session: URLSession?
  private var responseBody = Data()
  private var backgroundCompletion: (() -> Void)?
  private var record: BackgroundImportTransferRecord?
  private static var directory: URL? { BackgroundImportCredentialStore.root?.appendingPathComponent("import-transfers", isDirectory: true) }

  private init(identifier: String, record: BackgroundImportTransferRecord? = nil) {
    self.identifier = identifier
    self.record = record
    super.init()
  }

  static func readRecord(jobId: String) -> BackgroundImportTransferRecord? {
    guard UUID(uuidString: jobId) != nil, let file = directory?.appendingPathComponent(jobId + ".json"),
          let data = try? Data(contentsOf: file) else { return nil }
    return try? JSONDecoder().decode(BackgroundImportTransferRecord.self, from: data)
  }

  /// TICKET-248: a wake, not a server job. When this tiny upload finishes, iOS
  /// launches (or resumes) Napkin in the background — even if neither process
  /// is running — and the app processes the queued share on the device. The
  /// server only authenticates the scoped credential and answers; it stores
  /// nothing. False = no credential for this owner (the share waits for an open).
  static func wake(jobId: String, owner: String?, origin: String) -> Bool {
    guard UUID(uuidString: jobId) != nil, let owner,
          let credential = BackgroundImportCredentialStore.activeCredential(for: owner),
          let directory else { return false }
    let sessionId = sessionPrefix + origin + "." + UUID().uuidString.lowercased()
    let record = BackgroundImportTransferRecord(jobId: jobId, userId: owner, sessionIdentifier: sessionId,
      status: "uploading", updatedAt: Date().timeIntervalSince1970 * 1000)
    let transfer = BackgroundImportTransfer(identifier: sessionId, record: record)
    do {
      try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
      let body = try JSONSerialization.data(withJSONObject: ["job_id": jobId, "expected_owner_id": owner])
      // Uploads that outlive the extension must come from a file.
      let bodyURL = directory.appendingPathComponent(jobId + ".request.json")
      try body.write(to: bodyURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
      try transfer.writeRecord(record)
      var request = URLRequest(url: URL(string: credential.endpoint + "?action=wake")!)
      request.httpMethod = "POST"
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.setValue("Bearer " + credential.token, forHTTPHeaderField: "Authorization")
      request.setValue(credential.anonKey, forHTTPHeaderField: "apikey")
      transfer.retainAndConnect()
      let task = transfer.session!.uploadTask(with: request, fromFile: bodyURL)
      task.taskDescription = jobId
      task.resume()
      return true
    } catch {
      var rejected = record
      rejected.status = "rejected"
      try? transfer.writeRecord(rejected)
      return false
    }
  }

  static func reconnect(identifier: String, completion: @escaping () -> Void) {
    guard identifier.hasPrefix(sessionPrefix) else { completion(); return }
    retentionLock.lock()
    let existing = retained[identifier]
    retentionLock.unlock()
    let transfer = existing ?? BackgroundImportTransfer(identifier: identifier)
    transfer.backgroundCompletion = completion
    if existing == nil { transfer.retainAndConnect() }
  }

  private func retainAndConnect() {
    Self.retentionLock.lock()
    Self.retained[identifier] = self
    Self.retentionLock.unlock()
    let configuration = URLSessionConfiguration.background(withIdentifier: identifier)
    configuration.sharedContainerIdentifier = BackgroundImportCredentialStore.appGroup
    configuration.isDiscretionary = false
    configuration.sessionSendsLaunchEvents = true
    configuration.httpCookieStorage = nil
    configuration.httpShouldSetCookies = false
    configuration.urlCache = nil
    configuration.timeoutIntervalForResource = 24 * 60 * 60
    session = URLSession(configuration: configuration, delegate: self, delegateQueue: .main)
  }

  private func writeRecord(_ record: BackgroundImportTransferRecord) throws {
    guard let directory = Self.directory else { return }
    try JSONEncoder().encode(record).write(to: directory.appendingPathComponent(record.jobId + ".json"),
      options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
  }

  func urlSession(_ session: URLSession, dataTask: URLSessionDataTask, didReceive data: Data) {
    if responseBody.count + data.count <= 65_536 { responseBody.append(data) }
  }

  // A redirect must never forward an intake credential to a different origin.
  func urlSession(_ session: URLSession, task: URLSessionTask,
                  willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) {
    completionHandler(nil)
  }

  func urlSession(_ session: URLSession, task: URLSessionTask, didCompleteWithError error: Error?) {
    guard let jobId = task.taskDescription, UUID(uuidString: jobId) != nil,
          var value = record ?? Self.readRecord(jobId: jobId), value.sessionIdentifier == identifier else { return }
    let status = (task.response as? HTTPURLResponse)?.statusCode
    value.httpStatus = status
    value.updatedAt = Date().timeIntervalSince1970 * 1000
    value.status = BackgroundImportTransferOutcome.classify(status: status, failed: error != nil, response: responseBody, jobId: jobId)
    try? writeRecord(value)
    if let body = Self.directory?.appendingPathComponent(jobId + ".request.json") { try? FileManager.default.removeItem(at: body) }
    Self.onCompletion?(jobId)
    session.finishTasksAndInvalidate()
  }

  func urlSessionDidFinishEvents(forBackgroundURLSession session: URLSession) {
    let completion = backgroundCompletion
    backgroundCompletion = nil
    DispatchQueue.main.async { completion?() }
  }

  func urlSession(_ session: URLSession, didBecomeInvalidWithError error: Error?) {
    let completion = backgroundCompletion
    backgroundCompletion = nil
    Self.retentionLock.lock()
    Self.retained.removeValue(forKey: identifier)
    Self.retentionLock.unlock()
    DispatchQueue.main.async { completion?() }
  }
}
