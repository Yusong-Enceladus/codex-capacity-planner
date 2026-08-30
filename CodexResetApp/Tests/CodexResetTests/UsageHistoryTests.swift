import AppKit
import Foundation
import SwiftUI
import Testing
@testable import CodexReset

@Test func `history wire totals distinguish unknown price and known zero`() throws {
    let totals = #"""
    "inputTokens":100,"cachedTokens":40,"outputTokens":10,"reasoningTokens":5,
    "totalTokens":110,"estimatedCostUSD":null,"unpricedEvents":1,"eventCount":1
    """#
    let row = try JSONDecoder().decode(UsageHistoryDay.self, from: Data("""
    {"date":"2026-08-30","known":true,"partial":true,"models":[
    {"id":"unknown:standard","model":"unknown","mode":"standard",\(totals)}],\(totals)}
    """.utf8))
    #expect(row.known)
    #expect(row.totals.estimatedCostUSD == nil)
    #expect(row.totals.hasPartialCost)
    #expect(row.models.first?.totals.cachedTokens == 40)
    #expect(UsageHistoryMetric.tokens.value(row.totals) == 110)
    #expect(UsageHistoryMetric.cost.formatted(row.totals.estimatedCostUSD) == "—")
    #expect(UsageHistoryMetric.cost.formatted(0) == "$0.00")
}

@Test func `usage charts bind to account ids rather than row order or labels`() throws {
    let snapshot = ResetDemoFixtures.primarySnapshot(.english)
    let section = try #require(snapshot.submenuDetails.first { DetailMenuLayout.isUsage($0.title) })
    #expect(section.rows.compactMap(\.accountId) == ["demo-work", "demo-backup"])
    let history = UsageHistoryFixtures.snapshot(days: 90, language: .english)
    for row in section.rows.reversed() {
        let account = try #require(history.accounts.first { $0.id == row.accountId })
        #expect(account.days.count == 90)
        #expect(account.recordedDays > 0)
        #expect(account.days.contains { !$0.known })
        #expect(account.peak(.cost)?.totals.estimatedCostUSD != nil)
    }
    #expect(history.accounts[0].totals.totalTokens > history.accounts[1].totals.totalTokens)
}

@Test func `history date ranges follow Chinese and Pacific calendar days`() throws {
    let now = try #require(AlternatingDisplay.date(from: "2026-08-30T06:59:00Z"))
    let chinese = UsageHistoryFixtures.snapshot(days: 7, language: .simplifiedChinese, now: now)
    let english = UsageHistoryFixtures.snapshot(days: 7, language: .english, now: now)
    #expect(chinese.timeZone == "Asia/Shanghai")
    #expect(chinese.endDay == "2026-08-30")
    #expect(english.timeZone == "America/Los_Angeles")
    #expect(english.endDay == "2026-08-29")
    #expect(chinese.accounts[0].days.last?.partial == true)
    #expect(UsageHistoryFixtures.snapshot(days: 365, language: .english, now: now).accounts[0].days.count == 365)
}

private final class HistoryUnavailableProtocol: URLProtocol, @unchecked Sendable {
    override class func canInit(with request: URLRequest) -> Bool { true }
    override class func canonicalRequest(for request: URLRequest) -> URLRequest { request }
    override func startLoading() { self.client?.urlProtocol(self, didFailWithError: URLError(.notConnectedToInternet)) }
    override func stopLoading() {}
}

@MainActor @Test func `history preferences persist valid ranges while demo never changes real preferences`() async throws {
    let name = "UsageHistoryTests-\(UUID().uuidString)"
    let defaults = try #require(UserDefaults(suiteName: name))
    defer { defaults.removePersistentDomain(forName: name) }
    let config = URLSessionConfiguration.ephemeral
    config.protocolClasses = [HistoryUnavailableProtocol.self]
    let session = URLSession(configuration: config)
    defer { session.invalidateAndCancel() }
    let store = UsageHistoryStore(language: .english, defaults: defaults, session: session)
    #expect(store.days == 30)
    let update = store.selectDays(90)
    store.metric = .tokens
    #expect(defaults.integer(forKey: "usageHistoryDays") == 90)
    #expect(defaults.string(forKey: "usageHistoryMetric") == "tokens")
    store.selectDays(0)
    store.selectDays(366)
    #expect(store.days == 90)
    let restored = UsageHistoryStore(language: .english, defaults: defaults, session: session)
    #expect(restored.days == 90)
    #expect(restored.metric == .tokens)
    let demo = UsageHistoryStore(language: .english, isDemo: true, defaults: defaults, session: session)
    let demoUpdate = demo.selectDays(7)
    demo.metric = .cost
    #expect(defaults.integer(forKey: "usageHistoryDays") == 90)
    #expect(defaults.string(forKey: "usageHistoryMetric") == "tokens")
    await update?.value
    await demoUpdate?.value
    #expect(demo.snapshot?.days == 7)
    #expect(demo.snapshot?.accounts.count == 2)
}

@MainActor @Test func `two account usage menus have compact content sized bilingual layouts`() throws {
    for language in [ResetPresentationLanguage.simplifiedChinese, .english] {
        let snapshot = ResetDemoFixtures.primarySnapshot(language)
        let section = try #require(snapshot.submenuDetails.first { DetailMenuLayout.isUsage($0.title) })
        let store = UsageHistoryStore(language: language, isDemo: true)
        let root = ResetDetailsView(sections: [section], width: 480, usageHistory: store)
            .environment(\.resetPresentationLanguage, language).environment(\.locale, language.locale)
        let controller = NSHostingController(rootView: root)
        let size = controller.sizeThatFits(in: CGSize(width: MenuContentSizing.documentWidth(viewportWidth: 480), height: .greatestFiniteMagnitude))
        #expect(size.height > 500)
        #expect(size.height < 1000)
        #expect(size.width <= 480)
    }
}
