import Charts
import SwiftUI

struct HistoryPlotObservation: Identifiable {
    let id: String
    let date: Date
}

struct HistoryPlotPoint: Identifiable {
    let id: String
    let date: Date
    let value: Double
}

struct HistoryPlotSegment: Identifiable {
    let id: String
    let series: Int
    let points: [HistoryPlotPoint]
}

/// Preserve genuine gaps and cycle/model boundaries before handing points to
/// Charts. A smoother renderer must never invent continuity in the source.
struct HistoryPlotModel {
    let observations: [HistoryPlotObservation]
    let segments: [HistoryPlotSegment]

    init(records: [DecisionRecord], accountID: String?) {
        let ordered = records.compactMap { record in
            HistoryPresentation.date(record.at).map { (record: record, date: $0) }
        }.sorted { $0.date < $1.date }
        self.observations = ordered.map { HistoryPlotObservation(id: $0.record.id, date: $0.date) }
        var segments: [HistoryPlotSegment] = []
        for series in 0..<(accountID == nil ? 2 : 1) {
            var points: [HistoryPlotPoint] = []
            var previousKey: String?
            func finish() {
                if !points.isEmpty {
                    segments.append(HistoryPlotSegment(id: "\(series)-\(segments.count)", series: series, points: points))
                }
                points = []
            }
            for sample in ordered {
                let account = sample.record.accounts.first { $0.id == accountID }
                let value = accountID == nil
                    ? (sample.record.source.status == "fresh" ? (series == 0 ? sample.record.source.p24 : sample.record.source.p48) : nil)
                    : (account?.fresh == true ? account?.targetPercent : nil)
                guard let value, value.isFinite, (0...100).contains(value) else {
                    finish()
                    previousKey = nil
                    continue
                }
                let key = accountID == nil ? sample.record.source.modelVersion ?? "unknown"
                    : String(account?.cycleGeneration ?? -1)
                if let previous = points.last,
                   previousKey != key || sample.date.timeIntervalSince(previous.date) > 90 * 60 {
                    finish()
                }
                points.append(HistoryPlotPoint(id: sample.record.id, date: sample.date, value: value))
                previousKey = key
            }
            finish()
        }
        self.segments = segments
    }

    var domain: ClosedRange<Date> {
        let first = self.observations.first?.date ?? Date(timeIntervalSince1970: 0)
        let last = self.observations.last?.date ?? first
        return first == last ? first.addingTimeInterval(-1800)...last.addingTimeInterval(1800) : first...last
    }

    var axisDates: [Date] {
        guard let first = self.observations.first?.date, let last = self.observations.last?.date else { return [] }
        if first == last { return [first] }
        return [first, first.addingTimeInterval(last.timeIntervalSince(first) / 2), last]
    }

    func nearestRecord(to date: Date) -> String? {
        self.observations.min { abs($0.date.timeIntervalSince(date)) < abs($1.date.timeIntervalSince(date)) }?.id
    }
}

/// Two native plots share one observation-time scale, selection and time axis.
struct RecordedHistoryPlot: View {
    @Environment(\.resetPresentationLanguage) private var language
    let records: [DecisionRecord]
    let accountID: String?
    @Binding var selectedID: String?
    let showsTimeAxis: Bool
    @State private var selectedDate: Date?

    private var tint: Color { self.accountID == nil ? .cyan : .red }

