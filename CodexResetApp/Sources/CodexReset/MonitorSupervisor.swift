import Combine
import Foundation

@MainActor
final class MonitorSupervisor: ObservableObject {
    private var process: Process?

    func start() {
        guard process == nil,
              let resources = Bundle.main.resourceURL,
              FileManager.default.fileExists(atPath: resources.appendingPathComponent("codex-reset-monitor.js").path)
        else { return }

        let nodeCandidates = ["/opt/homebrew/bin/node", "/usr/local/bin/node"]
        guard let node = nodeCandidates.first(where: FileManager.default.isExecutableFile(atPath:)) else {
            return
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
        } catch {
            process = nil
        }
    }

    deinit {
        if process?.isRunning == true { process?.terminate() }
    }
}
