import SwiftUI

struct ResetStateGallery: View {
    let page: String

    private var scenarios: [ResetGalleryScenario] {
        ResetGalleryFixtures.scenarios(for: self.page)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(ResetGalleryFixtures.pageTitle(self.page))
                        .font(.title.bold())
                    Text("生产组件 · 生产快照结构 · 每张卡展示主页以及该状态最相关的详情层")
                        .font(.callout)
                        .foregroundStyle(.secondary)
                }
                LazyVGrid(
                    columns: [GridItem(.flexible(), spacing: 14), GridItem(.flexible())],
                    alignment: .leading,
                    spacing: 14)
                {
                    ForEach(self.scenarios) { scenario in
                        ResetGalleryScenarioView(scenario: scenario)
                    }
                }
            }
            .padding(22)
        }
        .frame(minWidth: 1200, minHeight: 760)
        .background(Color(red: 0.075, green: 0.075, blue: 0.105))
    }
}

private struct ResetGalleryScenarioView: View {
    let scenario: ResetGalleryScenario
    @StateObject private var store: SnapshotStore
    @StateObject private var highlight = MenuHighlightState()

    init(scenario: ResetGalleryScenario) {
        self.scenario = scenario
        self._store = StateObject(wrappedValue: SnapshotStore(snapshot: scenario.snapshot))
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .firstTextBaseline) {
                Text(self.scenario.title).font(.headline)
                Spacer()
                Text(self.scenario.phase)
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(self.scenario.tint)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(self.scenario.tint.opacity(0.14), in: Capsule())
            }
            Text(self.scenario.explanation)
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
            HStack(alignment: .top, spacing: 8) {
                ResetMenuCard(
                    store: self.store,
                    highlight: self.highlight,
                    width: 300,
                    hasSubmenu: true,
                    onRefresh: {})
                    .background(Color(red: 0.11, green: 0.11, blue: 0.16))
                    .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                if let section = self.scenario.snapshot.submenuDetails.first(where: {
                    $0.title == self.scenario.detailTitle
                }) {
                    ResetDetailsView(
                        sections: [self.scenario.visibleSection(section)],
                        width: 330)
                        .background(Color(red: 0.11, green: 0.11, blue: 0.16))
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                }
            }
        }
        .padding(13)
        .background(Color.white.opacity(0.045), in: RoundedRectangle(cornerRadius: 13))
        .overlay {
            RoundedRectangle(cornerRadius: 13).stroke(Color.white.opacity(0.08))
        }
    }
}

private struct ResetGalleryScenario: Identifiable {
    let id: String
    let title: String
    let phase: String
    let explanation: String
    let tint: Color
    let snapshot: ResetSnapshot
    let detailTitle: String
    let visibleGroups: Set<String>

    func visibleSection(_ section: DetailSection) -> DetailSection {
        DetailSection(
            title: section.title,
            rows: section.rows.filter { row in
                self.visibleGroups.isEmpty || self.visibleGroups.contains(row.group ?? "all")
            })
    }
}

private enum ResetGalleryFixtures {
    static func pageTitle(_ page: String) -> String {
        switch page {
        case "decisions": "建议状态机"
        case "credits": "重置券状态机"
        case "forced": "强制重置状态机"
        default: "刷新历史与订阅边界"
        }
    }

    static func scenarios(for page: String) -> [ResetGalleryScenario] {
        switch page {
        case "decisions": self.decisionScenarios
        case "credits": self.creditScenarios
        case "forced": self.forcedScenarios
        default: self.historyScenarios
        }
    }

    private static let account = "当前账户 · Pro 20x"
    private static let natural = "08-28 10:48 UTC+8"

    private static func row(
        _ label: String,
        _ value: String,
        _ secondary: String? = nil,
        group: String? = nil) -> DetailRow
    {
        DetailRow(label: label, value: value, secondaryValue: secondary, group: group)
    }

    private static func progress(
        current: Double,
        target: Double,
        lower: Double,
        median: Double,
        upper: Double) -> DecisionProgress
    {
        DecisionProgress(
            title: "近期使用计划 · 08-28 10:48 UTC+8",
            alternateTitle: "近期使用计划 · 未来 24 小时",
            currentPercent: current,
            targetPercent: target,
            projectedPercent: median,
            projectedLowerPercent: lower,
            projectedUpperPercent: upper,
            currentLabel: "当前 \(current.formatted(.number.precision(.fractionLength(1))))%",
            targetLabel: "目标 \(target.formatted(.number.precision(.fractionLength(1))))%",
            projectedLabel: "预计 \(lower.formatted(.number.precision(.fractionLength(1))))%–\(upper.formatted(.number.precision(.fractionLength(1))))% · 中心 \(median.formatted(.number.precision(.fractionLength(1))))%")
    }

