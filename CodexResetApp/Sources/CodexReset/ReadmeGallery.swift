import AppKit
import SwiftUI

struct ResetReadmeGallery: View {
    let page: String

    var body: some View {
        Group {
            switch self.page {
            case "readme-features":
                ReadmeFeaturesGallery()
            case "readme-mechanism":
                ReadmeMechanismGallery()
            case "readme-surfaces":
                ReadmeSurfacesGallery()
            default:
                ReadmeHomeGallery()
            }
        }
        .frame(
            width: Self.preferredSize(for: self.page).width,
            height: Self.preferredSize(for: self.page).height)
        .clipped()
    }

    static func preferredSize(for page: String) -> NSSize {
        switch page {
        case "readme-features": NSSize(width: 1180, height: 900)
        case "readme-mechanism": NSSize(width: 1320, height: 650)
        case "readme-surfaces": NSSize(width: 1180, height: 700)
        default: NSSize(width: 1180, height: 820)
        }
    }
}

private enum ReadmePalette {
    static let background = Color(red: 0.045, green: 0.048, blue: 0.078)
    static let panel = Color(red: 0.10, green: 0.10, blue: 0.15)
    static let purple = Color(red: 0.55, green: 0.39, blue: 0.96)
    static let cyan = Color(red: 0.30, green: 0.77, blue: 0.91)
}

private struct ReadmeCanvas<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        ZStack {
            ReadmePalette.background
            RadialGradient(
                colors: [ReadmePalette.purple.opacity(0.22), .clear],
                center: .topTrailing,
                startRadius: 20,
                endRadius: 760)
            self.content
        }
        .ignoresSafeArea()
    }
}

private struct ReadmeHomeGallery: View {
    @StateObject private var store = SnapshotStore(snapshot: ResetReadmeFixtures.primarySnapshot)

    var body: some View {
        ReadmeCanvas {
            VStack(spacing: 28) {
                HStack(spacing: 12) {
                    Image(nsImage: ResetBrandAssets.cardGlyph())
                        .resizable()
                        .interpolation(.high)
                        .scaledToFit()
                        .frame(width: 44, height: 44)
                        .clipShape(RoundedRectangle(cornerRadius: 11, style: .continuous))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Codex Capacity Planner")
                            .font(.system(size: 29, weight: .bold, design: .rounded))
                        Text("使用计划、账号与重置建议")
                            .font(.callout)
                            .foregroundStyle(.secondary)
                    }
                }

                ResetMenuPreview(store: self.store)
                    .scaleEffect(1.13)
                    .frame(width: 690, height: 610)
                    .shadow(color: .black.opacity(0.42), radius: 36, y: 22)
            }
            .padding(.vertical, 34)
        }
    }
}

private struct ReadmeFeaturesGallery: View {
    @StateObject private var store = SnapshotStore(snapshot: ResetReadmeFixtures.primarySnapshot)

    var body: some View {
        ReadmeCanvas {
            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 5) {
                    Text("围绕当前工作的一份使用计划")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                    Text("首页给出行动建议，详情保留完整依据。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                HStack(alignment: .top, spacing: 18) {
                    ReadmeFeaturePanel(
                        title: "使用计划与近期工作",
                        caption: "当前、目标、预计用量和可继续任务放在首页，展开后可查看完整依据。")
                    {
                        VStack(spacing: 12) {
                            ResetMenuCard(
                                store: self.store,
                                highlight: MenuHighlightState(),
                                width: 420,
                                hasSubmenu: true,
                                onRefresh: {})
                                .background(ReadmePalette.panel)
                                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            ResetDetailsView(
                                sections: [ResetReadmeFixtures.whySection],
                                width: 420)
                        }
                    }
                    .frame(width: 470, height: 750)

                    VStack(spacing: 18) {
                        ReadmeFeaturePanel(title: "重置管理", caption: "时间、公告与到账状态统一显示。") {
                            ResetDetailsView(
                                sections: [ResetReadmeFixtures.resetSection],
                                width: 570)
                        }
                        .frame(height: 270)
                        ReadmeFeaturePanel(
                            title: "账号与重置券",
                            caption: "根据各账号的使用情况、刷新时间和近期工作提供建议。")
                        {
                            ResetDetailsView(
                                sections: [
                                    ResetReadmeFixtures.accountSection,
                                    ResetReadmeFixtures.creditSection,
                                ],
                                width: 570)
                        }
                        .frame(height: 462)
                    }
                    .frame(maxWidth: .infinity, maxHeight: 750)
                }
            }
            .padding(34)
        }
    }
}

