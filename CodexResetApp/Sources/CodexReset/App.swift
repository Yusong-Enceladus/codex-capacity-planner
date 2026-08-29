import AppKit
import ServiceManagement
import SwiftUI

@main
enum CodexResetApplication {
    static func main() {
        let application = NSApplication.shared
        let delegate = ApplicationDelegate()
        application.delegate = delegate
        application.setActivationPolicy(.accessory)
        application.run()
    }
}

@MainActor
final class ApplicationDelegate: NSObject, NSApplicationDelegate {
    private var store: SnapshotStore?
    private let monitor = MonitorSupervisor()
    private var menuController: MenuController?
    private var galleryWindow: NSWindow?
    private var demoBackdropWindows: [NSWindow] = []

    func applicationDidFinishLaunching(_ notification: Notification) {
        // The loopback endpoint is an application-owned implementation detail.
        // Remove the legacy preference so upgrades cannot retain a broken URL.
        UserDefaults.standard.removeObject(forKey: "serviceURL")
        if let showcase = Self.readmeShowcase() {
            self.showReadmeShowcase(page: showcase.page, language: showcase.language)
            return
        }
        if let demoLanguage = Self.readmeDemoLanguage() {
            let store = SnapshotStore(snapshot: ResetDemoFixtures.primarySnapshot(demoLanguage))
            self.store = store
            self.showDemoBackdropIfAvailable()
            self.menuController = MenuController(
                store: store,
                presentationLanguage: demoLanguage,
                allowsRefresh: false)
            return
        }
        if let galleryPage = ProcessInfo.processInfo.arguments
            .first(where: { $0.hasPrefix("--state-gallery=") })?
            .split(separator: "=", maxSplits: 1).last.map(String.init)
        {
            self.showStateGallery(page: galleryPage)
            return
        }
        let store = SnapshotStore()
        self.store = store
        self.menuController = MenuController(store: store)
        store.start()
        Task {
            if let startupError = await self.monitor.start() {
                store.setStartupError(startupError)
                return
            }
            await store.refresh()
        }
    }

    func applicationWillTerminate(_ notification: Notification) {
        self.monitor.stop()
    }

    private func showStateGallery(page: String) {
        NSApplication.shared.setActivationPolicy(.regular)
        let controller = NSHostingController(rootView: ResetStateGallery(page: page))
        let window = NSWindow(contentViewController: controller)
        window.title = "Codex Capacity Planner 状态机 · \(page)"
        window.styleMask = [.titled, .closable, .resizable]
        window.appearance = NSAppearance(named: .darkAqua)
        window.setContentSize(NSSize(width: 1440, height: 900))
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.galleryWindow = window
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private func showReadmeShowcase(
        page: ResetReadmeShowcasePage,
        language: ResetPresentationLanguage)
    {
        NSApplication.shared.setActivationPolicy(.regular)
        let controller = NSHostingController(
            rootView: ResetReadmeShowcase(page: page, language: language)
                .environment(\.resetPresentationLanguage, language)
                .environment(\.locale, language.locale))
        controller.view.layoutSubtreeIfNeeded()
        let window = NSWindow(
            contentRect: NSRect(origin: .zero, size: controller.view.fittingSize),
            styleMask: [.borderless],
            backing: .buffered,
            defer: false)
        window.contentViewController = controller
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = .clear
        window.isOpaque = false
        window.hasShadow = false
        window.center()
        window.makeKeyAndOrderFront(nil)
        self.galleryWindow = window
        NSApplication.shared.activate(ignoringOtherApps: true)
    }

    private static func readmeDemoLanguage() -> ResetPresentationLanguage? {
        guard let rawValue = ProcessInfo.processInfo.arguments
            .first(where: { $0.hasPrefix("--readme-demo=") })?
            .split(separator: "=", maxSplits: 1).last
        else { return nil }
        return rawValue == "en" ? .english : .simplifiedChinese
    }

    private static func readmeShowcase() -> (
        page: ResetReadmeShowcasePage,
        language: ResetPresentationLanguage)?
    {
        guard let rawValue = ProcessInfo.processInfo.arguments
            .first(where: { $0.hasPrefix("--readme-showcase=") })?
            .split(separator: "=", maxSplits: 1).last.map(String.init)
        else { return nil }
        let language: ResetPresentationLanguage = rawValue.hasSuffix("-en")
            ? .english
            : .simplifiedChinese
        let page: ResetReadmeShowcasePage = rawValue.hasPrefix("accounts")
            ? .accounts
            : .resets
        return (page, language)
    }

    private func showDemoBackdropIfAvailable() {
        guard let rawPath = ProcessInfo.processInfo.environment["CODEX_RESET_DEMO_WALLPAPER"],
              let image = NSImage(contentsOfFile: rawPath)
        else { return }

        self.demoBackdropWindows = NSScreen.screens.map { screen in
            let localFrame = NSRect(origin: .zero, size: screen.frame.size)
            let imageView = NSImageView(frame: localFrame)
            imageView.image = image
            imageView.imageScaling = .scaleAxesIndependently
            let window = NSWindow(
                contentRect: localFrame,
                styleMask: [.borderless],
                backing: .buffered,
                defer: false,
                screen: screen)
            window.contentView = imageView
            window.setFrame(screen.frame, display: true)
            window.level = .floating
            window.collectionBehavior = [.canJoinAllSpaces, .stationary, .fullScreenAuxiliary]
            window.ignoresMouseEvents = true
            window.hasShadow = false
            window.orderFrontRegardless()
            return window
        }
    }
}

struct SettingsView: View {
    @ObservedObject var store: SnapshotStore
    let presentationLanguage: ResetPresentationLanguage
    @AppStorage("refreshInterval") private var refreshInterval = 60.0
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var launchError: String?

