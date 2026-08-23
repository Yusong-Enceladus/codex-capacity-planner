import Foundation

struct ResetSnapshot: Codable, Equatable, Sendable {
    let updatedAt: String?
    let dataConfidence: String?
    let decisionProgress: DecisionProgress?
    let details: [DetailSection]
    let submenuDetails: [DetailSection]
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

    var id: String {
        self.title
    }
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
        group: String? = nil)
    {
        self.label = label
        self.value = value
        self.secondaryValue = secondaryValue
        self.alternateValue = alternateValue
        self.relativeTimeAt = relativeTimeAt
        self.relativeTimePrefix = relativeTimePrefix
        self.link = link
        self.group = group
    }
}

struct DetailLink: Codable, Equatable, Sendable {
    let label: String
    let url: String
}
