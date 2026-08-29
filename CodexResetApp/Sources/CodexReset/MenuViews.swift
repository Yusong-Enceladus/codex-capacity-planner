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
                .font(.caption.bold())
                .fixedSize(horizontal: false, vertical: true)
            CompactDecisionProgress(
                progress: progress,
                tint: self.tint,
                highlighted: self.highlight.isHighlighted)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(progress.currentLabel)
                Spacer(minLength: 8)
                self.legend(color: .red, text: progress.targetLabel)
            }
            .font(.caption2)
            .monospacedDigit()
            .fixedSize(horizontal: false, vertical: true)
            self.legend(color: .cyan, text: progress.projectedLabel)
                .font(.caption2)
                .monospacedDigit()
                .fixedSize(horizontal: false, vertical: true)
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
                        .fixedSize(horizontal: false, vertical: true)
                    if let secondary = action.secondaryValue {
                        Text(secondary)
                            .font(.caption2)
                            .foregroundStyle(self.highlighted ? .white.opacity(0.78) : .secondary)
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
                                    .fixedSize(horizontal: false, vertical: true)
                                if let secondary = row.secondaryValue {
                                    Text(secondary)
                                        .font(.caption2)
                                        .foregroundStyle(self.highlighted ? .white.opacity(0.7) : .secondary)
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

enum ResetTimelinePresentation {
    static func title(
        for item: DetailTimelineItem,
        language: ResetPresentationLanguage) -> String
    {
        switch item.kind {
        case "candidate": language.text("可能重置的时间范围", "Possible reset window")
        case "announcement": language.text("明确重置公告", "Confirmed reset announcement")
        case "commitment": language.text("有期限重置承诺", "Dated reset commitment")
        case "natural":
            item.state == "confirmed"
                ? language.text("自然刷新", "Natural reset")
                : language.text("下次自然刷新", "Next natural reset")
        case "upgrade": language.text("套餐升级刷新", "Plan upgrade reset")
        case "credit": language.text("重置券发放", "Reset credit delivery")
        case "reset":
            item.state == "confirmed"
                ? language.text("已确认的强制刷新", "Confirmed forced reset")
                : language.text("强制刷新", "Forced reset")
        default: item.title
        }
    }

    static func badge(
        for item: DetailTimelineItem,
        language: ResetPresentationLanguage) -> String
    {
        switch item.state {
        case "inferred": language.text("未确认", "Unconfirmed")
        case "pending": language.text("等待到账", "Pending")
        case "confirmed": language.text("已确认", "Confirmed")
        case "scheduled": language.text("计划", "Scheduled")
        default: item.badge
        }
    }

    static func detail(
        for item: DetailTimelineItem,
        language: ResetPresentationLanguage) -> String?
    {
        language == .english ? item.detailEnglish ?? item.detail : item.detail
    }

    static func timeText(
        for item: DetailTimelineItem,
        language: ResetPresentationLanguage) -> String?
    {
        if item.kind == "candidate" {
            guard let start = self.date(item.at) else {
                return language.text(
                    "有可能重置，但目前无法确定时间",
                    "A reset is possible, but its timing is unknown.")
            }
            return self.possibleResetWindowText(
                start: start,
                end: self.date(item.endAt),
                language: language)
        }

        guard let start = self.date(item.at) else { return nil }
        return "\(self.pointText(start, language: language)) \(language.timeZoneLabel)"
    }

    static func publishedText(
        for item: DetailTimelineItem,
        language: ResetPresentationLanguage) -> String?
    {
        guard
            let published = self.date(item.publishedAt),
            ["candidate", "announcement", "commitment"].contains(item.kind)
        else { return nil }
        let point = "\(self.pointText(published, language: language)) \(language.timeZoneLabel)"
        return language.text("发布于 \(point)", "Published \(point)")
    }

    static func rangeStartTitle(
        for item: DetailTimelineItem,
        language: ResetPresentationLanguage) -> String
    {
        item.kind == "candidate"
            ? language.text("可能重置的时间范围开始", "Possible reset window begins")
            : language.text("重置时间范围开始", "Reset window begins")
    }

    static func rangeEndTitle(
        for item: DetailTimelineItem,
        language: ResetPresentationLanguage) -> String
    {
        item.kind == "candidate"
            ? language.text("可能重置的时间范围结束", "Possible reset window ends")
            : language.text("重置时间范围结束", "Reset window ends")
    }

    static func boundaryText(
        _ value: String?,
        language: ResetPresentationLanguage) -> String?
    {
        guard let value, let date = self.date(value) else { return nil }
        return "\(self.pointText(date, language: language)) \(language.timeZoneLabel)"
    }

    private static func possibleResetWindowText(
        start: Date,
        end: Date?,
        language: ResetPresentationLanguage) -> String
    {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = language.timeZone
        let end = end ?? start
        let sameDay = calendar.isDate(start, inSameDayAs: end)

        let startPattern = language == .english ? "MMM d, h:mm a" : "M月d日 HH:mm"
        let sameDayEndPattern = language == .english ? "h:mm a" : "HH:mm"
        let differentDayEndPattern = startPattern
        let startText = self.formatter(startPattern, language: language).string(from: start)
        let endText = self.formatter(
            sameDay ? sameDayEndPattern : differentDayEndPattern,
            language: language).string(from: end)
        return "\(startText)–\(endText) \(language.timeZoneLabel)"
    }

    private static func pointText(
        _ date: Date,
        language: ResetPresentationLanguage) -> String
    {
        let pattern = language == .english ? "MMM d, h:mm a" : "M月d日 HH:mm"
        return self.formatter(pattern, language: language).string(from: date)
    }

    private static func formatter(
        _ pattern: String,
        language: ResetPresentationLanguage) -> DateFormatter
    {
        let formatter = DateFormatter()
        formatter.locale = language == .english
            ? Locale(identifier: "en_US_POSIX")
            : language.locale
        formatter.timeZone = language.timeZone
        formatter.dateFormat = pattern
        return formatter
    }

    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        return AlternatingDisplay.date(from: value)
    }
}

enum ResetTimelineLayout {
    static func pastItems(_ items: [DetailTimelineItem], at now: Date) -> [DetailTimelineItem] {
        items
            .filter { item in
                guard let boundary = self.date(item.endAt) ?? self.date(item.at) else { return false }
                return boundary < now
            }
            .sorted {
                (self.date($0.at) ?? .distantPast) < (self.date($1.at) ?? .distantPast)
            }
    }

    static func activeItems(_ items: [DetailTimelineItem], at now: Date) -> [DetailTimelineItem] {
        items
            .filter { item in
                guard
                    let start = self.date(item.at),
                    let end = self.date(item.endAt),
                    end >= start
                else { return false }
                return start <= now && now <= end
            }
            .sorted {
                (self.date($0.at) ?? .distantPast) < (self.date($1.at) ?? .distantPast)
            }
    }

    static func futureItems(_ items: [DetailTimelineItem], at now: Date) -> [DetailTimelineItem] {
        items
            .filter { item in
                guard let start = self.date(item.at) else { return false }
                return start > now
            }
            .sorted {
                (self.date($0.at) ?? .distantFuture) < (self.date($1.at) ?? .distantFuture)
            }
    }

    static func undatedItems(_ items: [DetailTimelineItem]) -> [DetailTimelineItem] {
        items.filter { self.date($0.at) == nil && self.date($0.endAt) == nil }
    }

    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        return AlternatingDisplay.date(from: value)
    }
}

