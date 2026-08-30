import Foundation

struct DecisionHistory: Codable, Equatable, Sendable {
    let version: Int
    let startedAt: String?
    let sequence: Int
    let discardedCount: Int
    let lastCheckedAt: String?
    let lastError: String?
    let records: [DecisionRecord]

    var latestPublicChange: DecisionRecord? { self.records.last { $0.impact != nil } }

    func latestRecord(for eventID: String) -> DecisionRecord? {
        self.records.last { $0.relatedEventIds?.contains(eventID) == true }
    }
}

struct DecisionContext: Codable, Equatable, Sendable {
    let at: String
    let accounts: [DecisionAccount]
    let actions: DecisionActions
}

struct DecisionRecord: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let at: String
    let trigger: String
    let sourceUpdatedAt: String?
    let source: DecisionSource
    let evidence: [DecisionEvidence]
    let accounts: [DecisionAccount]
    let actions: DecisionActions
    let impact: DecisionImpact?
    let relatedEventIds: [String]?
}

struct DecisionSource: Codable, Equatable, Sendable {
    let host: String
    let status: String
    let modelVersion: String?
    let p24: Double?
    let p48: Double?
    var cachedP24: Double? = nil
    var cachedP48: Double? = nil
    var baseDailyRate: Double? = nil
}

struct DecisionAccount: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let label: String
    let active: Bool
    let cycleGeneration: Int
    let usedPercent: Double?
    let targetPercent: Double?
    let targetAt: String?
    let naturalResetAt: String?
    let usageAt: String?
    let fresh: Bool
    let projectedLower: Double?
    let projectedUpper: Double?
    let signalId: String?
    let signalLevel: String
    let signalWeight: Double?
    let mode: String
    let reason: String
    let reasonChinese: String
    let reasonEnglish: String
    let deliveredEventId: String?
    let deliveredAt: String?
    var calculation: [String: Double]? = nil
    var cyclePhase: String? = nil
    var trend: String? = nil

    func explanation(_ language: ResetPresentationLanguage) -> String {
        language.text(self.reasonChinese, self.reasonEnglish)
    }
}

struct DecisionActions: Codable, Equatable, Sendable {
    let work: String
    let credit: String
    let availableCredits: Int
    let account: String
    let creditReason: String
    let creditWindowStartAt: String?
    let creditWindowEndAt: String?
    let possibleResetEndAt: String?
}

struct DecisionEvidence: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let url: String
    let source: String
    let publishedAt: String?
    let firstReceivedAt: String?
    let summary: String
    let summaryChinese: String
    let level: String
    let disposition: String
    let sourceState: String?
    let timingKind: String?
    let targetAt: String?
    let windowStartAt: String?
    let weight: Double?
    var signalTier: String? = nil
    var alertEventId: String? = nil
    var sourceWindowStartAt: String? = nil

    func synopsis(_ language: ResetPresentationLanguage) -> String {
        language == .simplifiedChinese && !self.summaryChinese.isEmpty ? self.summaryChinese : self.summary
    }
}

struct DecisionImpact: Codable, Equatable, Sendable {
    let method: String
    let at: String
    let changed: Bool
    let before: [DecisionAccount]
    let after: [DecisionAccount]
    let beforeActions: DecisionActions
    let afterActions: DecisionActions
}

struct ResetHistoryEvent: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let eventId: String?
    let accountId: String?
    let accountLabel: String?
    let at: String
    let kind: String
    let evidence: String
    let publishedAt: String?
    var expiresAt: String? = nil
    var summaryChinese: String? = nil
    var summaryEnglish: String? = nil
}

