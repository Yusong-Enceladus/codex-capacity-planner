import AppKit
import SwiftUI
import Testing
@testable import CodexReset

@MainActor @Test func `readable mainline actions still fit in one horizontal row in both languages`() {
    for language in [ResetPresentationLanguage.simplifiedChinese, .english] {
        let actions = [
            DetailAction(title: language.text("标为主线", "Mark as mainline"), operation: "mark-mainline", targetId: "one"),
            DetailAction(title: language.text("不是主线", "Not a mainline"), operation: "not-mainline", targetId: "one"),
            DetailAction(title: language.text("暂不推荐", "Snooze"), operation: "snooze", targetId: "one"),
            DetailAction(title: language.text("标记已完成", "Complete"), operation: "complete", targetId: "one"),
        ]
        let controller = NSHostingController(rootView: MainlineActionBar(actions: actions, onAction: { _ in true })
            .environment(\.resetPresentationLanguage, language))
        let width = MenuContentSizing.documentWidth(viewportWidth: 480) - 28
        let size = controller.sizeThatFits(in: CGSize(width: width, height: .greatestFiniteMagnitude))
        #expect(size.width <= width)
        #expect(size.height == 28)
    }
}

@MainActor @Test func `calculation uses normal sized segmented controls within the existing menu width`() throws {
    for language in [ResetPresentationLanguage.simplifiedChinese, .english] {
        let snapshot = ResetDemoFixtures.primarySnapshot(language)
        let section = try #require(snapshot.submenuDetails.first { DetailMenuLayout.isCalculation($0.title) })
        let root = ResetDetailsView(sections: [section], width: 480, history: snapshot.decisionHistory)
            .environment(\.resetPresentationLanguage, language).environment(\.locale, language.locale)
        let controller = NSHostingController(rootView: root)
        let size = controller.sizeThatFits(in: CGSize(width: MenuContentSizing.documentWidth(viewportWidth: 480), height: .greatestFiniteMagnitude))
        #expect(size.width <= 480)
        #expect(size.height > 200)
        #expect(size.height < 950)
    }
}
