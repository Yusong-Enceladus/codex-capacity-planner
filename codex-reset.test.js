const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const {
  advanceGlobalSettlement,
  apiEquivalentCost,
  appendCapacitySample,
  appendUsageSample,
  behaviorNotificationPlan,
  behaviorZone,
  communityCapacityPrior,
  classifyCapacityCohort,
  createRuntime,
  consolidatedResetTemporalPhase,
  eventSettledByState,
  eventTemporalPhase,
  globalSettlementFromState,
  inferDeadline,
  inferredDeadlineLabel,
  latestExplicitFeedEvent,
  normalizedTargetTrajectory,
  normalizedCapacityEstimate,
  normalizedResetCreditInventory,
  notificationCopy,
  notificationPlan,
  parseAtomEntries,
  parseXProfile,
  personalLandingEvidence,
  projectTargetTrajectory,
  reconcileActiveEpisodeState,
  renewalObservationFromHistory,
  resetCause,
  resetEventEffects,
  seedShortLoadPrediction,
  sessionCandidatesFromRows,
  sessionCycleStart,
  settleShortLoadPredictions,
  shouldNotifyStartupEvent,
  shortLoadShadowMetrics,
  trustedExplicitEvent,
  updateTargetTrajectory,
  usagePaceFromSamples,
} = require("./codex-reset-monitor.js");
const { forecastUsageBehavior } = require("./codex-reset-behavior.js");

const source = fs.readFileSync(`${__dirname}/codex-reset.js`, "utf8");
let provider = null;
const context = vm.createContext({
  defineProvider(value) {
    provider = value;
  },
});
vm.runInContext(source, context, { filename: "codex-reset.js" });

const compute = vm.runInContext("codexResetComputeDecision", context);
const build = vm.runInContext("codexResetBuildModel", context);
const parseUsage = vm.runInContext("codexResetPickWeeklyUsage", context);
const parseUsages = vm.runInContext("codexResetWeeklyUsages", context);
const pickSignal = vm.runInContext("codexResetPickSignal", context);
const bankedPlanFor = vm.runInContext("codexResetBankedPlan", context);
const suggestionLimit = vm.runInContext("codexResetSuggestionLimit", context);
const workspaceSuggestions = vm.runInContext("codexResetWorkspaceSuggestions", context);
const compactAccountLabel = vm.runInContext("codexResetCompactAccountLabel", context);

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const day = 24 * hour;
const now = Date.parse("2026-08-12T09:00:00Z");
let checks = 0;

function check(condition, message) {
  assert.ok(condition, message);
  checks += 1;
}

function equal(actual, expected, message) {
  assert.equal(actual, expected, message);
  checks += 1;
}

function close(actual, expected, tolerance = 0.001) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${actual} was not close to ${expected}`);
  checks += 1;
}

function decision(overrides = {}) {
  return compute({
    nowMs: now,
    usedPercent: 10,
    resetsAtMs: now + 6 * day,
    windowMinutes: 7 * 24 * 60,
    p24: 30,
    p48: 50,
    commitmentFloor: 0,
    signal: { level: "none", deadlineMs: null },
    forecastUsable: true,
    plannedRemainingNow: 90,
    ...overrides,
  });
}

equal(
  compactAccountLabel("encela…ng@example.test"),
  "encela•••ng@example.test",
  "a legacy account abbreviation must become an explicit privacy mask instead of an ellipsis",
);

// Planned Q=90, T=144h, d=24h: normal N=15, otherwise wasted W=75.
const noForecast = decision({ p24: 0, p48: 0 });
close(noForecast.normalUse, 15);
close(noForecast.predictionUse, 0);
close(noForecast.additionalTotal, 15);
close(noForecast.targetNowUsed, 10);

const ordinary = decision();
close(ordinary.predictionUse, 22.5);
close(ordinary.additionalTotal, 37.5);
close(ordinary.targetRemaining, 52.5);
close(ordinary.downsideHours, 36);
close(ordinary.requiredAverageRate, 37.5 / 24);
close(ordinary.recommendedRate, 37.5 / 24);
const higherProbability = decision({ p24: 60, p48: 70 });
close(higherProbability.targetNowUsed, ordinary.targetNowUsed);
check(
  higherProbability.targetUsed > ordinary.targetUsed,
  "a higher forecast may raise the future red marker without moving the current target",
);

const candidate = decision({ signal: { level: "hint", deadlineMs: null } });
equal(candidate.mode, "hint");
close(candidate.probability, ordinary.probability, 0.0001);
close(candidate.predictionUse, ordinary.predictionUse, 0.0001);
close(candidate.candidateReservePercent, 10);
close(candidate.candidateUse, 5.25);
close(candidate.effectiveRiskPercent, 37);
check(
  candidate.targetUsed > ordinary.targetUsed,
  "a real candidate must schedule more quota without rewriting forecast probability",
);
check(candidate.targetUsed < 100, "a candidate alone must not force a 100% target");

const candidateWithoutForecast = decision({
  p24: 0,
  p48: 0,
  forecastUsable: false,
  signal: { level: "hint", deadlineMs: null },
});
close(candidateWithoutForecast.probability, 0);
close(candidateWithoutForecast.candidateUse, 7.5);
check(
  candidateWithoutForecast.targetUsed > noForecast.targetUsed,
  "candidate planning pressure must remain useful without a numeric forecast",
);

const afterUsage = decision({ usedPercent: 60 });
close(
  afterUsage.targetUsed,
  ordinary.targetUsed,
  0.0001,
);
close(afterUsage.additionalTotal, 0);
close(afterUsage.targetExceededBy, 12.5);
equal(
  afterUsage.targetReached,
  true,
  "actual usage must be able to cross a red target without moving it",
);

const certain = decision({ p24: 100, p48: 100 });
close(certain.predictionUse, 75);
close(certain.additionalTotal, 90);
close(certain.targetRemaining, 0);

const explicit = decision({
  signal: { level: "explicit", deadlineMs: now + day },
});
equal(explicit.mode, "explicit");
close(explicit.probability, 100);
close(explicit.additionalTotal, 90);

const explicitNow = decision({ signal: { level: "explicit", deadlineMs: null } });
equal(explicitNow.mode, "explicit-now");
equal(explicitNow.immediate, true);
close(explicitNow.normalUse, 0);
close(explicitNow.predictionUse, 90);

const automatic = decision({ resetsAtMs: now + 12 * hour });
equal(automatic.mode, "automatic");
close(automatic.normalUse, 90);
close(automatic.predictionUse, 0);

const converged = decision({
  resetsAtMs: now + day,
  signal: { level: "explicit", deadlineMs: now + 2 * day },
});
equal(converged.mode, "explicit-after-natural");
equal(converged.waitsForNaturalReset, true);
close(converged.normalUse, 90);
close(converged.predictionUse, 0);

const commitment = decision({
  signal: { level: "commitment", deadlineMs: now + 2 * day },
  commitmentFloor: 70,
});
equal(commitment.mode, "commitment");
close(commitment.probability, 70);
close(commitment.normalUse, 30);
close(commitment.predictionUse, 42);

const continuousDeadline = decision({
  signal: { level: "commitment", deadlineMs: now + 36 * hour },
  commitmentFloor: 0,
});
close(continuousDeadline.probability, (1 - Math.sqrt(0.7 * 0.5)) * 100);

const renewalBoundary = decision({
  renewalResetAtMs: now + 12 * hour,
});
equal(renewalBoundary.mode, "renewal");
equal(renewalBoundary.naturalResetSource, "renewal");
close(renewalBoundary.additionalTotal, 90);

function trajectoryModel(overrides = {}) {
  const policy = overrides.policy || {};
  const signalLevel =
    overrides.signalLevel ||
    (["deadline", "immediate"].includes(policy.kind) ? "explicit" : "none");
  return {
    usage: {
      usedPercent: overrides.usedPercent === undefined ? 10 : overrides.usedPercent,
      updatedAtMs: now,
      resetsAtMs: now + 6 * day,
      windowMinutes: 7 * 24 * 60,
    },
    forecast: { signal: { id: overrides.signalId || null, level: signalLevel } },
    planningDecision: {
      naturalResetAtMs: now + 6 * day,
      trajectoryPolicyKind: policy.kind || "hazard",
      trajectoryHazardPerHour:
        policy.hazardPerHour === undefined ? -Math.log(0.7) / 24 : policy.hazardPerHour,
      trajectoryDeadlineMs: policy.deadlineAtMs || null,
      mode: policy.source || "forecast",
    },
  };
}

const trajectory = updateTargetTrajectory(null, trajectoryModel(), now);
check(normalizedTargetTrajectory(trajectory), "a valid continuous trajectory must persist");
close(trajectory.anchorRemainingPercent, 600 / 7 / 1);
const trajectoryFromDifferentActual = updateTargetTrajectory(
  null,
  trajectoryModel({ usedPercent: 60 }),
  now,
);
close(
  trajectoryFromDifferentActual.anchorRemainingPercent,
  trajectory.anchorRemainingPercent,
  0.0001,
);

const projectedDay = projectTargetTrajectory(trajectory, now + day);
close(projectedDay, trajectory.anchorRemainingPercent * (5 / 6) * 0.7);
const justBeforeDay = projectTargetTrajectory(trajectory, now + day - 1);
const justAfterDay = projectTargetTrajectory(trajectory, now + day + 1);
check(
  Math.abs(justBeforeDay - justAfterDay) < 0.001,
  "the trajectory must remain continuous through the old 24-hour boundary",
);

const policyChangeAt = now + hour;
const beforePolicyChange = projectTargetTrajectory(trajectory, policyChangeAt);
const fasterTrajectory = updateTargetTrajectory(
  trajectory,
  trajectoryModel({ policy: { kind: "hazard", hazardPerHour: -Math.log(0.5) / 24 } }),
  policyChangeAt,
);
close(
  fasterTrajectory.anchorRemainingPercent,
  beforePolicyChange,
  0.0001,
);
const explicitDeadline = now + 6 * hour;
const explicitTrajectory = updateTargetTrajectory(
  fasterTrajectory,
  trajectoryModel({
    signalId: "2888888888888888899",
    policy: { kind: "deadline", deadlineAtMs: explicitDeadline, source: "explicit" },
  }),
  policyChangeAt,
);
close(projectTargetTrajectory(explicitTrajectory, explicitDeadline), 0);

const immediateTrajectory = updateTargetTrajectory(
  trajectory,
  trajectoryModel({
    signalId: "2888888888888888800",
    policy: { kind: "immediate", hazardPerHour: 0, source: "explicit-now" },
  }),
  policyChangeAt,
);
close(immediateTrajectory.anchorRemainingPercent, 0);
const correctedAt = policyChangeAt + hour;
const correctedTrajectory = updateTargetTrajectory(
  immediateTrajectory,
  trajectoryModel({ policy: { kind: "hazard", source: "forecast" } }),
  correctedAt,
);
close(
  correctedTrajectory.anchorRemainingPercent,
  ((now + 6 * day - correctedAt) / (7 * day)) * 100,
  0.0001,
);

const poisonedContinuousTrajectory = {
  ...trajectory,
  anchorRemainingPercent: 0,
  policyKind: "hazard",
  policySource: "forecast",
  signalId: "retrospective-reply",
};
const healedContinuousTrajectory = updateTargetTrajectory(
  poisonedContinuousTrajectory,
  trajectoryModel({ policy: { kind: "hazard", source: "forecast" } }),
  policyChangeAt,
);
close(
  healedContinuousTrajectory.anchorRemainingPercent,
  ((now + 6 * day - policyChangeAt) / (7 * day)) * 100,
  0.0001,
);
check(
  healedContinuousTrajectory.anchorRemainingPercent > 0,
  "a downgraded zero-anchor hazard must self-heal instead of preserving a 100% target",
);

const hintTrajectory = updateTargetTrajectory(
  null,
  trajectoryModel({
    signalId: "candidate-a",
    signalLevel: "hint",
    policy: { kind: "hazard", source: "hint" },
  }),
  now,
);
equal(hintTrajectory.signalId, null, "candidate post IDs must not become durable policy identity");
const changedHintTrajectory = updateTargetTrajectory(
  hintTrajectory,
  trajectoryModel({
    signalId: "candidate-b",
    signalLevel: "hint",
    policy: { kind: "hazard", source: "hint" },
  }),
  now,
);
assert.deepEqual(changedHintTrajectory, hintTrajectory);
checks += 1;

const screenshotNow = Date.parse("2026-08-27T08:08:14Z");
const screenshotResetAt = Date.parse("2026-09-01T14:20:28Z");
const screenshotCycleStartedAt = screenshotResetAt - 7 * day;
const screenshotDraftDecision = compute({
  nowMs: screenshotNow,
  usedPercent: 9,
  resetsAtMs: screenshotResetAt,
  windowMinutes: 7 * 24 * 60,
  p24: 23.680659343848395,
  p48: 41.75,
  commitmentFloor: 0,
  signal: { level: "hint", deadlineMs: null },
  forecastUsable: true,
  plannedRemainingNow: 0,
});
const screenshotPoisonedTrajectory = {
  version: 1,
  anchorAt: "2026-08-26T05:58:03.497Z",
  anchorRemainingPercent: 0,
  naturalResetAt: new Date(screenshotResetAt).toISOString(),
  cycleStartedAt: new Date(screenshotCycleStartedAt).toISOString(),
  cycleResetAt: new Date(screenshotResetAt).toISOString(),
  policyKind: "hazard",
  policyHazardPerHour: 0.011260158253614426,
  policyDeadlineAt: null,
  policySource: "forecast",
  signalId: "2092316228497063958",
};
const screenshotHealedTrajectory = updateTargetTrajectory(
  screenshotPoisonedTrajectory,
  {
    usage: {
      usedPercent: 9,
      resetsAtMs: screenshotResetAt,
      windowMinutes: 7 * 24 * 60,
    },
    planningDecision: screenshotDraftDecision,
    forecast: { signal: { level: "hint", id: "2092862554632826968" } },
  },
  screenshotNow,
);
const screenshotFixedDecision = compute({
  nowMs: screenshotNow,
  usedPercent: 9,
  resetsAtMs: screenshotResetAt,
  windowMinutes: 7 * 24 * 60,
  p24: 23.680659343848395,
  p48: 41.75,
  commitmentFloor: 0,
  signal: { level: "hint", deadlineMs: null },
  forecastUsable: true,
  plannedRemainingNow: screenshotHealedTrajectory.anchorRemainingPercent,
});
check(
  screenshotFixedDecision.targetUsed > 58 && screenshotFixedDecision.targetUsed < 59,
  "the observed 9%-used poisoned plan must heal to a bounded candidate target, not 100%",
);

const usagePayload = [
  {
    provider: "codex",
    usage: {
      updatedAt: "2026-08-12T08:59:00Z",
      dataConfidence: "exact",
      secondary: {
        usedPercent: 10,
        windowMinutes: 10080,
        resetsAt: "2026-08-18T09:00:00Z",
      },
      extraRateWindows: [
        { id: "codex-spark-weekly", window: { usedPercent: 99, windowMinutes: 10080 } },
      ],
    },
  },
];
const parsed = parseUsage(usagePayload, now);
equal(parsed.usedPercent, 10, "Spark-specific windows must not replace the weekly window");
equal(parsed.accountCount, 1);
equal(parsed.fresh, true);
assert.deepEqual(Array.from(parsed.activeLanes), ["weekly"]);
checks += 1;
equal(parsed.shortWindow, null, "an absent 5-hour window must be a supported weekly-only state");

const usageWithShortWindow = [
  {
    ...usagePayload[0],
    usage: {
      ...usagePayload[0].usage,
      primary: {
        usedPercent: 40,
        windowMinutes: 300,
        resetsAt: "2026-08-12T12:00:00Z",
      },
    },
  },
];
equal(parseUsage(usageWithShortWindow, now).shortWindow.usedPercent, 40);
assert.deepEqual(Array.from(parseUsage(usageWithShortWindow, now).activeLanes), ["weekly", "short"]);
checks += 1;

function forecastFixture(updatedAt = "2026-08-12T08:58:00Z") {
  return {
    probabilities: {
      rounded_24h: 30,
      rounded_48h: 50,
      commitment_floor_percent: null,
    },
    model: { version: "rate-v3", base_daily_rate: 0.301 },
    confidence: "medium",
    mode: "model",
    updated_at: updatedAt,
    last_reset_at: "2026-08-11T00:27:44Z",
    time_window: { start_hour: 7, end_hour: 10, timezone: "Asia/Singapore" },
    official_signal: null,
  };
}

const tiboEvent = {
  id: "2087706104814023111",
  type: "reset",
  group: "reset",
  summary:
    "Old news actually from a bunch of days ago, but crossed that 15M. Enjoy a nice reset everyone. Landing in the next hour or so, go /fast.",
  localized_summary: "已经跨过 1500 万。大家享受一次重置吧。大约一小时后着陆。",
  url: "https://x.com/thsottiaux/status/2087706104814023111",
  announced_at: "2026-08-13T01:01:37.000Z",
  official_window: {
    label: "within an hour",
    start_at: "2026-08-13T01:01:37.000Z",
    end_at: "2026-08-13T02:01:37.000Z",
  },
  announcement_state: "announced",
  reset_verification_status: "pending",
  source: "live",
};

const signalAtEvent = pickSignal(
  { ...forecastFixture(), last_reset_at: tiboEvent.announced_at },
  { events: [tiboEvent], signal: { ...tiboEvent, tweet_id: tiboEvent.id, active: true } },
  null,
  Date.parse("2026-08-13T01:10:00Z"),
);
equal(signalAtEvent.level, "explicit", "announced feed events must override kind=candidate");
equal(signalAtEvent.id, tiboEvent.id);
equal(signalAtEvent.deadlineMs, Date.parse("2026-08-13T02:01:37.000Z"));
equal(signalAtEvent.summary, tiboEvent.summary, "confirmation strength must retain the full signal text");
equal(signalAtEvent.localizedSummary, tiboEvent.localized_summary);
equal(eventTemporalPhase(tiboEvent), "future", "a structured future window must remain future-facing");

const completedConfirmationID = "2093014447833116908";
const completedConfirmation = {
  id: completedConfirmationID,
  type: "reset",
  group: "reset",
  summary:
    "Never slept better and feeling reseted. Brand new me and brand new usage for all ChatGPT Work and Codex users. Regaining my youth one button press at a time.",
  localized_summary: "感觉焕然一新，所有用户都有了全新额度。",
  url: `https://x.com/thsottiaux/status/${completedConfirmationID}`,
  announced_at: "2026-08-27T16:35:05.000Z",
  announcement_state: "announced",
  reset_verification_status: "pending",
};
const conflictingCompletedFeed = {
  signal: {
    ...completedConfirmation,
    tweet_id: completedConfirmationID,
    kind: "candidate",
    active: true,
  },
  events: [completedConfirmation],
  tweets: [
    {
      ...completedConfirmation,
      text: completedConfirmation.summary,
      conversation_id: completedConfirmationID,
      tibo_lane: "reset_announcement",
      explicit_reset_claim: true,
      reset_verification_status: "expired",
    },
  ],
};
const completedConfirmationForecast = {
  ...forecastFixture("2026-08-28T03:43:04.403Z"),
  last_reset_at: completedConfirmation.announced_at,
  evidence: [
    {
      code: "last_reset",
      href: completedConfirmation.url,
    },
  ],
};
equal(eventTemporalPhase(completedConfirmation), "completed");
equal(
  consolidatedResetTemporalPhase(
    conflictingCompletedFeed,
    completedConfirmation,
    completedConfirmationForecast,
  ),
  "completed",
  "completion evidence must win over a stale pending representation of the same public event",
);
equal(
  latestExplicitFeedEvent(conflictingCompletedFeed, completedConfirmationForecast).temporalPhase,
  "completed",
);
equal(
  pickSignal(
    completedConfirmationForecast,
    conflictingCompletedFeed,
    null,
    Date.parse("2026-08-28T03:50:00.000Z"),
  ).level,
  "none",
  "a negative terminal representation of the same ID must not become a fresh planning signal",
);

const receiverLanded = {
  currentEvent: {
    ...tiboEvent,
    status: "personal-landed",
    personalLandedAt: "2026-08-13T01:12:00Z",
  },
};
const afterLanded = pickSignal(
  forecastFixture(),
  { events: [tiboEvent], signal: { ...tiboEvent, tweet_id: tiboEvent.id, active: true } },
  receiverLanded,
  Date.parse("2026-08-13T01:15:00Z"),
);
equal(afterLanded.level, "none", "a locally observed arrival must close the matching global event");

const partialDeliveryReceiver = {
  activeAccountId: "account-a",
  activeEpisode: {
    ...tiboEvent,
    id: tiboEvent.id,
    announced_at: tiboEvent.announced_at,
    source: "site-api",
    status: "awaiting-personal",
    account_delivery: { "account-a": "landed", "account-b": "pending" },
  },
};
equal(
  pickSignal(
    forecastFixture(),
    { events: [tiboEvent], signal: { ...tiboEvent, tweet_id: tiboEvent.id, active: true } },
    partialDeliveryReceiver,
    Date.parse("2026-08-13T01:15:00Z"),
  ).level,
  "none",
  "an account that already landed must return to its normal cycle even while a peer is pending",
);
equal(
  pickSignal(
    forecastFixture(),
    { events: [tiboEvent], signal: { ...tiboEvent, tweet_id: tiboEvent.id, active: true } },
    { ...partialDeliveryReceiver, activeAccountId: "account-b" },
    Date.parse("2026-08-13T01:15:00Z"),
  ).level,
  "explicit",
  "the same public episode must remain active for an account that has not landed",
);