enum HistoryPresentation {
    static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return fractional.date(from: value) ?? ISO8601DateFormatter().date(from: value)
    }

    static func recordID(atFraction fraction: Double, in records: [DecisionRecord]) -> String? {
        guard fraction.isFinite else { return nil }
        let samples = records.compactMap { record in
            self.date(record.at).map { (id: record.id, date: $0) }
        }
        guard let first = samples.first, let last = samples.last else { return nil }
        let target = first.date.addingTimeInterval(
            max(0, last.date.timeIntervalSince(first.date)) * min(1, max(0, fraction)))
        return samples.min {
            abs($0.date.timeIntervalSince(target)) < abs($1.date.timeIntervalSince(target))
        }?.id
    }

    static func impactSummary(
        before: DecisionAccount, after: DecisionAccount, language: ResetPresentationLanguage
    ) -> String {
        guard let beforeTime = self.date(before.targetAt),
              let afterTime = self.date(after.targetAt) else {
            return language.text("展开核对目标与截止时间", "Expand to inspect targets and deadlines")
        }
        guard beforeTime == afterTime else {
            return language.text("截止时间有变化，展开对照", "Deadline changed; expand to compare")
        }
        return language.text("同截止点目标 ", "Target at the same deadline ")
            + self.percent(before.targetPercent) + " → " + self.percent(after.targetPercent)
    }

    static func time(_ value: String?, language: ResetPresentationLanguage) -> String {
        guard let date = self.date(value) else { return language.text("时间未知", "Time unknown") }
        return self.time(date, language: language)
    }

    static func time(_ date: Date, language: ResetPresentationLanguage, dayOnly: Bool = false) -> String {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.timeZone = language.timeZone
        formatter.dateFormat = dayOnly ? "yyyy-MM-dd" : "MM-dd HH:mm"
        return formatter.string(from: date) + " " + language.timeZoneLabel
    }

    static func percent(_ value: Double?) -> String {
        value.map { String(format: "%.1f%%", $0) } ?? "—"
    }

    static func calendar(_ language: ResetPresentationLanguage) -> Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = language.timeZone
        calendar.locale = language.locale
        calendar.firstWeekday = language == .simplifiedChinese ? 2 : 1
        return calendar
    }

    static func monthDays(containing date: Date, language: ResetPresentationLanguage) -> [Date?] {
        let calendar = self.calendar(language)
        guard let month = calendar.dateInterval(of: .month, for: date),
              let days = calendar.range(of: .day, in: .month, for: date) else { return [] }
        let offset = (calendar.component(.weekday, from: month.start) - calendar.firstWeekday + 7) % 7
        return (0..<42).map { index in
            let day = index - offset
            return day >= 0 && day < days.count ? calendar.date(byAdding: .day, value: day, to: month.start) : nil
        }
    }

    static func events(_ events: [ResetHistoryEvent], on date: Date, language: ResetPresentationLanguage) -> [ResetHistoryEvent] {
        let calendar = self.calendar(language)
        return events.filter { self.date($0.at).map { calendar.isDate($0, inSameDayAs: date) } ?? false }
            .sorted { $0.at < $1.at }
    }

    static func eventCount(_ events: [ResetHistoryEvent]) -> Int {
        Set(events.map { $0.eventId ?? $0.id }).count
    }

    static func kind(_ value: String, language: ResetPresentationLanguage) -> String {
        switch value {
        case "automatic": language.text("自然刷新", "Natural reset")
        case "banked-redeem": language.text("使用重置券", "Credit redeemed")
        case "upgrade": language.text("升级后刷新", "Plan upgrade reset")
        case "global-manual": language.text("额外刷新已到账", "Extra reset received")
        case "credit-grant": language.text("重置券到账", "Credit received")
        case "public-announcement": language.text("公开消息 · 非个人到账证明", "Public announcement · Not a personal receipt")
        default: language.text("本机刷新记录", "Local reset record")
        }
    }

    static func credit(_ actions: DecisionActions, language: ResetPresentationLanguage) -> String {
        if actions.availableCredits == 0 { return language.text("当前没有可用重置券。", "No reset credits are currently available.") }
        if actions.credit == "redeem" { return language.text("现有额度已耗尽且满足用券条件，建议使用重置券。", "Existing capacity is exhausted and redemption conditions are met; a credit is recommended.") }
        switch actions.creditReason {
        case "possible-reset-first": return language.text("可能先有免费刷新；这张券仍可等待，暂时保留。", "A free reset may come first and this credit can wait; keep it for now.")
        case "must-form-node": return language.text("券到期前需要安排真实工作，形成值得使用它的时机。", "Arrange real work before expiry so the credit has a worthwhile use.")
        default: return language.text("先使用现有可用额度；暂时保留重置券。", "Use existing available capacity first; keep reset credits for now.")
        }
    }
}
