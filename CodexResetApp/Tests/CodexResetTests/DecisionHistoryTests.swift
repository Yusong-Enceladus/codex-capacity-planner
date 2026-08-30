import Foundation
import SwiftUI
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
@MainActor
@Test func shortExplanationMenusFitTheirContent() throws {
    for language in [ResetPresentationLanguage.simplifiedChinese, .english] {
        let snapshot = ResetDemoFixtures.primarySnapshot(language)
        let section = try #require(snapshot.submenuDetails.first {
            ["为什么这样建议", "Why This Plan"].contains($0.title)
        })
        let root = ResetDetailsView(sections: [section], width: 380, history: nil,
                                    decisionContext: snapshot.decisionContext)
            .environment(\.resetPresentationLanguage, language)
            .environment(\.locale, language.locale)
        let measurement = NSHostingController(rootView: root)
        let naturalHeight = ceil(measurement.sizeThatFits(in: CGSize(
            width: MenuContentSizing.documentWidth(viewportWidth: 380), height: .greatestFiniteMagnitude)).height)
        let hosting = MenuContentSizing.scrollHostingView(root: root, width: 380, maximumHeight: 700)
        #expect(naturalHeight > 100)
        #expect(naturalHeight < 420)
        #expect(hosting.frame.height == naturalHeight)
    }
}

@MainActor
@Test func longMenuContentScrollsWithinAvailableHeight() {
    let root = VStack(spacing: 0) {
        ForEach(0..<30) { index in Text("Row \(index)").frame(height: 24) }
    }
    let hosting = MenuContentSizing.scrollHostingView(root: root, width: 380, maximumHeight: 240)
    #expect(hosting.frame.height == 240)
    #expect(hosting.intrinsicContentSize.height == 240)
    #expect(MenuContentSizing.viewportHeight(contentHeight: 176.2, maximumHeight: 700) == 177)
    #expect(MenuContentSizing.viewportHeight(contentHeight: 800, maximumHeight: 321.7) == 321)
}

@MainActor
@Test func calculationSummaryHasReadableBilingualHeight() throws {
    for language in [ResetPresentationLanguage.simplifiedChinese, .english] {
        let snapshot = ResetDemoFixtures.primarySnapshot(language)
        let section = try #require(snapshot.submenuDetails.first { DetailMenuLayout.isCalculation($0.title) })
        let root = ResetDetailsView(sections: [section], width: 480, history: snapshot.decisionHistory)
            .environment(\.resetPresentationLanguage, language)
            .environment(\.locale, language.locale)
        let measurement = NSHostingController(rootView: root)
        let height = ceil(measurement.sizeThatFits(in: CGSize(
            width: MenuContentSizing.documentWidth(viewportWidth: 480), height: .greatestFiniteMagnitude)).height)
        #expect(height > 350)
        #expect(height < 760)
        let hosting = MenuContentSizing.scrollHostingView(root: root, width: 480, maximumHeight: 800)
        #expect(hosting.frame.height == height)
    }
}

@Test func historyPlotSelectionUsesObservationTime() throws {
    let records = try #require(ResetDemoFixtures.primarySnapshot(.english).decisionHistory?.records)
    let sparse = [records[0], records[1], records[7]]
    #expect(HistoryPresentation.recordID(atFraction: 0.2, in: sparse) == records[1].id)
    #expect(HistoryPresentation.recordID(atFraction: 0.6, in: sparse) == records[7].id)
    #expect(HistoryPresentation.recordID(atFraction: 2.0 / 7, in: records) == records[2].id)
    #expect(records[2].source.p24 == nil)
    #expect(HistoryPresentation.recordID(atFraction: -1, in: records) == records[0].id)
    #expect(HistoryPresentation.recordID(atFraction: 2, in: records) == records[7].id)
    #expect(HistoryPresentation.recordID(atFraction: .nan, in: records) == nil)
    #expect(HistoryPresentation.recordID(atFraction: 0.5, in: []) == nil)
    #expect(HistoryPresentation.recordID(atFraction: 0.5, in: [records[0]]) == records[0].id)
}

