import SwiftUI

struct DecisionExplanationView: View {
    @Environment(\.resetPresentationLanguage) private var language
    let context: DecisionContext
    let history: DecisionHistory?

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(self.language.text("当前建议的依据", "Why this plan"))
                .font(PlannerTypography.title)
            ForEach(self.context.accounts) { account in
                VStack(alignment: .leading, spacing: 4) {
                    Label(account.label, systemImage: account.active ? "person.crop.circle.fill" : "person.crop.circle")
                        .font(PlannerTypography.heading)
                    Text(self.usageContext(account)).font(PlannerTypography.body)
                    Text(account.explanation(self.language)).font(PlannerTypography.body)
                }
            }
            Divider()
            Text(self.workText).font(PlannerTypography.body.weight(.medium))
            Text(HistoryPresentation.credit(self.context.actions, language: self.language)).font(PlannerTypography.body)
            if self.context.actions.account != "stay" {
                Label(self.language.text("建议切换账户继续；不会自动切换。", "Consider continuing on the recommended account; no automatic switch."),
                      systemImage: "arrow.left.arrow.right").font(PlannerTypography.body)
            }
            if let record = self.history?.latestPublicChange {
                Divider()
                DecisionEvidenceDetails(record: record, eventID: nil, showEvidence: false)
            } else {
                Text(self.language.text("从首次观察开始记录消息影响；没有记录的过去不会补画。", "Message effects are recorded from the first observation; missing past decisions are not reconstructed."))
                    .font(PlannerTypography.detail).foregroundStyle(.secondary)
            }
            if self.history?.lastError != nil {
                Label(self.language.text("最近一次判断未能写入历史，当前计划仍可用。", "The latest decision could not be recorded; the current plan remains available."),
                      systemImage: "exclamationmark.triangle").font(PlannerTypography.detail)
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
            Text(self.language.text("系统如何处理", "How it was handled")).font(PlannerTypography.heading)
            Text(self.language.text("本机观察 ", "Observed locally ") + HistoryPresentation.time(self.record.at, language: self.language))
                .font(PlannerTypography.detail).foregroundStyle(.secondary)
            if self.record.source.status != "fresh" {
                Label(self.language.text("来源未能提供新鲜数据；没有把它当作零风险。", "Fresh source data was unavailable; this was not treated as zero risk."),
                      systemImage: "wifi.exclamationmark").font(PlannerTypography.detail)
            }
            if let impact = self.record.impact {
                Text(impact.changed
                    ? self.language.text("按同一时刻、同一份账户用量比较，这次收到的消息改变了计划。", "At the same time and with the same account usage, this update changed the plan.")
                    : self.language.text("已收到并核对，这次消息没有进一步改变计划。", "Received and checked; this update did not change the plan further."))
                    .font(PlannerTypography.body)
            }
            if self.showEvidence {
                ForEach(self.record.evidence.filter { self.eventID == nil || $0.id == self.eventID }.prefix(3)) { evidence in
                    VStack(alignment: .leading, spacing: 3) {
                        Text(evidence.synopsis(self.language)).font(PlannerTypography.body)
                        Text(self.disposition(evidence.disposition)).font(PlannerTypography.detail.weight(.medium))
                        Text(self.language.text("发布 ", "Published ") + HistoryPresentation.time(evidence.publishedAt, language: self.language))
                            .font(PlannerTypography.detail).foregroundStyle(.secondary)
                        Text(self.language.text("首次收到 ", "First received ") + HistoryPresentation.time(evidence.firstReceivedAt, language: self.language))
                            .font(PlannerTypography.detail).foregroundStyle(.secondary)
                    }
                }
            }
            ForEach(self.record.accounts) { account in
                VStack(alignment: .leading, spacing: 3) {
                    Text(account.label + " · " + account.explanation(self.language))
                        .font(PlannerTypography.detail).foregroundStyle(.secondary)
                    if self.showEvidence,
                       let before = self.record.impact?.before.first(where: { $0.id == account.id }),
                       let after = self.record.impact?.after.first(where: { $0.id == account.id }) {
                        Text(self.language.text("消息前：", "Before: ") + HistoryPresentation.percent(before.targetPercent)
                             + " · " + HistoryPresentation.time(before.targetAt, language: self.language))
                        Text(self.language.text("消息后：", "After: ") + HistoryPresentation.percent(after.targetPercent)
                             + " · " + HistoryPresentation.time(after.targetAt, language: self.language))
                    }
                }.font(PlannerTypography.detail.monospacedDigit())
            }
            Text(HistoryPresentation.credit(self.record.actions, language: self.language)).font(PlannerTypography.detail)
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
