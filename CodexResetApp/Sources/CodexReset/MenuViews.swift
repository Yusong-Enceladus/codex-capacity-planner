import AppKit
import SwiftUI

@MainActor
final class MenuHighlightState: ObservableObject {
    @Published var isHighlighted = false
}

struct ResetMenuCard: View {
    @Environment(\.resetPresentationLanguage) private var presentationLanguage
    @ObservedObject var store: SnapshotStore
    @ObservedObject var highlight: MenuHighlightState
    let width: CGFloat
    let hasSubmenu: Bool
    let onRefresh: () -> Void

    private let tint = Color(red: 0.55, green: 0.39, blue: 0.96)

    var body: some View {
        VStack(alignment: .leading, spacing: 9) {
            self.header
            if let snapshot = self.store.snapshot {
                if !snapshot.details.isEmpty {
                    Divider()
                    ResetDecisionContent(
                        sections: snapshot.details,
                        tint: self.tint,
                        highlighted: self.highlight.isHighlighted)
                }
                if let progress = snapshot.decisionProgress {
                    Divider()
                    self.decisionProgress(progress)
                }
            } else if let error = self.store.errorMessage {
                Text(error)
                    .font(.caption)
                    .foregroundStyle(self.highlight.isHighlighted ? .white : .red)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                Text(self.presentationLanguage.text("正在读取额度与策略…", "Loading usage and plan…"))
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 8)
        .padding(.trailing, self.hasSubmenu ? 10 : 0)
        .frame(width: self.width, alignment: .leading)
        .background {
            if self.highlight.isHighlighted {
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(Color(red: 0.02, green: 0.34, blue: 0.78))
                    .padding(.horizontal, 6)
                    .padding(.vertical, 2)
            }
        }
        .overlay(alignment: .topTrailing) {
            if self.hasSubmenu {
                Image(systemName: "chevron.right")
                    .font(.caption.bold())
                    .foregroundStyle(self.highlight.isHighlighted ? .white : .secondary)
                    .padding(.top, 13)
                    .padding(.trailing, 10)
            }
        }
        .foregroundStyle(self.highlight.isHighlighted ? Color.white : Color.primary)
        .contentShape(Rectangle())
        .onHover { self.highlight.isHighlighted = $0 }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var header: some View {
        HStack(spacing: 8) {
            Image(nsImage: ResetBrandAssets.cardGlyph())
                .resizable()
                .scaledToFit()
                .frame(width: 26, height: 26)
                .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
            VStack(alignment: .leading, spacing: 1) {
                Text("Codex Capacity Planner").font(.headline)
                Text(self.headerSubtitle)
                    .font(.caption2)
                    .foregroundStyle(self.highlight.isHighlighted ? .white.opacity(0.8) : .secondary)
            }
            Spacer()
            if self.store.isRefreshing {
                ProgressView().controlSize(.small)
            } else {
                Button(action: self.onRefresh) { Image(systemName: "arrow.clockwise") }
                    .buttonStyle(.plain)
                    .help(self.presentationLanguage.text("刷新", "Refresh"))
            }
        }
    }

    private var headerSubtitle: String {
        if self.store.isRefreshing {
            return self.presentationLanguage.text("正在刷新…", "Refreshing…")
        }
        guard let fetchedAt = self.store.fetchedAt else {
            return self.presentationLanguage.text("尚未更新", "Not updated yet")
        }
        if Date().timeIntervalSince(fetchedAt) < 5 {
            return self.presentationLanguage.text("刚刚更新", "Updated just now")
        }
        let formatter = RelativeDateTimeFormatter()
        formatter.locale = self.presentationLanguage.locale
        let relative = formatter.localizedString(for: fetchedAt, relativeTo: Date())
        return self.presentationLanguage.text(relative + "更新", "Updated \(relative)")
    }

    private func decisionProgress(_ progress: DecisionProgress) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            AlternatingTimeText(primary: progress.title, alternate: progress.alternateTitle)
                .font(.caption.bold()).lineLimit(1)
            CompactDecisionProgress(
                progress: progress,
                tint: self.tint,
                highlighted: self.highlight.isHighlighted)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(progress.currentLabel)
                Spacer(minLength: 8)
                self.legend(color: .red, text: progress.targetLabel)
            }
            .font(.caption2).monospacedDigit().lineLimit(1)
            self.legend(color: .cyan, text: progress.projectedLabel)
                .font(.caption2).monospacedDigit().lineLimit(1)
        }
    }

    private func legend(color: Color, text: String) -> some View {
        HStack(spacing: 4) {
            Capsule()
                .fill(self.highlight.isHighlighted ? .white : color)
                .frame(width: 3, height: 10)
            Text(text)
        }
    }
}

private struct CompactDecisionProgress: View {
    let progress: DecisionProgress
    let tint: Color
    let highlighted: Bool

