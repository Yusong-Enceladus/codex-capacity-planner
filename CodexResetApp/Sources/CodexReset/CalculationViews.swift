import SwiftUI

/// A single observation context is shared by Results, Method and Raw Data.
/// Live supplemental rows are explicitly separate from that saved observation.
struct CalculationHistoryView: View {
    @Environment(\.resetPresentationLanguage) private var language
    let section: DetailSection
    let history: DecisionHistory?
    @State private var page = "calculation-result"
    @State private var selectedID: String?
    @State private var accountID: String?

    private var records: [DecisionRecord] { self.history?.records ?? [] }
    private var record: DecisionRecord? {
        self.records.first { $0.id == self.selectedID } ?? self.records.last
    }
    private var selectedAccount: DecisionAccount? {
        self.record?.accounts.first { $0.id == self.accountID }
            ?? self.record?.accounts.first { $0.active } ?? self.record?.accounts.first
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            PlannerSegmentedPicker(title: self.language.text("计算与数据", "Calculation & Data"), selection: self.$page) {
                ForEach(DetailMenuLayout.calculationGroups, id: \.self) { key in
                    Text(self.pageTitle(key)).tag(key)
                }
            }

            if let record = self.record {
                self.recordNavigation(record)
                if let account = self.selectedAccount {
                    PlannerSegmentedPicker(title: self.language.text("账户", "Account"), selection: Binding(
                        get: { self.selectedAccount?.id ?? account.id },
                        set: { self.accountID = $0 })) {
                        ForEach(record.accounts) { candidate in
                            Text(candidate.label).tag(candidate.id)
                        }
                    }
                }
            }

            switch self.page {
            case "calculation-result": self.results
            case "calculation-basis": self.method
            default: self.rawData
            }
        }
        .font(.system(size: 13))
        .fixedSize(horizontal: false, vertical: true)
    }

    @ViewBuilder private var results: some View {
        if let record = self.record, let account = self.selectedAccount {
            VStack(alignment: .leading, spacing: 12) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(self.language.text("重置概率", "Reset probability")).fontWeight(.semibold)
                    Spacer(minLength: 4)
                    self.probabilityMetric("24h", value: record.source.p24, dashed: false)
                    self.probabilityMetric("48h", value: record.source.p48, dashed: true)
                }
                RecordedHistoryPlot(records: self.records, accountID: nil,
                                    selectedID: self.$selectedID, showsTimeAxis: false)
                Divider()
                HStack(alignment: .firstTextBaseline) {
                    Text(self.language.text("账户用量目标", "Account usage target")).fontWeight(.semibold)
                    Spacer()
                    Text(HistoryPresentation.percent(account.targetPercent))
                        .font(.system(size: 20, weight: .semibold, design: .rounded))
                        .monospacedDigit().foregroundStyle(.red)
                }
                RecordedHistoryPlot(records: self.records, accountID: account.id,
                                    selectedID: self.$selectedID, showsTimeAxis: true)
            }
            .padding(12)
            .background(.background, in: RoundedRectangle(cornerRadius: 10))
            .overlay(RoundedRectangle(cornerRadius: 10).strokeBorder(Color.primary.opacity(0.08)))

            HStack(alignment: .top, spacing: 18) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(self.language.text("目标截止时间", "Target deadline")).foregroundStyle(.secondary)
                    Text(HistoryPresentation.time(account.targetAt, language: self.language)).monospacedDigit()
                }
                Spacer(minLength: 0)
                VStack(alignment: .trailing, spacing: 4) {
                    Text(self.language.text("当时的自然用量预测", "Saved natural-use forecast")).foregroundStyle(.secondary)
                    if let lower = account.projectedLower, let upper = account.projectedUpper {
                        Text(HistoryPresentation.percent(lower) + "–" + HistoryPresentation.percent(upper)).monospacedDigit()
                    } else {
                        Text(self.language.text("尚无可靠预测", "Not yet reliable"))
                    }
                }
            }.font(.system(size: 12)).fixedSize(horizontal: false, vertical: true)

            if record.source.status != "fresh" {
                Label(self.language.text("该次概率数据不可用；图中留空，不画成零。", "Probability data was unavailable; the chart leaves a gap, not zero."),
                      systemImage: "wifi.exclamationmark").font(.system(size: 12))
            }
            if !account.fresh {
                Label(self.language.text("该账户当时没有新鲜的用量读数。", "This account had no fresh usage reading at that time."),
                      systemImage: "clock.badge.exclamationmark").font(.system(size: 12))
            }
            if let impact = record.impact {
                self.comparison(impact, accountID: account.id)
            }
        } else {
            Text(self.language.text("尚未积累判断记录。首次观察后开始绘图，不补画过去。", "No saved decisions yet. Plotting begins with the first observation; the past is not backfilled."))
                .foregroundStyle(.secondary)
        }
        if self.history?.lastError != nil {
            Label(self.language.text("最近一次判断未能保存，当前计划仍可用。", "The latest decision could not be saved; the current plan remains available."),
                  systemImage: "exclamationmark.triangle").font(.system(size: 12))
        }
        self.currentPlanDetails
    }

    private func probabilityMetric(_ title: String, value: Double?, dashed: Bool) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            VStack(spacing: 2) {
                Text(title).font(.system(size: 11))
                LineLegend().stroke(.cyan, style: StrokeStyle(lineWidth: 2, dash: dashed ? [3, 2] : []))
                    .frame(width: 22, height: 2)
            }.accessibilityHidden(true)
            Text(HistoryPresentation.percent(self.record?.source.status == "fresh" ? value : nil))
                .font(.system(size: 17, weight: .semibold, design: .rounded)).monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(title + " " + HistoryPresentation.percent(self.record?.source.status == "fresh" ? value : nil))
    }

    private func recordNavigation(_ record: DecisionRecord) -> some View {
        let index = self.records.firstIndex { $0.id == record.id } ?? 0
        return HStack(spacing: 8) {
            Button { self.selectedID = self.records[max(0, index - 1)].id } label: {
                Image(systemName: "chevron.left")
            }.disabled(index == 0).accessibilityLabel(self.language.text("上一条判断", "Previous decision"))
            VStack(alignment: .leading, spacing: 2) {
                Text(self.language.text("保存的判断", "Saved decision")).font(.system(size: 11)).foregroundStyle(.secondary)
                Text(HistoryPresentation.time(record.at, language: self.language)).monospacedDigit()
            }
            Spacer(minLength: 2)
            Text("\(index + 1) / \(self.records.count)").font(.system(size: 12)).monospacedDigit().foregroundStyle(.secondary)
            Button { self.selectedID = self.records[min(self.records.count - 1, index + 1)].id } label: {
                Image(systemName: "chevron.right")
            }.disabled(index == self.records.count - 1).accessibilityLabel(self.language.text("下一条判断", "Next decision"))
        }.buttonStyle(.bordered).controlSize(.small)
    }

    @ViewBuilder private var method: some View {
        if let account = self.selectedAccount {
            VStack(alignment: .leading, spacing: 10) {
                Text(self.language.text("用量目标怎样算", "How the usage target is calculated")).font(.headline)
                if let values = account.calculation {
                    Grid(alignment: .leading, horizontalSpacing: 18, verticalSpacing: 8) {
                        self.formulaRow(self.language.text("此刻目标", "Current trajectory"), value: values["targetNowUsed"])
                        self.formulaRow("+ 自然推进", "+ Natural progress", value: values["normalUse"])
                        self.formulaRow("+ 预测提前量", "+ Forecast adjustment", value: values["predictionUse"])
                        self.formulaRow("+ 可能刷新预留", "+ Possible-reset reserve", value: values["candidateUse"])
                        Divider().gridCellColumns(2)
                        GridRow {
                            Text(self.language.text("同截止点目标", "Target at the deadline")).fontWeight(.semibold)
                            Text(HistoryPresentation.percent(values["targetUsed"]))
                                .font(.system(size: 20, weight: .semibold)).monospacedDigit()
                                .frame(maxWidth: .infinity, alignment: .trailing)
                        }
                    }
                } else {
                    Text(self.language.text("这条记录未包含计算分量；原始记录仍可查看。", "This record has no calculation components; its raw data is still available."))
                        .foregroundStyle(.secondary)
                }
                Text(self.language.text("截止 ", "Deadline ") + HistoryPresentation.time(account.targetAt, language: self.language))
                    .font(.system(size: 12)).foregroundStyle(.secondary)
                if let weight = account.signalWeight {
                    Text(self.language.text("另列信号权重：", "Separate signal weight: ") + String(format: "%.0f/100", weight)
                         + self.language.text("。这是规划依据，不是重置概率。", ". This is a planning input, not a reset probability."))
                        .font(.system(size: 12))
                }
            }.padding(12).background(.background, in: RoundedRectangle(cornerRadius: 10))
        }
        DisclosureGroup(self.language.text("计算规则与边界", "Calculation rules and limits")) {
            VStack(alignment: .leading, spacing: 10) {
                Text(self.language.text(
                    "同一个本机规划器生成结果。基础重置概率、承诺权重和账户用量目标是三种不同的量，不能互相代替。",
                    "One local planner produces the results. Reset cadence probability, promise weight, and account usage targets are different quantities, not interchangeable."))
                Text(self.language.text(
                    "消息影响：固定评估时刻、账户用量和工作预测，只替换更新前后的公共依据。新旧截止点分别列出；时间流逝和用量增加不会冒充消息效果。",
                    "Message effect: hold evaluation time, account usage, and work forecasts fixed; replace only public evidence. Both deadlines are shown. Elapsed time and usage growth are not attributed to a message."))
                Text(self.language.text(
                    "横轴是保存判断的时间。只连接相邻、同模型的新鲜概率；缺失、断档和账户新周期不连线。变化时保存，平稳时最多每小时追加一次。",
                    "The horizontal axis is observation time. Only adjacent fresh probabilities from the same model connect; missing data, gaps, and new account cycles break the lines. Changes are saved immediately; otherwise a sample is added at most hourly."))
                Text(self.language.text(
                    "同一原帖不会重复加权。公开公告不是个人到账证明；旧事件结清不会关闭另一次未来承诺。用券仍按全部账户和每张券的实际到期时间计算。",
                    "The same original post is never counted twice. Public announcements are not personal receipts, and closing an older event does not close a separate future promise. Credit planning considers all accounts and each credit's own expiry."))
            }.padding(.top, 8)
        }
        self.currentPlanDetails
    }

    private func formulaRow(_ chinese: String, _ english: String? = nil, value: Double?) -> some View {
        GridRow {
            Text(english.map { self.language.text(chinese, $0) } ?? chinese)
            Text(HistoryPresentation.percent(value)).monospacedDigit().frame(maxWidth: .infinity, alignment: .trailing)
        }
    }

    @ViewBuilder private func comparison(_ impact: DecisionImpact, accountID: String) -> some View {
        if let before = impact.before.first(where: { $0.id == accountID }),
           let after = impact.after.first(where: { $0.id == accountID }) {
            DisclosureGroup {
                VStack(alignment: .leading, spacing: 8) {
                    Text(self.language.text("只替换公共依据，固定同一时刻、账户用量与工作预测。", "Only public evidence changes; evaluation time, account usage, and work forecast stay fixed."))
                        .foregroundStyle(.secondary)
                    Text(self.language.text("之前：", "Before: ") + HistoryPresentation.percent(before.targetPercent)
                         + " · " + HistoryPresentation.time(before.targetAt, language: self.language))
                    Text(self.language.text("之后：", "After: ") + HistoryPresentation.percent(after.targetPercent)
                         + " · " + HistoryPresentation.time(after.targetAt, language: self.language))
                    Text(after.explanation(self.language))
                    Text(HistoryPresentation.credit(impact.afterActions, language: self.language))
                }.padding(.top, 8)
            } label: {
                VStack(alignment: .leading, spacing: 3) {
                    Text(self.language.text("本次消息的影响", "Effect of this update")).fontWeight(.medium)
                    Text(HistoryPresentation.impactSummary(before: before, after: after, language: self.language))
                        .font(.system(size: 12)).foregroundStyle(.secondary)
                }
            }
        }
    }

    @ViewBuilder private var rawData: some View {
        if let record = self.record {
            VStack(alignment: .leading, spacing: 9) {
                Text(self.language.text("所选记录与来源", "Selected record and source")).font(.headline)
                self.sourceRow(self.language.text("来源", "Source"), value: record.source.host)
                self.sourceRow(self.language.text("模型", "Model"), value: record.source.modelVersion ?? self.language.text("未提供", "Not provided"))
                self.sourceRow(self.language.text("来源更新时间", "Source updated"), value: HistoryPresentation.time(record.sourceUpdatedAt, language: self.language))
                self.sourceRow(self.language.text("来源状态", "Source status"), value: record.source.status == "fresh"
                               ? self.language.text("当时有效", "Fresh at observation")
                               : self.language.text("当时不可用", "Unavailable at observation"))
                if let history {
                    self.sourceRow(self.language.text("开始记录", "Recording began"), value: HistoryPresentation.time(history.startedAt, language: self.language))
                    if history.discardedCount > 0 {
                        Text(self.language.text("展示最近 \(history.records.count) 条；更早 \(history.discardedCount) 条已超出保留范围。",
                                                "Showing \(history.records.count) retained records; \(history.discardedCount) older records are outside retention."))
                    }
                }
            }.padding(12).background(.background, in: RoundedRectangle(cornerRadius: 10))
            if let json = self.json(record) {
                DisclosureGroup(self.language.text("当时保存的完整 JSON", "Complete saved JSON")) {
                    Text(self.language.text("这是当时保存的判断，不是用今天的算法补算。", "This decision was saved at that time, not reconstructed with today's algorithm."))
                        .foregroundStyle(.secondary).padding(.top, 8)
                    Text(verbatim: json).font(.system(size: 12, design: .monospaced))
                        .textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        self.currentPlanDetails
    }

    private func sourceRow(_ title: String, value: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(title).foregroundStyle(.secondary)
            Spacer(minLength: 4)
            Text(value).multilineTextAlignment(.trailing).fixedSize(horizontal: false, vertical: true)
        }
    }

    @ViewBuilder private var currentPlanDetails: some View {
        let rows = self.section.rows.filter { $0.group == self.page }
        if !rows.isEmpty {
            Divider()
            if self.records.isEmpty {
                Text(self.currentRowsTitle).fontWeight(.semibold)
                self.rows(rows)
            } else {
                DisclosureGroup(self.currentRowsTitle) {
                    Text(self.language.text("以下是当前计划的数据，不随上方历史记录切换。", "These are current-plan details, independent of the selected historical record."))
                        .foregroundStyle(.secondary).padding(.top, 8)
                    self.rows(rows)
                }
            }
        }
    }

    private var currentRowsTitle: String {
        switch self.page {
        case "calculation-result": self.language.text("当前计划的补充结果", "Current-plan supplemental results")
        case "calculation-basis": self.language.text("当前计划的计算依据", "Current-plan calculation details")
        default: self.language.text("当前诊断与采样数据", "Current diagnostics and samples")
        }
    }

    private func rows(_ rows: [DetailRow]) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            ForEach(rows) { row in
                VStack(alignment: .leading, spacing: 5) {
                    Text(row.label).fontWeight(.semibold)
                    Text(row.value)
                    if let secondary = row.secondaryValue {
                        Text(secondary).font(.system(size: 12)).foregroundStyle(.secondary)
                    }
                    if let link = row.link, let url = URL(string: link.url) {
                        Link(self.language == .english ? link.labelEnglish ?? link.label : link.label, destination: url)
                    }
                }.frame(maxWidth: .infinity, alignment: .leading)
            }
        }.padding(.top, 8)
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

private struct LineLegend: Shape {
    func path(in rect: CGRect) -> Path {
        Path { path in
            path.move(to: CGPoint(x: rect.minX, y: rect.midY))
            path.addLine(to: CGPoint(x: rect.maxX, y: rect.midY))
        }
    }
}
