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
  createRuntime,
  eventSettledByState,
  globalSettlementFromState,
  inferDeadline,
  latestExplicitFeedEvent,
  normalizedTargetTrajectory,
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
  return {
    usage: {
      usedPercent: overrides.usedPercent === undefined ? 10 : overrides.usedPercent,
      updatedAtMs: now,
      resetsAtMs: now + 6 * day,
      windowMinutes: 7 * 24 * 60,
    },
    forecast: { signal: { id: overrides.signalId || null } },
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

const landedAt = "2026-08-13T03:33:00.622Z";
const previousHint = {
  id: "hint-before-confirmation",
  type: "reset",
  group: "reset",
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

function bankedModel(usedPercent, resetsAt, expiresAt) {
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
  return build(usage, forecastFixture(), null, now, receiver);
}

const earlyBurnBanked = bankedModel(
  99,
  new Date(now + 167 * hour).toISOString(),
  new Date(now + 30 * day).toISOString(),
);
check(earlyBurnBanked.bankedPlan.quotaEdge > 98);
equal(earlyBurnBanked.actions.creditAction, "redeem");
check(earlyBurnBanked.bankedPlan.netCapacityUSD > 196);
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
equal(
  bankedWithFreeAccount.creditAction,
  "hold",
  "another usable account must stay ahead of coupon redemption in the capacity chain",
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
    perAccountBanked.accountCredits.every((inventory) => inventory.availableCount === 1),
  "credit inventory must stay attributable to each account",
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
  { ...behaviorModel, sessionSuggestions: { candidateCount: 3 } },
  "behavior-behind",
);
check(/续跑 3 个近期 session.*开启 Fast/.test(slowCopy.body));
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
      cwd: "/synthetic-home/private-project",
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
      cwd: "/synthetic-home/ordinary",
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
);
equal(rankedSessions.candidateCount, 3, "completed goals should not be suggested for resuming");
equal(rankedSessions.candidates[0].title, "Paused research task");
equal(rankedSessions.candidates[0].reason, "Goal 已暂停");
equal(rankedSessions.candidates[1].title, "Pinned implementation task");
equal(rankedSessions.candidates[1].observedTokens, 60);
equal(
  rankedSessions.candidates[2].observedTokens,
  100,
  "a session created after local observation began may use its full cumulative count",
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
  },
);
const publicState = publicRuntime.publicReceiverState();
const publicStateJSON = JSON.stringify(publicState);
check(publicStateJSON.includes("usageSnapshot"), "the sanitized last-good quota should be locally reusable");
equal(publicState.usageSnapshot.usedPercent, 10);
check(publicStateJSON.includes("usagePace"), "derived pace should be available to the provider");
check(publicStateJSON.includes("usageBehavior"), "the sanitized behavior result should be public locally");
check(publicStateJSON.includes("usageShortLoad"), "the one-hour load forecast should be public locally");
close(publicState.usageShortLoad.prediction.additionalMedian, 1);
equal(publicState.usageShortLoad.shadow.evaluations, 1);
equal(publicState.usageShortLoad.pending, undefined, "pending shadow rows must stay private");
equal(publicState.usageShortLoad.results, undefined, "resolved shadow rows must stay private");
equal(publicState.sessionSuggestions.candidateCount, 3);
equal(publicState.sessionSuggestions.candidates.length, 3);
check(
  publicState.sessionSuggestions.candidates.some(
    (candidate) => candidate.title === "Paused research task" && candidate.project === "private-project",
  ),
  "the provider should receive only a title and project basename for a resumable candidate",
);
check(!publicStateJSON.includes("thread-paused"), "thread IDs must stay private to the monitor");
check(!publicStateJSON.includes("/synthetic-home"), "full project paths must stay private to the monitor");
equal(publicState.usage, undefined, "raw usage samples must stay private to the monitor");
equal(publicState.usageSnapshot.samples, undefined, "raw usage history must not enter the fallback snapshot");
check(!publicStateJSON.includes("must-not-leak"), "the capability token must not enter public state");

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
equal(staleEpisodeState.version, 15);
equal(staleEpisodeState.activeEpisode, null, "migration must clear an already-settled episode");
equal(staleEpisodeState.signalSettlement.throughAt, landedAt);
check(
  staleEpisodeState.closedEventIds.includes("1999999999999999991"),
  "migration must remember the stale episode so a restart cannot revive it",
);

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
  true,
);
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
const receiverState = {
  push: { registered: true, registeredAt: "2026-08-12T08:00:00Z" },
  health: {
    lastFeedSuccessAt: "2026-08-12T08:59:00Z",
    lastUsageSuccessAt: "2026-08-12T08:59:00Z",
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
    observationStartedAt: new Date(now - 3 * hour).toISOString(),
    updatedAt: new Date(now - minute).toISOString(),
    candidateCount: 3,
    observationReady: true,
    candidates: rankedSessions.candidates.map(({ id, ...candidate }) => candidate).slice(0, 3),
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

  const snapshot = await provider.fetchUsage(ctx);
  equal(snapshot.details.length, 1);
  equal(snapshot.details[0].title, "现在");
  equal(
    snapshot.details[0].rows.length,
    4,
    "the main card should show the decision, named sessions, account and reset context",
  );
  equal(snapshot.details[0].rows[0].label, "建议");
  equal(snapshot.details[0].rows[1].label, "建议续跑");
  equal(snapshot.details[0].rows[2].label, "账户");
  equal(snapshot.details[0].rows[3].label, "重置");
  check(
    /续跑近期任务.*开启 Fast/.test(
      snapshot.details[0].rows.find((row) => row.label === "建议").value,
    ),
    "a fully-right red target should recommend useful work before Fast mode",
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
    /红线目标 47\.5% 在蓝区 22\.0%–46\.0% 右侧/.test(
      snapshot.details[0].rows.find((row) => row.label === "建议").secondaryValue,
    ),
    "the state wording must be derived from the same red and blue geometry as the chart",
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
      (row) => row.label === "建议续跑" && /Paused research task/.test(row.value),
    ),
    "the core recommendation must name the first sessions to resume",
  );
  equal(snapshot.submenuDetails[0].title, "账户");
  equal(snapshot.submenuDetails[1].title, "为什么这样建议");
  equal(snapshot.submenuDetails[2].title, "重置");
  const nextResetDetailRow = snapshot.submenuDetails[2].rows.find(
    (row) => row.label === "下次自然刷新",
  );
  equal(
    Date.parse(nextResetDetailRow.relativeTimeAt),
    Date.parse(usagePayload[0].usage.secondary.resetsAt),
  );
  equal(nextResetDetailRow.relativeTimePrefix, "");
  check(
    snapshot.submenuDetails[1].rows.some(
      (row) => row.label === "如何继续" && /不会自动发消息或启动任务/.test(row.secondaryValue),
    ),
    "the recommendation evidence must retain the complete resumable-session list",
  );
  const forecastSection = snapshot.submenuDetails.find(
    (section) => section.title === "为什么这样建议",
  );
  check(
    forecastSection.rows.some((row) => row.label === "未来 1 小时负载"),
    "the one-hour session model should lead the expanded plan evidence",
  );
  check(
    forecastSection.rows.some((row) => row.label === "近期使用速度"),
    "the evidence must show the measured pace and how it was derived",
  );
  check(
    forecastSection.rows.some((row) => row.label === "自然使用预测"),
    "the model range should be available in plan details",
  );
  equal(
    forecastSection.rows.filter((row) => row.group === "summary").map((row) => row.label).join("→"),
    "当前→预计→因此",
    "the default explanation must be a three-step causal chain",
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
    /若正在使用 Fast，切回 Standard/.test(
      fastSnapshot.details[0].rows.find((row) => row.label === "建议").value,
    ),
    "a red target left of the blue range should recommend only returning to Standard",
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
    /无需再为预测继续加速/.test(
      reachedSnapshot.details[0].rows.find((row) => row.label === "建议").value,
    ),
    "crossing the independent red line must be represented as reaching the comparison target",
  );
  check(
    /已超红线 12\.5%/.test(
      reachedSnapshot.details[0].rows.find((row) => row.label === "建议").secondaryValue,
    ),
    "the card should quantify how far actual usage has crossed the fixed target",
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
    .find((section) => section.title === "为什么这样建议")
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
  check(/截止 08-12 17:50 UTC\+8/.test(tiboMainRow.secondaryValue), "Tibo metadata must survive clipping");
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
      (row) => row.label === "当前状态" && row.group === "current",
    ),
    "a forced reset signal must become the current state rather than a generic announcement row",
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
        resetCredits: {
          reliable: true,
          updatedAt: "2026-08-12T08:59:00Z",
          credits: [{
            id: "account-b-credit",
            status: "available",
            grantedAt: "2026-08-12T08:55:00Z",
            expiresAt: "2026-09-06T08:59:00Z",
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
      (row) => row.label === "账户" && /averyl…me@example\.test · 5x/.test(row.value),
    ),
    "the main card must name the live account with a recognizable abbreviation and multiplier",
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
    (section) => section.title === "账户",
  );
  check(
    multiPlanSection.rows.some((row) => /averyl…me@example\.test · 5x · 当前登录/.test(row.label)) &&
      multiPlanSection.rows.some((row) => /second@example\.test · 20x · CodexBar 查看/.test(row.label)) &&
      multiPlanSection.rows.some((row) => /third@example\.test · 5x/.test(row.label)) &&
      multiPlanSection.rows.some((row) => row.label === "另外 1 个账号"),
    "the submenu must show three named accounts and fold overflow without disabling the plan",
  );
  const multiResetSection = multiSnapshot.submenuDetails.find(
    (section) => section.title === "重置",
  );
  check(
    multiResetSection.rows.some(
      (row) => row.label === "重置券 · 当前账号" && row.value === "1 次可用",
    ) &&
      multiResetSection.rows.some(
        (row) => /重置券 · second@example\.test/.test(row.label) && row.value === "1 次可用",
      ),
    "the reset center must list each account's credit inventory separately",
  );
  check(
    multiResetSection.rows.some((row) => row.label === "重置策略") &&
      !multiResetSection.rows.some((row) => row.label === "重置券" && /2 张可用/.test(row.secondaryValue || "")),
    "the cross-account strategy must be separated from per-account inventory",
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
