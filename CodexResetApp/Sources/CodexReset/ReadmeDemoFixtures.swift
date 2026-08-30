import Foundation

/// Anonymous, deterministic product states used only to capture README images.
/// The screenshots still run through the production menu and submenu code.
enum ResetDemoFixtures {
    static func primarySnapshot(_ language: ResetPresentationLanguage) -> ResetSnapshot {
        let now = Date()
        let resetAt = now.addingTimeInterval(4 * 86_400 + 18 * 3_600)
        let possibleResetStart = now.addingTimeInterval(-2 * 3_600)
        let possibleResetEnd = now.addingTimeInterval(22 * 3_600)
        let updatedAt = ISO8601DateFormatter().string(from: now)
        var snapshot = ResetSnapshot(
            updatedAt: updatedAt,
            dataConfidence: "estimated",
            decisionProgress: DecisionProgress(
                title: language.text(
                    "近期使用计划 · 未来 24 小时",
                    "Near-term usage plan · Next 24 hours"),
                alternateTitle: language.text(
                    "近期使用计划 · 明天 16:00",
                    "Near-term usage plan · Tomorrow 4:00 PM"),
                currentPercent: 42,
                targetPercent: 68,
                projectedPercent: 60,
                projectedLowerPercent: 54,
                projectedUpperPercent: 66,
                currentLabel: language.text("当前 42.0%", "Current 42.0%"),
                targetLabel: language.text("目标 68.0%", "Target 68.0%"),
                projectedLabel: language.text(
                    "预计 54.0%–66.0% · 中心 60.0%",
                    "Forecast 54.0%–66.0% · Midpoint 60.0%")),
            details: [
                DetailSection(
                    title: language.text("现在", "Now"),
                    rows: [
                        DetailRow(
                            label: language.text("建议", "Plan"),
                            value: language.text("继续可靠主线", "Continue reliable mainlines"),
                            secondaryValue: language.text(
                                "当前速度略慢，优先推进跨日持续的真实工作",
                                "Usage is slightly behind; prioritize work sustained across days")),
                        DetailRow(
                            label: language.text("账户", "Account"),
                            value: language.text("工作账户 · Pro", "Work account · Pro"),
                            secondaryValue: language.text("当前使用账号", "Current account")),
                        DetailRow(
                            label: language.text("可用重置", "Reset credit"),
                            value: language.text("1 次可用", "1 available"),
                            secondaryValue: language.text("当前账号持有 · 暂时保留", "Current account · Keep for now")),
                        DetailRow(
                            label: language.text("主线 1", "Mainline 1"),
                            value: language.text("搜索体验 · 质量改进", "Search Experience · Quality"),
                            secondaryValue: language.text("3 条相关任务跨 4 天持续推进", "3 related tasks sustained across 4 days")),
                        DetailRow(
                            label: language.text("主线 2", "Mainline 2"),
                            value: language.text("数据分析 · 实验", "Data Analysis · Experiments"),
                            secondaryValue: language.text("进行中的 Goal", "Ongoing Goal")),
                        DetailRow(
                            label: language.text("主线 3", "Mainline 3"),
                            value: language.text("桌面端 · 应用", "Desktop App · Application"),
                            secondaryValue: language.text("你已明确标为主线", "Explicitly marked as a mainline")),
                        DetailRow(
                            label: language.text("重置", "Reset"),
                            value: self.possibleResetSummary(
                                start: possibleResetStart,
                                end: possibleResetEnd,
                                language: language),
                            secondaryValue: language.text(
                                "“很快，但不是今天”——还不是正式公告。",
                                "Tibo: “soon, not today”; no official announcement yet.")),
                    ])
            ],
            submenuDetails: [
                self.mainlineSection(language),
                self.usageTargetSection(language),
                self.resetSection(
                    language,
                    now: now,
                    resetAt: resetAt,
                    candidateStart: possibleResetStart,
                    candidateEnd: possibleResetEnd),
                self.whySection(language),
                self.calculationSection(language),
            ])
        self.attachDecisionHistory(to: &snapshot, language: language, now: now)
        return snapshot
    }

