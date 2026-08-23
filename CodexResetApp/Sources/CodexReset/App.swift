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
    private let store = SnapshotStore()
    private let monitor = MonitorSupervisor()
    private var menuController: MenuController?
    private var galleryWindow: NSWindow?

    func applicationDidFinishLaunching(_ notification: Notification) {
        if let galleryPage = ProcessInfo.processInfo.arguments
            .first(where: { $0.hasPrefix("--state-gallery=") })?
            .split(separator: "=", maxSplits: 1).last.map(String.init)
        {
            self.showStateGallery(page: galleryPage)
            return
        }
        self.monitor.start()
        self.menuController = MenuController(store: self.store)
        self.store.start()
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
            if let launchError {
                Text(launchError).foregroundStyle(.red).font(.caption)
            }
        }
        .onChange(of: self.refreshInterval) { _, _ in self.store.reschedule() }
    }
}