const landedAt = "2026-08-13T03:33:00.622Z";
const previousHint = {
  id: "hint-before-confirmation",
  type: "reset",
  group: "reset",
  kind: "candidate",
  announcement_state: "none",
  summary: "Little surprise for you tomorrow.",
  announced_at: "2026-08-12T06:20:37.000Z",
};
const differentIDLanding = {
  lastPersonalReset: {
    at: landedAt,
    cause: "global-manual",
    evidence: "usage-decreased",
    eventId: tiboEvent.id,
  },
};
equal(
  pickSignal(
    forecastFixture(),
    { events: [previousHint] },
    differentIDLanding,
    Date.parse("2026-08-13T04:00:00Z"),
  ).level,
  "none",
  "a global landing must settle earlier hints even when the confirmation has another ID",
);
equal(
  pickSignal(
    { ...forecastFixture(), last_reset_at: tiboEvent.announced_at },
    { events: [previousHint] },
    null,
    Date.parse("2026-08-13T04:00:00Z"),
  ).level,
  "none",
  "the public reset boundary must close older hints on a fresh local install",
);

const futureWindowHint = {
  ...previousHint,
  id: "future-window-hint",
  announced_at: "2026-08-13T02:00:00Z",
  official_window: {
    start_at: "2026-08-13T04:30:00Z",
    end_at: "2026-08-13T06:00:00Z",
  },
};
equal(
  pickSignal(
    forecastFixture(),
    { events: [futureWindowHint] },
    differentIDLanding,
    Date.parse("2026-08-13T04:00:00Z"),
  ).id,
  futureWindowHint.id,
  "a structured future window must survive an earlier personal landing",
);

const hintAfterLanding = {
  ...previousHint,
  id: "hint-after-landing",
  announced_at: "2026-08-13T03:45:00Z",
};
equal(
  pickSignal(
    forecastFixture(),
    { events: [previousHint, hintAfterLanding] },
    differentIDLanding,
    Date.parse("2026-08-13T04:00:00Z"),
  ).id,
  hintAfterLanding.id,
  "a genuinely newer hint must remain visible",
);

equal(
  pickSignal(
    forecastFixture(),
    { events: [previousHint] },
    { lastPersonalReset: { at: landedAt, cause: "automatic", eventId: null } },
    Date.parse("2026-08-13T04:00:00Z"),
  ).id,
  previousHint.id,
  "an automatic reset must not create a global signal settlement boundary",
);

const commitmentSignal = pickSignal(
  {
    ...forecastFixture(),
    official_signal: {
      tweet_id: "promise-1",
      at: "2026-08-12T06:20:37Z",
      kind: "candidate",
      signal_type: "dated_commitment",
      commitment_floor_percent: 65,
      summary: "Little surprise for you tomorrow.",
      window: { end_at: "2026-08-13T06:59:59Z" },
    },
  },
  null,
  null,
  now,
);
equal(commitmentSignal.level, "commitment");
equal(commitmentSignal.commitmentFloor, 65);

// Synthetic Alert-v3 regression: promise B is published between the two
// accounts' deliveries of reset A. No live requests or real account data.
const watchResetID = "2998000000000000001";
const watchPromiseID = "2998000000000000002";
const watchPublishedAt = new Date(now - 37 * minute).toISOString();
const watchSettledAt = new Date(now - 36 * minute).toISOString();
const watchDeadline = new Date(now + 26 * hour).toISOString();
const watchForecast = {
  ...forecastFixture(),
  updated_at: new Date(now - minute).toISOString(),
  last_reset_at: new Date(now - 77 * minute).toISOString(),
  probabilities: { raw_24h: 0.25, raw_48h: 0.44, rounded_24h: 25, rounded_48h: 45,
    commitment_floor_percent: 93, signal_percent: 93 },
  signal_tier: "likely",
  alert_event_id: `signal:${watchPromiseID}:likely`,
  signal_score: { band: "dated_commitment", value: 93 },
  official_signal: {
    tweet_id: watchPromiseID,
    kind: "signal",
    signal_type: "dated_commitment",
    signal_tier: "likely",
    alert_event_id: `signal:${watchPromiseID}:likely`,
    at: watchPublishedAt,
    summary: "Synthetic: the next celebration is postponed; today's reset is separate.",
    url: `https://x.com/thsottiaux/status/${watchPromiseID}`,
    score: { band: "dated_commitment", value: 93 },
    window: { start_at: watchPublishedAt, end_at: watchDeadline,
      target_at: watchDeadline, target_kind: "deadline", time_zone: "America/Los_Angeles",
      label: "stated deadline" },
  },
};
const watchUsage = ["watch-a", "watch-b"].map((id, index) => ({
  provider: "codex", cacheAccountKey: id, account: `${id}@example.test`, accountLive: index === 0,
  usage: { updatedAt: new Date(now).toISOString(), dataConfidence: "exact",
    identity: { loginMethod: "pro" },
    secondary: { usedPercent: 8, windowMinutes: 10080, resetsAt: new Date(now + 6 * day).toISOString() } },
}));
const watchReceiver = {
  activeAccountId: "watch-a",
  signalSettlement: { throughAt: watchSettledAt, eventId: watchResetID },
  closedEventIds: [watchResetID],
  accounts: watchUsage.map((usage, index) => ({
    id: usage.cacheAccountKey, label: usage.account, live: index === 0,
    lastPersonalReset: { at: new Date(now - (index ? 36 : 38) * minute).toISOString(),
      cause: "global-manual", eventId: watchResetID },
    personalResets: [{ at: watchSettledAt, cause: "global-manual", eventId: watchResetID }],
    resetCredits: { reliable: true, updatedAt: new Date(now).toISOString(), credits: [
      { id: `credit-${index}`, status: "available", resetType: "full",
        grantedAt: new Date(now - day).toISOString(), expiresAt: new Date(now + 14 * day).toISOString() },
    ] },
  })),
};
const watchSignal = pickSignal(watchForecast, { events: [] }, watchReceiver, now);
equal(watchSignal.id, watchPromiseID, "settling A must not consume B published just before A's last delivery");
equal(watchSignal.level, "commitment");
equal(watchSignal.signalScore, 93);
equal(watchSignal.signalTier, "likely");
equal(watchSignal.alertEventId, `signal:${watchPromiseID}:likely`);
equal(watchSignal.commitmentFloor, 93);
equal(watchSignal.windowStartMs, null, "a deadline's publication/start is not an earliest delivery time");
equal(watchSignal.sourceWindowStartMs, Date.parse(watchPublishedAt));
equal(watchSignal.deadlineMs, Date.parse(watchDeadline));
equal(watchSignal.timingKind, "deadline");
const watchModel = build(watchUsage, watchForecast, null, now, watchReceiver);
equal(watchModel.forecast.p24, 25);
equal(watchModel.forecast.p48, 44);
equal(watchModel.forecast.displayP48, 45);
equal(watchModel.decision.mode, "commitment");
equal(watchModel.decision.horizonHours, 26);
close(watchModel.decision.targetUsed, 100 - (118 / 168 * 100) * 0.07);
check(watchModel.accounts.every((account) => account.forecast.signal.id === watchPromiseID));
check(watchModel.accounts.every((account) => account.decision.probability === 93));
equal(watchModel.actions.creditAction, "hold");
check(watchModel.bankedPlan.possibleResetFirst, "credits outliving a dated promise must wait through its window");
equal(suggestionLimit(watchModel.decision, { endpointLower: 20, endpointUpper: 45 }), 5);

const watchRaw = { ...tiboEvent, id: watchPromiseID, announced_at: watchPublishedAt,
  url: watchForecast.official_signal.url, official_window: null };
equal(pickSignal(watchForecast, { events: [watchRaw] }, watchReceiver, now).level, "commitment",
  "a raw reset-group entry cannot upgrade the current structured Watch to immediate 100%");
equal(latestExplicitFeedEvent({ events: [watchRaw] }, watchForecast), null);
equal(pickSignal(watchForecast, { tweets: [{ ...watchRaw, reset_verification_status: "expired" }] },
  watchReceiver, now).id, watchPromiseID, "raw corpus expiry must not overwrite the current hosted interpretation");
equal(pickSignal(watchForecast, { events: [{ ...watchRaw, reset_verification_status: "rejected" }] },
  watchReceiver, now).level, "none", "an explicit same-ID rejection must still win");
equal(pickSignal({ ...watchForecast, official_signal: { ...watchForecast.official_signal,
  alert_event_id: `signal:${watchResetID}:likely` } }, null, watchReceiver, now).level, "none");
equal(pickSignal({ ...watchForecast, last_reset_at: watchSettledAt }, null, watchReceiver, now).id,
  watchPromiseID, "a public last-reset timestamp cannot consume a different future promise either");
equal(pickSignal(watchForecast, null, { ...watchReceiver, closedEventIds: [watchResetID, watchPromiseID] }, now).level,
  "none", "identity-matched closed history must never reopen");
equal(pickSignal(watchForecast, null, watchReceiver, Date.parse(watchDeadline) + 1).level, "none",
  "an expired promise must not mint another 24-hour deadline");

const partialWatchReceiver = {
  ...watchReceiver, closedEventIds: [], signalSettlement: null,
  accounts: watchReceiver.accounts.map((account, index) => index ? {
    ...account, lastPersonalReset: null, personalResets: [],
  } : account),
  activeEpisode: { ...tiboEvent, id: watchResetID, announced_at: new Date(now - hour).toISOString(),
    url: `https://x.com/thsottiaux/status/${watchResetID}`, source: "site-api",
    official_window: null, status: "awaiting-personal",
    account_delivery: { "watch-a": "landed", "watch-b": "pending" } },
};
const partialWatchModel = build(watchUsage, watchForecast, null, now, partialWatchReceiver);
equal(partialWatchModel.accounts[0].forecast.signal.id, watchPromiseID);
equal(partialWatchModel.accounts[1].forecast.signal.id, watchResetID);
equal(partialWatchModel.accounts[1].decision.immediate, true,
  "account A's receipt must not settle account B's still-pending delivery");

const untimedForecast = { ...watchForecast, probabilities: { ...watchForecast.probabilities,
  commitment_floor_percent: 83 }, official_signal: { ...watchForecast.official_signal,
  signal_type: "plain_promise", score: { band: "plain_promise", value: 83 }, window: null } };
const untimedModel = build(watchUsage, untimedForecast, null, now, watchReceiver);
equal(untimedModel.forecast.signal.level, "commitment");
equal(untimedModel.forecast.signal.deadlineMs, null);
equal(untimedModel.decision.mode, "commitment-untimed");
equal(untimedModel.decision.probability, 25, "83 is not an unstated 24-hour probability");
check(untimedModel.decision.candidateUse > 0 && untimedModel.decision.targetUsed < 100);
const elevatedForecast = { ...untimedForecast, official_signal: { ...untimedForecast.official_signal,
  signal_tier: "elevated", alert_event_id: `signal:${watchPromiseID}:elevated` } };
equal(pickSignal(elevatedForecast, null, watchReceiver, now).level, "hint",
  "an elevated score cannot silently become a strong Watch");
const centeredForecast = { ...watchForecast, official_signal: { ...watchForecast.official_signal,
  window: { ...watchForecast.official_signal.window, target_kind: "center",
    target_at: new Date(now + 25 * hour).toISOString() } } };
equal(pickSignal(centeredForecast, null, watchReceiver, now).deadlineMs, now + 25 * hour,
  "structured target_at wins without parsing the label");

const retrospectiveReply = {
  id: "2092316228497063958",
  type: "reset",
  group: "reset",
  announcement_state: "none",
  reset_verification_status: "pending",
  summary: "@s_batzoglou Not so random, but yes",
  announced_at: "2026-08-25T18:20:36.000Z",
};
equal(
  pickSignal(
    forecastFixture("2026-08-27T06:30:00Z"),
    { events: [retrospectiveReply] },
    null,
    Date.parse("2026-08-27T07:00:00Z"),
  ).level,
  "none",
  "an incomplete reset object must fail closed instead of defaulting to a hint",
);

const rawTopLevelCandidate = {
  id: "2092862554632826968",
  at: "2026-08-27T06:31:31.000Z",
  kind: "other",
  tibo_lane: "reset_related",
  explicit_reset_claim: false,
  conversation_id: "2092862554632826968",
  in_reply_to_status_id: null,
  in_reply_to_user_id: null,
  text: "Intrigued to see if I can find the reset button tomorrow and dust it up",
  localized_text: "反向翻译不应进入兼容候选",
  url: "https://x.com/thsottiaux/status/2092862554632826968",
};
const rawRetrospectiveReply = {
  ...rawTopLevelCandidate,
  id: "2092316228497063958",
  at: "2026-08-25T18:20:36.000Z",
  kind: "candidate",
  conversation_id: "2092256496063033418",
  text: "@s_batzoglou Not so random, but yes",
  url: "https://x.com/thsottiaux/status/2092316228497063958",
};
const corpusCandidate = pickSignal(
  forecastFixture("2026-08-27T06:30:00Z"),
  { tweets: [rawTopLevelCandidate, rawRetrospectiveReply] },
  null,
  Date.parse("2026-08-27T07:00:00Z"),
);
equal(corpusCandidate.level, "hint");
equal(corpusCandidate.id, rawTopLevelCandidate.id);
equal(corpusCandidate.localizedSummary, "", "an unverified reversed translation must be omitted");
equal(
  pickSignal(
    forecastFixture("2026-08-27T06:30:00Z"),
    { tweets: [rawRetrospectiveReply] },
    null,
    Date.parse("2026-08-27T07:00:00Z"),
  ).level,
  "none",
  "a raw reply must still fail closed when no structured contextual interpretation exists",
);

const structuredTeaseForecast = {
  ...forecastFixture("2026-08-29T08:20:00Z"),
  probabilities: {
    rounded_24h: 25,
    rounded_48h: 45,
    commitment_floor_percent: null,
    signal_percent: 50,
  },
  last_reset_at: "2026-08-27T16:35:05Z",
  teased_window: {
    tweet_id: "2093551005711679001",
    summary: "Synthetic contextual reset hint, soon but not today",
    url: "https://x.com/thsottiaux/status/2093551005711679001",
    at: "2026-08-29T04:07:10.000Z",
    window: {
      label: "end of Saturday",
      start_at: "2026-08-29T07:00:00.000Z",
      end_at: "2026-08-30T06:59:59.999Z",
      time_zone: "America/Los_Angeles",
    },
    score: {
      band: "tease",
      value: 50,
      modifiers: [{ code: "reply", value: -5 }, { code: "corroborated", value: 5 }],
    },
  },
};
const structuredTease = pickSignal(
  structuredTeaseForecast,
  null,
  null,
  Date.parse("2026-08-29T08:30:00Z"),
);
equal(structuredTease.level, "hint");
equal(structuredTease.id, structuredTeaseForecast.teased_window.tweet_id);
equal(structuredTease.windowProvenance, "inferred");
equal(structuredTease.signalScore, 50, "tease score should remain evidence strength");
equal(structuredTease.signalBand, "tease");
equal(structuredTease.windowStartMs, Date.parse("2026-08-29T07:00:00.000Z"));
equal(structuredTease.windowEndMs, Date.parse("2026-08-30T06:59:59.999Z"));
const structuredTeaseDecision = decision({
  p24: 25,
  p48: 45,
  signal: structuredTease,
});
const sameProbabilityDecision = decision({ p24: 25, p48: 45 });
close(structuredTeaseDecision.probability, sameProbabilityDecision.probability);
check(
  structuredTeaseDecision.targetUsed > sameProbabilityDecision.targetUsed,
  "a structured tease must add bounded plan pressure without rewriting probability",
);
check(structuredTeaseDecision.targetUsed < 100);
equal(
  pickSignal(
    structuredTeaseForecast,
    null,
    null,
    Date.parse("2026-08-30T07:00:00Z"),
  ).level,
  "none",
  "an inferred tease must expire at the end of its structured observation window",
);
const explicitAfterTease = {
  ...tiboEvent,
  id: "2093551005711679002",
  announced_at: "2026-08-29T08:10:00.000Z",
  url: "https://x.com/thsottiaux/status/2093551005711679002",
  official_window: {
    label: "within an hour",
    start_at: "2026-08-29T08:10:00.000Z",
    end_at: "2026-08-29T09:10:00.000Z",
  },
};
equal(
  pickSignal(
    structuredTeaseForecast,
    { events: [explicitAfterTease] },
    null,
    Date.parse("2026-08-29T08:30:00Z"),
  ).id,
  explicitAfterTease.id,
  "a later explicit announcement must take precedence over the structured tease",
);

const model = build(usagePayload, forecastFixture(), null, now, null);
check(model.decision, "fresh exact inputs should produce a decision");
equal(model.decision.mode, "forecast");
equal(model.devicePlan.shouldSwitch, false, "a single account must not create account scheduling");
const renewalBeforeCooldownUsage = [
  {
    ...usagePayload[0],
    usage: {
      ...usagePayload[0].usage,
      subscriptionRenewsAt: new Date(now + day).toISOString(),
      secondary: {
        ...usagePayload[0].usage.secondary,
        usedPercent: 100,
        resetsAt: new Date(now + 5 * day).toISOString(),
      },
    },
  },
];
const renewalBeforeCooldown = build(
  renewalBeforeCooldownUsage,
  forecastFixture(),
  null,
  now,
  null,
);
equal(renewalBeforeCooldown.subscriptionAdvice.action, "cancel-before-renewal");
equal(renewalBeforeCooldown.subscriptionAdvice.oldCooldownEndsAtMs, now + 5 * day);
const renewalIgnoredModel = build(usagePayload, forecastFixture(), null, now, {
  renewalObservation: {
    status: "verified",
    nextAt: new Date(now + 12 * hour).toISOString(),
  },
});
equal(
  renewalIgnoredModel.decision.naturalResetSource,
  "automatic",
  "a subscription renewal date must never shorten the observed weekly cooldown",
);

const multiAccountUsage = [
  {
    ...usagePayload[0],
    account: "first@example.test",
    cacheAccountKey: "codex:stored:first",
    accountActive: true,
    accountLive: false,
  },
  {
    ...usagePayload[0],
    account: "second@example.test",
    cacheAccountKey: "codex:stored:second",
    accountActive: false,
    accountLive: true,
    usage: {
      ...usagePayload[0].usage,
      secondary: { ...usagePayload[0].usage.secondary, usedPercent: 35 },
    },
  },
];
equal(parseUsages(multiAccountUsage, now).length, 2);
equal(parseUsage(multiAccountUsage, now).accountId, "codex:stored:second");
const multiAccountModel = build(multiAccountUsage, forecastFixture(), null, now, null);
check(multiAccountModel.decision, "multiple accounts must keep the active account actionable");
equal(multiAccountModel.usage.usedPercent, 35);
equal(multiAccountModel.accounts.length, 2);
equal(multiAccountModel.devicePlan.accountCount, 2);
equal(
  multiAccountModel.devicePlan.shouldSwitch,
  false,
  "unknown cross-account capacities must not be ranked by incomparable percentages",
);
const unknownCapacityScreenshotModel = build(
  [
    {
      ...usagePayload[0],
      account: "current-20x@example.test",
      cacheAccountKey: "codex:stored:current-20x",
      accountActive: true,
      accountLive: true,
      usage: {
        ...usagePayload[0].usage,
        identity: { loginMethod: "pro" },
        secondary: { ...usagePayload[0].usage.secondary, usedPercent: 71 },
      },
    },
    {
      ...usagePayload[0],
      account: "other-5x@example.test",
      cacheAccountKey: "codex:stored:other-5x",
      accountActive: false,
      accountLive: false,
      usage: {
        ...usagePayload[0].usage,
        identity: { loginMethod: "plus" },
        secondary: { ...usagePayload[0].usage.secondary, usedPercent: 69 },
      },
    },
  ],
  forecastFixture(),
  null,
  now,
  null,
);
equal(
  unknownCapacityScreenshotModel.actions.accountAction,
  "stay",
  "a usable 20x account at 71% used must not switch to a 5x account at 69% used without learned capacities",
);
const provenCapacitySwitchModel = build(
  [
    {
      ...usagePayload[0],
      account: "current-20x@example.test",
      cacheAccountKey: "codex:stored:current-20x-proof",
      accountActive: true,
      accountLive: true,
      usage: {
        ...usagePayload[0].usage,
        identity: { loginMethod: "pro" },
        secondary: {
          ...usagePayload[0].usage.secondary,
          usedPercent: 50,
          resetsAt: new Date(now + 5 * day).toISOString(),
        },
      },
    },
    {
      ...usagePayload[0],
      account: "expiring-5x@example.test",
      cacheAccountKey: "codex:stored:expiring-5x-proof",
      accountActive: false,
      accountLive: false,
      usage: {
        ...usagePayload[0].usage,
        identity: { loginMethod: "prolite" },
        secondary: {
          ...usagePayload[0].usage.secondary,
          usedPercent: 10,
          resetsAt: new Date(now + day).toISOString(),
        },
      },
    },
  ],
  forecastFixture(),
  null,
  now,
  null,
);
check(provenCapacitySwitchModel.actions.accountAction.startsWith("consider-switch:"));
equal(provenCapacitySwitchModel.devicePlan.switchReason, "capacity-at-risk");
check(
  provenCapacitySwitchModel.devicePlan.switchProof.recommendedAtRiskCapacityUSD > 500,
  "the switch decision must expose the real API-equivalent capacity at risk",
);
equal(provenCapacitySwitchModel.devicePlan.switchProof.capacitySource, "community-prior");
check(
  !/多个 Codex 账户/.test(multiAccountModel.blocker || ""),
  "multiple accounts must no longer be a global blocker",
);
const ambiguousModel = build(
  multiAccountUsage.map((record) => ({ ...record, accountLive: false })),
  forecastFixture(),
  null,
  now,
  null,
);
equal(ambiguousModel.blocker, "无法确定当前登录的 Codex 账户");

