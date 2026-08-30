import Charts
import SwiftUI

struct UsageTargetsView: View {
    let section: DetailSection
    @ObservedObject var store: UsageHistoryStore
    @Environment(\.resetPresentationLanguage) private var language
    @State private var showsCustomDays = false
    @State private var customDays = "30"

    private var sharedMaximum: Double {
        max(1, self.store.snapshot?.accounts.flatMap(\.days)
            .compactMap { self.store.metric.value($0.totals) }.max() ?? 1)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(self.language.text("用量与目标", "Usage & Targets")).font(.system(size: 16, weight: .semibold))
                Spacer()
                if self.store.isLoading { ProgressView().controlSize(.small) }
            }
            self.controls
            ForEach(self.section.rows) { row in
                VStack(alignment: .leading, spacing: 7) {
                    Text(row.label).font(.system(size: 14, weight: .semibold))
                    Text(row.value).font(.system(size: 13)).fixedSize(horizontal: false, vertical: true)
                    if let progress = row.progress { DetailDecisionProgress(progress: progress) }
                    if let secondary = row.secondaryValue {
                        Text(secondary).font(.system(size: 12)).foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    if let id = row.accountId {
                        if let account = self.store.snapshot?.accounts.first(where: { $0.id == id }), account.coverage != "unavailable" {
                            DailyUsageHistoryView(account: account, metric: self.store.metric, maximum: self.sharedMaximum)
                                .padding(.top, 4)
                        } else {
                            Label(self.emptyAccountText, systemImage: "info.circle")
                                .font(.system(size: 12)).foregroundStyle(.secondary)
                                .fixedSize(horizontal: false, vertical: true).padding(.top, 3)
                        }
                    }
                }
                Divider()
            }
            if let unassigned = self.store.snapshot?.unassigned, unassigned.totals.eventCount > 0 {
                VStack(alignment: .leading, spacing: 8) {
                    Text(self.language.text("未归属的本机用量", "Unassigned local usage"))
                        .font(.system(size: 14, weight: .semibold))
                    Text(self.language.text(
                        "这些记录没有可靠的账号标识，未计入上方任何账号。",
                        "These records lack a reliable account identity and are not assigned to any account above."))
                        .font(.system(size: 12)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    DailyUsageHistoryView(account: unassigned, metric: self.store.metric,
                        maximum: max(1, unassigned.days.compactMap { self.store.metric.value($0.totals) }.max() ?? 1))
                }
                Divider()
            }
            self.sourceNote
        }
        .font(.system(size: 13))
        .task { await self.store.refresh() }
    }