    private static func mainlineSection(_ language: ResetPresentationLanguage) -> DetailSection {
        DetailSection(title: language.text("建议主线", "Suggested Mainlines"), rows: [
            DetailRow(
                label: language.text("主线 1", "Mainline 1"),
                value: language.text("搜索体验 · 质量改进", "Search Experience · Quality"),
                secondaryValue: language.text(
                    "3 条相关任务跨 4 天持续推进 · 近 7 天 1.2M token 负载证据",
                    "3 related tasks sustained across 4 days · 1.2M tokens of 7-day load evidence"),
                actions: [
                    DetailAction(title: language.text("暂不推荐", "Snooze"), operation: "snooze", targetId: "demo-mainline-1"),
                    DetailAction(title: language.text("不是主线", "Not a mainline"), operation: "not-mainline", targetId: "demo-mainline-1"),
                    DetailAction(title: language.text("标为已完成", "Mark complete"), operation: "complete", targetId: "demo-mainline-1"),
                ]),
            DetailRow(
                label: language.text("主线 2", "Mainline 2"),
                value: language.text("数据分析 · 实验", "Data Analysis · Experiments"),
                secondaryValue: language.text("进行中的 Goal", "Ongoing Goal"),
                actions: [
                    DetailAction(title: language.text("暂不推荐", "Snooze"), operation: "snooze", targetId: "demo-mainline-2"),
                    DetailAction(title: language.text("不是主线", "Not a mainline"), operation: "not-mainline", targetId: "demo-mainline-2"),
                    DetailAction(title: language.text("标为已完成", "Mark complete"), operation: "complete", targetId: "demo-mainline-2"),
                ]),
            DetailRow(
                label: language.text("近期 session（仅供定位）", "Recent session (context only)"),
                value: language.text("桌面端 · 菜单细节调整", "Desktop App · Menu detail adjustment"),
                secondaryValue: language.text(
                    "不会直接进入推荐；可用一次操作标为主线",
                    "Never promoted automatically; one action can mark it as a mainline"),
                actions: [
                    DetailAction(title: language.text("标为主线", "Mark as mainline"), operation: "mark-mainline", targetId: "demo-session-1"),
                    DetailAction(title: language.text("不是主线", "Not a mainline"), operation: "not-mainline", targetId: "demo-session-1"),
                ]),
        ])
    }

    private static func usageTargetSection(_ language: ResetPresentationLanguage) -> DetailSection {
        DetailSection(title: language.text("用量与目标", "Usage & Targets"), rows: [
            DetailRow(
                label: language.text("工作账户 · Pro", "Work account · Pro"),
                value: language.text("当前已用 42%", "42% used"),
                secondaryValue: language.text(
                    "4 天 18 小时后刷新 · 完整容量约 $3000 · 届时预计损失 $960 · 8 个本机样本",
                    "Resets in 4 days 18 hr · About $3,000 full capacity · $960 at risk · 8 local samples"),
                progress: DecisionProgress(
                    title: language.text("工作账户的使用计划", "Work account usage plan"),
                    alternateTitle: nil,
                    currentPercent: 42,
                    targetPercent: 68,
                    projectedPercent: 60,
                    projectedLowerPercent: 54,
                    projectedUpperPercent: 66,
                    currentLabel: language.text("当前 42.0%", "Current 42.0%"),
                    targetLabel: language.text("目标 68.0%", "Target 68.0%"),
                    projectedLabel: language.text(
                        "预计 54.0%–66.0% · 中心 60.0%",
                        "Forecast 54.0%–66.0% · Midpoint 60.0%")), accountId: "demo-work"),
            DetailRow(
                label: language.text("备用账户 · Pro", "Backup account · Pro"),
                value: language.text("当前已用 31%", "31% used"),
                secondaryValue: language.text(
                    "3 天 20 小时后刷新 · 完整容量约 $2820 · 届时预计损失 $740 · 6 个本机样本",
                    "Resets in 3 days 20 hr · About $2,820 full capacity · $740 at risk · 6 local samples"),
                progress: DecisionProgress(
                    title: language.text("备用账户的使用计划", "Backup account usage plan"),
                    alternateTitle: nil,
                    currentPercent: 31,
                    targetPercent: 52,
                    projectedPercent: 49,
                    projectedLowerPercent: 44,
                    projectedUpperPercent: 58,
                    currentLabel: language.text("当前 31.0%", "Current 31.0%"),
                    targetLabel: language.text("目标 52.0%", "Target 52.0%"),
                    projectedLabel: language.text(
                        "预计 44.0%–58.0% · 中心 49.0%",
                        "Forecast 44.0%–58.0% · Midpoint 49.0%")), accountId: "demo-backup"),
        ])
    }

