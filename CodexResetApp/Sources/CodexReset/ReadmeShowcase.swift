import SwiftUI

enum ResetReadmeShowcasePage {
    case accounts
    case resets
}

/// Reproducible README captures built from the same detail views as the menu.
struct ResetReadmeShowcase: View {
    let page: ResetReadmeShowcasePage
    let language: ResetPresentationLanguage

    private var snapshot: ResetSnapshot {
        ResetDemoFixtures.primarySnapshot(self.language)
    }

    var body: some View {
        Group {
            switch self.page {
            case .accounts:
                self.accountShowcase
            case .resets:
                self.resetShowcase
            }
        }
        .padding(18)
        .background(Color.black)
        .fixedSize(horizontal: true, vertical: true)
    }

    private var accountShowcase: some View {
        self.menuSurface {
            ResetDetailsView(
                sections: self.section(named: self.language.text("用量与目标", "Usage & Targets")).map { [$0] } ?? [],
                width: 430)
        }
    }

    private var resetShowcase: some View {
        let reset = self.section(named: self.language.text("重置", "Resets"))
        let timeline = DetailSection(
            title: self.language.text("重置", "Resets"),
            rows: [],
            visualizations: reset?.visualizations?.filter { $0.group == "timeline" })
        let assets = DetailSection(
            title: self.language.text("重置券", "Reset Credits"),
            rows: reset?.rows.filter { $0.group == "assets" } ?? [],
            visualizations: reset?.visualizations?.filter { $0.group == "assets" })
        return HStack(alignment: .top, spacing: 12) {
            self.menuSurface {
                ResetDetailsView(sections: [timeline], width: 430)
            }
            self.menuSurface {
                ResetDetailsView(sections: [assets], width: 430)
            }
        }
    }

    private func section(named title: String) -> DetailSection? {
        self.snapshot.submenuDetails.first { $0.title == title }
    }

    private func menuSurface<Content: View>(
        @ViewBuilder content: () -> Content) -> some View
    {
        content()
            .background(Color(red: 0.11, green: 0.11, blue: 0.16))
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(Color.white.opacity(0.24), lineWidth: 0.75)
            }
    }
}