    var body: some View {
        ZStack {
            Capsule().fill(self.highlighted ? .white.opacity(0.22) : .secondary.opacity(0.2))
            GeometryReader { geometry in
                let width = geometry.size.width
                Capsule()
                    .fill(self.highlighted ? .white.opacity(0.82) : self.tint)
                    .frame(width: width * self.ratio(self.progress.currentPercent))
                if let lower = self.progress.projectedLowerPercent,
                   let upper = self.progress.projectedUpperPercent
                {
                    Capsule()
                        .fill(self.highlighted ? .white.opacity(0.28) : Color.cyan.opacity(0.22))
                        .overlay {
                            Capsule().stroke(
                                self.highlighted ? .white.opacity(0.5) : .cyan.opacity(0.7),
                                lineWidth: 0.75)
                        }
                        .frame(
                            width: max(3, width * (self.ratio(upper) - self.ratio(lower))),
                            height: 10)
                        .position(
                            x: width * (self.ratio(lower) + self.ratio(upper)) / 2,
                            y: 5)
                }
                self.marker(
                    self.progress.targetPercent,
                    color: self.highlighted ? .white : .red,
                    width: width)
                if let projected = self.progress.projectedPercent {
                    self.marker(
                        projected,
                        color: self.highlighted ? .white.opacity(0.8) : .cyan,
                        width: width)
                }
            }
        }
        .frame(height: 10)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(self.progress.title)
        .accessibilityValue([
            self.progress.currentLabel,
            self.progress.targetLabel,
            self.progress.projectedLabel,
        ].joined(separator: "；"))
    }

    private func marker(_ percent: Double, color: Color, width: CGFloat) -> some View {
        Capsule()
            .fill(color)
            .frame(width: 3, height: 10)
            .position(
                x: min(max(width * self.ratio(percent), 2.5), max(2.5, width - 2.5)),
                y: 5)
    }

    private func ratio(_ percent: Double) -> CGFloat {
        CGFloat(min(100, max(0, percent)) / 100)
    }
}

private struct ResetDecisionContent: View {
    let sections: [DetailSection]
    let tint: Color
    let highlighted: Bool

    private var rows: [DetailRow] {
        self.sections.flatMap(\.rows)
    }