    var body: some View {
        Form {
            Section(self.presentationLanguage.text("通用", "General")) {
                Picker(
                    self.presentationLanguage.text("自动刷新", "Automatic refresh"),
                    selection: self.$refreshInterval)
                {
                    Text(self.presentationLanguage.text("1 分钟", "1 minute")).tag(60.0)
                    Text(self.presentationLanguage.text("5 分钟", "5 minutes")).tag(300.0)
                    Text(self.presentationLanguage.text("15 分钟", "15 minutes")).tag(900.0)
                }
                Toggle(
                    self.presentationLanguage.text("登录时启动", "Launch at login"),
                    isOn: self.$launchAtLogin)
                    .onChange(of: self.launchAtLogin) { _, enabled in
                        do {
                            if enabled { try SMAppService.mainApp.register() }
                            else { try SMAppService.mainApp.unregister() }
                            launchError = nil
                        } catch {
                            launchError = self.presentationLanguage.text(
                                "启动项更新失败：\(error.localizedDescription)",
                                "Could not update Login Items: \(error.localizedDescription)")
                            self.launchAtLogin = SMAppService.mainApp.status == .enabled
                        }
                    }
            }
            if let corrections = self.store.snapshot?.mainlineCorrections,
               !corrections.isEmpty
            {
                Section(self.presentationLanguage.text(
                    "主线判断（仅保存在本机）",
                    "Mainline decisions (stored locally)"))
                {
                    ForEach(corrections.prefix(20)) { correction in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(correction.label).lineLimit(1)
                                Text(self.correctionStatus(correction.status))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button(self.presentationLanguage.text(
                                "恢复自动判断",
                                "Restore automatic decision"))
                            {
                                Task {
                                    await self.store.perform(DetailAction(
                                        title: self.presentationLanguage.text(
                                            "恢复自动判断",
                                            "Restore automatic decision"),
                                        operation: "restore",
                                        targetId: correction.targetId))
                                }
                            }
                        }
                    }
                    if corrections.count > 20 {
                        Text(self.presentationLanguage.text(
                            "另有 \(corrections.count - 20) 条纠偏记录",
                            "\(corrections.count - 20) more corrections"))
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
            }
            if let launchError {
                Text(launchError).foregroundStyle(.red).font(.caption)
            }
        }
        .onChange(of: self.refreshInterval) { _, _ in self.store.reschedule() }
    }

    private func correctionStatus(_ status: String) -> String {
        switch status {
        case "mainline": self.presentationLanguage.text("已明确标为主线", "Explicitly marked as a mainline")
        case "not-mainline": self.presentationLanguage.text("已标为不是主线", "Marked as not a mainline")
        case "snoozed": self.presentationLanguage.text("已暂不推荐", "Snoozed")
        case "complete": self.presentationLanguage.text("已标为完成", "Marked complete")
        default: status
        }
    }
}
