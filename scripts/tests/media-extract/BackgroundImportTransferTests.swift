import Foundation

@main struct BackgroundImportTransferTests {
  static func main() throws {
    var count = 0
    func check(_ result: Bool, _ message: String) {
      guard result else { fatalError(message) }
      count += 1
    }
    let id = "11111111-1111-4111-8111-111111111111"
    let accepted = Data("{\"data\":{\"job_id\":\"\(id)\",\"status\":\"pending\"}}".utf8)
    check(BackgroundImportTransferOutcome.classify(status: 202, failed: false, response: accepted, jobId: id.uppercased()) == "accepted", "Accepted response must match the same UUID")
    check(BackgroundImportTransferOutcome.classify(status: 202, failed: false, response: Data(), jobId: id) == "uncertain", "A lost body is not proof of failure")
    check(BackgroundImportTransferOutcome.classify(status: 202, failed: true, response: accepted, jobId: id) == "uncertain", "A transport error after acceptance requires server reconciliation")
    check(BackgroundImportTransferOutcome.classify(status: 202, failed: false, response: accepted, jobId: "22222222-2222-4222-8222-222222222222") == "uncertain", "Never attribute another job's response")
    check(BackgroundImportTransferOutcome.classify(status: 503, failed: false, response: Data(), jobId: id) == "uncertain", "A server error can occur after the job commits")
    check(BackgroundImportTransferOutcome.classify(status: 401, failed: false, response: Data(), jobId: id) == "rejected", "Expired intake credential is a known rejection")
    check(BackgroundImportTransferOutcome.classify(status: 429, failed: false, response: Data(), jobId: id) == "uncertain", "Rate limiting needs idempotent retry")
    let credential = BackgroundImportCredential(credentialId: id, token: "nbi_" + String(repeating: "a", count: 64), userId: id,
      installationId: id, expiresAt: 9_999_999_999_999, endpoint: "https://example.supabase.co/functions/v1/background-imports", anonKey: String(repeating: "b", count: 25))
    check(credential.isValid, "A well-formed scoped credential is accepted")
    var payload = try JSONSerialization.jsonObject(with: JSONEncoder().encode(credential)) as! [String: Any]
    for invalid in ["http://example.com/functions/v1/background-imports", "https://user:password@example.com/functions/v1/background-imports", "https://example.com/functions/v1/background-imports?redirect=evil", "https://example.com/not-intake"] {
      payload["endpoint"] = invalid
      let value = try JSONDecoder().decode(BackgroundImportCredential.self, from: JSONSerialization.data(withJSONObject: payload))
      check(!value.isValid, "Credential endpoints must be exact HTTPS intake URLs")
    }
    payload["endpoint"] = credential.endpoint
    payload["userId"] = "not-an-owner"
    check(!(try JSONDecoder().decode(BackgroundImportCredential.self, from: JSONSerialization.data(withJSONObject: payload))).isValid, "Identity must be a UUID")
    payload["userId"] = id
    payload["token"] = id
    check(!(try JSONDecoder().decode(BackgroundImportCredential.self, from: JSONSerialization.data(withJSONObject: payload))).isValid, "A user ID never substitutes for a scoped secret")
    print("\(count) background intake transport assertions passed")
  }
}