@MainActor
@Test func detailContentFitsScrollbarWidth() throws {
    let snapshot = ResetDemoFixtures.primarySnapshot(.english)
    let section = try #require(snapshot.submenuDetails.first { DetailMenuLayout.isCalculation($0.title) })
    let root = ResetDetailsView(sections: [section], width: 480, history: snapshot.decisionHistory)
        .environment(\.resetPresentationLanguage, ResetPresentationLanguage.english)
    let hosting = FixedHeightHostingView(rootView: root)
    let height = hosting.measuredFittingHeight(width: 465)
    #expect(height > 0)
    #expect(hosting.fittingSize.width <= 465)
}

@MainActor
@Test func interactiveMenusMeasureWrappedLinesAtTheirDocumentWidth() {
    let root = VStack(alignment: .leading, spacing: 8) {
        Text("A possible reset window has opened; keep this full explanation visible at the menu's actual width.")
        Text("The next natural reset remains separate from an unconfirmed public hint.")
    }.font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
    let narrow = MenuContentSizing.scrollHostingView(root: root, width: 200, maximumHeight: 700)
    let wide = MenuContentSizing.scrollHostingView(root: root, width: 480, maximumHeight: 700)
    #expect(narrow.frame.height > wide.frame.height)
    let measurement = NSHostingController(rootView: root)
    let required = measurement.sizeThatFits(in: CGSize(
        width: MenuContentSizing.documentWidth(viewportWidth: 200), height: .greatestFiniteMagnitude)).height
    #expect(narrow.frame.height >= required)
    #expect(narrow.frame.height < required + 1)
}

@MainActor
@Test func calendarSizingIncludesTheInitiallySelectedDaysRecords() {
    let events = (0..<3).map { index in
        ResetHistoryEvent(id: "receipt-\(index)", eventId: "shared-event", accountId: "account-\(index)",
            accountLabel: "Demo account \(index)", at: "2024-01-12T12:00:00Z", kind: "global-manual",
            evidence: "rebuilt", publishedAt: nil)
    }
    for language in [ResetPresentationLanguage.simplifiedChinese, .english] {
        let populated = ResetHistoryCalendar(events: events).environment(\.resetPresentationLanguage, language)
        let empty = ResetHistoryCalendar(events: []).environment(\.resetPresentationLanguage, language)
        let populatedHost = MenuContentSizing.scrollHostingView(root: populated, width: 380, maximumHeight: 1000)
        let emptyHost = MenuContentSizing.scrollHostingView(root: empty, width: 380, maximumHeight: 1000)
        #expect(populatedHost.frame.height > emptyHost.frame.height + 100)
    }
}

@Test func compactComparisonPreservesDifferentDeadlines() throws {
    let history = try #require(ResetDemoFixtures.primarySnapshot(.english).decisionHistory)
    let impact = try #require(history.latestPublicChange?.impact)
    let before = try #require(impact.before.first)
    let after = try #require(impact.after.first)
    #expect(HistoryPresentation.impactSummary(before: before, after: after, language: .english).contains("→"))
    var object = try #require(JSONSerialization.jsonObject(with: JSONEncoder().encode(after)) as? [String: Any])
    object["targetAt"] = "2030-01-01T00:00:00Z"
    let changed = try JSONDecoder().decode(DecisionAccount.self, from: JSONSerialization.data(withJSONObject: object))
    #expect(HistoryPresentation.impactSummary(before: before, after: changed, language: .english) == "Deadline changed; expand to compare")
    object.removeValue(forKey: "targetAt")
    let unknown = try JSONDecoder().decode(DecisionAccount.self, from: JSONSerialization.data(withJSONObject: object))
    #expect(!HistoryPresentation.impactSummary(before: before, after: unknown, language: .simplifiedChinese).contains("→"))
}
