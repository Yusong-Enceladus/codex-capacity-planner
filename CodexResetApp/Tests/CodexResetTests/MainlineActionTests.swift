import Foundation
import Testing
@testable import CodexReset

@MainActor
@Suite(.serialized)
struct MainlineActionTests {
    private let action = DetailAction(
        title: "暂不推荐",
        operation: "snooze",
        targetId: "synthetic-mainline")

    @Test func `one pending row does not block another or submit twice`() async {
        let first = MainlineActionState()
        let second = MainlineActionState()
        var completion: CheckedContinuation<Bool, Never>?
        let saving = Task {
            await first.perform(self.action) { _ in
                await withCheckedContinuation { completion = $0 }
            }
        }
        while completion == nil { await Task.yield() }
        #expect(first.phase == .saving(self.action))

        var duplicateSubmitted = false
        await first.perform(self.action) { _ in
            duplicateSubmitted = true
            return true
        }
        #expect(!duplicateSubmitted)

        await second.perform(self.action) { _ in true }
        #expect(second.phase == .saved(self.action))
        #expect(first.phase == .saving(self.action))

        completion?.resume(returning: true)
        await saving.value
        #expect(first.phase == .saved(self.action))
    }

    @Test func `failed correction can retry without replacing the row`() async {
        let state = MainlineActionState()
        await state.perform(self.action) { _ in false }
        #expect(state.phase == .failed(self.action))
        await state.perform(self.action) { _ in true }
        #expect(state.phase == .saved(self.action))
    }

    @Test func `failure can return to the original action choices`() async {
        let state = MainlineActionState()
        await state.perform(self.action) { _ in false }
        state.dismissFailure()
        #expect(state.phase == .ready)
    }

    @Test func `saved correction can restore automatic judgment in place`() async {
        let state = MainlineActionState()
        await state.perform(self.action) { _ in true }
        let restore = DetailAction(
            title: "恢复自动判断",
            operation: "restore",
            targetId: self.action.targetId)
        await state.perform(restore) { submitted in
            #expect(submitted.targetId == self.action.targetId)
            #expect(submitted.operation == "restore")
            return true
        }
        #expect(state.phase == .saved(restore))
    }

    @Test func `successful action uses local authorization and refreshes the snapshot`() async throws {
        let updated = ResetDemoFixtures.primarySnapshot(.simplifiedChinese)
        MainlineTestProtocol.responses.reset([
            .json(200, #"{"capabilityToken":"synthetic-capability"}"#),
            .json(200, #"{"ok":true}"#),
            .init(status: 200, data: try JSONEncoder().encode(updated)),
        ])
        let session = self.session()
        defer { session.invalidateAndCancel() }
        let store = SnapshotStore(session: session)

        #expect(await store.perform(self.action))
        #expect(store.snapshot == updated)
        #expect(store.errorMessage == nil)
        let requests = MainlineTestProtocol.responses.requests
        #expect(requests.map { $0.url?.path } == [
            "/api/config", "/api/mainline-action", "/api/snapshot",
        ])
        let post = try #require(requests.first { $0.httpMethod == "POST" })
        #expect(post.value(forHTTPHeaderField: "X-Codex-Reset-Token") == "synthetic-capability")
        #expect(post.value(forHTTPHeaderField: "Origin") == LocalMonitorEndpoint.baseURL.absoluteString)
    }

    @Test func `rejected action reports failure without a misleading saved state`() async {
        MainlineTestProtocol.responses.reset([
            .json(200, #"{"capabilityToken":"synthetic-capability"}"#),
            .json(400, #"{"error":"mainline_target_unknown"}"#),
        ])
        let session = self.session()
        defer { session.invalidateAndCancel() }
        let store = SnapshotStore(session: session)

        #expect(await store.perform(self.action) == false)
        #expect(store.errorMessage != nil)
        #expect(MainlineTestProtocol.responses.requests.count == 2)
    }

    @Test func `durable correction remains saved when the following refresh fails`() async {
        MainlineTestProtocol.responses.reset([
            .json(200, #"{"capabilityToken":"synthetic-capability"}"#),
            .json(200, #"{"ok":true}"#),
            .json(503, #"{"error":"unavailable"}"#),
        ])
        let session = self.session()
        defer { session.invalidateAndCancel() }
        let previous = ResetDemoFixtures.primarySnapshot(.simplifiedChinese)
        let store = SnapshotStore(session: session, snapshot: previous)

        #expect(await store.perform(self.action))
        #expect(store.snapshot == previous)
        #expect(store.errorMessage != nil)
        #expect(store.isRefreshing == false)
    }

    private func session() -> URLSession {
        let configuration = URLSessionConfiguration.ephemeral
        configuration.protocolClasses = [MainlineTestProtocol.self]
        return URLSession(configuration: configuration)
    }
}

private struct MainlineTestResponse: Sendable {
    let status: Int
    let data: Data

    static func json(_ status: Int, _ text: String) -> Self {
        Self(status: status, data: Data(text.utf8))
    }
}

private final class MainlineTestResponses: @unchecked Sendable {
    private let lock = NSLock()
    private var queued: [MainlineTestResponse] = []
    private var received: [URLRequest] = []

    var requests: [URLRequest] { self.lock.withLock { self.received } }

    func reset(_ responses: [MainlineTestResponse]) {
        self.lock.withLock {
            self.queued = responses
            self.received = []
        }
    }

    func take(for request: URLRequest) -> MainlineTestResponse {
        self.lock.withLock {
            self.received.append(request)
            return self.queued.isEmpty
                ? .json(500, #"{"error":"unexpected_test_request"}"#)
                : self.queued.removeFirst()
        }
    }
}

private final class MainlineTestProtocol: URLProtocol, @unchecked Sendable {
    static let responses = MainlineTestResponses()

    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }

    override func startLoading() {
        let response = Self.responses.take(for: self.request)
        let http = HTTPURLResponse(
            url: self.request.url!,
            statusCode: response.status,
            httpVersion: nil,
            headerFields: ["Content-Type": "application/json"])!
        self.client?.urlProtocol(self, didReceive: http, cacheStoragePolicy: .notAllowed)
        self.client?.urlProtocol(self, didLoad: response.data)
        self.client?.urlProtocolDidFinishLoading(self)
    }

    override func stopLoading() {}
}
