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
      "submenuDetails":[{"title":"账户","rows":[{"label":"工作账户 · 20x","value":"还需 20.0% · 已用 10.0%","progress":{"title":"工作账户的使用计划","alternateTitle":null,"currentPercent":10,"targetPercent":30,"projectedPercent":28,"projectedLowerPercent":22,"projectedUpperPercent":35,"currentLabel":"当前 10.0%","targetLabel":"目标 30.0%","projectedLabel":"预计 22.0%–35.0%"},"actions":[{"title":"暂不推荐","operation":"snooze","targetId":"opaque-mainline"}]}]}]
    }
    """#.utf8)
    let value = try JSONDecoder().decode(ResetSnapshot.self, from: data)
    #expect(value.decisionProgress?.targetPercent == 39.8)
    #expect(value.decisionProgress?.alternateTitle == "未来 24 小时")
    #expect(value.details.first?.rows.first?.label == "建议")
    #expect(value.details.first?.rows.first?.group == "summary")
    #expect(value.details.first?.rows.last?.relativeTimeAt == "2026-08-28T02:48:00Z")
    #expect(value.submenuDetails.first?.title == "账户")
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
              "title":"候选重置暗示",
              "detail":"推测观察窗，不是官方截止时间",
              "badge":"推测",
              "at":"2026-08-29T07:00:00Z",
              "endAt":"2026-08-30T06:59:59Z",
              "publishedAt":"2026-08-29T04:07:10Z",
              "link":{"label":"打开原帖","url":"https://example.invalid/status/2000000000000000000"}
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
    #expect(timeline.items.first?.badge == "推测")
    #expect(timeline.items.first?.endAt == "2026-08-30T06:59:59Z")
    #expect(timeline.items.first?.link?.url == "https://example.invalid/status/2000000000000000000")
    #expect(timeline.items.last?.state == "scheduled")
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