const rawForecast = forecastFixture();
rawForecast.probabilities = {
  ...rawForecast.probabilities,
  raw_24h: 0.3037,
  raw_48h: 0.5149,
};
const rawModel = build(usagePayload, rawForecast, null, now, null);
close(rawModel.forecast.p24, 30.37);
close(rawModel.forecast.p48, 51.49);
close(rawModel.forecast.displayP24, 30);
close(rawModel.forecast.displayP48, 50);

function bankedModel(usedPercent, resetsAt, expiresAt, forecast = forecastFixture()) {
  const usage = [
    {
      provider: "codex",
      cacheAccountKey: "banked-account",
      account: "banked@example.test",
      accountLive: true,
      usage: {
        updatedAt: new Date(now).toISOString(),
        dataConfidence: "exact",
        identity: { loginMethod: "pro" },
        secondary: { usedPercent, windowMinutes: 10080, resetsAt },
      },
    },
  ];
  const receiver = {
    activeAccountId: "banked-account",
    accounts: [
      {
        id: "opaque-banked-account",
        label: "banked@example.test",
        live: true,
        planType: "pro",
        capacityEstimate: {
          source: "api-equivalent-local",
          estimateUSD: 200,
          lowerUSD: 180,
          upperUSD: 220,
          sampleCount: 8,
          confidence: "high",
        },
        resetCredits: {
          reliable: true,
          updatedAt: new Date(now).toISOString(),
          credits: [
            {
              id: "credit-1",
              status: "available",
              resetType: "full",
              grantedAt: new Date(now - hour).toISOString(),
              expiresAt,
            },
          ],
        },
      },
    ],
  };
  return build(usage, forecast, null, now, receiver);
}

const noResetForecast = {
  ...forecastFixture(),
  probabilities: {
    rounded_24h: 0,
    rounded_48h: 0,
    raw_24h: 0,
    raw_48h: 0,
    commitment_floor_percent: null,
  },
};

const earlyBurnBanked = bankedModel(
  99,
  new Date(now + 167 * hour).toISOString(),
  new Date(now + 30 * day).toISOString(),
  noResetForecast,
);
check(earlyBurnBanked.bankedPlan.quotaEdge > 98);
equal(earlyBurnBanked.actions.creditAction, "redeem");
check(earlyBurnBanked.bankedPlan.netCapacityUSD > 196);
const possibleResetForecast = {
  ...noResetForecast,
  teased_window: {
    tweet_id: "2093551005711679011",
    summary: "Synthetic contextual hint: soon, but not today",
    url: "https://x.com/thsottiaux/status/2093551005711679011",
    at: new Date(now - hour).toISOString(),
    window: {
      label: "later today through tomorrow",
      start_at: new Date(now + 2 * hour).toISOString(),
      end_at: new Date(now + 20 * hour).toISOString(),
      time_zone: "UTC",
    },
    score: { band: "tease", value: 50, modifiers: [] },
  },
};
const possibleResetBeforeCoupon = bankedModel(
  99,
  new Date(now + 167 * hour).toISOString(),
  new Date(now + 30 * day).toISOString(),
  possibleResetForecast,
);
equal(possibleResetBeforeCoupon.forecast.signal.level, "hint");
equal(possibleResetBeforeCoupon.bankedPlan.status, "possible-reset-first");
equal(
  possibleResetBeforeCoupon.actions.creditAction,
  "hold",
  "a credit that outlives a possible-reset window must be held until both reset outcomes are safe",
);
equal(
  possibleResetBeforeCoupon.bankedPlan.possibleResetWindowEndMs,
  now + 20 * hour,
);
check(
  possibleResetBeforeCoupon.bankedPlan.optimalAtMs === null ||
    possibleResetBeforeCoupon.bankedPlan.optimalAtMs > now + 20 * hour,
  "redemption nodes inside a possible-reset window must be deferred",
);
const staleCreditAccount = {
  ...earlyBurnBanked.accounts[0],
  usage: {
    ...earlyBurnBanked.accounts[0].usage,
    fresh: false,
  },
};
const staleCreditPlan = bankedPlanFor(
  staleCreditAccount,
  [staleCreditAccount],
  {},
  null,
  now,
  noResetForecast,
);
equal(staleCreditPlan.status, "account-data-unready");
equal(
  staleCreditPlan.creditAction,
  "hold",
  "stale account usage must fail closed instead of recommending immediate redemption",
);
const bankedWithFreeAccount = bankedPlanFor(
  earlyBurnBanked.accounts[0],
  [
    earlyBurnBanked.accounts[0],
    {
      id: "free-account",
      label: "free@example.test",
      usage: {
        usedPercent: 40,
        windowMinutes: 10080,
        resetsAtMs: now + 5 * day,
        updatedAtMs: now,
        exact: true,
        fresh: true,
        shortWindow: null,
      },
      pace: null,
      resetCredits: null,
      capacityEstimate: null,
    },
  ],
  {},
  null,
  now,
);
check(
  bankedWithFreeAccount.creditAction !== "redeem" && bankedWithFreeAccount.optimalAtMs > now,
  "another usable account must be consumed before a later coupon node can become eligible",
);
const secondCreditAccount = {
  ...earlyBurnBanked.accounts[0],
  id: "second-banked-account",
  label: "second@example.test",
  usage: {
    ...earlyBurnBanked.accounts[0].usage,
    usedPercent: 40,
  },
  resetCredits: {
    ...earlyBurnBanked.accounts[0].resetCredits,
    credits: earlyBurnBanked.accounts[0].resetCredits.credits.map((credit) => ({
      ...credit,
      id: "credit-2",
    })),
  },
};
const perAccountBanked = bankedPlanFor(
  earlyBurnBanked.accounts[0],
  [earlyBurnBanked.accounts[0], secondCreditAccount],
  {},
  null,
  now,
);
equal(perAccountBanked.availableCount, 2, "the planner may retain a device-wide credit total");
equal(
  perAccountBanked.currentAccountAvailableCount,
  1,
  "the current account credit count must remain separate from the device-wide total",
);
check(
  perAccountBanked.accountCredits.length === 2 &&
    perAccountBanked.accountCredits.every(
      (inventory) =>
        inventory.availableCount === 1 &&
        inventory.credits.length === 1 &&
        !Object.prototype.hasOwnProperty.call(inventory.credits[0], "id"),
    ),
  "credit inventory must stay attributable to each account without exposing identifiers",
);
const lateUnusedBanked = bankedModel(
  0,
  new Date(now + hour).toISOString(),
  new Date(now + 30 * day).toISOString(),
);
check(lateUnusedBanked.bankedPlan.quotaEdge < -99);
equal(lateUnusedBanked.actions.creditAction, "hold");
check(
  lateUnusedBanked.bankedPlan.bestNetPercent > lateUnusedBanked.bankedPlan.quotaEdge,
  "the planner must search the whole credit lifetime for a better high-value node",
);
const forcedBeforeCouponNode = bankedModel(
  99,
  new Date(now + 6 * day).toISOString(),
  new Date(now + 30 * day).toISOString(),
  {
    ...noResetForecast,
    official_signal: {
      tweet_id: "2090766694897619555",
      at: new Date(now - hour).toISOString(),
      kind: "explicit",
      summary: "Paid usage will reset around 2 PM PT.",
      url: "https://x.com/thsottiaux/status/2090766694897619555",
      official_window: {
        label: "around 2 PM PT",
        start_at: new Date(now + 11 * hour).toISOString(),
        end_at: new Date(now + 13 * hour).toISOString(),
      },
    },
  },
);
equal(
  forcedBeforeCouponNode.forecast.signal.deadlineMs,
  now + 12 * hour,
  "an approximate official range must use its stated center as the one displayed planning instant",
);
equal(forcedBeforeCouponNode.bankedPlan.status, "free-reset-first");
equal(
  forcedBeforeCouponNode.actions.creditAction,
  "hold",
  "a verified forced reset inside 24 hours must stay ahead of coupon redemption",
);
check(
  forcedBeforeCouponNode.bankedPlan.optimalAtMs === null ||
    forcedBeforeCouponNode.bankedPlan.optimalAtMs > forcedBeforeCouponNode.forecast.signal.deadlineMs,
  "the coupon planner must invalidate every node that crosses the earlier forced reset",
);
equal(
  forcedBeforeCouponNode.capacityPlan.creditValuationMethod,
  "capacity-chain",
  "all three actions must expose the shared capacity-chain result",
);
check(
  /重置券保持不动/.test(notificationCopy(forcedBeforeCouponNode, "global").body),
  "the forced-reset notification must carry the same hold-credit conclusion as the UI",
);
const unknownExpiryBanked = bankedModel(
  99,
  new Date(now + 6 * day).toISOString(),
  null,
  noResetForecast,
);
equal(unknownExpiryBanked.bankedPlan.status, "expiry-unknown");
equal(unknownExpiryBanked.bankedPlan.optimalAtMs, null);
equal(
  unknownExpiryBanked.actions.creditAction,
  "hold",
  "an unknown credit expiry must not manufacture a precise redemption date",
);
equal(
  bankedPlanFor(null, [], {}, null, now),
  null,
  "the banked planner must fail closed without an account",
);
check(
  normalizedResetCreditInventory({
    reliable: true,
    updatedAt: new Date(now).toISOString(),
    credits: [],
  }).availableCount === 0,
  "a reliable empty inventory must remain distinguishable from an unavailable inventory",
);

close(
  apiEquivalentCost({ model: "gpt-5.6-sol", input: 100_000, cached: 80_000, output: 10_000 }),
  0.44,
);
const learnedCapacity = appendCapacitySample(null, 25, 10, now);
close(learnedCapacity.estimateUSD, 250);
const communityFive = communityCapacityPrior("prolite");
close(communityFive.estimateUSD, 637.5);
equal(communityFive.source, "community-prior");
let calibratedCapacity = normalizedCapacityEstimate(null, "prolite");
equal(calibratedCapacity.source, "community-prior");
for (let index = 0; index < 6; index += 1) {
  calibratedCapacity = appendCapacitySample(
    calibratedCapacity,
    60 + index,
    10,
    now + index * hour,
    "prolite",
  );
}
equal(calibratedCapacity.source, "api-equivalent-local");
equal(calibratedCapacity.sampleCount, 6);
check(
  calibratedCapacity.estimateUSD >= 600 && calibratedCapacity.estimateUSD <= 650,
  "six valid local samples must take over from the community prior",
);
const capacityChangeSamples = Array.from({ length: 8 }, (_, index) => ({
  at: new Date(now + index * hour).toISOString(),
  fullCapacityUSD: index < 4 ? 640 : 400,
  costUSD: index < 4 ? 64 : 40,
  percentDelta: 10,
}));
const changedCapacity = normalizedCapacityEstimate({ samples: capacityChangeSamples }, "prolite");
equal(changedCapacity.anomaly.status, "change-detected");
const changedAccount = { planType: "prolite", capacityEstimate: changedCapacity };
const stableAccount = {
  planType: "prolite",
  capacityEstimate: normalizedCapacityEstimate({
    samples: capacityChangeSamples.map((sample) => ({ ...sample, fullCapacityUSD: 640, costUSD: 64 })),
  }, "prolite"),
};
classifyCapacityCohort([changedAccount, stableAccount]);
equal(changedAccount.capacityEstimate.anomaly.status, "account-low");

const stale = build(usagePayload, forecastFixture("2026-08-12T07:20:00Z"), null, now, null);
equal(stale.decision, null);
check(/过期/.test(stale.blocker), "stale forecast should be explicit");

const feedNormalized = latestExplicitFeedEvent({ events: [tiboEvent] });
equal(feedNormalized.id, tiboEvent.id);
equal(feedNormalized.deadlineAt, "2026-08-13T02:01:37.000Z");
const bankedEvent = {
  ...tiboEvent,
  id: "2090766694897619318",
  url: "https://x.com/thsottiaux/status/2090766694897619318",
  announced_at: "2026-08-12T08:50:00Z",
  reason_tags: ["milestone", "banked"],
  summary: "All Codex users get a BANKED reset to use at their discretion.",
  localized_summary: "所有用户会获得一张可自行选择使用的重置券。",
  official_window: null,
};
const normalizedBankedEvent = latestExplicitFeedEvent({ events: [bankedEvent] });
equal(normalizedBankedEvent.forcedResetEffect, "none");
equal(normalizedBankedEvent.bankedGrantEffect, "announced");
const availableBankedEvent = {
  ...bankedEvent,
  id: "2090964822422949999",
  url: "https://x.com/thsottiaux/status/2090964822422949999",
  announced_at: "2026-08-12T21:50:00Z",
  banked_state: "available",
  announcement_state: "none",
  type: "credits",
  group: "credits",
  summary: "The banked reset has landed for Codex users.",
};
const availableBankedLifecycle = latestExplicitFeedEvent({
  events: [bankedEvent, availableBankedEvent],
});
equal(availableBankedLifecycle.bankedState, "available");
equal(availableBankedLifecycle.bankedGrantAnnouncedAt, "2026-08-12T08:50:00.000Z");
equal(
  pickSignal(forecastFixture(), { events: [bankedEvent] }, null, now).level,
  "none",
  "a banked-only announcement must not become a forced explicit signal",
);
assert.deepEqual(resetEventEffects(bankedEvent), {
  forcedResetEffect: "none",
  bankedGrantEffect: "announced",
  reasonTags: ["milestone", "banked"],
});
checks += 1;
const rejectedEvent = { ...tiboEvent, reset_verification_status: "rejected" };
equal(
  latestExplicitFeedEvent({ events: [rejectedEvent] }),
  null,
  "a terminal website verification must not be admitted as a new active episode",
);
equal(
  pickSignal(
    forecastFixture(),
    { signal: { ...rejectedEvent, active: true }, events: [rejectedEvent] },
    null,
    Date.parse("2026-08-13T01:10:00Z"),
  ).level,
  "none",
  "a rejected website signal must not override the historical probability model",
);
const rejectedSignalWithoutStatus = { ...tiboEvent, tweet_id: tiboEvent.id, active: true };
delete rejectedSignalWithoutStatus.reset_verification_status;
equal(
  pickSignal(
    forecastFixture(),
    { signal: rejectedSignalWithoutStatus, events: [rejectedEvent] },
    null,
    Date.parse("2026-08-13T01:10:00Z"),
  ).level,
  "none",
  "the provider must inherit a matching event rejection when feed.signal omits verification",
);
equal(
  pickSignal(
    forecastFixture(),
    null,
    {
      activeEpisode: {
        id: "newer-explicit",
        type: "reset",
        group: "reset",
        announcement_state: "announced",
        announced_at: "2026-08-12T08:55:00Z",
        summary: "Synthetic fixture leaked into state",
        source: "site-api",
      },
    },
    now,
  ).level,
  "none",
  "the provider must fail closed if an untrusted persisted episode reaches its public state",
);
equal(
  pickSignal(
    forecastFixture(),
    { signal: { ...tiboEvent, active: true }, events: [tiboEvent] },
    null,
    Date.parse("2026-08-14T09:00:00Z"),
  ).level,
  "none",
  "a fresh install must not resurrect an expired explicit announcement",
);

const atom = `<?xml version="1.0"?><feed><entry>
  <id>tag:codex-reset.com,2026:reset/2087706104814023111</id>
  <updated>2026-08-13T01:01:37.000Z</updated>
  <summary type="text">Enjoy a nice reset everyone. Landing in the next hour or so, go /fast.</summary>
  <link rel="alternate" href="https://x.com/thsottiaux/status/2087706104814023111" />
</entry></feed>`;
const atomEntry = parseAtomEntries(atom)[0];
equal(atomEntry.id, tiboEvent.id);
equal(atomEntry.deadlineAt, "2026-08-13T02:01:37.000Z");
equal(atomEntry.windowLabel, "next hour");
equal(atomEntry.url, tiboEvent.url);

const xHTML = `<article data-tweet-id="${tiboEvent.id}">
  <meta content="${tiboEvent.id}" itemProp="identifier"/>
  <meta content="${tiboEvent.announced_at}" itemProp="datePublished"/>
  <meta content="Old news, but crossed 15M. Landing in the next hour or so, go /fast." itemProp="articleBody"/>
</article>`;
const xPost = parseXProfile(xHTML)[0];
equal(xPost.id, tiboEvent.id);
equal(xPost.deadlineAt, "2026-08-13T02:01:37.000Z");
equal(inferDeadline("should land over next 30 minutes", now), now + 30 * 60 * 1000);
equal(
  inferDeadline(
    "Reset will land around 14pm PST tomorrow.",
    Date.parse("2026-08-23T06:29:05.000Z"),
  ),
  Date.parse("2026-08-23T22:00:00.000Z"),
  "a calendar promise in a Tibo reply must produce a concrete deadline",
);
equal(
  inferDeadline("Reset lands tomorrow around 2pm PDT.", Date.parse("2026-08-23T06:29:05.000Z")),
  Date.parse("2026-08-23T21:00:00.000Z"),
  "a tomorrow-first approximate deadline must preserve the explicit source timezone",
);
equal(inferredDeadlineLabel("Reset lands tomorrow around 2pm PDT."), "tomorrow around 2pm PDT");
equal(inferDeadline("it has been reset", now), null, "past tense without a window stays immediate");

const explicitReplyWithoutAnnouncementState = {
  id: "2091412393368945027",
  url: "https://x.com/thsottiaux/status/2091412393368945027",
  type: "reset",
  group: "reset",
  summary: "Reset will land around 14pm PST tomorrow.",
  localized_summary: "重置将在明天大约 14:00 太平洋标准时间到达。",
  announced_at: "2026-08-23T06:29:05.000Z",
  announcement_state: "none",
  reset_verification_status: "pending",
  is_reply: true,
};
const normalizedExplicitReply = latestExplicitFeedEvent({
  events: [explicitReplyWithoutAnnouncementState],
});
equal(normalizedExplicitReply.id, explicitReplyWithoutAnnouncementState.id);
equal(normalizedExplicitReply.deadlineAt, "2026-08-23T22:00:00.000Z");
equal(
  normalizedExplicitReply.forcedResetEffect,
  "immediate",
  "an authenticated explicit reset reply must not remain a candidate hint",
);
equal(
  shouldNotifyStartupEvent(
    normalizedExplicitReply,
    false,
    true,
    Date.parse("2026-08-23T08:10:00.000Z"),
  ),
  true,
  "an unseen startup event with a future deadline must still notify once",
);
equal(
  shouldNotifyStartupEvent(
    normalizedExplicitReply,
    true,
    true,
    Date.parse("2026-08-23T08:10:00.000Z"),
  ),
  false,
  "an already-seen startup event must not notify again",
);

const landingEvent = { status: "global-announced", announcedAt: "2026-08-12T09:00:00Z" };
const usageBeforeLanding = {
  usedPercent: 42,
  resetsAtMs: now + 5 * day,
  updatedAtMs: now,
};
equal(
  personalLandingEvidence(
    usageBeforeLanding,
    { ...usageBeforeLanding, usedPercent: 3, updatedAtMs: now + minute },
    landingEvent,
  ),
  "usage-decreased",
);
equal(
  personalLandingEvidence(
    usageBeforeLanding,
    { ...usageBeforeLanding, resetsAtMs: usageBeforeLanding.resetsAtMs + day, updatedAtMs: now + minute },
    landingEvent,
  ),
  "reset-time-advanced",
);
equal(
  personalLandingEvidence(
    usageBeforeLanding,
    { ...usageBeforeLanding, usedPercent: 45, updatedAtMs: now + minute },
    landingEvent,
  ),
  null,
  "ordinary use must not look like a reset",
);
equal(
  personalLandingEvidence(
    usageBeforeLanding,
    { ...usageBeforeLanding, usedPercent: 3, updatedAtMs: now - minute },
    landingEvent,
  ),
  null,
  "out-of-order quota samples must be ignored",
);

equal(
  resetCause(
    usageBeforeLanding,
    { ...usageBeforeLanding, usedPercent: 3, updatedAtMs: now + minute },
    landingEvent,
  ).cause,
  "global-manual",
);
equal(
  resetCause(
    { ...usageBeforeLanding, resetsAtMs: now + minute },
    {
      ...usageBeforeLanding,
      usedPercent: 3,
      resetsAtMs: now + 7 * day,
      updatedAtMs: now + 2 * minute,
    },
    null,
  ).cause,
  "automatic",
);
equal(
  resetCause(
    { ...usageBeforeLanding, resetsAtMs: now + minute },
    {
      ...usageBeforeLanding,
      usedPercent: 3,
      resetsAtMs: now + 7 * day,
      updatedAtMs: now + 2 * minute,
    },
    landingEvent,
  ).cause,
  "automatic",
  "the advertised automatic boundary must win over a stale active event",
);
equal(
  resetCause(
    { ...usageBeforeLanding, updatedAtMs: now, resetsAtMs: now + minute },
    {
      ...usageBeforeLanding,
      usedPercent: 3,
      resetsAtMs: now + 7 * day,
      updatedAtMs: now + 5 * hour,
    },
    null,
  ).cause,
  "automatic",
  "sleep or polling gaps must not hide a natural refresh when adjacent samples straddle its boundary",
);
equal(
  resetCause(
    usageBeforeLanding,
    {
      ...usageBeforeLanding,
      usedPercent: 3,
      resetsAtMs: now + 7 * day,
      updatedAtMs: now + 2 * minute,
    },
    landingEvent,
    { id: "credit-consumed", status: "available" },
  ).cause,
  "banked-redeem",
  "credit-consumption evidence must win over an active forced-reset episode",
);

const renewalHistory = [
  { at: "2026-06-13T03:00:00Z", cause: "unclassified", evidence: "usage-decreased" },
  { at: "2026-07-13T03:20:00Z", cause: "unclassified", evidence: "usage-decreased" },
];
const learnedRenewal = renewalObservationFromHistory(
  renewalHistory,
  Date.parse("2026-08-01T00:00:00Z"),
);
equal(learnedRenewal.status, "not-a-reset-boundary");
equal(learnedRenewal.nextAt, null, "same-tier monthly renewal must never become a reset boundary");

