import Foundation
import SwiftUI
import Testing
@testable import CodexReset

@Test func `decodes complete snapshot`() throws {
    let data = Data(#"""
    {
      "updatedAt":"2026-08-21T14:00:00.000Z",
      "dataConfidence":"estimated",
      "decisionProgress":{
        "title":"连续目标",
        "alternateTitle":"未来 24 小时",
        "currentPercent":11,
        "targetPercent":39.8,
        "projectedPercent":38,
        "projectedLowerPercent":20,
        "projectedUpperPercent":41,
        "currentLabel":"已用 11.0%",
        "targetLabel":"红线 39.8%",
        "projectedLabel":"自然预计 20.0%–41.0%"
      },
      "mainlineCorrections":[{"targetId":"opaque-mainline","label":"论文主线","project":"Research","status":"snoozed","updatedAt":"2026-08-21T14:00:00.000Z"}],
      "details":[{"title":"现在","rows":[{"label":"建议","value":"保持当前节奏","secondaryValue":"目标位于蓝区","group":"summary"},{"label":"重置","value":"下次自然刷新 · 08-28 10:48 UTC+8","relativeTimeAt":"2026-08-28T02:48:00Z","relativeTimePrefix":"下次自然刷新 · "}]}],
      "submenuDetails":[{"title":"用量与目标","rows":[{"label":"工作账户 · 20x","value":"还需 20.0% · 已用 10.0%","progress":{"title":"工作账户的使用计划","alternateTitle":null,"currentPercent":10,"targetPercent":30,"projectedPercent":28,"projectedLowerPercent":22,"projectedUpperPercent":35,"currentLabel":"当前 10.0%","targetLabel":"目标 30.0%","projectedLabel":"预计 22.0%–35.0%"},"actions":[{"title":"暂不推荐","operation":"snooze","targetId":"opaque-mainline"}]}]}]
    }
    """#.utf8)
    let value = try JSONDecoder().decode(ResetSnapshot.self, from: data)
    #expect(value.decisionProgress?.targetPercent == 39.8)
    #expect(value.decisionProgress?.alternateTitle == "未来 24 小时")
    #expect(value.details.first?.rows.first?.label == "建议")
    #expect(value.details.first?.rows.first?.group == "summary")
    #expect(value.details.first?.rows.last?.relativeTimeAt == "2026-08-28T02:48:00Z")
    #expect(value.submenuDetails.first?.title == "用量与目标")
    #expect(value.submenuDetails.first?.rows.first?.progress?.currentPercent == 10)
    #expect(value.submenuDetails.first?.rows.first?.progress?.projectedUpperPercent == 35)
    #expect(value.submenuDetails.first?.rows.first?.actions?.first?.operation == "snooze")
    #expect(value.mainlineCorrections?.first?.targetId == "opaque-mainline")
}

@Test func `decodes timeline semantics independently from display color`() throws {
    let data = Data(#"""
    {
      "updatedAt":"2026-08-29T08:30:00Z",
      "dataConfidence":"estimated",
      "decisionProgress":null,
      "details":[],
      "submenuDetails":[{
        "title":"重置",
        "rows":[],
        "visualizations":[{
          "kind":"timeline",
          "group":"timeline",
          "title":"刷新时间轴",
          "items":[
            {
              "id":"candidate-1",
              "kind":"candidate",
              "state":"inferred",
              "title":"legacy candidate title",
              "detail":"Tibo 说“很快，但不是今天”；目前还不是正式公告。",
              "detailEnglish":"Tibo said “soon, but not today”; this is not an official announcement.",
              "badge":"legacy inferred badge",
              "at":"2026-08-29T07:00:00Z",
              "endAt":"2026-08-30T06:59:59Z",
              "publishedAt":"2026-08-29T04:07:10Z",
              "link":{"label":"查看可能重置暗示原帖 · 08-29","labelEnglish":"View possible-reset source · Aug 28 PT","url":"https://example.invalid/status/2000000000000000000"}
            },
            {
              "id":"natural-1",
              "kind":"natural",
              "state":"scheduled",
              "title":"下次自然刷新",
              "detail":null,
              "badge":"计划",
              "at":"2026-09-01T09:00:00Z",
              "endAt":null,
              "publishedAt":null,
              "link":null
            }
          ]
        }]
      }]
    }
    """#.utf8)

    let value = try JSONDecoder().decode(ResetSnapshot.self, from: data)
    let timeline = try #require(value.submenuDetails.first?.visualizations?.first)
    #expect(timeline.kind == "timeline")
    #expect(timeline.group == "timeline")
    #expect(timeline.items.first?.kind == "candidate")
    #expect(timeline.items.first?.state == "inferred")
    #expect(timeline.items.first?.badge == "legacy inferred badge")
    #expect(timeline.items.first?.detailEnglish?.contains("not an official announcement") == true)
    #expect(timeline.items.first?.endAt == "2026-08-30T06:59:59Z")
    #expect(timeline.items.first?.link?.url == "https://example.invalid/status/2000000000000000000")
    #expect(timeline.items.first?.link?.labelEnglish == "View possible-reset source · Aug 28 PT")
    #expect(timeline.items.last?.state == "scheduled")
}

@Test func `timeline semantics use plain possible reset language and selected time zones`() throws {
    let candidate = DetailTimelineItem(
        id: "candidate",
        kind: "candidate",
        state: "inferred",
        title: "legacy title",
        detail: "Tibo 说“很快，但不是今天”；目前还不是正式公告。",
        detailEnglish: "Tibo said “soon, but not today”; this is not an official announcement.",
        badge: "legacy badge",
        at: "2026-08-29T07:00:00Z",
        endAt: "2026-08-30T06:59:59Z",
        publishedAt: "2026-08-29T04:07:10Z")

    #expect(ResetTimelinePresentation.title(
        for: candidate,
        language: .simplifiedChinese) == "可能重置的时间范围")
    #expect(ResetTimelinePresentation.title(
        for: candidate,
        language: .english) == "Possible reset window")
    #expect(ResetTimelinePresentation.badge(
        for: candidate,
        language: .simplifiedChinese) == "未确认")
    #expect(ResetTimelinePresentation.badge(
        for: candidate,
        language: .english) == "Unconfirmed")
    #expect(ResetTimelinePresentation.timeText(
        for: candidate,
        language: .simplifiedChinese) == "8月29日 15:00–8月30日 14:59 UTC+8")
    #expect(ResetTimelinePresentation.timeText(
        for: candidate,
        language: .english) == "Aug 29, 12:00 AM–11:59 PM PT")
    #expect(ResetTimelinePresentation.detail(
        for: candidate,
        language: .english)?.contains("not an official announcement") == true)
    #expect(ResetTimelinePresentation.publishedText(
        for: candidate,
        language: .simplifiedChinese)?.hasSuffix("UTC+8") == true)
    #expect(ResetTimelinePresentation.publishedText(
        for: candidate,
        language: .english)?.hasSuffix("PT") == true)

    let unknown = DetailTimelineItem(
        id: "unknown",
        kind: "candidate",
        state: "inferred",
        title: "legacy",
        badge: "legacy")
    #expect(ResetTimelinePresentation.timeText(
        for: unknown,
        language: .simplifiedChinese) == "有可能重置，但目前无法确定时间")
    #expect(ResetTimelinePresentation.timeText(
        for: unknown,
        language: .english) == "A reset is possible, but its timing is unknown.")
}

@Test func `timeline flows from past through now to future and keeps now inside an active range`() throws {
    let now = try #require(AlternatingDisplay.date(from: "2026-08-29T08:30:00Z"))
    let items = [
        DetailTimelineItem(
            id: "future-far",
            kind: "natural",
            state: "scheduled",
            title: "future far",
            badge: "scheduled",
            at: "2026-09-04T03:19:46Z"),
        DetailTimelineItem(
            id: "active-range",
            kind: "candidate",
            state: "inferred",
            title: "active",
            badge: "inferred",
            at: "2026-08-29T07:00:00Z",
            endAt: "2026-08-30T06:59:59Z"),
        DetailTimelineItem(
            id: "past-reset",
            kind: "reset",
            state: "confirmed",
            title: "past",
            badge: "confirmed",
            at: "2026-08-27T16:25:36Z"),
        DetailTimelineItem(
            id: "future-near",
            kind: "natural",
            state: "scheduled",
            title: "future near",
            badge: "scheduled",
            at: "2026-08-31T03:19:46Z"),
    ]

    #expect(ResetTimelineLayout.pastItems(items, at: now).map(\.id) == ["past-reset"])
    #expect(ResetTimelineLayout.activeItems(items, at: now).map(\.id) == ["active-range"])
    #expect(ResetTimelineLayout.futureItems(items, at: now).map(\.id) == [
        "future-near",
        "future-far",
    ])
    #expect(ResetTimelinePresentation.rangeStartTitle(
        for: items[1],
        language: .simplifiedChinese) == "可能重置的时间范围开始")
    #expect(ResetTimelinePresentation.rangeEndTitle(
        for: items[1],
        language: .simplifiedChinese) == "可能重置的时间范围结束")
}

@Test func `exact timeline times follow the selected language time zone`() {
    let natural = DetailTimelineItem(
        id: "natural",
        kind: "natural",
        state: "scheduled",
        title: "legacy",
        badge: "legacy",
        at: "2026-09-01T09:00:00Z")

    #expect(ResetTimelinePresentation.timeText(
        for: natural,
        language: .simplifiedChinese) == "9月1日 17:00 UTC+8")
    #expect(ResetTimelinePresentation.timeText(
        for: natural,
        language: .english) == "Sep 1, 2:00 AM PT")
}

@Test func `reset fixture keeps timeline compact and sources in official updates`() throws {
    let snapshot = ResetDemoFixtures.primarySnapshot(.english)
    let homeReset = try #require(snapshot.details.first?.rows.first(where: { $0.label == "Reset" }))
    #expect(homeReset.value.hasPrefix("Possible reset · "))
    #expect(homeReset.value.hasSuffix(" (PT)"))
    #expect(homeReset.value.contains("…") == false)

    let accounts = try #require(snapshot.submenuDetails.first(where: { $0.title == "Usage & Targets" }))
    #expect(accounts.rows.filter { $0.progress != nil }.count == 2)
    #expect(accounts.rows.allSatisfy { $0.group == nil })

    let reset = try #require(snapshot.submenuDetails.first(where: { $0.title == "Resets" }))
    let timeline = try #require(reset.visualizations?.first(where: { $0.group == "timeline" }))

    #expect(timeline.items.count == 3)
    #expect(timeline.items.allSatisfy { $0.link == nil })
    #expect(reset.rows.contains(where: { $0.group == "current" }) == false)
    #expect(reset.rows.contains(where: { $0.label == "Possible reset window" }))
    #expect(reset.rows.contains(where: { $0.label == "Next natural reset" }) == false)
    let visualizations = try #require(reset.visualizations)
    let creditVisualizations = visualizations.filter { visualization in
        visualization.kind == "resetCredits" && visualization.group == "assets"
    }
    let credits = try #require(creditVisualizations.first)
    #expect(credits.creditSummary?.action == "hold")
    #expect(credits.creditSummary?.availableCount == 3)
    #expect(credits.items.count == 3)
    #expect(Set(credits.items.compactMap(\.endAt)).count == 3)
    let creditSummary = try #require(credits.creditSummary)
    let highValueWindow = ResetCreditPresentation.windowText(
        creditSummary,
        language: .english)
    #expect(highValueWindow.components(separatedBy: "PT").count == 2)

    let sourceLabels = reset.rows
        .filter { $0.group == "official" }
        .compactMap { $0.link?.labelEnglish }
    #expect(sourceLabels.count == 2)
    #expect(Set(sourceLabels).count == sourceLabels.count)
    #expect(sourceLabels.allSatisfy { $0.contains("PT") })
}

@Test func `reset menu opens on timeline without a timeline child submenu`() {
    #expect(DetailMenuLayout.rootVisualizationGroup("重置") == "timeline")
    #expect(DetailMenuLayout.rootVisualizationGroup("Resets") == "timeline")
    #expect(DetailMenuLayout.childGroups("重置") == ["assets", "history", "official"])
    #expect(DetailMenuLayout.childGroups("Resets").contains("timeline") == false)
    #expect(DetailMenuLayout.summaryGroup("为什么这样建议") == "summary")
    #expect(DetailMenuLayout.childGroups("为什么这样建议").isEmpty)
    #expect(DetailMenuLayout.childGroups("建议主线").isEmpty)
    #expect(DetailMenuLayout.usesInlineActions("建议主线"))
    #expect(DetailMenuLayout.usesInlineActions("Suggested Mainlines"))
    #expect(!DetailMenuLayout.usesInlineActions("用量与目标"))
    #expect(DetailMenuLayout.isCalculation("计算与数据"))
    #expect(DetailMenuLayout.isCalculation("Calculation & Data"))
    #expect(DetailMenuLayout.calculationGroups == [
        "calculation-result",
        "calculation-basis",
        "calculation-raw",
    ])
}

@Test func `demo snapshot keeps the agreed root navigation order`() {
    let snapshot = ResetDemoFixtures.primarySnapshot(.simplifiedChinese)
    #expect(snapshot.submenuDetails.map(\.title) == [
        "建议主线",
        "用量与目标",
        "重置",
        "为什么这样建议",
        "计算与数据",
    ])
    let why = snapshot.submenuDetails.first { $0.title == "为什么这样建议" }
    let calculation = snapshot.submenuDetails.first { $0.title == "计算与数据" }
    #expect(why?.rows.allSatisfy { $0.group == "summary" } == true)
    #expect(Set(calculation?.rows.compactMap(\.group) ?? []) == Set([
        "calculation-result",
        "calculation-basis",
        "calculation-raw",
    ]))
}

@Test func `reset credits keep their own expiry and selected time zone`() throws {
    let now = try #require(AlternatingDisplay.date(from: "2026-08-29T08:00:00Z"))
    let first = DetailTimelineItem(
        id: "credit-1",
        kind: "credit",
        state: "current",
        title: "Work account",
        badge: "1",
        at: "2026-08-27T08:00:00Z",
        endAt: "2026-09-02T08:00:00Z")
    let second = DetailTimelineItem(
        id: "credit-2",
        kind: "credit",
        state: "current",
        title: "Work account",
        badge: "1",
        at: "2026-08-28T08:00:00Z",
        endAt: "2026-09-06T08:00:00Z")

    let firstChinese = ResetCreditPresentation.expiryText(
        first,
        now: now,
        language: .simplifiedChinese)
    let secondChinese = ResetCreditPresentation.expiryText(
        second,
        now: now,
        language: .simplifiedChinese)
    let firstEnglish = ResetCreditPresentation.expiryText(
        first,
        now: now,
        language: .english)

    #expect(firstChinese != secondChinese)
    #expect(firstChinese.contains("9月2日 16:00 UTC+8"))
    #expect(secondChinese.contains("9月6日 16:00 UTC+8"))
    #expect(firstEnglish.contains("Sep 2, 1:00 AM PT"))
    let scaleEnd = try #require(ResetCreditPresentation.latestExpiry(
        in: [first, second],
        now: now))
    let firstPosition = try #require(ResetCreditPresentation.expiryPosition(
        first,
        now: now,
        scaleEnd: scaleEnd))
    let secondPosition = try #require(ResetCreditPresentation.expiryPosition(
        second,
        now: now,
        scaleEnd: scaleEnd))
    #expect(abs(firstPosition - 0.5) < 0.001)
    #expect(abs(secondPosition - 1.0) < 0.001)
    #expect(firstPosition < secondPosition)
}

@Test func `local monitor endpoint is application owned`() {
    #expect(LocalMonitorEndpoint.host == "127.0.0.1")
    #expect(LocalMonitorEndpoint.port == 18_765)
    #expect(LocalMonitorEndpoint.runtimeURL.absoluteString == "http://127.0.0.1:18765/api/runtime")
    #expect(LocalMonitorEndpoint.snapshotURL.absoluteString == "http://127.0.0.1:18765/api/snapshot")
    #expect(LocalMonitorEndpoint.configURL.absoluteString == "http://127.0.0.1:18765/api/config")
}

@Test func `alternating display uses a stable ten second phase and coarse countdown`() {
    let even = Date(timeIntervalSince1970: 100)
    let odd = Date(timeIntervalSince1970: 110)
    #expect(AlternatingDisplay.usesAlternate(at: even) == false)
    #expect(AlternatingDisplay.usesAlternate(at: odd))
    #expect(AlternatingDisplay.relativeText(
        until: even.addingTimeInterval(2 * 86_400 + 3 * 3_600),
        now: even) == "2 天 3 小时后")
    #expect(AlternatingDisplay.relativeText(
        until: even.addingTimeInterval(4 * 86_400 + 23 * 3_600 + 59 * 60),
        now: even) == "4 天 23 小时后")
    #expect(AlternatingDisplay.relativeText(until: even.addingTimeInterval(7_200), now: even) == "2 小时后")
    #expect(AlternatingDisplay.relativeText(until: even.addingTimeInterval(20 * 60), now: even) == "20 分钟后")
    #expect(AlternatingDisplay.relativeText(until: even, now: even) == "等待刷新确认")
    #expect(AlternatingDisplay.date(from: "2026-08-28T02:48:56.000Z") != nil)
    #expect(AlternatingDisplay.date(from: "2026-08-28T02:48:56Z") != nil)
}

@Test func `presentation countdown follows the selected language`() {
    let now = Date(timeIntervalSince1970: 100)
    let target = now.addingTimeInterval(2 * 86_400 + 3 * 3_600)

    #expect(AlternatingDisplay.relativeText(
        until: target,
        now: now,
        language: .simplifiedChinese) == "2 天 3 小时后")
    #expect(AlternatingDisplay.relativeText(
        until: target,
        now: now,
        language: .english) == "in 2 days 3 hr")
    #expect(ResetPresentationLanguage.english.text("中文", "English") == "English")
}

@MainActor
@Test func `hosting view measures content before fixing its menu height`() {
    let content = VStack(spacing: 8) {
        ForEach(0..<5) { index in
            Text("菜单内容 \(index)").frame(height: 20)
        }
    }
    .padding(.vertical, 12)
    .frame(width: 310)

    let hosting = FixedHeightHostingView(rootView: content)
    let measuredHeight = hosting.measuredFittingHeight(width: 310)

    #expect(measuredHeight > 100)
    hosting.apply(width: 310, height: measuredHeight)
    #expect(hosting.intrinsicContentSize.height == measuredHeight)
    #expect(hosting.frame.height == measuredHeight)
}