private struct ResetEventTimeline: View {
    @Environment(\.resetPresentationLanguage) private var presentationLanguage
    let visualization: DetailVisualization

    var body: some View {
        TimelineView(.periodic(from: .now, by: 60)) { context in
            let past = ResetTimelineLayout.pastItems(self.visualization.items, at: context.date)
            let active = ResetTimelineLayout.activeItems(self.visualization.items, at: context.date)
            let future = ResetTimelineLayout.futureItems(self.visualization.items, at: context.date)
            let undated = ResetTimelineLayout.undatedItems(self.visualization.items)
            VStack(alignment: .leading, spacing: 0) {
                ForEach(past) { item in
                    self.eventRow(item, connectsBelow: true)
                }
                if active.isEmpty {
                    self.nowDivider(activeItems: [])
                        .padding(.vertical, 3)
                } else {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(active) { item in
                            self.eventRow(
                                item,
                                connectsBelow: true,
                                titleOverride: ResetTimelinePresentation.rangeStartTitle(
                                    for: item,
                                    language: self.presentationLanguage),
                                timeOverride: ResetTimelinePresentation.boundaryText(
                                    item.at,
                                    language: self.presentationLanguage))
                        }
                        self.nowDivider(activeItems: active)
                            .padding(.vertical, 3)
                        ForEach(Array(active.enumerated()), id: \.element.id) { index, item in
                            self.rangeEndRow(
                                item,
                                connectsBelow: index < active.count - 1 || !future.isEmpty || !undated.isEmpty)
                        }
                    }
                    .padding(6)
                    .background {
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(Color.secondary.opacity(0.035))
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(
                                Color.secondary.opacity(0.38),
                                style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                    }
                    .padding(.vertical, 3)
                }
                ForEach(Array(future.enumerated()), id: \.element.id) { index, item in
                    self.eventRow(
                        item,
                        connectsBelow: index < future.count - 1 || !undated.isEmpty)
                }
                ForEach(Array(undated.enumerated()), id: \.element.id) { index, item in
                    self.eventRow(item, connectsBelow: index < undated.count - 1)
                }
            }
        }
    }

