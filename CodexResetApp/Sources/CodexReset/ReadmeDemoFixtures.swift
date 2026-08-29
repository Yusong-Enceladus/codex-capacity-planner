import Foundation

/// Anonymous, deterministic product states used only to capture README images.
/// The screenshots still run through the production menu and submenu code.
enum ResetDemoFixtures {
    static func primarySnapshot(_ language: ResetPresentationLanguage) -> ResetSnapshot {
        let now = Date()
        let resetAt = now.addingTimeInterval(4 * 86_400 + 18 * 3_600)
        let updatedAt = ISO8601DateFormatter().string(from: now)
        return ResetSnapshot(
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
                            value: language.text(
                                "候选暗示 · 可能很快刷新（UTC+8）",
                                "Candidate hint · A reset may happen soon (PT)"),
                            secondaryValue: language.text(
                                "“很快，但不是今天”——还不是正式公告。",
                                "Tibo: “soon, not today”; no official announcement yet.")),
                    ])
            ],
            submenuDetails: [
                self.accountSection(language),
                self.whySection(language),
                self.resetSection(language, now: now, resetAt: resetAt),
            ])
    }

    private static func accountSection(_ language: ResetPresentationLanguage) -> DetailSection {
        DetailSection(title: language.text("账户", "Accounts"), rows: [
            DetailRow(
                label: language.text("工作账户 · Pro", "Work account · Pro"),
                value: language.text("当前已用 42%", "42% used"),
                secondaryValue: language.text("4 天 18 小时后刷新", "Resets in 4 days 18 hr"),
                group: "current"),
            DetailRow(
                label: language.text("备用账户 · Pro", "Backup account · Pro"),
                value: language.text("当前已用 31%", "31% used"),
                secondaryValue: language.text("3 天 20 小时后刷新", "Resets in 3 days 20 hr"),
                group: "history"),
            DetailRow(
                label: language.text("建议", "Plan"),
                value: language.text("继续使用工作账户", "Keep using the work account"),
                secondaryValue: language.text("当前无需切换", "No switch needed now"),
                group: "history"),
        ])
    }

    private static func whySection(_ language: ResetPresentationLanguage) -> DetailSection {
        DetailSection(title: language.text("为什么这样建议", "Why This Plan"), rows: [
            DetailRow(
                label: language.text("为什么", "Why"),
                value: language.text(
                    "当前还没达到目标，又出现了尚未证实的重置暗示；自然趋势也不足以覆盖目标。",
                    "Usage is below target, an unconfirmed reset hint appeared, and the natural trend does not cover the target."),
                secondaryValue: language.text("暗示只增加有上限的预留，不改写公开概率", "The hint adds only a bounded reserve and does not rewrite public probability"),
                group: "summary"),
            DetailRow(
                label: language.text("当前", "Current"),
                value: language.text("已用 42% · 当前目标 55%", "42% used · Current target 55%"),
                group: "calculation"),
            DetailRow(
                label: language.text("预计", "Forecast"),
                value: language.text("24 小时后预计使用 54%–66%", "Expected usage in 24 hours: 54%–66%"),
                group: "calculation"),
            DetailRow(
                label: language.text("主线", "Mainlines"),
                value: language.text("3 条可靠主线可以继续", "3 reliable mainlines can continue"),
                secondaryValue: language.text("token 只作负载证据；近期 session 仅供定位", "Tokens show load only; recent sessions are context"),
                group: "work"),
            DetailRow(
                label: language.text("数据", "Data"),
                value: language.text("基于本机使用记录与实际 API 等价容量", "Based on local usage and API-equivalent capacity"),
                group: "data"),
        ])
    }

    private static func resetSection(
        _ language: ResetPresentationLanguage,
        now: Date,
        resetAt: Date) -> DetailSection
    {
        let formatter = ISO8601DateFormatter()
        let candidateStart = now.addingTimeInterval(2 * 3_600)
        let candidateEnd = now.addingTimeInterval(22 * 3_600)
        let candidatePublished = now.addingTimeInterval(-3 * 3_600)
        let previousReset = now.addingTimeInterval(-3 * 86_400)
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
            link: nil)
        let candidateTime = ResetTimelinePresentation.timeText(
            for: candidateItem,
            language: language) ?? language.text(
                "有刷新暗示，但时间还不确定",
                "There is a reset hint, but no confirmed timing.")
        return DetailSection(
            title: language.text("重置", "Resets"),
            rows: [
                DetailRow(
                    label: language.text("当前账户", "Current account"),
                    value: language.text("1 次可用", "1 available"),
                    secondaryValue: language.text("暂时保留", "Keep for now"),
                    group: "assets"),
                DetailRow(
                    label: language.text("最近一次刷新", "Latest reset"),
                    value: language.text("套餐升级刷新 · Free → Pro", "Plan upgrade reset · Free → Pro"),
                    secondaryValue: language.text("已确认到账", "Confirmed delivered"),
                    group: "history"),
                DetailRow(
                    label: language.text("当前状态", "Current status"),
                    value: language.text("候选暗示 · 尚未确认", "Candidate hint · Unconfirmed"),
                    secondaryValue: language.text(
                        "不会改写公开概率，只会增加有上限的使用预留",
                        "It does not rewrite public probability; it only adds a bounded usage reserve"),
                    group: "official"),
                DetailRow(
                    label: language.text("可能刷新时间", "Possible reset time"),
                    value: candidateTime,
                    secondaryValue: language.text(
                        "根据原文与上下文推测，目前没有正式时间",
                        "Inferred from the source and context; no official time has been announced"),
                    group: "official"),
                DetailRow(
                    label: language.text("候选暗示原文", "Candidate source"),
                    value: language.text("很快会有合适的刷新时机，但不是今天。", "There may be a suitable time for resets soon, but not today."),
                    secondaryValue: language.text("完整原文与来源单独保留", "The full source remains available separately"),
                    link: DetailLink(
                        label: "查看候选暗示原帖 · 08-29",
                        labelEnglish: "View candidate source · Aug 28 PT",
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
                            id: "demo-upgrade",
                            kind: "upgrade",
                            state: "confirmed",
                            title: language.text("套餐升级刷新", "Plan upgrade reset"),
                            detail: "Free → Pro · 本机额度与窗口已经重建",
                            detailEnglish: "Free → Pro · Local quota and window were rebuilt",
                            badge: language.text("已确认", "Confirmed"),
                            at: formatter.string(from: previousReset),
                            endAt: nil,
                            publishedAt: nil,
                            link: nil),
                    ]),
            ])
    }

}
