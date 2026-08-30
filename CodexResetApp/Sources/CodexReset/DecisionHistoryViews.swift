import SwiftUI

struct DecisionExplanationView: View {
    @Environment(\.resetPresentationLanguage) private var language
    let context: DecisionContext
    let history: DecisionHistory?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(self.language.text("当前建议的依据", "Why this plan"))
                .font(.headline)
            ForEach(self.context.accounts) { account in
                VStack(alignment: .leading, spacing: 4) {
                    Label(account.label, systemImage: account.active ? "person.crop.circle.fill" : "person.crop.circle")
                        .font(.caption.weight(.semibold))
                    Text(self.usageContext(account)).font(.caption)
                    Text(account.explanation(self.language)).font(.caption)
                }
            }
            Divider()
            Text(self.workText).font(.caption.weight(.medium))
            Text(HistoryPresentation.credit(self.context.actions, language: self.language)).font(.caption)
            if self.context.actions.account != "stay" {
                Label(self.language.text("建议切换账户继续；不会自动切换。", "Consider continuing on the recommended account; no automatic switch."),
                      systemImage: "arrow.left.arrow.right").font(.caption)
            }
            if let record = self.history?.latestPublicChange {
                Divider()
                DecisionEvidenceDetails(record: record, eventID: nil, showEvidence: false)
            } else {
                Text(self.language.text("从首次观察开始记录消息影响；没有记录的过去不会补画。", "Message effects are recorded from the first observation; missing past decisions are not reconstructed."))
                    .font(.caption2).foregroundStyle(.secondary)
            }
            if self.history?.lastError != nil {
                Label(self.language.text("最近一次判断未能写入历史，当前计划仍可用。", "The latest decision could not be recorded; the current plan remains available."),
                      systemImage: "exclamationmark.triangle").font(.caption2)
            }
        }
        .fixedSize(horizontal: false, vertical: true)
    }

    private var workText: String {
        switch self.context.actions.work {
        case "accelerate", "fast": self.language.text("优先推进可靠主线；仍有缺口时再加速。", "Prioritize reliable mainlines; accelerate only if a gap remains.")
        case "standard": self.language.text("保持正常节奏，不必为了额度额外加速。", "Keep a normal pace; no extra acceleration is needed just to spend quota.")
        case "continue": self.language.text("继续现有的有价值工作。", "Continue existing valuable work.")
        default: self.language.text("先确认额度条件，再继续安排工作。", "Resolve the quota conditions before scheduling more work.")
        }
    }

    private func usageContext(_ account: DecisionAccount) -> String {
        let cycle: String
        switch account.cyclePhase {
        case "cycle-start": cycle = self.language.text("本周期刚开始，当前用量还比较少。", "This cycle has just started and usage is still low. ")
        case "target-met": cycle = self.language.text("当前用量已经达到本轮目标。", "Usage has reached this plan's target. ")
        case "below-target": cycle = self.language.text("当前用量还没有达到本轮目标。", "Usage has not reached this plan's target. ")
        default: cycle = self.language.text("用量状态仍在确认。", "Usage status is still being confirmed. ")
        }
        switch account.trend {
        case "behind": return cycle + self.language.text("按近期自然工作趋势，届时仍可能不足。", "Recent work trends may still leave a gap by the deadline.")
        case "covered": return cycle + self.language.text("近期趋势已超过目标，无需额外加速。", "Recent trends already exceed the target; no extra acceleration is needed.")
        case "uncertain": return cycle + self.language.text("近期自然工作范围已覆盖目标。", "The recent natural-work range covers the target.")
        default: return cycle + self.language.text("自然工作趋势还没有形成可靠预测。", "A reliable natural-work forecast is not available yet.")
        }
    }
}

struct DecisionEvidenceDetails: View {
    @Environment(\.resetPresentationLanguage) private var language
    let record: DecisionRecord
    let eventID: String?
    var showEvidence = true