equal(
  resetCause(
    usageBeforeLanding,
    { ...usageBeforeLanding, usedPercent: 3, updatedAtMs: now + minute },
    null,
    null,
    { paidUpgrade: true, planTransition: "3->4" },
  ).cause,
  "upgrade",
  "an observed quota refresh following a higher paid tier must be attributed to the upgrade",
);
equal(
  resetCause(
    { ...usageBeforeLanding, resetsAtMs: now + minute },
    {
      ...usageBeforeLanding,
      usedPercent: 3,
      resetsAtMs: now + 7 * day,
      updatedAtMs: now + 2 * minute,
    },
    null,
    null,
    { paidUpgrade: true, planTransition: "free->pro20x" },
  ).cause,
  "upgrade",
  "a paid upgrade at the old natural boundary must not be misclassified as automatic",
);
equal(
  resetCause(
    usageBeforeLanding,
    { ...usageBeforeLanding, usedPercent: 3, updatedAtMs: now + minute },
    null,
  ).cause,
  "global-manual",
  "an early full-window refresh with coupon, natural and upgrade evidence excluded is a forced reset",
);
equal(
  resetCause(
    usageBeforeLanding,
    {
      ...usageBeforeLanding,
      resetsAtMs: usageBeforeLanding.resetsAtMs + 2 * minute,
      updatedAtMs: now + minute,
    },
    null,
  ),
  null,
  "small upstream reset-time refinements must not create refresh history",
);

const scopedBehavior = forecastUsageBehavior({
  nowMs: now,
  currentUsedPercent: 10,
  resetsAtMs: now + 6 * day,
  updatedAtMs: now,
  windowMinutes: 10080,
  horizonHours: 24,
  targetUsed: 20,
  historyAccountKey: "account-a",
  strictAccountScope: true,
  historyDocument: {
    accounts: {
      "account-a": [
        {
          name: "weekly",
          windowMinutes: 10080,
          entries: [
            { capturedAt: new Date(now - 2 * hour).toISOString(), usedPercent: 8, resetsAt: new Date(now + 6 * day).toISOString() },
            { capturedAt: new Date(now - hour).toISOString(), usedPercent: 9, resetsAt: new Date(now + 6 * day).toISOString() },
          ],
        },
      ],
      "account-b": [
        {
          name: "weekly",
          windowMinutes: 10080,
          entries: Array.from({ length: 100 }, (_, index) => ({
            capturedAt: new Date(now - (100 - index) * hour).toISOString(),
            usedPercent: index,
            resetsAt: new Date(now + 6 * day).toISOString(),
          })),
        },
      ],
    },
  },
});
equal(scopedBehavior.historySampleCount, 2, "behavior history must never borrow a sibling account");

const shortLoadReceiver = {
  usageShortLoad: {
    version: 1,
    model: "session-load-v1",
    status: "ready",
    asOf: new Date(now).toISOString(),
    sourceUpdatedAt: new Date(now - minute).toISOString(),
    horizonHours: 1,
    prediction: {
      additionalLower: 0,
      additionalMedian: 1,
      additionalUpper: 2,
    },
    context: {
      activeRootNow: 2,
      activeAllNow: 3,
      rootMean15: 1.8,
      allMean15: 2.1,
      rootMean60: 1.2,
      allMean60: 1.5,
    },
    training: {
      lookbackDays: 14,
      neighborCount: 80,
      states: 251,
      historySamples: 369,
      fromAt: new Date(now - 14 * day).toISOString(),
      throughAt: new Date(now - hour).toISOString(),
      medianNeighborDistance: 1.02,
    },
    shadow: {
      evaluations: 0,
      mae: null,
      medianAbsoluteError: null,
      bias: null,
      coverage: null,
    },
  },
};
const paceResetAt = now + 7 * day;
const paceSamples = Array.from({ length: 13 }, (_, index) => ({
  atMs: now + index * 5 * minute,
  usedPercent: index / 2,
  resetsAtMs: paceResetAt,
}));
const measuredPace = usagePaceFromSamples(paceSamples);
close(measuredPace.short.ratePerHour, 6);
close(measuredPace.short.lowerRatePerHour, 2);
close(measuredPace.short.upperRatePerHour, 10);
close(measuredPace.long.ratePerHour, 6);
close(measuredPace.long.lowerRatePerHour, 5);
close(measuredPace.long.upperRatePerHour, 7);
equal(measuredPace.sampleCount, 13);

const warmingPace = usagePaceFromSamples(paceSamples.slice(0, 2));
equal(warmingPace.short, null);
equal(warmingPace.warmupRemainingMinutes, 5);

let sampleResult = appendUsageSample([], {
  updatedAtMs: now,
  usedPercent: 10,
  resetsAtMs: paceResetAt,
});
equal(sampleResult.samples.length, 1);
sampleResult = appendUsageSample(sampleResult.samples, {
  updatedAtMs: now + 5 * minute,
  usedPercent: 11,
  resetsAtMs: paceResetAt,
});
equal(sampleResult.samples.length, 2);
sampleResult = appendUsageSample(sampleResult.samples, {
  updatedAtMs: now + 5 * minute,
  usedPercent: 11,
  resetsAtMs: paceResetAt,
});
equal(sampleResult.samples.length, 2, "duplicate bridge timestamps must not add samples");
sampleResult = appendUsageSample(sampleResult.samples, {
  updatedAtMs: now + 6 * minute,
  usedPercent: 0,
  resetsAtMs: paceResetAt + day,
});
equal(sampleResult.resetEpoch, true);
equal(sampleResult.samples.length, 1, "a reset must start a new speed epoch");

const shortLoadCurrent = {
  usedPercent: 10,
  resetsAtMs: paceResetAt,
  updatedAtMs: now,
  exact: true,
};
const seededShortLoad = seedShortLoadPrediction(
  { ...shortLoadReceiver.usageShortLoad, pending: [], results: [] },
  shortLoadCurrent,
  now,
);
equal(seededShortLoad.pending.length, 1, "a ready short-load forecast should seed one shadow row");
const settledShortLoad = settleShortLoadPredictions(
  seededShortLoad,
  {
    ...shortLoadCurrent,
    usedPercent: 12,
    updatedAtMs: now + hour,
  },
  now + hour,
);
equal(settledShortLoad.pending.length, 0);
equal(settledShortLoad.results.length, 1);
close(settledShortLoad.results[0].actual, 2);
const shortLoadMetrics = shortLoadShadowMetrics(settledShortLoad.results);
close(shortLoadMetrics.mae, 1);
close(shortLoadMetrics.bias, -1);
close(shortLoadMetrics.coverage, 1);
equal(
  shortLoadShadowMetrics(
    [
      ...settledShortLoad.results,
      { ...settledShortLoad.results[0], model: "session-load-v2-live" },
    ],
    "session-load-v1",
  ).evaluations,
  1,
  "shadow calibration must not mix results from different short-load models",
);
const resetDiscardedShortLoad = settleShortLoadPredictions(
  seededShortLoad,
  {
    ...shortLoadCurrent,
    usedPercent: 0,
    resetsAtMs: paceResetAt + day,
    updatedAtMs: now + hour,
  },
  now + hour,
);
equal(
  resetDiscardedShortLoad.results.length,
  0,
  "a quota reset must discard, rather than score, a crossing short-load forecast",
);

const firstPlan = notificationPlan(model, {}, now);
equal(firstPlan.reason, null, "startup seeds without notifying old forecast data");
const unchangedPlan = notificationPlan(model, firstPlan.state, now + hour);
equal(unchangedPlan.reason, null);
const increasedModel = {
  ...model,
  forecast: { ...model.forecast, updatedAt: "2026-08-12T10:00:00Z" },
  decision: { ...model.decision, predictionUse: model.decision.predictionUse + 1.2 },
};
equal(notificationPlan(increasedModel, firstPlan.state, now + hour).reason, "forecast");

const paceReceiver = {
  usagePace: {
    asOf: "2026-08-12T09:00:00Z",
    sampleCount: 61,
    warmupRemainingMinutes: 0,
    short: {
      ratePerHour: 1,
      lowerRatePerHour: 0,
      upperRatePerHour: 5,
      changePercent: 0.25,
      windowMinutes: 15,
      sampleCount: 16,
      resolutionPercent: 1,
    },
    long: {
      ratePerHour: 0.5,
      lowerRatePerHour: 0,
      upperRatePerHour: 1.2,
      changePercent: 0.5,
      windowMinutes: 60,
      sampleCount: 61,
      resolutionPercent: 1,
    },
  },
};
const pacedModel = build(usagePayload, forecastFixture(), null, now, paceReceiver);
check(pacedModel.pace, "short windows should remain available as realtime diagnostics");
equal(pacedModel.paceProjection, undefined, "short speed must never be extrapolated to the deadline");
const shortLoadModel = build(
  usagePayload,
  forecastFixture(),
  null,
  now,
  { ...paceReceiver, ...shortLoadReceiver },
);
equal(shortLoadModel.shortLoad.status, "ready");
close(shortLoadModel.shortLoad.prediction.additionalMedian, 1);
equal(shortLoadModel.shortLoad.context.activeRootNow, 2);

const targetTrajectoryFixture = {
  version: 1,
  anchorAt: new Date(now).toISOString(),
  anchorRemainingPercent: 90,
  naturalResetAt: new Date(now + 6 * day).toISOString(),
  cycleStartedAt: new Date(now - day).toISOString(),
  cycleResetAt: new Date(now + 6 * day).toISOString(),
  policyKind: "hazard",
  policyHazardPerHour: -Math.log(0.7) / 24,
  policyDeadlineAt: null,
  policySource: "forecast",
  signalId: null,
};

const usageBehavior = {
  version: 1,
  asOf: new Date(now).toISOString(),
  sourceUpdatedAt: "2026-08-12T08:59:00.000Z",
  horizonHours: 24,
  historySampleCount: 1500,
  historyDays: 72,
  status: "ready",
  confidence: "medium",
  reasons: [],
  context: { past1: 1, past6: 3, past24: 7, cycleElapsedHours: 24 },
  prediction: {
    additionalLower: 12,
    additionalMedian: 22,
    additionalUpper: 36,
    endpointLower: 22,
    endpointMedian: 32,
    endpointUpper: 46,
    targetGap: 37.5,
    reachProbability: 35,
    extraLower: 1.5,
    extraMedian: 15.5,
    extraUpper: 25.5,
  },
  models: [
    { id: "base", label: "近期基准", median: 22, weight: 0.6, mae: 8, samples: 100, config: "30d" },
    { id: "cycle", label: "当前周期", median: 25, weight: 0.4, mae: 10, samples: 80, config: "calendar" },
  ],
  validation: {
    evaluations: 30,
    mae: 7.8,
    medianAbsoluteError: 6,
    baseMae: 8,
    intervalWidth: 24,
    disagreement: 3,
    selectedMode: "ensemble",
  },
};
const behaviorModel = build(
  usagePayload,
  forecastFixture(),
  null,
  now,
  { ...paceReceiver, targetTrajectory: targetTrajectoryFixture, usageBehavior },
);
check(behaviorModel.behavior.prediction, "a calibrated behavior forecast should reach the model");
const uncertainModel = {
  ...behaviorModel,
  behavior: {
    ...behaviorModel.behavior,
    prediction: {
      ...behaviorModel.behavior.prediction,
      endpointLower: 40,
      endpointMedian: 46,
      endpointUpper: 55,
    },
  },
};
const behaviorSeed = behaviorNotificationPlan(uncertainModel, {}, now);
equal(behaviorSeed.reason, null, "a new plan seeds without replaying an old behavior warning");
equal(behaviorSeed.state.zone, "uncertain");
equal(
  behaviorZone(uncertainModel.decision, uncertainModel.behavior.prediction),
  "uncertain",
  "a red target inside the blue interval should be basically suitable",
);
const behaviorBehind = behaviorNotificationPlan(behaviorModel, behaviorSeed.state, now + minute);
equal(behaviorBehind.reason, "behavior-behind");
equal(
  behaviorZone(behaviorModel.decision, behaviorModel.behavior.prediction),
  "behind",
  "a red target to the right of the whole blue interval should be clearly slow",
);
equal(
  behaviorNotificationPlan(behaviorModel, behaviorBehind.state, now + 2 * minute).reason,
  null,
  "an unchanged shortfall must not repeat notifications",
);
const recoveredModel = {
  ...behaviorModel,
  behavior: {
    ...behaviorModel.behavior,
    prediction: {
      ...behaviorModel.behavior.prediction,
      endpointLower: 50,
      endpointMedian: 55,
      endpointUpper: 62,
    },
  },
};
equal(
  behaviorZone(recoveredModel.decision, recoveredModel.behavior.prediction),
  "covered",
  "a red target to the left of the whole blue interval should be clearly fast",
);
equal(
  suggestionLimit(behaviorModel.decision, behaviorModel.behavior.prediction, 10),
  5,
  "a projected interval still below target should allow five reliable mainlines",
);
equal(
  suggestionLimit(uncertainModel.decision, uncertainModel.behavior.prediction, 10),
  3,
  "an interval covering target should allow three reliable mainlines",
);
equal(
  suggestionLimit(recoveredModel.decision, recoveredModel.behavior.prediction, 10),
  1,
  "an interval already beyond target should allow one reliable mainline",
);
equal(
  suggestionLimit(
    { ...behaviorModel.decision, targetReached: true },
    behaviorModel.behavior.prediction,
    behaviorModel.decision.targetUsed + 1,
  ),
  1,
  "actual usage beyond target should allow only one reliable mainline",
);
equal(
  behaviorNotificationPlan(recoveredModel, behaviorBehind.state, now + 3 * minute).reason,
  "behavior-recovered",
);
equal(
  behaviorNotificationPlan(uncertainModel, behaviorBehind.state, now + 3 * minute).reason,
  "behavior-recovered",
  "returning from clearly slow into the blue interval should clear the warning",
);
equal(
  behaviorZone(
    behaviorModel.decision,
    {
      ...behaviorModel.behavior.prediction,
      endpointLower: behaviorModel.decision.targetUsed,
      endpointUpper: behaviorModel.decision.targetUsed + 5,
    },
  ),
  "uncertain",
  "a red marker touching the blue boundary should remain basically suitable",
);
const slowCopy = notificationCopy(
  { ...behaviorModel, sessionSuggestions: { mainlineCount: 3 } },
  "behavior-behind",
);
check(/优先继续 3 条可靠主线.*开启 Fast/.test(slowCopy.body));
const fastCopy = notificationCopy(recoveredModel, "behavior-recovered");
check(/切回 Standard/.test(fastCopy.subtitle));
check(!/减少任务/.test(`${fastCopy.subtitle} ${fastCopy.body}`));
const suitableCopy = notificationCopy(uncertainModel, "behavior-recovered");
check(/保持当前节奏/.test(suitableCopy.body));

function syntheticHistoryFixture() {
  const forecastNow = Date.parse("2026-08-14T12:00:00Z");
  const start = forecastNow - 66 * day;
  const week = 7 * day;
  const dailyUse = [2, 6, 1, 8, 3, 5, 2];
  function baseUsed(atMs) {
    const withinCycle = ((atMs - start) % week + week) % week;
    const dayIndex = Math.floor(withinCycle / day);
    const hourInDay = (withinCycle % day) / hour;
    let used = 0;
    for (let index = 0; index < dayIndex; index += 1) used += dailyUse[index];
    if (hourInDay >= 11) used += dailyUse[dayIndex];
    else if (hourInDay >= 10) used += dailyUse[dayIndex] * (hourInDay - 10);
    return used;
  }
  const entries = [];
  for (let atMs = start; atMs <= forecastNow; atMs += hour) {
    const cycle = Math.floor((atMs - start) / week);
    let usedPercent = baseUsed(atMs);
    // A deliberately atypical 4-point burst in the final hour. A naïve
    // rate-times-24 projection would add 96 points.
    if (atMs > forecastNow - hour) {
      usedPercent += (4 * (atMs - (forecastNow - hour))) / hour;
    }
    entries.push({
      capturedAt: new Date(atMs).toISOString(),
      usedPercent,
      resetsAt: new Date(start + (cycle + 1) * week).toISOString(),
    });
  }
  return { forecastNow, entries };
}

const synthetic = syntheticHistoryFixture();
const syntheticCurrent = synthetic.entries[synthetic.entries.length - 1];
const robustForecast = forecastUsageBehavior({
  historyDocument: {
    accounts: { synthetic: [{ name: "weekly", windowMinutes: 10080, entries: synthetic.entries }] },
  },
  nowMs: synthetic.forecastNow,
  updatedAtMs: synthetic.forecastNow,
  currentUsedPercent: syntheticCurrent.usedPercent,
  resetsAtMs: Date.parse(syntheticCurrent.resetsAt),
  windowMinutes: 10080,
  horizonHours: 24,
  targetUsed: syntheticCurrent.usedPercent + 15,
});
check(
  ["ready", "degraded"].includes(robustForecast.status),
  "a long local history should produce a usable forecast",
);
close(robustForecast.context.past1, 4);
check(
  robustForecast.prediction.additionalMedian < 12,
  "a one-hour burst must not be multiplied across the whole 24-hour horizon",
);
check(
  robustForecast.validation.mae <= robustForecast.validation.baseMae + 1e-9,
  "the selected live weighting must beat or equal the chronological baseline",
);
check(
  robustForecast.prediction.additionalLower <= robustForecast.prediction.additionalMedian &&
    robustForecast.prediction.additionalMedian <= robustForecast.prediction.additionalUpper,
  "the calibrated interval must be ordered",
);
const insufficientForecast = forecastUsageBehavior({
  historyDocument: {
    accounts: {
      synthetic: [{ name: "weekly", windowMinutes: 10080, entries: synthetic.entries.slice(-10) }],
    },
  },
  nowMs: synthetic.forecastNow,
  updatedAtMs: synthetic.forecastNow,
  currentUsedPercent: syntheticCurrent.usedPercent,
  resetsAtMs: Date.parse(syntheticCurrent.resetsAt),
  windowMinutes: 10080,
  horizonHours: 24,
  targetUsed: syntheticCurrent.usedPercent + 15,
});
equal(insufficientForecast.status, "insufficient");
equal(insufficientForecast.prediction, null, "too little history must fail without false precision");

const sessionStart = now - 12 * hour;
equal(
  sessionCycleStart(
    {
      usage: {
        latest: {
          resetsAtMs: now + 6 * day,
          windowMinutes: 7 * 24 * 60,
        },
      },
      lastPersonalReset: { at: new Date(sessionStart).toISOString() },
    },
    now,
  ),
  sessionStart,
  "the latest observed reset should bound the local session candidate window",
);
const rankedSessions = sessionCandidatesFromRows(
  [
    {
      id: "thread-paused",
      display_title: "Paused research task",
      cwd: "/synthetic-home/research-workspace",
      tokens_used: 500,
      created_at_ms: now - 10 * hour,
      recency_at_ms: now - 2 * hour,
      is_pinned: 0,
    },
    {
      id: "thread-pinned",
      display_title: "Pinned implementation task",
      cwd: "/synthetic-home/implementation",
      tokens_used: 260,
      created_at_ms: now - 9 * hour,
      recency_at_ms: now - hour,
      is_pinned: 1,
    },
    {
      id: "thread-recent",
      display_title: "Recent ordinary task",
      cwd: "/synthetic-home/research-workspace",
      tokens_used: 100,
      created_at_ms: now - 30 * minute,
      recency_at_ms: now - 5 * minute,
      is_pinned: 0,
    },
    {
      id: "thread-complete",
      display_title: "Completed task",
      cwd: "/synthetic-home/completed",
      tokens_used: 900,
      created_at_ms: now - 8 * hour,
      recency_at_ms: now - minute,
      is_pinned: 1,
    },
  ],
  [
    { thread_id: "thread-paused", status: "paused" },
    { thread_id: "thread-complete", status: "complete" },
  ],
  {
    cycleStartAt: new Date(sessionStart).toISOString(),
    observationStartedAt: new Date(now - 3 * hour).toISOString(),
    baselines: { "thread-paused": 500, "thread-pinned": 200 },
  },
  sessionStart,
  now,
  [
    { session_id: "thread-paused", recent_tokens: 100 },
    { session_id: "thread-pinned", recent_tokens: 800 },
    { session_id: "thread-recent", recent_tokens: 900 },
    { session_id: "thread-complete", recent_tokens: 2_000 },
  ],
  now - day,
);
equal(rankedSessions.candidateCount, 3, "completed goals should not be suggested for resuming");
equal(rankedSessions.tokenSource, "cost-ledger");
equal(rankedSessions.workspaceCount, 2);
equal(rankedSessions.candidates[0].title, "Recent ordinary task");
equal(rankedSessions.candidates[0].workspaceObservedTokens, 1_000);
equal(rankedSessions.candidates[0].workspaceRank, 1);
equal(rankedSessions.candidates[1].title, "Pinned implementation task");
equal(rankedSessions.candidates[1].observedTokens, 800);
equal(
  rankedSessions.candidates[2].title,
  "Paused research task",
  "the second task from a high-volume workspace should wait until each workspace gets one slot",
);
equal(
  rankedSessions.candidates[2].observedTokens,
  100,
  "precise rolling token deltas should replace cumulative thread counters",
);

