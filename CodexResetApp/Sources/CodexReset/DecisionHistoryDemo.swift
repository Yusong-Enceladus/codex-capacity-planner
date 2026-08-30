import Foundation

extension ResetDemoFixtures {
    /// Explicitly synthetic states, passed through the production native views.
    /// No real account state, public-site response, or user history is used.
    static func attachDecisionHistory(to snapshot: inout ResetSnapshot, language: ResetPresentationLanguage, now: Date) {
        let format = ISO8601DateFormatter()
        func at(_ seconds: Double) -> String { format.string(from: now.addingTimeInterval(seconds)) }
        let actions = DecisionActions(work: "accelerate", credit: "hold", availableCredits: 3,
            account: "stay", creditReason: "possible-reset-first", creditWindowStartAt: at(30 * 3600),
            creditWindowEndAt: at(36 * 3600), possibleResetEndAt: at(22 * 3600))
        func account(_ index: Int, step: Int, before: Bool = false) -> DecisionAccount {
            let hint = step >= 4 && !before
            let label = index == 0 ? language.text("工作账户 · Pro", "Work account · Pro")
                : language.text("备用账户 · Pro", "Backup account · Pro")
            let target = Double(index == 0 ? 40 + step * 4 : 38 + step * 2) - (before ? 4 : 0)
            return DecisionAccount(id: index == 0 ? "demo-work" : "demo-backup", label: label, active: index == 0,
                cycleGeneration: step >= 1 ? 2 : 1,
                usedPercent: Double(index == 0 ? 21 + step * 3 : 17 + step * 2),
                targetPercent: target, targetAt: at(Double(step - 7) * 3600 + 86400),
                naturalResetAt: at(Double(index == 0 ? 114 : 92) * 3600), usageAt: at(Double(step - 7) * 3600),
                fresh: true, projectedLower: index == 0 ? 54 : 44, projectedUpper: index == 0 ? 66 : 58,
                signalId: hint ? "demo-hint" : nil, signalLevel: hint ? "hint" : "none", signalWeight: hint ? 50 : nil,
                mode: hint ? "hint" : "forecast", reason: hint ? "hint-reserve" : "cadence-and-local",
                reasonChinese: hint ? "消息只是可能重置的暗示；有限提前安排，不当成确定刷新。" : "尚无新的重置信号，按本机趋势和基础预测安排。",
                reasonEnglish: hint ? "The message is a possible-reset hint: a bounded adjustment, not a certain reset." : "No new reset signal; plan from local trends and the cadence forecast.",
                deliveredEventId: step >= 1 ? "demo-reset-a" : nil,
                deliveredAt: step >= 1 ? at(-6 * 3600 + Double(index * 1200)) : nil,
                cyclePhase: "below-target", trend: index == 0 ? "behind" : "uncertain")
        }
        let evidence = DecisionEvidence(id: "demo-hint", url: "https://example.invalid/status/hint", source: "example.invalid",
            publishedAt: at(-3 * 3600), firstReceivedAt: at(-3 * 3600),
            summary: "Synthetic example: a reset may happen soon, but it is not confirmed.",
            summaryChinese: "匿名演示：可能很快重置，但尚未确认。", level: "hint", disposition: "adopted",
            sourceState: "hinted", timingKind: "inferred", targetAt: at(22 * 3600), windowStartAt: at(-2 * 3600), weight: 50)
        let records = (0..<8).map { index in
            let timestamp = at(Double(index - 7) * 3600)
            let rows = [account(0, step: index), account(1, step: index)]
            let impact = index == 4 ? DecisionImpact(method: "same-time-public-inputs", at: timestamp, changed: true,
                before: [account(0, step: index, before: true), account(1, step: index, before: true)], after: rows,
                beforeActions: actions, afterActions: actions) : nil
            return DecisionRecord(id: "demo-decision-\(index)", at: timestamp,
                trigger: index == 4 ? "public-update" : index == 1 ? "account-reset" : "clock", sourceUpdatedAt: timestamp,
                source: DecisionSource(host: "example.invalid", status: index == 2 ? "fetch-failed" : "fresh", modelVersion: "demo-rate",
                    p24: index == 2 ? nil : 20 + Double(index) * 10 / 7,
                    p48: index == 2 ? nil : 40 + Double(index) * 10 / 7),
                evidence: index >= 4 ? [evidence] : [], accounts: rows, actions: actions, impact: impact,
                relatedEventIds: index == 4 ? ["demo-hint"] : index == 1 ? ["demo-reset-a"] : [])
        }
        snapshot.decisionHistory = DecisionHistory(version: 1, startedAt: at(-7 * 3600), sequence: records.count,
            discardedCount: 0, lastCheckedAt: at(0), lastError: nil, records: records)
        snapshot.decisionContext = DecisionContext(at: at(0), accounts: [account(0, step: 7), account(1, step: 7)], actions: actions)
        snapshot.resetHistoryEvents = [
            ResetHistoryEvent(id: "demo-natural-old", eventId: nil, accountId: "demo-work", accountLabel: account(0, step: 7).label,
                at: at(-7 * 86400), kind: "automatic", evidence: "natural-boundary", publishedAt: nil),
            ResetHistoryEvent(id: "demo-grant-work", eventId: nil, accountId: "demo-work", accountLabel: account(0, step: 7).label,
                at: at(-2 * 86400), kind: "credit-grant", evidence: "local-inventory", publishedAt: nil, expiresAt: at(5 * 86400)),
            ResetHistoryEvent(id: "demo-receipt-work", eventId: "demo-reset-a", accountId: "demo-work", accountLabel: account(0, step: 7).label,
                at: at(-6 * 3600), kind: "global-manual", evidence: "quota-rebuilt", publishedAt: at(-6 * 3600 - 600)),
            ResetHistoryEvent(id: "demo-receipt-backup", eventId: "demo-reset-a", accountId: "demo-backup", accountLabel: account(1, step: 7).label,
                at: at(-6 * 3600 + 1200), kind: "global-manual", evidence: "quota-rebuilt", publishedAt: at(-6 * 3600 - 600)),
        ]
    }
}
