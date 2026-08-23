import Combine
import Foundation

@MainActor
final class MonitorSupervisor: ObservableObject {
    private var process: Process?

    func start() -> String? {
        guard process == nil,
              let resources = Bundle.main.resourceURL,
              FileManager.default.fileExists(atPath: resources.appendingPathComponent("codex-reset-monitor.js").path)
        else { return "Monitor 资源不完整，请重新下载 Codex Capacity Planner。" }

        let nodeCandidates = [
            resources.appendingPathComponent("node").path,
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
        ]
        guard let node = nodeCandidates.first(where: FileManager.default.isExecutableFile(atPath:)) else {
            return "内置 Node.js 运行时缺失，且系统未安装 Node.js。请重新下载完整安装包。"
        }
        let support = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("CodexReset", isDirectory: true)
        try? FileManager.default.createDirectory(at: support, withIntermediateDirectories: true)

        let child = Process()
        child.executableURL = URL(fileURLWithPath: node)
        child.arguments = [resources.appendingPathComponent("codex-reset-monitor.js").path]
        var environment = ProcessInfo.processInfo.environment
        environment["CODEX_RESET_PROVIDER_FILE"] = resources.appendingPathComponent("codex-reset.js").path
        environment["CODEX_RESET_ASSET_DIR"] = resources.appendingPathComponent("receiver", isDirectory: true).path
        environment["CODEX_RESET_STATE_FILE"] = support.appendingPathComponent("monitor-state.json").path
        environment["CODEX_RESET_CODEXBAR_CLI"] = resources.appendingPathComponent("CodexBarCLI").path
        child.environment = environment
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        do {
            try child.run()
            process = child
            return nil
        } catch {
            process = nil
            return "Monitor 启动失败：\(error.localizedDescription)"
        }
    }

    deinit {
        if process?.isRunning == true { process?.terminate() }
    }
}