const firstLocalTokenSample = sessionCandidatesFromRows(
  [{
    id: "thread-local-window",
    display_title: "Locally sampled task",
    cwd: "/synthetic-home/local-window",
    tokens_used: 1_000,
    created_at_ms: now - 2 * day,
    recency_at_ms: now,
    is_pinned: 0,
  }],
  [],
  {
    cycleStartAt: new Date(sessionStart).toISOString(),
    observationStartedAt: new Date(now - 3 * hour).toISOString(),
    baselines: { "thread-local-window": 900 },
  },
  sessionStart,
  now,
  [],
  now - day,
);
equal(firstLocalTokenSample.tokenSource, "observation-fallback");
equal(firstLocalTokenSample.candidates[0].observedTokens, 100);
const secondLocalTokenSampleAt = now + 25 * hour;
const matureLocalTokenSample = sessionCandidatesFromRows(
  [{
    id: "thread-local-window",
    display_title: "Locally sampled task",
    cwd: "/synthetic-home/local-window",
    tokens_used: 1_600,
    created_at_ms: now - 2 * day,
    recency_at_ms: secondLocalTokenSampleAt,
    is_pinned: 0,
  }],
  [],
  firstLocalTokenSample,
  sessionStart,
  secondLocalTokenSampleAt,
  [],
  secondLocalTokenSampleAt - day,
);
equal(
  matureLocalTokenSample.tokenSource,
  "local-samples",
  "the monitor's own token samples should become a true rolling window after one day",
);
equal(
  matureLocalTokenSample.candidates[0].observedTokens,
  600,
  "rolling local samples should subtract the counter observed at the 24-hour boundary",
);

const mainlineRows = [
  {
    id: "paper-draft",
    display_title: "Paper manuscript experiments",
    first_user_message: "Continue the paper manuscript and evaluate experiments",
    preview: "private paper preview must not leak",
    cwd: "/synthetic-home/research",
    tokens_used: 900,
    created_at_ms: now - 5 * day,
    recency_at_ms: now - 2 * day,
    is_pinned: 0,
  },
  {
    id: "paper-revision",
    display_title: "Paper manuscript revision",
    first_user_message: "Revise the paper manuscript after the experiments",
    cwd: "/synthetic-home/research",
    tokens_used: 800,
    created_at_ms: now - 2 * day,
    recency_at_ms: now - hour,
    is_pinned: 0,
  },
  {
    id: "temporary-author-removal",
    display_title: "Remove author information",
    first_user_message: "One-off anonymization before submission",
    cwd: "/synthetic-home/research",
    tokens_used: 50_000,
    created_at_ms: now - hour,
    recency_at_ms: now - 5 * minute,
    is_pinned: 0,
  },
  {
    id: "backend-one",
    display_title: "Backend API reliability",
    first_user_message: "Continue backend API reliability work",
    cwd: "/synthetic-home/service",
    tokens_used: 20_000,
    created_at_ms: now - 4 * day,
    recency_at_ms: now - day,
    is_pinned: 0,
  },
  {
    id: "backend-two",
    display_title: "Backend API integration",
    first_user_message: "Continue backend API integration work",
    cwd: "/synthetic-home/service",
    tokens_used: 20_000,
    created_at_ms: now - day,
    recency_at_ms: now - 2 * hour,
    is_pinned: 0,
  },
  {
    id: "explicit-roadmap",
    display_title: "Capacity planning roadmap",
    first_user_message: "Plan the next capacity planning milestones",
    cwd: "/synthetic-home/planner",
    tokens_used: 10,
    created_at_ms: now - 3 * hour,
    recency_at_ms: now - 10 * minute,
    is_pinned: 0,
  },
];
const mainlineTokenRows = [
  { session_id: "paper-draft", recent_tokens: 20 },
  { session_id: "paper-revision", recent_tokens: 30 },
  { session_id: "temporary-author-removal", recent_tokens: 100_000 },
  { session_id: "backend-one", recent_tokens: 10_000 },
  { session_id: "backend-two", recent_tokens: 20_000 },
  { session_id: "explicit-roadmap", recent_tokens: 1 },
];
const inferredMainlines = sessionCandidatesFromRows(
  mainlineRows,
  [],
  {},
  sessionStart,
  now,
  mainlineTokenRows,
  now - day,
  [],
  now - 30 * day,
);
equal(inferredMainlines.mainlines.length, 2, "only repeated cross-day work should be inferred");
check(
  inferredMainlines.mainlines.some((mainline) => /论文/.test(mainline.label)),
  "related paper work should become one logical mainline",
);
check(
  !inferredMainlines.mainlines.some((mainline) => /author|Remove/i.test(mainline.label)),
  "a one-off high-token session must not become a mainline",
);
const reversedLoadMainlines = sessionCandidatesFromRows(
  mainlineRows,
  [],
  {},
  sessionStart,
  now,
  mainlineTokenRows.map((row, index) => ({ ...row, recent_tokens: (index + 1) * 999_999 })),
  now - day,
  [],
  now - 30 * day,
);
assert.deepEqual(
  inferredMainlines.mainlines.map((mainline) => mainline.label),
  reversedLoadMainlines.mainlines.map((mainline) => mainline.label),
  "token volume must not change logical-mainline intent order",
);
checks += 1;
const explicitTarget = inferredMainlines.candidates.find(
  (candidate) => candidate.title === "Capacity planning roadmap",
).actionId;
const explicitMainlines = sessionCandidatesFromRows(
  mainlineRows,
  [],
  {},
  sessionStart,
  now,
  mainlineTokenRows,
  now - day,
  [{
    targetId: explicitTarget,
    kind: "session",
    status: "mainline",
    label: "Capacity planning roadmap",
    project: "planner",
    updatedAt: new Date(now).toISOString(),
  }],
  now - 30 * day,
);
equal(explicitMainlines.mainlines[0].label, "Capacity planning roadmap");
equal(explicitMainlines.mainlines[0].source, "explicit");
equal(
  explicitMainlines.mainlines[0].observedTokens,
  1,
  "an explicit low-load mainline must outrank inferred high-load work",
);
const rejectedInferredTarget = inferredMainlines.mainlines[0].actionId;
const correctedMainlines = sessionCandidatesFromRows(
  mainlineRows,
  [],
  {},
  sessionStart,
  now,
  mainlineTokenRows,
  now - day,
  [{
    targetId: rejectedInferredTarget,
    kind: "mainline",
    status: "not-mainline",
    label: inferredMainlines.mainlines[0].label,
    project: inferredMainlines.mainlines[0].project,
    updatedAt: new Date(now).toISOString(),
  }],
  now - 30 * day,
);
check(
  !correctedMainlines.mainlines.some((mainline) => mainline.actionId === rejectedInferredTarget),
  "a local correction must override automatic inference",
);

const publicRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    capabilityToken: "must-not-leak",
    usage: {
      latest: {
        usedPercent: 10,
        windowMinutes: 10080,
        resetsAtMs: Date.parse("2026-08-18T09:00:00Z"),
        resetsAt: "2026-08-18T09:00:00Z",
        updatedAtMs: Date.parse("2026-08-12T08:59:00Z"),
        updatedAt: "2026-08-12T08:59:00Z",
        exact: true,
      },
      samples: paceSamples,
      behavior: usageBehavior,
      shortLoad: {
        ...shortLoadReceiver.usageShortLoad,
        pending: seededShortLoad.pending,
        results: settledShortLoad.results,
      },
    },
    sessions: {
      ...rankedSessions,
      status: "ready",
      updatedAt: new Date(now).toISOString(),
    },
    notificationDelivery: {
      lastAttemptAt: new Date(now - minute).toISOString(),
      lastSuccessAt: new Date(now - minute).toISOString(),
      lastReason: "global",
      lastStatus: "sent",
    },
  },
);
const publicState = publicRuntime.publicReceiverState();
const publicStateJSON = JSON.stringify(publicState);
check(publicStateJSON.includes("usageSnapshot"), "the sanitized last-good quota should be locally reusable");
equal(publicState.usageSnapshot.usedPercent, 10);
check(publicStateJSON.includes("usagePace"), "derived pace should be available to the provider");
check(publicStateJSON.includes("usageBehavior"), "the sanitized behavior result should be public locally");
check(publicStateJSON.includes("usageShortLoad"), "the one-hour load forecast should be public locally");
equal(publicState.notificationDelivery.lastStatus, "sent");
equal(publicState.notificationDelivery.lastReason, "global");
check(
  !JSON.stringify(publicState.notificationDelivery).includes("notification body"),
  "notification observability must expose delivery state without persisting message content",
);
close(publicState.usageShortLoad.prediction.additionalMedian, 1);
equal(publicState.usageShortLoad.shadow.evaluations, 1);
equal(publicState.usageShortLoad.pending, undefined, "pending shadow rows must stay private");
equal(publicState.usageShortLoad.results, undefined, "resolved shadow rows must stay private");
equal(publicState.sessionSuggestions.candidateCount, 3);
equal(publicState.sessionSuggestions.candidates.length, 3);
check(
  publicState.sessionSuggestions.candidates.some(
    (candidate) =>
      candidate.title === "Paused research task" &&
      candidate.project === "research-workspace" &&
      candidate.workspaceObservedTokens === 1_000,
  ),
  "the provider should receive workspace aggregates without the private workspace key or path",
);
check(!publicStateJSON.includes("thread-paused"), "thread IDs must stay private to the monitor");
check(!publicStateJSON.includes("/synthetic-home"), "full project paths must stay private to the monitor");
equal(publicState.usage, undefined, "raw usage samples must stay private to the monitor");
equal(publicState.usageSnapshot.samples, undefined, "raw usage history must not enter the fallback snapshot");
check(!publicStateJSON.includes("must-not-leak"), "the capability token must not enter public state");

const mainlinePrivacyRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    sessions: {
      ...explicitMainlines,
      status: "ready",
      updatedAt: new Date(now).toISOString(),
    },
    mainlinePreferences: [{
      targetId: explicitTarget,
      kind: "session",
      status: "mainline",
      label: "Capacity planning roadmap",
      project: "planner",
      updatedAt: new Date(now).toISOString(),
    }],
  },
);
const publicMainlineState = mainlinePrivacyRuntime.publicReceiverState();
const publicMainlineJSON = JSON.stringify(publicMainlineState);
equal(publicMainlineState.sessionSuggestions.mainlines[0].source, "explicit");
equal(publicMainlineState.sessionSuggestions.corrections.length, 1);
check(!publicMainlineJSON.includes("explicit-roadmap"), "raw thread IDs must not back action controls");
check(!publicMainlineJSON.includes("/synthetic-home"), "mainline state must omit full paths");
check(
  !publicMainlineJSON.includes("private paper preview must not leak"),
  "prompt and preview material used for local clustering must not enter public state",
);
check(
  !publicMainlineJSON.includes("actionTargets"),
  "the opaque-to-raw action target map must remain private",
);

const actionNow = Date.now();
let persistedMainlineState = null;
const actionRuntime = createRuntime(
  {
    buildModel() { return null; },
    pickUsage() { return null; },
    readSessionRows() {
      return [{
        id: "local-action-thread",
        display_title: "Explicit product roadmap",
        first_user_message: "Continue the product roadmap",
        cwd: "/synthetic-home/product",
        tokens_used: 12,
        created_at_ms: actionNow - hour,
        recency_at_ms: actionNow - minute,
        is_pinned: 0,
      }];
    },
    readRecentSessionTokenRows() {
      return [{ session_id: "local-action-thread", recent_tokens: 2 }];
    },
    readGoalRows() { return []; },
    writeState(value) { persistedMainlineState = JSON.parse(JSON.stringify(value)); },
  },
  {},
);
actionRuntime.refreshSessions();
const localActionTarget = actionRuntime.publicReceiverState()
  .sessionSuggestions.candidates[0].actionId;
actionRuntime.applyMainlineAction("mark-mainline", localActionTarget);
equal(
  actionRuntime.publicReceiverState().sessionSuggestions.mainlines[0].source,
  "explicit",
  "marking a recovery session should immediately create an explicit mainline",
);
equal(persistedMainlineState.mainlinePreferences[0].status, "mainline");
actionRuntime.applyMainlineAction("restore", localActionTarget);
equal(actionRuntime.publicReceiverState().sessionSuggestions.corrections.length, 0);
equal(
  actionRuntime.publicReceiverState().sessionSuggestions.mainlines.length,
  0,
  "restoring automatic judgment should remove a one-off explicit line",
);

const resetCreditPrivacyRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    accountStates: {
      "account-a": {
        id: "account-a",
        present: true,
        resetCredits: {
          reliable: true,
          updatedAt: "2026-08-12T08:59:00Z",
          credits: [{
            id: "provider-reset-credit-secret",
            status: "available",
            grantedAt: "2026-08-12T08:55:00Z",
            expiresAt: "2026-09-02T08:59:00Z",
          }],
        },
      },
    },
  },
);
const resetCreditPublicJSON = JSON.stringify(resetCreditPrivacyRuntime.publicReceiverState());
const resetCreditPersistedJSON = JSON.stringify(resetCreditPrivacyRuntime.runtime.state);
check(!resetCreditPublicJSON.includes("provider-reset-credit-secret"), "public state must omit raw reset-credit IDs");
check(!resetCreditPublicJSON.includes("credit-sha256:"), "public state must omit reset-credit aliases too");
check(!resetCreditPersistedJSON.includes("provider-reset-credit-secret"), "persisted state must never contain raw reset-credit IDs");
check(resetCreditPersistedJSON.includes("credit-sha256:"), "persisted state may retain only a one-way reset-credit alias");

let failShortLoad = false;
const resilientShortLoadRuntime = createRuntime(
  {
    buildModel() {
      return null;
    },
    pickUsage() {
      return null;
    },
    shortLoadEngine: {
      forecast() {
        if (failShortLoad) throw new Error("database busy");
        return shortLoadReceiver.usageShortLoad;
      },
    },
    writeState() {},
  },
  { usage: { latest: shortLoadCurrent } },
);
resilientShortLoadRuntime.refreshShortLoad(now);
equal(resilientShortLoadRuntime.publicReceiverState().usageShortLoad.status, "ready");
failShortLoad = true;
resilientShortLoadRuntime.refreshShortLoad(now + minute);
equal(
  resilientShortLoadRuntime.publicReceiverState().usageShortLoad.status,
  "stale",
  "a transient short-load failure should retain the latest reliable forecast",
);
close(
  resilientShortLoadRuntime.publicReceiverState().usageShortLoad.prediction.additionalMedian,
  1,
);

const migratedRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    currentEvent: {
      id: "finished-1",
      status: "personal-landed",
      personalLandedAt: "2026-08-13T01:12:00Z",
      personalEvidence: "usage-decreased",
    },
  },
);
const migratedState = migratedRuntime.publicReceiverState();
equal(migratedState.activeEpisode, null, "a landed v3 event must not remain active");
equal(migratedState.lastPersonalReset.eventId, "finished-1");
check(migratedState.closedEventIds.includes("finished-1"));

const bankedMigrationNow = Date.now();
const bankedMigrationID = "2090766694897619318";
const pollutedTrajectory = {
  version: 1,
  anchorAt: new Date(bankedMigrationNow - minute).toISOString(),
  anchorRemainingPercent: 0,
  naturalResetAt: new Date(bankedMigrationNow + 6 * day).toISOString(),
  cycleStartedAt: new Date(bankedMigrationNow - day).toISOString(),
  cycleResetAt: new Date(bankedMigrationNow + 6 * day).toISOString(),
  policyKind: "immediate",
  policyHazardPerHour: 0,
  policyDeadlineAt: null,
  policySource: "explicit-now",
  signalId: bankedMigrationID,
};
const bankedMigrationEvent = {
  id: bankedMigrationID,
  type: "reset",
  group: "reset",
  announcement_state: "announced",
  reset_verification_status: "pending",
  announced_at: new Date(bankedMigrationNow - minute).toISOString(),
  reason_tags: ["milestone", "banked"],
  summary: "A BANKED reset to use at your discretion.",
  url: `https://x.com/thsottiaux/status/${bankedMigrationID}`,
};
const bankedMigrationRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    cache: { feed: { events: [bankedMigrationEvent] } },
    activeEpisode: {
      id: bankedMigrationID,
      announcedAt: bankedMigrationEvent.announced_at,
      summary: bankedMigrationEvent.summary,
      url: bankedMigrationEvent.url,
      source: "site-api",
      status: "awaiting-personal",
      firstSeenAt: bankedMigrationEvent.announced_at,
    },
    targetTrajectory: pollutedTrajectory,
    accountStates: {
      "account-a": {
        id: "account-a",
        live: true,
        targetTrajectory: pollutedTrajectory,
        forecastNotification: { seeded: true },
        behaviorNotification: { seeded: true },
      },
    },
    activeAccountId: "account-a",
  },
);
const repairedBankedState = bankedMigrationRuntime.publicReceiverState();
equal(repairedBankedState.activeEpisode, null);
equal(repairedBankedState.bankedCampaign.id, bankedMigrationID);
equal(repairedBankedState.accounts[0].targetTrajectory, null);
equal(
  bankedMigrationRuntime.runtime.state.accountStates["account-a"].forecastNotification.seeded,
  undefined,
  "migration must clear only notification baselines polluted by the banked signal",
);
const repairedAgain = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  bankedMigrationRuntime.runtime.state,
).publicReceiverState();
equal(repairedAgain.bankedCampaign.id, bankedMigrationID, "banked migration must be idempotent");

const staleEpisodeRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    lastPersonalReset: {
      at: landedAt,
      cause: "global-manual",
      evidence: "usage-decreased",
      eventId: tiboEvent.id,
    },
    activeEpisode: {
      id: "1999999999999999991",
      announcedAt: "2026-08-11T00:27:44.842Z",
      summary: "It is done.",
      url: "https://x.com/thsottiaux/status/1999999999999999991",
      source: "atom",
      status: "awaiting-personal",
    },
  },
);
const staleEpisodeState = staleEpisodeRuntime.publicReceiverState();
equal(staleEpisodeState.version, 20);
equal(staleEpisodeState.activeEpisode, null, "migration must clear an already-settled episode");
equal(staleEpisodeState.signalSettlement.throughAt, landedAt);
check(
  staleEpisodeState.closedEventIds.includes("1999999999999999991"),
  "migration must remember the stale episode so a restart cannot revive it",
);

const completedConfirmationTrajectory = {
  version: 1,
  anchorAt: "2026-08-28T03:18:59.648Z",
  anchorRemainingPercent: 0,
  naturalResetAt: "2026-09-04T03:18:51.000Z",
  cycleStartedAt: "2026-08-28T03:18:51.000Z",
  cycleResetAt: "2026-09-04T03:18:51.000Z",
  policyKind: "immediate",
  policyHazardPerHour: 0,
  policyDeadlineAt: null,
  policySource: "explicit-now",
  signalId: completedConfirmationID,
};
const completedConfirmationRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    cache: {
      feed: conflictingCompletedFeed,
      forecast: completedConfirmationForecast,
    },
    activeEpisode: {
      id: completedConfirmationID,
      announcedAt: completedConfirmation.announced_at,
      summary: completedConfirmation.summary,
      localizedSummary: completedConfirmation.localized_summary,
      url: completedConfirmation.url,
      source: "site-api",
      status: "awaiting-personal",
      firstSeenAt: "2026-08-27T17:26:32.013Z",
      accountDelivery: { "account-a": "pending", "account-b": "pending" },
    },
    events: {
      globalSettledThroughAt: "2026-08-24T00:44:29.666Z",
      globalSettlementEventId: "2091412393368945027",
    },
    accountStates: {
      "account-a": {
        id: "account-a",
        live: true,
        present: true,
        cycleGeneration: 4,
        personalResets: [
          {
            at: "2026-08-27T16:25:36.000Z",
            cause: "global-manual",
            evidence: "forced-window-rebuilt:usage-decreased",
            eventId: null,
            generation: 4,
          },
        ],
        targetTrajectory: completedConfirmationTrajectory,
      },
      "account-b": {
        id: "account-b",
        present: true,
        cycleGeneration: 3,
        personalResets: [
          {
            at: "2026-08-27T16:25:39.000Z",
            cause: "global-manual",
            evidence: "forced-window-rebuilt:usage-decreased",
            eventId: null,
            generation: 3,
          },
        ],
        targetTrajectory: completedConfirmationTrajectory,
      },
    },
    activeAccountId: "account-a",
    selectedAccountId: "account-a",
    targetTrajectory: completedConfirmationTrajectory,
  },
);
const completedConfirmationState = completedConfirmationRuntime.publicReceiverState();
equal(
  completedConfirmationState.activeEpisode,
  null,
  "a completed public confirmation must not open a second reset after the local cycle already advanced",
);
equal(completedConfirmationState.signalSettlement.eventId, completedConfirmationID);
check(completedConfirmationState.closedEventIds.includes(completedConfirmationID));
equal(completedConfirmationState.accounts[0].lastPersonalReset.eventId, completedConfirmationID);
equal(completedConfirmationState.accounts[1].lastPersonalReset.eventId, completedConfirmationID);
equal(completedConfirmationState.accounts[0].targetTrajectory, null);
equal(completedConfirmationState.accounts[1].targetTrajectory, null);
equal(completedConfirmationState.completedPublicEvents[0].id, completedConfirmationID);
const correctedConfirmationNow = Date.parse("2026-08-28T03:50:00.000Z");
const correctedConfirmationModel = build(
  [
    {
      provider: "codex",
      accountId: "account-a",
      accountActive: true,
      accountLive: true,
      usage: {
        updatedAt: "2026-08-28T03:49:00.000Z",
        dataConfidence: "exact",
        secondary: {
          usedPercent: 1,
          windowMinutes: 10080,
          resetsAt: "2026-09-04T03:19:46.000Z",
        },
      },
    },
  ],
  completedConfirmationForecast,
  conflictingCompletedFeed,
  correctedConfirmationNow,
  completedConfirmationState,
);
equal(correctedConfirmationModel.forecast.signal.level, "none");
check(
  correctedConfirmationModel.decision.targetUsed > 30 &&
    correctedConfirmationModel.decision.targetUsed < 45,
  "the reconciled 1%-used account must return to an ordinary bounded 24-hour target",
);
check(
  correctedConfirmationModel.decision.targetUsed < 100,
  "a completed confirmation must not keep the fresh cycle at a 100% target",
);

