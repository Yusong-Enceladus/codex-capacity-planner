import SwiftUI

/// One hierarchy for every first-level planner page, including embedded details.
enum PlannerTypography {
    static let title = Font.system(size: 16, weight: .semibold)
    static let heading = Font.system(size: 14, weight: .semibold)
    static let body = Font.system(size: 13)
    static let detail = Font.system(size: 12)
    static let metric = Font.system(size: 22, weight: .semibold, design: .rounded)
}