    private static func whySection(_ language: ResetPresentationLanguage) -> DetailSection {
        DetailSection(title: language.text("为什么这样建议", "Why This Plan"), rows: [
            DetailRow(
                label: language.text("为什么", "Why"),
                value: language.text(
                    "当前还没达到目标，又出现了一条尚未证实、可能重置的消息；自然趋势也不足以覆盖目标。",
                    "Usage is below target, an unconfirmed possible-reset signal appeared, and the natural trend does not cover the target."),
                secondaryValue: language.text("暗示只增加有上限的预留，不改写公开概率", "The hint adds only a bounded reserve and does not rewrite public probability"),
                group: "summary"),
            DetailRow(
                label: language.text("所以", "Therefore"),
                value: language.text(
                    "继续三条可靠主线，先保留重置券。",
                    "Continue three reliable mainlines and hold the reset credits."),
                secondaryValue: language.text(
                    "计算结果和原始输入已单独放在“计算与数据”中。",
                    "Results and raw inputs are separated under Calculation & Data."),
                group: "summary"),
        ])
    }

    private static func calculationSection(_ language: ResetPresentationLanguage) -> DetailSection {
        DetailSection(title: language.text("计算与数据", "Calculation & Data"), rows: [
            DetailRow(
                label: language.text("自然使用预测", "Natural-usage forecast"),
                value: language.text("24 小时后预计使用 54%–66%", "Expected usage in 24 hours: 54%–66%"),
                secondaryValue: language.text("中心 60% · 尚未覆盖 68% 目标", "60% midpoint · Still below the 68% target"),
                group: "calculation-result"),
            DetailRow(
                label: language.text("同截止点目标", "Same-deadline target"),
                value: language.text("68% = 连续目标 + 预测加速 + 可能刷新预留", "68% = continuous target + forecast adjustment + possible-reset reserve"),
                secondaryValue: language.text("暗示只增加有上限的预留，不作为概率", "The signal adds only a bounded reserve and is not treated as probability"),
                group: "calculation-basis"),
            DetailRow(
                label: language.text("原始数据", "Raw inputs"),
                value: language.text("额度刚刚更新 · 预测刚刚更新 · 8 个有效容量样本", "Quota just updated · Forecast just updated · 8 valid capacity samples"),
                secondaryValue: language.text("所有个人用量与校准均保留在本机", "All personal usage and calibration remain local"),
                group: "calculation-raw"),
        ])
    }