private struct ReadmeFeaturePanel<Content: View>: View {
    let title: String
    let caption: String
    let content: Content

    init(title: String, caption: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.caption = caption
        self.content = content()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 3) {
                Text(self.title).font(.headline)
                Text(self.caption)
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            self.content
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .background(ReadmePalette.panel)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .padding(16)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .stroke(Color.white.opacity(0.08))
        }
    }
}

private struct ReadmeMechanismGallery: View {
    var body: some View {
        ReadmeCanvas {
            VStack(spacing: 34) {
                VStack(spacing: 6) {
                    Text("所有信息进入同一份使用计划")
                        .font(.system(size: 31, weight: .bold, design: .rounded))
                    Text("任一信息变化后，工作、账号和重置券建议一起更新。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                HStack(spacing: 34) {
                    VStack(spacing: 10) {
                        ReadmeFlowItem(symbol: "chart.bar.fill", text: "当前额度")
                        ReadmeFlowItem(symbol: "speedometer", text: "使用情况")
                        ReadmeFlowItem(symbol: "briefcase.fill", text: "近期工作")
                        ReadmeFlowItem(symbol: "clock.arrow.circlepath", text: "刷新信息")
                        ReadmeFlowItem(symbol: "ticket.fill", text: "重置券")
                    }
                    .frame(width: 250)

                    Image(systemName: "arrow.right")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(.secondary)

                    VStack(spacing: 13) {
                        Image(nsImage: ResetBrandAssets.cardGlyph())
                            .resizable()
                            .interpolation(.high)
                            .scaledToFit()
                            .frame(width: 72, height: 72)
                            .clipShape(RoundedRectangle(cornerRadius: 17, style: .continuous))
                        Text("统一使用计划")
                            .font(.title2.bold())
                        Text("所有变化一起计算")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    .frame(width: 260, height: 250)
                    .background(ReadmePalette.purple.opacity(0.13), in: RoundedRectangle(cornerRadius: 24))
                    .overlay {
                        RoundedRectangle(cornerRadius: 24)
                            .stroke(ReadmePalette.purple.opacity(0.45))
                    }

                    Image(systemName: "arrow.right")
                        .font(.system(size: 28, weight: .semibold))
                        .foregroundStyle(.secondary)

                    VStack(spacing: 14) {
                        ReadmeFlowItem(symbol: "play.circle.fill", text: "工作节奏建议", emphasized: true)
                        ReadmeFlowItem(symbol: "person.2.fill", text: "账号使用建议", emphasized: true)
                        ReadmeFlowItem(symbol: "ticket.fill", text: "重置券建议", emphasized: true)
                    }
                    .frame(width: 300)
                }
            }
            .padding(42)
        }
    }
}

private struct ReadmeFlowItem: View {
    let symbol: String
    let text: String
    var emphasized = false

    var body: some View {
        HStack(spacing: 11) {
            Image(systemName: self.symbol)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(self.emphasized ? ReadmePalette.cyan : ReadmePalette.purple)
                .frame(width: 22)
            Text(self.text)
                .font(.system(size: 16, weight: .semibold))
            Spacer()
        }
        .padding(.horizontal, 15)
        .frame(height: 50)
        .background(Color.white.opacity(self.emphasized ? 0.075 : 0.05), in: RoundedRectangle(cornerRadius: 12))
        .overlay {
            RoundedRectangle(cornerRadius: 12)
                .stroke(Color.white.opacity(0.08))
        }
    }
}

private struct ReadmeSurfacesGallery: View {
    @StateObject private var appStore = SnapshotStore(snapshot: ResetReadmeFixtures.primarySnapshot)
    @StateObject private var barStore = SnapshotStore(snapshot: ResetReadmeFixtures.primarySnapshot)

    var body: some View {
        ReadmeCanvas {
            VStack(spacing: 22) {
                VStack(spacing: 5) {
                    Text("两种界面，同一份本机计划")
                        .font(.system(size: 30, weight: .bold, design: .rounded))
                    Text("可以单独使用，也可以同时使用。")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }

                HStack(alignment: .top, spacing: 26) {
                    ReadmeSurfacePanel(title: "独立 macOS App") {
                        ResetMenuPreview(store: self.appStore)
                            .scaleEffect(0.80, anchor: .top)
                            .frame(width: 460, height: 450, alignment: .top)
                    }
                    ReadmeSurfacePanel(title: "CodexBar 集成") {
                        ResetMenuCard(
                            store: self.barStore,
                            highlight: MenuHighlightState(),
                            width: 390,
                            hasSubmenu: true,
                            onRefresh: {})
                            .background(ReadmePalette.panel)
                            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                            .shadow(color: .black.opacity(0.25), radius: 20, y: 12)
                            .padding(.top, 28)
                    }
                }
            }
            .padding(34)
        }
    }
}

private struct ReadmeSurfacePanel<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 14) {
            Text(self.title).font(.headline)
            self.content
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
        .padding(18)
        .frame(width: 530, height: 520)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 18))
        .overlay {
            RoundedRectangle(cornerRadius: 18)
                .stroke(Color.white.opacity(0.08))
        }
    }
}