    private func nowDivider(activeItems: [DetailTimelineItem]) -> some View {
        let insidePossibleResetWindow = activeItems.contains { $0.kind == "candidate" }
        let insideConfirmedResetWindow = !activeItems.isEmpty && !insidePossibleResetWindow
        return HStack(spacing: 8) {
            ZStack {
                Circle().fill(Color.secondary.opacity(0.14))
                Image(systemName: "clock")
                    .font(.system(size: 8, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
            .frame(width: 22, height: 22)
            Text(insidePossibleResetWindow
                ? self.presentationLanguage.text(
                    "现在 · 正处于这个可能重置的时间范围内",
                    "Now · Within this possible reset window")
                : insideConfirmedResetWindow
                    ? self.presentationLanguage.text(
                        "现在 · 正处于已公告的重置时间范围内",
                        "Now · Within the announced reset window")
                : self.presentationLanguage.text("现在", "Now"))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            Rectangle()
                .fill(Color.secondary.opacity(0.22))
                .frame(height: 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(insidePossibleResetWindow
            ? self.presentationLanguage.text(
                "现在，正处于这个可能重置的时间范围内",
                "Now, within this possible reset window")
            : insideConfirmedResetWindow
                ? self.presentationLanguage.text(
                    "现在，正处于已公告的重置时间范围内",
                    "Now, within the announced reset window")
            : self.presentationLanguage.text("现在", "Now"))
    }

    private func eventRow(
        _ item: DetailTimelineItem,
        connectsBelow: Bool,
        titleOverride: String? = nil,
        timeOverride: String? = nil,
        includeDetail: Bool = true,
        includePublished: Bool = true) -> some View
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
                    Text(titleOverride ?? ResetTimelinePresentation.title(
                        for: item,
                        language: self.presentationLanguage))
                        .font(.caption.weight(.semibold))
                        .fixedSize(horizontal: false, vertical: true)
                    Text(ResetTimelinePresentation.badge(
                        for: item,
                        language: self.presentationLanguage))
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(tint)
                        .padding(.horizontal, 5)
                        .padding(.vertical, 1)
                        .background(tint.opacity(0.12), in: Capsule())
                    Spacer(minLength: 0)
                }
                if let timeText = timeOverride ?? self.timeText(for: item) {
                    Text(timeText)
                        .font(.caption2.monospacedDigit())
                        .foregroundStyle(.secondary)
                }
                if includeDetail, let detail = ResetTimelinePresentation.detail(
                    for: item,
                    language: self.presentationLanguage), !detail.isEmpty
                {
                    Text(detail)
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if includePublished, let publishedText = self.publishedText(for: item) {
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

    private func rangeEndRow(
        _ item: DetailTimelineItem,
        connectsBelow: Bool) -> some View
    {
        self.eventRow(
            item,
            connectsBelow: connectsBelow,
            titleOverride: ResetTimelinePresentation.rangeEndTitle(
                for: item,
                language: self.presentationLanguage),
            timeOverride: ResetTimelinePresentation.boundaryText(
                item.endAt,
                language: self.presentationLanguage),
            includeDetail: false,
            includePublished: false)
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

    private func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        return AlternatingDisplay.date(from: value)
    }

    private func timeText(for item: DetailTimelineItem) -> String? {
        ResetTimelinePresentation.timeText(for: item, language: self.presentationLanguage)
    }

    private func publishedText(for item: DetailTimelineItem) -> String? {
        ResetTimelinePresentation.publishedText(for: item, language: self.presentationLanguage)
    }

    private func accessibilityText(for item: DetailTimelineItem) -> String {
        [
            ResetTimelinePresentation.badge(for: item, language: self.presentationLanguage),
            ResetTimelinePresentation.title(for: item, language: self.presentationLanguage),
            self.timeText(for: item),
            ResetTimelinePresentation.detail(for: item, language: self.presentationLanguage),
        ]
            .compactMap { $0 }
            .filter { !$0.isEmpty }
            .joined(separator: "，")
    }
}

enum ResetCreditPresentation {
    static func actionLabel(
        _ summary: ResetCreditSummary,
        language: ResetPresentationLanguage) -> String
    {
        switch summary.action {
        case "redeem": language.text("现在使用", "Use now")
        case "prepare": language.text("准备使用", "Prepare")
        case "awaiting-delivery": language.text("等待到账", "Pending")
        default: language.text("暂时保留", "Hold")
        }
    }

    static func strategyTitle(
        _ summary: ResetCreditSummary,
        language: ResetPresentationLanguage) -> String
    {
        switch summary.status {
        case "possible-reset-first":
            language.text("先等可能的免费刷新", "Wait for the possible free reset")
        case "account-data-unready":
            language.text("等所有账户用量确认", "Wait for every account")
        case "free-reset-first":
            language.text("先用会被清零的现有用量", "Use capacity before the free reset")
        case "expiry-unknown":
            language.text("到期时间未知，暂不安排", "Expiry unknown; no timing yet")
        case "must-form-node":
            language.text("先形成高价值使用节点", "Build a high-value use point")
        case "interruption-now":
            language.text("所有账户已阻塞，可以使用", "All accounts are blocked; use a credit")
        default:
            summary.action == "prepare"
                ? language.text("高价值节点正在接近", "A high-value point is approaching")
                : language.text("先使用现有账户容量", "Use existing account capacity first")
        }
    }

    static func strategyDetail(
        _ summary: ResetCreditSummary,
        language: ResetPresentationLanguage) -> String
    {
        switch summary.status {
        case "possible-reset-first":
            let boundary = self.point(summary.possibleResetWindowEndAt, language: language)
            return language.text(
                boundary.map { "等到 \($0) 或本机更早确认刷新后，再按两种结果重新计算。" }
                    ?? "等暗示得到确认、失效或本机确认刷新后，再按两种结果重新计算。",
                boundary.map { "Recalculate both outcomes after \($0), or sooner if a local reset is confirmed." }
                    ?? "Recalculate both outcomes when the signal is confirmed, expires, or a local reset is observed.")
        case "account-data-unready":
            return language.text(
                "至少一个账户还没有新鲜、精确的用量，数据齐全前不会建议兑换。",
                "At least one account lacks fresh, exact usage; redemption stays disabled.")
        case "free-reset-first":
            let boundary = self.point(summary.nextFreeResetAt, language: language)
            return language.text(
                boundary.map { "免费刷新会在 \($0) 先到；到账后整条容量链重新计算。" }
                    ?? "更早的免费刷新会先到；到账后整条容量链重新计算。",
                boundary.map { "A free reset arrives first at \($0); recalculate the full capacity chain afterward." }
                    ?? "An earlier free reset arrives first; recalculate the full capacity chain afterward.")
        case "expiry-unknown":
            return language.text(
                "系统不会编造兑换日期或伪精确价值。",
                "The planner will not invent a redemption time or false precision.")
        case "must-form-node":
            return language.text(
                "继续真实工作，让兑换后新增容量能够被充分使用。",
                "Continue real work so the capacity added by redemption can be used well.")
        case "interruption-now":
            return language.text(
                "两种刷新结果都能承接足够工作；系统只提示，不会自动使用。",
                "Both reset outcomes support enough work; the planner advises but never redeems automatically.")
        default:
            return language.text(
                "已先比较其他账户容量、免费刷新和券到期时间。",
                "Other-account capacity, free resets, and credit expiry were checked first.")
        }
    }

    static func expiryText(
        _ item: DetailTimelineItem,
        now: Date,
        language: ResetPresentationLanguage) -> String
    {
        guard let expiry = self.date(item.endAt) else {
            return language.text("未提供到期时间", "No expiry provided")
        }
        let exact = self.point(item.endAt, language: language) ?? ""
        let interval = max(0, expiry.timeIntervalSince(now))
        let totalHours = Int(interval / 3_600)
        let relative: String
        if totalHours < 1 {
            relative = language.text("不到 1 小时", "under 1 hr")
        } else if totalHours < 24 {
            relative = language.text("约 \(totalHours) 小时", "about \(totalHours) hr")
        } else {
            let days = totalHours / 24
            let hours = totalHours % 24
            relative = hours == 0
                ? language.text("约 \(days) 天", "about \(days) days")
                : language.text("约 \(days) 天 \(hours) 小时", "about \(days) days \(hours) hr")
        }
        return language.text("\(exact) 到期 · 剩余\(relative)", "Expires \(exact) · \(relative) left")
    }

    static func windowText(
        _ summary: ResetCreditSummary,
        language: ResetPresentationLanguage) -> String
    {
        guard let start = self.date(summary.optimalWindowStartAt),
              let end = self.date(summary.optimalWindowEndAt)
        else {
            return language.text("尚未形成安全节点", "No safe point yet")
        }
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = language.timeZone
        let sameDay = calendar.isDate(start, inSameDayAs: end)
        let startPattern = language == .english ? "MMM d, h:mm a" : "M月d日 HH:mm"
        let endPattern = sameDay
            ? (language == .english ? "h:mm a" : "HH:mm")
            : startPattern
        return "\(self.format(start, pattern: startPattern, language: language))–\(self.format(end, pattern: endPattern, language: language)) \(language.timeZoneLabel)"
    }

    static func lifetimeRatio(_ item: DetailTimelineItem, now: Date) -> Double? {
        guard let start = self.date(item.at),
              let end = self.date(item.endAt),
              end > start
        else { return nil }
        return min(1, max(0, now.timeIntervalSince(start) / end.timeIntervalSince(start)))
    }

    static func hoursUntilExpiry(_ item: DetailTimelineItem, now: Date) -> Double? {
        guard let expiry = self.date(item.endAt) else { return nil }
        return max(0, expiry.timeIntervalSince(now) / 3_600)
    }

    private static func point(
        _ value: String?,
        language: ResetPresentationLanguage) -> String?
    {
        ResetTimelinePresentation.boundaryText(value, language: language)
    }

    private static func date(_ value: String?) -> Date? {
        guard let value else { return nil }
        return AlternatingDisplay.date(from: value)
    }

    private static func format(
        _ date: Date,
        pattern: String,
        language: ResetPresentationLanguage) -> String
    {
        let formatter = DateFormatter()
        formatter.locale = language == .english
            ? Locale(identifier: "en_US_POSIX")
            : language.locale
        formatter.timeZone = language.timeZone
        formatter.dateFormat = pattern
        return formatter.string(from: date)
    }
}

private struct ResetCreditSummaryView: View {
    @Environment(\.resetPresentationLanguage) private var presentationLanguage
    let visualization: DetailVisualization

    private var tint: Color { Color(red: 0.55, green: 0.39, blue: 0.96) }

    var body: some View {
        if let summary = self.visualization.creditSummary {
            TimelineView(.periodic(from: .now, by: 60)) { context in
                VStack(alignment: .leading, spacing: 10) {
                    self.header(summary)
                    self.strategy(summary)
                    self.inventory(at: context.date)
                    self.metrics(summary)
                    if summary.status == "possible-reset-first" {
                        self.outcomes
                    }
                }
            }
        }
    }

    private func header(_ summary: ResetCreditSummary) -> some View {
        HStack(spacing: 9) {
            ZStack {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(self.tint.opacity(0.14))
                Image(systemName: "ticket.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(self.tint)
            }
            .frame(width: 30, height: 30)
            VStack(alignment: .leading, spacing: 1) {
                Text(self.presentationLanguage.text("重置券", "Reset Credits"))
                    .font(.subheadline.weight(.semibold))
                Text(self.presentationLanguage.text(
                    self.headerSubtitle(summary, chinese: true),
                    self.headerSubtitle(summary, chinese: false)))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: 6)
            Label(
                ResetCreditPresentation.actionLabel(summary, language: self.presentationLanguage),
                systemImage: self.actionSymbol(summary.action))
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(self.actionTint(summary.action))
                .padding(.horizontal, 7)
                .padding(.vertical, 4)
                .background(self.actionTint(summary.action).opacity(0.11), in: Capsule())
        }
    }

    private func strategy(_ summary: ResetCreditSummary) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: self.actionSymbol(summary.action))
                .font(.caption.weight(.semibold))
                .foregroundStyle(self.actionTint(summary.action))
                .frame(width: 18, height: 18)
                .background(self.actionTint(summary.action).opacity(0.1), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text(ResetCreditPresentation.strategyTitle(
                    summary,
                    language: self.presentationLanguage))
                    .font(.caption.weight(.semibold))
                Text(ResetCreditPresentation.strategyDetail(
                    summary,
                    language: self.presentationLanguage))
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(self.actionTint(summary.action).opacity(0.07), in: RoundedRectangle(cornerRadius: 8))
    }

    private func inventory(at now: Date) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(self.presentationLanguage.text("逐券到期时间", "Expiry by credit"))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            ForEach(self.accountGroups) { group in
                VStack(alignment: .leading, spacing: 6) {
                    HStack(spacing: 6) {
                        Text(group.title)
                            .font(.caption.weight(.semibold))
                            .fixedSize(horizontal: false, vertical: true)
                        if group.isCurrent {
                            Text(self.presentationLanguage.text("当前账户", "Current"))
                                .font(.system(size: 8, weight: .semibold))
                                .foregroundStyle(self.tint)
                                .padding(.horizontal, 5)
                                .padding(.vertical, 1)
                                .background(self.tint.opacity(0.1), in: Capsule())
                        }
                        Spacer(minLength: 0)
                        Text("×\(group.items.count)")
                            .font(.caption2.monospacedDigit())
                            .foregroundStyle(.secondary)
                    }
                    ForEach(Array(group.items.enumerated()), id: \.element.id) { index, item in
                        self.creditRow(item, index: index, now: now)
                    }
                }
                .padding(8)
                .background(Color.secondary.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))
            }
        }
    }

    private func creditRow(_ item: DetailTimelineItem, index: Int, now: Date) -> some View {
        let urgency = ResetCreditPresentation.hoursUntilExpiry(item, now: now)
        let color = self.expiryTint(urgency)
        return VStack(alignment: .leading, spacing: 4) {
            HStack(spacing: 6) {
                Image(systemName: "ticket")
                    .font(.caption2.weight(.semibold))
                    .foregroundStyle(color)
                Text(self.presentationLanguage.text(
                    "重置券 \(index + 1)",
                    "Credit \(index + 1)"))
                    .font(.caption2.weight(.semibold))
                Spacer(minLength: 4)
                if let urgency {
                    Label(
                        self.urgencyLabel(urgency),
                        systemImage: urgency < 24 ? "exclamationmark.circle.fill" : "clock")
                        .font(.system(size: 8, weight: .semibold))
                        .foregroundStyle(color)
                }
            }
            Text(ResetCreditPresentation.expiryText(
                item,
                now: now,
                language: self.presentationLanguage))
                .font(.system(size: 9).monospacedDigit())
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
            if let ratio = ResetCreditPresentation.lifetimeRatio(item, now: now) {
                GeometryReader { geometry in
                    ZStack(alignment: .leading) {
                        Capsule().fill(Color.secondary.opacity(0.16))
                        Capsule().fill(color.opacity(0.75))
                            .frame(width: max(3, geometry.size.width * ratio))
                    }
                }
                .frame(height: 4)
                .accessibilityHidden(true)
            }
        }
    }

    private func metrics(_ summary: ResetCreditSummary) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .top, spacing: 7) {
                self.metricCard(
                    icon: "plus.circle",
                    label: self.presentationLanguage.text("净容量价值", "Net capacity"),
                    value: summary.bestNetPercent.map { "+\(self.percent($0))" }
                        ?? self.presentationLanguage.text("待验证", "Pending"),
                    detail: summary.bestNetCapacityUSD.map {
                        self.presentationLanguage.text(
                            "约 $\(String(format: "%.2f", $0)) API 等价",
                            "About $\(String(format: "%.2f", $0)) API-equivalent")
                    } ?? self.presentationLanguage.text("尚无可靠正收益节点", "No verified positive-value point"))
                self.metricCard(
                    icon: "gauge.with.dots.needle.33percent",
                    label: self.presentationLanguage.text("完整容量", "Full capacity"),
                    value: summary.fullCapacityUSD.map { "$\(String(format: "%.0f", $0))" }
                        ?? self.presentationLanguage.text("学习中", "Learning"),
                    detail: self.presentationLanguage.text("API 等价估算", "API-equivalent estimate"))
            }
            HStack(alignment: .top, spacing: 8) {
                Image(systemName: "clock.badge.checkmark")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(self.tint)
                VStack(alignment: .leading, spacing: 2) {
                    Text(self.presentationLanguage.text("高价值使用时段", "High-value window"))
                        .font(.caption2.weight(.semibold))
                        .foregroundStyle(.secondary)
                    Text(ResetCreditPresentation.windowText(
                        summary,
                        language: self.presentationLanguage))
                        .font(.caption.monospacedDigit())
                        .fixedSize(horizontal: false, vertical: true)
                    if let account = summary.accountLabel, !account.isEmpty {
                        Text(account)
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            .padding(8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color.secondary.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))
        }
    }

    private var outcomes: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(self.presentationLanguage.text("两种结果分别处理", "Two outcomes, handled separately"))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            HStack(spacing: 6) {
                self.outcomeCard(
                    icon: "arrow.clockwise.circle",
                    title: self.presentationLanguage.text("发生免费刷新", "Free reset happens"),
                    result: self.presentationLanguage.text("保留券并重算", "Keep credit; recalculate"))
                Image(systemName: "arrow.right")
                    .font(.system(size: 9))
                    .foregroundStyle(.tertiary)
                self.outcomeCard(
                    icon: "clock.arrow.circlepath",
                    title: self.presentationLanguage.text("没有发生", "No free reset"),
                    result: self.presentationLanguage.text("范围结束后重算", "Recalculate after window"))
            }
        }
    }

