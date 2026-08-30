import Combine
import SwiftUI

typealias MainlineActionHandler = @MainActor (DetailAction) async -> Bool

enum MainlineActionPhase: Equatable {
    case ready
    case saving(DetailAction)
    case saved(DetailAction)
    case failed(DetailAction)
}

@MainActor
final class MainlineActionState: ObservableObject {
    @Published private(set) var phase: MainlineActionPhase = .ready

    func perform(_ action: DetailAction, using handler: MainlineActionHandler) async {
        if case .saving = self.phase { return }
        self.phase = .saving(action)
        self.phase = await handler(action) ? .saved(action) : .failed(action)
    }

    func dismissFailure() {
        guard case .failed = self.phase else { return }
        self.phase = .ready
    }
}

/// A correction is an in-place edit, not a menu command. Keep this row and its
/// neighbours stable for the current tracking session; the next opening uses
/// the newly ranked snapshot. The feedback replaces the buttons at the same
/// height, so saving does not move the pointer onto a different mainline.
struct MainlineActionBar: View {
    @Environment(\.resetPresentationLanguage) private var presentationLanguage
    @StateObject private var state = MainlineActionState()
    let actions: [DetailAction]
    let onAction: MainlineActionHandler

    var body: some View {
        HStack(spacing: 5) {
            switch self.state.phase {
            case .ready:
                ForEach(Array(self.actions.enumerated()), id: \.offset) { _, action in
                    self.actionButton(action)
                }
            case .saving:
                ProgressView().controlSize(.mini)
                Text(self.presentationLanguage.text("正在保存…", "Saving…"))
                    .foregroundStyle(.secondary)
            case let .saved(action):
                Label(self.savedLabel(action.operation), systemImage: "checkmark.circle.fill")
                    .foregroundStyle(.secondary)
                if action.operation != "restore" {
                    Spacer(minLength: 5)
                    self.actionButton(DetailAction(
                        title: self.presentationLanguage.text("恢复自动判断", "Restore automatic decision"),
                        operation: "restore",
                        targetId: action.targetId))
                }
            case let .failed(action):
                Label(
                    self.presentationLanguage.text("未能保存", "Couldn’t save"),
                    systemImage: "exclamationmark.triangle")
                    .foregroundStyle(.secondary)
                Button(self.presentationLanguage.text("重试", "Retry")) {
                    self.perform(action)
                }
                Button(self.presentationLanguage.text("返回", "Back")) {
                    self.state.dismissFailure()
                }
            }
        }
        .font(.caption2.weight(.medium))
        .lineLimit(1)
        .minimumScaleFactor(0.8)
        .buttonStyle(.bordered)
        .controlSize(.mini)
        .frame(maxWidth: .infinity, alignment: .leading)
        .frame(height: 22)
        .accessibilityElement(children: .contain)
    }

    private func actionButton(_ action: DetailAction) -> some View {
        Button {
            self.perform(action)
        } label: {
            Label(action.title, systemImage: self.actionSymbol(action.operation))
        }
        .fixedSize(horizontal: true, vertical: false)
        .help(action.title)
        .accessibilityLabel(action.title)
    }

    private func perform(_ action: DetailAction) {
        Task { await self.state.perform(action, using: self.onAction) }
    }

    private func savedLabel(_ operation: String) -> String {
        switch operation {
        case "mark-mainline": self.presentationLanguage.text("已标为主线", "Marked as mainline")
        case "complete": self.presentationLanguage.text("已标记完成", "Marked complete")
        case "snooze": self.presentationLanguage.text("已暂不推荐", "Suggestions paused")
        case "restore": self.presentationLanguage.text("已恢复自动判断", "Automatic decision restored")
        default: self.presentationLanguage.text("已标为非主线", "Not a mainline")
        }
    }

    private func actionSymbol(_ operation: String) -> String {
        switch operation {
        case "mark-mainline": "star"
        case "complete": "checkmark.circle"
        case "snooze": "moon.zzz"
        case "restore": "arrow.uturn.backward"
        default: "minus.circle"
        }
    }
}
