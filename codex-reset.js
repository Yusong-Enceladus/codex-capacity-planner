// Codex Capacity Planner decision card for CodexBar.
//
// Personal usage is read only from a loopback service. Public requests never
// include account identity, usage, or the account's automatic reset date.

function codexResetObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function codexResetFinite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function codexResetClamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function codexResetMillis(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function codexResetText(value) {
  return typeof value === "string" ? value.trim() : "";
}

function codexResetCompactAccountLabel(value) {
  const raw = codexResetText(value).replace(/…+/g, "•••");
  if (!raw) return "Codex 账号";
  const parts = raw.split(/\s+[—–-]\s+/);
  const email = parts[0];
  const match = email.match(/^([^@]+)@([^@]+)$/);
  if (!match) return raw.length > 24 ? `${raw.slice(0, 18)}•••${raw.slice(-4)}` : raw;
  const local = match[1];
  const compactLocal = local.length > 10 ? `${local.slice(0, 6)}•••${local.slice(-2)}` : local;
  const workspace = parts.slice(1).join(" — ");
  return `${compactLocal}@${match[2]}${workspace ? ` · ${workspace}` : ""}`;
}

function codexResetPlanLabel(value) {
  const plan = codexResetText(value).toLowerCase().replace(/[ _-]+/g, " ");
  if (["plus", "plus plan", "chatgpt plus", "prolite", "pro lite", "codex pro lite"].includes(plan)) {
    return "5x";
  }
  if (["pro", "codex pro"].includes(plan)) return "20x";
  return plan ? plan.toUpperCase() : "套餐未知";
}

function codexResetCommunityCapacityPrior(value) {
  const label = codexResetPlanLabel(value);
  if (label === "5x") {
    return {
      source: "community-prior",
      estimateUSD: 637.5,
      lowerUSD: 500,
      upperUSD: 800,
      sampleCount: 0,
      confidence: "low",
      community: {
        estimateUSD: 637.5,
        lowerUSD: 500,
        upperUSD: 800,
        asOf: "2026-07-23",
        evidence: "community-regression-pro-5x-2026-07",
      },
      anomaly: { status: "baseline", scope: "none" },
    };
  }
  if (label === "20x") {
    return {
      source: "community-prior",
      estimateUSD: 3000,
      lowerUSD: 2400,
      upperUSD: 3600,
      sampleCount: 0,
      confidence: "low",
      community: {
        estimateUSD: 3000,
        lowerUSD: 2400,
        upperUSD: 3600,
        asOf: "2026-07-23",
        evidence: "community-reports-pro-20x-2026-07",
      },
      anomaly: { status: "baseline", scope: "none" },
    };
  }
  return null;
}

function codexResetCapacityEstimate(receiverAccount, planType) {
  const local = codexResetObject(receiverAccount && receiverAccount.capacityEstimate);
  return local && codexResetFinite(local.estimateUSD) !== null
    ? local
    : codexResetCommunityCapacityPrior(planType);
}

function codexResetCapacitySourceLabel(value) {
  const source = codexResetText(value);
  if (source === "community-prior") return "社区基线";
  if (source === "community-calibrated") return "正在用个人数据校准";
  if (source === "api-equivalent-local") return "个人实测";
  return "容量来源未知";
}

function codexResetCapacityAnomalyLabel(value) {
  const anomaly = codexResetObject(value);
  const status = codexResetText(anomaly && anomaly.status);
  if (status === "account-low") return "该账号有效容量疑似偏低";
  if (status === "global-shift") return "近期整体有效容量疑似变化";
  if (["change-detected", "below-community"].includes(status)) return "有效容量变化待确认";
  if (status === "calibrating") return "容量仍在校准";
  return null;
}

function codexResetHTTPSURL(value) {
  const text = codexResetText(value);
  return /^https:\/\/[^\s]+$/i.test(text) ? text : "";
}

function codexResetLocalized(record, key) {
  const source = codexResetObject(record);
  if (!source) return "";
  return codexResetText(source[`localized_${key}`]) || codexResetText(source[key]);
}

function codexResetProbability(probabilities, horizon) {
  const source = codexResetObject(probabilities) || {};
  const rounded = codexResetFinite(source[`rounded_${horizon}`]);
  const raw = codexResetFinite(source[`raw_${horizon}`]);
  if (raw !== null) return codexResetClamp(raw * 100, 0, 100);
  if (rounded !== null) return codexResetClamp(rounded, 0, 100);
  return null;
}

function codexResetDisplayProbability(probabilities, horizon) {
  const source = codexResetObject(probabilities) || {};
  const rounded = codexResetFinite(source[`rounded_${horizon}`]);
  return rounded === null ? codexResetProbability(source, horizon) : codexResetClamp(rounded, 0, 100);
}

// Interpolate the site's two cumulative buckets as a piecewise-constant hazard.
// We never extrapolate a new hazard beyond the final 48-hour observation.
function codexResetCumulativeProbability(p24Value, p48Value, horizonHours) {
  const p24 = codexResetClamp(codexResetFinite(p24Value) || 0, 0, 100) / 100;
  const rawP48 = codexResetFinite(p48Value);
  const p48 = codexResetClamp(rawP48 === null ? p24 * 100 : rawP48, p24 * 100, 100) / 100;
  const hours = Math.max(0, codexResetFinite(horizonHours) || 0);
  if (hours <= 0) return 0;
  if (hours <= 24 && p24 <= 0) return 0;
  if (p24 >= 1) return 100;
  if (hours <= 24) {
    return codexResetClamp((1 - Math.pow(1 - p24, hours / 24)) * 100, 0, 100);
  }
  if (p48 >= 1) return 100;
  if (hours >= 48) return p48 * 100;
  const survival24 = 1 - p24;
  const survival48 = 1 - p48;
  const secondBucketFraction = (hours - 24) / 24;
  const survival = survival24 * Math.pow(survival48 / survival24, secondBucketFraction);
  return codexResetClamp((1 - survival) * 100, 0, 100);
}

function codexResetWeeklyUsages(payload, nowMs) {
  const records = Array.isArray(payload) ? payload : [payload];
  const candidates = [];

  for (const recordValue of records) {
    const record = codexResetObject(recordValue);
    const usage = codexResetObject(record && record.usage);
    const weekly = codexResetObject(usage && usage.secondary);
    const short = codexResetObject(usage && usage.primary);
    if (!record || record.provider !== "codex" || !usage || !weekly) continue;

    const usedPercent = codexResetFinite(weekly.usedPercent);
    const windowMinutes = codexResetFinite(weekly.windowMinutes);
    const resetsAtMs = codexResetMillis(weekly.resetsAt);
    const updatedAtMs = codexResetMillis(usage.updatedAt);
    if (
      usedPercent === null ||
      windowMinutes === null ||
      windowMinutes <= 0 ||
      resetsAtMs === null ||
      resetsAtMs <= nowMs
    ) {
      continue;
    }

    candidates.push({
      accountId:
        codexResetText(record.accountId) ||
        codexResetText(record.cacheAccountKey) ||
        codexResetText(record.account) ||
        codexResetText(usage.identity && usage.identity.accountEmail),
      accountLabel: codexResetCompactAccountLabel(
        codexResetText(record.account) || codexResetText(usage.identity && usage.identity.accountEmail),
      ),
      accountEmail: codexResetText(usage.identity && usage.identity.accountEmail).toLowerCase(),
      accountSelected: record.accountActive === true,
      accountLive: typeof record.accountLive === "boolean" ? record.accountLive : null,
      planType: codexResetText(usage.identity && usage.identity.loginMethod).toLowerCase(),
      subscriptionRenewsAtMs: codexResetMillis(usage.subscriptionRenewsAt),
      subscriptionRenewsAt: usage.subscriptionRenewsAt || null,
      subscriptionExpiresAtMs: codexResetMillis(usage.subscriptionExpiresAt),
      subscriptionExpiresAt: usage.subscriptionExpiresAt || null,
      usedPercent: codexResetClamp(usedPercent, 0, 100),
      windowMinutes,
      resetsAtMs,
      resetsAt: weekly.resetsAt,
      updatedAtMs,
      updatedAt: usage.updatedAt,
      exact: usage.dataConfidence === "exact",
      shortWindow:
        short &&
        codexResetFinite(short.usedPercent) !== null &&
        codexResetFinite(short.windowMinutes) > 0 &&
        codexResetMillis(short.resetsAt) > nowMs
          ? {
              usedPercent: codexResetClamp(codexResetFinite(short.usedPercent), 0, 100),
              windowMinutes: codexResetFinite(short.windowMinutes),
              resetsAtMs: codexResetMillis(short.resetsAt),
              resetsAt: short.resetsAt,
            }
          : null,
      activeLanes: short ? ["weekly", "short"] : ["weekly"],
      resetCreditsPresent: Object.prototype.hasOwnProperty.call(usage, "codexResetCredits"),
      resetCredits: codexResetObject(usage.codexResetCredits),
    });
  }

  candidates.sort((left, right) => {
    if ((left.accountLive === true) !== (right.accountLive === true)) {
      return left.accountLive === true ? -1 : 1;
    }
    if (left.accountSelected !== right.accountSelected) return left.accountSelected ? -1 : 1;
    if (left.exact !== right.exact) return left.exact ? -1 : 1;
    return (right.updatedAtMs || 0) - (left.updatedAtMs || 0);
  });

  for (const candidate of candidates) {
    candidate.fresh = Boolean(
      candidate.updatedAtMs !== null &&
        candidate.updatedAtMs <= nowMs + 2 * 60_000 &&
        nowMs - candidate.updatedAtMs <= 15 * 60_000,
    );
  }
  return candidates;
}

function codexResetPickWeeklyUsage(payload, nowMs) {
  const candidates = codexResetWeeklyUsages(payload, nowMs);

  if (!candidates.length) return null;
  const live = candidates.filter((candidate) => candidate.accountLive === true);
  const hasLiveMetadata = candidates.some((candidate) => candidate.accountLive !== null);
  const legacySelected = candidates.filter((candidate) => candidate.accountSelected);
  const selected =
    live.length === 1
      ? live[0]
      : !hasLiveMetadata && legacySelected.length === 1
        ? legacySelected[0]
        : candidates.length === 1
          ? candidates[0]
          : null;
  if (!selected) return null;
  selected.accountCount = candidates.length;
  return selected;
}

function codexResetUsagePayloadFromReceiver(receiverValue) {
  const receiver = codexResetObject(receiverValue);
  const accounts = Array.isArray(receiver && receiver.accounts) ? receiver.accounts : [];
  if (accounts.length) {
    return accounts
      .map((accountValue) => {
        const account = codexResetObject(accountValue);
        const snapshot = codexResetObject(account && account.usageSnapshot);
        if (!account || !snapshot) return null;
        return {
          provider: "codex",
          accountId: codexResetText(account.id),
          account: codexResetText(account.label),
          accountActive: account.selected === true,
          accountLive: account.live === true || account.active === true,
          usage: {
            updatedAt: snapshot.updatedAt,
            dataConfidence: snapshot.exact === true ? "exact" : "estimated",
            identity: { loginMethod: codexResetText(account.planType) || null },
            subscriptionRenewsAt: account.subscriptionRenewsAt || null,
            subscriptionExpiresAt: account.subscriptionExpiresAt || null,
            ...(codexResetObject(snapshot.shortWindow)
              ? { primary: codexResetObject(snapshot.shortWindow) }
              : {}),
            secondary: {
              usedPercent: snapshot.usedPercent,
              windowMinutes: snapshot.windowMinutes,
              resetsAt: snapshot.resetsAt,
            },
            ...(codexResetObject(account.resetCredits)
              ? { codexResetCredits: codexResetObject(account.resetCredits) }
              : {}),
          },
        };
      })
      .filter(Boolean);
  }
  const snapshot = codexResetObject(receiver && receiver.usageSnapshot);
  if (!snapshot) return null;
  const usedPercent = codexResetFinite(snapshot.usedPercent);
  const windowMinutes = codexResetFinite(snapshot.windowMinutes);
  const resetsAtMs = codexResetMillis(snapshot.resetsAt);
  const updatedAtMs = codexResetMillis(snapshot.updatedAt);
  if (
    usedPercent === null ||
    windowMinutes === null ||
    windowMinutes <= 0 ||
    resetsAtMs === null ||
    updatedAtMs === null
  ) {
    return null;
  }
  return [
    {
      provider: "codex",
      accountActive: true,
      usage: {
        updatedAt: snapshot.updatedAt,
        dataConfidence: snapshot.exact === true ? "exact" : "estimated",
        secondary: {
          usedPercent,
          windowMinutes,
          resetsAt: snapshot.resetsAt,
        },
      },
    },
  ];
}

function codexResetSignalLevel(signal) {
  const kind = codexResetText(signal && signal.kind).toLowerCase();
  const signalType = codexResetText(signal && signal.signal_type).toLowerCase();
  const tier = codexResetText(signal && signal.signal_tier).toLowerCase();
  // Alert v3 separates strength from lifecycle. A scored Watch is not an
  // already-announced reset, and a context score alone cannot promote it.
  if (tier === "elevated") return "hint";
  if (tier && tier !== "likely") return "none";
  if (tier === "likely" && kind === "signal") return "commitment";
  const announcement = codexResetText(signal && signal.announcement_state).toLowerCase();
  const verification = codexResetText(signal && signal.reset_verification_status).toLowerCase();
  const type = codexResetText(signal && signal.type).toLowerCase();
  const group = codexResetText(signal && signal.group).toLowerCase();
  if (
    announcement === "announced" &&
    (type === "reset" || group === "reset" || ["pending", "verified", "confirmed"].includes(verification))
  ) {
    return "explicit";
  }
  if (["explicit", "confirmed", "reset"].includes(kind)) return "explicit";
  if (["dated_commitment", "plain_promise", "promise"].includes(signalType) ||
      ["promise", "commitment"].includes(kind)) {
    return "commitment";
  }
  if (
    announcement === "hinted" ||
    ["candidate", "hint", "possible"].includes(kind) ||
    ["candidate", "hint", "reset_hint", "possible_reset"].includes(signalType)
  ) {
    return "hint";
  }
  return "none";
}

function codexResetSignalIsTerminal(signal) {
  const kind = codexResetText(signal && signal.kind).toLowerCase();
  const announcement = codexResetText(signal && signal.announcement_state).toLowerCase();
  const verification = codexResetText(
    signal && signal.reset_verification_status,
  ).toLowerCase();
  const observation = codexResetText(signal && signal.observation_result).toLowerCase();
  return (
    ["completed", "rejected", "failed", "expired", "landed"].includes(kind) ||
    ["completed", "rejected", "expired"].includes(announcement) ||
    ["confirmed", "verified", "rejected", "failed", "expired", "completed", "landed"].includes(
      verification,
    ) ||
    ["confirmed", "reset_observed", "rejected", "unchanged", "expired", "unverified"].includes(
      observation,
    )
  );
}

function codexResetSignalIsNegativeTerminal(signal) {
  const kind = codexResetText(signal && signal.kind).toLowerCase();
  const announcement = codexResetText(signal && signal.announcement_state).toLowerCase();
  const verification = codexResetText(
    signal && signal.reset_verification_status,
  ).toLowerCase();
  const observation = codexResetText(signal && signal.observation_result).toLowerCase();
  return (
    ["rejected", "failed", "expired"].includes(kind) ||
    ["rejected", "expired"].includes(announcement) ||
    ["rejected", "failed", "expired"].includes(verification) ||
    ["rejected", "unchanged", "expired", "unverified"].includes(observation)
  );
}

// The hosted feed retains every observed Tibo post, including replies and
// corpus-only records. A raw post may fill a delayed `feed.signal` only when
// the server has already put it in the reset-related lane and the post is a
// top-level, non-explicit statement. Replies are deliberately excluded: their
// meaning depends on the parent conversation and cannot be recovered safely
// from a standalone sentence such as "Not so random, but yes".
function codexResetCandidateFromTweet(value) {
  const tweet = codexResetObject(value);
  if (!tweet || codexResetSignalIsTerminal(tweet)) return null;
  const id = codexResetSignalID(tweet);
  const conversationID = codexResetText(tweet.conversation_id);
  const lane = codexResetText(tweet.tibo_lane).toLowerCase();
  if (
    !/^\d{15,22}$/.test(id) ||
    conversationID !== id ||
    codexResetText(tweet.in_reply_to_status_id) ||
    codexResetText(tweet.in_reply_to_user_id) ||
    lane !== "reset_related" ||
    tweet.explicit_reset_claim === true
  ) {
    return null;
  }
  return {
    ...tweet,
    id,
    kind: "candidate",
    announcement_state: "hinted",
    active: true,
    summary: codexResetText(tweet.text),
    // Do not forward an unverified machine translation from the corpus
    // fallback. The original public text is safer than a reversed meaning.
    localized_summary: "",
    source: "site-api-corpus",
  };
}

// `teased_window` is the hosted service's structured interpretation of a
// public post whose wording is suggestive but not an announcement. Unlike the
// raw corpus fallback above, it may represent a reply because the service has
// already evaluated the surrounding conversation. The inferred window and
// evidence score remain provenance, not an official deadline or probability.
function codexResetCandidateFromForecastTease(forecastValue) {
  const forecast = codexResetObject(forecastValue) || {};
  const teaser = codexResetObject(forecast.teased_window);
  if (!teaser || codexResetSignalIsTerminal(teaser)) return null;
  const id = codexResetSignalID(teaser);
  const url = codexResetHTTPSURL(teaser.url);
  const score = codexResetObject(teaser.score) || {};
  const band = codexResetText(score.band).toLowerCase();
  const scoreValue = codexResetFinite(score.value);
  const window = codexResetObject(teaser.window);
  const startAtMs = codexResetMillis(window && window.start_at);
  const endAtMs = codexResetMillis(window && window.end_at);
  const atMs = codexResetMillis(teaser.at);
  if (
    !/^\d{15,22}$/.test(id) ||
    !url ||
    codexResetSignalID({ url }) !== id ||
    !["tease", "candidate", "hint"].includes(band) ||
    scoreValue === null ||
    scoreValue < 0 ||
    scoreValue > 100 ||
    !codexResetText(teaser.summary) ||
    atMs === null ||
    !window ||
    startAtMs === null ||
    endAtMs === null ||
    endAtMs <= startAtMs
  ) {
    return null;
  }
  return {
    ...teaser,
    id,
    url,
    kind: "candidate",
    announcement_state: "hinted",
    active: true,
    window,
    window_provenance: "inferred",
    signal_score: score,
    source: "forecast-tease",
  };
}

function codexResetSignalID(signalValue) {
  const signal = codexResetObject(signalValue) || {};
  const direct = codexResetText(signal.tweet_id) || codexResetText(signal.id);
  const directMatch = direct.match(/(?:^|\/|:)(\d{15,22})(?:[/?#].*)?$/);
  if (directMatch) return directMatch[1];
  const urlMatch = codexResetText(signal.url).match(
    /^https:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d{15,22})(?:[/?#]|$)/i,
  );
  return urlMatch ? urlMatch[1] : direct.replace(/^.*\//, "");
}

// Consume the hosted interpretation once. Feed entries remain source/history
// material; they must not replace this interpretation with a second classifier.
function codexResetHostedSignal(forecastValue) {
  const forecast = codexResetObject(forecastValue) || {};
  const signal = codexResetObject(forecast.official_signal);
  if (!signal) return null;
  const tier = codexResetText(signal.signal_tier || forecast.signal_tier).toLowerCase();
  const alertID = codexResetText(signal.alert_event_id || forecast.alert_event_id);
  const id = codexResetSignalID(signal);
  if (tier || alertID) {
    const sourceID = codexResetText(signal.url).match(
      /^https:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d{15,22})(?:[/?#]|$)/i,
    );
    if (!sourceID || sourceID[1] !== id || !["likely", "elevated"].includes(tier)) return null;
    if (alertID && alertID !== `signal:${id}:${tier}`) return null;
  }
  const probabilities = codexResetObject(forecast.probabilities) || {};
  const score = codexResetObject(signal.signal_score) || codexResetObject(signal.score) ||
    codexResetObject(forecast.signal_score) || {};
  const commitment = codexResetObject(probabilities.commitment) || {};
  return {
    ...signal,
    signal_tier: tier,
    alert_event_id: alertID,
    signal_score: score,
    commitment_floor_percent: codexResetFinite(signal.commitment_floor_percent) ??
      codexResetFinite(probabilities.commitment_floor_percent) ??
      codexResetFinite(commitment.floor_percent),
  };
}

function codexResetTrustedReceiverExplicit(signalValue) {
  const signal = codexResetObject(signalValue) || {};
  const id = codexResetSignalID(signal);
  const urlMatch = codexResetText(signal.url).match(
    /^https:\/\/(?:www\.|mobile\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d{15,22})(?:[/?#]|$)/i,
  );
  return Boolean(
    /^\d{15,22}$/.test(id) &&
      urlMatch &&
      urlMatch[1] === id &&
      ["site-api", "atom", "push-x-one-shot"].includes(codexResetText(signal.source)),
  );
}

function codexResetReconciledFeedSignal(feedValue) {
  const feed = codexResetObject(feedValue) || {};
  const signal = codexResetObject(feed.signal);
  if (!signal) return null;
  const id = codexResetSignalID(signal);
  const events = Array.isArray(feed.events) ? feed.events : [];
  const matching = id ? events.find((event) => codexResetSignalID(event) === id) : null;
  if (!matching) return signal;
  return {
    ...signal,
    reset_verification_status:
      codexResetText(matching.reset_verification_status) ||
      codexResetText(signal.reset_verification_status),
  };
}

function codexResetSignalSettlement(receiverValue) {
  const receiver = codexResetObject(receiverValue) || {};
  const settlement = codexResetObject(receiver.signalSettlement) || {};
  const lastPersonalReset = codexResetObject(receiver.lastPersonalReset);
  const candidates = [];

  function add(at, eventId, source) {
    const atMs = codexResetMillis(at);
    if (atMs === null) return;
    candidates.push({
      atMs,
      eventId: codexResetText(eventId),
      source,
    });
  }

  add(settlement.throughAt, settlement.eventId, "settlement");
  if (
    !(Array.isArray(receiver.accounts) && receiver.accounts.length) &&
    lastPersonalReset &&
    codexResetText(lastPersonalReset.cause).toLowerCase() === "global-manual"
  ) {
    add(lastPersonalReset.at, lastPersonalReset.eventId, "last-personal-reset");
  }

  candidates.sort((left, right) => right.atMs - left.atMs);
  return candidates[0] || { atMs: null, eventId: "", source: "" };
}

function codexResetSignalStartsAfterSettlement(signal, window, settlementAtMs) {
  if (settlementAtMs === null) return false;
  const startAtMs =
    codexResetMillis(window && window.start_at) ||
    codexResetMillis(signal && signal.effective_at) ||
    codexResetMillis(signal && signal.start_at);
  return startAtMs !== null && startAtMs > settlementAtMs;
}

function codexResetSignalTiming(signal, window) {
  const startMs =
    codexResetMillis(window && window.start_at) ||
    codexResetMillis(signal && signal.start_at);
  const endMs =
    codexResetMillis(window && window.end_at) ||
    codexResetMillis(signal && signal.end_at);
  const exactMs =
    codexResetMillis(signal && signal.effective_at) ||
    codexResetMillis(signal && signal.deadline_at);
  const targetKind = codexResetText(window && window.target_kind).toLowerCase();
  const targetMs = codexResetMillis(window && window.target_at);
  if (["deadline", "center", "exact"].includes(targetKind)) {
    return {
      // For a deadline, start_at is the source's observation start, not an
      // assertion that delivery cannot happen before a calendar-day boundary.
      startMs: targetKind === "deadline" ? null : startMs,
      endMs,
      sourceStartMs: startMs,
      canonicalMs: targetMs ?? exactMs ?? endMs,
      kind: targetKind,
    };
  }
  const label = codexResetLocalized(window, "label").toLowerCase();
  const approximatePoint = /\baround\b|\babout\b|approximately|大约|约/.test(label);
  const canonicalMs =
    exactMs !== null
      ? exactMs
      : approximatePoint && startMs !== null && endMs !== null && endMs > startMs
        ? startMs + (endMs - startMs) / 2
        : endMs !== null
          ? endMs
          : startMs;
  return { startMs, endMs, canonicalMs, sourceStartMs: startMs, kind: "" };
}

function codexResetEventEffects(value) {
  const event = codexResetObject(value) || {};
  const tags = [
    ...(Array.isArray(event.reason_tags) ? event.reason_tags : []),
    ...(Array.isArray(event.reasonTags) ? event.reasonTags : []),
    event.reset_kind,
    event.resetKind,
  ]
    .map((item) => codexResetText(item).toLowerCase())
    .filter(Boolean);
  const words = `${codexResetText(event.summary)} ${codexResetText(
    event.localized_summary,
  )} ${codexResetText(event.localizedSummary)} ${codexResetText(event.text)}`.toLowerCase();
  const banked =
    tags.some((tag) => ["banked", "banked-reset", "reset-credit", "credit"].includes(tag)) ||
    /\bbanked\b|reset credit|重置券|可选重置|自行选择/.test(words);
  const forcedTag = tags.some((tag) => ["forced", "global", "immediate", "deadline"].includes(tag));
  return {
    forcedResetEffect:
      codexResetText(event.forced_reset_effect || event.forcedResetEffect) ||
      (forcedTag ? "immediate" : banked ? "none" : "immediate"),
    bankedGrantEffect:
      codexResetText(event.banked_grant_effect || event.bankedGrantEffect) ||
      (banked ? "announced" : "none"),
  };
}

function codexResetPickSignal(forecastValue, feedValue, receiverValue, nowMs) {
  const forecast = codexResetObject(forecastValue) || {};
  const feed = codexResetObject(feedValue) || {};
  const receiver = codexResetObject(receiverValue) || {};
  const hostedSignal = codexResetHostedSignal(forecast);
  const hostedID = hostedSignal && codexResetSignalID(hostedSignal);
  const hostedUpdatedAtMs = codexResetMillis(forecast.updated_at);
  const hostedFresh = hostedUpdatedAtMs !== null && hostedUpdatedAtMs <= nowMs + 2 * 60_000 &&
    nowMs - hostedUpdatedAtMs <= 90 * 60_000;
  const activeAccountID = codexResetText(receiver.activeAccountId);
  const receiverAccounts = Array.isArray(receiver.accounts) ? receiver.accounts : [];
  const personalAccount = receiverAccounts.find((account) => account.id === activeAccountID);
  const activeEpisode =
    codexResetObject(receiver.activeEpisode) || codexResetObject(receiver.currentEvent);
  const legacyLanded =
    activeEpisode && activeEpisode.status === "personal-landed" ? codexResetText(activeEpisode.id) : "";
  const lastPersonalReset = codexResetObject(personalAccount ? personalAccount.lastPersonalReset : receiver.lastPersonalReset);
  const closedEventIDs = new Set(
    (Array.isArray(receiver.closedEventIds) ? receiver.closedEventIds : [])
      .map(codexResetText)
      .filter(Boolean),
  );
  if (legacyLanded) closedEventIDs.add(legacyLanded);
  if (lastPersonalReset && codexResetText(lastPersonalReset.eventId)) {
    closedEventIDs.add(codexResetText(lastPersonalReset.eventId));
  }
  for (const reset of (personalAccount && Array.isArray(personalAccount.personalResets)
    ? personalAccount.personalResets : [])) {
    if (reset.cause === "global-manual" && reset.eventId) closedEventIDs.add(reset.eventId);
  }
  const activeDelivery = codexResetObject(activeEpisode && activeEpisode.account_delivery) || {};
  if (
    activeEpisode &&
    activeAccountID &&
    codexResetText(activeDelivery[activeAccountID]).toLowerCase() === "landed"
  ) {
    closedEventIDs.add(codexResetSignalID(activeEpisode));
  }
  const settlement = codexResetSignalSettlement(receiver);
  const publicResetAtMs = codexResetMillis(forecast.last_reset_at);
  if (settlement.eventId) closedEventIDs.add(settlement.eventId);
  const choices = [];
  const rank = { none: 0, hint: 1, commitment: 2, explicit: 3 };
  const negativeTerminalIDs = new Set(
    [
      codexResetObject(feed.signal),
      ...(Array.isArray(feed.events) ? feed.events : []),
      ...(Array.isArray(feed.tweets) ? feed.tweets : []),
    ]
      .filter((entry) => {
        if (!entry || !codexResetSignalIsNegativeTerminal(entry)) return false;
        // A raw corpus expiry is not a cancellation of the source's current
        // structured interpretation. Explicit rejection/failure still wins.
        const states = [entry.kind, entry.announcement_state, entry.reset_verification_status]
          .map((value) => codexResetText(value).toLowerCase());
        return !(hostedFresh && hostedID === codexResetSignalID(entry) &&
          !codexResetSignalIsTerminal(hostedSignal) && states.includes("expired") &&
          !states.some((value) => ["rejected", "failed"].includes(value)));
      })
      .map(codexResetSignalID)
      .filter(Boolean),
  );

  function addChoice(value, options) {
    const signal = codexResetObject(value);
    const settings = codexResetObject(options) || {};
    if (!signal || (settings.requiresActive && signal.active !== true)) return;
    if (codexResetEventEffects(signal).forcedResetEffect === "none") return;
    if (settings.source !== "receiver" && codexResetSignalIsTerminal(signal)) return;

    const window =
      codexResetObject(signal.official_window) || codexResetObject(signal.window) || {};
    const atMs =
      codexResetMillis(signal.at) ||
      codexResetMillis(signal.announced_at) ||
      codexResetMillis(signal.datePublished) ||
      codexResetMillis(signal.updated_at);
    if (atMs === null) return;
    if (atMs > nowMs + 2 * 60_000) return;

    const id = codexResetSignalID(signal) || signal.at || signal.announced_at;
    if (closedEventIDs.has(id)) return;
    if (negativeTerminalIDs.has(id)) return;
    if (hostedFresh && hostedID === id && settings.source !== "forecast" &&
        settings.source !== "receiver" && !codexResetSignalIsTerminal(hostedSignal)) return;
    const level = codexResetSignalLevel(signal);
    if (level === "none") return;
    // Only unstructured legacy context is retired by an intervening reset.
    // Future commitments/announcements require an identity-matched settlement;
    // publication order or a source observation start cannot settle them.
    const legacyContext = level === "hint" && settings.source !== "forecast" &&
      settings.source !== "forecast-tease" &&
      codexResetMillis(window.end_at) === null;
    if (
      legacyContext &&
      settlement.atMs !== null &&
      atMs <= settlement.atMs &&
      !codexResetSignalStartsAfterSettlement(signal, window, settlement.atMs)
    ) {
      return;
    }
    if (
      legacyContext &&
      publicResetAtMs !== null &&
      atMs < publicResetAtMs &&
      !codexResetSignalStartsAfterSettlement(signal, window, publicResetAtMs)
    ) {
      return;
    }

    if (
      level === "explicit" &&
      settings.source === "receiver" &&
      !codexResetTrustedReceiverExplicit(signal)
    ) {
      return;
    }
    const timing = codexResetSignalTiming(signal, window);
    const deadlineMs = timing.canonicalMs;
    const isRecent = nowMs - atMs <= 72 * 60 * 60 * 1000;
    if (level === "explicit" && settings.source !== "receiver") {
      const expiresAtMs = deadlineMs === null
        ? atMs + 12 * 60 * 60 * 1000
        : Math.max(atMs + 12 * 60 * 60 * 1000, deadlineMs + 6 * 60 * 60 * 1000);
      if (nowMs > expiresAtMs) return;
    }
    if (level !== "explicit" && deadlineMs !== null && deadlineMs <= nowMs) return;
    if (level === "hint" && deadlineMs === null && !isRecent) return;
    if (settings.latestEvent && level === "explicit" && !isRecent) return;

    const originalSummary =
      codexResetText(signal.summary) ||
      codexResetText(signal.text) ||
      codexResetLocalized(signal, "summary");
    const signalScore = codexResetObject(signal.signal_score) || {};
    choices.push({
      level,
      id,
      atMs,
      deadlineMs,
      windowStartMs: timing.startMs,
      windowEndMs: timing.endMs,
      sourceWindowStartMs: timing.sourceStartMs,
      timingKind: timing.kind,
      sourceTimeZone: codexResetText(window.time_zone),
      summary: originalSummary || "Tibo 发布了新的重置信号",
      localizedSummary: codexResetText(signal.localized_summary),
      url: codexResetHTTPSURL(signal.url),
      windowLabel: codexResetLocalized(window, "label"),
      windowProvenance: codexResetText(signal.window_provenance),
      signalScore: codexResetFinite(signalScore.value),
      signalBand: codexResetText(signalScore.band).toLowerCase(),
      signalTier: codexResetText(signal.signal_tier),
      alertEventId: codexResetText(signal.alert_event_id),
      source: codexResetText(settings.source),
      commitmentFloor: codexResetFinite(signal.commitment_floor_percent),
    });
  }

  addChoice(codexResetCandidateFromForecastTease(forecast), { source: "forecast-tease" });
  addChoice(hostedSignal, { source: "forecast" });
  addChoice(codexResetReconciledFeedSignal(feed), { requiresActive: true, source: "feed" });
  const events = Array.isArray(feed.events) ? feed.events : [];
  for (const event of events.slice(0, 16)) {
    addChoice(event, { latestEvent: true, source: "event" });
  }
  const tweets = Array.isArray(feed.tweets) ? feed.tweets : [];
  for (const tweet of tweets.slice(0, 16)) {
    const candidate = codexResetCandidateFromTweet(tweet);
    if (candidate) addChoice(candidate, { source: "tweet" });
  }
  if (
    activeEpisode &&
    activeEpisode.status !== "personal-landed" &&
    activeEpisode.delivery_state !== "landed"
  ) {
    addChoice(activeEpisode, { latestEvent: true, source: "receiver" });
  }

  const byID = {};
  for (const choice of choices) {
    const key = choice.id || `${choice.atMs}`;
    const previous = byID[key];
    if (!previous || rank[choice.level] > rank[previous.level]) {
      if (previous) {
        if (previous.summary.length > choice.summary.length) choice.summary = previous.summary;
        if (previous.localizedSummary.length > choice.localizedSummary.length) {
          choice.localizedSummary = previous.localizedSummary;
        }
        choice.url = choice.url || previous.url;
      }
      byID[key] = choice;
    } else if (previous) {
      if (choice.summary.length > previous.summary.length) previous.summary = choice.summary;
      previous.url = choice.url || previous.url;
      if (choice.localizedSummary.length > previous.localizedSummary.length) {
        previous.localizedSummary = choice.localizedSummary;
      }
    }
  }

  const distinct = Object.keys(byID).map((key) => byID[key]);
  distinct.sort((left, right) => {
    if (rank[left.level] !== rank[right.level]) return rank[right.level] - rank[left.level];
    return right.atMs - left.atMs;
  });

  return distinct[0] || {
    level: "none",
    id: null,
    atMs: null,
    deadlineMs: null,
    windowStartMs: null,
    windowEndMs: null,
    sourceWindowStartMs: null,
    timingKind: "",
    sourceTimeZone: "",
    summary: "暂无未兑现的 Tibo 重置预告",
    localizedSummary: "",
    url: "",
    windowLabel: "",
    windowProvenance: "",
    signalScore: null,
    signalBand: "",
    signalTier: "",
    alertEventId: "",
    source: "",
    commitmentFloor: null,
  };
}

function codexResetForecastModel(forecastValue, feedValue, receiverValue, nowMs) {
  const forecast = codexResetObject(forecastValue);
  const feed = codexResetObject(feedValue);
  const receiver = codexResetObject(receiverValue);
  if (!forecast) return null;

  const probabilities = codexResetObject(forecast.probabilities) || {};
  const p24 = codexResetProbability(probabilities, "24h");
  const rawP48 = codexResetProbability(probabilities, "48h");
  const p48 = p24 === null || rawP48 === null ? rawP48 : Math.max(p24, rawP48);
  const displayP24 = codexResetDisplayProbability(probabilities, "24h");
  const rawDisplayP48 = codexResetDisplayProbability(probabilities, "48h");
  const displayP48 =
    displayP24 === null || rawDisplayP48 === null
      ? rawDisplayP48
      : Math.max(displayP24, rawDisplayP48);
  const updatedAtMs = codexResetMillis(forecast.updated_at);
  const fresh = Boolean(
    updatedAtMs !== null &&
      updatedAtMs <= nowMs + 2 * 60_000 &&
      nowMs - updatedAtMs <= 90 * 60_000,
  );
  const timeWindow = codexResetObject(forecast.time_window);
  const model = codexResetObject(forecast.model);
  const baseDailyRate = codexResetFinite(model && model.base_daily_rate);
  const signal = codexResetPickSignal(forecast, feed, receiver, nowMs);
  // A floor belongs to its particular public promise, not to whichever older
  // event happened to win the local selection.
  const commitmentFloor = signal.level === "commitment" ? signal.commitmentFloor : null;

  return {
    p24,
    p48,
    displayP24,
    displayP48,
    confidence: codexResetText(forecast.confidence).toLowerCase() || "unknown",
    updatedAtMs,
    updatedAt: forecast.updated_at,
    fresh,
    mode: codexResetText(forecast.mode),
    modelVersion: codexResetText(model && model.version),
    baseDailyRate,
    probabilityDelta24:
      p24 === null || baseDailyRate === null ? null : p24 - baseDailyRate * 100,
    commitmentFloor,
    signal,
    commonStartHour: codexResetFinite(timeWindow && timeWindow.start_hour),
    commonEndHour: codexResetFinite(timeWindow && timeWindow.end_hour),
    lastResetAtMs: codexResetMillis(forecast.last_reset_at),
  };
}

function codexResetLocalOnlyForecast(nowMs) {
  return {
    probabilities: {
      rounded_24h: 0,
      rounded_48h: 0,
      commitment_floor_percent: null,
    },
    model: { version: "local-only", base_daily_rate: 0 },
    confidence: "unavailable",
    mode: "local-only",
    updated_at: new Date(nowMs).toISOString(),
    last_reset_at: null,
    time_window: null,
    official_signal: null,
  };
}

// A persisted trajectory supplies the planned quota remaining now. Projecting
// that state to a future comparison point uses two independent factors:
//   planned remaining = Q * natural-time survival * manual-reset survival
// Actual usage is deliberately absent. It is compared with the target, never
// fed back into it, so the white bar can naturally pass the red marker.
// A candidate hint owns a separate, deliberately bounded planning reserve. It
// does not alter the hosted forecast probability: 10% of the quota that would
// remain after the ordinary forecast adjustment is scheduled earlier. This
// keeps the action monotonic and explainable while preventing a hint alone
// from turning the target into 100%.
const CODEX_RESET_CANDIDATE_RESERVE_FRACTION = 0.1;
const CODEX_RESET_HIGH_VALUE_CREDIT_FRACTION = 0.35;

function codexResetComputeDecision(input) {
  const nowMs = input.nowMs;
  const usedPercent = codexResetClamp(input.usedPercent, 0, 100);
  const automaticResetAtMs = input.resetsAtMs;
  const renewalResetAtMs =
    Number.isFinite(input.renewalResetAtMs) && input.renewalResetAtMs > nowMs
      ? input.renewalResetAtMs
      : null;
  const naturalResetAtMs =
    renewalResetAtMs === null
      ? automaticResetAtMs
      : Math.min(automaticResetAtMs, renewalResetAtMs);
  const naturalResetSource =
    renewalResetAtMs !== null && renewalResetAtMs < automaticResetAtMs
      ? "renewal"
      : "automatic";
  const windowMinutes = input.windowMinutes;
  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;
  if (
    !Number.isFinite(nowMs) ||
    !Number.isFinite(automaticResetAtMs) ||
    !Number.isFinite(naturalResetAtMs) ||
    !Number.isFinite(windowMinutes) ||
    windowMinutes <= 0 ||
    naturalResetAtMs <= nowMs
  ) {
    return null;
  }

  const remaining = Math.max(0, 100 - usedPercent);
  const naturalHours = (naturalResetAtMs - nowMs) / hourMs;
  const windowMs = windowMinutes * 60_000;
  const windowStartMs = automaticResetAtMs - windowMs;
  const baselineNow = codexResetClamp(((nowMs - windowStartMs) / windowMs) * 100, 0, 100);
  const paceEdge = usedPercent - baselineNow;
  const fallbackPlannedRemaining = codexResetClamp(
    ((naturalResetAtMs - nowMs) / Math.max(1, naturalResetAtMs - windowStartMs)) * 100,
    0,
    100,
  );
  const suppliedPlannedRemaining = codexResetFinite(input.plannedRemainingNow);
  const plannedRemainingNow = codexResetClamp(
    suppliedPlannedRemaining === null ? fallbackPlannedRemaining : suppliedPlannedRemaining,
    0,
    100,
  );
  const targetNowUsed = 100 - plannedRemainingNow;
  const signal = input.signal || { level: "none" };
  const explicit = signal.level === "explicit";
  const commitment = signal.level === "commitment";
  const hint = signal.level === "hint";
  const untimedCommitment = commitment && !Number.isFinite(signal.deadlineMs);
  const datedCommitment = commitment && Number.isFinite(signal.deadlineMs) && signal.deadlineMs > nowMs;
  const candidateReserveFraction = hint || untimedCommitment
    ? CODEX_RESET_CANDIDATE_RESERVE_FRACTION : 0;
  const p24 = codexResetClamp(codexResetFinite(input.p24) || 0, 0, 100);
  const p48 = codexResetClamp(codexResetFinite(input.p48) || p24, p24, 100);
  const commitmentFloor = codexResetClamp(
    codexResetFinite(input.commitmentFloor) || 0,
    0,
    100,
  );

  let mode = untimedCommitment ? "commitment-untimed" : hint ? "hint" : input.forecastUsable ? "forecast" : "baseline";
  let deadlineMs = Math.min(nowMs + dayMs, naturalResetAtMs);
  let probability = 0;
  let waitsForNaturalReset = false;
  let immediate = false;
  const forecastRiskFraction = input.forecastUsable ? Math.min(p24, 99.999999) / 100 : 0;
  const combinedRiskFraction =
    1 - (1 - forecastRiskFraction) * (1 - candidateReserveFraction);
  let trajectoryPolicyKind = input.forecastUsable || hint || untimedCommitment ? "hazard" : "baseline";
  let trajectoryHazardPerHour =
    combinedRiskFraction > 0 ? -Math.log1p(-combinedRiskFraction) / 24 : 0;
  let trajectoryDeadlineMs = null;

  if (explicit) {
    probability = 100;
    if (!Number.isFinite(signal.deadlineMs)) {
      mode = "explicit-now";
      deadlineMs = nowMs;
      immediate = true;
      trajectoryPolicyKind = "immediate";
    } else if (signal.deadlineMs <= nowMs) {
      mode = "explicit-now";
      deadlineMs = nowMs;
      immediate = true;
      trajectoryPolicyKind = "immediate";
    } else if (naturalResetAtMs <= signal.deadlineMs) {
      mode = "explicit-after-natural";
      deadlineMs = naturalResetAtMs;
      waitsForNaturalReset = true;
      trajectoryPolicyKind = "baseline";
      trajectoryHazardPerHour = 0;
    } else {
      mode = "explicit";
      deadlineMs = signal.deadlineMs;
      trajectoryPolicyKind = "deadline";
      trajectoryDeadlineMs = signal.deadlineMs;
    }
  } else if (datedCommitment) {
    const signalDeadline = signal.deadlineMs;
    if (naturalResetAtMs <= signalDeadline) {
      mode = "commitment-after-natural";
      deadlineMs = naturalResetAtMs;
      waitsForNaturalReset = true;
      trajectoryPolicyKind = "baseline";
      trajectoryHazardPerHour = 0;
    } else {
      mode = "commitment";
      deadlineMs = signalDeadline;
      const modelProbability = input.forecastUsable
        ? codexResetCumulativeProbability(p24, p48, (signalDeadline - nowMs) / hourMs)
        : 0;
      probability = Math.max(input.forecastUsable ? modelProbability : 0, commitmentFloor);
      const commitmentHours = Math.max(0, (signalDeadline - nowMs) / hourMs);
      trajectoryPolicyKind = probability > 0 ? "hazard" : "baseline";
      trajectoryHazardPerHour =
        probability > 0 && commitmentHours > 0
          ? -Math.log1p(-Math.min(probability, 99.999999) / 100) / commitmentHours
          : 0;
    }
  } else if (naturalResetAtMs <= nowMs + dayMs) {
    mode = naturalResetSource;
    deadlineMs = naturalResetAtMs;
    trajectoryPolicyKind = "baseline";
    trajectoryHazardPerHour = 0;
  } else if (input.forecastUsable) {
    probability = codexResetCumulativeProbability(p24, p48, (deadlineMs - nowMs) / hourMs);
  }

  const horizonHours = Math.max(0, Math.min(naturalHours, (deadlineMs - nowMs) / hourMs));
  const naturalSurvival = naturalHours > 0
    ? codexResetClamp((naturalHours - horizonHours) / naturalHours, 0, 1)
    : 0;
  const normalRemainingAtDeadline = plannedRemainingNow * naturalSurvival;
  const normalUse = Math.max(0, plannedRemainingNow - normalRemainingAtDeadline);
  const otherwiseWasted = normalRemainingAtDeadline;
  const predictionUse = (probability / 100) * otherwiseWasted;
  const remainingAfterForecast = Math.max(0, normalRemainingAtDeadline - predictionUse);
  const candidateUse = candidateReserveFraction * remainingAfterForecast;
  const targetRemaining = Math.max(0, remainingAfterForecast - candidateUse);
  const effectiveRiskBudget = predictionUse + candidateUse;
  const effectiveRiskPercent = otherwiseWasted > 0
    ? codexResetClamp((effectiveRiskBudget / otherwiseWasted) * 100, 0, 100)
    : 0;
  const targetUsed = Math.min(100, 100 - targetRemaining);
  const plannedAdditional = Math.max(0, targetUsed - targetNowUsed);
  const additionalTotal = Math.max(0, targetUsed - usedPercent);
  const targetExceededBy = Math.max(0, usedPercent - targetUsed);
  const targetReached = usedPercent + 0.05 >= targetUsed;
  const currentTargetAheadBy = Math.max(0, usedPercent - targetNowUsed);
  const currentTargetBehindBy = Math.max(0, targetNowUsed - usedPercent);
  const normalRate = naturalHours > 0 ? plannedRemainingNow / naturalHours : 0;
  const requiredAverageRate = horizonHours > 0 ? additionalTotal / horizonHours : null;
  let hazardPerHour = null;
  let recommendedRate = requiredAverageRate;
  if (horizonHours > 0) {
    if (effectiveRiskPercent < 100 - 1e-9) {
      hazardPerHour = -Math.log1p(-effectiveRiskPercent / 100) / horizonHours;
    }
  }
  const downsideHours = normalRate > 0 ? effectiveRiskBudget / normalRate : 0;

  return {
    mode,
    deadlineMs,
    horizonHours,
    probability,
    remaining,
    normalUse,
    otherwiseWasted,
    predictionUse,
    candidateUse,
    candidateReservePercent: candidateReserveFraction * 100,
    effectiveRiskPercent,
    additionalBaseline: normalUse,
    additionalPrediction: predictionUse,
    additionalCandidate: candidateUse,
    plannedAdditional,
    additionalTotal,
    targetUsed,
    targetNowUsed,
    targetReached,
    targetExceededBy,
    currentTargetAheadBy,
    currentTargetBehindBy,
    plannedRemainingNow,
    targetRemaining,
    normalRate,
    requiredAverageRate,
    hazardPerHour,
    recommendedRate,
    perTenMinutes: recommendedRate === null ? null : recommendedRate / 6,
    downsideHours,
    baselineNow,
    paceEdge,
    waitsForNaturalReset,
    immediate,
    automaticResetAtMs,
    renewalResetAtMs,
    naturalResetAtMs,
    naturalResetSource,
    trajectoryPolicyKind,
    trajectoryHazardPerHour,
    trajectoryDeadlineMs,
  };
}

function codexResetPaceModel(receiverValue) {
  const receiver = codexResetObject(receiverValue);
  const source = codexResetObject(receiver && receiver.usagePace);
  if (!source) return null;

  function window(value) {
    const item = codexResetObject(value);
    if (!item) return null;
    const ratePerHour = codexResetFinite(item.ratePerHour);
    const lowerRatePerHour = codexResetFinite(item.lowerRatePerHour);
    const upperRatePerHour = codexResetFinite(item.upperRatePerHour);
    const windowMinutes = codexResetFinite(item.windowMinutes);
    const sampleCount = codexResetFinite(item.sampleCount);
    if (
      ratePerHour === null ||
      lowerRatePerHour === null ||
      upperRatePerHour === null ||
      windowMinutes === null ||
      sampleCount === null ||
      windowMinutes <= 0 ||
      sampleCount < 2
    ) {
      return null;
    }
    return {
      ratePerHour: Math.max(0, ratePerHour),
      lowerRatePerHour: Math.max(0, Math.min(ratePerHour, lowerRatePerHour)),
      upperRatePerHour: Math.max(ratePerHour, upperRatePerHour),
      changePercent: Math.max(0, codexResetFinite(item.changePercent) || 0),
      windowMinutes,
      sampleCount,
      resolutionPercent: Math.max(0, codexResetFinite(item.resolutionPercent) || 1),
    };
  }

  return {
    asOfMs: codexResetMillis(source.asOf),
    sampleCount: Math.max(0, codexResetFinite(source.sampleCount) || 0),
    warmupRemainingMinutes: Math.max(
      0,
      Math.ceil(codexResetFinite(source.warmupRemainingMinutes) || 0),
    ),
    short: window(source.short),
    long: window(source.long),
  };
}

function codexResetShortLoadModel(receiverValue, nowMs) {
  const receiver = codexResetObject(receiverValue);
  const source = codexResetObject(receiver && receiver.usageShortLoad);
  if (!source) return null;
  const predictionSource = codexResetObject(source.prediction);
  const contextSource = codexResetObject(source.context) || {};
  const trainingSource = codexResetObject(source.training) || {};
  const shadowSource = codexResetObject(source.shadow) || {};
  const lower = codexResetFinite(predictionSource && predictionSource.additionalLower);
  const median = codexResetFinite(predictionSource && predictionSource.additionalMedian);
  const upper = codexResetFinite(predictionSource && predictionSource.additionalUpper);
  const asOfMs = codexResetMillis(source.asOf);
  const horizonHours = codexResetFinite(source.horizonHours);
  let status = codexResetText(source.status) || "unavailable";
  const validPrediction =
    lower !== null &&
    median !== null &&
    upper !== null &&
    lower >= 0 &&
    lower <= median &&
    median <= upper;
  if (validPrediction && (horizonHours === null || Math.abs(horizonHours - 1) > 0.05)) {
    status = "invalid";
  } else if (validPrediction && (asOfMs === null || Math.abs(nowMs - asOfMs) > 10 * 60_000)) {
    status = "stale";
  }
  return {
    model: codexResetText(source.model) || "session-load-v1",
    status,
    asOfMs,
    sourceUpdatedAtMs: codexResetMillis(source.sourceUpdatedAt),
    horizonHours: horizonHours === null ? 1 : horizonHours,
    prediction: validPrediction
      ? {
          additionalLower: codexResetClamp(lower, 0, 100),
          additionalMedian: codexResetClamp(median, 0, 100),
          additionalUpper: codexResetClamp(upper, 0, 100),
        }
      : null,
    context: {
      activeRootNow: Math.max(0, codexResetFinite(contextSource.activeRootNow) || 0),
      activeAllNow: Math.max(0, codexResetFinite(contextSource.activeAllNow) || 0),
      liveActiveRootNow: Math.max(
        0,
        codexResetFinite(contextSource.liveActiveRootNow) ??
          codexResetFinite(contextSource.activeRootNow) ??
          0,
      ),
      liveActiveAllNow: Math.max(
        0,
        codexResetFinite(contextSource.liveActiveAllNow) ??
          codexResetFinite(contextSource.activeAllNow) ??
          0,
      ),
      rootMean15: Math.max(0, codexResetFinite(contextSource.rootMean15) || 0),
      allMean15: Math.max(0, codexResetFinite(contextSource.allMean15) || 0),
      rootMean60: Math.max(0, codexResetFinite(contextSource.rootMean60) || 0),
      allMean60: Math.max(0, codexResetFinite(contextSource.allMean60) || 0),
    },
    training: {
      lookbackDays: Math.max(0, codexResetFinite(trainingSource.lookbackDays) || 0),
      neighborCount: Math.max(0, codexResetFinite(trainingSource.neighborCount) || 0),
      states: Math.max(0, codexResetFinite(trainingSource.states) || 0),
      medianNeighborDistance: codexResetFinite(trainingSource.medianNeighborDistance),
    },
    shadow: {
      evaluations: Math.max(0, codexResetFinite(shadowSource.evaluations) || 0),
      mae: codexResetFinite(shadowSource.mae),
      medianAbsoluteError: codexResetFinite(shadowSource.medianAbsoluteError),
      bias: codexResetFinite(shadowSource.bias),
      coverage: codexResetFinite(shadowSource.coverage),
    },
  };
}

function codexResetBehaviorModel(receiverValue, usage, decision, nowMs) {
  const receiver = codexResetObject(receiverValue);
  const source = codexResetObject(receiver && receiver.usageBehavior);
  if (!source || !usage || !decision) return null;
  const status = codexResetText(source.status) || "insufficient";
  const confidence = codexResetText(source.confidence) || "low";
  const asOfMs = codexResetMillis(source.asOf);
  const horizonHours = codexResetFinite(source.horizonHours);
  const prediction = codexResetObject(source.prediction);
  const reasons = (Array.isArray(source.reasons) ? source.reasons : [])
    .map(codexResetText)
    .filter(Boolean)
    .slice(0, 6);
  const models = (Array.isArray(source.models) ? source.models : [])
    .map((modelValue) => {
      const model = codexResetObject(modelValue);
      if (!model) return null;
      return {
        id: codexResetText(model.id),
        label: codexResetText(model.label),
        median: codexResetFinite(model.median),
        weight: codexResetClamp(codexResetFinite(model.weight) || 0, 0, 1),
        mae: codexResetFinite(model.mae),
        samples: Math.max(0, codexResetFinite(model.samples) || 0),
        config: codexResetText(model.config),
        distance: codexResetFinite(model.distance),
      };
    })
    .filter(Boolean);
  const validationSource = codexResetObject(source.validation);
  const validation = validationSource
    ? {
        evaluations: Math.max(0, codexResetFinite(validationSource.evaluations) || 0),
        mae: codexResetFinite(validationSource.mae),
        medianAbsoluteError: codexResetFinite(validationSource.medianAbsoluteError),
        baseMae: codexResetFinite(validationSource.baseMae),
        intervalWidth: codexResetFinite(validationSource.intervalWidth),
        disagreement: codexResetFinite(validationSource.disagreement),
        selectedMode: codexResetText(validationSource.selectedMode),
      }
    : null;
  const contextSource = codexResetObject(source.context);
  const context = contextSource
    ? {
        past1: codexResetFinite(contextSource.past1),
        past6: codexResetFinite(contextSource.past6),
        past24: codexResetFinite(contextSource.past24),
        cycleElapsedHours: codexResetFinite(contextSource.cycleElapsedHours),
      }
    : null;
  const base = {
    status,
    confidence,
    reasons,
    asOfMs,
    horizonHours,
    sourceUpdatedAtMs: codexResetMillis(source.sourceUpdatedAt),
    historySampleCount: Math.max(0, codexResetFinite(source.historySampleCount) || 0),
    historyDays: Math.max(0, codexResetFinite(source.historyDays) || 0),
    models,
    validation,
    context,
    prediction: null,
  };
  if (!prediction || status === "insufficient" || horizonHours === null) return base;
  if (Math.abs(horizonHours - decision.horizonHours) > 0.2) return { ...base, status: "stale" };
  if (asOfMs === null || Math.abs(nowMs - asOfMs) > 20 * 60_000) {
    return { ...base, status: "stale" };
  }

  const keys = [
    "additionalLower",
    "additionalMedian",
    "additionalUpper",
    "endpointLower",
    "endpointMedian",
    "endpointUpper",
    "targetGap",
    "reachProbability",
    "extraLower",
    "extraMedian",
    "extraUpper",
  ];
  const values = {};
  for (const key of keys) values[key] = codexResetFinite(prediction[key]);
  if (keys.some((key) => values[key] === null)) return { ...base, status: "invalid" };
  if (
    values.additionalLower > values.additionalMedian ||
    values.additionalMedian > values.additionalUpper ||
    values.endpointLower > values.endpointMedian ||
    values.endpointMedian > values.endpointUpper ||
    Math.abs(values.targetGap - Math.max(0, decision.targetUsed - usage.usedPercent)) > 1.5
  ) {
    return { ...base, status: "invalid" };
  }
  return {
    ...base,
    prediction: {
      additionalLower: codexResetClamp(values.additionalLower, 0, decision.remaining),
      additionalMedian: codexResetClamp(values.additionalMedian, 0, decision.remaining),
      additionalUpper: codexResetClamp(values.additionalUpper, 0, decision.remaining),
      endpointLower: codexResetClamp(values.endpointLower, usage.usedPercent, 100),
      endpointMedian: codexResetClamp(values.endpointMedian, usage.usedPercent, 100),
      endpointUpper: codexResetClamp(values.endpointUpper, usage.usedPercent, 100),
      targetGap: Math.max(0, values.targetGap),
      reachProbability: codexResetClamp(values.reachProbability, 0, 100),
      extraLower: Math.max(0, values.extraLower),
      extraMedian: Math.max(0, values.extraMedian),
      extraUpper: Math.max(0, values.extraUpper),
    },
  };
}

function codexResetBehaviorZone(decisionValue, predictionValue) {
  const decision = codexResetObject(decisionValue);
  const prediction = codexResetObject(predictionValue);
  if (
    !decision ||
    !prediction ||
    codexResetFinite(decision.targetUsed) === null ||
    codexResetFinite(prediction.endpointLower) === null ||
    codexResetFinite(prediction.endpointUpper) === null
  ) {
    return "unknown";
  }
  const target = codexResetFinite(decision.targetUsed);
  const lower = codexResetFinite(prediction.endpointLower);
  const upper = codexResetFinite(prediction.endpointUpper);
  const displayTolerance = 0.05;
  if (target > upper + displayTolerance) return "behind";
  if (target < lower - displayTolerance) return "covered";
  return "uncertain";
}

function codexResetSuggestionLimit(decisionValue, predictionValue, usedPercentValue) {
  const decision = codexResetObject(decisionValue);
  if (!decision) return 0;
  const usedPercent = codexResetFinite(usedPercentValue);
  const target = codexResetFinite(decision.targetUsed);
  if (
    decision.targetReached === true ||
    (usedPercent !== null && target !== null && usedPercent + 0.05 >= target)
  ) {
    return 1;
  }
  const zone = codexResetBehaviorZone(decision, predictionValue);
  if (zone === "covered") return 1;
  if (zone === "uncertain") return 3;
  return 5;
}

function codexResetSessionSuggestions(receiverValue) {
  const receiver = codexResetObject(receiverValue);
  const source = codexResetObject(receiver && receiver.sessionSuggestions);
  if (!source) return null;
  const candidates = (Array.isArray(source.candidates) ? source.candidates : [])
    .map((value) => {
      const candidate = codexResetObject(value);
      const title = codexResetText(candidate && candidate.title).replace(/\s+/g, " ");
      const lastActiveAtMs = codexResetMillis(candidate && candidate.lastActiveAt);
      if (!title || lastActiveAtMs === null) return null;
      return {
        actionId: codexResetText(candidate.actionId).slice(0, 80),
        title: title.slice(0, 300),
        project: codexResetText(candidate.project).slice(0, 120),
        lastActiveAtMs,
        pinned: candidate.pinned === true,
        goalStatus: codexResetText(candidate.goalStatus),
        observedTokens: Math.max(0, codexResetFinite(candidate.observedTokens) || 0),
        workspaceRank: Math.max(1, codexResetFinite(candidate.workspaceRank) || 1),
        workspaceObservedTokens: Math.max(
          0,
          codexResetFinite(candidate.workspaceObservedTokens) || 0,
        ),
        workspaceSharePercent: codexResetClamp(
          codexResetFinite(candidate.workspaceSharePercent) || 0,
          0,
          100,
        ),
        reason: codexResetText(candidate.reason).slice(0, 120) || "近 24 小时活跃工作区",
      };
    })
    .filter(Boolean)
    .slice(0, 12);
  const mainlines = (Array.isArray(source.mainlines) ? source.mainlines : [])
    .map((value) => {
      const mainline = codexResetObject(value);
      const actionId = codexResetText(mainline && mainline.actionId).slice(0, 80);
      const label = codexResetText(mainline && mainline.label).replace(/\s+/g, " ");
      const lastActiveAtMs = codexResetMillis(mainline && mainline.lastActiveAt);
      if (!actionId || !label || lastActiveAtMs === null) return null;
      return {
        actionId,
        label: label.slice(0, 300),
        project: codexResetText(mainline.project).slice(0, 120),
        lastActiveAtMs,
        source: codexResetText(mainline.source) === "explicit" ? "explicit" : "inferred",
        confidence: ["high", "medium"].includes(codexResetText(mainline.confidence))
          ? codexResetText(mainline.confidence)
          : "medium",
        sessionCount: Math.max(1, codexResetFinite(mainline.sessionCount) || 1),
        activeDayCount: Math.max(1, codexResetFinite(mainline.activeDayCount) || 1),
        observedTokens: Math.max(0, codexResetFinite(mainline.observedTokens) || 0),
        loadSharePercent: codexResetClamp(
          codexResetFinite(mainline.loadSharePercent) || 0,
          0,
          100,
        ),
        goalStatus: codexResetText(mainline.goalStatus),
        reason: codexResetText(mainline.reason).slice(0, 180) || "近期持续推进",
      };
    })
    .filter(Boolean)
    .slice(0, 12);
  const corrections = (Array.isArray(source.corrections) ? source.corrections : [])
    .map((value) => {
      const correction = codexResetObject(value);
      const targetId = codexResetText(correction && correction.targetId).slice(0, 80);
      const status = codexResetText(correction && correction.status);
      if (
        !targetId ||
        !["mainline", "not-mainline", "snoozed", "complete"].includes(status)
      ) {
        return null;
      }
      return {
        targetId,
        kind: codexResetText(correction.kind) === "session" ? "session" : "mainline",
        status,
        label: codexResetText(correction.label).slice(0, 300),
        project: codexResetText(correction.project).slice(0, 120),
        updatedAtMs: codexResetMillis(correction.updatedAt),
      };
    })
    .filter(Boolean)
    .slice(0, 200);
  return {
    status: ["ready", "stale", "unavailable"].includes(codexResetText(source.status))
      ? codexResetText(source.status)
      : "unavailable",
    updatedAtMs: codexResetMillis(source.updatedAt),
    cycleStartAtMs: codexResetMillis(source.cycleStartAt),
    trendWindowStartAtMs: codexResetMillis(source.trendWindowStartAt),
    trendWindowHours: Math.max(1, codexResetFinite(source.trendWindowHours) || 24),
    intentWindowStartAtMs: codexResetMillis(source.intentWindowStartAt),
    intentWindowDays: Math.max(1, codexResetFinite(source.intentWindowDays) || 30),
    tokenSource: ["cost-ledger", "hybrid", "local-samples", "observation-fallback"].includes(
      codexResetText(source.tokenSource),
    )
      ? codexResetText(source.tokenSource)
      : "observation-fallback",
    observationStartedAtMs: codexResetMillis(source.observationStartedAt),
    observationReady: source.observationReady === true,
    candidateCount: Math.max(candidates.length, codexResetFinite(source.candidateCount) || 0),
    workspaceCount: Math.max(0, codexResetFinite(source.workspaceCount) || 0),
    mainlineCount: Math.max(mainlines.length, codexResetFinite(source.mainlineCount) || 0),
    mainlines,
    corrections,
    candidates,
  };
}

function codexResetWorkspaceSuggestions(sessionSuggestionsValue) {
  const source = codexResetObject(sessionSuggestionsValue);
  if (!source) return [];
  const grouped = new Map();
  for (const candidateValue of Array.isArray(source.candidates) ? source.candidates : []) {
    const candidate = codexResetObject(candidateValue);
    if (!candidate) continue;
    const workspaceRank = Math.max(1, codexResetFinite(candidate.workspaceRank) || 1);
    const project = codexResetText(candidate.project).replace(/\s+/g, " ") || "未命名工作区";
    const key = `${workspaceRank}:${project}`;
    const current = grouped.get(key) || {
      project,
      workspaceRank,
      observedTokens: 0,
      sharePercent: 0,
      lastActiveAtMs: null,
      recentActivities: [],
    };
    current.observedTokens = Math.max(
      current.observedTokens,
      Math.max(0, codexResetFinite(candidate.workspaceObservedTokens) || 0),
    );
    current.sharePercent = Math.max(
      current.sharePercent,
      codexResetClamp(codexResetFinite(candidate.workspaceSharePercent) || 0, 0, 100),
    );
    const numericLastActiveAtMs = codexResetFinite(candidate.lastActiveAtMs);
    const lastActiveAtMs = numericLastActiveAtMs === null
      ? codexResetMillis(candidate.lastActiveAt)
      : numericLastActiveAtMs;
    if (lastActiveAtMs !== null) {
      current.lastActiveAtMs = current.lastActiveAtMs === null
        ? lastActiveAtMs
        : Math.max(current.lastActiveAtMs, lastActiveAtMs);
    }
    const title = codexResetText(candidate.title).replace(/\s+/g, " ");
    if (title) {
      current.recentActivities.push({
        title: title.slice(0, 300),
        observedTokens: Math.max(0, codexResetFinite(candidate.observedTokens) || 0),
        lastActiveAtMs,
      });
    }
    grouped.set(key, current);
  }
  return [...grouped.values()]
    .sort(
      (left, right) =>
        left.workspaceRank - right.workspaceRank ||
        right.observedTokens - left.observedTokens ||
        (right.lastActiveAtMs || 0) - (left.lastActiveAtMs || 0) ||
        left.project.localeCompare(right.project),
    )
    .map((workspace) => ({
      ...workspace,
      recentActivities: workspace.recentActivities
        .sort(
          (left, right) =>
            right.observedTokens - left.observedTokens ||
            (right.lastActiveAtMs || 0) - (left.lastActiveAtMs || 0) ||
            left.title.localeCompare(right.title),
        )
        .slice(0, 3),
    }));
}

function codexResetTargetTrajectory(receiverValue, usage, naturalResetAtMs, nowMs) {
  const receiver = codexResetObject(receiverValue) || {};
  const source = codexResetObject(receiver.targetTrajectory);
  if (!source || !usage) return null;
  const anchorAtMs = codexResetMillis(source.anchorAt);
  const sourceNaturalResetAtMs = codexResetMillis(source.naturalResetAt);
  const cycleResetAtMs = codexResetMillis(source.cycleResetAt);
  const cycleStartedAtMs = codexResetMillis(source.cycleStartedAt);
  const anchorRemainingPercent = codexResetFinite(source.anchorRemainingPercent);
  const policyKind = codexResetText(source.policyKind);
  const policyHazardPerHour = codexResetFinite(source.policyHazardPerHour);
  const policyDeadlineAtMs = codexResetMillis(source.policyDeadlineAt);
  if (
    anchorAtMs === null ||
    sourceNaturalResetAtMs === null ||
    cycleResetAtMs === null ||
    cycleStartedAtMs === null ||
    anchorRemainingPercent === null ||
    anchorRemainingPercent < 0 ||
    anchorRemainingPercent > 100 ||
    !["baseline", "hazard", "deadline", "immediate"].includes(policyKind) ||
    policyHazardPerHour === null ||
    policyHazardPerHour < 0 ||
    Math.abs(cycleResetAtMs - usage.resetsAtMs) > 2 * 60_000 ||
    anchorAtMs > nowMs + 2 * 60_000 ||
    sourceNaturalResetAtMs <= anchorAtMs
  ) {
    return null;
  }

  const projectedAtMs = Math.max(anchorAtMs, Math.min(nowMs, sourceNaturalResetAtMs));
  const elapsedHours = Math.max(0, (projectedAtMs - anchorAtMs) / (60 * 60 * 1000));
  let remainingPercent = anchorRemainingPercent;
  if (policyKind === "immediate") {
    remainingPercent = 0;
  } else if (policyKind === "deadline") {
    if (policyDeadlineAtMs === null || policyDeadlineAtMs <= anchorAtMs) return null;
    remainingPercent *= codexResetClamp(
      (policyDeadlineAtMs - projectedAtMs) / (policyDeadlineAtMs - anchorAtMs),
      0,
      1,
    );
  } else {
    remainingPercent *= codexResetClamp(
      (sourceNaturalResetAtMs - projectedAtMs) /
        (sourceNaturalResetAtMs - anchorAtMs),
      0,
      1,
    );
    if (policyKind === "hazard" && policyHazardPerHour > 0) {
      remainingPercent *= Math.exp(-policyHazardPerHour * elapsedHours);
    }
  }

  return {
    version: 1,
    cycleStartedAtMs,
    cycleStartedAt: codexResetText(source.cycleStartedAt),
    cycleResetAtMs,
    cycleResetAt: source.cycleResetAt,
    naturalResetAtMs,
    anchorAtMs,
    anchorAt: source.anchorAt,
    anchorRemainingPercent,
    remainingPercent: codexResetClamp(remainingPercent, 0, 100),
    targetUsedPercent: codexResetClamp(100 - remainingPercent, 0, 100),
    policyKind,
    policyHazardPerHour,
    policyDeadlineAtMs,
    policySource: codexResetText(source.policySource) || "baseline",
    signalId: codexResetText(source.signalId),
  };
}

function codexResetAvailableCredits(value, nowMs) {
  const inventory = codexResetObject(value);
  if (!inventory || inventory.reliable === false) return null;
  return (Array.isArray(inventory.credits) ? inventory.credits : [])
    .map((creditValue) => {
      const credit = codexResetObject(creditValue);
      const expiresAtMs = codexResetMillis(credit && credit.expiresAt);
      if (!credit || codexResetText(credit.status).toLowerCase() !== "available") return null;
      if (expiresAtMs !== null && expiresAtMs <= nowMs) return null;
      return {
        id: codexResetText(credit.id),
        expiresAtMs,
        expiresAt: expiresAtMs === null ? null : credit.expiresAt,
        grantedAtMs: codexResetMillis(credit.grantedAt),
      };
    })
    .filter(Boolean)
    .sort((left, right) => {
      if (left.expiresAtMs === null) return 1;
      if (right.expiresAtMs === null) return -1;
      return left.expiresAtMs - right.expiresAtMs;
    });
}

function codexResetReceiverAccountForUsage(receiverAccounts, usage) {
  const exact =
    receiverAccounts.find(
      (item) => codexResetText(item && item.id) === codexResetText(usage && usage.accountId),
    ) || null;
  if (exact) return exact;
  if (usage && usage.accountLive === true) {
    return receiverAccounts.find((item) => item && (item.live === true || item.active === true)) || null;
  }
  if (usage && usage.accountSelected === true) {
    return receiverAccounts.find((item) => item && item.selected === true) || null;
  }
  return null;
}

function codexResetBankedStateAt(account, atMs, ratePerHour) {
  const usage = account.usage;
  const windowMs = usage.windowMinutes * 60_000;
  const currentStartMs = usage.resetsAtMs - windowMs;
  let cycleStartMs = currentStartMs;
  let usedPercent = usage.usedPercent;
  if (atMs > usage.updatedAtMs) {
    if (atMs < usage.resetsAtMs) {
      usedPercent = codexResetClamp(
        usage.usedPercent + ratePerHour * ((atMs - usage.updatedAtMs) / 3_600_000),
        0,
        100,
      );
    } else {
      const cycles = Math.floor((atMs - usage.resetsAtMs) / windowMs);
      cycleStartMs = usage.resetsAtMs + cycles * windowMs;
      usedPercent = codexResetClamp(ratePerHour * ((atMs - cycleStartMs) / 3_600_000), 0, 100);
    }
  }
  const agePercent = codexResetClamp(((atMs - cycleStartMs) / windowMs) * 100, 0, 100);
  return { usedPercent, agePercent, quotaEdge: usedPercent - agePercent };
}

function codexResetChainCapacityUSD(account) {
  const direct = codexResetFinite(account && account.fullCapacityUSD);
  if (direct !== null) return direct;
  const estimate = codexResetObject(account && account.capacityEstimate);
  return codexResetFinite(estimate && estimate.estimateUSD);
}

function codexResetChainDemandRateUSD(account, behavior, nowMs) {
  if (!account || !account.usage) return 0;
  const pace = account.pace || {};
  const measuredRate =
    codexResetFinite(pace.long && pace.long.ratePerHour) ??
    codexResetFinite(pace.short && pace.short.ratePerHour);
  const prediction = codexResetObject(behavior && behavior.prediction);
  const behaviorRate =
    prediction && Number.isFinite(prediction.additionalMedian)
      ? prediction.additionalMedian / Math.max(1, prediction.horizonHours || 24)
      : null;
  const cycleStartedAtMs =
    account.usage.resetsAtMs - account.usage.windowMinutes * 60_000;
  const elapsedHours = Math.max(1, (nowMs - cycleStartedAtMs) / 3_600_000);
  const cycleRate = account.usage.usedPercent / elapsedHours;
  const percentRate = codexResetClamp(
    measuredRate === null
      ? behaviorRate === null
        ? cycleRate
        : behaviorRate
      : measuredRate,
    0,
    20,
  );
  const capacityUSD = codexResetChainCapacityUSD(account);
  return (capacityUSD === null ? 100 : capacityUSD) * percentRate / 100;
}

// A possible-reset signal is intentionally not converted into a probability.
// Reset-credit planning evaluates both outcomes instead: the reset lands at
// one of the inferred window boundaries, or it does not land at all. When the
// credit safely outlives the window, redemption nodes inside that window are
// deferred so "wait" remains a real option rather than a fake probability.
function codexResetPossibleResetDecision(forecast, nowMs) {
  const signal = codexResetObject(forecast && forecast.signal) || {};
  if (!["hint", "commitment"].includes(signal.level)) return null;
  const rawStartMs = codexResetFinite(signal.windowStartMs);
  const rawEndMs =
    codexResetFinite(signal.windowEndMs) ?? codexResetFinite(signal.deadlineMs);
  if (rawEndMs !== null && rawEndMs <= nowMs) return null;
  const startMs = rawStartMs !== null && rawStartMs > nowMs ? rawStartMs : nowMs + 1;
  const endMs = rawEndMs !== null && rawEndMs >= startMs ? rawEndMs : null;
  const forcedTimes = [];
  if (endMs !== null) {
    forcedTimes.push(Math.min(startMs, endMs));
    if (endMs > startMs + 1) forcedTimes.push(endMs);
  }
  return {
    startMs: rawStartMs,
    endMs: rawEndMs,
    timingKnown: endMs !== null,
    branches: [
      ...forcedTimes.map((forcedAtMs) => ({
        source: "possible-reset-happens",
        forcedAtMs,
      })),
      { source: "possible-reset-does-not-happen", forcedAtMs: null },
    ],
  };
}

function codexResetCapacityChainScenarios(forecast, nowMs, horizonMs) {
  const signal = codexResetObject(forecast && forecast.signal) || {};
  if (signal.level === "explicit") return [{ weight: 1, forcedAtMs: null, source: "explicit" }];

  if (
    signal.level === "commitment" &&
    Number.isFinite(signal.deadlineMs) &&
    signal.deadlineMs > nowMs &&
    signal.deadlineMs < horizonMs
  ) {
    const probability = codexResetClamp(
      Math.max(
        codexResetFinite(signal.commitmentFloor) ?? 0,
        forecast && forecast.fresh !== false
          ? codexResetCumulativeProbability(forecast.p24, forecast.p48, (signal.deadlineMs - nowMs) / 3_600_000)
          : 0,
      ) /
        100,
      0,
      1,
    );
    return [
      { weight: probability, forcedAtMs: signal.deadlineMs, source: "commitment" },
      { weight: 1 - probability, forcedAtMs: null, source: "no-forced-reset" },
    ].filter((scenario) => scenario.weight > 0.0001);
  }

  const p24 = codexResetClamp((codexResetFinite(forecast && forecast.p24) ?? 0) / 100, 0, 1);
  const p48 = codexResetClamp(
    Math.max(p24, (codexResetFinite(forecast && forecast.p48) ?? p24 * 100) / 100),
    0,
    1,
  );
  const at24 = nowMs + 24 * 3_600_000;
  const at48 = nowMs + 48 * 3_600_000;
  return [
    {
      weight: at24 < horizonMs ? p24 : 0,
      forcedAtMs: at24 < horizonMs ? at24 : null,
      source: "forecast-24h",
    },
    {
      weight: at48 < horizonMs ? Math.max(0, p48 - p24) : 0,
      forcedAtMs: at48 < horizonMs ? at48 : null,
      source: "forecast-48h",
    },
    { weight: 1 - (at48 < horizonMs ? p48 : at24 < horizonMs ? p24 : 0), forcedAtMs: null, source: "no-forced-reset" },
  ].filter((scenario) => scenario.weight > 0.0001);
}

function codexResetSimulateCapacityChain(accounts, options) {
  const nowMs = options.nowMs;
  const horizonMs = options.horizonMs;
  const demandRateUSD = Math.max(0, options.demandRateUSD || 0);
  const redeemAtMs = Number.isFinite(options.redeemAtMs) ? options.redeemAtMs : null;
  const redeemAccountId = codexResetText(options.redeemAccountId);
  const scenarioForcedAtMs = Number.isFinite(options.scenarioForcedAtMs)
    ? options.scenarioForcedAtMs
    : null;
  const minimumUsefulFraction = codexResetClamp(
    codexResetFinite(options.minimumUsefulFraction) ??
      CODEX_RESET_HIGH_VALUE_CREDIT_FRACTION,
    0,
    1,
  );
  const states = accounts.map((candidate) => {
    const knownCapacityUSD = codexResetChainCapacityUSD(candidate);
    const capacityUSD = knownCapacityUSD === null ? 100 : knownCapacityUSD;
    const windowMs = Math.max(60_000, candidate.usage.windowMinutes * 60_000);
    const naturalAtMs = candidate.usage.resetsAtMs;
    const forcedAtMs = Number.isFinite(candidate.explicitForcedResetAtMs)
      ? candidate.explicitForcedResetAtMs
      : candidate.freeResetSource === "announced-forced" &&
          Number.isFinite(candidate.freeResetDeadlineMs)
        ? candidate.freeResetDeadlineMs
        : null;
    return {
      id: candidate.id,
      capacityUSD,
      knownCapacityUSD,
      remainingUSD: capacityUSD * codexResetClamp(100 - candidate.usage.usedPercent, 0, 100) / 100,
      windowMs,
      naturalAtMs,
      forcedAtMs,
    };
  });
  let servedUSD = 0;
  let unservedUSD = 0;
  let cursorMs = nowMs;
  let scenarioPending = scenarioForcedAtMs;
  let redeemed = false;
  let redeemEligible = false;
  let blockedByNearFreeReset = false;
  let remainingBeforeRedeemUSD = null;
  let ownerRemainingBeforeRedeemUSD = null;
  let nextFreeResetAtRedeemMs = null;

  const nextResetAt = (state) => {
    const values = [state.naturalAtMs, state.forcedAtMs, scenarioPending]
      .filter((value) => Number.isFinite(value) && value > cursorMs);
    return values.length ? Math.min(...values) : Infinity;
  };

  function processFreeResets(atMs) {
    if (scenarioPending !== null && scenarioPending <= atMs) {
      for (const state of states) {
        state.remainingUSD = state.capacityUSD;
        state.naturalAtMs = scenarioPending + state.windowMs;
        if (state.forcedAtMs !== null && state.forcedAtMs <= scenarioPending) state.forcedAtMs = null;
      }
      scenarioPending = null;
    }
    for (const state of states) {
      if (state.forcedAtMs !== null && state.forcedAtMs <= atMs) {
        state.remainingUSD = state.capacityUSD;
        state.naturalAtMs = state.forcedAtMs + state.windowMs;
        state.forcedAtMs = null;
      }
      while (state.naturalAtMs <= atMs) {
        state.remainingUSD = state.capacityUSD;
        state.naturalAtMs += state.windowMs;
      }
    }
  }

  function attemptRedeem(atMs) {
    if (redeemAtMs === null || redeemed || Math.abs(atMs - redeemAtMs) > 1) return;
    const owner = states.find((state) => state.id === redeemAccountId);
    if (!owner) return;
    remainingBeforeRedeemUSD = states.reduce((total, state) => total + state.remainingUSD, 0);
    ownerRemainingBeforeRedeemUSD = owner.remainingUSD;
    const toleranceUSD = states.reduce(
      (total, state) => total + Math.max(1, state.capacityUSD * 0.01),
      0,
    );
    redeemEligible = remainingBeforeRedeemUSD <= toleranceUSD;
    const upcoming = states.map(nextResetAt).filter(Number.isFinite);
    nextFreeResetAtRedeemMs = upcoming.length ? Math.min(...upcoming) : null;
    const workBeforeNextFreeResetUSD = nextFreeResetAtRedeemMs === null
      ? Infinity
      : demandRateUSD * Math.max(0, (nextFreeResetAtRedeemMs - atMs) / 3_600_000);
    blockedByNearFreeReset =
      nextFreeResetAtRedeemMs !== null &&
      workBeforeNextFreeResetUSD < owner.capacityUSD * minimumUsefulFraction;
    if (!redeemEligible || blockedByNearFreeReset) return;
    owner.remainingUSD = owner.capacityUSD;
    owner.naturalAtMs = atMs + owner.windowMs;
    redeemed = true;
  }

  processFreeResets(cursorMs);
  attemptRedeem(cursorMs);
  while (cursorMs < horizonMs) {
    // Demand is linear between reset/redemption events, so consuming an hour at
    // a time adds no information and makes long-lived credits prohibitively
    // expensive to value. Advance directly to the next state transition.
    let nextMs = horizonMs;
    for (const state of states) {
      if (state.naturalAtMs > cursorMs) nextMs = Math.min(nextMs, state.naturalAtMs);
      if (state.forcedAtMs !== null && state.forcedAtMs > cursorMs) {
        nextMs = Math.min(nextMs, state.forcedAtMs);
      }
    }
    if (scenarioPending !== null && scenarioPending > cursorMs) nextMs = Math.min(nextMs, scenarioPending);
    if (redeemAtMs !== null && !redeemed && redeemAtMs > cursorMs) nextMs = Math.min(nextMs, redeemAtMs);
    if (nextMs <= cursorMs) nextMs = Math.min(horizonMs, cursorMs + 1);

    let demandUSD = demandRateUSD * ((nextMs - cursorMs) / 3_600_000);
    const ordered = states.slice().sort((left, right) => {
      const deadlineDelta = nextResetAt(left) - nextResetAt(right);
      if (Math.abs(deadlineDelta) > 1) return deadlineDelta;
      return right.remainingUSD - left.remainingUSD;
    });
    for (const state of ordered) {
      if (demandUSD <= 0) break;
      const consumed = Math.min(state.remainingUSD, demandUSD);
      state.remainingUSD -= consumed;
      demandUSD -= consumed;
      servedUSD += consumed;
    }
    unservedUSD += Math.max(0, demandUSD);
    cursorMs = nextMs;
    processFreeResets(cursorMs);
    attemptRedeem(cursorMs);
  }

  return {
    servedUSD,
    unservedUSD,
    redeemed,
    redeemEligible,
    blockedByNearFreeReset,
    remainingBeforeRedeemUSD,
    ownerRemainingBeforeRedeemUSD,
    nextFreeResetAtRedeemMs,
  };
}

function codexResetBankedPlan(account, allAccounts, receiver, behavior, nowMs, forecast) {
  if (!account) return null;
  const campaign = codexResetObject(receiver && receiver.bankedCampaign);
  const officialState = String(campaign && campaign.officialState || "unknown");
  const inventories = allAccounts.map((candidate) => ({
    account: candidate,
    credits: codexResetAvailableCredits(candidate.resetCredits, nowMs),
  }));
  const knownInventories = inventories.filter((item) => item.credits !== null);
  const accountCredits = knownInventories.map((item) => ({
    accountId: item.account.id,
    accountLabel: item.account.label,
    availableCount: item.credits.length,
    credits: item.credits.map((credit) => ({
      expiresAtMs: credit.expiresAtMs,
      grantedAtMs: credit.grantedAtMs,
    })),
    expiresAtMs: item.credits.reduce((earliest, credit) => {
      if (!credit.expiresAtMs) return earliest;
      return earliest === null ? credit.expiresAtMs : Math.min(earliest, credit.expiresAtMs);
    }, null),
  }));
  const currentAccountCredits = accountCredits.find((item) => item.accountId === account.id) || null;
  const creditEntries = knownInventories.flatMap((item) =>
    item.credits.map((credit) => ({ account: item.account, credit })),
  );
  if (!knownInventories.length) {
    if (!campaign) return null;
    return {
      creditAction: campaign ? "awaiting-delivery" : "hold",
      status: "inventory-unavailable",
      availableCount: null,
      currentAccountAvailableCount: null,
      currentAccountExpiresAtMs: null,
      accountCredits: [],
      officialState,
      confidence: "low",
    };
  }
  if (!creditEntries.length) {
    if (!campaign) return null;
    return {
      creditAction: campaign ? "awaiting-delivery" : "hold",
      status: campaign ? "awaiting-delivery" : "no-credit",
      availableCount: 0,
      currentAccountAvailableCount: currentAccountCredits
        ? currentAccountCredits.availableCount
        : 0,
      currentAccountExpiresAtMs: currentAccountCredits
        ? currentAccountCredits.expiresAtMs
        : null,
      accountCredits,
      officialState,
      confidence: "high",
    };
  }

  const earliestKnownExpiryMs = creditEntries.reduce((earliest, entry) => {
    if (entry.credit.expiresAtMs === null) return earliest;
    return earliest === null
      ? entry.credit.expiresAtMs
      : Math.min(earliest, entry.credit.expiresAtMs);
  }, null);
  const hoursToExpiry = earliestKnownExpiryMs === null
    ? null
    : Math.max(0, (earliestKnownExpiryMs - nowMs) / 3_600_000);
  const accountDataReady =
    allAccounts.length > 0 &&
    allAccounts.every((candidate) =>
      candidate &&
      candidate.usage &&
      candidate.usage.exact === true &&
      candidate.usage.fresh === true &&
      Number.isFinite(candidate.usage.updatedAtMs),
    );
  const possibleReset = codexResetPossibleResetDecision(forecast, nowMs);
  const possibleResetFirst = Boolean(
    possibleReset &&
      (possibleReset.timingKnown
        ? earliestKnownExpiryMs === null || possibleReset.endMs < earliestKnownExpiryMs
        : forecast.signal.level === "hint"),
  );

  const accountUsable = (candidate) =>
    candidate.usage.usedPercent < 99 &&
    (!candidate.usage.shortWindow || candidate.usage.shortWindow.usedPercent < 99);
  const usableAccounts = allAccounts.filter(accountUsable);
  const allAccountsBlocked = usableAccounts.length === 0;
  const naturalDemandRateUSD = codexResetChainDemandRateUSD(account, behavior, nowMs);
  const nextNonCouponResetAtMs = allAccounts.reduce((earliest, candidate) => {
    if (!Number.isFinite(candidate.freeResetDeadlineMs) || candidate.freeResetDeadlineMs <= nowMs) {
      return earliest;
    }
    const conservativeAtMs = Number.isFinite(candidate.freeResetWindowStartMs)
      ? candidate.freeResetWindowStartMs
      : candidate.freeResetDeadlineMs;
    return earliest === null ? conservativeAtMs : Math.min(earliest, conservativeAtMs);
  }, null);
  const nextVerifiedForcedResetAtMs = allAccounts.reduce((earliest, candidate) => {
    const forcedAtMs = Number.isFinite(candidate.explicitForcedResetAtMs)
      ? candidate.explicitForcedResetAtMs
      : null;
    if (forcedAtMs === null || forcedAtMs <= nowMs) return earliest;
    return earliest === null ? forcedAtMs : Math.min(earliest, forcedAtMs);
  }, null);
  const verifiedForcedResetFirst = Boolean(
    nextVerifiedForcedResetAtMs !== null &&
      (earliestKnownExpiryMs === null ||
        nextVerifiedForcedResetAtMs < earliestKnownExpiryMs),
  );
  const minimumUsefulCreditUSD = creditEntries.reduce((smallest, entry) => {
    const capacityUSD = codexResetChainCapacityUSD(entry.account) ?? 100;
    const thresholdUSD = capacityUSD * CODEX_RESET_HIGH_VALUE_CREDIT_FRACTION;
    return smallest === null ? thresholdUSD : Math.min(smallest, thresholdUSD);
  }, null);
  const demandBeforeNextFreeResetUSD = nextNonCouponResetAtMs === null
    ? Infinity
    : naturalDemandRateUSD * Math.max(
        0,
        (nextNonCouponResetAtMs - nowMs) / 3_600_000,
      );
  const freeResetFirst =
    verifiedForcedResetFirst ||
    (nextNonCouponResetAtMs !== null &&
      minimumUsefulCreditUSD !== null &&
      demandBeforeNextFreeResetUSD < minimumUsefulCreditUSD);
  const candidates = [];
  for (const entry of creditEntries) {
    const candidateAccount = entry.account;
    const expiryMs = entry.credit.expiresAtMs;
    if (expiryMs === null) continue;
    const deferThisCredit = possibleReset && (possibleReset.timingKnown
      ? possibleReset.endMs < expiryMs
      : forecast.signal.level === "hint");
    const pace = candidateAccount.pace || {};
    const measuredRate =
      codexResetFinite(pace.long && pace.long.ratePerHour) ??
      codexResetFinite(pace.short && pace.short.ratePerHour);
    const elapsedHours = Math.max(
      1,
      (nowMs -
        (candidateAccount.usage.resetsAtMs - candidateAccount.usage.windowMinutes * 60_000)) /
        3_600_000,
    );
    const fallbackRate = candidateAccount.usage.usedPercent / elapsedHours;
    const behaviorRate =
      candidateAccount.id === account.id &&
      behavior &&
      behavior.prediction &&
      Number.isFinite(behavior.prediction.additionalMedian)
        ? behavior.prediction.additionalMedian / Math.max(1, behavior.prediction.horizonHours || 24)
        : null;
    const rate = codexResetClamp(
      measuredRate === null
        ? behaviorRate === null
          ? fallbackRate
          : behaviorRate
        : measuredRate,
      0,
      20,
    );
    const capacityUSD = codexResetChainCapacityUSD(candidateAccount);
    const windowMs = Math.max(60_000, candidateAccount.usage.windowMinutes * 60_000);
    const horizonMs = expiryMs + Math.max(windowMs, 7 * 24 * 3_600_000);
    const scenarios = codexResetCapacityChainScenarios(forecast, nowMs, horizonMs);
    const baselineByScenario = scenarios.map((scenario) => ({
      scenario,
      result: codexResetSimulateCapacityChain(allAccounts, {
        nowMs,
        horizonMs,
        demandRateUSD: naturalDemandRateUSD,
        scenarioForcedAtMs: scenario.forcedAtMs,
      }),
    }));
    const robustBranches = possibleReset && possibleReset.timingKnown
      ? possibleReset.branches
      : [];
    const robustBaselineByBranch = robustBranches.map((branch) => ({
      branch,
      result: codexResetSimulateCapacityChain(allAccounts, {
        nowMs,
        horizonMs,
        demandRateUSD: naturalDemandRateUSD,
        scenarioForcedAtMs: branch.forcedAtMs,
      }),
    }));
    const candidateTimes = [nowMs];
    for (let atMs = nowMs + 3_600_000; atMs < expiryMs; atMs += 3_600_000) {
      candidateTimes.push(atMs);
    }
    if (expiryMs > nowMs) candidateTimes.push(expiryMs - 1);
    for (const atMs of candidateTimes) {
      if (
        verifiedForcedResetFirst &&
        atMs <= nextVerifiedForcedResetAtMs
      ) {
        continue;
      }
      if (
        deferThisCredit &&
        (!possibleReset.timingKnown || atMs <= possibleReset.endMs)
      ) {
        continue;
      }
      let expectedAdditionalWorkUSD = 0;
      let eligibleWeight = 0;
      let representative = null;
      for (const item of baselineByScenario) {
        const redeemedResult = codexResetSimulateCapacityChain(allAccounts, {
          nowMs,
          horizonMs,
          demandRateUSD: naturalDemandRateUSD,
          scenarioForcedAtMs: item.scenario.forcedAtMs,
          redeemAtMs: atMs,
          redeemAccountId: candidateAccount.id,
        });
        if (!redeemedResult.redeemed) continue;
        eligibleWeight += item.scenario.weight;
        expectedAdditionalWorkUSD +=
          Math.max(0, redeemedResult.servedUSD - item.result.servedUSD) * item.scenario.weight;
        if (!representative || item.scenario.weight > representative.weight) {
          representative = { ...redeemedResult, weight: item.scenario.weight };
        }
      }
      if (eligibleWeight < 0.5 || !representative) continue;
      let robustAdditionalWorkUSD = null;
      let robustEligible = true;
      for (const item of robustBaselineByBranch) {
        const redeemedResult = codexResetSimulateCapacityChain(allAccounts, {
          nowMs,
          horizonMs,
          demandRateUSD: naturalDemandRateUSD,
          scenarioForcedAtMs: item.branch.forcedAtMs,
          redeemAtMs: atMs,
          redeemAccountId: candidateAccount.id,
        });
        if (!redeemedResult.redeemed) {
          robustEligible = false;
          break;
        }
        const additionalWorkUSD = Math.max(
          0,
          redeemedResult.servedUSD - item.result.servedUSD,
        );
        robustAdditionalWorkUSD = robustAdditionalWorkUSD === null
          ? additionalWorkUSD
          : Math.min(robustAdditionalWorkUSD, additionalWorkUSD);
      }
      if (!robustEligible) continue;
      const decisionAdditionalWorkUSD = robustAdditionalWorkUSD === null
        ? expectedAdditionalWorkUSD
        : Math.min(expectedAdditionalWorkUSD, robustAdditionalWorkUSD);
      const fullCapacityUSD = capacityUSD === null ? 100 : capacityUSD;
      candidates.push({
        account: candidateAccount,
        credit: entry.credit,
        atMs,
        expectedAdditionalWorkUSD: decisionAdditionalWorkUSD,
        modeledExpectedAdditionalWorkUSD: expectedAdditionalWorkUSD,
        robustAdditionalWorkUSD,
        netPercent: codexResetClamp(decisionAdditionalWorkUSD / fullCapacityUSD * 100, 0, 100),
        score: decisionAdditionalWorkUSD,
        capacityUSD,
        measuredRate,
        expiryMs,
        eligibleWeight,
        remainingBeforeRedeemUSD: representative.remainingBeforeRedeemUSD,
        ownerRemainingBeforeRedeemUSD: representative.ownerRemainingBeforeRedeemUSD,
        nextFreeResetAtRedeemMs: representative.nextFreeResetAtRedeemMs,
      });
    }
  }
  const best = candidates.reduce(
    (winner, item) => (!winner || item.score > winner.score ? item : winner),
    null,
  );
  const currentState = codexResetBankedStateAt(
    account,
    nowMs,
    naturalDemandRateUSD /
      Math.max(1, codexResetChainCapacityUSD(account) === null ? 1 : codexResetChainCapacityUSD(account) / 100),
  );
  if (!best) {
    return {
      status: !accountDataReady
        ? "account-data-unready"
        : possibleResetFirst
          ? "possible-reset-first"
          : earliestKnownExpiryMs === null
            ? "expiry-unknown"
            : freeResetFirst
              ? "free-reset-first"
              : "must-form-node",
      creditAction:
        !accountDataReady || possibleResetFirst || freeResetFirst
          ? "hold"
          : earliestKnownExpiryMs !== null && hoursToExpiry <= 72
            ? "prepare"
            : "hold",
      availableCount: creditEntries.length,
      currentAccountAvailableCount: currentAccountCredits ? currentAccountCredits.availableCount : 0,
      currentAccountExpiresAtMs: currentAccountCredits ? currentAccountCredits.expiresAtMs : null,
      accountCredits,
      officialState,
      expiresAtMs: earliestKnownExpiryMs,
      hoursToExpiry,
      grossRecovery: currentState.usedPercent,
      scheduleCost: currentState.agePercent,
      quotaEdge: currentState.quotaEdge,
      netCapacityUSD: null,
      bestNetPercent: null,
      bestNetCapacityUSD: null,
      fullCapacityUSD: codexResetChainCapacityUSD(account),
      highValueNode: false,
      optimalAtMs: null,
      optimalWindowStartMs: null,
      optimalWindowEndMs: null,
      nextFreeResetAtMs: nextNonCouponResetAtMs,
      freeResetFirst,
      verifiedForcedResetFirst,
      possibleResetFirst,
      possibleResetWindowStartMs: possibleReset && possibleReset.startMs,
      possibleResetWindowEndMs: possibleReset && possibleReset.endMs,
      accountDataReady,
      valuationMethod: "capacity-chain",
      naturalDemandRateUSD,
      confidence: "low",
    };
  }
  const hoursToBest = Math.max(0, (best.atMs - nowMs) / 3_600_000);
  const highValueNode = best.netPercent >= CODEX_RESET_HIGH_VALUE_CREDIT_FRACTION * 100;
  const preparationLeadHours =
    naturalDemandRateUSD > 0 && best.capacityUSD !== null
      ? (best.capacityUSD * CODEX_RESET_HIGH_VALUE_CREDIT_FRACTION) / naturalDemandRateUSD
      : null;
  let creditAction = "hold";
  let status = "ready";
  if (!accountDataReady) {
    status = "account-data-unready";
  } else if (possibleResetFirst) {
    status = "possible-reset-first";
  } else if (freeResetFirst) {
    status = "free-reset-first";
  } else if (allAccountsBlocked && highValueNode && hoursToBest <= 1) {
    creditAction = "redeem";
    status = "interruption-now";
  } else if (
    highValueNode &&
    preparationLeadHours !== null &&
    hoursToBest <= preparationLeadHours
  ) {
    creditAction = "prepare";
  } else if (!highValueNode && hoursToExpiry !== null && hoursToExpiry <= 72) {
    creditAction = "prepare";
    status = "must-form-node";
  }
  return {
    status,
    creditAction,
    availableCount: creditEntries.length,
    currentAccountAvailableCount: currentAccountCredits
      ? currentAccountCredits.availableCount
      : 0,
    currentAccountExpiresAtMs: currentAccountCredits
      ? currentAccountCredits.expiresAtMs
      : null,
    accountCredits,
    creditId: best.credit.id,
    accountId: best.account.id,
    accountLabel: best.account.label,
    expiresAtMs: best.credit.expiresAtMs,
    hoursToExpiry,
    grossRecovery: currentState.usedPercent,
    scheduleCost: currentState.agePercent,
    quotaEdge: currentState.quotaEdge,
    netCapacityUSD: best.expectedAdditionalWorkUSD,
    bestNetPercent: best.netPercent,
    bestNetCapacityUSD: best.expectedAdditionalWorkUSD,
    fullCapacityUSD: best.capacityUSD,
    optimalAtMs: best.atMs,
    optimalWindowStartMs: Math.max(nowMs, best.atMs - 3 * 3_600_000),
    optimalWindowEndMs: Math.min(best.expiryMs, best.atMs + 3 * 3_600_000),
    highValueNode,
    allAccountsBlocked,
    usableAccountCount: usableAccounts.length,
    activeLanes: best.account.usage.activeLanes || ["weekly"],
    nextFreeResetAtMs: freeResetFirst
      ? nextNonCouponResetAtMs
      : best.nextFreeResetAtRedeemMs,
    freeResetFirst,
    verifiedForcedResetFirst,
    possibleResetFirst,
    possibleResetWindowStartMs: possibleReset && possibleReset.startMs,
    possibleResetWindowEndMs: possibleReset && possibleReset.endMs,
    accountDataReady,
    valuationMethod: "capacity-chain",
    naturalDemandRateUSD,
    preparationLeadHours,
    expectedAdditionalWorkUSD: best.expectedAdditionalWorkUSD,
    remainingBeforeRedeemUSD: best.remainingBeforeRedeemUSD,
    ownerRemainingBeforeRedeemUSD: best.ownerRemainingBeforeRedeemUSD,
    confidence:
      best.capacityUSD !== null && best.measuredRate !== null
        ? "high"
        : best.measuredRate === null
          ? "low"
          : "medium",
  };
}

function codexResetBuildModel(usagePayload, forecastPayload, feedPayload, nowMs, receiverPayload) {
  const receiver = codexResetObject(receiverPayload);
  const usages = codexResetWeeklyUsages(usagePayload, nowMs);
  const usage = codexResetPickWeeklyUsage(usagePayload, nowMs);
  const forecast = codexResetForecastModel(forecastPayload, feedPayload, receiver, nowMs);
  const pace = codexResetPaceModel(receiver);
  const shortLoad = codexResetShortLoadModel(receiver, nowMs);
  const receiverAccounts = Array.isArray(receiver && receiver.accounts) ? receiver.accounts : [];
  const receiverAccount = usage
    ? codexResetReceiverAccountForUsage(receiverAccounts, usage)
    : null;
  const naturalResetAtMs = usage ? usage.resetsAtMs : null;
  const targetTrajectory = usage
    ? codexResetTargetTrajectory(receiverAccount || receiver, usage, naturalResetAtMs, nowMs)
    : null;
  let blocker = null;

  if (!usage) blocker = usages.length ? "无法确定当前登录的 Codex 账户" : "没有读到 Codex 周额度";
  else if (!usage.exact) blocker = "个人额度不是精确数据";
  else if (!usage.fresh) blocker = "个人额度数据已过期";
  else if (!forecast || (forecast.p24 === null && forecast.signal.level === "none")) {
    blocker = "重置预测暂不可用";
  } else if (!forecast.fresh && !["explicit", "commitment"].includes(forecast.signal.level)) {
    blocker = "重置预测数据已过期";
  }

  const planningDecision =
    usage && usage.exact && forecast
      ? codexResetComputeDecision({
        nowMs,
        usedPercent: usage.usedPercent,
        resetsAtMs: usage.resetsAtMs,
        windowMinutes: usage.windowMinutes,
        p24: forecast.p24,
        p48: forecast.p48,
        commitmentFloor: forecast.commitmentFloor,
        signal: forecast.signal,
        forecastUsable: forecast.fresh,
        plannedRemainingNow: targetTrajectory && targetTrajectory.remainingPercent,
      })
      : null;
  const decision = blocker ? null : planningDecision;

  if (!blocker && !decision) blocker = "个人额度窗口异常";
  const planningBehavior =
    planningDecision && usage
      ? codexResetBehaviorModel(receiver, usage, planningDecision, nowMs)
      : null;
  const behavior = decision ? planningBehavior : null;
  const accountPlans = usages.map((accountUsage) => {
    const accountReceiver = codexResetReceiverAccountForUsage(receiverAccounts, accountUsage);
    const accountForecast = receiver
      ? codexResetForecastModel(
          forecastPayload,
          feedPayload,
          {
            ...receiver,
            activeAccountId: accountReceiver ? accountReceiver.id : accountUsage.accountId,
            lastPersonalReset: accountReceiver ? accountReceiver.lastPersonalReset : null,
          },
          nowMs,
        ) || forecast
      : forecast;
    const accountTrajectory = codexResetTargetTrajectory(
      accountReceiver || {},
      accountUsage,
      accountUsage.resetsAtMs,
      nowMs,
    );
    const accountDecision =
      accountUsage.exact && accountUsage.fresh && accountForecast
        ? codexResetComputeDecision({
            nowMs,
            usedPercent: accountUsage.usedPercent,
            resetsAtMs: accountUsage.resetsAtMs,
            windowMinutes: accountUsage.windowMinutes,
            p24: accountForecast.p24,
            p48: accountForecast.p48,
            commitmentFloor: accountForecast.commitmentFloor,
            signal: accountForecast.signal,
            forecastUsable: accountForecast.fresh,
            plannedRemainingNow: accountTrajectory && accountTrajectory.remainingPercent,
          })
        : null;
    const accountBehavior = accountDecision
      ? codexResetBehaviorModel(accountReceiver || {}, accountUsage, accountDecision, nowMs)
      : null;
    const accountPace = codexResetPaceModel(accountReceiver || {});
    const capacityEstimate = codexResetCapacityEstimate(accountReceiver, accountUsage.planType);
    const fullCapacityUSD = codexResetFinite(capacityEstimate && capacityEstimate.estimateUSD);
    const observedRate =
      codexResetFinite(accountPace && accountPace.long && accountPace.long.ratePerHour) ??
      codexResetFinite(accountPace && accountPace.short && accountPace.short.ratePerHour);
    const requiredWorkHours =
      accountDecision && observedRate !== null && observedRate > 0.01
        ? accountDecision.additionalTotal / observedRate
        : null;
    const cycleStartMs = accountUsage.resetsAtMs - accountUsage.windowMinutes * 60_000;
    const elapsedHours = Math.max(1, (nowMs - cycleStartMs) / 3_600_000);
    const cycleAverageRate = codexResetClamp(accountUsage.usedPercent / elapsedHours, 0, 20);
    const projectionRate = observedRate === null ? cycleAverageRate : observedRate;
    const explicitForcedDeadlineMs =
      accountForecast && accountForecast.signal && accountForecast.signal.level === "explicit" &&
      Number.isFinite(accountForecast.signal.deadlineMs) && accountForecast.signal.deadlineMs > nowMs
        ? accountForecast.signal.deadlineMs
        : null;
    const explicitForcedWindowStartMs =
      explicitForcedDeadlineMs !== null && Number.isFinite(accountForecast.signal.windowStartMs)
        ? accountForecast.signal.windowStartMs
        : explicitForcedDeadlineMs;
    const explicitForcedWindowEndMs =
      explicitForcedDeadlineMs !== null && Number.isFinite(accountForecast.signal.windowEndMs)
        ? accountForecast.signal.windowEndMs
        : explicitForcedDeadlineMs;
    const freeResetDeadlineMs = explicitForcedDeadlineMs !== null
      ? Math.min(accountUsage.resetsAtMs, explicitForcedDeadlineMs)
      : accountUsage.resetsAtMs;
    const freeResetSource = explicitForcedDeadlineMs !== null && explicitForcedDeadlineMs < accountUsage.resetsAtMs
      ? "announced-forced"
      : "natural";
    const hoursToFreeReset = Math.max(0, (freeResetDeadlineMs - nowMs) / 3_600_000);
    const projectedRemainingAtFreeResetPercent = codexResetClamp(
      100 - accountUsage.usedPercent - projectionRate * hoursToFreeReset,
      0,
      100,
    );
    const atRiskCapacityUSD = fullCapacityUSD === null
      ? null
      : fullCapacityUSD * projectedRemainingAtFreeResetPercent / 100;
    return {
      id: accountUsage.accountId,
      label: accountUsage.accountLabel,
      live:
        accountUsage.accountLive === true ||
        (accountUsage.accountLive === null && usage && accountUsage.accountId === usage.accountId),
      selected: accountUsage.accountSelected,
      planType: accountUsage.planType,
      planLabel: codexResetPlanLabel(accountUsage.planType),
      usage: accountUsage,
      forecast: accountForecast,
      decision: accountDecision,
      behavior: accountBehavior,
      cyclePhase: !accountDecision ? "unknown" : accountDecision.targetReached ? "target-met"
        : accountDecision.baselineNow <= 8 && accountUsage.usedPercent < Math.min(20, accountDecision.targetUsed)
          ? "cycle-start" : "below-target",
      trend: accountBehavior && accountBehavior.prediction
        ? codexResetBehaviorZone(accountDecision, accountBehavior.prediction) : "unknown",
      targetTrajectory: accountTrajectory,
      pace: accountPace,
      capacityEstimate,
      fullCapacityUSD,
      capacitySource: capacityEstimate && capacityEstimate.source,
      capacityConfidence: capacityEstimate && capacityEstimate.confidence,
      remainingCapacityUSD:
        fullCapacityUSD === null ? null : fullCapacityUSD * (100 - accountUsage.usedPercent) / 100,
      targetGapCapacityUSD:
        fullCapacityUSD === null || !accountDecision
          ? null
          : fullCapacityUSD * accountDecision.additionalTotal / 100,
      subscriptionRenewsAtMs:
        codexResetMillis(accountReceiver && accountReceiver.subscriptionRenewsAt) ??
        accountUsage.subscriptionRenewsAtMs,
      subscriptionExpiresAtMs:
        codexResetMillis(accountReceiver && accountReceiver.subscriptionExpiresAt) ??
        accountUsage.subscriptionExpiresAtMs,
      cooldown: codexResetObject(accountReceiver && accountReceiver.cooldown),
      resetCredits: codexResetObject(accountReceiver && accountReceiver.resetCredits),
      personalResets: Array.isArray(accountReceiver && accountReceiver.personalResets)
        ? accountReceiver.personalResets
        : [],
      lastPersonalReset: codexResetObject(accountReceiver && accountReceiver.lastPersonalReset),
      usable:
        accountUsage.usedPercent < 99 &&
        (!accountUsage.shortWindow || accountUsage.shortWindow.usedPercent < 99),
      requiredWorkHours,
      projectionRate,
      freeResetDeadlineMs,
      freeResetSource,
      freeResetWindowStartMs:
        freeResetSource === "announced-forced" ? explicitForcedWindowStartMs : freeResetDeadlineMs,
      freeResetWindowEndMs:
        freeResetSource === "announced-forced" ? explicitForcedWindowEndMs : freeResetDeadlineMs,
      explicitForcedResetAtMs: explicitForcedDeadlineMs,
      explicitForcedWindowStartMs,
      explicitForcedWindowEndMs,
      hoursToFreeReset,
      projectedRemainingAtFreeResetPercent,
      atRiskCapacityUSD,
      lossUrgency: atRiskCapacityUSD === null
        ? null
        : atRiskCapacityUSD / Math.max(1, hoursToFreeReset),
    };
  });
  const activeAccount = accountPlans.find((item) => item.live) || null;
  const selectedAccount = accountPlans.find((item) => item.selected) || null;
  const rankedAccounts = accountPlans
    .filter((item) => item.decision && item.usable && Number.isFinite(item.lossUrgency))
    .slice()
    .sort((left, right) => right.lossUrgency - left.lossUrgency);
  const blockedFallback = activeAccount && !activeAccount.usable
    ? accountPlans
        .filter((item) => item.id !== activeAccount.id && item.decision && item.usable)
        .slice()
        .sort((left, right) => {
          if (left.remainingCapacityUSD !== null || right.remainingCapacityUSD !== null) {
            return (right.remainingCapacityUSD ?? -Infinity) - (left.remainingCapacityUSD ?? -Infinity);
          }
          return (100 - right.usage.usedPercent) - (100 - left.usage.usedPercent);
        })[0] || null
    : null;
  const capacityPriority = activeAccount
    ? rankedAccounts.find((candidate) => {
        if (candidate.id === activeAccount.id || candidate.atRiskCapacityUSD === null) return false;
        const materialLoss = candidate.atRiskCapacityUSD >= Math.max(10, candidate.fullCapacityUSD * 0.1);
        const earlierExpiry = candidate.freeResetDeadlineMs + 2 * 3_600_000 < activeAccount.freeResetDeadlineMs;
        const sameForcedDeadline =
          candidate.freeResetSource === "announced-forced" &&
          activeAccount.freeResetSource === "announced-forced" &&
          Math.abs(candidate.freeResetDeadlineMs - activeAccount.freeResetDeadlineMs) <= 60_000 &&
          candidate.atRiskCapacityUSD > Math.max(5, (activeAccount.atRiskCapacityUSD || 0) * 1.2);
        return materialLoss && candidate.hoursToFreeReset <= 72 && (earlierExpiry || sameForcedDeadline);
      }) || null
    : null;
  const recommendedAccount = blockedFallback || capacityPriority;
  const switchReason = blockedFallback
    ? "current-blocked"
    : activeAccount && capacityPriority && activeAccount.id !== capacityPriority.id
      ? "capacity-at-risk"
      : null;
  const devicePlan = {
    accountCount: accountPlans.length,
    readyCount: accountPlans.filter((item) => item.decision).length,
    pendingCount: accountPlans.filter(
      (item) => item.decision && item.decision.additionalTotal > 0.05,
    ).length,
    activeAccountId: activeAccount && activeAccount.id,
    selectedAccountId: selectedAccount && selectedAccount.id,
    recommendedAccountId: recommendedAccount && recommendedAccount.id,
    shouldSwitch: Boolean(accountPlans.length > 1 && switchReason),
    switchReason,
    switchProof: switchReason === "capacity-at-risk" && activeAccount && capacityPriority
      ? {
          currentAccountId: activeAccount.id,
          currentAtRiskCapacityUSD: activeAccount.atRiskCapacityUSD,
          recommendedAtRiskCapacityUSD: capacityPriority.atRiskCapacityUSD,
          recommendedResetAtMs: capacityPriority.freeResetDeadlineMs,
          recommendedResetSource: capacityPriority.freeResetSource,
          capacitySource: capacityPriority.capacitySource,
          capacityConfidence: capacityPriority.capacityConfidence,
        }
      : null,
  };
  const subscriptionAdvice = accountPlans
    .map((candidate) => {
      const renewalAtMs = candidate.subscriptionRenewsAtMs || candidate.subscriptionExpiresAtMs;
      if (
        !renewalAtMs ||
        renewalAtMs <= nowMs ||
        candidate.usage.usedPercent < 99 ||
        candidate.usage.resetsAtMs <= renewalAtMs
      ) {
        return null;
      }
      return {
        accountId: candidate.id,
        accountLabel: candidate.label,
        renewalAtMs,
        oldCooldownEndsAtMs: candidate.usage.resetsAtMs,
        action: "cancel-before-renewal",
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.renewalAtMs - right.renewalAtMs)[0] || null;
  const sessionSuggestions = codexResetSessionSuggestions(receiver);
  const bankedPlan = codexResetBankedPlan(
    activeAccount,
    accountPlans,
    receiver,
    behavior,
    nowMs,
    forecast,
  );
  const workAction = bankedPlan && bankedPlan.creditAction === "redeem"
    ? "hold"
    : decision
      ? decision.immediate
        ? "fast"
        : behavior && behavior.prediction && codexResetBehaviorZone(decision, behavior.prediction) === "behind"
          ? "accelerate"
          : bankedPlan && bankedPlan.status === "must-form-node"
            ? "accelerate"
            : decision.targetReached
              ? "standard"
              : "continue"
      : "hold";
  const capacityPlan = {
    version: 1,
    workAction,
    creditAction: bankedPlan ? bankedPlan.creditAction : "hold",
    accountAction:
      devicePlan.shouldSwitch && recommendedAccount
        ? `consider-switch:${recommendedAccount.id}`
        : "stay",
    nextExternalResetAtMs: activeAccount && activeAccount.freeResetDeadlineMs,
    nextExternalResetSource: activeAccount && activeAccount.freeResetSource,
    creditValuationMethod: bankedPlan && bankedPlan.valuationMethod,
  };
  const actions = capacityPlan;
  return {
    usage,
    forecast,
    decision,
    planningDecision,
    planningBehavior,
    targetTrajectory,
    pace,
    shortLoad,
    behavior,
    accounts: accountPlans,
    devicePlan,
    bankedPlan,
    capacityPlan,
    subscriptionAdvice,
    actions,
    sessionSuggestions,
    blocker,
    receiver,
  };
}

defineProvider({
  id: "codex-reset-forecast",
  name: "Codex Capacity Planner",
  icon: { monogram: "✦", tint: "#A78BFA" },
  menuProviders: ["codex"],
  endpoints: [
    "https://codex-reset.com",
    { setting: "CODEX_RESET_SIGNAL_BASE_URL", policy: "https-only" },
    { setting: "CODEXBAR_BRIDGE_URL", policy: "https-or-loopback-http" },
  ],
  settings: [
    {
      key: "CODEX_RESET_SIGNAL_BASE_URL",
      title: "重置信号服务（可选）",
      subtitle: "留空使用 https://codex-reset.com；不可用时仍按本机自然刷新规划",
      type: "plain",
    },
    {
      key: "CODEXBAR_BRIDGE_URL",
      title: "本机 Codex Capacity Planner 服务",
      subtitle: "填写 http://127.0.0.1:18765；个人额度始终只在本机计算",
      type: "plain",
    },
  ],

  async fetchUsage(ctx) {
    function clip(value, limit) {
      const text = String(value == null ? "" : value).trim();
      return text.length <= limit ? text : `${text.slice(0, Math.max(0, limit - 1))}…`;
    }

    function signalTeaser(value, limit) {
      const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
      return clip(text, typeof limit === "number" ? limit : 112);
    }

    function completeHomeText(value, limit, fallback) {
      const text = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
      return text.length <= limit ? text : fallback;
    }

    function candidateChineseSummary(summary, localizedSummary) {
      const localized = signalTeaser(localizedSummary, 112);
      if (localized) return localized;
      const original = signalTeaser(summary, 112);
      const normalized = original.toLowerCase();
      if (normalized.includes("soon") && normalized.includes("not today")) {
        return "Tibo 说“很快，但不是今天”";
      }
      return original ? "Tibo 发出了可能近期刷新的暗示" : "Tibo 暗示可能很快刷新";
    }

    function signalSecondary(summary, metadata) {
      const suffix = ` · ${metadata}`;
      const summaryLimit = Math.max(24, 120 - suffix.length);
      const concise = completeHomeText(
        summary,
        summaryLimit,
        "Tibo 发布了新的重置消息，完整内容见重置页",
      );
      return `${concise}${suffix}`;
    }

    function appendPlanReason(existing, clause) {
      const base = String(existing == null ? "" : existing)
        .trim()
        .replace(/[。；;]+$/, "");
      return base ? `${base}；${clause}` : clause;
    }

    function percent(value, digits) {
      const places = typeof digits === "number" ? digits : 0;
      return `${Math.max(0, value).toFixed(places)}%`;
    }

    function compactTokens(value) {
      const tokens = Math.max(0, Number(value) || 0);
      if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(tokens >= 10_000_000 ? 0 : 1)}M`;
      if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(tokens >= 100_000 ? 0 : 1)}K`;
      return `${Math.round(tokens)}`;
    }

    function twoDigits(value) {
      return String(Math.max(0, Math.min(23, Math.round(value)))).padStart(2, "0");
    }

    function utc8(valueMs) {
      if (!Number.isFinite(valueMs)) return "—";
      const shifted = new Date(valueMs + 8 * 60 * 60 * 1000);
      return `${shifted.toISOString().slice(5, 16).replace("T", " ")} UTC+8`;
    }

    function candidateWindowUTC8(startMs, endMs) {
      const start = Number.isFinite(startMs) ? new Date(startMs + 8 * 60 * 60 * 1000) : null;
      const end = Number.isFinite(endMs) ? new Date(endMs + 8 * 60 * 60 * 1000) : start;
      if (!start || !end) return "有可能重置，但目前无法确定时间";
      const startMonth = start.getUTCMonth() + 1;
      const startDay = start.getUTCDate();
      const endMonth = end.getUTCMonth() + 1;
      const endDay = end.getUTCDate();
      const range = startMonth === endMonth && startDay === endDay
        ? `${startMonth}月${startDay}日`
        : startMonth === endMonth
          ? `${startMonth}月${startDay}日至${endDay}日`
          : `${startMonth}月${startDay}日至${endMonth}月${endDay}日`;
      return `可能在 ${range}刷新（UTC+8）`;
    }

    function compactCandidateWindowUTC8(startMs, endMs) {
      const full = candidateWindowUTC8(startMs, endMs);
      const match = full.match(/^可能在 (.+)刷新（UTC\+8）$/);
      return match ? `${match[1]}（UTC+8）` : "时间暂不确定";
    }

    function sourceDate(valueMs, locale, timeZone) {
      if (!Number.isFinite(valueMs)) return "";
      return new Intl.DateTimeFormat(locale, {
        month: "short",
        day: "2-digit",
        timeZone,
      }).format(new Date(valueMs));
    }

    function sourceLink(kind, valueMs, url) {
      if (!url) return null;
      const labels = {
        candidate: ["查看可能重置暗示原帖", "View possible-reset source"],
        commitment: ["查看重置承诺原帖", "View reset commitment source"],
        announcement: ["查看重置公告原帖", "View reset announcement source"],
        confirmation: ["查看重置确认原帖", "View reset confirmation source"],
        credit: ["查看重置券公告原帖", "View reset credit source"],
        history: ["查看对应重置公告原帖", "View matching reset source"],
      };
      const [label, labelEnglish] = labels[kind] || labels.announcement;
      const chineseDate = sourceDate(valueMs, "zh-CN", "Asia/Shanghai");
      const englishDate = sourceDate(valueMs, "en-US", "America/Los_Angeles");
      return {
        label: chineseDate ? `${label} · ${chineseDate}` : label,
        labelEnglish: englishDate ? `${labelEnglish} · ${englishDate} PT` : labelEnglish,
        url,
      };
    }

    function updatedFreshness(valueMs) {
      if (!Number.isFinite(valueMs)) return "尚未更新";
      const elapsedMs = Math.max(0, ctx.date.now().getTime() - valueMs);
      if (elapsedMs < 60_000) return "刚刚更新";
      const elapsedMinutes = Math.max(1, Math.floor(elapsedMs / 60_000));
      if (elapsedMinutes < 60) return `${elapsedMinutes} 分钟前更新`;
      const elapsedHours = Math.max(1, Math.floor(elapsedMinutes / 60));
      return elapsedHours < 24 ? `${elapsedHours} 小时前更新` : `更新于 ${utc8(valueMs)}`;
    }

    function confidence(value) {
      if (value === "high") return "高可信度";
      if (value === "medium") return "中可信度";
      if (value === "low") return "低可信度";
      return "可信度未知";
    }

    function downside(value) {
      if (value < 0.05) return "不额外透支后续可用时间";
      if (value < 36) return `若没刷新，相当于提前约 ${Math.max(1, Math.round(value))} 小时使用`;
      return `若没刷新，相当于提前约 ${(value / 24).toFixed(1)} 天使用`;
    }

    function stateTime(value) {
      return codexResetMillis(value);
    }

    function resetCauseLabel(value) {
      return {
        automatic: "自然刷新",
        "banked-redeem": "重置券兑换",
        "global-manual": "强制刷新",
        upgrade: "套餐升级刷新",
      }[String(value || "").toLowerCase()] || "强制刷新";
    }

    function notificationReasonLabel(value) {
      const normalized = String(value || "").toLowerCase();
      if (normalized === "global") return "明确强制重置公告";
      if (normalized === "global-catch-up") return "明确强制重置公告（补发）";
      if (normalized === "personal-landed") return "个人额度到账";
      if (normalized === "banked-redeem") return "进入券兑换窗口";
      if (normalized === "banked-window") return "券窗口提前";
      if (normalized === "banked-arrived") return "重置券到账";
      if (normalized === "banked-announced") return "重置券公告";
      if (normalized === "commitment") return "有期限承诺";
      if (normalized.startsWith("capacity-")) return "有效容量变化";
      if (normalized.startsWith("behavior-")) return "使用节奏变化";
      if (normalized === "forecast") return "预测上调";
      return normalized || "未知";
    }

    const bridgeSetting = codexResetText(ctx.settings.get("CODEXBAR_BRIDGE_URL"));
    const bridgeBase = bridgeSetting ? bridgeSetting.replace(/\/+$/, "") : "";
    if (bridgeBase) {
      try {
        const snapshotResponse = await ctx.http.getJSON(`${bridgeBase}/api/snapshot`, {
          headers: { accept: "application/json" },
          timeoutSeconds: 5,
        });
        const snapshot = codexResetObject(snapshotResponse.json);
        if (
          snapshot &&
          Array.isArray(snapshot.details) &&
          Array.isArray(snapshot.submenuDetails)
        ) {
          return snapshot;
        }
      } catch (snapshotError) {
        ctx.log("Fast local snapshot unavailable; rebuilding from component data", snapshotError);
      }
    }
    let usagePayload = null;
    let receiverPayload = null;
    let bridgeError = null;
    let usageSource = "none";
    if (bridgeBase) {
      try {
        const stateResponse = await ctx.http.getJSON(`${bridgeBase}/api/state`, {
          headers: { accept: "application/json" },
          timeoutSeconds: 3,
        });
        receiverPayload = codexResetObject(stateResponse.json);
      } catch (stateError) {
        ctx.log("Optional local receiver state unavailable", stateError);
      }
      try {
        const usageResponse = await ctx.http.getJSON(`${bridgeBase}/usage?provider=codex`, {
          headers: { accept: "application/json" },
          timeoutSeconds: 6,
        });
        usagePayload = usageResponse.json;
        usageSource = "live";
      } catch (usageError) {
        bridgeError = String(usageError && usageError.message ? usageError.message : usageError);
        usagePayload = codexResetUsagePayloadFromReceiver(receiverPayload);
        usageSource = usagePayload ? "last-good" : "none";
        ctx.log("Live Codex usage unavailable; considering last-good local snapshot", usageError);
      }
    }

    const cached = codexResetObject(receiverPayload && receiverPayload.cache);
    const signalBaseSetting = codexResetText(ctx.settings.get("CODEX_RESET_SIGNAL_BASE_URL"));
    const signalBase = (signalBaseSetting || "https://codex-reset.com").replace(/\/+$/, "");
    let forecastPayload = codexResetObject(cached && cached.forecast);
    let feedPayload = codexResetObject(cached && cached.feed);
    if (!forecastPayload) {
      try {
        const timeZone = encodeURIComponent("Asia/Singapore");
        const forecastResponse = await ctx.http.getJSON(
          `${signalBase}/api/forecast?locale=zh&tz=${timeZone}`,
          { headers: { accept: "application/json" }, timeoutSeconds: 15 },
        );
        forecastPayload = codexResetObject(forecastResponse.json);
      } catch (error) {
        ctx.log("Optional reset forecast unavailable; using local-only planning", error);
        forecastPayload = codexResetLocalOnlyForecast(ctx.date.now().getTime());
      }
    }
    if (!forecastPayload) {
      throw ctx.fail.parseFailure("codex-reset.com forecast response was not an object");
    }
    if (!feedPayload) {
      try {
        const feedResponse = await ctx.http.getJSON(`${signalBase}/api/feed?locale=zh`, {
          headers: { accept: "application/json" },
          timeoutSeconds: 15,
        });
        feedPayload = codexResetObject(feedResponse.json);
      } catch (error) {
        ctx.log("Optional Tibo feed unavailable", error);
      }
    }

    const nowMs = ctx.date.now().getTime();
    const model = codexResetBuildModel(
      usagePayload,
      forecastPayload,
      feedPayload,
      nowMs,
      receiverPayload,
    );
    model.usageSource = usageSource;
    model.usageReadError = bridgeError;
    if (!model.usage && bridgeError) model.blocker = `本机服务失败：${clip(bridgeError, 72)}`;
    const forecast = model.forecast;
    if (!forecast || forecast.p24 === null || forecast.p48 === null) {
      throw ctx.fail.parseFailure("codex-reset.com forecast response had no usable probabilities");
    }

    const receiverEvent =
      codexResetObject(model.receiver && model.receiver.activeEpisode) ||
      codexResetObject(model.receiver && model.receiver.currentEvent);
    const completedPublicEvents = Array.isArray(
      model.receiver && model.receiver.completedPublicEvents,
    )
      ? model.receiver.completedPublicEvents
      : [];
    const bankedCampaign = codexResetObject(model.receiver && model.receiver.bankedCampaign);
    const accountDelivery = codexResetObject(receiverEvent && receiverEvent.account_delivery) || {};
    const deliveryValues = Object.values(accountDelivery);
    const deliveredAccounts = deliveryValues.filter((value) => value === "landed").length;
    const receiverEventLabel = receiverEvent
      ? `明确重置公告${deliveryValues.length ? ` · ${deliveredAccounts}/${deliveryValues.length} 账号到账` : ""}`
      : null;
    const lastPersonalReset = codexResetObject(model.receiver && model.receiver.lastPersonalReset);
    const signalLabel =
      forecast.signal.level === "explicit"
        ? `明确重置公告${deliveryValues.length ? ` · ${deliveredAccounts}/${deliveryValues.length} 账号到账` : ""}`
        : forecast.signal.level === "commitment"
          ? forecast.signal.deadlineMs ? "有期限承诺" : "重置承诺 · 时间未定"
          : forecast.signal.level === "hint"
            ? "可能重置的暗示"
            : "无强制重置预告";
    const signalWindowIsInferred =
      forecast.signal.level === "hint" && forecast.signal.windowProvenance === "inferred";
    const signalHasDeadline = forecast.signal.timingKind === "deadline";
    const displayedSignalDeadlineMs = signalHasDeadline && Number.isFinite(forecast.signal.deadlineMs)
      ? Math.ceil(forecast.signal.deadlineMs / 60_000) * 60_000
      : forecast.signal.deadlineMs;
    const commonHours =
      forecast.commonStartHour !== null && forecast.commonEndHour !== null
        ? `${twoDigits(forecast.commonStartHour)}:00–${twoDigits(forecast.commonEndHour)}:00 UTC+8`
        : "时段未知";
    const health = codexResetObject(model.receiver && model.receiver.health);
    const push = codexResetObject(model.receiver && model.receiver.push);
    const notificationDelivery = codexResetObject(
      model.receiver && model.receiver.notificationDelivery,
    );
    const usingLastGoodUsage = model.usageSource === "last-good" && Boolean(model.usage);
    const actionRows = [];
    const sessionSuggestions = model.sessionSuggestions;
    const mainlineSuggestions = sessionSuggestions && Array.isArray(sessionSuggestions.mainlines)
      ? sessionSuggestions.mainlines
      : [];
    const mainlineTokenWindowLabel =
      sessionSuggestions && sessionSuggestions.tokenSource === "observation-fallback"
        ? "本机观察期"
        : "近 24 小时";
    const shortLoad = model.shortLoad;
    const shortLoadPrediction = shortLoad && shortLoad.prediction;
    const currentAccount = model.accounts.find((account) => account.live) || null;
    const selectedAccount = model.accounts.find((account) => account.selected) || null;
    let showMainlineSuggestions = false;
    let suggestionLimit = 0;
    let visibleMainlineSuggestions = [];
    let whyReasonText = null;
    let whyActionText = null;
    let decisionProgress = null;
    let accountSummaryRow = null;
    let creditSummaryRow = null;

    if (currentAccount) {
      accountSummaryRow = {
        label: "账户",
        value: `${currentAccount.label} · ${currentAccount.planLabel}`,
        secondaryValue:
          selectedAccount && selectedAccount.id !== currentAccount.id
            ? `CodexBar 当前查看：${selectedAccount.label} · ${selectedAccount.planLabel}`
            : currentAccount.fullCapacityUSD === null
              ? "完整容量正在按本机 API 等价成本学习；套餐倍率不参与计算"
              : `完整周容量约 $${currentAccount.fullCapacityUSD.toFixed(0)} API 等价 · ${codexResetCapacitySourceLabel(currentAccount.capacitySource)}`,
      };
    }

    if (model.bankedPlan) {
      const banked = model.bankedPlan;
      const currentCreditCount = banked.currentAccountAvailableCount;
      const actionLabel = {
        "awaiting-delivery": "等待券到账",
        hold: "暂不兑换",
        prepare: "留意兑换窗口",
        redeem: "现在兑换",
      }[banked.creditAction] || "继续观察";
      const campaignDelivery = Object.values(
        codexResetObject(bankedCampaign && bankedCampaign.accountDelivery) || {},
      );
      const campaignDelivered = campaignDelivery.filter((value) => value === "delivered").length;
      const deliverySuffix = campaignDelivery.length
        ? ` · ${campaignDelivered}/${campaignDelivery.length} 个账号`
        : "";
      creditSummaryRow = banked.creditAction === "awaiting-delivery" || currentCreditCount > 0 ? {
        label: currentCreditCount > 0 ? "可用重置" : "重置",
        value:
          banked.creditAction === "awaiting-delivery"
            ? banked.officialState === "available"
              ? `重置券官方已生效 · 当前账号待确认${deliverySuffix}`
              : `重置券等待到账${deliverySuffix}`
            : currentCreditCount > 0
              ? `${currentCreditCount} 次可用`
              : `重置券 · ${actionLabel}`,
        secondaryValue:
          banked.creditAction === "awaiting-delivery" && banked.officialState === "available"
            ? banked.status === "inventory-unavailable"
              ? "Tibo 已确认发券生效；当前账号库存暂时读不到，不代表官方仍未发放"
              : "Tibo 已确认发券生效；当前账号尚未读到新券，不代表官方仍未发放"
          : currentCreditCount > 0
            ? `当前账号持有${
                banked.currentAccountExpiresAtMs
                  ? ` · 最早 ${utc8(banked.currentAccountExpiresAtMs)} 到期`
                  : ""
              }`
            : banked.status === "awaiting-delivery"
              ? "Tibo 已宣布赠送重置券；不会强制刷新，到账前保持原计划"
              : banked.status === "inventory-unavailable"
                ? "库存暂时读不到；保留上次可靠状态，不把失败当成 0 张"
                : "当前没有可用券",
      } : null;
    }

    if (model.decision) {
      const decision = model.decision;
      const behavior = model.behavior;
      const prediction = behavior && behavior.prediction;
      const behaviorZone = prediction ? codexResetBehaviorZone(decision, prediction) : "unknown";
      const targetReached = decision.targetReached === true;
      suggestionLimit = codexResetSuggestionLimit(
        decision,
        prediction,
        model.usage.usedPercent,
      );
      visibleMainlineSuggestions = mainlineSuggestions.slice(0, suggestionLimit);
      showMainlineSuggestions = visibleMainlineSuggestions.length > 0;
      const deadlineLabel = decision.immediate ? "现在" : utc8(decision.deadlineMs);
      const progressTitle = decision.immediate
        ? "现在的使用计划 · Tibo 已明确"
        : ["automatic", "explicit-after-natural"].includes(decision.mode)
          ? `自动刷新前的使用计划 · ${deadlineLabel}`
          : ["explicit", "commitment"].includes(decision.mode)
              ? `Tibo 窗口前的使用计划 · ${deadlineLabel}`
              : `近期使用计划 · ${deadlineLabel}`;
      const alternateProgressTitle = !decision.immediate &&
        !["automatic", "explicit-after-natural", "explicit", "commitment"].includes(decision.mode)
        ? "近期使用计划 · 未来 24 小时"
        : null;

      let recommendationValue;
      let recommendationSecondary;
      const unfilledMainlineNote = visibleMainlineSuggestions.length < suggestionLimit
        ? visibleMainlineSuggestions.length
          ? `只识别出 ${visibleMainlineSuggestions.length} 条可靠主线，不会用临时 session 凑满；其余容量可安排新增有价值任务。`
          : "当前没有足够可靠的主线，不会拿最近 session 凑数；可安排新增有价值任务。"
        : null;
      if (targetReached) {
        recommendationValue = visibleMainlineSuggestions.length
          ? "只保留最重要的 1 条主线，保持 Standard"
          : "目标已经达到，保持 Standard";
        recommendationSecondary =
          "当前用量已经越过本轮目标，无需再为刷新风险额外加速。";
      } else if (decision.immediate) {
        recommendationValue = visibleMainlineSuggestions.length
          ? `优先继续以下 ${visibleMainlineSuggestions.length} 条可靠主线`
          : "新增有价值任务，需要时开启 Fast";
        recommendationSecondary =
          "明确重置公告尚未在当前账号到账，剩余容量可能很快清零。";
      } else if (prediction) {
        if (behaviorZone === "behind") {
          recommendationValue = visibleMainlineSuggestions.length
            ? `优先继续以下 ${visibleMainlineSuggestions.length} 条可靠主线`
            : "新增有价值任务，仍不足时开启 Fast";
          recommendationSecondary =
            "按近期自然使用趋势仍可能达不到目标；先继续持续推进的主线，仍不足再开启 Fast。";
        } else if (behaviorZone === "covered") {
          recommendationValue = visibleMainlineSuggestions.length
            ? "只保留最重要的 1 条主线，保持 Standard"
            : "自然趋势已经超过目标，保持 Standard";
          recommendationSecondary =
            "近期自然使用趋势已经越过目标，不需要继续加速。";
        } else {
          recommendationValue = visibleMainlineSuggestions.length
            ? `保持当前节奏，优先继续以下 ${visibleMainlineSuggestions.length} 条主线`
            : "保持当前节奏";
          recommendationSecondary =
            "近期自然使用范围已经覆盖目标，正常推进即可。";
        }
      } else {
        recommendationValue = visibleMainlineSuggestions.length
          ? `优先继续以下 ${visibleMainlineSuggestions.length} 条可靠主线`
          : "按确定目标继续安排真实工作";
        recommendationSecondary = behavior
          ? `长期使用趋势${behavior.status === "stale" ? "已经过期" : "暂不可靠"}，当前不会拿短时速度冒充全天趋势。`
          : "长期使用趋势仍在学习，当前先按确定目标继续。";
      }

      const cycleStartMs =
        model.usage.resetsAtMs - model.usage.windowMinutes * 60_000;
      const cycleProgress = codexResetClamp(
        (nowMs - cycleStartMs) / Math.max(1, model.usage.windowMinutes * 60_000),
        0,
        1,
      );
      const cycleContext =
        cycleProgress <= 0.08 && model.usage.usedPercent < Math.min(20, decision.targetUsed)
          ? "本周期刚开始，当前用量还比较少。"
          : targetReached
            ? "当前用量已经达到本轮目标。"
            : "当前用量还没有达到本轮目标。";
      const trendContext = prediction
        ? behaviorZone === "behind"
          ? "按近期自然使用趋势，计划窗口结束时仍可能达不到目标。"
          : behaviorZone === "covered"
            ? "按近期自然使用趋势，计划窗口结束前大概率会超过目标。"
            : "近期自然使用范围已经覆盖目标。"
        : "长期自然使用趋势还没有形成可靠判断。";
      const resetContext =
        forecast.signal.level === "explicit"
          ? "同时存在尚未兑现的明确重置公告，剩余容量可能提前清零。"
          : forecast.signal.level === "commitment"
            ? forecast.signal.deadlineMs
              ? "同时存在带期限的重置承诺，提前刷新的风险高于平时。"
              : "官方承诺还会重置，但时间未定；先提前安排少量有价值工作，不把信号分数当作全天概率。"
            : forecast.signal.level === "hint"
              ? "目前只有一条可能重置的暗示，系统会提前安排少量额外用量，但不会把它当成确定刷新。"
              : forecast.p24 >= 60
                ? "当前没有未兑现的官方公告，但公开预测认为近期刷新可能性偏高。"
                : forecast.p24 >= 25
                  ? "当前没有未兑现的官方公告，计划仍保留了一定的近期刷新风险。"
                  : "当前没有未兑现的官方重置信号，计划主要依据自然刷新和本机使用趋势。";
      whyReasonText = `${cycleContext}${trendContext}${resetContext}`;
      const recommended = model.devicePlan.shouldSwitch
        ? model.accounts.find((item) => item.id === model.devicePlan.recommendedAccountId)
        : null;
      if (recommended) {
        recommendationValue = `切到 ${recommended.label} · ${recommended.planLabel} 继续工作`;
        recommendationSecondary = model.devicePlan.switchReason === "current-blocked"
          ? "当前账号额度或短窗口已经阻塞；该账号仍可工作。切号只需重新登录，不会自动执行"
          : "另一个账号在更早刷新前有更多真实容量可能被清掉；建议先在那里继续，但不会自动切号";
        whyReasonText = recommendationSecondary;
      } else if (model.bankedPlan && model.bankedPlan.status === "possible-reset-first") {
        const waitUntil = model.bankedPlan.possibleResetWindowEndMs
          ? utc8(model.bankedPlan.possibleResetWindowEndMs)
          : "这条暗示得到确认或失效";
        recommendationSecondary = appendPlanReason(
          recommendationSecondary,
          `目前存在可能重置的时间范围，重置券先保留到 ${waitUntil}，届时按所有账号的最新额度重新计算`,
        );
        whyReasonText = recommendationSecondary;
      } else if (model.bankedPlan && model.bankedPlan.status === "account-data-unready") {
        recommendationSecondary = appendPlanReason(
          recommendationSecondary,
          "部分账号额度还没有同时完成新鲜、精确的确认，因此不会建议立即使用重置券",
        );
        whyReasonText = recommendationSecondary;
      } else if (model.bankedPlan && model.bankedPlan.status === "interruption-now") {
        recommendationValue = `所有账号都已阻塞，使用 ${model.bankedPlan.accountLabel || "当前账号"} 的重置券`;
        recommendationSecondary = "所有账号的新鲜额度都确认已经阻塞；系统比较了可能刷新与不刷新两种结果，只有两种情况下兑换都能承接足够真实工作才会这样建议。只提示，不自动兑换";
        whyReasonText = recommendationSecondary;
      } else if (model.bankedPlan && model.bankedPlan.status === "free-reset-first") {
        recommendationSecondary = appendPlanReason(
          recommendationSecondary,
          "更早的免费刷新会先到，重置券保持不动并在到账后重新规划",
        );
      } else if (
        model.bankedPlan &&
        model.bankedPlan.status === "must-form-node" &&
        !targetReached
      ) {
        recommendationValue = mainlineSuggestions.length
          ? "安排以下真实主线工作，提前形成安全兑换点"
          : "增加有价值工作，提前形成安全兑换点";
        recommendationSecondary = model.bankedPlan.expiresAtMs
          ? "重置券正在接近可用节点；先安排真实工作，同时保证其他账号容量和更早免费刷新优先使用"
          : "当前尚未形成安全兑换点；不制造任务，也不编造券到期时间";
        whyReasonText = recommendationSecondary;
      }
      if (unfilledMainlineNote && !targetReached) {
        recommendationSecondary = `${recommendationSecondary} ${unfilledMainlineNote}`;
      }
      whyActionText = recommendationValue;
      actionRows.push({
        label: "建议",
        value: recommendationValue,
        secondaryValue: recommendationSecondary,
      });
      decisionProgress = {
        title: progressTitle,
        alternateTitle: alternateProgressTitle,
        currentPercent: model.usage.usedPercent,
        targetPercent: decision.targetUsed,
        projectedPercent: prediction ? prediction.endpointMedian : null,
        projectedLowerPercent: prediction ? prediction.endpointLower : null,
        projectedUpperPercent: prediction ? prediction.endpointUpper : null,
        currentLabel: targetReached
          ? `当前 ${percent(model.usage.usedPercent, 1)} · 已达标`
          : `当前 ${percent(model.usage.usedPercent, 1)}`,
        targetLabel: `目标 ${percent(decision.targetUsed, 1)}`,
        projectedLabel: prediction
          ? `预计 ${percent(prediction.endpointLower, 1)}–${percent(
              prediction.endpointUpper,
              1,
            )} · 中心 ${percent(prediction.endpointMedian, 1)}`
          : decision.immediate
            ? "即时公告覆盖自然使用预测"
            : "自然使用预测暂不可用",
      };
    } else {
      actionRows.push({
        label: "建议暂不可用",
        value: model.blocker || "数据不足",
        secondaryValue: bridgeSetting
          ? "全局信号仍会继续监控"
          : "请在插件设置填写 http://127.0.0.1:18765",
      });
    }
    if (!decisionProgress && model.planningDecision && model.usage) {
      const decision = model.planningDecision;
      const behavior = model.planningBehavior;
      const prediction = behavior && behavior.prediction;
      decisionProgress = {
        title: `最近可靠计划 · ${updatedFreshness(model.usage.updatedAtMs)}`,
        currentPercent: model.usage.usedPercent,
        targetPercent: decision.targetUsed,
        projectedPercent: prediction ? prediction.endpointMedian : null,
        projectedLowerPercent: prediction ? prediction.endpointLower : null,
        projectedUpperPercent: prediction ? prediction.endpointUpper : null,
        currentLabel: `当前 ${percent(model.usage.usedPercent, 1)} · 最近可靠值`,
        targetLabel: `目标 ${percent(decision.targetUsed, 1)} · 参考`,
        projectedLabel: prediction
          ? `预计 ${percent(prediction.endpointLower, 1)}–${percent(
              prediction.endpointUpper,
              1,
            )} · 中心 ${percent(prediction.endpointMedian, 1)}（参考）`
          : "自然使用预测暂不可用 · 等待新鲜额度",
      };
    }

    if (showMainlineSuggestions && mainlineSuggestions.length) {
      for (const [index, mainline] of visibleMainlineSuggestions.entries()) {
        actionRows.push({
          label: `主线 ${index + 1}`,
          value: completeHomeText(
            mainline.label,
            120,
            "主线名称较长，完整名称见“建议主线”",
          ),
          secondaryValue: `建议继续 · ${mainline.reason}${
            mainline.source === "explicit" ? " · 你已确认" : " · 本机保守推断"
          }`,
        });
      }
    }
    if (model.subscriptionAdvice) {
      actionRows.push({
        label: "订阅",
        value: `在 ${utc8(model.subscriptionAdvice.renewalAtMs)} 前取消 ${model.subscriptionAdvice.accountLabel} 的自动续费`,
        secondaryValue: `该账号已用完，旧周冷却要到 ${utc8(model.subscriptionAdvice.oldCooldownEndsAtMs)}；续回同档也不会提前刷新。只提示，不自动取消或购买`,
      });
    }
    if (forecast.signal.level !== "none" || receiverEvent) {
      const receiverWindow = codexResetObject(
        receiverEvent && (receiverEvent.official_window || receiverEvent.window),
      );
      const resetLabel = forecast.signal.level !== "none"
        ? signalLabel
        : receiverEventLabel || "明确重置公告";
      const resetDeadlineMs = forecast.signal.level !== "none"
        ? forecast.signal.deadlineMs
        : stateTime(
            (receiverWindow && (receiverWindow.end_at || receiverWindow.endAt)) ||
              (receiverEvent && (receiverEvent.deadline_at || receiverEvent.deadlineAt)),
          );
      const resetPublishedAtMs = forecast.signal.level !== "none"
        ? forecast.signal.atMs
        : stateTime(receiverEvent && (receiverEvent.announced_at || receiverEvent.announcedAt));
      const resetSummary = forecast.signal.level !== "none"
        ? signalWindowIsInferred
          ? candidateChineseSummary(
              forecast.signal.summary,
              forecast.signal.localizedSummary,
            )
          : forecast.signal.localizedSummary || forecast.signal.summary
        : codexResetText(
            receiverEvent &&
              (receiverEvent.localized_summary ||
                receiverEvent.localizedSummary ||
                receiverEvent.summary),
          );
      const compactCandidateTime = compactCandidateWindowUTC8(
        forecast.signal.windowStartMs,
        forecast.signal.windowEndMs || resetDeadlineMs,
      );
      actionRows.push({
        label: "重置",
        value: signalWindowIsInferred
          ? `可能重置 · ${compactCandidateTime}`
          : resetDeadlineMs
            ? signalHasDeadline
              ? `${resetLabel} · 最晚 ${utc8(displayedSignalDeadlineMs)} 前`
              : `${resetLabel} · 约 ${utc8(resetDeadlineMs)}`
            : resetLabel,
        relativeTimeAt: resetDeadlineMs && !signalWindowIsInferred && !signalHasDeadline
          ? new Date(resetDeadlineMs).toISOString()
          : null,
        relativeTimePrefix: resetDeadlineMs && !signalWindowIsInferred && !signalHasDeadline
          ? `${resetLabel} · 约 `
          : null,
        secondaryValue: signalWindowIsInferred
          ? `${completeHomeText(
              resetSummary || "Tibo 暗示可能很快刷新",
              72,
              "Tibo 发出了可能近期刷新的暗示",
            )}；目前还不是正式公告。`
          : signalSecondary(
              resetSummary || "Tibo 发布了新的重置消息",
              resetDeadlineMs
                ? `截止 ${utc8(resetDeadlineMs)}`
                : `发布 ${utc8(resetPublishedAtMs)}`,
            ),
      });
    } else if (
      creditSummaryRow &&
      model.bankedPlan &&
      model.bankedPlan.creditAction === "awaiting-delivery"
    ) {
      actionRows.push(creditSummaryRow);
    } else if (model.usage) {
      const recent = currentAccount && currentAccount.lastPersonalReset;
      actionRows.push({
        label: "重置",
        value: `下次自然刷新 · ${utc8(model.usage.resetsAtMs)}`,
        relativeTimeAt: new Date(model.usage.resetsAtMs).toISOString(),
        relativeTimePrefix: "下次自然刷新 · ",
        secondaryValue: recent
          ? `最近一次：${resetCauseLabel(recent.cause)} · ${utc8(stateTime(recent.at))}`
          : "若先发生兑换、强制刷新或套餐升级，将从新周期重新计算",
      });
    }
    if (
      creditSummaryRow &&
      model.bankedPlan &&
      model.bankedPlan.currentAccountAvailableCount > 0
    ) {
      actionRows.push(creditSummaryRow);
    }
    if (accountSummaryRow) actionRows.push(accountSummaryRow);
    const capacityAlert = currentAccount && codexResetCapacityAnomalyLabel(
      currentAccount.capacityEstimate && currentAccount.capacityEstimate.anomaly,
    );
    if (capacityAlert && !["容量仍在校准"].includes(capacityAlert)) {
      const ratio = codexResetFinite(
        currentAccount.capacityEstimate && currentAccount.capacityEstimate.anomaly &&
        currentAccount.capacityEstimate.anomaly.ratio,
      );
      actionRows.push({
        label: "容量变化",
        value: capacityAlert,
        secondaryValue: ratio === null
          ? "已同时比较个人历史、同档账号和社区同期范围"
          : `当前有效容量约为比较基线的 ${percent(ratio * 100, 0)}；已排除刷新与套餐切换样本`,
      });
    }
    const mainRowPriority = {
      建议: 0,
      建议暂不可用: 0,
      订阅: 1,
      账户: 2,
      容量变化: 2,
      可用重置: 3,
      重置: 4,
    };
    actionRows.sort(
      (left, right) =>
        (left.label.startsWith("主线 ") ? 1 : (mainRowPriority[left.label] === undefined ? 9 : mainRowPriority[left.label])) -
        (right.label.startsWith("主线 ") ? 1 : (mainRowPriority[right.label] === undefined ? 9 : mainRowPriority[right.label])),
    );

    const submenuEventRows = [];
    const submenuCreditRows = [];
    const submenuAccountRows = [];
    const submenuForecastRows = [];
    const submenuDiagnosticRows = [];
    const resetTimelineItems = [];
    const resetCreditVisualizations = [];
    if (forecast.signal.level !== "none" || receiverEvent) {
      submenuEventRows.push({
        label: "当前状态",
        value: forecast.signal.level !== "none" ? signalLabel : receiverEventLabel,
        group: "official",
        secondaryValue:
          receiverEvent && codexResetSignalID(receiverEvent) === forecast.signal.id
            ? deliveredAccounts > 0
              ? "已到账账号恢复普通周期计划；只有尚未到账账号继续等待本机额度重建"
              : "全局事件仍在等待个人到账；本机额度周期推进后关闭"
            : forecast.signal.level === "explicit"
              ? "确认公告按 100% 处理；个人到账由本机额度另行确认"
            : forecast.signal.level === "commitment"
              ? forecast.signal.deadlineMs
                ? "沿用源站承诺权重，与同期限基础预测取较高值；信号分数不是已校准的实际命中率，也不表示已经到账"
                : "源站承诺仍有效，具体时间未知；保留基础预测，只采用已有的有界提前量，不假造官方截止时间"
              : `这条可能重置的暗示不改服务端概率；证据强度${
                  forecast.signal.signalScore === null
                    ? "只用于分级"
                    : ` ${forecast.signal.signalScore.toFixed(0)}/100 只用于分级`
                }，规划器独立预留届时剩余额度的 10%，这条暗示本身不会把目标推到 100%`,
      });
      const currentOfficialSummary = forecast.signal.level !== "none"
        ? signalWindowIsInferred
          ? candidateChineseSummary(
              forecast.signal.summary,
              forecast.signal.localizedSummary,
            )
          : forecast.signal.localizedSummary || forecast.signal.summary
        : codexResetText(
            receiverEvent &&
              (receiverEvent.localized_summary ||
                receiverEvent.localizedSummary ||
                receiverEvent.summary),
          );
      const currentOfficialAtMs = forecast.signal.level !== "none"
        ? forecast.signal.atMs
        : stateTime(receiverEvent && (receiverEvent.announced_at || receiverEvent.announcedAt));
      if (currentOfficialSummary) {
        submenuEventRows.push({
          label: signalWindowIsInferred ? "可能重置的消息摘要" : "官方摘要",
          value: signalTeaser(currentOfficialSummary, 180),
          group: "official",
          secondaryValue: signalWindowIsInferred
            ? `发布 ${utc8(currentOfficialAtMs)} · 这是有上下文的暗示，目前还不是正式公告`
            : `发布 ${utc8(currentOfficialAtMs)} · 完整原文与来源见下方`,
        });
      }
      if (forecast.signal.level !== "none" && forecast.signal.deadlineMs) {
        submenuEventRows.push({
          label: signalWindowIsInferred ? "可能重置的时间范围" : signalHasDeadline ? "官方承诺截止" : "官方预计时间",
          value: signalWindowIsInferred
            ? candidateWindowUTC8(
                forecast.signal.windowStartMs,
                forecast.signal.windowEndMs || forecast.signal.deadlineMs,
              )
            : signalHasDeadline ? `${utc8(displayedSignalDeadlineMs)} 前` : `约 ${utc8(forecast.signal.deadlineMs)}`,
          relativeTimeAt: signalWindowIsInferred || signalHasDeadline
            ? null
            : new Date(forecast.signal.deadlineMs).toISOString(),
          relativeTimePrefix: signalWindowIsInferred || signalHasDeadline ? null : "约 ",
          group: "official",
          secondaryValue: signalWindowIsInferred
            ? `根据原文与上下文推测，目前没有正式时间；原始表述：${
                forecast.signal.windowLabel || "未提供"
              }`
            : signalHasDeadline
              ? `源站表述：${forecast.signal.windowLabel || "未提供"}；这是最晚边界，不是准确到账时刻，未提供最早时间`
            : forecast.signal.windowLabel
              ? `官方原始表述：${forecast.signal.windowLabel}；保留近似含义，不伪造分钟精度`
              : "由官方消息中的日期、时间和时区换算；保留近似含义",
        });
      }
      if (deliveryValues.length && (!forecast.signal.id || codexResetSignalID(receiverEvent) === forecast.signal.id)) {
        submenuEventRows.push({
          label: "个人到账",
          value: `${deliveredAccounts}/${deliveryValues.length} 个账号已确认`,
          group: "official",
          secondaryValue: Object.entries(accountDelivery)
            .map(([accountID, state]) => {
              const candidate = model.accounts.find((item) => item.id === accountID);
              return `${candidate ? candidate.label : "账号"}：${state === "landed" ? "已到账" : "等待到账"}`;
            })
            .join(" · "),
        });
      }
      const timelineReceiverWindow = codexResetObject(
        receiverEvent && (receiverEvent.official_window || receiverEvent.window),
      );
      const timelineAtMs = forecast.signal.level !== "none"
        ? signalHasDeadline
          ? forecast.signal.deadlineMs
          : forecast.signal.level === "commitment" && !forecast.signal.deadlineMs
            ? null
          : forecast.signal.level === "hint"
          ? forecast.signal.windowStartMs
          : forecast.signal.windowStartMs || forecast.signal.deadlineMs || forecast.signal.atMs
        : stateTime(
            (timelineReceiverWindow &&
              (timelineReceiverWindow.start_at || timelineReceiverWindow.startAt)) ||
              (receiverEvent && (receiverEvent.effective_at || receiverEvent.effectiveAt)) ||
              (receiverEvent && (receiverEvent.announced_at || receiverEvent.announcedAt)),
          );
      const timelineEndAtMs = forecast.signal.level !== "none"
        ? signalHasDeadline || (forecast.signal.level === "hint" && !forecast.signal.windowStartMs)
          ? null
          : forecast.signal.windowEndMs || forecast.signal.deadlineMs
        : stateTime(
            (timelineReceiverWindow &&
              (timelineReceiverWindow.end_at || timelineReceiverWindow.endAt)) ||
              (receiverEvent && (receiverEvent.deadline_at || receiverEvent.deadlineAt)),
          );
      const currentAccountDelivery = currentAccount &&
        (!forecast.signal.id || codexResetSignalID(receiverEvent) === forecast.signal.id)
        ? codexResetText(accountDelivery[currentAccount.id]).toLowerCase()
        : "";
      const timelineState = forecast.signal.level === "hint"
        ? "inferred"
        : currentAccountDelivery === "landed"
          ? "confirmed"
          : "pending";
      const timelineSourceEnglish = forecast.signal.level !== "none"
        ? forecast.signal.summary || currentOfficialSummary
        : codexResetText(receiverEvent && receiverEvent.summary) || currentOfficialSummary;
      resetTimelineItems.push({
        id: `signal-${forecast.signal.id || currentOfficialAtMs || "current"}`,
        eventId: forecast.signal.id || codexResetSignalID(receiverEvent) || null,
        kind: forecast.signal.level === "hint"
          ? "candidate"
          : forecast.signal.level === "commitment"
            ? "commitment"
            : "announcement",
        state: timelineState,
        timingKind: forecast.signal.timingKind || null,
        title: forecast.signal.level === "hint"
          ? "可能重置的时间范围"
          : forecast.signal.level === "commitment"
            ? "有期限重置承诺"
            : "明确重置公告",
        detail: forecast.signal.level === "hint"
          ? `${signalTeaser(currentOfficialSummary || "Tibo 暗示可能很快刷新", 112)}；目前还不是正式公告。`
          : signalTeaser(currentOfficialSummary || "Tibo 发布了新的重置消息", 140),
        detailEnglish: forecast.signal.level === "hint"
          ? `Tibo said “${signalTeaser(timelineSourceEnglish || "soon, but not today", 96)}”; this is not an official announcement.`
          : signalTeaser(timelineSourceEnglish || "Tibo published a reset update", 140),
        badge: timelineState === "inferred"
          ? "推测"
          : timelineState === "confirmed"
            ? "已到账"
            : "等待到账",
        at: timelineAtMs ? new Date(timelineAtMs).toISOString() : null,
        endAt: timelineEndAtMs ? new Date(timelineEndAtMs).toISOString() : null,
        publishedAt: currentOfficialAtMs ? new Date(currentOfficialAtMs).toISOString() : null,
        link: null,
      });
    }
    if (forecast.signal.level !== "none") {
      submenuEventRows.push({
        label:
          forecast.signal.level === "explicit"
            ? "强制重置公告"
            : forecast.signal.level === "commitment"
              ? "重置承诺原文"
              : "可能重置暗示原文",
        value: clip([
          forecast.signal.summary,
          forecast.signal.localizedSummary && forecast.signal.localizedSummary !== forecast.signal.summary
            ? `中文摘要：${forecast.signal.localizedSummary}`
            : null,
        ].filter(Boolean).join("\n\n"), 1900),
        group: "official",
        secondaryValue: [
          `发布 ${utc8(forecast.signal.atMs)}`,
          forecast.signal.deadlineMs
            ? signalWindowIsInferred
              ? candidateWindowUTC8(
                  forecast.signal.windowStartMs,
                  forecast.signal.windowEndMs || forecast.signal.deadlineMs,
                )
              : signalHasDeadline
                ? `官方承诺截止 ${utc8(displayedSignalDeadlineMs)} 前`
                : `官方预计时间 ${utc8(forecast.signal.deadlineMs)}`
            : null,
          forecast.signal.windowLabel || null,
        ]
          .filter(Boolean)
          .join(" · "),
        link: sourceLink(
          forecast.signal.level === "hint"
            ? "candidate"
            : forecast.signal.level === "commitment"
              ? "commitment"
              : "announcement",
          forecast.signal.atMs,
          forecast.signal.url,
        ),
      });
    } else if (receiverEvent) {
      const receiverSummary =
        codexResetText(receiverEvent.summary) || "Tibo 发布了明确重置公告";
      const receiverLocalized = codexResetText(
        receiverEvent.localized_summary || receiverEvent.localizedSummary,
      );
      submenuEventRows.push({
        label: "强制重置公告",
        value: clip(
          [
            receiverSummary,
            receiverLocalized && receiverLocalized !== receiverSummary
              ? `中文摘要：${receiverLocalized}`
              : null,
          ]
            .filter(Boolean)
            .join("\n\n"),
          1900,
        ),
        group: "official",
        secondaryValue: `发布 ${utc8(stateTime(receiverEvent.announced_at || receiverEvent.announcedAt))}`,
        link: sourceLink(
          "announcement",
          stateTime(receiverEvent.announced_at || receiverEvent.announcedAt),
          receiverEvent.url,
        ),
      });
    }
    const latestCompletedPublicEvent = completedPublicEvents
      .slice()
      .sort((left, right) => stateTime(right.announcedAt) - stateTime(left.announcedAt))[0];
    if (
      latestCompletedPublicEvent &&
      codexResetSignalID(latestCompletedPublicEvent) !== forecast.signal.id
    ) {
      submenuEventRows.push({
        label: "最近重置确认",
        value: clip(
          [
            latestCompletedPublicEvent.summary,
            latestCompletedPublicEvent.localizedSummary &&
            latestCompletedPublicEvent.localizedSummary !== latestCompletedPublicEvent.summary
              ? `中文摘要：${latestCompletedPublicEvent.localizedSummary}`
              : null,
          ]
            .filter(Boolean)
            .join("\n\n"),
          1900,
        ),
        group: "official",
        secondaryValue: `发布 ${utc8(stateTime(latestCompletedPublicEvent.announcedAt))} · 已与本机刷新对账`,
        link: sourceLink(
          "confirmation",
          stateTime(latestCompletedPublicEvent.announcedAt),
          latestCompletedPublicEvent.url,
        ),
      });
    }
    if (bankedCampaign) {
      const campaignDelivery = Object.values(
        codexResetObject(bankedCampaign.accountDelivery) || {},
      );
      const delivered = campaignDelivery.filter((value) => value === "delivered").length;
      const campaignStatus =
        bankedCampaign.status === "observed"
          ? "本机已全部确认"
          : bankedCampaign.status === "partial-delivery"
            ? "官方已生效 · 本机部分确认"
            : bankedCampaign.officialState === "available"
              ? "官方已生效 · 本机待确认"
              : bankedCampaign.officialState === "arriving"
                ? "官方称正在到账"
                : "已宣布发放";
      submenuEventRows.push(
        {
          label: "重置券到账",
          value: `${campaignStatus}${campaignDelivery.length ? ` · ${delivered}/${campaignDelivery.length} 个账号` : ""}`,
          group: "assets",
          secondaryValue: "这是可以自行决定何时使用的重置券，不是强制刷新",
        },
        {
          label: "重置券发放公告",
          value: clip([
            bankedCampaign.summary || bankedCampaign.localizedSummary,
            bankedCampaign.localizedSummary && bankedCampaign.localizedSummary !== bankedCampaign.summary
              ? `中文摘要：${bankedCampaign.localizedSummary}`
              : null,
          ].filter(Boolean).join("\n\n"), 1900),
          group: "official",
          secondaryValue: `最新公告 ${utc8(stateTime(bankedCampaign.latestEventAt || bankedCampaign.announcedAt))}`,
          link: sourceLink(
            "credit",
            stateTime(bankedCampaign.latestEventAt || bankedCampaign.announcedAt),
            bankedCampaign.url,
          ),
        },
      );
      const campaignAtMs = stateTime(
        bankedCampaign.latestEventAt || bankedCampaign.announcedAt,
      );
      if (
        campaignAtMs &&
        bankedCampaign.status !== "observed" &&
        forecast.signal.level === "none" &&
        !receiverEvent
      ) {
        resetTimelineItems.push({
          id: `credit-${codexResetSignalID(bankedCampaign) || campaignAtMs}`,
          kind: "credit",
          state: bankedCampaign.status === "observed" ? "confirmed" : "pending",
          title: "重置券发放",
          detail: signalTeaser(
            bankedCampaign.localizedSummary || bankedCampaign.summary || campaignStatus,
            140,
          ),
          detailEnglish: signalTeaser(
            bankedCampaign.summary || bankedCampaign.localizedSummary || campaignStatus,
            140,
          ),
          badge: "到账中",
          at: new Date(campaignAtMs).toISOString(),
          endAt: null,
          publishedAt: new Date(campaignAtMs).toISOString(),
          link: null,
        });
      }
    }
    const hasPerAccountReceiverState = Boolean(
      model.receiver && Array.isArray(model.receiver.accounts) && model.receiver.accounts.length,
    );
    const resetHistory = (
      currentAccount && Array.isArray(currentAccount.personalResets) &&
      (currentAccount.personalResets.length || hasPerAccountReceiverState)
        ? currentAccount.personalResets
        : Array.isArray(model.receiver && model.receiver.personalResets) &&
            model.receiver.personalResets.length
          ? model.receiver.personalResets
          : lastPersonalReset
            ? [lastPersonalReset]
            : []
    )
      .slice()
      .sort((left, right) => stateTime(right.at) - stateTime(left.at))
      .slice(0, 5);
    for (const [index, reset] of resetHistory.entries()) {
      const matchingPublicEvent = reset.eventId
        ? completedPublicEvents.find(
            (event) => codexResetSignalID(event) === codexResetText(reset.eventId),
          )
        : null;
      const resetEvidence =
        reset.cause === "banked-redeem"
          ? "券库存减少、额度恢复与周刷新时间后移共同确认"
          : reset.cause === "automatic"
            ? "刷新发生在上一周期的自然到期窗口"
            : reset.cause === "upgrade"
              ? "账号付费档位上升后，额度与刷新窗口实际重建"
              : "未使用重置券、未到自然刷新时间且额度窗口已经重建";
      const resetEvidenceEnglish =
        reset.cause === "banked-redeem"
          ? "Credit inventory decreased while quota and the weekly reset time both advanced"
          : reset.cause === "automatic"
            ? "The reset occurred at the previous cycle's natural boundary"
            : reset.cause === "upgrade"
              ? "Quota and the reset window rebuilt after the account moved to a paid tier"
              : "Quota and the reset window rebuilt before the natural boundary without using a credit";
      submenuEventRows.push({
        label: index === 0 ? "最近一次刷新" : `历史刷新 ${index + 1}`,
        value: `${resetCauseLabel(reset.cause)} · ${utc8(stateTime(reset.at))}`,
        group: "history",
        secondaryValue: matchingPublicEvent
          ? `${resetEvidence} · 对应官方消息：${signalTeaser(
              matchingPublicEvent.localizedSummary || matchingPublicEvent.summary,
              92,
            )}`
          : resetEvidence,
        link: matchingPublicEvent
          ? sourceLink(
              "history",
              stateTime(matchingPublicEvent.announcedAt),
              matchingPublicEvent.url,
            )
          : null,
      });
      const resetAtMs = stateTime(reset.at);
      if (resetAtMs && index === 0) {
        const matchingPublicAtMs = matchingPublicEvent
          ? stateTime(matchingPublicEvent.announcedAt)
          : null;
        const historyKind = reset.cause === "upgrade"
          ? "upgrade"
          : reset.cause === "banked-redeem"
            ? "credit"
            : reset.cause === "automatic"
              ? "natural"
              : "reset";
        resetTimelineItems.push({
          id: `history-${codexResetText(reset.eventId) || resetAtMs}-${index}`,
          eventId: codexResetText(reset.eventId) || null,
          kind: historyKind,
          state: "confirmed",
          title: resetCauseLabel(reset.cause),
          detail: resetEvidence,
          detailEnglish: resetEvidenceEnglish,
          badge: "已确认",
          at: new Date(resetAtMs).toISOString(),
          endAt: null,
          publishedAt: matchingPublicAtMs
            ? new Date(matchingPublicAtMs).toISOString()
            : null,
          link: null,
        });
      }
    }
    if (!resetHistory.length) {
      submenuEventRows.push({
        label: "最近一次刷新",
        value: "尚未积累本机刷新记录",
        group: "history",
        secondaryValue: "后续会按自然刷新、重置券兑换、强制刷新和套餐升级分别记录",
      });
    }
    if (model.usage) {
      resetTimelineItems.push({
        id: `natural-${model.usage.resetsAtMs}`,
        kind: "natural",
        state: "scheduled",
        title: "下次自然刷新",
        detail: "同档续费不会改变当前冷却周期",
        detailEnglish: "Renewing the same tier does not change the current cooldown cycle",
        badge: "计划",
        at: new Date(model.usage.resetsAtMs).toISOString(),
        endAt: null,
        publishedAt: null,
        link: null,
      });
    }

    if (model.bankedPlan && model.bankedPlan.availableCount > 0) {
      const banked = model.bankedPlan;
      const visibleCreditInventories = (banked.accountCredits || [])
        .filter((inventory) => inventory.availableCount > 0)
        .sort((left, right) =>
          left.accountId === currentAccount?.id
            ? -1
            : right.accountId === currentAccount?.id
              ? 1
              : left.accountLabel.localeCompare(right.accountLabel),
        );
      const creditItems = visibleCreditInventories.flatMap((inventory, inventoryIndex) =>
        (inventory.credits || []).map((credit, creditIndex) => ({
          id: `credit-${inventoryIndex + 1}-${creditIndex + 1}-${credit.expiresAtMs || "unknown"}`,
          kind: "credit",
          state: inventory.accountId === currentAccount?.id ? "current" : "available",
          title: inventory.accountLabel,
          detail: `inventory-${inventoryIndex + 1}`,
          detailEnglish: null,
          badge: "1",
          at: Number.isFinite(credit.grantedAtMs)
            ? new Date(credit.grantedAtMs).toISOString()
            : null,
          endAt: Number.isFinite(credit.expiresAtMs)
            ? new Date(credit.expiresAtMs).toISOString()
            : null,
          publishedAt: null,
          link: null,
        })),
      );
      const deliveryStates = Object.values(
        codexResetObject(bankedCampaign && bankedCampaign.accountDelivery) || {},
      );
      resetCreditVisualizations.push({
        kind: "resetCredits",
        group: "assets",
        title: "重置券",
        items: creditItems,
        creditSummary: {
          status: banked.status,
          action: banked.creditAction,
          accountLabel: banked.accountLabel || null,
          availableCount: banked.availableCount,
          bestNetPercent: Number.isFinite(banked.bestNetPercent) ? banked.bestNetPercent : null,
          bestNetCapacityUSD: Number.isFinite(banked.bestNetCapacityUSD)
            ? banked.bestNetCapacityUSD
            : null,
          fullCapacityUSD: Number.isFinite(banked.fullCapacityUSD)
            ? banked.fullCapacityUSD
            : null,
          optimalWindowStartAt: Number.isFinite(banked.optimalWindowStartMs)
            ? new Date(banked.optimalWindowStartMs).toISOString()
            : null,
          optimalWindowEndAt: Number.isFinite(banked.optimalWindowEndMs)
            ? new Date(banked.optimalWindowEndMs).toISOString()
            : null,
          possibleResetWindowEndAt: Number.isFinite(banked.possibleResetWindowEndMs)
            ? new Date(banked.possibleResetWindowEndMs).toISOString()
            : null,
          nextFreeResetAt: Number.isFinite(banked.nextFreeResetAtMs)
            ? new Date(banked.nextFreeResetAtMs).toISOString()
            : null,
          confidence: banked.confidence || "low",
          officialState: banked.officialState || null,
          deliveredAccountCount: deliveryStates.length
            ? deliveryStates.filter((value) => value === "delivered").length
            : null,
          deliveryAccountCount: deliveryStates.length || null,
        },
      });
    }
    if (model.accounts.length) {
      const visibleAccounts = model.accounts
        .slice()
        .sort((left, right) => Number(right.live) - Number(left.live))
        .slice(0, 3);
      for (const account of visibleAccounts) {
        const markers = [account.live ? "当前登录" : null, account.selected ? "CodexBar 查看" : null]
          .filter(Boolean)
          .join(" · ");
        const accountPrediction = account.behavior && account.behavior.prediction;
        const accountProgress = account.decision
          ? {
              title: `${account.label} 的使用计划`,
              alternateTitle: null,
              currentPercent: account.usage.usedPercent,
              targetPercent: account.decision.targetUsed,
              projectedPercent: accountPrediction ? accountPrediction.endpointMedian : null,
              projectedLowerPercent: accountPrediction ? accountPrediction.endpointLower : null,
              projectedUpperPercent: accountPrediction ? accountPrediction.endpointUpper : null,
              currentLabel: account.decision.targetReached
                ? `当前 ${percent(account.usage.usedPercent, 1)} · 已达标`
                : `当前 ${percent(account.usage.usedPercent, 1)}`,
              targetLabel: `目标 ${percent(account.decision.targetUsed, 1)}`,
              projectedLabel: accountPrediction
                ? `预计 ${percent(accountPrediction.endpointLower, 1)}–${percent(
                    accountPrediction.endpointUpper,
                    1,
                  )} · 中心 ${percent(accountPrediction.endpointMedian, 1)}`
                : "自然使用预测准备中",
            }
          : null;
        submenuAccountRows.push({
          label: `${account.label} · ${account.planLabel}${markers ? ` · ${markers}` : ""}`,
          value: account.decision
            ? account.decision.targetReached
              ? `已达目标 · 已用 ${percent(account.usage.usedPercent, 1)}`
              : `还需 ${percent(account.decision.additionalTotal, 1)} · 已用 ${percent(
                  account.usage.usedPercent,
                  1,
                )}`
            : "账号额度暂不可规划",
          secondaryValue: account.decision
            ? `${account.freeResetSource === "announced-forced" ? "明确强制重置" : "自然刷新"} ${utc8(account.freeResetDeadlineMs)} · ${
                account.fullCapacityUSD === null
                  ? "API 等价容量学习中"
                  : `完整容量约 $${account.fullCapacityUSD.toFixed(0)}，届时预计被清掉约 $${account.atRiskCapacityUSD.toFixed(0)} · ${codexResetCapacitySourceLabel(account.capacitySource)} · ${account.capacityEstimate.sampleCount || 0} 个样本`
              }`
            : "账号身份已隔离；等待精确且新鲜的额度数据",
          progress: accountProgress,
        });
      }
      if (model.accounts.length > visibleAccounts.length) {
        submenuAccountRows.push({
          label: `另外 ${model.accounts.length - visibleAccounts.length} 个账号`,
          value: "已继续独立计算，界面暂时折叠",
          secondaryValue: "账号数量不会使当前登录账号的主建议失效",
        });
      }
    }
    const responsivePace = model.pace && (model.pace.short || model.pace.long);
    const stablePace = model.pace && model.pace.long;
    const behavior = model.behavior;
    const behaviorPrediction = behavior && behavior.prediction;
    if (currentAccount) {
      const community = codexResetObject(
        currentAccount.capacityEstimate && currentAccount.capacityEstimate.community,
      );
      const anomalyLabel = codexResetCapacityAnomalyLabel(
        currentAccount.capacityEstimate && currentAccount.capacityEstimate.anomaly,
      );
      submenuForecastRows.push({
        label: "容量校准样本",
        value:
          currentAccount.fullCapacityUSD === null
            ? "正在收集 API 等价成本与额度变化的对应样本"
            : `${currentAccount.capacityEstimate.sampleCount || 0} 个有效样本 · ${currentAccount.capacityEstimate.confidence} 置信度 · ${codexResetCapacitySourceLabel(currentAccount.capacitySource)}`,
        secondaryValue:
          currentAccount.fullCapacityUSD === null
            ? "当前套餐缺少可靠社区样本；等待同一账号、同一周期内的本机成本与额度增量"
            : `完整容量 = API 等价用量 ÷ 额度下降比例 · 当前剩余约 $${currentAccount.remainingCapacityUSD.toFixed(0)} API 等价`,
      });
      if (community) {
        submenuForecastRows.push({
          label: "社区对照",
          value: `$${community.lowerUSD.toFixed(0)}–$${community.upperUSD.toFixed(0)} · 中心 $${community.estimateUSD.toFixed(0)}`,
          secondaryValue: `基线日期 ${community.asOf || "未知"} · 仅用于冷启动和异常对照；个人样本充分后不再主导估算`,
        });
      }
      if (anomalyLabel) {
        const anomaly = currentAccount.capacityEstimate && currentAccount.capacityEstimate.anomaly;
        const ratio = codexResetFinite(anomaly && anomaly.ratio);
        submenuForecastRows.push({
          label: "容量变化判断",
          value: anomalyLabel,
          secondaryValue: ratio === null
            ? "正在比较个人历史、同档账号和同期社区范围"
            : `当前约为比较基线的 ${percent(ratio * 100, 0)}；只描述有效容量差异，不推断服务端动机`,
        });
      }
    }
    if (model.subscriptionAdvice) {
      submenuForecastRows.push({
        label: "续费与旧冷却",
        value: `建议在 ${utc8(model.subscriptionAdvice.renewalAtMs)} 前取消自动续费`,
        secondaryValue: `账号已耗尽且旧周期到 ${utc8(model.subscriptionAdvice.oldCooldownEndsAtMs)} 才结束；降为 Free 后在此之前恢复同档不会刷新。可先用其他账号，旧周期完成后再恢复；不自动操作订阅`,
      });
    }
    if (responsivePace) {
      submenuForecastRows.push({
        label: "近期使用速度",
        value: `近 ${Math.round(responsivePace.windowMinutes)} 分钟 ${percent(
          responsivePace.ratePerHour,
          2,
        )}/活跃小时${stablePace ? ` · 近 1 小时 ${percent(stablePace.ratePerHour, 2)}` : ""}`,
        secondaryValue: stablePace
          ? `由本机额度相邻快照计算；1% 读数粒度范围 ${percent(
              stablePace.lowerRatePerHour,
              2,
            )}–${percent(stablePace.upperRatePerHour, 2)}/小时，只描述刚才的实际节奏`
          : "由本机额度相邻快照计算；只描述刚才的实际节奏，不直接外推到截止",
      });
    } else {
      submenuForecastRows.push({
        label: "近期使用速度 · 采样中",
        value: `已收集 ${(model.pace && model.pace.sampleCount) || 0} 个本机样本`,
        secondaryValue: "至少覆盖 10 分钟且有 3 个样本后显示；不会用不完整速度生成建议",
      });
    }
    if (shortLoadPrediction && ["ready", "degraded", "stale"].includes(shortLoad.status)) {
      submenuForecastRows.push({
        label: "未来 1 小时负载",
        value: `再用 ${percent(shortLoadPrediction.additionalLower, 1)}–${percent(
          shortLoadPrediction.additionalUpper,
          1,
        )} · 中心 ${percent(shortLoadPrediction.additionalMedian, 1)}`,
        secondaryValue: `当前主 session ${Math.round(
          shortLoad.context.liveActiveRootNow,
        )} 个 · 15 分钟平均 ${shortLoad.context.rootMean15.toFixed(
          1,
        )} · 60 分钟平均 ${shortLoad.context.rootMean60.toFixed(1)}；${
          shortLoad.status === "stale" ? "沿用最近可靠预测" : "Session 负载模型"
        }`,
      });
      submenuDiagnosticRows.push({
        label: "短期模型验证",
        value:
          shortLoad.shadow.evaluations > 0 && shortLoad.shadow.mae !== null
            ? `${Math.round(shortLoad.shadow.evaluations)} 次实机结算 · 平均误差 ${percent(
                shortLoad.shadow.mae,
                2,
              )}`
            : "等待第一批一小时实机结算",
        secondaryValue: `近 ${Math.round(
          shortLoad.training.lookbackDays,
        )} 天 · ${Math.round(shortLoad.training.states)} 个训练窗口 · k=${Math.round(
          shortLoad.training.neighborCount,
        )}；暂不控制 24 小时建议`,
      });
    }
    if (behaviorPrediction) {
      submenuForecastRows.push({
        label: "自然使用预测",
        value: `中心再用 ${percent(behaviorPrediction.additionalMedian, 1)} · 主要范围 ${percent(
          behaviorPrediction.additionalLower,
          1,
        )}–${percent(behaviorPrediction.additionalUpper, 1)}`,
        secondaryValue: `自然达标 ${percent(
          behaviorPrediction.reachProbability,
          0,
        )} · 额外安排约 ${percent(behaviorPrediction.extraMedian, 1)}（${percent(
          behaviorPrediction.extraLower,
          1,
        )}–${percent(behaviorPrediction.extraUpper, 1)}）`,
      });
    } else {
      submenuForecastRows.push({
        label: "自然使用预测",
        value: model.decision && model.decision.immediate
          ? "被即时公告覆盖"
          : behavior
            ? `当前${behavior.status === "stale" ? "已过期" : "不可用"}`
            : "准备中",
        secondaryValue:
          model.decision && model.decision.immediate
            ? "当前计划期限被明确公告压缩为现在；这不表示预测数据断开"
            : behavior && behavior.reasons.length
            ? clip(behavior.reasons.join("；"), 120)
            : "不使用短时速度替代全天行为预测",
      });
    }
    if (behavior && behavior.models.length) {
      const activeModels = behavior.models
        .filter((item) => item.median !== null && item.weight > 0.001)
        .map(
          (item) =>
            `${item.label || item.id} ${percent(item.median, 1)} / 权重 ${percent(
              item.weight * 100,
              0,
            )}`,
        );
      submenuDiagnosticRows.push({
        label: "行为模型组合",
        value: clip(activeModels.join(" · "), 120),
        secondaryValue:
          behavior.validation && behavior.validation.mae !== null
            ? `时间顺序回测 ${Math.round(behavior.validation.evaluations)} 次 · 平均误差 ${percent(
                behavior.validation.mae,
                1,
              )} · ${behavior.validation.selectedMode === "ensemble" ? "组合胜出" : "已回退基准"}`
            : "复杂模型未胜过基准时自动退出",
      });
    }
    if (behavior && (behavior.reasons.length || behavior.confidence)) {
      submenuDiagnosticRows.push({
        label: "预测健康",
        value: `${behavior.confidence === "high" ? "高" : behavior.confidence === "medium" ? "中" : "低"}可信度`,
        secondaryValue: behavior.reasons.length
          ? clip(behavior.reasons.join("；"), 120)
          : "模型分歧、行为漂移与历史覆盖均在可接受范围",
      });
    }
    if (model.decision) {
      submenuForecastRows.push(
        {
          label: "连续目标",
          value: `此刻应已用 ${percent(model.decision.targetNowUsed, 1)} · 实际 ${percent(
            model.usage.usedPercent,
            1,
          )}`,
          secondaryValue: `唯一重建边界是本机确认额度刷新；中间不按 24 小时切段，真实用量也不进入目标公式`,
        },
        {
          label: "同截止点目标",
          value: `红线 ${percent(model.decision.targetUsed, 1)} = 此刻目标 ${percent(
            model.decision.targetNowUsed,
            1,
          )} + 正常 ${percent(
            model.decision.normalUse,
            1,
          )} + 预测加速 ${percent(model.decision.predictionUse, 1)}${
            model.decision.candidateUse > 0
              ? ` + 可能刷新预留 ${percent(model.decision.candidateUse, 1)}`
              : ""
          }`,
          secondaryValue: model.decision.targetReached
            ? `当前已用 ${percent(model.usage.usedPercent, 1)}，已超红线 ${percent(
                model.decision.targetExceededBy,
                1,
              )}；红线仍按时间和风险独立演进`
            : model.decision.candidateUse > 0
              ? `当前还差 ${percent(
                  model.decision.additionalTotal,
                  1,
                )}；预测概率保持 ${percent(
                  model.decision.probability,
                  1,
                )}${forecast.signal.signalScore === null
                  ? ""
                  : `；暗示证据强度 ${forecast.signal.signalScore.toFixed(0)}/100 不是概率`
                }；可能重置的暗示另预留预测调整后剩余额度的 ${percent(
                  model.decision.candidateReservePercent,
                  0,
                )}`
            : `当前还差 ${percent(
                model.decision.additionalTotal,
                1,
              )}；预测加速 = ${percent(
                model.decision.probability,
                1,
              )} ${forecast.signal.level === "commitment" ? "规划系数（基础预测与源站承诺权重取较高值）" : "重置概率"} × 届时否则会浪费的额度`,
        },
        {
          label: "若没刷新",
          value: downside(model.decision.downsideHours),
          secondaryValue: "只改变使用时点，不凭空损失额度",
        },
      );
    }

    const submenuMainlineRows = [];
    if (visibleMainlineSuggestions.length) {
      for (const [index, mainline] of visibleMainlineSuggestions.entries()) {
        const loadEvidence = mainline.observedTokens > 0
          ? `${mainlineTokenWindowLabel} ${compactTokens(mainline.observedTokens)} token · 仅作负载证据，不参与主线优先级`
          : `${mainlineTokenWindowLabel}负载样本仍在形成，不影响已确认的持续性`;
        submenuMainlineRows.push({
          label: `主线 ${index + 1}`,
          value: clip(mainline.label, 1900),
          secondaryValue: clip(
            `${mainline.reason} · ${loadEvidence} · 最后活动 ${utc8(mainline.lastActiveAtMs)}`,
            220,
          ),
          actions: [
            { title: "暂不推荐", operation: "snooze", targetId: mainline.actionId },
            { title: "不是主线", operation: "not-mainline", targetId: mainline.actionId },
            { title: "标为已完成", operation: "complete", targetId: mainline.actionId },
          ],
        });
      }
    } else if (sessionSuggestions && sessionSuggestions.status !== "unavailable") {
      submenuMainlineRows.push({
        label: "可靠主线",
        value: "当前没有足够证据，不用最近 session 凑数",
        secondaryValue: "可以从下面的近期 session 中明确标出主线；其余容量用于新增有价值任务。",
      });
    }
    if (sessionSuggestions && sessionSuggestions.candidates.length) {
      for (const candidate of sessionSuggestions.candidates.slice(0, 6)) {
        if (!candidate.actionId) continue;
        submenuMainlineRows.push({
          label: "近期 session（仅供定位）",
          value: clip(`${candidate.project ? `${candidate.project} · ` : ""}${candidate.title}`, 1900),
          secondaryValue: "不会直接进入推荐；只有明确标注或形成跨日持续证据后才会成为主线。",
          actions: [
            { title: "标为主线", operation: "mark-mainline", targetId: candidate.actionId },
            { title: "不是主线", operation: "not-mainline", targetId: candidate.actionId },
          ],
        });
      }
    }
    if (sessionSuggestions) {
      submenuMainlineRows.push({
        label: "主线排序原则",
        value: "明确标注 > 进行中的 Goal > 跨日持续性 > 最近仍在推进",
        secondaryValue: `token 只描述负载与数据把握，不直接决定优先级；5/3/1 是最多展示数，把握不足的任务会主动缺席 · ${updatedFreshness(
          sessionSuggestions.updatedAtMs,
        )}`,
      });
    }

    const submenuDataRows = [
      {
        label: "数据新鲜度",
        value: model.usage
          ? `额度 ${updatedFreshness(model.usage.updatedAtMs)}${
              usingLastGoodUsage ? " · 最近可靠值" : ""
            } · 预测 ${updatedFreshness(forecast.updatedAtMs)} · 行为 ${updatedFreshness(
              behavior && behavior.asOfMs,
            )}${shortLoad ? ` · 短期 ${updatedFreshness(shortLoad.asOfMs)}` : ""}`
          : `预测 ${updatedFreshness(forecast.updatedAtMs)}`,
        secondaryValue: usingLastGoodUsage
          ? "实时读取暂时失败，当前沿用最近一次可靠额度；成功读取后自动更新"
          : push && push.registered
            ? "Push 已注册 · Atom 自动补漏"
            : "Atom 自动补漏 · Push 待注册",
      },
      {
        label: "预测模型",
        value: `24h ${percent(forecast.p24, 1)} · 48h ${percent(
          forecast.p48,
          1,
        )} · ${confidence(forecast.confidence)}`,
        secondaryValue: `24h 内按 P24、24–48h 按 P24/P48 分段插值 · 常见 ${commonHours}`,
      },
      {
        label: "通知投递",
        value: notificationDelivery && notificationDelivery.lastStatus
          ? notificationDelivery.lastStatus === "sent"
            ? `最近一次已交给 macOS · ${utc8(stateTime(notificationDelivery.lastSuccessAt || notificationDelivery.lastAttemptAt))}`
            : notificationDelivery.lastStatus === "failed"
              ? `最近一次发送失败 · ${utc8(stateTime(notificationDelivery.lastFailureAt || notificationDelivery.lastAttemptAt))}`
              : `测试模式已抑制 · ${utc8(stateTime(notificationDelivery.lastAttemptAt))}`
          : "尚无本机通知投递记录",
        secondaryValue: notificationDelivery && notificationDelivery.lastReason
          ? `触发原因：${notificationReasonLabel(notificationDelivery.lastReason)}${notificationDelivery.lastErrorKind ? ` · ${notificationDelivery.lastErrorKind}` : ""}`
          : "只记录投递状态和原因，不保存通知正文或账号信息",
      },
    ];
    if (forecast.signal.level !== "none") {
      submenuDataRows.push({
        label: "公开信号来源",
        value: `${forecast.signal.source || "unknown"} · ${forecast.signal.signalTier || forecast.signal.level}${
          forecast.signal.signalScore === null ? "" : ` · 信号分数 ${forecast.signal.signalScore}/100`
        }`,
        secondaryValue: `原帖 ${forecast.signal.id || "未提供"}${
          forecast.signal.alertEventId ? ` · 提醒 ID ${forecast.signal.alertEventId}` : ""
        }；提醒身份只用于去重，不代表个人到账`,
      });
      if (forecast.signal.timingKind) {
        submenuDataRows.push({
          label: "源站时间语义",
          value: `${forecast.signal.timingKind} · ${forecast.signal.sourceTimeZone || "时区未提供"}`,
          secondaryValue: `规划节点 ${forecast.signal.deadlineMs ? new Date(forecast.signal.deadlineMs).toISOString() : "未指定"}；保留源站语义，不从发帖时间补造最早到账时间`,
        });
      }
    }
    if (behavior) {
      submenuDataRows.push({
        label: "本机行为历史",
        value: `${behavior.historySampleCount} 个周额度点 · 约 ${behavior.historyDays.toFixed(
          0,
        )} 天`,
        secondaryValue: "只读 CodexBar 本机历史；跨刷新窗口排除，不上传个人用量",
      });
    }

    const recommendationRow = actionRows.find((row) =>
      ["建议", "建议暂不可用"].includes(row.label),
    );
    const whySummaryRows = decisionProgress && whyReasonText
      ? [
          {
            label: "为什么",
            value: whyReasonText,
            secondaryValue:
              "只使用当前周期、自然使用趋势和真实重置信号；账户状态见“用量与目标”，推导过程见“计算与数据”。",
            group: "summary",
          },
          {
            label: "所以",
            value: whyActionText || (recommendationRow ? recommendationRow.value : "继续观察"),
            secondaryValue: showMainlineSuggestions
              ? `本轮最多展示 ${suggestionLimit} 条，实际只显示 ${visibleMainlineSuggestions.length} 条可靠主线；token 不参与意图排序。`
              : recommendationRow && recommendationRow.secondaryValue,
            group: "summary",
          },
        ]
      : recommendationRow
        ? [{ ...recommendationRow, label: "当前判断", group: "summary" }]
        : [];
    const calculationResultLabels = new Set([
      "未来 1 小时负载",
      "自然使用预测",
    ]);
    const calculationBasisLabels = new Set([
      "连续目标",
      "同截止点目标",
      "若没刷新",
      "续费与旧冷却",
    ]);
    const whyCalculationRows = submenuForecastRows.map((row) => ({
      ...row,
      group: calculationResultLabels.has(row.label)
        ? "calculation-result"
        : calculationBasisLabels.has(row.label)
          ? "calculation-basis"
          : "calculation-raw",
    }));
    const whyDataRows = [...submenuDiagnosticRows, ...submenuDataRows].map((row) => ({
      ...row,
      group: "calculation-raw",
    }));
    const resetGroupOrder = { assets: 0, history: 1, official: 2 };
    const visibleResetEventRows = resetCreditVisualizations.length
      ? submenuEventRows.filter(
          (row) => !(row.group === "assets" && row.label === "重置券到账"),
        )
      : submenuEventRows;
    const resetRows = [...visibleResetEventRows, ...submenuCreditRows].sort(
      (left, right) =>
        (resetGroupOrder[left.group] === undefined ? 9 : resetGroupOrder[left.group]) -
        (resetGroupOrder[right.group] === undefined ? 9 : resetGroupOrder[right.group]),
    );
    const resetVisualizations = [
      ...(resetTimelineItems.length ? [{
          kind: "timeline",
          group: "timeline",
          title: "刷新时间轴",
          items: resetTimelineItems,
        }] : []),
      ...resetCreditVisualizations,
    ];
    const mainlineCorrections = sessionSuggestions
      ? sessionSuggestions.corrections.map((correction) => ({
          targetId: correction.targetId,
          label: correction.label || correction.project || "未命名主线",
          project: correction.project || null,
          status: correction.status,
          updatedAt:
            correction.updatedAtMs === null ? null : new Date(correction.updatedAtMs).toISOString(),
        }))
      : [];

    const decisionHistory = codexResetObject(model.receiver && model.receiver.decisionHistory);
    const decisionContext = codexResetObject(model.receiver && model.receiver.decisionContext);
    const allHistoryAccounts = Array.isArray(model.receiver && model.receiver.accounts)
      ? model.receiver.accounts : [];
    const resetHistoryEvents = allHistoryAccounts.flatMap((account) => [
      ...(Array.isArray(account.personalResets) ? account.personalResets : []).map((reset) => ({
        id: `receipt-${account.id}-${reset.generation || reset.at}`,
        eventId: codexResetText(reset.eventId) || null,
        accountId: account.id,
        accountLabel: account.label,
        at: reset.at,
        kind: reset.cause,
        evidence: reset.evidence,
        publishedAt: completedPublicEvents.find((event) => codexResetSignalID(event) === reset.eventId)?.announcedAt || null,
        summaryChinese: completedPublicEvents.find((event) => codexResetSignalID(event) === reset.eventId)?.localizedSummary || null,
        summaryEnglish: completedPublicEvents.find((event) => codexResetSignalID(event) === reset.eventId)?.summary || null,
      })),
      ...(Array.isArray(account.resetCredits?.credits) ? account.resetCredits.credits : [])
        .filter((credit) => credit.grantedAt).map((credit, index) => ({
          id: `grant-${account.id}-${credit.grantedAt}-${index}`, eventId: null,
          accountId: account.id, accountLabel: account.label, at: credit.grantedAt,
          kind: "credit-grant", evidence: "local-inventory", publishedAt: null,
          expiresAt: credit.expiresAt || null,
        })),
    ]);
    for (const event of completedPublicEvents) {
      const id = codexResetSignalID(event);
      if (!id || resetHistoryEvents.some((row) => row.eventId === id)) continue;
      resetHistoryEvents.push({
        id: `public-${id}`, eventId: id, accountId: null, accountLabel: null,
        at: event.announcedAt, publishedAt: event.announcedAt,
        kind: "public-announcement", evidence: "public-only",
        summaryChinese: event.localizedSummary || null, summaryEnglish: event.summary || null,
      });
    }
    resetHistoryEvents.sort((a, b) => stateTime(a.at) - stateTime(b.at));
    resetVisualizations.push({ kind: "resetCalendar", group: "history", title: "重置历史", items: [] });
    const recentPublicChange = decisionHistory && Array.isArray(decisionHistory.records)
      ? decisionHistory.records.slice().reverse().find((record) => record.impact) : null;
    if (recentPublicChange) {
      const account = recentPublicChange.accounts.find((item) => item.id === currentAccount?.id);
      whySummaryRows.push({
        label: "最近消息如何影响计划",
        value: account?.reasonChinese || "已记录本次接收，尚缺可靠的本机账户数据。",
        secondaryValue: recentPublicChange.impact.changed
          ? "在同一时刻、同一账户数据下比较，公共依据确实改变了计划；具体变化见“计算与数据”。"
          : "已接收并核对；在同一时刻、同一账户数据下比较，没有进一步改变计划。",
        group: "summary",
      });
    }

    return {
      updatedAt: model.usage ? model.usage.updatedAt : undefined,
      dataConfidence: "estimated",
      decisionProgress,
      mainlineCorrections,
      decisionHistory,
      decisionContext,
      resetHistoryEvents,
      details: [
        { title: "现在", rows: actionRows },
      ],
      submenuDetails: [
        ...(submenuMainlineRows.length
          ? [{ title: "建议主线", rows: submenuMainlineRows }]
          : []),
        ...(submenuAccountRows.length
          ? [{ title: "用量与目标", rows: submenuAccountRows }]
          : []),
        ...(submenuCreditRows.length || submenuEventRows.length || resetVisualizations.length
          ? [{ title: "重置", rows: resetRows, visualizations: resetVisualizations }]
          : []),
        ...(whySummaryRows.length
          ? [{
              title: "为什么这样建议",
              rows: whySummaryRows,
            }]
          : []),
        ...(whyCalculationRows.length || whyDataRows.length
          ? [{
              title: "计算与数据",
              rows: [
                ...whyCalculationRows,
                ...whyDataRows,
              ],
            }]
          : []),
      ],
    };
  },
});
