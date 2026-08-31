// Synthetic reproduction: a promise is promoted after the quota has reset,
// and a completion post is incorrectly returned as another dated promise.
// No account identifiers, usage logs or messages from a user's Mac are used.
function resetDeliveryFixture() {
  const now = Date.parse("2026-08-31T04:00:00.000Z");
  const hour = 3_600_000;
  const week = 7 * 24 * hour;
  const noticeID = "2999999999999910001";
  const completionID = "2999999999999910002";
  const previousID = "2999999999999910000";
  const receiptAt = Date.parse("2026-08-31T02:25:40.000Z");
  const notice = {
    id: noticeID, type: "reset", group: "reset", announced_at: "2026-08-30T19:24:37.000Z",
    summary: "Your Codex usage reset will land at 6pm PST.",
    localized_summary: "Codex 用量将在太平洋标准时间下午 6 点重置。",
    announcement_state: "none", reset_verification_status: "pending", official_window: null,
    url: `https://x.com/thsottiaux/status/${noticeID}`,
  };
  const completion = {
    id: completionID, type: "reset", group: "reset", announced_at: "2026-08-31T02:34:27.000Z",
    summary: "We have now reset usage for all paid Codex subscriptions. See you soon for more news.",
    localized_summary: "我们现在已重置所有 Codex 付费订阅的用量。更多消息稍后公布。",
    announcement_state: "none", reset_verification_status: "pending", official_window: null,
    url: `https://x.com/thsottiaux/status/${completionID}`,
  };
  const forecast = {
    updated_at: new Date(now).toISOString(), last_reset_at: new Date(now - 2 * 24 * hour).toISOString(),
    probabilities: { rounded_24h: 25, rounded_48h: 45, commitment_floor_percent: 93 },
    model: { version: "fixture", base_daily_rate: 0.2 }, confidence: "medium", mode: "forecast",
    official_signal: {
      tweet_id: completionID, at: completion.announced_at, summary: completion.summary,
      localized_summary: completion.localized_summary, url: completion.url,
      kind: "signal", signal_type: "dated_commitment", signal_tier: "likely",
      score: { band: "dated_commitment", value: 93 },
      window: {
        start_at: completion.announced_at, end_at: "2026-09-01T06:59:59.999Z",
        target_at: "2026-09-01T06:59:59.999Z", target_kind: "deadline",
        time_zone: "America/Los_Angeles", label: "end of Monday",
      },
    },
  };
  const feed = { events: [completion, notice], tweets: [completion, notice].map((event) => ({
    id: event.id, at: event.announced_at, text: event.summary, kind: "candidate", url: event.url,
  })) };
  feed.tweets.unshift({
    id: "2999999999999910004", conversation_id: "2999999999999910004",
    at: "2026-08-31T02:40:00.000Z", kind: "other", tibo_lane: "reset_related",
    explicit_reset_claim: false, in_reply_to_status_id: null, in_reply_to_user_id: null,
    text: "Pro 20X means 20 times Plus weekly usage. Neither Pro plan has 5h limits.",
    url: "https://x.com/thsottiaux/status/2999999999999910004",
  });
  const accounts = ["demo-primary", "demo-backup"].map((id, index) => {
    const resetAt = receiptAt + index * 20 * 60_000 + week;
    const updatedAt = new Date(now - 30_000).toISOString();
    const latest = {
      usedPercent: index === 0 ? 3 : 0, windowMinutes: 10080,
      resetsAtMs: resetAt, resetsAt: new Date(resetAt).toISOString(),
      updatedAtMs: Date.parse(updatedAt), updatedAt, exact: true,
    };
    const raw = {
      provider: "codex", accountId: id, account: index === 0 ? "primary@example.test" : "backup@example.test",
      accountActive: index === 0, accountLive: index === 0,
      usage: { updatedAt, dataConfidence: "exact", identity: { loginMethod: index === 0 ? "pro" : "prolite" },
        secondary: { usedPercent: latest.usedPercent, windowMinutes: 10080, resetsAt: latest.resetsAt } },
    };
    return {
      id, label: raw.account, present: true, live: index === 0, selected: index === 0,
      planType: index === 0 ? "pro" : "prolite", cycleGeneration: index === 0 ? 3 : 2,
      resetCredits: { reliable: true, updatedAt, credits: [{
        id: `demo-credit-${index}`, status: "available", resetType: "full",
        grantedAt: new Date(now - week).toISOString(), expiresAt: new Date(now + (3 + index) * week).toISOString(),
      }] },
      usage: { latest, payload: [raw], samples: [{ atMs: latest.updatedAtMs, usedPercent: latest.usedPercent, resetsAtMs: resetAt }] },
      personalResets: [
        { at: new Date(now - 2 * 24 * hour).toISOString(), cause: "global-manual", evidence: "usage-decreased", generation: 2, eventId: previousID },
        ...(index === 0 ? [{ at: new Date(receiptAt).toISOString(), cause: "global-manual", evidence: "forced-window-rebuilt:usage-decreased", generation: 3, eventId: null }] : []),
      ],
      targetTrajectory: {
        version: 1, anchorAt: "2026-08-31T02:38:18.000Z", anchorRemainingPercent: 0,
        naturalResetAt: latest.resetsAt, cycleResetAt: latest.resetsAt,
        cycleStartedAt: new Date(resetAt - week).toISOString(), policyKind: "immediate",
        policyHazardPerHour: 0, policyDeadlineAt: null, policySource: "explicit-now", signalId: noticeID,
      },
    };
  });
  // The runtime's root usage is a view of the active account; its cached
  // collector payload includes every account, as after a real refreshUsage.
  accounts[0].usage.payload = accounts.flatMap((account) => account.usage.payload);
  const state = {
    version: 21, activeAccountId: accounts[0].id, selectedAccountId: accounts[0].id,
    usage: accounts[0].usage,
    accountStates: Object.fromEntries(accounts.map((account) => [account.id, account])),
    cache: { forecast, feed },
    events: { closedIds: [previousID] },
    activeEpisode: {
      id: noticeID, announcedAt: notice.announced_at, summary: notice.summary,
      localizedSummary: notice.localized_summary, url: notice.url, source: "site-api",
      status: "awaiting-personal", temporalPhase: "in-progress", deliveryState: "pending",
      firstSeenAt: "2026-08-31T02:38:18.000Z", windowStartAt: null, deadlineAt: null,
      baselineGenerations: { "demo-primary": 3, "demo-backup": 2 },
      accountDelivery: { "demo-primary": "pending", "demo-backup": "pending" },
    },
    localResetEpisodes: [{ id: "synthetic-receipt", cause: "global-manual", observedAt: new Date(receiptAt).toISOString(),
      accountGenerations: { "demo-primary": 3 }, observedAtByAccount: { "demo-primary": new Date(receiptAt).toISOString() },
      publicEventId: null }],
  };
  return { now, state, forecast, feed, notice, completion, noticeID, completionID, previousID, receiptAt };
}

module.exports = { resetDeliveryFixture };