private enum ResetReadmeFixtures {
    static var primarySnapshot: ResetSnapshot {
        ResetSnapshot(
        updatedAt: "2026-08-23T08:00:00Z",
        dataConfidence: "estimated",
        decisionProgress: DecisionProgress(
            title: "近期使用计划 · 未来 24 小时",
            alternateTitle: "近期使用计划 · 08-24 16:00 UTC+8",
            currentPercent: 42,
            targetPercent: 68,
            projectedPercent: 60,
            projectedLowerPercent: 54,
            projectedUpperPercent: 66,
            currentLabel: "当前 42.0%",
            targetLabel: "目标 68.0%",
            projectedLabel: "预计 54.0%–66.0% · 中心 60.0%"),
        details: [
            DetailSection(title: "现在", rows: [
                DetailRow(
                    label: "建议",
                    value: "继续完成近期任务",
                    secondaryValue: "当前使用速度略慢，先继续已有工作"),
                DetailRow(label: "账户", value: "工作账户 · Pro", secondaryValue: "当前使用账号"),
                DetailRow(label: "可用重置", value: "1 次可用", secondaryValue: "当前账号持有 · 暂时保留"),
                DetailRow(label: "任务 1", value: "完善搜索结果页", secondaryValue: "最近活跃 · 继续进行"),
                DetailRow(label: "任务 2", value: "整理本周数据", secondaryValue: "已置顶 · 等待完成"),
                DetailRow(label: "任务 3", value: "检查桌面端体验", secondaryValue: "本周期内活跃"),
                DetailRow(label: "重置", value: "下次自然刷新 · 4 天 18 小时后"),
            ]),
        ],
            submenuDetails: [self.accountSection, self.whySection, self.resetSection])
    }

    static let accountSection = DetailSection(title: "账户", rows: [
        DetailRow(label: "工作账户 · Pro", value: "当前已用 42%", secondaryValue: "4 天 18 小时后刷新"),
        DetailRow(label: "备用账户 · Pro", value: "当前已用 31%", secondaryValue: "3 天 20 小时后刷新"),
        DetailRow(label: "建议", value: "继续使用工作账户", secondaryValue: "当前无需切换"),
    ])

    static let whySection = DetailSection(title: "为什么这样建议", rows: [
        DetailRow(label: "当前", value: "已用 42% · 当前目标 55%"),
        DetailRow(label: "预计", value: "24 小时后预计使用 54%–66%"),
        DetailRow(label: "因此", value: "继续完成近期任务", secondaryValue: "先使用已有工作，不自动执行"),
    ])

    static let resetSection = DetailSection(title: "重置", rows: [
        DetailRow(label: "下次自然刷新", value: "4 天 18 小时后", secondaryValue: "08-28 10:48 UTC+8"),
        DetailRow(label: "官方重置", value: "当前没有明确公告", secondaryValue: "出现公告后显示预计时间与到账状态"),
        DetailRow(label: "最近一次刷新", value: "自然刷新 · 08-21 10:48 UTC+8"),
    ])

    static let creditSection = DetailSection(title: "重置券", rows: [
        DetailRow(label: "当前账户", value: "1 次可用", secondaryValue: "09-22 到期"),
        DetailRow(label: "建议", value: "暂时保留", secondaryValue: "现有额度与后续刷新仍可满足近期工作"),
        DetailRow(label: "使用时机", value: "继续根据工作与刷新安排", secondaryValue: "系统只提供建议，不自动使用"),
    ])
}