    private static func whyRows(
        current: String,
        forecast: String,
        conclusion: String,
        explanation: String) -> [DetailRow]
    {
        [
            self.row("当前", current, "真实用量与此刻目标", group: "summary"),
            self.row("预计", forecast, "结合近期速度与未来任务负载", group: "summary"),
            self.row("因此", conclusion, explanation, group: "summary"),
            self.row("使用与目标", "目标按刷新风险和剩余额度连续演进", group: "calculation"),
            self.row("计算与数据", "API 等价容量 · 行为历史 · 数据新鲜度", group: "data"),
        ]
    }

    private static func snapshot(
        action: String,
        actionSecondary: String,
        extraMain: [DetailRow],
        progress: DecisionProgress?,
        why: [DetailRow],
        reset: [DetailRow]) -> ResetSnapshot
    {
        ResetSnapshot(
            updatedAt: "2026-08-22T17:00:00Z",
            dataConfidence: "estimated",
            decisionProgress: progress,
            details: [
                DetailSection(
                    title: "现在",
                    rows: [
                        self.row("建议", action, actionSecondary),
                        self.row("账户", self.account, "已用额度与账号状态独立计算"),
                    ] + extraMain),
            ],
            submenuDetails: [
                DetailSection(title: "账户", rows: [self.row(self.account, "当前登录 · 已用 51.0%")]),
                DetailSection(title: "为什么这样建议", rows: why),
                DetailSection(title: "重置", rows: reset),
            ])
    }

    private static func scenario(
        _ id: String,
        _ title: String,
        phase: String,
        explanation: String,
        tint: Color,
        snapshot: ResetSnapshot,
        detail: String,
        groups: Set<String>) -> ResetGalleryScenario
    {
        ResetGalleryScenario(
            id: id,
            title: title,
            phase: phase,
            explanation: explanation,
            tint: tint,
            snapshot: snapshot,
            detailTitle: detail,
            visibleGroups: groups)
    }

    static var decisionScenarios: [ResetGalleryScenario] {
        [
            self.scenario(
                "maintain", "目标位于预测区间", phase: "保持",
                explanation: "自然使用预计能覆盖目标，不要求额外加速。", tint: .green,
                snapshot: self.snapshot(
                    action: "保持当前节奏",
                    actionSecondary: "目标 70% 位于预计 62%–74% 内",
                    extraMain: [self.row("重置", "下次自然刷新 · \(self.natural)")],
                    progress: self.progress(current: 51, target: 70, lower: 62, median: 68, upper: 74),
                    why: self.whyRows(
                        current: "已用 51% · 此刻目标 48%",
                        forecast: "刷新前预计 62%–74% · 中心 68%",
                        conclusion: "保持当前节奏",
                        explanation: "目标落在预计区间内"),
                    reset: [self.row("下次自然刷新", self.natural, group: "current")]),
                detail: "为什么这样建议", groups: ["summary"]),
            self.scenario(
                "accelerate", "目标高于预测区间", phase: "加速",
                explanation: "预计使用不足，推荐续跑已有任务，仍不足时才使用 Fast。", tint: .orange,
                snapshot: self.snapshot(
                    action: "续跑近期任务，仍不足时开启 Fast",
                    actionSecondary: "目标 78% 在预计 50%–65% 右侧",
                    extraMain: [self.row("重置", "下次自然刷新 · \(self.natural)")],
                    progress: self.progress(current: 42, target: 78, lower: 50, median: 58, upper: 65),
                    why: self.whyRows(
                        current: "已用 42% · 此刻目标 55%",
                        forecast: "刷新前预计 50%–65%",
                        conclusion: "续跑近期任务，仍不足时开启 Fast",
                        explanation: "目标位于预计区间右侧"),
                    reset: [self.row("下次自然刷新", self.natural, group: "current")]),
                detail: "为什么这样建议", groups: ["summary"]),
            self.scenario(
                "covered", "使用已超过目标", phase: "达标",
                explanation: "不再为了预测继续加速；若正在使用 Fast 则切回 Standard。", tint: .cyan,
                snapshot: self.snapshot(
                    action: "无需再为预测继续加速",
                    actionSecondary: "当前已超目标 12.5%；若在 Fast 请切回 Standard",
                    extraMain: [self.row("重置", "下次自然刷新 · \(self.natural)")],
                    progress: self.progress(current: 82.5, target: 70, lower: 84, median: 88, upper: 92),
                    why: self.whyRows(
                        current: "已用 82.5% · 目标 70%",
                        forecast: "刷新前预计 84%–92%",
                        conclusion: "无需继续加速",
                        explanation: "当前已经超过目标"),
                    reset: [self.row("下次自然刷新", self.natural, group: "current")]),
                detail: "为什么这样建议", groups: ["summary"]),
            self.scenario(
                "stale", "关键数据暂不可用", phase: "降级",
                explanation: "保留最近可靠进度，但停止输出可执行建议。", tint: .gray,
                snapshot: self.snapshot(
                    action: "建议暂不可用",
                    actionSecondary: "额度数据已过期；保留最近可靠结果",
                    extraMain: [self.row("重置", "下次自然刷新 · \(self.natural)")],
                    progress: self.progress(current: 51, target: 70, lower: 62, median: 68, upper: 74),
                    why: [
                        self.row("当前判断", "建议暂不可用", "额度数据已过期", group: "summary"),
                        self.row("计算与数据", "正在等待新鲜额度", group: "data"),
                    ],
                    reset: [self.row("下次自然刷新", self.natural, group: "current")]),
                detail: "为什么这样建议", groups: ["summary"]),
        ]
    }