    private static func resetSection(
        _ language: ResetPresentationLanguage,
        now: Date,
        resetAt: Date,
        candidateStart: Date,
        candidateEnd: Date) -> DetailSection
    {
        let formatter = ISO8601DateFormatter()
        let candidatePublished = now.addingTimeInterval(-3 * 3_600)
        let previousReset = now.addingTimeInterval(-6 * 3_600)
        let workCreditExpiry = now.addingTimeInterval(5 * 86_400)
        let backupCreditExpiry1 = now.addingTimeInterval(8 * 86_400 + 6 * 3_600)
        let backupCreditExpiry2 = now.addingTimeInterval(13 * 86_400)
        let highValueStart = candidateEnd.addingTimeInterval(8 * 3_600)
        let highValueEnd = highValueStart.addingTimeInterval(6 * 3_600)
        let candidateItem = DetailTimelineItem(
            id: "demo-candidate",
            kind: "candidate",
            state: "inferred",
            title: "candidate",
            detail: "Tibo 说“很快，但不是今天”；目前还不是正式公告。",
            detailEnglish: "Tibo said “soon, but not today”; this is not an official announcement.",
            badge: "inferred",
            at: formatter.string(from: candidateStart),
            endAt: formatter.string(from: candidateEnd),
            publishedAt: formatter.string(from: candidatePublished),
            link: nil,
            eventId: "demo-hint")
        let candidateTime = ResetTimelinePresentation.timeText(
            for: candidateItem,
            language: language) ?? language.text(
                "有可能重置，但目前无法确定时间",
                "A reset is possible, but its timing is unknown.")
        return DetailSection(
            title: language.text("重置", "Resets"),
            rows: [
                DetailRow(
                    label: language.text("最近一次刷新", "Latest reset"),
                    value: language.text("套餐升级刷新 · Free → Pro", "Plan upgrade reset · Free → Pro"),
                    secondaryValue: language.text("已确认到账", "Confirmed delivered"),
                    group: "history"),
                DetailRow(
                    label: language.text("当前状态", "Current status"),
                    value: language.text("可能重置 · 尚未确认", "Possible reset · Unconfirmed"),
                    secondaryValue: language.text(
                        "不会改写公开概率，只会增加有上限的使用预留",
                        "It does not rewrite public probability; it only adds a bounded usage reserve"),
                    group: "official"),
                DetailRow(
                    label: language.text("可能重置的时间范围", "Possible reset window"),
                    value: candidateTime,
                    secondaryValue: language.text(
                        "根据原文与上下文推测，目前没有正式时间",
                        "Inferred from the source and context; no official time has been announced"),
                    group: "official"),
                DetailRow(
                    label: language.text("可能重置暗示原文", "Possible-reset source"),
                    value: language.text("很快会有合适的刷新时机，但不是今天。", "There may be a suitable time for resets soon, but not today."),
                    secondaryValue: language.text("完整原文与来源单独保留", "The full source remains available separately"),
                    link: DetailLink(
                        label: "查看可能重置暗示原帖 · 08-29",
                        labelEnglish: "View possible-reset source · Aug 28 PT",
                        url: "https://example.invalid/status/candidate"),
                    group: "official"),
                DetailRow(
                    label: language.text("最近重置确认", "Latest reset confirmation"),
                    value: language.text("本机额度与刷新窗口已经重建", "Local quota and the reset window were rebuilt"),
                    secondaryValue: language.text("已与本机刷新对账", "Matched against the local reset"),
                    link: DetailLink(
                        label: "查看重置确认原帖 · 08-28",
                        labelEnglish: "View reset confirmation · Aug 27 PT",
                        url: "https://example.invalid/status/confirmation"),
                    group: "official"),
            ],
            visualizations: [
                DetailVisualization(
                    kind: "timeline",
                    group: "timeline",
                    title: language.text("刷新时间轴", "Reset Timeline"),
                    items: [
                        candidateItem,
                        DetailTimelineItem(
                            id: "demo-natural",
                            kind: "natural",
                            state: "scheduled",
                            title: language.text("下次自然刷新", "Next natural reset"),
                            detail: "当前账号的周冷却边界",
                            detailEnglish: "Current account weekly cooldown boundary",
                            badge: language.text("计划", "Scheduled"),
                            at: formatter.string(from: resetAt),
                            endAt: nil,
                            publishedAt: nil,
                            link: nil),
                        DetailTimelineItem(
                            id: "demo-reset",
                            kind: "reset",
                            state: "confirmed",
                            title: language.text("额外刷新已到账", "Extra reset received"),
                            detail: "旧事件已结清；之后的暗示仍单独保留",
                            detailEnglish: "The older event is settled; the later hint remains separate",
                            badge: language.text("已确认", "Confirmed"),
                            at: formatter.string(from: previousReset),
                            endAt: nil,
                            publishedAt: nil,
                            link: nil,
                            eventId: "demo-reset-a"),
                    ]),
                DetailVisualization(kind: "resetCalendar", group: "history", title: language.text("重置历史", "Reset History"), items: []),
                DetailVisualization(
                    kind: "resetCredits",
                    group: "assets",
                    title: language.text("重置券", "Reset Credits"),
                    items: [
                        DetailTimelineItem(
                            id: "demo-credit-work",
                            kind: "credit",
                            state: "current",
                            title: language.text("工作账户 · Pro", "Work account · Pro"),
                            detail: "inventory-1",
                            badge: "1",
                            at: formatter.string(from: now.addingTimeInterval(-2 * 86_400)),
                            endAt: formatter.string(from: workCreditExpiry)),
                        DetailTimelineItem(
                            id: "demo-credit-backup-1",
                            kind: "credit",
                            state: "available",
                            title: language.text("备用账户 · Pro", "Backup account · Pro"),
                            detail: "inventory-2",
                            badge: "1",
                            at: formatter.string(from: now.addingTimeInterval(-86_400)),
                            endAt: formatter.string(from: backupCreditExpiry1)),
                        DetailTimelineItem(
                            id: "demo-credit-backup-2",
                            kind: "credit",
                            state: "available",
                            title: language.text("备用账户 · Pro", "Backup account · Pro"),
                            detail: "inventory-2",
                            badge: "1",
                            at: formatter.string(from: now.addingTimeInterval(-12 * 3_600)),
                            endAt: formatter.string(from: backupCreditExpiry2)),
                    ],
                    creditSummary: ResetCreditSummary(
                        status: "possible-reset-first",
                        action: "hold",
                        accountLabel: language.text("工作账户 · Pro", "Work account · Pro"),
                        availableCount: 3,
                        bestNetPercent: 82,
                        bestNetCapacityUSD: 2460,
                        fullCapacityUSD: 3000,
                        optimalWindowStartAt: formatter.string(from: highValueStart),
                        optimalWindowEndAt: formatter.string(from: highValueEnd),
                        possibleResetWindowEndAt: formatter.string(from: candidateEnd),
                        nextFreeResetAt: formatter.string(from: resetAt),
                        confidence: "high",
                        officialState: "available",
                        deliveredAccountCount: 2,
                        deliveryAccountCount: 2)),
            ])
    }

