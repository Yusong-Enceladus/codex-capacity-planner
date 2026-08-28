import Foundation

/// Anonymous, deterministic product states used only to capture README images.
/// The screenshots still run through the production menu and submenu code.
enum ResetDemoFixtures {
    static func primarySnapshot(_ language: ResetPresentationLanguage) -> ResetSnapshot {
        let resetAt = Date().addingTimeInterval(4 * 86_400 + 18 * 3_600)
        let updatedAt = ISO8601DateFormatter().string(from: Date())
        let exactReset = self.dateText(resetAt, language: language)
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
                            value: language.text("下次自然刷新 · 4 天 18 小时后", "Next natural reset · in 4 days 18 hr"),
                            alternateValue: language.text("下次自然刷新 · \(exactReset)", "Next natural reset · \(exactReset)")),
                    ])
            ],
            submenuDetails: [
                self.accountSection(language),
                self.whySection(language),
                self.resetSection(language, exactReset: exactReset),
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
                label: language.text("结论", "Summary"),
                value: language.text("继续可靠主线", "Continue reliable mainlines"),
                secondaryValue: language.text("当前无需切换账号或使用重置券", "No account switch or reset credit is needed"),
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
        exactReset: String) -> DetailSection
    {
        DetailSection(title: language.text("重置", "Resets"), rows: [
            DetailRow(
                label: language.text("下次自然刷新", "Next natural reset"),
                value: language.text("4 天 18 小时后", "in 4 days 18 hr"),
                secondaryValue: exactReset,
                group: "current"),
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
                label: language.text("官方重置", "Official reset"),
                value: language.text("当前没有明确公告", "No confirmed announcement"),
                secondaryValue: language.text(
                    "有明确时间后会纳入同一份使用计划",
                    "A confirmed time will be included in the same usage plan"),
                group: "official"),
        ])
    }

    private static func dateText(
        _ date: Date,
        language: ResetPresentationLanguage) -> String
    {
        let formatter = DateFormatter()
        formatter.locale = language.locale
        formatter.timeZone = TimeZone(identifier: "Asia/Shanghai")
        formatter.dateFormat = language == .english ? "MMM d, h:mm a" : "MM-dd HH:mm 'UTC+8'"
        return formatter.string(from: date)
    }
}