    private func metricCard(icon: String, label: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(label, systemImage: icon)
                .font(.system(size: 9, weight: .semibold))
                .foregroundStyle(.secondary)
            Text(value)
                .font(.caption.weight(.semibold).monospacedDigit())
            Text(detail)
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Color.secondary.opacity(0.055), in: RoundedRectangle(cornerRadius: 8))
    }

    private func outcomeCard(icon: String, title: String, result: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Label(title, systemImage: icon)
                .font(.system(size: 8, weight: .semibold))
            Text(result)
                .font(.system(size: 8))
                .foregroundStyle(.secondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(6)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(self.tint.opacity(0.06), in: RoundedRectangle(cornerRadius: 7))
    }

    private var accountGroups: [CreditAccountGroup] {
        var order: [String] = []
        var values: [String: [DetailTimelineItem]] = [:]
        var titles: [String: String] = [:]
        for item in self.visualization.items where item.kind == "credit" {
            let key = item.detail ?? item.title
            if values[key] == nil { order.append(key) }
            values[key, default: []].append(item)
            titles[key] = item.title
        }
        return order.compactMap { key in
            guard let items = values[key], let title = titles[key] else { return nil }
            return CreditAccountGroup(
                key: key,
                title: title,
                items: items,
                isCurrent: items.contains { $0.state == "current" })
        }
    }

    private func headerSubtitle(_ summary: ResetCreditSummary, chinese: Bool) -> String {
        let base = chinese
            ? "\(summary.availableCount) 次可用 · \(self.accountGroups.count) 个账户"
            : "\(summary.availableCount) available · \(self.accountGroups.count) accounts"
        if let delivered = summary.deliveredAccountCount,
           let total = summary.deliveryAccountCount
        {
            return base + (chinese ? " · \(delivered)/\(total) 已到账" : " · \(delivered)/\(total) delivered")
        }
        if summary.officialState == "available" {
            return base + (chinese ? " · 官方已生效" : " · Officially available")
        }
        return base
    }

    private func actionSymbol(_ action: String) -> String {
        switch action {
        case "redeem": "bolt.fill"
        case "prepare": "timer"
        case "awaiting-delivery": "shippingbox"
        default: "pause.fill"
        }
    }

    private func actionTint(_ action: String) -> Color {
        switch action {
        case "redeem": .red
        case "prepare": .orange
        case "awaiting-delivery": .secondary
        default: self.tint
        }
    }

    private func expiryTint(_ hours: Double?) -> Color {
        guard let hours else { return .secondary }
        if hours < 24 { return .red }
        if hours < 72 { return .orange }
        return self.tint
    }

    private func urgencyLabel(_ hours: Double) -> String {
        if hours < 24 { return self.presentationLanguage.text("即将到期", "Expiring soon") }
        if hours < 72 { return self.presentationLanguage.text("接近到期", "Due soon") }
        return self.presentationLanguage.text("有效", "Available")
    }

    private func percent(_ value: Double) -> String {
        String(format: "%.1f%%", value)
    }
}

private struct CreditAccountGroup: Identifiable {
    let key: String
    let title: String
    let items: [DetailTimelineItem]
    let isCurrent: Bool

    var id: String { self.key }
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
                            } else if visualization.kind == "resetCredits" {
                                ResetCreditSummaryView(visualization: visualization)
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
        case "用量与目标", "Usage & Targets", "账户", "Accounts": "scope"
        case "为什么这样建议", "Why This Plan": "chart.line.uptrend.xyaxis"
        case "重置", "Resets": "clock.arrow.circlepath"
        default: "list.bullet.rectangle"
        }
    }
}