const thresholdFreeConfirmationID = "2999999999999988888";
const thresholdFreeNow = Date.now();
const thresholdFreeResetAt = new Date(thresholdFreeNow - 5 * day).toISOString();
const thresholdFreeAnnouncedAt = new Date(thresholdFreeNow - minute).toISOString();
const thresholdFreeEvent = {
  id: thresholdFreeConfirmationID,
  type: "reset",
  group: "reset",
  summary: "The usage reset has landed. Brand new usage is available.",
  url: `https://x.com/thsottiaux/status/${thresholdFreeConfirmationID}`,
  announced_at: thresholdFreeAnnouncedAt,
  announcement_state: "announced",
  reset_verification_status: "confirmed",
};
const thresholdFreeRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    cache: { feed: { events: [thresholdFreeEvent] } },
    activeEpisode: {
      id: thresholdFreeConfirmationID,
      announcedAt: thresholdFreeAnnouncedAt,
      summary: thresholdFreeEvent.summary,
      url: thresholdFreeEvent.url,
      source: "site-api",
      status: "awaiting-personal",
      firstSeenAt: thresholdFreeAnnouncedAt,
    },
    accountStates: {
      "account-a": {
        id: "account-a",
        live: true,
        present: true,
        personalResets: [
          {
            at: thresholdFreeResetAt,
            cause: "global-manual",
            evidence: "forced-window-rebuilt:usage-decreased",
            eventId: null,
            generation: 1,
          },
        ],
      },
    },
    activeAccountId: "account-a",
  },
);
equal(
  thresholdFreeRuntime.publicReceiverState().activeEpisode,
  null,
  "causal episode matching must not depend on a fixed number of minutes between delivery and confirmation",
);

const partialCompletedID = "2999999999999988887";
const partialCompletedAt = new Date(Date.now() - minute).toISOString();
const partialCompletedEvent = {
  id: partialCompletedID,
  type: "reset",
  group: "reset",
  summary: "The usage reset has landed. Brand new usage is available.",
  url: `https://x.com/thsottiaux/status/${partialCompletedID}`,
  announced_at: partialCompletedAt,
  announcement_state: "announced",
  reset_verification_status: "confirmed",
};
const partialCompletedRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    cache: { feed: { events: [partialCompletedEvent] } },
    activeEpisode: {
      id: partialCompletedID,
      announcedAt: partialCompletedAt,
      summary: partialCompletedEvent.summary,
      url: partialCompletedEvent.url,
      source: "site-api",
      status: "awaiting-personal",
      firstSeenAt: partialCompletedAt,
    },
    accountStates: {
      "account-a": {
        id: "account-a",
        live: true,
        present: true,
        personalResets: [
          {
            at: new Date(Date.now() - day).toISOString(),
            cause: "global-manual",
            evidence: "forced-window-rebuilt:usage-decreased",
            eventId: null,
            generation: 1,
          },
        ],
      },
      "account-b": { id: "account-b", present: true, personalResets: [] },
    },
    activeAccountId: "account-a",
  },
);
const partialCompletedState = partialCompletedRuntime.publicReceiverState();
equal(partialCompletedState.activeEpisode.account_delivery["account-a"], "landed");
equal(partialCompletedState.activeEpisode.account_delivery["account-b"], "pending");
equal(
  partialCompletedState.activeEpisode.temporal_phase,
  "in-progress",
  "a completed public event becomes in-progress delivery only for accounts whose generation has not advanced",
);
equal(partialCompletedState.activeEpisode.public_temporal_phase, "completed");

const staleReplay = staleEpisodeRuntime.processEvent(
  {
    id: "1999999999999999992",
    announcedAt: "2026-08-11T00:28:16.000Z",
    summary: "Usage limits have been reset.",
    url: "https://x.com/thsottiaux/status/1999999999999999992",
    source: "site-api",
  },
  { notify: false },
);
equal(staleReplay.event, null);
equal(
  staleEpisodeRuntime.publicReceiverState().activeEpisode,
  null,
  "a delayed Feed or Atom replay must not recreate a settled episode",
);

const orderedRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {},
);
const orderedNow = Date.now();
const bankedOrderingRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {},
);
const newerBankedID = "2999999999999999997";
const olderBankedID = "2999999999999999996";
for (const [id, offset] of [[newerBankedID, 1], [olderBankedID, 2]]) {
  bankedOrderingRuntime.processEvent(
    {
      id,
      announcedAt: new Date(orderedNow - offset * minute).toISOString(),
      summary: "A BANKED reset to use at your discretion.",
      reasonTags: ["banked"],
      url: `https://x.com/thsottiaux/status/${id}`,
      source: "site-api",
    },
    { notify: false },
  );
}
equal(bankedOrderingRuntime.publicReceiverState().activeEpisode, null);
equal(
  bankedOrderingRuntime.publicReceiverState().bankedCampaign.id,
  newerBankedID,
  "a delayed older banked announcement must not replace the current campaign",
);

orderedRuntime.processEvent(
  {
    id: "2999999999999999999",
    announcedAt: new Date(orderedNow - minute).toISOString(),
    summary: "Newer reset event",
    url: "https://x.com/thsottiaux/status/2999999999999999999",
    source: "site-api",
  },
  { notify: false },
);
orderedRuntime.processEvent(
  {
    id: "2999999999999999998",
    announcedAt: new Date(orderedNow - 2 * minute).toISOString(),
    summary: "Older delayed event",
    url: "https://x.com/thsottiaux/status/2999999999999999998",
    source: "atom",
  },
  { notify: false },
);
equal(
  orderedRuntime.publicReceiverState().activeEpisode.id,
  "2999999999999999999",
  "an out-of-order event must not replace a newer active episode",
);
check(orderedRuntime.publicReceiverState().closedEventIds.includes("2999999999999999998"));

equal(
  trustedExplicitEvent({
    id: "newer-explicit",
    announcedAt: new Date(orderedNow - minute).toISOString(),
    url: "https://x.com/thsottiaux/status/2999999999999999999",
    source: "site-api",
  }),
  false,
  "a fixture-style ID must never qualify as a real Tibo event",
);
const untrustedRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {},
);
equal(
  untrustedRuntime.processEvent(
    {
      id: "newer-explicit",
      announcedAt: new Date(orderedNow - minute).toISOString(),
      summary: "Synthetic test fixture",
      source: "site-api",
    },
    { notify: false },
  ).event,
  null,
  "an untrusted event must not enter the active episode state",
);
equal(untrustedRuntime.publicReceiverState().activeEpisode, null);

const pollutedStateRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  {
    activeEpisode: {
      id: "newer-explicit",
      announcedAt: new Date(orderedNow - minute).toISOString(),
      summary: "Synthetic test fixture",
      source: "site-api",
    },
    events: {
      lastEventId: "newer-explicit",
      lastEventAt: new Date(orderedNow - minute).toISOString(),
    },
  },
);
equal(
  pollutedStateRuntime.publicReceiverState().activeEpisode,
  null,
  "loading a previously polluted state must quarantine its synthetic episode",
);
equal(
  pollutedStateRuntime.runtime.state.events.lastEventId,
  null,
  "an untrusted fixture must not remain as the event-ordering boundary",
);
check(
  pollutedStateRuntime.runtime.state.events.rejectedEvents.some(
    (entry) => entry.id === "newer-explicit" && entry.reason === "untrusted-event-identity",
  ),
  "state repair should retain a local diagnostic for the quarantined fixture",
);

function currentSiteEpisode(id, firstSeenOffsetMinutes = 1) {
  return {
    id,
    announcedAt: new Date(orderedNow - 2 * minute).toISOString(),
    summary: "A real-looking reset announcement",
    url: `https://x.com/thsottiaux/status/${id}`,
    source: "site-api",
    status: "awaiting-personal",
    firstSeenAt: new Date(orderedNow - firstSeenOffsetMinutes * minute).toISOString(),
  };
}

const missedNotificationEventID = "2888888888888888884";
const recoveredNotifications = [];
const missedNotificationRuntime = createRuntime(
  {
    buildModel() { return null; },
    pickUsage() { return null; },
    sendNativeNotification(subtitle, body) {
      recoveredNotifications.push({ subtitle, body });
    },
  },
  {
    activeEpisode: currentSiteEpisode(missedNotificationEventID),
    events: { seenIds: [missedNotificationEventID] },
  },
);
equal(
  missedNotificationRuntime.recoverMissedExplicitNotification(),
  true,
  "an unresolved explicit announcement that was seen but never delivered must be recovered once",
);
equal(recoveredNotifications.length, 1);
equal(
  missedNotificationRuntime.publicReceiverState().notificationDelivery.lastReason,
  "global-catch-up",
);
check(
  missedNotificationRuntime.runtime.state.events.notifiedForcedEventIds.includes(
    missedNotificationEventID,
  ),
  "the recovered event must be persisted in the private notification dedupe set",
);
equal(
  missedNotificationRuntime.recoverMissedExplicitNotification(),
  false,
  "restarting after a recovered delivery must not notify the same explicit event again",
);
equal(recoveredNotifications.length, 1);

const rejectedRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  { activeEpisode: currentSiteEpisode("2888888888888888881") },
);
const rejectedReconciliation = reconcileActiveEpisodeState(
  rejectedRuntime.runtime.state,
  {
    events: [
      {
        id: "2888888888888888881",
        reset_verification_status: "rejected",
      },
    ],
  },
  orderedNow,
  { feedSucceeded: true },
);
equal(rejectedReconciliation.reason, "website-rejected");
equal(rejectedRuntime.publicReceiverState().activeEpisode, null);

const confirmedRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  { activeEpisode: currentSiteEpisode("2888888888888888882") },
);
reconcileActiveEpisodeState(
  confirmedRuntime.runtime.state,
  {
    events: [
      {
        id: "2888888888888888882",
        reset_verification_status: "confirmed",
      },
    ],
  },
  orderedNow,
  { feedSucceeded: true },
);
equal(
  confirmedRuntime.publicReceiverState().activeEpisode.id,
  "2888888888888888882",
  "a globally confirmed event must remain open until the personal quota lands",
);

const missingRuntime = createRuntime(
  { buildModel() { return null; }, pickUsage() { return null; } },
  { activeEpisode: currentSiteEpisode("2888888888888888883", 16) },
);
equal(
  reconcileActiveEpisodeState(missingRuntime.runtime.state, { events: [] }, orderedNow, {
    feedSucceeded: true,
  }).reason,
  "missing-from-fresh-feed",
  "a site-only event missing from a fresh feed must be withdrawn after the grace period",
);
equal(missingRuntime.publicReceiverState().activeEpisode, null);

let injectedWrites = 0;
const persistedRuntime = createRuntime(
  {
    buildModel() { return null; },
    pickUsage() { return null; },
    writeState() { injectedWrites += 1; },
  },
  {},
);
persistedRuntime.processEvent(
  {
    id: "2888888888888888884",
    announcedAt: new Date(orderedNow - minute).toISOString(),
    summary: "Injected persistence test",
    url: "https://x.com/thsottiaux/status/2888888888888888884",
    source: "atom",
  },
  { notify: false },
);
check(injectedWrites > 0, "persistence must work only through an explicitly injected writer");

const settlementState = { events: {}, personalResets: [] };
advanceGlobalSettlement(settlementState, {
  at: landedAt,
  cause: "global-manual",
  eventId: tiboEvent.id,
});
equal(globalSettlementFromState(settlementState).throughAt, landedAt);
equal(
  eventSettledByState(settlementState, {
    id: previousHint.id,
    announcedAt: previousHint.announced_at,
  }),
  false,
  "a timestamp alone cannot settle a different event",
);
equal(eventSettledByState(settlementState, { id: tiboEvent.id }), true);
equal(eventSettledByState({ events: { globalSettledThroughAt: watchSettledAt,
  globalSettlementEventId: watchResetID } }, watchForecast.official_signal), false);
equal(
  eventSettledByState(settlementState, {
    id: futureWindowHint.id,
    announcedAt: futureWindowHint.announced_at,
    windowStartAt: futureWindowHint.official_window.start_at,
  }),
  false,
  "the monitor must preserve the same structured-future exception as the provider",
);
advanceGlobalSettlement(settlementState, {
  at: "2026-08-20T03:31:25Z",
  cause: "automatic",
  eventId: null,
});
equal(
  globalSettlementFromState(settlementState).throughAt,
  landedAt,
  "automatic resets must not advance the global settlement line",
);

check(provider, "provider manifest was captured");
equal(provider.icon.monogram, "✦");
equal(provider.icon.tint, "#A78BFA");
assert.deepEqual(JSON.parse(JSON.stringify(provider.endpoints)), [
  "https://codex-reset.com",
  { setting: "CODEX_RESET_SIGNAL_BASE_URL", policy: "https-only" },
  { setting: "CODEXBAR_BRIDGE_URL", policy: "https-or-loopback-http" },
]);
checks += 1;

const seenURLs = [];
const providerRankedBase = rankedSessions.candidates.map(({ id, ...candidate }) => candidate);
const providerSessionCandidates = [
  {
    ...providerRankedBase[0],
    title: "Remove author information",
  },
  providerRankedBase[1],
  {
    actionId: "session-capacity-planner",
    title: "Continue capacity planner UI",
    project: "CodexReset",
    lastActiveAt: new Date(now - 12 * minute).toISOString(),
    pinned: false,
    goalStatus: "active",
    observedTokens: 520,
    workspaceRank: 3,
    workspaceObservedTokens: 520,
    workspaceSharePercent: 12,
    reason: "近 24 小时工作区活跃度第 3 · Goal 仍在进行",
  },
  {
    actionId: "session-embodied",
    title: "Review embodied experiments",
    project: "Embodied26",
    lastActiveAt: new Date(now - 20 * minute).toISOString(),
    pinned: false,
    goalStatus: null,
    observedTokens: 360,
    workspaceRank: 4,
    workspaceObservedTokens: 360,
    workspaceSharePercent: 8,
    reason: "近 24 小时工作区活跃度第 4",
  },
  {
    actionId: "session-course-notes",
    title: "Finish course notes",
    project: "26fall_courses",
    lastActiveAt: new Date(now - 25 * minute).toISOString(),
    pinned: false,
    goalStatus: null,
    observedTokens: 240,
    workspaceRank: 5,
    workspaceObservedTokens: 240,
    workspaceSharePercent: 5,
    reason: "近 24 小时工作区活跃度第 5",
  },
  providerRankedBase[2],
];
const providerMainlines = [
  {
    actionId: "mainline-explicit-planner",
    label: "CodexReset · 容量规划",
    project: "CodexReset",
    lastActiveAt: new Date(now - 12 * minute).toISOString(),
    source: "explicit",
    confidence: "high",
    sessionCount: 1,
    activeDayCount: 1,
    observedTokens: 5,
    loadSharePercent: 1,
    goalStatus: null,
    reason: "你已明确标为主线",
  },
  {
    actionId: "mainline-paper",
    label: "research-workspace · 论文",
    project: "research-workspace",
    lastActiveAt: new Date(now - hour).toISOString(),
    source: "inferred",
    confidence: "high",
    sessionCount: 4,
    activeDayCount: 5,
    observedTokens: 1_000,
    loadSharePercent: 40,
    goalStatus: "active",
    reason: "Goal 仍在进行，且已跨 5 天持续推进",
  },
  {
    actionId: "mainline-embodied",
    label: "Embodied26 · 机器人",
    project: "Embodied26",
    lastActiveAt: new Date(now - 2 * hour).toISOString(),
    source: "inferred",
    confidence: "high",
    sessionCount: 3,
    activeDayCount: 4,
    observedTokens: 800,
    loadSharePercent: 30,
    goalStatus: null,
    reason: "3 条相关任务跨 4 天持续推进",
  },
  {
    actionId: "mainline-course",
    label: "26fall_courses · 课程",
    project: "26fall_courses",
    lastActiveAt: new Date(now - 3 * hour).toISOString(),
    source: "inferred",
    confidence: "medium",
    sessionCount: 2,
    activeDayCount: 2,
    observedTokens: 600,
    loadSharePercent: 20,
    goalStatus: null,
    reason: "2 条相关任务跨 2 天持续推进",
  },
  {
    actionId: "mainline-analysis",
    label: "analysis · 实验",
    project: "analysis",
    lastActiveAt: new Date(now - 4 * hour).toISOString(),
    source: "inferred",
    confidence: "medium",
    sessionCount: 2,
    activeDayCount: 2,
    observedTokens: 400,
    loadSharePercent: 9,
    goalStatus: null,
    reason: "2 条相关任务跨 2 天持续推进",
  },
];
const groupedProviderWorkspaces = workspaceSuggestions({ candidates: providerSessionCandidates });
equal(groupedProviderWorkspaces.length, 5, "temporary sessions must collapse into workspaces");
equal(groupedProviderWorkspaces[0].project, "research-workspace");
equal(groupedProviderWorkspaces[0].recentActivities.length, 2);
check(
  groupedProviderWorkspaces[0].recentActivities.some(
    (activity) => activity.title === "Remove author information",
  ),
  "a temporary session may remain local activity evidence without becoming the recommendation",
);
const receiverState = {
  push: { registered: true, registeredAt: "2026-08-12T08:00:00Z" },
  health: {
    lastFeedSuccessAt: "2026-08-12T08:59:00Z",
    lastUsageSuccessAt: "2026-08-12T08:59:00Z",
  },
  notificationDelivery: {
    lastAttemptAt: "2026-08-12T08:58:00Z",
    lastSuccessAt: "2026-08-12T08:58:00Z",
    lastReason: "global",
    lastStatus: "sent",
    lastErrorKind: null,
  },
  currentEvent: null,
  targetTrajectory: targetTrajectoryFixture,
  usageSnapshot: {
    usedPercent: 10,
    windowMinutes: 10080,
    resetsAt: "2026-08-18T09:00:00Z",
    updatedAt: "2026-08-12T08:59:00Z",
    exact: true,
  },
  ...paceReceiver,
  ...shortLoadReceiver,
  usageBehavior,
  sessionSuggestions: {
    status: "ready",
    cycleStartAt: new Date(sessionStart).toISOString(),
    trendWindowStartAt: new Date(now - day).toISOString(),
    trendWindowHours: 24,
    tokenSource: "cost-ledger",
    observationStartedAt: new Date(now - 3 * hour).toISOString(),
    updatedAt: new Date(now - minute).toISOString(),
    candidateCount: providerSessionCandidates.length,
    workspaceCount: 5,
    mainlineCount: providerMainlines.length,
    observationReady: true,
    mainlines: providerMainlines,
    corrections: [{
      targetId: "mainline-explicit-planner",
      kind: "mainline",
      status: "mainline",
      label: "CodexReset · 容量规划",
      project: "CodexReset",
      updatedAt: new Date(now - minute).toISOString(),
    }],
    candidates: providerSessionCandidates,
  },
  cache: { forecast: forecastFixture(), feed: { stale: false, signal: null, events: [] } },
};
const ctx = {
  http: {
    async getJSON(url) {
      seenURLs.push(url);
      if (url === "http://127.0.0.1:18765/usage?provider=codex") return { json: usagePayload };
      if (url === "http://127.0.0.1:18765/api/state") return { json: receiverState };
      throw new Error(`Unexpected URL: ${url}`);
    },
  },
  settings: {
    get(key) {
      return key === "CODEXBAR_BRIDGE_URL" ? "http://127.0.0.1:18765" : "";
    },
  },
  date: { now: () => new Date(now) },
  fail: { parseFailure: (message) => new Error(message) },
  log() {},
};