    static var creditScenarios: [ResetGalleryScenario] {
        [
            self.scenario(
                "credit-awaiting", "官方宣布，账号尚未到账", phase: "待到账",
                explanation: "公告不等于个人到账，也不等于强制刷新。", tint: .orange,
                snapshot: self.snapshot(
                    action: "保持原计划，等待重置券到账",
                    actionSecondary: "官方已生效；当前账号库存尚未确认",
                    extraMain: [self.row("重置", "重置券官方已生效 · 当前账号待确认")],
                    progress: self.progress(current: 51, target: 70, lower: 62, median: 68, upper: 74),
                    why: self.whyRows(
                        current: "已用 51%",
                        forecast: "预计 62%–74%",
                        conclusion: "保持原计划",
                        explanation: "券尚未成为可用资产"),
                    reset: [
                        self.row("当前状态", "等待重置券到账", "不会当作强制刷新", group: "current"),
                        self.row("重置券到账", "官方已生效 · 本机待确认", group: "assets"),
                        self.row("重置券发放公告", "Tibo 已宣布发放 banked reset", "08-22 09:00 UTC+8", group: "official"),
                    ]),
                detail: "重置", groups: ["current", "assets"]),
            self.scenario(
                "credit-hold", "账号持有可用重置", phase: "保留",
                explanation: "主页持续可见，但现有账号仍有容量时不建议兑换。", tint: .green,
                snapshot: self.snapshot(
                    action: "保持当前节奏",
                    actionSecondary: "先使用所有账号的免费容量",
                    extraMain: [
                        self.row("可用重置", "1 次可用", "当前账号持有 · 最早 09-02 16:00 到期"),
                        self.row("重置", "下次自然刷新 · \(self.natural)"),
                    ],
                    progress: self.progress(current: 51, target: 70, lower: 62, median: 68, upper: 74),
                    why: self.whyRows(
                        current: "已用 51%",
                        forecast: "预计 62%–74%",
                        conclusion: "保留重置",
                        explanation: "仍有免费容量可用"),
                    reset: [
                        self.row("下次自然刷新", self.natural, group: "current"),
                        self.row("重置券 · 当前账号", "1 次可用", "09-02 到期", group: "assets"),
                        self.row("重置券 · 另一个账号", "1 次可用", "09-06 到期", group: "assets"),
                        self.row("重置策略", "保留选择权，先用现有账号容量", "策略作用于当前账号", group: "assets"),
                        self.row("净容量价值", "恢复 51% − 推迟成本 22% = 29%", group: "assets"),
                    ]),
                detail: "重置", groups: ["current", "assets"]),
            self.scenario(
                "credit-prepare", "即将形成高价值节点", phase: "准备",
                explanation: "提前安排真实工作，让券在高净价值节点使用。", tint: .cyan,
                snapshot: self.snapshot(
                    action: "继续当前工作，准备高价值兑换点",
                    actionSecondary: "预计 6 小时后接近周期初始满用量状态",
                    extraMain: [self.row("可用重置", "1 次可用", "当前账号持有 · 今晚 21:00–次日 03:00")],
                    progress: self.progress(current: 86, target: 100, lower: 95, median: 98, upper: 100),
                    why: self.whyRows(
                        current: "已用 86%",
                        forecast: "6 小时内预计用至 98%",
                        conclusion: "准备兑换窗口",
                        explanation: "净容量价值即将达到高位"),
                    reset: [
                        self.row("当前状态", "高价值节点将在 6 小时内形成", group: "current"),
                        self.row("重置券 · 当前账号", "1 次可用", group: "assets"),
                        self.row("重置策略", "准备在当前账户形成兑换点", "策略作用于当前账号", group: "assets"),
                        self.row("高价值节点", "今晚 21:00–次日 03:00", "预计净得 76% 完整容量", group: "assets"),
                    ]),
                detail: "重置", groups: ["current", "assets"]),
            self.scenario(
                "credit-redeem", "所有账号均已阻塞", phase: "现在兑换",
                explanation: "只有此时券才成为恢复工作的下一环。", tint: .red,
                snapshot: self.snapshot(
                    action: "所有账号都已阻塞，使用当前账户的重置",
                    actionSecondary: "没有其他免费账号容量或免费刷新可用",
                    extraMain: [self.row("可用重置", "1 次可用", "当前账号持有 · 系统只提示，不自动兑换")],
                    progress: self.progress(current: 100, target: 100, lower: 100, median: 100, upper: 100),
                    why: self.whyRows(
                        current: "全部账号已用完",
                        forecast: "自然刷新尚未到达",
                        conclusion: "现在兑换",
                        explanation: "这是避免真实工作中断的下一环"),
                    reset: [
                        self.row("当前状态", "全部账号已阻塞", "兑换后才能继续工作", group: "current"),
                        self.row("重置券 · 当前账号", "1 次可用", "系统不会自动操作", group: "assets"),
                        self.row("重置策略", "现在兑换 · 当前账户", "策略作用于当前账号", group: "assets"),
                        self.row("净容量价值", "恢复 100% − 推迟成本 8% = 92%", group: "assets"),
                    ]),
                detail: "重置", groups: ["current", "assets"]),
        ]
    }

