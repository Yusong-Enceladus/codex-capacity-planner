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
      "details":[{"title":"现在","rows":[{"label":"建议","value":"保持当前节奏","secondaryValue":"目标位于蓝区","group":"summary"},{"label":"重置","value":"下次自然刷新 · 08-28 10:48 UTC+8","relativeTimeAt":"2026-08-28T02:48:00Z","relativeTimePrefix":"下次自然刷新 · "}]}],
      "submenuDetails":[{"title":"模型诊断","rows":[]}]
    }
    """#.utf8)
    let value = try JSONDecoder().decode(ResetSnapshot.self, from: data)
    #expect(value.decisionProgress?.targetPercent == 39.8)
    #expect(value.decisionProgress?.alternateTitle == "未来 24 小时")
    #expect(value.details.first?.rows.first?.label == "建议")
    #expect(value.details.first?.rows.first?.group == "summary")
    #expect(value.details.first?.rows.last?.relativeTimeAt == "2026-08-28T02:48:00Z")
    #expect(value.submenuDetails.first?.title == "模型诊断")
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