    var body: some View {
        let model = HistoryPlotModel(records: self.records, accountID: self.accountID)
        let selected = model.observations.first { $0.id == self.selectedID } ?? model.observations.last
        Chart {
            ForEach(model.segments) { segment in
                ForEach(segment.points) { point in
                    LineMark(x: .value("Observed", point.date), y: .value("Percent", point.value),
                             series: .value("Segment", segment.id))
                        .foregroundStyle(self.tint)
                        .lineStyle(StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round,
                                               dash: segment.series == 0 ? [] : [5, 4]))
                        .interpolationMethod(.linear)
                        .accessibilityLabel(Text(self.seriesTitle(segment.series)))
                        .accessibilityValue(Text(HistoryPresentation.time(point.date, language: self.language)
                                                 + " · " + HistoryPresentation.percent(point.value)))
                    if point.id == selected?.id || segment.points.count == 1 {
                        PointMark(x: .value("Observed", point.date), y: .value("Percent", point.value))
                            .foregroundStyle(self.tint)
                            .symbolSize(point.id == selected?.id ? 42 : 16)
                            .accessibilityHidden(true)
                    }
                }
            }
            if let selected {
                RuleMark(x: .value("Selected observation", selected.date))
                    .foregroundStyle(Color.secondary.opacity(0.35))
                    .lineStyle(StrokeStyle(lineWidth: 1, dash: [3, 4]))
                    .accessibilityHidden(true)
            }
        }
        .chartXScale(domain: model.domain, range: .plotDimension(padding: 6))
        .chartYScale(domain: 0...100)
        .chartYAxis {
            AxisMarks(position: .leading, values: [0, 50, 100]) { value in
                AxisGridLine(stroke: StrokeStyle(lineWidth: 0.5, dash: [3, 4]))
                    .foregroundStyle(Color.secondary.opacity(0.18))
                AxisValueLabel {
                    if let value = value.as(Int.self) {
                        Text("\(value)%").font(PlannerTypography.detail).monospacedDigit()
                    }
                }
            }
        }
        .chartXAxis {
            if self.showsTimeAxis {
                AxisMarks(values: model.axisDates) { value in
                    AxisValueLabel(anchor: model.axisDates.count == 1 ? .top
                                   : value.index == 0 ? .topLeading
                                   : value.index == model.axisDates.count - 1 ? .topTrailing : .top,
                                   collisionResolution: .disabled) {
                        if let date = value.as(Date.self) {
                            Text(self.axisLabel(date)).font(PlannerTypography.detail).monospacedDigit()
                                .multilineTextAlignment(.center)
                        }
                    }
                }
            }
        }
        .chartLegend(.hidden)
        .chartPlotStyle { plot in
            plot.background(Color.primary.opacity(0.025))
        }
        .chartXSelection(value: self.$selectedDate)
        .chartGesture { proxy in
            DragGesture(minimumDistance: 0)
                .onChanged { proxy.selectXValue(at: $0.location.x) }
        }
        .onChange(of: self.selectedDate) { _, date in
            if let date, let id = model.nearestRecord(to: date), self.selectedID != id {
                self.selectedID = id
            }
        }
        .frame(height: self.showsTimeAxis ? 162 : 132)
        .environment(\.timeZone, self.language.timeZone)
        .environment(\.calendar, HistoryPresentation.calendar(self.language))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(self.language.text(
            "已保存判断的历史图。点选、拖动或用上一条和下一条按钮查看数值。",
            "Saved decisions. Click, drag, or use Previous and Next decision to inspect values."))
        .accessibilityValue(Text(self.selectedDescription(model, selected: selected)))
    }

    private func selectedDescription(_ model: HistoryPlotModel, selected: HistoryPlotObservation?) -> String {
        guard let selected else { return self.language.text("没有记录", "No observations") }
        let values = model.segments.compactMap { segment in
            segment.points.first { $0.id == selected.id }.map {
                self.seriesTitle(segment.series) + " " + HistoryPresentation.percent($0.value)
            }
        }
        return HistoryPresentation.time(selected.date, language: self.language) + " · "
            + (values.isEmpty ? self.language.text("当时的数据不可用", "Data was unavailable") : values.joined(separator: ", "))
    }

    private func axisLabel(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = self.language.locale
        formatter.timeZone = self.language.timeZone
        formatter.dateFormat = self.language == .simplifiedChinese ? "M月d日\nHH:mm" : "MMM d\nh:mm a"
        return formatter.string(from: date)
    }

    private func seriesTitle(_ series: Int) -> String {
        if self.accountID != nil { return self.language.text("账户用量目标", "Account usage target") }
        return series == 0 ? self.language.text("24 小时内重置概率", "Reset probability within 24 hours")
            : self.language.text("48 小时内重置概率", "Reset probability within 48 hours")
    }
}