    static var forcedScenarios: [ResetGalleryScenario] {
        [
            self.scenario(
                "forced-announced", "Tibo 明确宣布强制重置", phase: "等待到账",
                explanation: "当前事件优先显示；旧发券消息不会混入当前状态。", tint: .orange,
                snapshot: self.snapshot(
                    action: "尽快运行有价值任务",
                    actionSecondary: "强制重置已明确，目标立即提高到 100%",
                    extraMain: [self.row("重置", "强制重置已宣布 · 等待当前账号到账", "截止 18:00 UTC+8")],
                    progress: self.progress(current: 63, target: 100, lower: 72, median: 80, upper: 88),
                    why: self.whyRows(
                        current: "已用 63%",
                        forecast: "强制重置窗口前预计 72%–88%",
                        conclusion: "尽快运行有价值任务",
                        explanation: "刷新前剩余额度将被清空"),
                    reset: [
                        self.row("当前状态", "强制重置已宣布 · 等待当前账号到账", "个人到账由本机额度跳变确认", group: "current"),
                        self.row("强制重置公告", "Tibo: reset incoming within the hour", "发布 17:00 UTC+8", group: "official"),
                    ]),
                detail: "重置", groups: ["current", "official"]),
            self.scenario(
                "forced-partial", "部分账号已到账", phase: "部分到账",
                explanation: "按账号分别确认；未到账账号继续保持 100% 使用目标。", tint: .cyan,
                snapshot: self.snapshot(
                    action: "当前账号继续使用剩余额度",
                    actionSecondary: "2 个账号中 1 个已到账；当前账号仍在等待",
                    extraMain: [self.row("重置", "强制重置 · 1/2 个账号到账")],
                    progress: self.progress(current: 82, target: 100, lower: 88, median: 94, upper: 100),
                    why: self.whyRows(
                        current: "当前账号尚未到账",
                        forecast: "窗口内可能随时刷新",
                        conclusion: "继续使用剩余额度",
                        explanation: "其他账号到账不能代替当前账号确认"),
                    reset: [
                        self.row("当前状态", "强制重置进行中 · 1/2 个账号到账", "当前账号仍等待", group: "current"),
                        self.row("强制重置公告", "Tibo 已确认全局重置", group: "official"),
                    ]),
                detail: "重置", groups: ["current", "official"]),
            self.scenario(
                "forced-landed", "当前账号确认强制刷新", phase: "已到账",
                explanation: "事件关闭并进入历史，目标按新周期重新计算。", tint: .green,
                snapshot: self.snapshot(
                    action: "按新周期恢复正常节奏",
                    actionSecondary: "强制刷新已由额度和窗口重建确认",
                    extraMain: [self.row("重置", "最近：强制刷新 · 18:04 UTC+8")],
                    progress: self.progress(current: 2, target: 8, lower: 5, median: 8, upper: 12),
                    why: self.whyRows(
                        current: "新周期已用 2%",
                        forecast: "近期预计 5%–12%",
                        conclusion: "恢复正常节奏",
                        explanation: "强制事件已经完成"),
                    reset: [
                        self.row("下次自然刷新", "08-29 18:04 UTC+8", group: "current"),
                        self.row("最近一次刷新", "强制刷新 · 08-22 18:04 UTC+8", "未用券、未到自然时间且窗口重建", group: "history"),
                        self.row("强制重置公告", "Tibo 已确认全局重置", group: "official"),
                    ]),
                detail: "重置", groups: ["current", "history"]),
            self.scenario(
                "no-signal", "没有强制重置信号", phase: "常态",
                explanation: "不显示空的强制重置模块，只展示自然刷新。", tint: .gray,
                snapshot: self.snapshot(
                    action: "保持当前节奏",
                    actionSecondary: "当前没有强制重置预告",
                    extraMain: [self.row("重置", "下次自然刷新 · \(self.natural)")],
                    progress: self.progress(current: 51, target: 70, lower: 62, median: 68, upper: 74),
                    why: self.whyRows(
                        current: "已用 51%",
                        forecast: "预计 62%–74%",
                        conclusion: "保持当前节奏",
                        explanation: "没有额外重置信号"),
                    reset: [self.row("下次自然刷新", self.natural, "同档续费不会改变此周期", group: "current")]),
                detail: "重置", groups: ["current"]),
        ]
    }

