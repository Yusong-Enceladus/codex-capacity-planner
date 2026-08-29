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
        if let startupError = self.monitor.start() {
            store.setStartupError(startupError)
        }
        self.menuController = MenuController(store: store)
        store.start()
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
    @AppStorage("serviceURL") private var serviceURL = "http://127.0.0.1:18765"
    @AppStorage("refreshInterval") private var refreshInterval = 60.0
    @State private var launchAtLogin = SMAppService.mainApp.status == .enabled
    @State private var launchError: String?

    var body: some View {
        Form {
            TextField("本机服务", text: self.$serviceURL)
            Picker("自动刷新", selection: self.$refreshInterval) {
                Text("1 分钟").tag(60.0)
                Text("5 分钟").tag(300.0)
                Text("15 分钟").tag(900.0)
            }
            Toggle("登录时启动", isOn: self.$launchAtLogin)
                .onChange(of: self.launchAtLogin) { _, enabled in
                    do {
                        if enabled { try SMAppService.mainApp.register() }
                        else { try SMAppService.mainApp.unregister() }
                        launchError = nil
                    } catch {
                        launchError = "启动项更新失败：\(error.localizedDescription)"
                        self.launchAtLogin = SMAppService.mainApp.status == .enabled
                    }
                }
            if let corrections = self.store.snapshot?.mainlineCorrections,
               !corrections.isEmpty
            {
                Section("主线纠偏（仅保存在本机）") {
                    ForEach(corrections.prefix(20)) { correction in
                        HStack(alignment: .firstTextBaseline, spacing: 12) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(correction.label).lineLimit(1)
                                Text(self.correctionStatus(correction.status))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Button("恢复自动判断") {
                                Task {
                                    await self.store.perform(DetailAction(
                                        title: "恢复自动判断",
                                        operation: "restore",
                                        targetId: correction.targetId))
                                }
                            }
                        }
                    }
                    if corrections.count > 20 {
                        Text("另有 \(corrections.count - 20) 条纠偏记录")
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
        case "mainline": "已明确标为主线"
        case "not-mainline": "已标为不是主线"
        case "snoozed": "已暂不推荐"
        case "complete": "已标为完成"
        default: status
        }
    }
}
