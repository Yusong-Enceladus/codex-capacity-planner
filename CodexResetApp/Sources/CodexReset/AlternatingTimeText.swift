import Foundation
import SwiftUI

enum AlternatingDisplay {
    static let interval: TimeInterval = 10

    static func usesAlternate(at date: Date) -> Bool {
        Int(floor(date.timeIntervalSince1970 / self.interval)).isMultiple(of: 2) == false
    }

    static func relativeText(
        until target: Date,
        now: Date,
        language: ResetPresentationLanguage = .simplifiedChinese) -> String
    {
        let remaining = target.timeIntervalSince(now)
        if remaining <= 0 {
            return language.text("等待刷新确认", "Waiting for reset confirmation")
        }
        let hour: TimeInterval = 60 * 60
        let day: TimeInterval = 24 * hour
        let totalMinutes = max(1, Int(remaining / 60))
        if totalMinutes < 60 {
            return language.text("\(totalMinutes) 分钟后", "in \(totalMinutes) min")
        }
        let totalHours = max(1, Int(remaining / hour))
        if totalHours < 24 {
            return language.text("\(totalHours) 小时后", "in \(totalHours) hr")
        }
        let days = Int(remaining / day)
        let hours = Int((remaining - Double(days) * day) / hour)
        if hours == 0 {
            return language.text("\(days) 天后", "in \(days) days")
        }
        return language.text("\(days) 天 \(hours) 小时后", "in \(days) days \(hours) hr")
    }

    static func date(from value: String?) -> Date? {
        guard let value else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) { return date }
        return ISO8601DateFormatter().date(from: value)
    }
}

struct AlternatingTimeText: View {
    @Environment(\.resetPresentationLanguage) private var presentationLanguage
    let primary: String
    var alternate: String?
    var relativeTimeAt: String?
    var relativeTimePrefix: String?

    init(
        primary: String,
        alternate: String? = nil,
        relativeTimeAt: String? = nil,
        relativeTimePrefix: String? = nil)
    {
        self.primary = primary
        self.alternate = alternate
        self.relativeTimeAt = relativeTimeAt
        self.relativeTimePrefix = relativeTimePrefix
    }

    var body: some View {
        TimelineView(.periodic(from: Date(timeIntervalSince1970: 0), by: AlternatingDisplay.interval)) { timeline in
            Text(self.value(at: timeline.date))
        }
    }

    private func value(at now: Date) -> String {
        guard AlternatingDisplay.usesAlternate(at: now) else { return self.primary }
        if let target = AlternatingDisplay.date(from: self.relativeTimeAt) {
            return (self.relativeTimePrefix ?? "") + AlternatingDisplay.relativeText(
                until: target,
                now: now,
                language: self.presentationLanguage)
        }
        return self.alternate ?? self.primary
    }
}
