import Combine
import CryptoKit
import Darwin
import Foundation

@MainActor
final class MonitorSupervisor: ObservableObject {
    private var process: Process?

    func start() async -> String? {
        guard process == nil,
              let resources = Bundle.main.resourceURL,
              FileManager.default.fileExists(atPath: resources.appendingPathComponent("codex-reset-monitor.js").path)
        else { return "本机组件不完整，请重新下载 Codex Capacity Planner。" }

        guard let runtimeID = Self.runtimeID(in: resources) else {
            return "本机组件无法校验，请重新下载完整安装包。"
        }
        if await self.runningRuntimeID() == runtimeID { return nil }
        if let takeoverError = await self.takeOverStaleBundledMonitor() {
            return takeoverError
        }

        let nodeCandidates = [
            resources.appendingPathComponent("node").path,
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
        ]
        guard let node = nodeCandidates.first(where: FileManager.default.isExecutableFile(atPath:)) else {
            return "内置运行组件缺失，请重新下载完整安装包。"
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
        environment["CODEX_RESET_LISTEN_HOST"] = LocalMonitorEndpoint.host
        environment["CODEX_RESET_LISTEN_PORT"] = String(LocalMonitorEndpoint.port)
        environment["CODEX_RESET_RUNTIME_ID"] = runtimeID
        child.environment = environment
        child.standardOutput = FileHandle.nullDevice
        child.standardError = FileHandle.nullDevice
        do {
            try child.run()
            process = child
            for _ in 0..<20 {
                if await self.runningRuntimeID() == runtimeID { return nil }
                if !child.isRunning { break }
                try? await Task.sleep(for: .milliseconds(100))
            }
            self.stop()
            return "本机组件未能接管，请退出后重新打开 Codex Capacity Planner。"
        } catch {
            process = nil
            return "本机组件启动失败：\(error.localizedDescription)"
        }
    }

    func stop() {
        guard let process else { return }
        if process.isRunning { process.terminate() }
        self.process = nil
    }

    deinit {
        if process?.isRunning == true { process?.terminate() }
    }

    private func runningRuntimeID() async -> String? {
        var request = URLRequest(url: LocalMonitorEndpoint.runtimeURL)
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.timeoutInterval = 0.5
        request.setValue("application/json", forHTTPHeaderField: "Accept")
        guard let (data, response) = try? await URLSession.shared.data(for: request),
              let http = response as? HTTPURLResponse,
              http.statusCode == 200,
              let descriptor = try? JSONDecoder().decode(RuntimeDescriptor.self, from: data),
              descriptor.protocolVersion == 1
        else { return nil }
        return descriptor.runtimeID
    }

    private func takeOverStaleBundledMonitor() async -> String? {
        let pids = Self.listeningPIDs()
        guard !pids.isEmpty else { return nil }
        let ownedPIDs = pids.filter(Self.isBundledMonitor)
        guard ownedPIDs.count == pids.count else {
            return "本机端口 18765 已被其他程序使用，Codex Capacity Planner 无法启动内部组件。"
        }
        for pid in ownedPIDs { _ = Darwin.kill(pid, SIGTERM) }
        for _ in 0..<20 {
            if Self.listeningPIDs().isEmpty { return nil }
            try? await Task.sleep(for: .milliseconds(100))
        }
        return "旧版本机组件未能退出，请退出后重新打开 Codex Capacity Planner。"
    }

    private static func runtimeID(in resources: URL) -> String? {
        let filenames = [
            "codex-reset-monitor.js",
            "codex-reset-history.js",
            "codex-reset.js",
            "codex-reset-behavior.js",
            "codex-reset-short-load.js",
            "codex-reset-workload-eval.js",
            "codex-reset-usage-history.js",
        ]
        var hasher = SHA256()
        for filename in filenames {
            let url = resources.appendingPathComponent(filename)
            guard let data = try? Data(contentsOf: url) else { return nil }
            hasher.update(data: Data(filename.utf8))
            hasher.update(data: data)
        }
        return hasher.finalize().map { String(format: "%02x", $0) }.joined()
    }

    private static func listeningPIDs() -> [pid_t] {
        let result = Self.commandOutput(
            executable: "/usr/sbin/lsof",
            arguments: [
                "-nP",
                "-t",
                "-iTCP:\(LocalMonitorEndpoint.port)",
                "-sTCP:LISTEN",
            ])
        guard result.status == 0 else { return [] }
        return result.output
            .split(whereSeparator: \.isNewline)
            .compactMap { pid_t($0.trimmingCharacters(in: .whitespacesAndNewlines)) }
    }

    private static func isBundledMonitor(_ pid: pid_t) -> Bool {
        let result = Self.commandOutput(
            executable: "/bin/ps",
            arguments: ["-p", String(pid), "-o", "command="])
        guard result.status == 0 else { return false }
        return result.output.contains("Codex Capacity Planner.app/Contents/Resources/")
            && result.output.contains("codex-reset-monitor.js")
    }

    private static func commandOutput(
        executable: String,
        arguments: [String]) -> (status: Int32, output: String)
    {
        let command = Process()
        let pipe = Pipe()
        command.executableURL = URL(fileURLWithPath: executable)
        command.arguments = arguments
        command.standardOutput = pipe
        command.standardError = FileHandle.nullDevice
        do {
            try command.run()
            command.waitUntilExit()
            let data = pipe.fileHandleForReading.readDataToEndOfFile()
            return (command.terminationStatus, String(decoding: data, as: UTF8.self))
        } catch {
            return (-1, "")
        }
    }
}

private struct RuntimeDescriptor: Decodable {
    let protocolVersion: Int
    let runtimeID: String
}
