import Foundation

/// Synthetic history only; native README/QA menus never read personal logs.
enum UsageHistoryFixtures {
    static func snapshot(days: Int, language: ResetPresentationLanguage, now: Date = Date()) -> UsageHistorySnapshot {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = language.timeZone
        let formatter = DateFormatter()
        formatter.calendar = calendar
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = language.timeZone
        formatter.dateFormat = "yyyy-MM-dd"
        let dates = (0..<days).map {
            calendar.date(byAdding: .day, value: $0 - days + 1, to: now)!
        }
        func account(_ id: String, scale: Double) -> UsageHistoryAccount {
            let empty = ProcessInfo.processInfo.environment["CODEX_RESET_DEMO_USAGE"] == "empty"
            let daily = dates.enumerated().map { index, date in
                let age = days - index - 1
                let known = !empty && age < 45
                let active = known && (age + Int(scale * 10)) % 7 != 3
                let tokens = active ? Int(Double(130_000 + ((age * 71 + 23) % 17) * 43_000) * scale) : 0
                let input = tokens * 4 / 5
                let output = tokens - input
                let cached = input * 3 / 4
                let fast = age % 5 == 0
                let cost = known ? (Double(input - cached) * 5 + Double(cached) * 0.5 + Double(output) * 30) / 1_000_000 * (fast ? 2 : 1) : nil
                let totals = UsageHistoryTotals(inputTokens: input, cachedTokens: cached, outputTokens: output,
                    reasoningTokens: output / 2, totalTokens: tokens, estimatedCostUSD: cost, eventCount: active ? 4 : 0)
                let model = UsageHistoryBreakdown(id: "gpt-5.6-sol:\(fast ? "fast" : "standard")", model: "gpt-5.6-sol",
                    mode: fast ? "fast" : "standard", totals: totals)
                return UsageHistoryDay(date: formatter.string(from: date), known: known, partial: age == 0,
                    models: active ? [model] : [], totals: totals)
            }
            var totals = UsageHistoryTotals()
            for day in daily {
                totals.inputTokens += day.totals.inputTokens
                totals.cachedTokens += day.totals.cachedTokens
                totals.outputTokens += day.totals.outputTokens
                totals.reasoningTokens += day.totals.reasoningTokens
                totals.totalTokens += day.totals.totalTokens
                totals.eventCount += day.totals.eventCount
                if let cost = day.totals.estimatedCostUSD { totals.estimatedCostUSD = (totals.estimatedCostUSD ?? 0) + cost }
            }
            let projects = [UsageHistoryBreakdown(id: "demo-project-\(id)",
                label: language.text(id == "demo-work" ? "搜索体验" : "数据分析", id == "demo-work" ? "Search Experience" : "Data Analysis"), totals: totals)]
            let sessions = daily.filter { $0.totals.eventCount > 0 }.map {
                UsageHistoryBreakdown(id: "demo-task-\(id)-\($0.date)", label: language.text("质量改进 · \($0.date)", "Quality improvements · \($0.date)"), totals: $0.totals)
            }
            return UsageHistoryAccount(id: id, days: daily, projects: projects, sessions: sessions,
                coverage: empty ? "unavailable" : days > 45 ? "partial" : "local",
                recordedDays: daily.filter { $0.totals.eventCount > 0 }.count, totals: totals)
        }
        let emptyUnassigned = UsageHistoryAccount(id: "unassigned", days: [], projects: [], sessions: [],
            coverage: "unavailable", recordedDays: 0, totals: UsageHistoryTotals())
        let unassigned = ProcessInfo.processInfo.environment["CODEX_RESET_DEMO_USAGE"] == "unassigned"
            ? account("unassigned", scale: 0.35) : emptyUnassigned
        return UsageHistorySnapshot(version: 1, days: days, timeZone: language.timeZone.identifier,
            startDay: formatter.string(from: dates.first!), endDay: formatter.string(from: dates.last!),
            updatedAt: ISO8601DateFormatter().string(from: now), collectorStatus: "ready", sourceComplete: true,
            skippedEvents: 0, pricingSource: "codexbar-bundled",
            accounts: [account("demo-work", scale: 1), account("demo-backup", scale: 0.57)], unassigned: unassigned)
    }
}