    var body: some View {
        if let action = self.rows.first {
            VStack(alignment: .leading, spacing: 8) {
                VStack(alignment: .leading, spacing: 3) {
                    Text(action.label)
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(self.highlighted ? .white.opacity(0.78) : self.tint)
                    AlternatingTimeText(
                        primary: action.value,
                        alternate: action.alternateValue,
                        relativeTimeAt: action.relativeTimeAt,
                        relativeTimePrefix: action.relativeTimePrefix)
                        .font(.subheadline.weight(.semibold))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                    if let secondary = action.secondaryValue {
                        Text(secondary)
                            .font(.caption2)
                            .foregroundStyle(self.highlighted ? .white.opacity(0.78) : .secondary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    self.highlighted ? Color.white.opacity(0.12) : self.tint.opacity(0.11),
                    in: RoundedRectangle(cornerRadius: 7, style: .continuous))
                .accessibilityElement(children: .combine)

                if self.rows.count > 1 {
                    LazyVGrid(
                        columns: [GridItem(.flexible()), GridItem(.flexible())],
                        alignment: .leading,
                        spacing: 7)
                    {
                        ForEach(Array(self.rows.dropFirst())) { row in
                            VStack(alignment: .leading, spacing: 2) {
                                Text(row.label)
                                    .font(.caption2)
                                    .foregroundStyle(self.highlighted ? .white.opacity(0.7) : .secondary)
                                AlternatingTimeText(
                                    primary: row.value,
                                    alternate: row.alternateValue,
                                    relativeTimeAt: row.relativeTimeAt,
                                    relativeTimePrefix: row.relativeTimePrefix)
                                    .font(.caption.weight(.medium))
                                    .lineLimit(2)
                                    .fixedSize(horizontal: false, vertical: true)
                                if let secondary = row.secondaryValue {
                                    Text(secondary)
                                        .font(.caption2)
                                        .foregroundStyle(self.highlighted ? .white.opacity(0.7) : .secondary)
                                        .lineLimit(2)
                                        .fixedSize(horizontal: false, vertical: true)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 50, alignment: .topLeading)
                            .accessibilityElement(children: .combine)
                        }
                    }
                }
            }
        }
    }
}

struct ResetDetailsView: View {
    let sections: [DetailSection]
    let width: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            ForEach(Array(self.sections.enumerated()), id: \.offset) { sectionIndex, section in
                if sectionIndex > 0 { Divider() }
                VStack(alignment: .leading, spacing: 9) {
                    Text(section.title)
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .textCase(.uppercase)
                    ForEach(Array(section.rows.enumerated()), id: \.element.id) { rowIndex, row in
                        if rowIndex > 0 { Divider().opacity(0.55) }
                        VStack(alignment: .leading, spacing: 3) {
                            HStack(spacing: 5) {
                                Text(row.label)
                                    .font(.caption.weight(.semibold))
                                    .foregroundStyle(.secondary)
                                if row.link != nil {
                                    Image(systemName: "arrow.up.right.square")
                                        .font(.caption2)
                                        .foregroundStyle(.tertiary)
                                }
                            }
                            AlternatingTimeText(
                                primary: row.value,
                                alternate: row.alternateValue,
                                relativeTimeAt: row.relativeTimeAt,
                                relativeTimePrefix: row.relativeTimePrefix)
                                .font(.caption).fixedSize(horizontal: false, vertical: true)
                            if let secondary = row.secondaryValue {
                                Text(secondary)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            }
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .frame(width: self.width, alignment: .leading)
        .textSelection(.enabled)
        .fixedSize(horizontal: false, vertical: true)
    }
}

final class FixedHeightHostingView<Content: View>: NSHostingView<Content> {
    private var fixedHeight: CGFloat?
    override var allowsVibrancy: Bool {
        true
    }

    override var intrinsicContentSize: NSSize {
        guard let fixedHeight else { return super.intrinsicContentSize }
        return NSSize(width: NSView.noIntrinsicMetric, height: fixedHeight)
    }

    func measuredFittingHeight(width: CGFloat) -> CGFloat {
        let savedHeight = self.fixedHeight
        self.fixedHeight = nil
        self.frame = NSRect(x: 0, y: 0, width: width, height: 1)
        self.invalidateIntrinsicContentSize()
        self.layoutSubtreeIfNeeded()
        let height = self.fittingSize.height
        self.fixedHeight = savedHeight
        self.invalidateIntrinsicContentSize()
        return max(1, ceil(height))
    }

    func apply(width: CGFloat, height: CGFloat) {
        self.fixedHeight = max(1, ceil(height))
        self.frame = NSRect(x: 0, y: 0, width: width, height: self.fixedHeight ?? 1)
        self.invalidateIntrinsicContentSize()
    }
}

struct ResetMenuPreview: View {
    @Environment(\.resetPresentationLanguage) private var presentationLanguage
    @ObservedObject var store: SnapshotStore
    @StateObject private var highlight = MenuHighlightState()

    var body: some View {
        HStack(alignment: .top, spacing: 8) {
            if let sections = self.store.snapshot?.submenuDetails {
                VStack(spacing: 0) {
                    ForEach(sections) { section in
                        HStack(spacing: 9) {
                            Image(systemName: self.symbolName(for: section.title))
                                .frame(width: 16)
                                .foregroundStyle(.secondary)
                            Text(section.title)
                            Spacer()
                            Text("\(section.rows.count)")
                                .font(.caption)
                                .foregroundStyle(.tertiary)
                            Image(systemName: "chevron.right")
                                .font(.caption2.bold())
                                .foregroundStyle(.tertiary)
                        }
                        .font(.body)
                        .padding(.horizontal, 12)
                        .frame(height: 30)
                    }
                }
                .padding(.vertical, 5)
                .frame(width: 240)
                .background(Color(red: 0.11, green: 0.11, blue: 0.16))
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
            }
            VStack(spacing: 0) {
                ResetMenuCard(
                    store: self.store,
                    highlight: self.highlight,
                    width: 310,
                    hasSubmenu: !(self.store.snapshot?.submenuDetails.isEmpty ?? true),
                    onRefresh: { Task { await self.store.refresh() } })
                Divider()
                self.previewRow(
                    "arrow.clockwise",
                    self.presentationLanguage.text("刷新", "Refresh"),
                    shortcut: "⌘R")
                self.previewRow(
                    "gearshape",
                    self.presentationLanguage.text("设置…", "Settings…"),
                    shortcut: "⌘,")
                Divider()
                self.previewRow(
                    "xmark.square",
                    self.presentationLanguage.text(
                        "退出 Codex Capacity Planner",
                        "Quit Codex Capacity Planner"),
                    shortcut: "⌘Q")
            }
            .frame(width: 310)
            .padding(.vertical, 4)
            .background(Color(red: 0.11, green: 0.11, blue: 0.16))
            .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        }
        .padding(8)
        .onAppear { self.highlight.isHighlighted = true }
    }

    private func previewRow(_ image: String, _ title: String, shortcut: String) -> some View {
        HStack(spacing: 8) {
            Image(systemName: image).frame(width: 16)
            Text(title)
            Spacer()
            Text(shortcut).foregroundStyle(.secondary)
        }
        .font(.body)
        .padding(.horizontal, 14)
        .frame(height: 28)
    }

    private func symbolName(for title: String) -> String {
        switch title {
        case "可继续的任务", "Suggested Tasks": "play.circle"
        case "账户", "Accounts": "person.2"
        case "为什么这样建议", "Why This Plan": "chart.line.uptrend.xyaxis"
        case "重置", "Resets": "clock.arrow.circlepath"
        default: "list.bullet.rectangle"
        }
    }
}
