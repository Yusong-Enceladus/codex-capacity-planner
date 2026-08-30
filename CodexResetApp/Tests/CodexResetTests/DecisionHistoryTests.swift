import Foundation
import Testing
@testable import CodexReset

@Test func `decision history round trips through the actual snapshot schema`() throws {
    let original = ResetDemoFixtures.primarySnapshot(.simplifiedChinese)
    let decoded = try JSONDecoder().decode(ResetSnapshot.self, from: JSONEncoder().encode(original))
    let history = try #require(decoded.decisionHistory)
    #expect(history.records.count == 8)
    #expect(history.records[2].source.p24 == nil)
    #expect(history.records[2].source.status == "fetch-failed")
    let impact = try #require(history.latestPublicChange?.impact)
    #expect(impact.method == "same-time-public-inputs")
    #expect(impact.before.map(\.usedPercent) == impact.after.map(\.usedPercent))
    #expect(impact.before.map(\.targetAt) == impact.after.map(\.targetAt))
    #expect(impact.changed)
    #expect(history.records.last?.accounts.first?.targetPercent == decoded.decisionProgress?.targetPercent)
    #expect(decoded.decisionContext?.accounts.first?.usedPercent == decoded.decisionProgress?.currentPercent)
    #expect(history.latestRecord(for: "demo-hint")?.trigger == "public-update")
    #expect(history.latestRecord(for: "demo-reset-a")?.trigger == "account-reset")
    #expect(history.latestRecord(for: "unknown") == nil)
}

@Test func `calendar groups receipts without multiplying the public event`() throws {
    let one = ResetHistoryEvent(id: "one", eventId: "same-public-event", accountId: "work", accountLabel: "Work",
        at: "2026-08-30T01:00:00Z", kind: "global-manual", evidence: "rebuilt", publishedAt: nil)
    let two = ResetHistoryEvent(id: "two", eventId: "same-public-event", accountId: "backup", accountLabel: "Backup",
        at: "2026-08-30T01:20:00Z", kind: "global-manual", evidence: "rebuilt", publishedAt: nil)
    #expect(HistoryPresentation.eventCount([one, two]) == 1)
    let date = try #require(HistoryPresentation.date("2026-08-30T00:00:00Z"))
    #expect(HistoryPresentation.events([one, two], on: date, language: .simplifiedChinese).count == 2)
    let month = HistoryPresentation.monthDays(containing: date, language: .simplifiedChinese)
    #expect(month.count == 42)
    #expect(month.compactMap { $0 }.count == 31)
    let leap = try #require(HistoryPresentation.date("2028-02-15T00:00:00Z"))
    #expect(HistoryPresentation.monthDays(containing: leap, language: .english).compactMap { $0 }.count == 29)
}

@Test func `calendar uses the display timezone rather than the computer timezone`() throws {
    let event = ResetHistoryEvent(id: "boundary", eventId: nil, accountId: "work", accountLabel: "Work",
        at: "2026-08-30T01:00:00Z", kind: "automatic", evidence: "natural", publishedAt: nil)
    #expect(HistoryPresentation.time(event.at, language: .simplifiedChinese) == "08-30 09:00 UTC+8")
    #expect(HistoryPresentation.time(event.at, language: .english) == "08-29 18:00 PT")
    let winter = "2026-12-30T01:00:00Z"
    #expect(HistoryPresentation.time(winter, language: .english) == "12-29 17:00 PT")
    let selected = try #require(HistoryPresentation.date("2026-08-30T12:00:00Z"))
    #expect(HistoryPresentation.events([event], on: selected, language: .simplifiedChinese).count == 1)
    #expect(HistoryPresentation.events([event], on: selected, language: .english).isEmpty)
}

@Test func `new inspection views retain distinct probability weight and target semantics`() throws {
    let snapshot = ResetDemoFixtures.primarySnapshot(.english)
    let record = try #require(snapshot.decisionHistory?.records.last)
    #expect(record.source.p24 == 30)
    #expect(record.source.p48 == 50)
    #expect(record.accounts.first?.signalWeight == 50)
    #expect(record.accounts.first?.targetPercent == 68)
    #expect(record.accounts.first?.explanation(.english).contains("hint") == true)
    #expect(record.accounts.first?.explanation(.simplifiedChinese).contains("暗示") == true)
    #expect(snapshot.submenuDetails.first(where: { $0.title == "Resets" })?.visualizations?.contains(where: { $0.kind == "resetCalendar" }) == true)
    #expect(snapshot.submenuDetails.first(where: { $0.title == "Resets" })?.visualizations?.first?.items.first?.eventId == "demo-hint")
    #expect(snapshot.submenuDetails.map(\.title) == ["Suggested Mainlines", "Usage & Targets", "Resets", "Why This Plan", "Calculation & Data"])
}

@Test func `a missing probability and an unknown timestamp are never printed as zero`() {
    #expect(HistoryPresentation.percent(nil) == "—")
    #expect(HistoryPresentation.time(nil, language: .english) == "Time unknown")
    #expect(HistoryPresentation.time("invalid", language: .simplifiedChinese) == "时间未知")
    #expect(HistoryPresentation.kind("public-announcement", language: .english).contains("Not a personal receipt"))
}