    var body: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(self.language.text("系统如何处理", "How it was handled")).font(.caption.weight(.semibold))
            Text(self.language.text("本机观察 ", "Observed locally ") + HistoryPresentation.time(self.record.at, language: self.language))
                .font(.caption2).foregroundStyle(.secondary)
            if self.record.source.status != "fresh" {
                Label(self.language.text("来源未能提供新鲜数据；没有把它当作零风险。", "Fresh source data was unavailable; this was not treated as zero risk."),
                      systemImage: "wifi.exclamationmark").font(.caption2)
            }
            if let impact = self.record.impact {
                Text(impact.changed
                    ? self.language.text("按同一时刻、同一份账户用量比较，这次收到的消息改变了计划。", "At the same time and with the same account usage, this update changed the plan.")
                    : self.language.text("已收到并核对，这次消息没有进一步改变计划。", "Received and checked; this update did not change the plan further."))
                    .font(.caption)
            }
            if self.showEvidence {
                ForEach(self.record.evidence.filter { self.eventID == nil || $0.id == self.eventID }.prefix(3)) { evidence in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(evidence.synopsis(self.language)).font(.caption)
                        Text(self.disposition(evidence.disposition)).font(.caption2.weight(.medium))
                        Text(self.language.text("发布 ", "Published ") + HistoryPresentation.time(evidence.publishedAt, language: self.language))
                            .font(.caption2).foregroundStyle(.secondary)
                        Text(self.language.text("首次收到 ", "First received ") + HistoryPresentation.time(evidence.firstReceivedAt, language: self.language))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
            }
            ForEach(self.record.accounts) { account in
                VStack(alignment: .leading, spacing: 3) {
                    Text(account.label + " · " + account.explanation(self.language))
                        .font(.caption2).foregroundStyle(.secondary)
                    if self.showEvidence,
                       let before = self.record.impact?.before.first(where: { $0.id == account.id }),
                       let after = self.record.impact?.after.first(where: { $0.id == account.id }) {
                        Text(self.language.text("消息前：", "Before: ") + HistoryPresentation.percent(before.targetPercent)
                             + " · " + HistoryPresentation.time(before.targetAt, language: self.language))
                        Text(self.language.text("消息后：", "After: ") + HistoryPresentation.percent(after.targetPercent)
                             + " · " + HistoryPresentation.time(after.targetAt, language: self.language))
                    }
                }.font(.caption2.monospacedDigit())
            }
            Text(HistoryPresentation.credit(self.record.actions, language: self.language)).font(.caption2)
        }
        .fixedSize(horizontal: false, vertical: true)
        .padding(9)
        .background(Color.primary.opacity(0.035), in: RoundedRectangle(cornerRadius: 7))
    }

    private func disposition(_ value: String) -> String {
        switch value {
        case "adopted": self.language.text("本轮采用的依据", "Evidence adopted for this plan")
        case "closed", "completed", "landed": self.language.text("已结清的事件，不再用于催促旧额度", "Settled event; no longer urges spending the old quota")
        case "rejected", "failed": self.language.text("来源已否定，不作为有效依据", "Rejected by the source; not active evidence")
        case "expired": self.language.text("时间已过，未把原时间自动延长", "The stated time passed; it was not automatically extended")
        default: self.language.text("保留供核对，本轮没有采用这条消息", "Retained for inspection; not adopted for this plan")
        }
    }
}

struct CalculationHistoryView: View {
    @Environment(\.resetPresentationLanguage) private var language
    let section: DetailSection
    let history: DecisionHistory?
    @State private var page = "calculation-result"
    @State private var selectedID: String?
    @State private var accountID: String?

