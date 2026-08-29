import Foundation

struct ResetSnapshot: Codable, Equatable, Sendable {
    let updatedAt: String?
    let dataConfidence: String?
    let decisionProgress: DecisionProgress?
    var mainlineCorrections: [MainlineCorrection]? = nil
    let details: [DetailSection]
    let submenuDetails: [DetailSection]
}

struct MainlineCorrection: Codable, Equatable, Identifiable, Sendable {
    let targetId: String
    let label: String
    let project: String?
    let status: String
    let updatedAt: String?

    var id: String { self.targetId }
}

struct DecisionProgress: Codable, Equatable, Sendable {
    let title: String
    let alternateTitle: String?
    let currentPercent: Double
    let targetPercent: Double
    let projectedPercent: Double?
    let projectedLowerPercent: Double?
    let projectedUpperPercent: Double?
    let currentLabel: String
    let targetLabel: String
    let projectedLabel: String
}

struct DetailSection: Codable, Equatable, Identifiable, Sendable {
    let title: String
    let rows: [DetailRow]
    let visualizations: [DetailVisualization]?

    var id: String {
        self.title
    }

    init(
        title: String,
        rows: [DetailRow],
        visualizations: [DetailVisualization]? = nil)
    {
        self.title = title
        self.rows = rows
        self.visualizations = visualizations
    }
}

/// Structured presentation data keeps temporal and lifecycle semantics out of
/// display strings. The desktop client owns symbols, line styles, and colors.
struct DetailVisualization: Codable, Equatable, Identifiable, Sendable {
    let kind: String
    let group: String?
    let title: String
    let items: [DetailTimelineItem]

    var id: String {
        let group = self.group ?? "all"
        return "\(group)\u{1f}\(self.kind)\u{1f}\(self.title)"
    }
}

struct DetailTimelineItem: Codable, Equatable, Identifiable, Sendable {
    let id: String
    let kind: String
    let state: String
    let title: String
    let detail: String?
    let badge: String
    let at: String?
    let endAt: String?
    let publishedAt: String?
    let link: DetailLink?
}

struct DetailRow: Codable, Equatable, Identifiable, Sendable {
    let label: String
    let value: String
    let secondaryValue: String?
    let alternateValue: String?
    let relativeTimeAt: String?
    let relativeTimePrefix: String?
    let link: DetailLink?
    let group: String?
    let progress: DecisionProgress?
    let actions: [DetailAction]?

    var id: String {
        "\(self.label)\u{1f}\(self.value)"
    }

    init(
        label: String,
        value: String,
        secondaryValue: String? = nil,
        alternateValue: String? = nil,
        relativeTimeAt: String? = nil,
        relativeTimePrefix: String? = nil,
        link: DetailLink? = nil,
        group: String? = nil,
        progress: DecisionProgress? = nil,
        actions: [DetailAction]? = nil)
    {
        self.label = label
        self.value = value
        self.secondaryValue = secondaryValue
        self.alternateValue = alternateValue
        self.relativeTimeAt = relativeTimeAt
        self.relativeTimePrefix = relativeTimePrefix
        self.link = link
        self.group = group
        self.progress = progress
        self.actions = actions
    }
}

struct DetailAction: Codable, Equatable, Sendable {
    let title: String
    let operation: String
    let targetId: String
}

struct DetailLink: Codable, Equatable, Sendable {
    let label: String
    let url: String
}
