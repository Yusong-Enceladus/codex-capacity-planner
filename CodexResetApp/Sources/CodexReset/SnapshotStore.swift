import Combine
import Foundation

enum LocalMonitorEndpoint {
    static let host = "127.0.0.1"
    static let port = 18_765
    static let baseURL = URL(string: "http://\(host):\(port)")!
    static let runtimeURL = baseURL.appendingPathComponent("api/runtime")
    static let snapshotURL = baseURL.appendingPathComponent("api/snapshot")
    static let configURL = baseURL.appendingPathComponent("api/config")
    static let mainlineActionURL = baseURL.appendingPathComponent("api/mainline-action")
}

@MainActor
final class SnapshotStore: ObservableObject {
    @Published private(set) var snapshot: ResetSnapshot?
    @Published private(set) var errorMessage: String?
    @Published private(set) var isRefreshing = false
    @Published private(set) var fetchedAt: Date?

    private var timer: AnyCancellable?
    private let session: URLSession

    init(session: URLSession = .shared, snapshot: ResetSnapshot? = nil) {
        self.session = session
        self.snapshot = snapshot
        self.fetchedAt = snapshot == nil ? nil : Date()
    }

    func setStartupError(_ message: String) {
        guard self.snapshot == nil else { return }
        self.errorMessage = message
    }

    func start() {
        guard self.timer == nil else { return }
        Task { await self.refresh() }
        self.reschedule()
    }

    func reschedule() {
        self.timer?.cancel()
        let seconds = max(30, UserDefaults.standard.double(forKey: "refreshInterval").nonzero ?? 60)
        self.timer = Timer.publish(every: seconds, on: .main, in: .common)
            .autoconnect()
            .sink { [weak self] _ in
                Task { await self?.refresh() }
            }
    }

    func refresh() async {
        guard !self.isRefreshing else { return }
        self.isRefreshing = true
        defer { isRefreshing = false }
        do {
            var request = URLRequest(url: LocalMonitorEndpoint.snapshotURL)
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            request.timeoutInterval = 10
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            let (data, response) = try await session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw SnapshotError.serviceUnavailable
            }
            self.snapshot = try JSONDecoder().decode(ResetSnapshot.self, from: data)
            self.fetchedAt = Date()
            self.errorMessage = nil
        } catch {
            self.errorMessage = self.snapshot == nil
                ? "本机组件暂时不可用，Codex Capacity Planner 会自动重试。"
                : "本机组件暂时不可用，当前保留上一次可靠结果。"
        }
    }

    func perform(_ action: DetailAction) async {
        do {
            var configRequest = URLRequest(url: LocalMonitorEndpoint.configURL)
            configRequest.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            configRequest.timeoutInterval = 5
            configRequest.setValue("application/json", forHTTPHeaderField: "Accept")
            let (configData, configResponse) = try await self.session.data(for: configRequest)
            guard let configHTTP = configResponse as? HTTPURLResponse,
                  configHTTP.statusCode == 200
            else { throw SnapshotError.serviceUnavailable }
            let config = try JSONDecoder().decode(LocalServiceConfig.self, from: configData)
            guard !config.capabilityToken.isEmpty else { throw SnapshotError.localActionUnavailable }

            var request = URLRequest(url: LocalMonitorEndpoint.mainlineActionURL)
            request.httpMethod = "POST"
            request.timeoutInterval = 8
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue("application/json", forHTTPHeaderField: "Accept")
            request.setValue(LocalMonitorEndpoint.baseURL.absoluteString, forHTTPHeaderField: "Origin")
            request.setValue(config.capabilityToken, forHTTPHeaderField: "X-Codex-Reset-Token")
            request.httpBody = try JSONEncoder().encode(MainlineActionRequest(
                action: action.operation,
                targetId: action.targetId))
            let (_, response) = try await self.session.data(for: request)
            guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                throw SnapshotError.actionRejected
            }
            self.errorMessage = nil
            await self.refresh()
        } catch {
            self.errorMessage = "主线纠偏未能保存；本机组件恢复后可重试。"
        }
    }
}

private enum SnapshotError: Error {
    case serviceUnavailable
    case localActionUnavailable
    case actionRejected
}

private struct LocalServiceConfig: Decodable {
    let capabilityToken: String
}

private struct MainlineActionRequest: Encodable {
    let action: String
    let targetId: String
}

extension Double {
    fileprivate var nonzero: Double? {
        self > 0 ? self : nil
    }
}
