import SwiftUI

/// Both plots use the same observation-time scale and selection. The shared
/// time axis appears once, below the target plot; weights are never charted.
struct RecordedHistoryPlot: View {
    @Environment(\.resetPresentationLanguage) private var language
    let records: [DecisionRecord]
    let accountID: String?
    @Binding var selectedID: String?
    let showsTimeAxis: Bool

    private struct Sample: Identifiable {
        let record: DecisionRecord
        let date: Date
        var id: String { self.record.id }
    }

    var body: some View {
        GeometryReader { geometry in
            let samples = self.records.compactMap { record in
                HistoryPresentation.date(record.at).map { Sample(record: record, date: $0) }
            }
            let inset = 34.0
            let width = max(1, geometry.size.width - inset - 6)
            let height = 84.0
            let start = samples.first?.date ?? Date()
            let end = samples.last?.date ?? start
            let span = max(0, end.timeIntervalSince(start))
            let selected = samples.first { $0.id == self.selectedID } ?? samples.last
            ZStack(alignment: .topLeading) {
                ForEach([0, 50, 100], id: \.self) { value in
                    let y = height * (1 - Double(value) / 100)
                    Path { path in
                        path.move(to: CGPoint(x: inset, y: y))
                        path.addLine(to: CGPoint(x: width + inset, y: y))
                    }.stroke(Color.secondary.opacity(0.16), lineWidth: 0.7)
                    Text("\(value)").font(.system(size: 11, design: .monospaced)).foregroundStyle(.secondary)
                        .frame(width: 27, alignment: .trailing).offset(y: y - 6)
                }
                if let selected {
                    let x = inset + (span > 0 ? selected.date.timeIntervalSince(start) / span * width : width / 2)
                    Path { path in
                        path.move(to: CGPoint(x: x, y: 0))
                        path.addLine(to: CGPoint(x: x, y: height))
                    }.stroke(Color.primary.opacity(0.25), style: StrokeStyle(lineWidth: 1, dash: [2, 3]))
                }
                ForEach(0..<(self.accountID == nil ? 2 : 1), id: \.self) { series in
                    Path { path in
                        var previous: (Date, String)?
                        for sample in samples {
                            guard let value = self.value(sample.record, series: series) else {
                                previous = nil
                                continue
                            }
                            let key = self.seriesKey(sample.record)
                            let point = CGPoint(
                                x: inset + (span > 0 ? sample.date.timeIntervalSince(start) / span * width : width / 2),
                                y: height * (1 - min(100, max(0, value)) / 100))
                            if let previous, previous.1 == key, sample.date.timeIntervalSince(previous.0) <= 90 * 60 {
                                path.addLine(to: point)
                            } else {
                                path.move(to: point)
                            }
                            previous = (sample.date, key)
                        }
                    }
                    .stroke(self.accountID == nil ? Color.cyan : Color.red,
                            style: StrokeStyle(lineWidth: 2, dash: series == 0 ? [] : [5, 3]))
                    ForEach(samples) { sample in
                        if let value = self.value(sample.record, series: series) {
                            Circle().fill(self.accountID == nil ? Color.cyan : Color.red)
                                .frame(width: sample.id == selected?.id ? 6 : 3,
                                       height: sample.id == selected?.id ? 6 : 3)
                                .position(
                                    x: inset + (span > 0 ? sample.date.timeIntervalSince(start) / span * width : width / 2),
                                    y: height * (1 - min(100, max(0, value)) / 100))
                        }
                    }
                }
                if self.showsTimeAxis {
                    Text(HistoryPresentation.time(start, language: self.language))
                        .font(.system(size: 11)).foregroundStyle(.secondary).offset(x: inset, y: height + 9)
                    if span > 0 {
                        Text(HistoryPresentation.time(end, language: self.language))
                            .font(.system(size: 11)).foregroundStyle(.secondary)
                            .frame(width: width, alignment: .trailing).offset(x: inset, y: height + 9)
                    }
                }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { event in
                self.selectedID = HistoryPresentation.recordID(
                    atFraction: (event.location.x - inset) / width, in: self.records)
            })
        }
        .frame(height: self.showsTimeAxis ? 110 : 84)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(self.language.text(
            "已保存判断的历史图。点选、拖动或用上一条和下一条按钮查看数值。",
            "Chart of saved decisions. Click, drag, or use Previous and Next decision to inspect values."))
    }

    private func value(_ record: DecisionRecord, series: Int) -> Double? {
        if let accountID {
            return record.accounts.first { $0.id == accountID && $0.fresh }?.targetPercent
        }
        guard record.source.status == "fresh" else { return nil }
        return series == 0 ? record.source.p24 : record.source.p48
    }

    private func seriesKey(_ record: DecisionRecord) -> String {
        if let accountID {
            return String(record.accounts.first { $0.id == accountID }?.cycleGeneration ?? -1)
        }
        return record.source.modelVersion ?? "unknown"
    }
}
