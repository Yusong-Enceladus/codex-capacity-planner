import Testing
@testable import CodexReset

@Test func `native charts keep unavailable observations and cycle changes as real gaps`() throws {
    let records = try #require(ResetDemoFixtures.primarySnapshot(.english).decisionHistory?.records)
    let probability = HistoryPlotModel(records: records, accountID: nil)
    #expect(probability.segments.count == 4)
    #expect(!probability.segments.flatMap(\.points).contains { $0.id == records[2].id })
    #expect(probability.observations.count == records.count)
    let target = HistoryPlotModel(records: records, accountID: "demo-work")
    #expect(target.segments.count == 2)
    #expect(target.segments.first?.points.count == 1)
    #expect(target.segments.last?.points.count == 7)
    #expect(target.domain == probability.domain)
    #expect(target.axisDates == probability.axisDates)
}

@Test func `native plot selection includes missing observations and does not fabricate singleton trends`() throws {
    let records = try #require(ResetDemoFixtures.primarySnapshot(.english).decisionHistory?.records)
    let model = HistoryPlotModel(records: records, accountID: nil)
    let missingDate = try #require(HistoryPresentation.date(records[2].at))
    #expect(model.nearestRecord(to: missingDate) == records[2].id)
    let singleton = HistoryPlotModel(records: [records[0]], accountID: nil)
    #expect(singleton.segments.allSatisfy { $0.points.count == 1 })
    #expect(singleton.axisDates.count == 1)
    let sparse = HistoryPlotModel(records: [records[0],records[1],records[7]], accountID: nil)
    #expect(sparse.segments.count == 4)
}
