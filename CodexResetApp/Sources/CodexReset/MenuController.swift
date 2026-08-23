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

@MainActor
final class MenuController: NSObject, NSMenuDelegate {
    private static let cardWidth: CGFloat = 310
    private static let detailsWidth: CGFloat = 380

    private let store: SnapshotStore
    private let statusItem: NSStatusItem
    private let menu = NSMenu()
    private var settingsWindow: NSWindow?
    private var previewWindow: NSWindow?
    private var cancellables = Set<AnyCancellable>()
    private var menuOpen = false
    private var rebuildPending = false

    init(store: SnapshotStore) {
        self.store = store
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)
        super.init()
        self.statusItem.autosaveName = "codex-reset"
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
            let rawDelay = ProcessInfo.processInfo.environment["CODEX_RESET_ACTUAL_MENU_DELAY"]
            let delay = rawDelay.flatMap(Double.init) ?? 2
            DispatchQueue.main.asyncAfter(deadline: .now() + delay) { [weak self] in
                self?.statusItem.button?.performClick(nil)
            }
        }
    }

    func menuWillOpen(_ menu: NSMenu) {
        self.menuOpen = true
        Task { await self.store.refresh() }
    }

    func menuNeedsUpdate(_ menu: NSMenu) {
        self.rebuildMenu()
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
        self.menu.addItem(.separator())
        self.menu.addItem(self.nativeItem("刷新", image: "arrow.clockwise", action: #selector(self.refresh), key: "r"))
        self.menu.addItem(self.nativeItem("设置…", image: "gearshape", action: #selector(self.openSettings), key: ","))
        self.menu.addItem(.separator())
        self.menu.addItem(self.nativeItem(
            "退出 Codex Capacity Planner",
            image: "xmark.square",
            action: #selector(self.quit),
            key: "q"))
    }

    private func makeCardItem() -> NSMenuItem {
        let highlight = MenuHighlightState()
        let hasSubmenu = !(self.store.snapshot?.submenuDetails.isEmpty ?? true)
        let root = ResetMenuCard(
            store: self.store,
            highlight: highlight,
            width: Self.cardWidth,
            hasSubmenu: hasSubmenu,
            onRefresh: { [weak self] in Task { await self?.store.refresh() } })
        let hosting = FixedHeightHostingView(rootView: root)
        let measuredHeight = hosting.measuredFittingHeight(width: Self.cardWidth)
        hosting.apply(width: Self.cardWidth, height: measuredHeight + 7)

        let item = NSMenuItem()
        item.title = ""
        item.view = hosting
        item.isEnabled = true
        item.submenu = self.makeDetailsSubmenu()
        item.target = self
        item.action = #selector(self.noOp)
        return item
    }

    private func makeDetailsSubmenu() -> NSMenu? {
        guard let sections = self.store.snapshot?.submenuDetails, !sections.isEmpty else { return nil }
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        submenu.minimumWidth = Self.detailsWidth
        for section in sections {
            let item = NSMenuItem(title: section.title, action: nil, keyEquivalent: "")
            item.image = NSImage(
                systemSymbolName: Self.symbolName(for: section.title),
                accessibilityDescription: nil)
            item.submenu = self.makeDetailSectionSubmenu(section)
            item.isEnabled = true
            submenu.addItem(item)
        }
        return submenu
    }

    private func makeDetailSectionSubmenu(_ section: DetailSection) -> NSMenu {
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        submenu.minimumWidth = Self.detailsWidth
        let grouped = Dictionary(grouping: section.rows) { $0.group ?? "all" }
        let summaryKey = section.title == "为什么这样建议" ? "summary" : "current"
        let summaryRows = grouped[summaryKey] ?? (grouped.count == 1 ? section.rows : [])
        if !summaryRows.isEmpty {
            submenu.addItem(self.makeDetailContentItem(DetailSection(title: section.title, rows: summaryRows)))
        }

        let groupOrder = section.title == "为什么这样建议"
            ? ["calculation", "work", "data"]
            : ["assets", "history", "official"]
        for key in groupOrder {
            guard let rows = grouped[key], !rows.isEmpty else { continue }
            if !submenu.items.isEmpty, submenu.items.last?.isSeparatorItem != true {
                submenu.addItem(.separator())
            }
            let title = Self.detailGroupTitle(key)
            let item = NSMenuItem(title: title, action: nil, keyEquivalent: "")
            item.image = NSImage(
                systemSymbolName: Self.detailGroupSymbol(key),
                accessibilityDescription: nil)
            item.submenu = self.makeDetailLeafSubmenu(DetailSection(title: title, rows: rows))
            item.isEnabled = true
            submenu.addItem(item)
        }

        if submenu.items.isEmpty {
            submenu.addItem(self.makeDetailContentItem(section))
        }
        self.appendLinks(from: grouped.count == 1 ? section.rows : summaryRows, to: submenu)
        return submenu
    }

    private func makeDetailLeafSubmenu(_ section: DetailSection) -> NSMenu {
        let submenu = NSMenu()
        submenu.autoenablesItems = false
        submenu.minimumWidth = Self.detailsWidth
        for (index, row) in section.rows.enumerated() {
            if index > 0, submenu.items.last?.isSeparatorItem != true {
                submenu.addItem(.separator())
            }
            submenu.addItem(self.makeDetailContentItem(DetailSection(title: section.title, rows: [row])))
            self.appendLinks(from: [row], to: submenu)
        }
        return submenu
    }

    private func makeDetailContentItem(_ section: DetailSection) -> NSMenuItem {
        let root = ResetDetailsView(sections: [section], width: Self.detailsWidth)
        let hosting = FixedHeightHostingView(rootView: root)
        let measuredHeight = hosting.measuredFittingHeight(width: Self.detailsWidth)
        hosting.apply(width: Self.detailsWidth, height: measuredHeight)
        let details = NSMenuItem()
        details.view = hosting
        details.isEnabled = false
        return details
    }

    private func appendLinks(from rows: [DetailRow], to submenu: NSMenu) {
        let links = rows.compactMap(\.link)
        var seen = Set<String>()
        for link in links where seen.insert(link.url).inserted {
            if submenu.items.last?.isSeparatorItem != true { submenu.addItem(.separator()) }
            let item = NSMenuItem(title: link.label, action: #selector(self.openLink(_:)), keyEquivalent: "")
            item.target = self
            item.representedObject = link.url
            item.image = NSImage(systemSymbolName: "arrow.up.right.square", accessibilityDescription: nil)
            submenu.addItem(item)
        }
    }

    private static func detailGroupTitle(_ key: String) -> String {
        switch key {
        case "calculation": "使用与目标"
        case "work": "建议任务"
        case "data": "计算与数据"
        case "assets": "可用重置"
        case "history": "重置历史"
        case "official": "官方消息"
        default: "更多信息"
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

    private static func symbolName(for title: String) -> String {
        switch title {
        case "可继续的任务": "play.circle"
        case "账户": "person.2"
        case "为什么这样建议": "chart.line.uptrend.xyaxis"
        case "重置": "clock.arrow.circlepath"
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
        Task { await self.store.refresh() }
    }

    @objc private func noOp() {}
    @objc private func quit() {
        NSApplication.shared.terminate(nil)
    }

    @objc private func openSettings() {
        if let settingsWindow {
            settingsWindow.makeKeyAndOrderFront(nil)
        } else {
            let controller = NSHostingController(
                rootView: SettingsView(store: self.store).frame(width: 420).padding(24))
            let window = NSWindow(contentViewController: controller)
            window.title = "Codex Capacity Planner 设置"
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

    private func showPreviewWindow() {
        let controller = NSHostingController(rootView: ResetMenuPreview(store: self.store))
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
