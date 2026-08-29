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

private struct DetailDecisionProgress: View {
    let progress: DecisionProgress

    private let tint = Color(red: 0.55, green: 0.39, blue: 0.96)

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            CompactDecisionProgress(progress: self.progress, tint: self.tint, highlighted: false)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(self.progress.currentLabel)
                Spacer(minLength: 8)
                self.legend(color: .red, text: self.progress.targetLabel)
            }
            .font(.caption2)
            .monospacedDigit()
            self.legend(color: .cyan, text: self.progress.projectedLabel)
                .font(.caption2)
                .monospacedDigit()
        }
        .accessibilityElement(children: .combine)
    }

    private func legend(color: Color, text: String) -> some View {
        HStack(spacing: 4) {
            Capsule().fill(color).frame(width: 3, height: 10)
            Text(text)
        }
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

private struct ResetTimelineConnector: Shape {
    func path(in rect: CGRect) -> Path {
        var path = Path()
        path.move(to: CGPoint(x: rect.midX, y: rect.minY))
        path.addLine(to: CGPoint(x: rect.midX, y: rect.maxY))
        return path
    }
}

private struct ResetEventTimeline: View {
    @Environment(\.resetPresentationLanguage) private var presentationLanguage
    let visualization: DetailVisualization

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let upcoming = self.upcomingItems(at: context.date)
            let past = self.pastItems(at: context.date)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(Array(upcoming.enumerated()), id: \.element.id) { index, item in
                    self.eventRow(item, connectsBelow: index < upcoming.count - 1 || !past.isEmpty)
                }
                self.nowDivider
                    .padding(.vertical, 3)
                ForEach(Array(past.enumerated()), id: \.element.id) { index, item in
                    self.eventRow(item, connectsBelow: index < past.count - 1)
                }
            }
        }
    }

    private var nowDivider: some View {
        HStack(spacing: 8) {
            ZStack {
                Circle().fill(Color.secondary.opacity(0.14))
                Image(systemName: "clock")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(width: 22, height: 22)
            Text(self.presentationLanguage.text("现在", "Now"))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Rectangle()
                .fill(Color.secondary.opacity(0.22))
                .frame(height: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(self.presentationLanguage.text("现在", "Now"))
    }

    private func eventRow(
        _ item: DetailTimelineItem,
        connectsBelow: Bool) -> some View
    {
        let tint = self.tint(for: item)
        return HStack(alignment: .top, spacing: 8) {
            VStack(spacing: 2) {
                self.node(for: item, tint: tint)
                if connectsBelow {
                    ResetTimelineConnector()
                        .stroke(
                            Color.secondary.opacity(0.34),
                            style: StrokeStyle(
                                lineWidth: 1,
                                lineCap: .round,
                                dash: item.state == "inferred" ? [3, 3] : []))
                        .frame(width: 1)
                        .frame(minHeight: 30)
                }
            }
            .frame(width: 22)

            VStack(alignment: .leading, spacing: 2) {
                HStack(alignment: .firstTextBaseline, spacing: 6) {
                    Text(item.title)
                        .font(.caption.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(item.badge)
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(tint)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(tint.opacity(0.12), in: Capsule())
                    Spacer(minLength: 0)
                    if item.link != nil {
                        Image(systemName: "arrow.up.right.square")
                            .font(.caption2)
                            .foregroundStyle(.tertiary)
                    }
                }
                if let timeText = self.timeText(for: item) {
                    Text(timeText)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if let detail = item.detail, !detail.isEmpty {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let publishedText = self.publishedText(for: item) {
                    Text(publishedText)
                        .font(.system(size: 9))
                        .foregroundStyle(.tertiary)
                }
            }
            .padding(.bottom, connectsBelow ? 3 : 0)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(self.accessibilityText(for: item))
    }

    private func node(for item: DetailTimelineItem, tint: Color) -> some View {
        let filled = ["pending", "confirmed"].contains(item.state)
        return ZStack {
            Circle()
                .fill(filled ? tint.opacity(0.16) : Color.clear)
            Circle()
                .stroke(
                    tint.opacity(0.9),
                    style: StrokeStyle(
                        lineWidth: 1.2,
                        dash: item.state == "inferred" ? [2.5, 2.5] : []))
            Image(systemName: self.symbolName(for: item))
                .font(.system(size: 9, weight: .semibold))
                .symbolRenderingMode(.hierarchical)
                .foregroundStyle(tint)
        }
        .frame(width: 22, height: 22)
    }

    private func symbolName(for item: DetailTimelineItem) -> String {
        switch item.kind {
        case "candidate": "quote.bubble"
        case "announcement": "megaphone.fill"
        case "commitment": "calendar.badge.clock"
        case "natural": "calendar.badge.clock"
        case "upgrade": "arrow.up"
        case "credit": "ticket.fill"
        default: item.state == "confirmed" ? "checkmark" : "arrow.clockwise"
        }
    }

    private func tint(for item: DetailTimelineItem) -> Color {
        switch item.state {
        case "confirmed": .green
        case "pending": .accentColor
        default: .secondary
        }
    }

    private func upcomingItems(at now: Date) -> [DetailTimelineItem] {
        self.visualization.items
            .filter { item in
                guard let boundary = self.date(item.endAt) ?? self.date(item.at) else { return true }
                return boundary >= now
            }
            .sorted { left, right in
                let leftDate = self.date(left.at) ?? .distantPast
                let rightDate = self.date(right.at) ?? .distantPast
                let leftActive = leftDate <= now && (self.date(left.endAt) ?? leftDate) >= now
                let rightActive = rightDate <= now && (self.date(right.endAt) ?? rightDate) >= now
                if leftActive != rightActive { return leftActive }
                return leftDate < rightDate
            }
    }

    private func pastItems(at now: Date) -> [DetailTimelineItem] {
        self.visualization.items
            .filter { item in
                guard let boundary = self.date(item.endAt) ?? self.date(item.at) else { return false }
                return boundary < now
            }
            .sorted {
                (self.date($0.at) ?? .distantPast) > (self.date($1.at) ?? .distantPast)
            }
    }

    private func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        return AlternatingDisplay.date(from: value)
    }

    private func timeText(for item: DetailTimelineItem) -> String? {
        guard let start = self.date(item.at) else { return nil }
        let startText = self.format(start)
        if let end = self.date(item.endAt), abs(end.timeIntervalSince(start)) > 60 {
            return "\(startText)–\(self.format(end)) UTC+8"
        }
        return "\(startText) UTC+8"
    }

    private func publishedText(for item: DetailTimelineItem) -> String? {
        guard
            let published = self.date(item.publishedAt),
            item.kind == "candidate" || item.kind == "announcement" || item.kind == "commitment"
        else { return nil }
        return self.presentationLanguage.text(
            "发布于 \(self.format(published)) UTC+8",
            "Published \(self.format(published)) UTC+8")
    }

    private func format(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = self.presentationLanguage.locale
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = self.presentationLanguage == .english ? "MMM d HH:mm" : "MM-dd HH:mm"
        return formatter.string(from: date)
    }

    private func accessibilityText(for item: DetailTimelineItem) -> String {
        [item.badge, item.title, self.timeText(for: item), item.detail]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: "，")
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
                    if let visualizations = section.visualizations {
                        ForEach(visualizations) { visualization in
                            if visualization.kind == "timeline" {
                                ResetEventTimeline(visualization: visualization)
                            }
                        }
                        if !visualizations.isEmpty, !section.rows.isEmpty {
                            Divider().opacity(0.55)
                        }
                    }
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
                            if let progress = row.progress {
                                DetailDecisionProgress(progress: progress)
                                    .padding(.top, 3)
                            }
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
        case "建议主线", "Suggested Mainlines", "可继续的任务", "Suggested Tasks": "play.circle"
        case "账户", "Accounts": "person.2"
        case "为什么这样建议", "Why This Plan": "chart.line.uptrend.xyaxis"
        case "重置", "Resets": "clock.arrow.circlepath"
        default: "list.bullet.rectangle"
        }
    }
}