    private var emptyAccountText: String {
        if self.store.isLoading && self.store.snapshot == nil {
            return self.language.text("正在读取本机历史记录…", "Reading local history…")
        }
        if self.store.failed && self.store.snapshot == nil {
            return self.language.text("历史记录暂不可用，会自动重试。", "History is temporarily unavailable; retrying automatically.")
        }
        return self.language.text("这段时间没有可确认归属的记录；这不代表零用量。", "No reliably attributed records in this period; this does not mean zero usage.")
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 5) {
                ForEach([7, 30, 90], id: \.self) { days in
                    Button(self.language.text("\(days) 天", "\(days) days")) {
                        self.store.selectDays(days)
                        self.showsCustomDays = false
                    }
                    .buttonStyle(.bordered).tint(self.store.days == days ? Color(red: 0.55, green: 0.39, blue: 0.96) : .secondary)
                    .accessibilityAddTraits(self.store.days == days ? .isSelected : [])
                }
                Button(self.language.text("自定", "Custom")) {
                    self.customDays = String(self.store.days)
                    self.showsCustomDays.toggle()
                }.buttonStyle(.bordered)
                Spacer(minLength: 0)
            }
            if self.showsCustomDays {
                HStack(spacing: 8) {
                    Text(self.language.text("最近", "Last"))
                    TextField("1–365", text: self.$customDays).textFieldStyle(.roundedBorder).frame(width: 65)
                        .onSubmit(self.applyCustomDays)
                        .accessibilityLabel(self.language.text("历史天数，1 至 365", "History days, 1 to 365"))
                    Text(self.language.text("天（1–365）", "days (1–365)"))
                    Button(self.language.text("应用", "Apply"), action: self.applyCustomDays)
                        .buttonStyle(.bordered).disabled(!self.validCustomDays)
                }
            }
            HStack {
                Picker(self.language.text("统计单位", "Metric"), selection: self.$store.metric) {
                    Text(self.language.text("API 等价估算", "API equivalent")).tag(UsageHistoryMetric.cost)
                    Text(self.language.text("Token", "Tokens")).tag(UsageHistoryMetric.tokens)
                }.pickerStyle(.segmented).labelsHidden().frame(maxWidth: 260)
                    .tint(Color(red: 0.55, green: 0.39, blue: 0.96))
                Spacer(minLength: 8)
                Text(self.language.text("按 UTC+8 分日", "Days in Pacific Time"))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
        }
    }

    private var validCustomDays: Bool { Int(self.customDays).map { (1...365).contains($0) } ?? false }

    private func applyCustomDays() {
        guard let days = Int(self.customDays), (1...365).contains(days) else { return }
        self.store.selectDays(days)
        self.showsCustomDays = false
    }

    private var sourceNote: some View {
        VStack(alignment: .leading, spacing: 5) {
            Text(self.language.text(
                "仅统计本机日志。金额按内置 API 价格估算，不是账单，也不是额度百分比。",
                "Local logs only. Amounts use bundled API price estimates, not a bill or a quota percentage."))
            if let raw = self.store.snapshot?.updatedAt, let date = AlternatingDisplay.date(from: raw) {
                Text(self.language.text("最近采样：", "Last sampled: ") + self.sampleTime(date))
            }
            if let snapshot = self.store.snapshot, !snapshot.sourceComplete {
                Text(self.language.text("旧记录仍在补齐；图中的空白日期不代表零用量。", "History is still being indexed; gaps do not mean zero usage."))
            }
            if let snapshot = self.store.snapshot, snapshot.skippedEvents > 0 {
                Text(self.language.text("部分旧记录没有逐笔时间，未混入按日统计。", "Some older records lack event timestamps and cannot be included in daily totals."))
            }
            if self.store.failed || self.store.snapshot?.collectorStatus == "stale" {
                Text(self.language.text("暂时保留上次读取的历史，稍后自动重试。", "Showing the last available history; a retry is scheduled."))
            }
        }
        .font(.system(size: 11)).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
    }

    private func sampleTime(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = self.language.locale
        formatter.timeZone = self.language.timeZone
        formatter.dateFormat = self.language == .simplifiedChinese ? "M月d日 HH:mm 'UTC+8'" : "MMM d, h:mm a 'PT'"
        return formatter.string(from: date)
    }
}

struct DailyUsageHistoryView: View {
    let account: UsageHistoryAccount
    let metric: UsageHistoryMetric
    let maximum: Double
    @Environment(\.resetPresentationLanguage) private var language
    @State private var hoveredIndex: Int?
    @State private var pinnedDate: String?
    @State private var showsDetails = false
    @State private var detailKind = "models"
    @State private var detailLimit = 8
    private let usageColor = Color(red: 0.55, green: 0.39, blue: 0.96)