    private var records: [DecisionRecord] { self.history?.records ?? [] }
    private var record: DecisionRecord? { self.records.first { $0.id == self.selectedID } ?? self.records.last }
    private var selectedAccount: DecisionAccount? {
        self.record?.accounts.first { $0.id == self.accountID }
            ?? self.record?.accounts.first { $0.active } ?? self.record?.accounts.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 5) {
                ForEach(DetailMenuLayout.calculationGroups, id: \.self) { key in
                    Button {
                        self.page = key
                    } label: {
                        HStack(spacing: 3) {
                            if self.page == key { Image(systemName: "checkmark") }
                            Text(self.pageTitle(key))
                        }.frame(maxWidth: .infinity)
                    }
                    .accessibilityLabel(self.pageTitle(key))
                }
            }.buttonStyle(.bordered).controlSize(.small).font(.caption)
            if self.page == "calculation-result" {
                self.results
            } else if self.page == "calculation-basis" {
                if let account = self.selectedAccount, let values = account.calculation {
                    Text(account.label + " · " + HistoryPresentation.time(self.record?.at, language: self.language)).fontWeight(.semibold)
                    Text(self.language.text("目标 = 此刻目标 + 自然推进 + 预测提前量 + 暗示预留", "Target = current trajectory + natural progress + forecast adjustment + hint reserve"))
                    Text(HistoryPresentation.percent(values["targetUsed"]) + " = "
                         + ["targetNowUsed", "normalUse", "predictionUse", "candidateUse"].map { HistoryPresentation.percent(values[$0]) }.joined(separator: " + "))
                        .font(.caption.monospacedDigit())
                    Divider()
                }
                Text(self.language.text(
                    "结果由同一个本机规划器生成。基础重置概率、承诺权重和账户用量目标是三种不同的量，不能互相代替。",
                    "One local planner produces the results. Reset cadence probability, promise weight, and account usage targets are different quantities, not interchangeable."))
                Text(self.language.text(
                    "消息影响：固定评估时刻、账户用量和工作预测，只替换更新前后的公共依据。新旧截止点分别列出；时间流逝和用量增加不会冒充消息效果。",
                    "Message effect: hold evaluation time, account usage, and work forecasts fixed; replace only the public evidence. Both deadlines are shown. Elapsed time and usage growth are not attributed to a message."))
                Text(self.language.text(
                    "只保存真实观察。概率图仅连接相邻、同模型的新鲜记录；缺失、断档和账户新周期不连线。记录按来源或计划变化采样，平稳时最多每小时追加一次。",
                    "Only real observations are saved. Probability lines connect adjacent fresh samples from the same model; gaps and new account cycles break the lines. Changes are recorded immediately; otherwise a sample is added at most hourly."))
                Text(self.language.text(
                    "同一原帖不会重复加权。公开公告不是个人到账证明；旧事件结清不会关闭另一次未来承诺。用券仍按全部账户和每张券的实际到期时间计算。",
                    "The same original post is never counted twice. Public announcements are not personal receipts, and closing an older event does not close a separate future promise. Credit planning still considers all accounts and each credit's own expiry."))
                self.rows
            } else {
                self.recordNavigation
                if let record = self.record {
                    Text(self.language.text("这是当时保存的原始判断，不是用今天的算法补算。", "This is the decision saved at that time, not a reconstruction using today's algorithm."))
                        .foregroundStyle(.secondary)
                    if let json = self.json(record) {
                        Text(verbatim: json).font(.system(size: 10, design: .monospaced)).textSelection(.enabled)
                    }
                }
                self.rows
            }
        }
        .font(.caption)
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var results: some View {
        if let record = self.record {
            self.recordNavigation
            if let account = self.selectedAccount {
                HStack(spacing: 5) {
                    ForEach(record.accounts) { candidate in
                        Button {
                            self.accountID = candidate.id
                        } label: {
                            Label(candidate.label, systemImage: candidate.id == account.id ? "checkmark.circle.fill" : "circle")
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }.buttonStyle(.bordered).controlSize(.mini)
                VStack(alignment: .leading, spacing: 4) {
                    Text(self.language.text("当时预测的重置概率", "Reset probability predicted at that time")).fontWeight(.semibold)
                    HStack {
                        Text("24h · " + HistoryPresentation.percent(record.source.p24))
                        Spacer()
                        Text("48h · " + HistoryPresentation.percent(record.source.p48))
                    }.font(.caption2.monospacedDigit())
                    RecordedHistoryPlot(records: self.records, accountID: nil, selectedID: self.$selectedID)
                    Text(self.language.text("实线：24h · 虚线：48h；只画实际保存的概率。", "Solid: 24h · Dashed: 48h; only recorded probabilities are plotted."))
                        .font(.caption2).foregroundStyle(.secondary)
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(self.language.text("当时的账户用量目标", "Account usage target at that time")).fontWeight(.semibold)
                    RecordedHistoryPlot(records: self.records, accountID: account.id, selectedID: self.$selectedID)
                    Text(self.language.text("用量目标 ", "Usage target ") + HistoryPresentation.percent(account.targetPercent)
                         + " · " + HistoryPresentation.time(account.targetAt, language: self.language))
                    if let weight = account.signalWeight {
                        Text(self.language.text("另列信号权重 ", "Separate signal weight ") + String(format: "%.0f/100", weight)
                             + self.language.text("，不是重置概率。", ", not a reset probability."))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                    if let lower = account.projectedLower, let upper = account.projectedUpper {
                        Text(self.language.text("该账户当时的自然使用预测：", "This account's saved natural-use forecast: ")
                             + HistoryPresentation.percent(lower) + "–" + HistoryPresentation.percent(upper))
                            .font(.caption2).foregroundStyle(.secondary)
                    } else {
                        Text(self.language.text("该账户当时没有可靠的自然使用预测。", "No reliable natural-use forecast was available for this account at that time."))
                            .font(.caption2).foregroundStyle(.secondary)
                    }
                }
                if let impact = record.impact {
                    self.comparison(impact, accountID: account.id)
                }
            }
            if record.source.status != "fresh" {
                Label(self.language.text("该次来源数据不新鲜；图中留空，不画成零。", "Source data was not fresh; the chart leaves a gap, not zero."),
                      systemImage: "wifi.exclamationmark")
            }
            Text(self.language.text("点图或用左右按钮查看当时记录。", "Select a chart point or use the arrows to inspect a saved record."))
                .font(.caption2).foregroundStyle(.secondary)
        } else {
            Text(self.language.text("尚未积累判断记录；首次观察后开始绘图，不补画过去。", "No decision history yet; plotting begins with the first observation, without backfilling the past."))
        }
        if let history {
            Text(self.language.text("记录开始于 ", "Recording began ") + HistoryPresentation.time(history.startedAt, language: self.language)
                 + (history.discardedCount > 0
                    ? self.language.text("；展示最近保存的记录。", "; showing the retained recent records.") : ""))
                .font(.caption2).foregroundStyle(.secondary)
        }
        Divider()
        self.rows
    }

    @ViewBuilder private var recordNavigation: some View {
        if let record, let index = self.records.firstIndex(where: { $0.id == record.id }) {
            HStack(spacing: 8) {
                Button { self.selectedID = self.records[max(0, index - 1)].id } label: { Image(systemName: "chevron.left") }
                    .disabled(index == 0).accessibilityLabel(self.language.text("上一条判断", "Previous decision"))
                VStack(alignment: .leading, spacing: 2) {
                    Text(HistoryPresentation.time(record.at, language: self.language)).font(.caption.monospacedDigit())
                    Text("\(index + 1) / \(self.records.count) · " + record.source.host).font(.caption2).foregroundStyle(.secondary)
                }
                Spacer(minLength: 2)
                Button { self.selectedID = self.records[min(self.records.count - 1, index + 1)].id } label: { Image(systemName: "chevron.right") }
                    .disabled(index == self.records.count - 1).accessibilityLabel(self.language.text("下一条判断", "Next decision"))
            }.buttonStyle(.bordered).controlSize(.mini)
        }
    }

    @ViewBuilder private func comparison(_ impact: DecisionImpact, accountID: String) -> some View {
        if let before = impact.before.first(where: { $0.id == accountID }),
           let after = impact.after.first(where: { $0.id == accountID }) {
            VStack(alignment: .leading, spacing: 4) {
                Text(self.language.text("只改变公共依据的比较", "Comparison changing public evidence only")).fontWeight(.semibold)
                Text(self.language.text("之前：", "Before: ") + HistoryPresentation.percent(before.targetPercent)
                     + " · " + HistoryPresentation.time(before.targetAt, language: self.language))
                Text(self.language.text("之后：", "After: ") + HistoryPresentation.percent(after.targetPercent)
                     + " · " + HistoryPresentation.time(after.targetAt, language: self.language))
                Text(after.explanation(self.language)).font(.caption2).foregroundStyle(.secondary)
                Text(HistoryPresentation.credit(impact.afterActions, language: self.language)).font(.caption2)
            }.padding(9).background(Color.primary.opacity(0.04), in: RoundedRectangle(cornerRadius: 7))
        }
    }

    private var rows: some View {
        VStack(alignment: .leading, spacing: 10) {
            if !self.section.rows.filter({ $0.group == self.page }).isEmpty {
                Text(self.language.text("当前计划的补充数据（不随历史选择切换）", "Current-plan details (independent of the history selection)"))
                    .font(.caption.weight(.semibold))
            }
            ForEach(self.section.rows.filter { $0.group == self.page }) { row in
                VStack(alignment: .leading, spacing: 3) {
                    Text(row.label).font(.caption.weight(.semibold))
                    Text(row.value).font(.caption)
                    if let secondary = row.secondaryValue { Text(secondary).font(.caption2).foregroundStyle(.secondary) }
                    if let link = row.link, let url = URL(string: link.url) {
                        Link(self.language == .english ? link.labelEnglish ?? link.label : link.label, destination: url)
                    }
                }
            }
        }
    }

    private func pageTitle(_ key: String) -> String {
        switch key {
        case "calculation-result": self.language.text("结果", "Results")
        case "calculation-basis": self.language.text("方法", "Method")
        default: self.language.text("原始数据", "Raw data")
        }
    }

    private func json(_ record: DecisionRecord) -> String? {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys, .withoutEscapingSlashes]
        return (try? encoder.encode(record)).flatMap { String(data: $0, encoding: .utf8) }
    }
}

/// The horizontal axis is observation time, never the forecast's future
/// arrival time. Each point is an actually saved value; gaps remain gaps.
private struct RecordedHistoryPlot: View {
    @Environment(\.resetPresentationLanguage) private var language
    let records: [DecisionRecord]
    let accountID: String?
    @Binding var selectedID: String?

    var body: some View {
        GeometryReader { geometry in
            let width = max(1, geometry.size.width - 29)
            let height = max(1, geometry.size.height - 21)
            let start = self.records.first.flatMap { HistoryPresentation.date($0.at) } ?? Date()
            let end = self.records.last.flatMap { HistoryPresentation.date($0.at) } ?? start
            let span = end.timeIntervalSince(start)
            ZStack(alignment: .topLeading) {
                ForEach([0, 50, 100], id: \.self) { value in
                    let y = height * (1 - Double(value) / 100)
                    Path { path in path.move(to: CGPoint(x: 27, y: y)); path.addLine(to: CGPoint(x: width + 27, y: y)) }
                        .stroke(Color.secondary.opacity(0.14), lineWidth: 0.7)
                    Text("\(value)").font(.system(size: 8, design: .monospaced)).foregroundStyle(.secondary).offset(y: y - 4)
                }
                ForEach(0..<(self.accountID == nil ? 2 : 1), id: \.self) { series in
                    Path { path in
                        var previous: (Date, String)?
                        for record in self.records {
                            guard let date = HistoryPresentation.date(record.at), let value = self.value(record, series: series) else {
                                previous = nil; continue
                            }
                            let key = self.seriesKey(record)
                            let point = CGPoint(x: 27 + (span > 0 ? date.timeIntervalSince(start) / span * width : width / 2),
                                                y: height * (1 - min(100, max(0, value)) / 100))
                            if let previous, previous.1 == key, date.timeIntervalSince(previous.0) <= 90 * 60 {
                                path.addLine(to: point)
                            } else { path.move(to: point) }
                            previous = (date, key)
                        }
                    }
                    .stroke(self.accountID == nil ? Color.cyan : Color.red,
                            style: StrokeStyle(lineWidth: 1.5, dash: series == 0 ? [] : [3, 3]))
                    ForEach(self.records) { record in
                        if let date = HistoryPresentation.date(record.at), let value = self.value(record, series: series) {
                            Circle().fill(self.accountID == nil ? Color.cyan : Color.red)
                                .frame(width: record.id == (self.selectedID ?? self.records.last?.id) ? 5 : 2.5, height: record.id == (self.selectedID ?? self.records.last?.id) ? 5 : 2.5)
                                .position(x: 27 + (span > 0 ? date.timeIntervalSince(start) / span * width : width / 2),
                                          y: height * (1 - min(100, max(0, value)) / 100))
                        }
                    }
                }
                Text(HistoryPresentation.time(start, language: self.language)).font(.system(size: 8)).foregroundStyle(.secondary)
                    .offset(x: 27, y: height + 5)
                if span > 0 {
                    Text(HistoryPresentation.time(end, language: self.language)).font(.system(size: 8)).foregroundStyle(.secondary)
                        .frame(width: width, alignment: .trailing).offset(x: 27, y: height + 5)
                }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance: 0).onChanged { event in
                let fraction = min(1, max(0, (event.location.x - 27) / width))
                let target = start.addingTimeInterval(span * fraction)
                self.selectedID = self.records.min {
                    abs((HistoryPresentation.date($0.at) ?? start).timeIntervalSince(target)) <
                        abs((HistoryPresentation.date($1.at) ?? start).timeIntervalSince(target))
                }?.id
            })
        }
        .frame(height: 90)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(self.language.text("已保存判断的历史图，数值可通过上一条和下一条按钮查看。", "Chart of saved decisions. Use Previous and Next decision to inspect values."))
    }

    private func value(_ record: DecisionRecord, series: Int) -> Double? {
        if let accountID { return record.accounts.first { $0.id == accountID && $0.fresh }?.targetPercent }
        guard record.source.status == "fresh" else { return nil }
        return series == 0 ? record.source.p24 : record.source.p48
    }

    private func seriesKey(_ record: DecisionRecord) -> String {
        if let accountID { return String(record.accounts.first { $0.id == accountID }?.cycleGeneration ?? -1) }
        return record.source.modelVersion ?? "unknown"
    }
}
