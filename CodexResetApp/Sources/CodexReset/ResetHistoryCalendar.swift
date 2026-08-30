import SwiftUI

struct ResetHistoryCalendar: View {
    @Environment(\.resetPresentationLanguage) private var language
    let events: [ResetHistoryEvent]
    @State private var month = Date()
    @State private var selectedDay: Date?

    private var calendar: Calendar { HistoryPresentation.calendar(self.language) }
    private var selected: Date { self.selectedDay ?? Date() }
    private var selectedEvents: [ResetHistoryEvent] {
        HistoryPresentation.events(self.events, on: self.selected, language: self.language)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Button { self.moveMonth(-1) } label: { Image(systemName: "chevron.left") }
                    .accessibilityLabel(self.language.text("上个月", "Previous month"))
                Spacer()
                Text(self.monthTitle).font(.caption.weight(.semibold))
                Spacer()
                Button { self.moveMonth(1) } label: { Image(systemName: "chevron.right") }
                    .accessibilityLabel(self.language.text("下个月", "Next month"))
                Button(self.language.text("今天", "Today")) { self.month = Date(); self.selectedDay = Date() }
            }.buttonStyle(.bordered).controlSize(.mini)
            LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 3), count: 7), spacing: 3) {
                ForEach(0..<7, id: \.self) { index in
                    Text(self.calendar.veryShortStandaloneWeekdaySymbols[(self.calendar.firstWeekday - 1 + index) % 7])
                        .font(.caption2).foregroundStyle(.secondary)
                }
                ForEach(Array(HistoryPresentation.monthDays(containing: self.month, language: self.language).enumerated()), id: \.offset) { _, day in
                    if let day { self.dayButton(day) }
                    else { Color.clear.frame(height: 33) }
                }
            }
            Text(self.language.text("带圆点的日期有记录；选择日期查看完整条目。", "A dot marks recorded events; select a day for full details."))
                .font(.caption2).foregroundStyle(.secondary)
            Divider()
            Text(HistoryPresentation.time(self.selected, language: self.language, dayOnly: true)).font(.caption.weight(.semibold))
            if self.selectedEvents.isEmpty {
                Text(self.language.text("这一天没有保存的记录；不代表没有发生刷新。", "No records were saved for this day; that does not prove no reset occurred."))
                    .font(.caption).foregroundStyle(.secondary)
            } else {
                let eventCount = HistoryPresentation.eventCount(self.selectedEvents)
                let accountCount = self.selectedEvents.filter { $0.accountId != nil }.count
                Text(self.language.text(
                    "\(eventCount) 个关联事件 · \(accountCount) 条账户记录",
                    "\(eventCount) linked \(eventCount == 1 ? "event" : "events") · \(accountCount) account \(accountCount == 1 ? "record" : "records")"))
                    .font(.caption2).foregroundStyle(.secondary)
                ForEach(self.selectedEvents) { event in
                    VStack(alignment: .leading, spacing: 4) {
                        Label(HistoryPresentation.kind(event.kind, language: self.language),
                              systemImage: event.accountId == nil ? "megaphone" : "checkmark.circle")
                            .font(.caption.weight(.semibold))
                        if let label = event.accountLabel { Text(label).font(.caption) }
                        Text(HistoryPresentation.time(event.at, language: self.language)).font(.caption.monospacedDigit())
                        Text(self.evidenceText(event)).font(.caption2).foregroundStyle(.secondary)
                        if let summary = self.language == .simplifiedChinese
                            ? event.summaryChinese ?? event.summaryEnglish : event.summaryEnglish {
                            Text(summary).font(.caption2)
                        }
                        if let expiry = event.expiresAt {
                            Text(self.language.text("此券到期 ", "This credit expires ") + HistoryPresentation.time(expiry, language: self.language))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        if let published = event.publishedAt {
                            Text(self.language.text("对应消息发布于 ", "Related post published ") + HistoryPresentation.time(published, language: self.language))
                                .font(.caption2).foregroundStyle(.secondary)
                        }
                        if let eventID = event.eventId {
                            Text(self.language.text("关联公开事件 ", "Linked public event ") + eventID)
                                .font(.system(size: 9, design: .monospaced)).foregroundStyle(.tertiary)
                        }
                    }
                    .padding(9)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 7))
                }
            }
        }
        .onAppear {
            if self.selectedDay == nil, let date = self.events.last.flatMap({ HistoryPresentation.date($0.at) }) {
                self.month = date; self.selectedDay = date
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private func dayButton(_ day: Date) -> some View {
        let entries = HistoryPresentation.events(self.events, on: day, language: self.language)
        let count = HistoryPresentation.eventCount(entries)
        let isSelected = self.calendar.isDate(day, inSameDayAs: self.selected)
        return Button { self.selectedDay = day } label: {
            VStack(spacing: 2) {
                Text("\(self.calendar.component(.day, from: day))").font(.caption.monospacedDigit())
                Circle().fill(entries.isEmpty ? Color.clear : Color.primary).frame(width: 3, height: 3)
            }
            .frame(maxWidth: .infinity).frame(height: 31)
            .background(isSelected ? Color.primary.opacity(0.12) : .clear, in: RoundedRectangle(cornerRadius: 5))
            .overlay(RoundedRectangle(cornerRadius: 5).stroke(isSelected ? Color.primary.opacity(0.45) : .clear))
        }
        .buttonStyle(.plain)
        .accessibilityLabel(HistoryPresentation.time(day, language: self.language, dayOnly: true)
            + self.language.text("，\(count) 个关联事件", ", \(count) linked \(count == 1 ? "event" : "events")"))
        .accessibilityAddTraits(isSelected ? .isSelected : [])
    }

    private var monthTitle: String {
        let formatter = DateFormatter()
        formatter.locale = self.language.locale
        formatter.timeZone = self.language.timeZone
        formatter.dateFormat = self.language == .simplifiedChinese ? "yyyy 年 M 月" : "MMMM yyyy"
        return formatter.string(from: self.month)
    }

    private func moveMonth(_ offset: Int) {
        if let date = self.calendar.date(byAdding: .month, value: offset, to: self.selected) {
            self.month = date
            self.selectedDay = date
        }
    }

    private func evidenceText(_ event: ResetHistoryEvent) -> String {
        switch event.kind {
        case "automatic": self.language.text("上一周期到期后，额度窗口在本机实际重建。", "The quota window rebuilt locally at the previous cycle's natural boundary.")
        case "banked-redeem": self.language.text("券库存减少、额度恢复与周刷新时间后移共同确认。", "Credit inventory decreased, quota recovered, and the weekly reset moved forward.")
        case "upgrade": self.language.text("付费档位提升后，额度与刷新窗口实际重建。", "The quota and reset window rebuilt after the plan tier increased.")
        case "public-announcement": self.language.text("这是公开记录，不能据此认定任何个人账户已经到账。", "This is a public record, not proof of delivery to an individual account.")
        case "credit-grant": self.language.text("本机券库存中记录的发放时间；每张券的到期日另行保留。", "Grant time recorded in local credit inventory; each credit retains its own expiry.")
        default: self.language.text("未使用券、未到自然边界，额度窗口已经在本机重建。", "The quota window rebuilt locally before the natural boundary without consuming a credit.")
        }
    }
}
