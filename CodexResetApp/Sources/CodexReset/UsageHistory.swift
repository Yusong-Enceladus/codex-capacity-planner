import Combine
import Foundation

enum UsageHistoryMetric: String, CaseIterable, Sendable {
    case cost, tokens

    func value(_ totals: UsageHistoryTotals) -> Double? {
        self == .cost ? totals.estimatedCostUSD : Double(totals.totalTokens)
    }

    func formatted(_ value: Double?) -> String {
        guard let value, value.isFinite else { return "—" }
        if self == .cost { return String(format: "$%.2f", value) }
        if value >= 1_000_000 { return String(format: "%.1fM", value / 1_000_000) }
        if value >= 1_000 { return String(format: "%.1fK", value / 1_000) }
        return String(format: "%.0f", value)
    }
}

struct UsageHistoryTotals: Decodable, Equatable, Sendable {
    var inputTokens = 0
    var cachedTokens = 0
    var outputTokens = 0
    var reasoningTokens = 0
    var totalTokens = 0
    var estimatedCostUSD: Double? = nil
    var unpricedEvents = 0
    var eventCount = 0

    var hasPartialCost: Bool { self.unpricedEvents > 0 }
}

struct UsageHistoryBreakdown: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    var label: String? = nil
    var model: String? = nil
    var mode: String? = nil
    let totals: UsageHistoryTotals

    private enum CodingKeys: String, CodingKey { case id, label, model, mode }
}

extension UsageHistoryBreakdown {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.label = try container.decodeIfPresent(String.self, forKey: .label)
        self.model = try container.decodeIfPresent(String.self, forKey: .model)
        self.mode = try container.decodeIfPresent(String.self, forKey: .mode)
        self.totals = try UsageHistoryTotals(from: decoder)
    }
}

struct UsageHistoryDay: Decodable, Equatable, Identifiable, Sendable {
    let date: String
    let known: Bool
    let partial: Bool
    let models: [UsageHistoryBreakdown]
    let totals: UsageHistoryTotals
    var id: String { self.date }
    private enum CodingKeys: String, CodingKey { case date, known, partial, models }
}

extension UsageHistoryDay {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.date = try container.decode(String.self, forKey: .date)
        self.known = try container.decode(Bool.self, forKey: .known)
        self.partial = try container.decode(Bool.self, forKey: .partial)
        self.models = try container.decode([UsageHistoryBreakdown].self, forKey: .models)
        self.totals = try UsageHistoryTotals(from: decoder)
    }
}

struct UsageHistoryAccount: Decodable, Equatable, Identifiable, Sendable {
    let id: String
    let days: [UsageHistoryDay]
    let projects: [UsageHistoryBreakdown]
    let sessions: [UsageHistoryBreakdown]
    let coverage: String
    let recordedDays: Int
    let totals: UsageHistoryTotals
    private enum CodingKeys: String, CodingKey { case id, days, projects, sessions, coverage, recordedDays }
}

extension UsageHistoryAccount {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        self.id = try container.decode(String.self, forKey: .id)
        self.days = try container.decode([UsageHistoryDay].self, forKey: .days)
        self.projects = try container.decode([UsageHistoryBreakdown].self, forKey: .projects)
        self.sessions = try container.decode([UsageHistoryBreakdown].self, forKey: .sessions)
        self.coverage = try container.decode(String.self, forKey: .coverage)
        self.recordedDays = try container.decode(Int.self, forKey: .recordedDays)
        self.totals = try UsageHistoryTotals(from: decoder)
    }

    func peak(_ metric: UsageHistoryMetric) -> UsageHistoryDay? {
        self.days.filter { $0.known && metric.value($0.totals) != nil }
            .max { (metric.value($0.totals) ?? 0) < (metric.value($1.totals) ?? 0) }
    }
}

struct UsageHistorySnapshot: Decodable, Equatable, Sendable {
    let version: Int
    let days: Int
    let timeZone: String
    let startDay: String
    let endDay: String
    let updatedAt: String?
    let collectorStatus: String
    let sourceComplete: Bool
    let skippedEvents: Int
    let pricingSource: String
    let accounts: [UsageHistoryAccount]
    let unassigned: UsageHistoryAccount
    var completedFiles: Int? = nil
    var totalFiles: Int? = nil
    var processedBytes: Int64? = nil
    var totalBytes: Int64? = nil