    static var historyScenarios: [ResetGalleryScenario] {
        [
            self.historyScenario("natural", title: "自然刷新", value: "自然刷新 · 08-22 10:48 UTC+8", note: "刷新发生在上一周期自然到期窗口"),
            self.historyScenario(
                "upgrade",
                title: "套餐升级刷新",
                value: "套餐升级刷新 · 08-21 15:49 UTC+8",
                note: "Free → Pro 20x 后额度和周期实际重建"),
            self.historyScenario(
                "redeemed",
                title: "重置券兑换",
                value: "重置券兑换 · 08-20 09:12 UTC+8",
                note: "券减少、额度恢复与刷新时间后移共同确认"),
            self.scenario(
                "cooldown", "同档恢复仍受旧冷却限制", phase: "订阅边界",
                explanation: "提前建议取消自动续费；改用其他账号，旧周期结束后再恢复。", tint: .orange,
                snapshot: self.snapshot(
                    action: "在续费前取消当前账户的自动续费",
                    actionSecondary: "旧周冷却还有 3 天；续回同档不会刷新",
                    extraMain: [self.row("订阅", "08-23 续费前取消自动续费", "只提示，不自动操作")],
                    progress: self.progress(current: 100, target: 100, lower: 100, median: 100, upper: 100),
                    why: [
                        self.row("当前", "账号已用完 · 旧冷却还有 3 天", group: "summary"),
                        self.row("预计", "按时续费仍不能立即使用", group: "summary"),
                        self.row("因此", "取消自动续费并先用其他账号", "旧周期结束后再恢复", group: "summary"),
                        self.row("续费与旧冷却", "Free → 原同档 且旧冷却未结束，不触发刷新", group: "calculation"),
                    ],
                    reset: [self.row("下次自然刷新", self.natural, group: "current")]),
                detail: "为什么这样建议", groups: ["summary"]),
        ]
    }

    private static func historyScenario(
        _ id: String,
        title: String,
        value: String,
        note: String) -> ResetGalleryScenario
    {
        self.scenario(
            id, title, phase: "已归因", explanation: note, tint: .green,
            snapshot: self.snapshot(
                action: "按新周期继续规划",
                actionSecondary: "本次刷新已归因，新周期已经开始",
                extraMain: [self.row("重置", "最近：\(value)")],
                progress: self.progress(current: 12, target: 30, lower: 24, median: 30, upper: 36),
                why: self.whyRows(
                    current: "新周期已用 12%",
                    forecast: "预计 24%–36%",
                    conclusion: "按新周期规划",
                    explanation: "刷新原因已经确认"),
                reset: [
                    self.row("下次自然刷新", self.natural, group: "current"),
                    self.row("最近一次刷新", value, note, group: "history"),
                ]),
            detail: "重置", groups: ["current", "history"])
    }
}