    private static func possibleResetSummary(
        start: Date,
        end: Date,
        language: ResetPresentationLanguage) -> String
    {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = language.timeZone
        let startParts = calendar.dateComponents([.month, .day], from: start)
        let endParts = calendar.dateComponents([.month, .day], from: end)
        guard let startMonth = startParts.month,
              let startDay = startParts.day,
              let endMonth = endParts.month,
              let endDay = endParts.day
        else {
            return language.text(
                "可能重置 · 时间暂不确定",
                "Possible reset · Timing unknown")
        }

        if language == .simplifiedChinese {
            let range = startMonth == endMonth
                ? startDay == endDay
                    ? "\(startMonth)月\(startDay)日"
                    : "\(startMonth)月\(startDay)日至\(endDay)日"
                : "\(startMonth)月\(startDay)日至\(endMonth)月\(endDay)日"
            return "可能重置 · \(range)（UTC+8）"
        }

        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = language.timeZone
        formatter.dateFormat = "MMM"
        let startName = formatter.string(from: start)
        let endName = formatter.string(from: end)
        let range = startMonth == endMonth
            ? startDay == endDay
                ? "\(startName) \(startDay)"
                : "\(startName) \(startDay)–\(endDay)"
            : "\(startName) \(startDay)–\(endName) \(endDay)"
        return "Possible reset · \(range) (PT)"
    }

}