    private var selected: UsageHistoryDay? {
        if let hoveredIndex, self.account.days.indices.contains(hoveredIndex) { return self.account.days[hoveredIndex] }
        return self.account.days.first { $0.date == self.pinnedDate } ?? self.account.days.last
    }
    private var peak: UsageHistoryDay? { self.account.peak(self.metric) }
    private var axisValues: [Int] {
        Array(Set([0, max(0, self.account.days.count / 2), max(0, self.account.days.count - 1)])).sorted()
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(alignment: .firstTextBaseline) {
                Text(self.value(self.account.totals)).font(.system(size: 20, weight: .semibold)).monospacedDigit()
                Text(self.language.text("\(self.account.days.count) 天合计", "\(self.account.days.count)-day total"))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                Spacer(minLength: 8)
                if let peak {
                    Text((self.metric == .cost && self.account.totals.hasPartialCost
                        ? self.language.text("已知峰值", "Known peak") : self.language.text("单日最高", "Peak"))
                         + " " + self.value(peak.totals))
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
            self.chart
            self.dayReadout
            if self.account.days.contains(where: { !$0.known }) {
                Text(self.language.text("底部短线：没有可靠记录", "Baseline dashes: no reliable records"))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            if self.metric == .cost && self.account.totals.hasPartialCost {
                Text(self.language.text("空心点：暂无价格 · ≥：仅合计已知价格", "Hollow dots: unpriced · ≥: priced records only"))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
            }
            DisclosureGroup(isExpanded: self.$showsDetails) {
                self.breakdowns.padding(.top, 8)
            } label: {
                Text(self.language.text("模型与任务明细", "Model & task details")).font(.system(size: 12))
            }
        }
        .onChange(of: self.account.days.count) { _, _ in self.hoveredIndex = nil }
    }

    private var chart: some View {
        Chart {
            ForEach(self.account.days) { day in
                if day.known, let value = self.metric.value(day.totals) {
                    BarMark(x: .value("Day", day.date), y: .value("Usage", value), width: .ratio(0.72))
                        .foregroundStyle(self.usageColor.opacity(self.selected?.date == day.date ? 1 : 0.8))
                        .cornerRadius(2)
                        .accessibilityLabel(self.dateLabel(day.date))
                        .accessibilityValue(self.value(day.totals))
                    if day.date == self.peak?.date, value > 0 {
                        PointMark(x: .value("Peak day", day.date), y: .value("Peak", value))
                            .symbol(.diamond).symbolSize(22).foregroundStyle(self.usageColor)
                    }
                } else if day.known {
                    PointMark(x: .value("Unpriced day", day.date), y: .value("Unpriced", 0))
                        .symbol { Circle().stroke(.secondary, lineWidth: 1).frame(width: 5, height: 5) }
                        .accessibilityLabel(self.dateLabel(day.date))
                        .accessibilityValue(self.language.text("有 Token 记录，暂无价格", "Tokens recorded, price unavailable"))
                } else {
                    PointMark(x: .value("Unknown day", day.date), y: .value("Unknown", 0))
                        .symbol { Rectangle().fill(.secondary).frame(width: max(1, min(5, 300 / Double(self.account.days.count))), height: 1.5) }
                        .accessibilityLabel(self.dateLabel(day.date))
                        .accessibilityValue(self.language.text("没有可靠记录", "No reliable record"))
                }
            }
            if let selected {
                RuleMark(x: .value("Selected day", selected.date))
                    .foregroundStyle(.primary.opacity(0.22)).lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 3]))
            }
        }
        .chartXScale(domain: self.account.days.map(\.date))
        .chartYScale(domain: 0...(self.maximum * 1.12))
        .chartXAxis {
            AxisMarks(values: self.axisValues.map { self.account.days[$0].date }) { value in
                if let date = value.as(String.self) {
                    AxisValueLabel(anchor: date == self.account.days.last?.date ? .topTrailing
                        : date == self.account.days.first?.date ? .topLeading : .top) {
                        Text(self.dateLabel(date)).font(.system(size: 11))
                    }
                }
            }
        }
        .chartYAxis {
            AxisMarks(position: .leading, values: [0, self.maximum]) { value in
                AxisGridLine().foregroundStyle(.secondary.opacity(0.15))
                AxisValueLabel {
                    if let number = value.as(Double.self) {
                        Text(self.metric == .cost ? "$" + UsageHistoryMetric.tokens.formatted(number) : self.metric.formatted(number))
                            .font(.system(size: 11)).monospacedDigit()
                    }
                }
            }
        }
        .chartOverlay { proxy in
            GeometryReader { geometry in
                Color.clear.contentShape(Rectangle())
                    .onContinuousHover { phase in
                        switch phase {
                        case .active(let location): self.hoveredIndex = self.index(at: location, proxy: proxy, geometry: geometry)
                        case .ended: self.hoveredIndex = nil
                        }
                    }
                    .onTapGesture { location in
                        if let index = self.index(at: location, proxy: proxy, geometry: geometry) {
                            self.pinnedDate = self.account.days[index].date
                        }
                    }
            }
        }
        .frame(height: 116)
        .accessibilityLabel(self.language.text("每日历史用量", "Daily usage history"))
    }

    private func index(at point: CGPoint, proxy: ChartProxy, geometry: GeometryProxy) -> Int? {
        guard let anchor = proxy.plotFrame else { return nil }
        let frame = geometry[anchor]
        guard frame.contains(point), let date = proxy.value(atX: point.x - frame.minX, as: String.self) else { return nil }
        return self.account.days.firstIndex { $0.date == date }
    }

    private var dayReadout: some View {
        VStack(alignment: .leading, spacing: 3) {
            if let selected {
                HStack {
                    Text(self.dateLabel(selected.date) + (selected.partial ? self.language.text(" · 今天尚未结束", " · Today so far") : ""))
                    Spacer()
                    Text(selected.known
                        ? (self.metric == .cost && selected.totals.estimatedCostUSD == nil
                           ? self.language.text("暂无价格", "Unpriced") : self.value(selected.totals))
                        : "—").monospacedDigit()
                }.font(.system(size: 12, weight: .medium))
                Text(selected.known ? self.tokenSummary(selected.totals) : self.language.text("没有可靠记录，不按零用量计算。", "No reliable record; not counted as zero usage."))
                    .font(.system(size: 11)).foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }.frame(minHeight: 36, alignment: .top)
    }

    private var detailRows: [UsageHistoryBreakdown] {
        switch self.detailKind {
        case "projects": self.account.projects
        case "sessions": self.account.sessions
        default: self.selected?.models ?? []
        }
    }

    private var breakdowns: some View {
        VStack(alignment: .leading, spacing: 9) {
            Picker(self.language.text("明细类型", "Breakdown"), selection: self.$detailKind) {
                Text(self.language.text("当天模型", "Day’s models")).tag("models")
                Text(self.language.text("工作区", "Projects")).tag("projects")
                Text(self.language.text("任务", "Tasks")).tag("sessions")
            }.pickerStyle(.segmented).labelsHidden()
            if self.detailKind != "models" {
                Text(self.language.text("所选 \(self.account.days.count) 天的合计", "Totals for the selected \(self.account.days.count) days"))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
            ForEach(Array(self.detailRows.prefix(self.detailLimit))) { row in
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .top) {
                        Text(row.model ?? (row.label?.isEmpty == false ? row.label! : self.language.text("未知工作区", "Unknown project")))
                            .fixedSize(horizontal: false, vertical: true)
                        if row.mode == "fast" { Text("Fast").foregroundStyle(.secondary) }
                        Spacer(minLength: 6)
                        Text(self.value(row.totals)).monospacedDigit().fixedSize()
                    }.font(.system(size: 13))
                    Text(self.tokenSummary(row.totals)).font(.system(size: 12)).foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            if self.detailRows.isEmpty {
                Text(self.language.text("这一天没有可用明细。", "No details available for this day.")).foregroundStyle(.secondary)
            }
            if self.detailRows.count > self.detailLimit {
                Button(self.language.text("显示更多（还有 \(self.detailRows.count - self.detailLimit) 项）", "Show more (\(self.detailRows.count - self.detailLimit) remaining)")) {
                    self.detailLimit += 12
                }.buttonStyle(.bordered)
            }
            if self.account.totals.hasPartialCost {
                Text(self.language.text("≥ 表示仅合计有价格的记录；未知模型仍计入 Token。", "≥ totals only priced records; unknown models still count toward tokens."))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
            }
        }.onChange(of: self.detailKind) { _, _ in self.detailLimit = 8 }
    }

    private func value(_ totals: UsageHistoryTotals) -> String {
        let prefix = self.metric == .cost && totals.hasPartialCost && totals.estimatedCostUSD != nil ? "≥ " : ""
        return prefix + self.metric.formatted(self.metric.value(totals))
    }

    private func tokenSummary(_ totals: UsageHistoryTotals) -> String {
        let format = UsageHistoryMetric.tokens.formatted
        return self.language.text(
            "输入 \(format(Double(totals.inputTokens)))（含缓存 \(format(Double(totals.cachedTokens)))）· 输出 \(format(Double(totals.outputTokens)))",
            "Input \(format(Double(totals.inputTokens))) (cached \(format(Double(totals.cachedTokens)))) · Output \(format(Double(totals.outputTokens)))")
    }

    private func dateLabel(_ day: String) -> String {
        let parts = day.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return day }
        if self.language == .simplifiedChinese { return "\(parts[1])月\(parts[2])日" }
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "MMM d"
        let date = ISO8601DateFormatter().date(from: "\(day)T12:00:00Z")
        return date.map(formatter.string(from:)) ?? day
    }
}