    var indexingFraction: Double? {
        guard let processedBytes, let totalBytes, totalBytes > 0 else { return nil }
        return min(1, max(0, Double(processedBytes) / Double(totalBytes)))
    }
}

@MainActor
final class UsageHistoryStore: ObservableObject {
    @Published private(set) var snapshot: UsageHistorySnapshot?
    @Published private(set) var days: Int
    @Published var metric: UsageHistoryMetric {
        didSet { if !self.isDemo { self.defaults.set(self.metric.rawValue, forKey: "usageHistoryMetric") } }
    }
    @Published private(set) var isLoading = false
    @Published private(set) var failed = false

    private let language: ResetPresentationLanguage
    private let isDemo: Bool
    private let defaults: UserDefaults
    private let session: URLSession
    private var generation = 0
    private var fetchedAt: Date?
    private var cache: [Int: UsageHistorySnapshot] = [:]

    init(language: ResetPresentationLanguage, isDemo: Bool = false,
         defaults: UserDefaults = .standard, session: URLSession = .shared) {
        self.language = language
        self.isDemo = isDemo
        self.defaults = defaults
        self.session = session
        let saved = defaults.integer(forKey: "usageHistoryDays")
        self.days = isDemo ? 30 : (1...365).contains(saved) ? saved : 30
        self.metric = isDemo ? .cost : UsageHistoryMetric(rawValue: defaults.string(forKey: "usageHistoryMetric") ?? "") ?? .cost
        if isDemo { self.snapshot = UsageHistoryFixtures.snapshot(days: self.days, language: language) }
    }

    @discardableResult
    func selectDays(_ value: Int) -> Task<Void, Never>? {
        guard (1...365).contains(value), value != self.days else { return nil }
        self.days = value
        if !self.isDemo { self.defaults.set(value, forKey: "usageHistoryDays") }
        self.snapshot = self.cache[value]
        return Task { await self.refresh(force: true) }
    }

    func refreshWhileVisible() async {
        while !Task.isCancelled {
            await self.refresh(force: self.snapshot?.sourceComplete == false)
            if self.isDemo { return }
            do {
                try await Task.sleep(for: .seconds(self.snapshot?.sourceComplete == false ? 5 : 30))
            } catch { return }
        }
    }

    func refresh(force: Bool = false) async {
        if self.isDemo {
            self.snapshot = UsageHistoryFixtures.snapshot(days: self.days, language: self.language)
            return
        }
        if !force, self.isLoading { return }
        if !force, let fetchedAt, Date().timeIntervalSince(fetchedAt) < 30 { return }
        self.generation += 1
        let generation = self.generation
        let days = self.days
        self.isLoading = true
        defer { if generation == self.generation { self.isLoading = false } }
        do {
            var components = URLComponents(url: LocalMonitorEndpoint.baseURL.appendingPathComponent("api/usage-history"), resolvingAgainstBaseURL: false)!
            components.queryItems = [URLQueryItem(name: "days", value: String(days)),
                                    URLQueryItem(name: "tz", value: self.language.timeZone.identifier)]
            var request = URLRequest(url: components.url!)
            request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
            request.timeoutInterval = 22
            let (data, response) = try await self.session.data(for: request)
            guard let response = response as? HTTPURLResponse, response.statusCode == 200 else {
                throw URLError(.badServerResponse)
            }
            let snapshot = try JSONDecoder().decode(UsageHistorySnapshot.self, from: data)
            guard snapshot.version == 2, snapshot.days == days, snapshot.timeZone == self.language.timeZone.identifier else {
                throw URLError(.cannotParseResponse)
            }
            self.cache[days] = snapshot
            guard generation == self.generation else { return }
            self.snapshot = snapshot
            self.fetchedAt = Date()
            self.failed = false
        } catch {
            guard generation == self.generation else { return }
            self.failed = true
        }
    }
}
