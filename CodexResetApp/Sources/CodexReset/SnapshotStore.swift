import Combine
import Foundation

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
            let base = UserDefaults.standard.string(forKey: "serviceURL") ?? "http://127.0.0.1:18765"
            guard let url = URL(string: base.trimmingCharacters(in: .whitespacesAndNewlines) + "/api/snapshot") else {
                throw SnapshotError.invalidServiceURL
            }
            var request = URLRequest(url: url)
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
                ? "本机服务暂时不可用。请确认 Codex Capacity Planner Monitor 正在运行。"
                : "本机服务暂时不可用，当前保留上一次可靠结果。"
        }
    }
}

private enum SnapshotError: Error {
    case invalidServiceURL
    case serviceUnavailable
}

extension Double {
    fileprivate var nonzero: Double? {
        self > 0 ? self : nil
    }
}
