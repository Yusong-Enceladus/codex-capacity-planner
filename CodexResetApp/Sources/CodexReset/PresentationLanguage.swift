import Foundation
import SwiftUI

enum ResetPresentationLanguage: String, Sendable {
    case simplifiedChinese
    case english

    var locale: Locale {
        switch self {
        case .simplifiedChinese: Locale(identifier: "zh-Hans")
        case .english: Locale(identifier: "en")
        }
    }

    var timeZone: TimeZone {
        switch self {
        case .simplifiedChinese:
            TimeZone(identifier: "Asia/Shanghai") ?? .gmt
        case .english:
            TimeZone(identifier: "America/Los_Angeles") ?? .gmt
        }
    }

    var timeZoneLabel: String {
        self.text("UTC+8", "PT")
    }

    func text(_ simplifiedChinese: String, _ english: String) -> String {
        switch self {
        case .simplifiedChinese: simplifiedChinese
        case .english: english
        }
    }
}

private struct ResetPresentationLanguageKey: EnvironmentKey {
    static let defaultValue = ResetPresentationLanguage.simplifiedChinese
}

extension EnvironmentValues {
    var resetPresentationLanguage: ResetPresentationLanguage {
        get { self[ResetPresentationLanguageKey.self] }
        set { self[ResetPresentationLanguageKey.self] = newValue }
    }
}