(async () => {
  const liveNow = Date.now();
  const liveReset = new Date(liveNow + 6 * day).toISOString();
  const liveUpdated = new Date(liveNow - minute).toISOString();
  let liveAccounts = [
    {
      provider: "codex",
      account: "first@example.test",
      cacheAccountKey: "codex:stored:first",
      accountActive: true,
      accountLive: false,
      usage: {
        updatedAt: liveUpdated,
        dataConfidence: "exact",
        identity: { accountEmail: "first@example.test", loginMethod: "plus" },
        secondary: { usedPercent: 40, windowMinutes: 10080, resetsAt: liveReset },
      },
    },
    {
      provider: "codex",
      account: "second@example.test",
      cacheAccountKey: "codex:stored:second",
      accountActive: false,
      accountLive: true,
      usage: {
        updatedAt: liveUpdated,
        dataConfidence: "exact",
        identity: { accountEmail: "second@example.test", loginMethod: "pro" },
        secondary: { usedPercent: 25, windowMinutes: 10080, resetsAt: liveReset },
      },
    },
  ];
  const originalFetch = global.fetch;
  global.fetch = async () => ({ ok: true, json: async () => liveAccounts });
  const multiRuntime = createRuntime(
    {
      buildModel: build,
      pickUsage: parseUsage,
      pickUsages: parseUsages,
      writeState() {},
    },
    { cache: { forecast: forecastFixture(), feed: { stale: false, signal: null, events: [] } } },
  );
  await multiRuntime.refreshUsage({ startup: true });
  const firstActiveID = multiRuntime.runtime.state.activeAccountId;
  liveAccounts = liveAccounts.map((record, index) => ({ ...record, accountActive: index === 0 }));
  await multiRuntime.refreshUsage({ startup: true });
  equal(
    multiRuntime.runtime.state.activeAccountId,
    firstActiveID,
    "changing the CodexBar viewed account must not change the current login",
  );
  liveAccounts = liveAccounts.map((record, index) => ({ ...record, accountLive: index === 0 }));
  await multiRuntime.refreshUsage({ startup: true });
  check(
    multiRuntime.runtime.state.activeAccountId !== firstActiveID,
    "changing the live Codex login must move the main recommendation to that account",
  );
  equal(Object.keys(multiRuntime.runtime.state.accountStates).length, 2);
  equal(
    multiRuntime.runtime.state.lastPersonalReset,
    null,
    "an account switch with unchanged per-account windows must not look like a reset",
  );
  const upgradedReset = new Date(liveNow + 7 * day).toISOString();
  liveAccounts = liveAccounts.map((record, index) =>
    index === 0
      ? {
          ...record,
          usage: {
            ...record.usage,
            updatedAt: new Date(liveNow).toISOString(),
            identity: { ...record.usage.identity, loginMethod: "pro" },
            secondary: { ...record.usage.secondary, usedPercent: 2, resetsAt: upgradedReset },
          },
        }
      : record,
  );
  await multiRuntime.refreshUsage({ startup: true });
  equal(
    multiRuntime.runtime.state.lastPersonalReset.cause,
    "upgrade",
    "a paid-tier increase is classified only after the account window actually refreshes",
  );
  global.fetch = originalFetch;

  const staleTokenRuntime = createRuntime(
    {
      buildModel() {
        return null;
      },
      pickUsage() {
        return null;
      },
      readSessionRows() {
        return [];
      },
      readRecentSessionTokenRows() {
        throw new Error("cost ledger busy");
      },
      readGoalRows() {
        return [];
      },
      writeState() {},
    },
    {
      sessions: {
        ...rankedSessions,
        status: "ready",
        updatedAt: new Date(now).toISOString(),
      },
    },
  );
  staleTokenRuntime.refreshSessions();
  equal(staleTokenRuntime.publicReceiverState().sessionSuggestions.status, "stale");
  equal(
    staleTokenRuntime.publicReceiverState().sessionSuggestions.candidates[0].title,
    "Recent ordinary task",
    "a busy exact token ledger should retain the latest reliable recovery context",
  );

  const failingSessionRuntime = createRuntime(
    {
      buildModel() {
        return null;
      },
      pickUsage() {
        return null;
      },
      readSessionRows() {
        throw new Error("database busy");
      },
      readGoalRows() {
        return [];
      },
      writeState() {},
    },
    {
      sessions: {
        ...rankedSessions,
        status: "ready",
        updatedAt: new Date(now).toISOString(),
      },
    },
  );
  let sessionRefreshFailed = false;
  try {
    failingSessionRuntime.refreshSessions();
  } catch {
    sessionRefreshFailed = true;
  }
  check(sessionRefreshFailed, "a failed local session read should be surfaced internally");
  equal(
    failingSessionRuntime.publicReceiverState().sessionSuggestions.status,
    "stale",
    "a transient session database failure should retain the latest reliable candidates",
  );
  equal(
    failingSessionRuntime.publicReceiverState().sessionSuggestions.candidateCount,
    3,
    "a session database failure must not erase the latest reliable candidate list",
  );

  const watchSnapshot = await provider.fetchUsage({
    ...ctx,
    http: { async getJSON(url) {
      if (url.endsWith("/api/state")) return { json: { ...watchReceiver,
        cache: { forecast: watchForecast, feed: { events: [] } } } };
      if (url.includes("/usage?")) return { json: watchUsage };
      throw new Error(`Unexpected synthetic Watch URL: ${url}`);
    } },
  });
  const watchRootRow = watchSnapshot.details[0].rows.find((row) => row.label === "重置");
  check(watchRootRow.value.includes("最晚") && watchRootRow.value.endsWith("前"));
  equal(watchRootRow.relativeTimeAt, null, "a deadline must not alternate into 'reset in N hours'");
  const watchTimeline = watchSnapshot.submenuDetails.find((section) => section.title === "重置")
    .visualizations.find((item) => item.kind === "timeline").items
    .find((item) => item.kind === "commitment");
  equal(watchTimeline.at, watchDeadline);
  equal(watchTimeline.endAt, null);
  equal(watchTimeline.timingKind, "deadline");
  check(!/未来 24 小时/.test(watchSnapshot.decisionProgress.title),
    "a 26-hour commitment target must not masquerade as the 24-hour target");
  const watchAccountBars = watchSnapshot.submenuDetails.find((section) => section.title === "用量与目标")
    .rows.filter((row) => row.progress);
  check(watchAccountBars.length === 2 && watchAccountBars.every((row) => row.progress.targetPercent > 90));
  check(watchSnapshot.submenuDetails.find((section) => section.title === "计算与数据").rows
    .some((row) => row.label === "源站时间语义" && row.value.startsWith("deadline")));

  const snapshot = await provider.fetchUsage(ctx);
  equal(snapshot.details.length, 1);
  equal(snapshot.details[0].title, "现在");
  equal(
    snapshot.details[0].rows.length,
    8,
    "a projected shortfall should show the decision, five mainlines, account and reset context",
  );
  equal(snapshot.details[0].rows[0].label, "建议");
  equal(snapshot.details[0].rows[1].label, "主线 1");
  equal(snapshot.details[0].rows[2].label, "主线 2");
  equal(snapshot.details[0].rows[3].label, "主线 3");
  equal(snapshot.details[0].rows[4].label, "主线 4");
  equal(snapshot.details[0].rows[5].label, "主线 5");
  equal(snapshot.details[0].rows[6].label, "账户");
  equal(snapshot.details[0].rows[7].label, "重置");
  check(
    /优先继续以下 5 条可靠主线/.test(
      snapshot.details[0].rows.find((row) => row.label === "建议").value,
    ),
    "a fully-right red target should name five logical-mainline recommendations",
  );

  const offlineSnapshot = await provider.fetchUsage({
    ...ctx,
    http: {
      async getJSON(url) {
        if (url === "http://127.0.0.1:18765/usage?provider=codex") {
          return { json: usagePayload };
        }
        if (url === "http://127.0.0.1:18765/api/state") {
          return { json: { ...receiverState, cache: {} } };
        }
        throw new Error("signal service offline");
      },
    },
  });
  check(
    offlineSnapshot.details[0].rows.some((row) => row.label === "建议"),
    "a first-run signal outage must retain local natural-reset planning",
  );
  check(
    /自然使用趋势仍可能达不到目标/.test(
      snapshot.details[0].rows.find((row) => row.label === "建议").secondaryValue,
    ),
    "the main recommendation should explain the red/blue geometry in plain language",
  );
  check(
    !snapshot.details[0].rows.some((row) =>
      ["未来 1 小时", "可考虑续跑", "当前位置", "目标由来"].includes(row.label),
    ),
    "forecast, session, position and target derivation should not duplicate the progress bar on the main card",
  );
  check(snapshot.decisionProgress, "the provider must emit the native decision bar");
  equal(
    snapshot.decisionProgress.alternateTitle,
    "近期使用计划 · 未来 24 小时",
    "the fixed planning horizon must alternate in the same title slot",
  );
  close(snapshot.decisionProgress.currentPercent, 10);
  close(snapshot.decisionProgress.targetPercent, 47.5);
  close(snapshot.decisionProgress.projectedPercent, 32);
  close(snapshot.decisionProgress.projectedLowerPercent, 22);
  close(snapshot.decisionProgress.projectedUpperPercent, 46);
  check(
    /预计 22\.0%–46\.0% · 中心 32\.0%/.test(snapshot.decisionProgress.projectedLabel),
    "the blue marker and interval must describe the calibrated natural forecast",
  );
  const fastPathURLs = [];
  const fastPathSnapshot = await provider.fetchUsage({
    ...ctx,
    http: {
      async getJSON(url) {
        fastPathURLs.push(url);
        if (url === "http://127.0.0.1:18765/api/snapshot") return { json: snapshot };
        throw new Error(`Unexpected URL: ${url}`);
      },
    },
  });
  equal(fastPathSnapshot.decisionProgress.targetPercent, snapshot.decisionProgress.targetPercent);
  assert.deepEqual(fastPathURLs, ["http://127.0.0.1:18765/api/snapshot"]);
  checks += 1;
  const staleUsagePayload = JSON.parse(JSON.stringify(usagePayload));
  staleUsagePayload[0].usage.updatedAt = new Date(now - 30 * minute).toISOString();
  const staleUsageSnapshot = await provider.fetchUsage({
    ...ctx,
    http: {
      async getJSON(url) {
        if (url === "http://127.0.0.1:18765/usage?provider=codex") {
          return { json: staleUsagePayload };
        }
        if (url === "http://127.0.0.1:18765/api/state") return { json: receiverState };
        throw new Error(`Unexpected URL: ${url}`);
      },
    },
  });
  check(
    staleUsageSnapshot.decisionProgress,
    "stale personal quota must retain a clearly-labelled last-reliable progress bar",
  );
  close(staleUsageSnapshot.decisionProgress.currentPercent, 10);
  close(staleUsageSnapshot.decisionProgress.targetPercent, 47.5);
  check(/最近可靠计划/.test(staleUsageSnapshot.decisionProgress.title));
  check(/最近可靠值/.test(staleUsageSnapshot.decisionProgress.currentLabel));
  check(
    staleUsageSnapshot.details[0].rows.some((row) => row.label === "建议暂不可用"),
    "stale quota may remain visible but must not become an actionable recommendation",
  );
  check(
    snapshot.details[0].rows.some(
      (row) => row.label === "重置" && /下次自然刷新/.test(row.value),
    ),
    "the automatic weekly refresh should remain visible",
  );
  const resetHomeRow = snapshot.details[0].rows.find((row) => row.label === "重置");
  equal(Date.parse(resetHomeRow.relativeTimeAt), Date.parse(usagePayload[0].usage.secondary.resetsAt));
  equal(resetHomeRow.relativeTimePrefix, "下次自然刷新 · ");
  check(
    snapshot.details[0].rows.some(
      (row) => row.label === "主线 1" && row.value === "CodexReset · 容量规划",
    ),
    "an explicit low-token mainline must remain ahead of inferred high-token work",
  );
  check(
    !snapshot.details[0].rows.some((row) => /Remove author information/.test(row.value)),
    "a temporary session title must never become a main recommendation",
  );
  const suggestedMainlinesSection = snapshot.submenuDetails.find(
    (section) => section.title === "建议主线",
  );
  check(
    suggestedMainlinesSection.rows.some(
      (row) =>
        row.label === "近期 session（仅供定位）" &&
        /Remove author information/.test(row.value) &&
        /不会直接进入推荐/.test(row.secondaryValue) &&
        row.actions.some((action) => action.operation === "mark-mainline"),
    ),
    "session titles may appear only as recovery context with explicit correction actions",
  );
  const mainlineDetailRow = suggestedMainlinesSection.rows.find(
    (row) => row.label === "主线 1",
  );
  equal(
    mainlineDetailRow.actions.map((action) => action.operation).join(","),
    "snooze,not-mainline,complete",
    "every recommended mainline should expose reversible local correction actions",
  );
  equal(snapshot.submenuDetails[0].title, "建议主线");
  equal(snapshot.submenuDetails[1].title, "用量与目标");
  equal(snapshot.submenuDetails[2].title, "重置");
  equal(snapshot.submenuDetails[3].title, "为什么这样建议");
  equal(snapshot.submenuDetails[4].title, "计算与数据");
  const resetTimeline = snapshot.submenuDetails[2].visualizations.find(
    (visualization) => visualization.kind === "timeline",
  );
  const nextResetTimelineItem = resetTimeline.items.find(
    (item) => item.kind === "natural" && item.state === "scheduled",
  );
  equal(
    Date.parse(nextResetTimelineItem.at),
    Date.parse(usagePayload[0].usage.secondary.resetsAt),
  );
  equal(
    snapshot.submenuDetails[2].rows.some((row) => row.label === "下次自然刷新"),
    false,
    "the natural reset belongs on the root timeline rather than a duplicate text row",
  );
  check(
    suggestedMainlinesSection.rows.some(
      (row) =>
        row.label === "主线排序原则" &&
        /token 只描述负载/.test(row.secondaryValue) &&
        /把握不足的任务会主动缺席/.test(row.secondaryValue),
    ),
    "the recommendation evidence must separate intent ranking from token load",
  );
  equal(snapshot.mainlineCorrections.length, 1);
  const sparseReceiverState = {
    ...receiverState,
    sessionSuggestions: {
      ...receiverState.sessionSuggestions,
      mainlineCount: 2,
      mainlines: providerMainlines.slice(0, 2),
    },
  };
  const sparseSnapshot = await provider.fetchUsage({
    ...ctx,
    http: {
      async getJSON(url) {
        if (url === "http://127.0.0.1:18765/usage?provider=codex") return { json: usagePayload };
        if (url === "http://127.0.0.1:18765/api/state") return { json: sparseReceiverState };
        throw new Error("snapshot fast path unavailable");
      },
    },
  });
  equal(
    sparseSnapshot.details[0].rows.filter((row) => /^主线 \d+$/.test(row.label)).length,
    2,
    "five is a maximum; a sparse reliable set must not be filled with sessions",
  );
  check(
    /不会用临时 session 凑满/.test(
      sparseSnapshot.details[0].rows.find((row) => row.label === "建议").secondaryValue,
    ),
    "the plan should explain why fewer than the maximum are shown",
  );
  const whySection = snapshot.submenuDetails.find(
    (section) => section.title === "为什么这样建议",
  );
  const calculationSection = snapshot.submenuDetails.find(
    (section) => section.title === "计算与数据",
  );
  check(
    calculationSection.rows.some((row) => row.label === "未来 1 小时负载"),
    "the one-hour session model should lead the expanded plan evidence",
  );
  check(
    calculationSection.rows.some((row) => row.label === "近期使用速度"),
    "the evidence must show the measured pace and how it was derived",
  );
  check(
    calculationSection.rows.some((row) => row.label === "自然使用预测"),
    "the model range should be available in plan details",
  );
  check(
    calculationSection.rows.some((row) => row.group === "calculation-result") &&
      calculationSection.rows.some((row) => row.group === "calculation-basis") &&
      calculationSection.rows.some((row) => row.group === "calculation-raw") &&
      !calculationSection.rows.some((row) => ["calculation", "work", "data"].includes(row.group)),
    "Calculation & Data must be separated into results, method and raw inputs",
  );
  check(
    calculationSection.rows.some(
      (row) => row.label === "通知投递" && /已交给 macOS/.test(row.value) && /明确强制重置公告/.test(row.secondaryValue),
    ),
    "the explanation view must expose the latest local notification delivery result",
  );
  equal(
    whySection.rows.filter((row) => row.group === "summary").map((row) => row.label).join("→"),
    "为什么→所以",
    "the explanation must answer why in plain language before showing the action",
  );
  check(
    whySection.rows.some(
      (row) =>
        row.group === "summary" &&
        row.label === "为什么" &&
        /当前用量还没有达到本轮目标/.test(row.value) &&
        /没有未兑现的官方/.test(row.value),
    ),
    "the causal summary must mention the actual quota and reset-signal state without leading with numbers",
  );
  check(
    !snapshot.submenuDetails.some((section) => section.title === "数据状态"),
    "data status must not remain a peer navigation concept",
  );
  const historySection = snapshot.submenuDetails.find(
    (section) => section.title === "重置",
  );
  check(
    historySection.rows.some((row) => row.label === "最近一次刷新"),
    "the unified reset center must default to the latest classified refresh",
  );

  const providerTeaseForecast = {
    ...forecastFixture("2026-08-12T08:58:00Z"),
    probabilities: {
      rounded_24h: 30,
      rounded_48h: 50,
      commitment_floor_percent: null,
      signal_percent: 50,
    },
    teased_window: {
      tweet_id: "2093551005711679011",
      summary: "Synthetic contextual hint: soon, but not today",
      url: "https://x.com/thsottiaux/status/2093551005711679011",
      at: "2026-08-12T08:10:00.000Z",
      window: {
        label: "end of the next day",
        start_at: "2026-08-12T09:30:00.000Z",
        end_at: "2026-08-13T08:59:59.999Z",
        time_zone: "UTC",
      },
      score: { band: "tease", value: 50, modifiers: [] },
    },
  };
  const teaserReceiverState = {
    ...receiverState,
    lastPersonalReset: {
      at: "2026-08-10T09:00:00.000Z",
      cause: "automatic",
      eventId: null,
    },
    personalResets: [{
      at: "2026-08-10T09:00:00.000Z",
      cause: "automatic",
      eventId: null,
    }],
    cache: {
      forecast: providerTeaseForecast,
      feed: { stale: false, signal: null, events: [], tweets: [] },
    },
  };
  const teaserSnapshot = await provider.fetchUsage({
    ...ctx,
    http: {
      async getJSON(url) {
        if (url === "http://127.0.0.1:18765/usage?provider=codex") return { json: usagePayload };
        if (url === "http://127.0.0.1:18765/api/state") return { json: teaserReceiverState };
        throw new Error("snapshot fast path unavailable");
      },
    },
  });
  const teaserHomeReset = teaserSnapshot.details[0].rows.find((row) => row.label === "重置");
  check(
    /可能重置 · .+（UTC\+8）/.test(teaserHomeReset.value) &&
      !/暗示|可能在|刷新（/.test(teaserHomeReset.value),
    "the structured tease must outrank the natural refresh with a compact, complete UTC+8 summary",
  );
  check(
    /Tibo 说“很快，但不是今天”/.test(teaserHomeReset.secondaryValue) &&
      /目前还不是正式公告/.test(teaserHomeReset.secondaryValue),
    "the compact reset row must plainly say that the hint is not an announcement",
  );
  equal(teaserHomeReset.relativeTimeAt, null, "an inferred interval must never become a countdown");
  check(
    teaserSnapshot.decisionProgress.targetPercent > snapshot.decisionProgress.targetPercent &&
      teaserSnapshot.decisionProgress.targetPercent < 100,
    "the tease must schedule more usage through a bounded target adjustment",
  );
  const teaserWhy = teaserSnapshot.submenuDetails.find(
    (section) => section.title === "为什么这样建议",
  );
  const teaserCalculation = teaserSnapshot.submenuDetails.find(
    (section) => section.title === "计算与数据",
  );
  check(
    teaserWhy.rows.some(
      (row) => row.label === "为什么" && /可能重置的暗示/.test(row.value),
    ),
    "the plain-language explanation must say that the candidate hint affected the plan",
  );
  check(
    teaserCalculation.rows.some(
      (row) => row.label === "同截止点目标" && /暗示证据强度 50\/100 不是概率/.test(row.secondaryValue),
    ),
    "numeric evidence strength belongs with the calculation and must be distinguished from probability",
  );
  const teaserResetSection = teaserSnapshot.submenuDetails.find(
    (section) => section.title === "重置",
  );
  const timeline = teaserResetSection.visualizations.find(
    (visualization) => visualization.kind === "timeline" && visualization.group === "timeline",
  );
  check(timeline, "the reset center must expose a structured timeline visualization");
  const candidateTimelineItem = timeline.items.find((item) => item.kind === "candidate");
  equal(candidateTimelineItem.state, "inferred");
  equal(candidateTimelineItem.badge, "推测");
  check(/Tibo 说“很快，但不是今天”/.test(candidateTimelineItem.detail));
  check(/not an official announcement/.test(candidateTimelineItem.detailEnglish));
  equal(Date.parse(candidateTimelineItem.at), Date.parse(providerTeaseForecast.teased_window.window.start_at));
  equal(Date.parse(candidateTimelineItem.endAt), Date.parse(providerTeaseForecast.teased_window.window.end_at));
  check(timeline.items.some((item) => item.kind === "natural" && item.state === "scheduled"));
  check(timeline.items.some((item) => item.kind === "natural" && item.state === "confirmed"));
  equal(timeline.items.length, 3, "the root timeline must stay focused on current, next, and latest");
  equal(candidateTimelineItem.link, null, "timeline events must not duplicate source buttons");
  check(
    teaserResetSection.rows.some(
      (row) =>
        row.label === "可能重置的时间范围" &&
        /目前没有正式时间/.test(row.secondaryValue) &&
        row.relativeTimeAt === null,
    ),
    "the inferred interval must remain human-readable without an artificial deadline",
  );
  check(
    teaserResetSection.rows.some(
      (row) =>
        row.label === "可能重置暗示原文" &&
        row.group === "official" &&
        row.link.url === providerTeaseForecast.teased_window.url &&
        /查看可能重置暗示原帖/.test(row.link.label) &&
        /View possible-reset source/.test(row.link.labelEnglish),
    ),
    "the full source and its direct link must remain available outside the visualization",
  );
  equal(
    teaserResetSection.rows.some((row) => row.group === "current"),
    false,
    "reset status details belong under Official Updates rather than a duplicate root group",
  );
  equal(
    teaserResetSection.rows.some((row) => row.label === "对当前计划的影响"),
    false,
    "plan impact belongs under Why This Plan instead of the reset center",
  );
  const officialSourceLabels = teaserResetSection.rows
    .filter((row) => row.group === "official" && row.link)
    .map((row) => row.link.label);
  equal(
    new Set(officialSourceLabels).size,
    officialSourceLabels.length,
    "adjacent official source actions must use distinct contextual labels",
  );
  equal(seenURLs.length, 3, "cached public data should prevent redundant public calls");
  check(seenURLs.every((url) => url.startsWith("http://127.0.0.1:18765/")));

  const originalBehavior = receiverState.usageBehavior;
  receiverState.usageBehavior = {
    ...originalBehavior,
    prediction: {
      ...originalBehavior.prediction,
      endpointLower: 40,
      endpointMedian: 48,
      endpointUpper: 55,
    },
  };
  const suitableSnapshot = await provider.fetchUsage(ctx);
  check(
    /保持当前节奏/.test(
      suitableSnapshot.details[0].rows.find((row) => row.label === "建议").value,
    ),
    "a red target inside the blue range should advise maintaining pace",
  );
  equal(
    suitableSnapshot.details[0].rows.some((row) => row.label === "可考虑续跑"),
    false,
    "resumable sessions should not clutter a suitable state",
  );
  equal(
    suitableSnapshot.details[0].rows.filter((row) => /^主线 \d+$/.test(row.label)).length,
    3,
    "when the forecast interval covers target, the home card must show at most three mainlines",
  );

  receiverState.usageBehavior = {
    ...originalBehavior,
    prediction: {
      ...originalBehavior.prediction,
      endpointLower: 50,
      endpointMedian: 58,
      endpointUpper: 66,
    },
  };
  const fastSnapshot = await provider.fetchUsage(ctx);
  check(
    /只保留最重要的 1 条主线，保持 Standard/.test(
      fastSnapshot.details[0].rows.find((row) => row.label === "建议").value,
    ),
    "a red target left of the blue range should retain only the top mainline",
  );
  equal(
    fastSnapshot.details[0].rows.filter((row) => /^主线 \d+$/.test(row.label)).length,
    1,
    "a projected interval beyond target must show exactly one mainline",
  );
  check(
    !/减少任务/.test(JSON.stringify(fastSnapshot.details[0].rows)),
    "the fast-state advice must not tell the user to abandon useful tasks",
  );

  usagePayload[0].usage.secondary.usedPercent = 60;
  receiverState.usageSnapshot.usedPercent = 60;
  receiverState.usageBehavior = {
    ...originalBehavior,
    prediction: {
      additionalLower: 5,
      additionalMedian: 10,
      additionalUpper: 15,
      endpointLower: 65,
      endpointMedian: 70,
      endpointUpper: 75,
      targetGap: 0,
      reachProbability: 100,
      extraLower: 0,
      extraMedian: 0,
      extraUpper: 0,
    },
  };
  const reachedSnapshot = await provider.fetchUsage(ctx);
  close(reachedSnapshot.decisionProgress.currentPercent, 60);
  close(reachedSnapshot.decisionProgress.targetPercent, 47.5);
  check(
    /只保留最重要的 1 条主线，保持 Standard/.test(
      reachedSnapshot.details[0].rows.find((row) => row.label === "建议").value,
    ),
    "crossing the independent red line must be represented as reaching the comparison target",
  );
  equal(
    reachedSnapshot.details[0].rows.filter((row) => /^主线 \d+$/.test(row.label)).length,
    1,
    "actual usage beyond target must show exactly one mainline",
  );
  check(
    reachedSnapshot.submenuDetails
      .find((section) => section.title === "计算与数据")
      .rows.some((row) => row.label === "同截止点目标" && /已超红线 12\.5%/.test(row.secondaryValue)),
    "numeric target-overrun evidence should remain in Calculation & Data instead of the plain-language rationale",
  );
  usagePayload[0].usage.secondary.usedPercent = 10;
  receiverState.usageSnapshot.usedPercent = 10;
  receiverState.usageBehavior = originalBehavior;

  const fallbackCtx = {
    ...ctx,
    http: {
      async getJSON(url) {
        if (url === "http://127.0.0.1:18765/api/state") return { json: receiverState };
        if (url === "http://127.0.0.1:18765/usage?provider=codex") {
          throw new Error("The request timed out.");
        }
        throw new Error(`Unexpected URL: ${url}`);
      },
    },
  };
  const fallbackSnapshot = await provider.fetchUsage(fallbackCtx);
  equal(fallbackSnapshot.updatedAt, "2026-08-12T08:59:00Z");
  equal(
    fallbackSnapshot.details[0].rows.some((row) => row.label === "建议"),
    true,
    "a transient live timeout must preserve the actionable plan",
  );
  const fallbackFreshness = fallbackSnapshot.submenuDetails
    .find((section) => section.title === "计算与数据")
    .rows.find(
    (row) => row.label === "数据新鲜度",
  );
  check(/额度 1 分钟前更新 · 最近可靠值/.test(fallbackFreshness.value));
  check(/沿用最近一次可靠额度/.test(fallbackFreshness.secondaryValue));

  receiverState.bankedCampaign = {
    id: bankedEvent.id,
    announcedAt: bankedEvent.announced_at,
    summary: bankedEvent.summary,
    localizedSummary: bankedEvent.localized_summary,
    url: bankedEvent.url,
    status: "awaiting-inventory",
    officialState: "available",
    accountDelivery: {
      "account-a": "awaiting-inventory",
      "account-b": "awaiting-inventory",
    },
  };
  const bankedSnapshot = await provider.fetchUsage(ctx);
  const bankedMainText = JSON.stringify(bankedSnapshot.details);
  const creditMainRow = bankedSnapshot.details[0].rows.find(
    (row) => row.label === "重置",
  );
  equal(creditMainRow.value, "重置券官方已生效 · 当前账号待确认 · 0/2 个账号");
  check(/不代表官方仍未发放/.test(creditMainRow.secondaryValue));
  check(
    !/可选发券|awaiting-inventory|Banked reset|暂无未兑现|无强制重置预告/.test(
      bankedMainText,
    ),
    "the main UI must not leak internal event names, states or an empty forced-reset status",
  );
  equal(
    bankedSnapshot.details.find((section) => section.title === "现在").rows.some(
      (row) => row.label === "Tibo",
    ),
    false,
    "a reset-ticket announcement must not be duplicated as a forced-reset event",
  );
  const creditSection = bankedSnapshot.submenuDetails.find(
    (section) => section.title === "重置",
  );
  check(
    creditSection.rows.some(
      (row) => row.label === "重置券到账" && /官方已生效/.test(row.value),
    ) &&
      creditSection.rows.some((row) => row.label === "重置券发放公告"),
    "ticket delivery and the original announcement must remain in the unified reset center",
  );
  equal(
    creditSection.rows.some((row) => row.label === "当前状态"),
    false,
    "a banked-only campaign must not appear as a forced reset in the unified center",
  );
  receiverState.accounts = [{
    id: "",
    active: true,
    live: true,
    resetCredits: {
      reliable: true,
      updatedAt: "2026-08-12T08:59:00Z",
      credits: [{
        id: "credit-home-visible",
        status: "available",
        grantedAt: "2026-08-12T08:55:00Z",
        expiresAt: "2026-09-02T08:59:00Z",
      }],
    },
  }];
  const availableCreditSnapshot = await provider.fetchUsage(ctx);
  check(
    availableCreditSnapshot.details[0].rows.some(
      (row) => row.label === "可用重置" && /1 次可用/.test(row.value),
    ),
    "an available account reset must remain visible on the standalone home card even while held",
  );
  check(
    availableCreditSnapshot.details[0].rows.some(
      (row) => row.label === "重置" && /下次自然刷新/.test(row.value),
    ),
    "showing an available reset asset must not replace the current natural cycle status",
  );
  receiverState.accounts = [];
  receiverState.bankedCampaign = null;

  receiverState.cache.feed = {
    stale: false,
    signal: {
      ...tiboEvent,
      active: true,
      tweet_id: tiboEvent.id,
      announced_at: "2026-08-12T08:50:00.000Z",
      official_window: {
        label: "within an hour",
        start_at: "2026-08-12T08:50:00.000Z",
        end_at: "2026-08-12T09:50:00.000Z",
      },
      summary: `${tiboEvent.summary} ${"Use it now. ".repeat(30)}`,
    },
    events: [],
  };
  const signalSnapshot = await provider.fetchUsage(ctx);
  for (const section of signalSnapshot.details) {
    for (const row of section.rows) {
      check(row.label.length <= 120, "main-row label must stay within the host limit");
      check(row.value.length <= 120, "main-row value must stay within the host limit");
      check(
        row.secondaryValue == null || row.secondaryValue.length <= 120,
        "main-row secondary value must stay within the host limit",
      );
    }
  }
  const tiboMainRow = signalSnapshot.details[0].rows.find((row) => row.label === "重置");
  equal(tiboMainRow.relativeTimeAt, "2026-08-12T09:50:00.000Z");
  check(
    /截止 08-12 17:50 UTC\+8/.test(tiboMainRow.secondaryValue),
    "Tibo metadata must survive home-card summarization",
  );
  check(
    !signalSnapshot.details[0].rows.some((row) =>
      [row.value, row.secondaryValue].some(
        (value) => typeof value === "string" && value.includes("…"),
      )),
    "the home card must summarize long values without rendering an ellipsis",
  );
  const signalEventSection = signalSnapshot.submenuDetails.find(
    (section) => section.title === "重置",
  );
  check(
    signalEventSection.rows.some(
      (row) => row.label === "强制重置公告" && row.group === "official",
    ),
    "the complete signal must remain available in the submenu",
  );
  check(
    signalEventSection.rows.some(
      (row) => row.label === "当前状态" && row.group === "official",
    ),
    "a forced reset signal's status must remain available under Official Updates",
  );
  check(
    signalEventSection.rows.some(
      (row) =>
        row.label === "官方摘要" &&
        row.group === "official" &&
        /完整原文与来源见下方/.test(row.secondaryValue),
    ),
    "the current reset state must include a concise official summary before the full official post",
  );
  check(
    signalEventSection.rows.some(
      (row) => row.label === "官方预计时间" && row.relativeTimeAt === "2026-08-12T09:50:00.000Z",
    ),
    "the converted official time must drive the reset detail countdown",
  );
  check(
    signalEventSection.rows.some(
      (row) =>
        row.label === "强制重置公告" &&
        row.link &&
        /查看重置公告原帖/.test(row.link.label) &&
        /View reset announcement source/.test(row.link.labelEnglish),
    ),
    "each official post must retain its own adjacent source action",
  );

  const multiReceiverState = {
    ...receiverState,
    currentEvent: null,
    activeEpisode: null,
    cache: { forecast: forecastFixture(), feed: { stale: false, signal: null, events: [] } },
    activeAccountId: "account-a",
    selectedAccountId: "account-b",
    accounts: [
      {
        id: "account-a",
        label: "averylongaccountname@example.test",
        active: true,
        live: true,
        selected: false,
        planType: "plus",
        targetTrajectory: targetTrajectoryFixture,
        usageSnapshot: receiverState.usageSnapshot,
        usageBehavior,
        resetCredits: {
          reliable: true,
          updatedAt: "2026-08-12T08:59:00Z",
          credits: [{
            id: "account-a-credit",
            status: "available",
            grantedAt: "2026-08-12T08:55:00Z",
            expiresAt: "2026-09-02T08:59:00Z",
          }],
        },
      },
      {
        id: "account-b",
        label: "second@example.test",
        active: false,
        live: false,
        selected: true,
        planType: "pro",
        targetTrajectory: { ...targetTrajectoryFixture, anchorRemainingPercent: 70 },
        usageSnapshot: { ...receiverState.usageSnapshot, usedPercent: 30 },
        usageBehavior: {
          ...usageBehavior,
          prediction: {
            ...usageBehavior.prediction,
            additionalLower: 8,
            additionalMedian: 18,
            additionalUpper: 28,
            endpointLower: 38,
            endpointMedian: 48,
            endpointUpper: 58,
            targetGap: 29.2,
          },
        },
        resetCredits: {
          reliable: true,
          updatedAt: "2026-08-12T08:59:00Z",
          credits: [{
            id: "account-b-credit",
            status: "available",
            grantedAt: "2026-08-12T08:55:00Z",
            expiresAt: "2026-09-06T08:59:00Z",
          }, {
            id: "account-b-credit-later",
            status: "available",
            grantedAt: "2026-08-12T08:56:00Z",
            expiresAt: "2026-09-09T08:59:00Z",
          }],
        },
      },
      {
        id: "account-c",
        label: "third@example.test",
        active: false,
        live: false,
        selected: false,
        planType: "plus",
        targetTrajectory: { ...targetTrajectoryFixture, anchorRemainingPercent: 60 },
        usageSnapshot: { ...receiverState.usageSnapshot, usedPercent: 40 },
      },
      {
        id: "account-d",
        label: "fourth@example.test",
        active: false,
        live: false,
        selected: false,
        planType: "pro",
        targetTrajectory: { ...targetTrajectoryFixture, anchorRemainingPercent: 50 },
        usageSnapshot: { ...receiverState.usageSnapshot, usedPercent: 50 },
      },
    ],
  };
  const multiSnapshot = await provider.fetchUsage({
    ...ctx,
    http: {
      async getJSON(url) {
        if (url === "http://127.0.0.1:18765/api/state") return { json: multiReceiverState };
        throw new Error(`Unexpected multi-account URL: ${url}`);
      },
    },
  });
  check(
    multiSnapshot.details[0].rows.some(
      (row) => row.label === "账户" && /averyl•••me@example\.test · 5x/.test(row.value),
    ),
    "the main card must name the live account with an explicit privacy mask and multiplier",
  );
  check(
    !multiSnapshot.details[0].rows.some((row) => row.label === "本机多账号计划"),
    "the main card must not emit a generic device-level account summary",
  );
  const multiCreditHomeRow = multiSnapshot.details[0].rows.find(
    (row) => row.label === "可用重置",
  );
  equal(
    multiCreditHomeRow.value,
    "1 次可用",
    "the home card must show only the live account's credit count",
  );
  check(
    !/@/.test(multiCreditHomeRow.value) && !/2 次可用/.test(multiCreditHomeRow.value),
    "the home card must not combine a device-wide total with one account label",
  );
  const multiPlanSection = multiSnapshot.submenuDetails.find(
    (section) => section.title === "用量与目标",
  );
  check(
    multiPlanSection.rows.some((row) => /averyl•••me@example\.test · 5x · 当前登录/.test(row.label)) &&
      multiPlanSection.rows.some((row) => /second@example\.test · 20x · CodexBar 查看/.test(row.label)) &&
      multiPlanSection.rows.some((row) => /third@example\.test · 5x/.test(row.label)) &&
      multiPlanSection.rows.some((row) => row.label === "另外 1 个账号"),
    "the submenu must show three named accounts and fold overflow without disabling the plan",
  );
  check(
    !multiSnapshot.details[0].rows.some((row) =>
      [row.value, row.secondaryValue].some(
        (value) => typeof value === "string" && value.includes("…"),
      )),
    "privacy masking on the home card must not resemble UI truncation",
  );
  const visibleAccountRows = multiPlanSection.rows.filter((row) => row.progress);
  equal(
    visibleAccountRows.length,
    3,
    "each visible account must render its own progress model instead of a text-only percentage",
  );
  check(
    visibleAccountRows.every(
      (row) =>
        Number.isFinite(row.progress.currentPercent) &&
        Number.isFinite(row.progress.targetPercent),
    ) &&
      visibleAccountRows.slice(0, 2).every(
        (row) =>
          Number.isFinite(row.progress.projectedLowerPercent) &&
          Number.isFinite(row.progress.projectedUpperPercent),
      ),
    "account bars must keep current usage, target and each account's own forecast separate",
  );
  check(
    visibleAccountRows.slice(0, 2).every((row) =>
      /完整容量约 \$/.test(row.secondaryValue) &&
      /预计被清掉约 \$/.test(row.secondaryValue) &&
      /个样本/.test(row.secondaryValue),
    ),
    "Usage & Targets must retain API-equivalent capacity, loss and sampling evidence",
  );
  const partialDeliveryEvent = {
    id: tiboEvent.id,
    type: "reset",
    group: "reset",
    announcement_state: "announced",
    reset_verification_status: "pending",
    announced_at: "2026-08-12T08:50:00.000Z",
    official_window: {
      label: "within an hour",
      start_at: "2026-08-12T08:50:00.000Z",
      end_at: "2026-08-12T09:50:00.000Z",
    },
    summary: tiboEvent.summary,
    localized_summary: tiboEvent.localized_summary,
    url: tiboEvent.url,
    temporal_phase: "in-progress",
    account_delivery: { "account-a": "landed", "account-b": "pending" },
    source: "site-api",
  };
  const partialDeliverySnapshot = await provider.fetchUsage({
    ...ctx,
    http: {
      async getJSON(url) {
        if (url === "http://127.0.0.1:18765/api/state") {
          return {
            json: {
              ...multiReceiverState,
              activeEpisode: partialDeliveryEvent,
              currentEvent: partialDeliveryEvent,
            },
          };
        }
        throw new Error(`Unexpected partial-delivery URL: ${url}`);
      },
    },
  });
  const partialResetRow = partialDeliverySnapshot.details[0].rows.find(
    (row) => row.label === "重置",
  );
  check(
    /明确重置公告 · 1\/2 账号到账/.test(partialResetRow.value) &&
      !/下次自然刷新/.test(partialResetRow.value) &&
      /Enjoy|重置/.test(partialResetRow.secondaryValue),
    "an unresolved public event must stay ahead of natural refresh even after the current account has landed",
  );
  const multiResetSection = multiSnapshot.submenuDetails.find(
    (section) => section.title === "重置",
  );
  const creditVisualization = multiResetSection.visualizations.find(
    (visualization) => visualization.kind === "resetCredits" && visualization.group === "assets",
  );
  check(
    creditVisualization && creditVisualization.creditSummary.availableCount === 3,
    "the reset-credit visualization must keep the device total as structured summary data",
  );
  const currentCreditItems = creditVisualization.items.filter((item) => item.state === "current");
  const backupCreditItems = creditVisualization.items.filter(
    (item) => item.title === "second@example.test",
  );
  check(
    currentCreditItems.length === 1 &&
      backupCreditItems.length === 2 &&
      new Set(backupCreditItems.map((item) => item.endAt)).size === 2,
    "every credit must stay attributable to one account and retain its own expiry",
  );
  check(
    Object.prototype.hasOwnProperty.call(creditVisualization.creditSummary, "bestNetPercent") &&
      Object.prototype.hasOwnProperty.call(creditVisualization.creditSummary, "bestNetCapacityUSD") &&
      Object.prototype.hasOwnProperty.call(creditVisualization.creditSummary, "optimalWindowStartAt"),
    "net capacity, API-equivalent value and the high-value window must be structured for visual presentation",
  );
  check(
    !/account-a-credit|account-b-credit/.test(JSON.stringify(creditVisualization)),
    "the local presentation API must not expose reset-credit identifiers",
  );
  check(
    !multiResetSection.rows.some((row) =>
      ["重置策略", "净容量价值", "高价值节点"].includes(row.label),
    ),
    "the reset-credit submenu must not duplicate the visualization as long text rows",
  );
  check(
    !/刷新日推迟成本|已用比例 − 周期经过比例/.test(JSON.stringify(multiResetSection.rows)),
    "the obsolete standalone coupon formula must not remain visible",
  );

  const workerSource = fs.readFileSync(`${__dirname}/receiver/sw.js`, "utf8");
  let configFetches = 0;
  const postedTokens = [];
  const workerContext = vm.createContext({
    fetch: async (url, options) => {
      if (url === "/api/config") {
        configFetches += 1;
        return {
          ok: true,
          status: 200,
          json: async () => ({ capabilityToken: configFetches === 1 ? "old-token" : "new-token" }),
        };
      }
      if (url === "/api/push-event") {
        postedTokens.push(options.headers["x-codex-reset-token"]);
        if (postedTokens.length === 1) return { ok: false, status: 403 };
        return {
          ok: true,
          status: 200,
          json: async () => ({ title: "Verified event", options: { body: "verified" } }),
        };
      }
      throw new Error(`Unexpected worker URL: ${url}`);
    },
    self: {
      addEventListener() {},
      skipWaiting() {},
      clients: {},
      registration: {},
    },
    atob,
    Uint8Array,
    URL,
  });
  vm.runInContext(workerSource, workerContext, { filename: "receiver/sw.js" });
  const retriedNotification = await vm.runInContext("buildNotification()", workerContext);
  assert.deepEqual(postedTokens, ["old-token", "new-token"]);
  checks += 1;
  equal(retriedNotification.title, "Verified event", "a stale Push token should self-heal once");

  const fallbackWorkerContext = vm.createContext({
    fetch: async () => {
      throw new Error("loopback unavailable");
    },
    self: {
      addEventListener() {},
      skipWaiting() {},
      clients: {},
      registration: {},
    },
    atob,
    Uint8Array,
    URL,
  });
  vm.runInContext(workerSource, fallbackWorkerContext, { filename: "receiver/sw.js" });
  const unverifiedNotification = await vm.runInContext(
    "buildNotification()",
    fallbackWorkerContext,
  );
  check(/尚未完成事件核验/.test(unverifiedNotification.options.body));
  check(
    !/已确认|已经刷新/.test(unverifiedNotification.options.body),
    "a failed local verification must never claim that a reset was confirmed",
  );
  const receiverAppSource = fs.readFileSync(`${__dirname}/receiver/app.js`, "utf8");
  check(
    /reconcileExistingSubscription\(\)/.test(receiverAppSource) &&
      /state\.push\.registered !== true/.test(receiverAppSource),
    "an existing browser subscription should repair a lost local registration",
  );

  const snapshotRuntime = createRuntime(
    {
      buildModel() {
        return { accounts: [] };
      },
      provider: {
        async fetchUsage(ctx) {
          equal(ctx.settings.get("CODEXBAR_BRIDGE_URL"), "http://127.0.0.1:18765");
          let recursiveSnapshotRejected = false;
          try {
            await ctx.http.getJSON("http://127.0.0.1:18765/api/snapshot", {});
          } catch (error) {
            recursiveSnapshotRejected = /snapshot_fast_path_disabled_inside_monitor/.test(
              String(error && error.message),
            );
          }
          check(
            recursiveSnapshotRejected,
            "monitor snapshot rendering must reject recursive snapshot fast-path requests",
          );
          return {
            dataConfidence: "estimated",
            decisionProgress: null,
            details: [{ title: "现在", rows: [] }],
            submenuDetails: [{ title: "模型诊断", rows: [] }],
          };
        },
      },
    },
    {},
  );
  const independentSnapshot = await snapshotRuntime.uiSnapshot();
  equal(independentSnapshot.details[0].title, "现在");
  equal(independentSnapshot.submenuDetails[0].title, "模型诊断");
  process.stdout.write(`codex-reset: ${checks} checks passed\n`);
})().catch((error) => {
  process.stderr.write(`${error.stack || error}\n`);
  process.exitCode = 1;
});
