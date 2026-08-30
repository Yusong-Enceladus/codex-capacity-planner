import AppKit
import Combine
import SwiftUI

enum ResetBrandAssets {
    static func statusGlyph() -> NSImage {
        let image = Bundle.main.url(forResource: "StatusIcon", withExtension: "png")
            .flatMap(NSImage.init(contentsOf:))
            ?? NSImage(systemSymbolName: "hourglass", accessibilityDescription: "Codex Capacity Planner")!
        image.isTemplate = true
        return image
    }

    static func cardGlyph() -> NSImage {
        Bundle.main.url(forResource: "CardIcon", withExtension: "png")
            .flatMap(NSImage.init(contentsOf:))
            ?? NSImage(systemSymbolName: "hourglass", accessibilityDescription: "Codex Capacity Planner")!
    }
}

private final class DetailActionBox: NSObject {
    let action: DetailAction

    init(_ action: DetailAction) {
        self.action = action
    }
}

enum DetailMenuLayout {
    static func isReset(_ title: String) -> Bool {
        ["重置", "Resets"].contains(title)
    }

    static func isMainlines(_ title: String) -> Bool {
        ["建议主线", "Suggested Mainlines"].contains(title)
    }

    static func isCalculation(_ title: String) -> Bool {
        ["计算与数据", "Calculation & Data"].contains(title)
    }

    static func usesInlineActions(_ title: String) -> Bool {
        self.isMainlines(title)
    }

    static func summaryGroup(_ title: String) -> String {
        ["为什么这样建议", "Why This Plan"].contains(title) ? "summary" : "current"
    }

    static func rootVisualizationGroup(_ title: String) -> String {
        self.isReset(title) ? "timeline" : self.summaryGroup(title)
    }

    static func childGroups(_ title: String) -> [String] {
        return self.isReset(title) ? ["assets", "history", "official"] : []
    }

    static let calculationGroups = [
        "calculation-result",
        "calculation-basis",
        "calculation-raw",
    ]

    static func rows(for group: String, in section: DetailSection) -> [DetailRow] {
        if group == "calculation" {
            return section.rows.filter {
                $0.group == "calculation" || $0.group?.hasPrefix("calculation-") == true
            }
        }
        return section.rows.filter { $0.group == group }
    }
}

@MainActor
final class MenuController: NSObject, NSMenuDelegate {
    private static let cardWidth: CGFloat = 310
    private static let detailsWidth: CGFloat = 380
    private static let mainlineDetailsWidth: CGFloat = 460
    private static let calculationDetailsWidth: CGFloat = 480

    private let store: SnapshotStore
    private let presentationLanguage: ResetPresentationLanguage
    private let allowsRefresh: Bool
    private let statusItem: NSStatusItem
    private let menu = NSMenu()
    private var settingsWindow: NSWindow?
    private var previewWindow: NSWindow?
    private var cancellables = Set<AnyCancellable>()
    private var menuOpen = false
    private var rebuildPending = false

    init(
        store: SnapshotStore,
        presentationLanguage: ResetPresentationLanguage = .simplifiedChinese,
        allowsRefresh: Bool = true)
    {
        self.store = store
        self.presentationLanguage = presentationLanguage
        self.allowsRefresh = allowsRefresh
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        self.statusItem.autosaveName = allowsRefresh ? "codex-reset" : "codex-reset-demo"
        let statusImage = ResetBrandAssets.statusGlyph()
        statusImage.size = NSSize(width: 18, height: 18)
        self.statusItem.button?.image = statusImage
        self.statusItem.button?.toolTip = "Codex Capacity Planner"
        self.menu.autoenablesItems = false
        self.menu.delegate = self
        self.statusItem.menu = self.menu
        self.rebuildMenu()
        self.store.$snapshot
            .receive(on: RunLoop.main)
            .sink { [weak self] _ in
                guard let self else { return }
                if self.menuOpen { self.rebuildPending = true }
                else { self.rebuildMenu() }
            }
            .store(in: &self.cancellables)

        if ProcessInfo.processInfo.environment["CODEX_RESET_PREVIEW"] == "1" {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.5) { [weak self] in
                self?.showPreviewWindow()
            }
        }
        if ProcessInfo.processInfo.environment["CODEX_RESET_ACTUAL_MENU"] == "1" {
            if !self.allowsRefresh {
                // Reopen the actual menu after a capture tool changes focus,
                // without restarting the fixture or touching the live planner.
                let commandBar = NSMenu()
                let commandRoot = NSMenuItem(title: "Planner Demo", action: nil, keyEquivalent: "")
                let commands = NSMenu(title: "Planner Demo")
                let reopen = NSMenuItem(title: "Open Planner Menu", action: #selector(self.showActualMenuForCapture), keyEquivalent: "m")
                reopen.keyEquivalentModifierMask = [.command, .shift]
                reopen.target = self
                commands.addItem(reopen)
                commandRoot.submenu = commands
                commandBar.addItem(commandRoot)
                NSApplication.shared.mainMenu = commandBar
            }
            let rawDelay = ProcessInfo.processInfo.environment["CODEX_RESET_ACTUAL_MENU_DELAY"]
            let delay = rawDelay.flatMap(Double.init) ?? 2
            // A modal NSMenu opened inside a main-dispatch block prevents that
            // queue from serving async actions and accessibility requests. A
            // run-loop timer matches normal AppKit event-driven menu opening.
            let captureTimer = Timer(timeInterval: max(0, delay), repeats: false) { [weak self] _ in
                MainActor.assumeIsolated { self?.showActualMenuForCapture() }
            }
            RunLoop.main.add(captureTimer, forMode: .common)
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        self.menuOpen = true
        if self.allowsRefresh {
            Task { await self.store.refresh() }
        }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        if self.menuOpen { self.rebuildPending = true }
        else { self.rebuildMenu() }
    }

    func menuDidClose(_ menu: NSMenu) {
        self.menuOpen = false
        if self.rebuildPending {
            self.rebuildPending = false
            self.rebuildMenu()
        }
    }

    private func rebuildMenu() {
        self.menu.removeAllItems()
        self.menu.addItem(self.makeCardItem())
        if let sections = self.store.snapshot?.submenuDetails, !sections.isEmpty {
            self.menu.addItem(.separator())
            for section in sections {
                self.menu.addItem(self.makeDetailNavigationItem(section))
            }
        }
        self.menu.addItem(.separator())
        self.menu.addItem(self.nativeItem(
            self.presentationLanguage.text("刷新", "Refresh"),
            image: "arrow.clockwise",
            action: #selector(self.refresh),
            key: "r"))
        self.menu.addItem(self.nativeItem(
            self.presentationLanguage.text("设置…", "Settings…"),
            image: "gearshape",
            action: #selector(self.openSettings),
            key: ","))
        self.menu.addItem(.separator())
        self.menu.addItem(self.nativeItem(
            self.presentationLanguage.text(
                "退出 Codex Capacity Planner",
                "Quit Codex Capacity Planner"),
            image: "xmark.square",
            action: #selector(self.quit),
            key: "q"))
    }

    private func makeCardItem() -> NSMenuItem {
        let highlight = MenuHighlightState()
        let root = ResetMenuCard(
            store: self.store,
            highlight: highlight,
            width: Self.cardWidth,
            hasSubmenu: false,
            onRefresh: { [weak self] in Task { await self?.store.refresh() } })
            .environment(\.resetPresentationLanguage, self.presentationLanguage)
            .environment(\.locale, self.presentationLanguage.locale)
        let hosting = FixedHeightHostingView(rootView: root)
        let measuredHeight = hosting.measuredFittingHeight(width: Self.cardWidth)
        hosting.apply(width: Self.cardWidth, height: measuredHeight + 7)

        let item = NSMenuItem()
        item.title = ""
        item.view = hosting
        item.isEnabled = true
        item.target = self
        item.action = #selector(self.noOp)
        return item
    }

    private func makeDetailNavigationItem(_ section: DetailSection) -> NSMenuItem {
        let item = NSMenuItem(title: section.title, action: nil, keyEquivalent: "")
        item.image = NSImage(
            systemSymbolName: Self.symbolName(for: section.title),
            accessibilityDescription: nil)
        if DetailMenuLayout.isMainlines(section.title) {
            item.submenu = self.makeDetailLeafSubmenu(section)
        } else if DetailMenuLayout.isCalculation(section.title) {
            item.submenu = self.makeCalculationSubmenu(section)
        } else {
            item.submenu = self.makeDetailSectionSubmenu(section)
        }
        item.isEnabled = true
        return item
    }

    private func makeDetailSectionSubmenu(_ section: DetailSection) -> NSMenu {
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        submenu.minimumWidth = Self.detailsWidth
        let grouped = Dictionary(grouping: section.rows) { $0.group ?? "all" }
        let visualizations = section.visualizations ?? []
        let isResetSection = DetailMenuLayout.isReset(section.title)
        let summaryKey = DetailMenuLayout.summaryGroup(section.title)
        let summaryRows = grouped[summaryKey] ?? (grouped.count == 1 ? section.rows : [])
        let rootRows = isResetSection ? (grouped["current"] ?? []) : summaryRows
        let rootVisualizationGroup = DetailMenuLayout.rootVisualizationGroup(section.title)
        let summaryVisualizations = visualizations.filter {
            ($0.group ?? "all") == rootVisualizationGroup
        }
        let groupOrder = DetailMenuLayout.childGroups(section.title)
        for key in groupOrder {
            let rows = DetailMenuLayout.rows(for: key, in: section)
            let groupVisualizations = visualizations.filter { ($0.group ?? "all") == key }
            guard !rows.isEmpty || !groupVisualizations.isEmpty else { continue }
            if !submenu.items.isEmpty, submenu.items.last?.isSeparatorItem != true {
                submenu.addItem(.separator())
            }
            let title = Self.detailGroupTitle(key, language: self.presentationLanguage)
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.image = NSImage(
                systemSymbolName: Self.detailGroupSymbol(key),
                accessibilityDescription: nil)
            item.submenu = self.makeDetailLeafSubmenu(DetailSection(
                title: title,
                rows: rows,
                visualizations: groupVisualizations.isEmpty ? nil : groupVisualizations))
            item.isEnabled = true
            submenu.addItem(item)
        }

        if !rootRows.isEmpty || !summaryVisualizations.isEmpty {
            if !submenu.items.isEmpty { submenu.insertItem(.separator(), at: 0) }
            // Reserve the actual native navigation rows, not empty space in
            // the SwiftUI content. Short timelines end directly above them.
            let navigationHeight = submenu.size.height
            submenu.insertItem(self.makeDetailContentItem(DetailSection(
                title: section.title,
                rows: rootRows,
                visualizations: summaryVisualizations.isEmpty ? nil : summaryVisualizations),
                reservedMenuHeight: navigationHeight), at: 0)
        }

        if submenu.items.isEmpty {
            submenu.addItem(self.makeDetailContentItem(section))
        }
        if !isResetSection {
            self.appendLinks(from: grouped.count == 1 ? section.rows : summaryRows, to: submenu)
            self.appendActions(from: grouped.count == 1 ? section.rows : summaryRows, to: submenu)
        }
        return submenu
    }

    private func makeDetailLeafSubmenu(_ section: DetailSection) -> NSMenu {
        if DetailMenuLayout.isCalculation(section.title) {
            return self.makeCalculationSubmenu(section)
        }
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        let usesInlineActions = DetailMenuLayout.usesInlineActions(section.title)
        let contentWidth = usesInlineActions
            ? Self.mainlineDetailsWidth
            : Self.detailsWidth
        submenu.minimumWidth = contentWidth
        if let visualizations = section.visualizations, !visualizations.isEmpty {
            submenu.addItem(self.makeDetailContentItem(
                section,
                width: contentWidth,
                onAction: usesInlineActions ? self.inlineActionHandler : nil))
            if !visualizations.contains(where: { $0.kind == "resetCalendar" }) {
                self.appendLinks(from: section.rows, to: submenu)
            }
            if !usesInlineActions {
                self.appendActions(from: section.rows, to: submenu)
            }
            return submenu
        }
        for (index, row) in section.rows.enumerated() {
            if index > 0, submenu.items.last?.isSeparatorItem != true {
                submenu.addItem(.separator())
            }
            submenu.addItem(self.makeDetailContentItem(
                DetailSection(title: section.title, rows: [row]),
                width: contentWidth,
                onAction: usesInlineActions ? self.inlineActionHandler : nil))
            self.appendLinks(from: [row], to: submenu)
            if !usesInlineActions {
                self.appendActions(from: [row], to: submenu)
            }
        }
        return submenu
    }

    private func makeCalculationSubmenu(_ section: DetailSection) -> NSMenu {
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        submenu.minimumWidth = Self.detailsWidth
        // Results, Method and Raw Data are in-page controls, not a third menu.
        submenu.addItem(self.makeDetailContentItem(section, width: Self.calculationDetailsWidth))
        return submenu
    }

    private func makeDetailContentSubmenu(_ section: DetailSection) -> NSMenu {
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        submenu.minimumWidth = Self.detailsWidth
        submenu.addItem(self.makeDetailContentItem(section))
        self.appendLinks(from: section.rows, to: submenu)
        self.appendActions(from: section.rows, to: submenu)
        return submenu
    }

    private func makeDetailContentItem(
        _ section: DetailSection,
        width: CGFloat? = nil,
        onAction: MainlineActionHandler? = nil,
        reservedMenuHeight: CGFloat = 0) -> NSMenuItem
    {
        let contentWidth = width ?? Self.detailsWidth
        let root = ResetDetailsView(
            sections: [section],
            width: contentWidth,
            onAction: onAction,
            history: self.store.snapshot?.decisionHistory,
            decisionContext: self.store.snapshot?.decisionContext,
            historyEvents: self.store.snapshot?.resetHistoryEvents)
            .environment(\.resetPresentationLanguage, self.presentationLanguage)
            .environment(\.locale, self.presentationLanguage.locale)
        let isCalculation = DetailMenuLayout.isCalculation(section.title)
        let isCalendar = section.visualizations?.contains { $0.kind == "resetCalendar" } == true
        let isTimeline = section.visualizations?.contains { $0.kind == "timeline" } == true
        let isExplanation = ["为什么这样建议", "Why This Plan"].contains(section.title) && self.store.snapshot?.decisionContext != nil
        let interactive = isCalculation || isCalendar || isTimeline || isExplanation
        let hosting: FixedHeightHostingView<AnyView>
        if interactive {
            let screen = self.statusItem.button?.window?.screen ?? NSScreen.main
            let availableHeight = (screen?.visibleFrame.height ?? 700) - reservedMenuHeight - 24
            hosting = MenuContentSizing.scrollHostingView(
                root: root, width: contentWidth, maximumHeight: availableHeight)
        } else {
            hosting = FixedHeightHostingView(rootView: AnyView(root))
            let measuredHeight = hosting.measuredFittingHeight(width: contentWidth)
            hosting.apply(width: contentWidth, height: measuredHeight)
        }
        let details = NSMenuItem()
        details.view = hosting
        details.isEnabled = onAction != nil || interactive
        if onAction != nil || interactive {
            details.target = self
            details.action = #selector(self.noOp)
        }
        return details
    }

    private var inlineActionHandler: MainlineActionHandler {
        { [weak self] action in
            guard let self else { return false }
            // NSMenuItem custom views can handle edits without ending tracking.
            // The row owns its feedback; defer structural menu changes until
            // tracking ends so successive edits keep their focus and position.
            guard self.allowsRefresh else { return true }
            return await self.store.perform(action)
        }
    }

    private func appendLinks(from rows: [DetailRow], to submenu: NSMenu) {
        let links = rows.compactMap(\.link)
        var seen = Set<String>()
        for link in links where seen.insert(link.url).inserted {
            if submenu.items.last?.isSeparatorItem != true { submenu.addItem(.separator()) }
            let label = self.presentationLanguage == .english
                ? link.labelEnglish ?? link.label
                : link.label
            let item = NSMenuItem(title: label, action: #selector(self.openLink(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = link.url
            item.image = NSImage(systemSymbolName: "arrow.up.right.square", accessibilityDescription: nil)
            submenu.addItem(item)
        }
    }

    private func appendActions(from rows: [DetailRow], to submenu: NSMenu) {
        let actions = rows.flatMap { $0.actions ?? [] }
        var seen = Set<String>()
        for action in actions where seen.insert("\(action.operation):\(action.targetId)").inserted {
            if submenu.items.last?.isSeparatorItem != true { submenu.addItem(.separator()) }
            let item = NSMenuItem(
                title: action.title,
                action: #selector(self.performDetailAction(_:)),
                keyEquivalent: "")
            item.target = self
            item.representedObject = DetailActionBox(action)
            let symbol = action.operation == "mark-mainline"
                ? "star"
                : action.operation == "complete"
                    ? "checkmark.circle"
                    : action.operation == "snooze"
                        ? "moon.zzz"
                        : "minus.circle"
            item.image = NSImage(systemSymbolName: symbol, accessibilityDescription: nil)
            submenu.addItem(item)
        }
    }

    private static func detailGroupTitle(
        _ key: String,
        language: ResetPresentationLanguage) -> String
    {
        switch key {
        case "calculation": language.text("计算与数据", "Calculation & Data")
        case "data": language.text("计算与数据", "Calculation & Data")
        case "assets": language.text("重置券", "Reset Credits")
        case "history": language.text("重置历史", "Reset History")
        case "official": language.text("官方消息", "Official Updates")
        default: language.text("更多信息", "More")
        }
    }

    private static func detailGroupSymbol(_ key: String) -> String {
        switch key {
        case "calculation": "scope"
        case "work": "play.circle"
        case "data": "waveform.path.ecg"
        case "assets": "ticket"
        case "history": "clock.arrow.circlepath"
        case "official": "megaphone"
        default: "ellipsis.circle"
        }
    }

    private static func calculationGroupTitle(
        _ key: String,
        language: ResetPresentationLanguage) -> String
    {
        switch key {
        case "calculation-result": language.text("计算结果", "Results")
        case "calculation-basis": language.text("计算依据", "Method")
        case "calculation-raw": language.text("原始数据", "Raw Data")
        default: language.text("更多信息", "More")
        }
    }

    private static func calculationGroupSymbol(_ key: String) -> String {
        switch key {
        case "calculation-result": "chart.bar.xaxis"
        case "calculation-basis": "function"
        case "calculation-raw": "tablecells"
        default: "ellipsis.circle"
        }
    }

    private static func symbolName(for title: String) -> String {
        switch title {
        case "建议主线", "Suggested Mainlines", "可继续的任务", "Suggested Tasks": "play.circle"
        case "用量与目标", "Usage & Targets", "账户", "Accounts": "scope"
        case "为什么这样建议", "Why This Plan": "chart.line.uptrend.xyaxis"
        case "重置", "Resets": "clock.arrow.circlepath"
        case "计算与数据", "Calculation & Data": "function"
        default: "list.bullet.rectangle"
        }
    }

    private func nativeItem(_ title: String, image: String, action: Selector, key: String) -> NSMenuItem {
        let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
        item.target = self
        item.image = NSImage(systemSymbolName: image, accessibilityDescription: nil)
        item.isEnabled = true
        return item
    }

    @objc private func refresh() {
        if self.allowsRefresh {
            Task { await self.store.refresh() }
        }
    }

    @objc private func noOp() {}

    @objc private func showActualMenuForCapture() {
        guard let button = self.statusItem.button else { return }
        NSApplication.shared.activate(ignoringOtherApps: true)
        button.highlight(true)
        let captureItem: NSMenuItem?
        switch ProcessInfo.processInfo.environment["CODEX_RESET_ACTUAL_MENU_SECTION"] {
        case "mainlines":
            captureItem = self.menu.items.first { DetailMenuLayout.isMainlines($0.title) }
        case "calculation":
            captureItem = self.menu.items.first { DetailMenuLayout.isCalculation($0.title) }
        case "explanation":
            captureItem = self.menu.items.first { ["为什么这样建议", "Why This Plan"].contains($0.title) }
        case "resets":
            captureItem = self.menu.items.first { DetailMenuLayout.isReset($0.title) }
        case "history":
            captureItem = self.menu.items.first { DetailMenuLayout.isReset($0.title) }?
                .submenu?.items.first { ["重置历史", "Reset History"].contains($0.title) }
        default:
            captureItem = nil
        }
        let captureMenu = captureItem?.submenu ?? self.menu
        if !self.allowsRefresh, let screen = NSScreen.screens.first {
            // Demo-only positioning keeps the real NSMenu visible even when
            // a crowded/notched status bar hides the extra demo status item,
            // and keeps it on the primary display when keyboard focus moves.
            captureMenu.popUp(positioning: nil,
                at: NSPoint(x: screen.visibleFrame.minX + 80, y: screen.visibleFrame.maxY - 40), in: nil)
        } else {
            captureMenu.popUp(
                positioning: nil,
                at: NSPoint(x: button.bounds.minX, y: button.bounds.minY - 3),
                in: button)
        }
        button.highlight(false)
    }

    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }

    @objc private func openSettings() {
        if let settingsWindow {
            settingsWindow.makeKeyAndOrderFront(nil)
        } else {
            let controller = NSHostingController(
                rootView: SettingsView(
                    store: self.store,
                    presentationLanguage: self.presentationLanguage)
                    .frame(width: 420)
                    .padding(24))
            let window = NSWindow(contentViewController: controller)
            window.title = self.presentationLanguage.text(
                "Codex Capacity Planner 设置",
                "Codex Capacity Planner Settings")
            window.styleMask = [.titled, .closable]
            window.center()
            window.makeKeyAndOrderFront(nil)
            self.settingsWindow = window
        }
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    @objc private func openLink(_ sender: NSMenuItem) {
        guard let raw = sender.representedObject as? String,
              let url = URL(string: raw), url.scheme == "https" else { return }
        NSWorkspace.shared.open(url)
    }

    @objc private func performDetailAction(_ sender: NSMenuItem) {
        guard let box = sender.representedObject as? DetailActionBox else { return }
        Task { await self.store.perform(box.action) }
    }

    private func showPreviewWindow() {
        let controller = NSHostingController(
            rootView: ResetMenuPreview(store: self.store)
                .environment(\.resetPresentationLanguage, self.presentationLanguage)
                .environment(\.locale, self.presentationLanguage.locale))
        let window = NSWindow(contentViewController: controller)
        window.title = "Codex Capacity Planner Menu Preview"
        window.styleMask = [.titled, .closable]
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = .clear
        window.isOpaque = false
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.previewWindow = window
        NSApplication.shared.activate(ignoringOtherApps: true)
    }
}
