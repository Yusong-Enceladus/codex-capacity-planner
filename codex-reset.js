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
  const raw = codexResetText(value);
  if (!raw) return "Codex 账号";
  const parts = raw.split(/\s+[—–-]\s+/);
  const email = parts[0];
  const match = email.match(/^([^@]+)@([^@]+)$/);
  if (!match) return raw.length > 24 ? `${raw.slice(0, 18)}…${raw.slice(-4)}` : raw;
  const local = match[1];
  const compactLocal = local.length > 10 ? `${local.slice(0, 6)}…${local.slice(-2)}` : local;
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
  if (["explicit", "confirmed", "reset", "completed"].includes(kind)) return "explicit";
  if (signalType === "dated_commitment" || ["promise", "commitment"].includes(kind)) {
    return "commitment";
  }
  return "hint";
}

function codexResetSignalIsTerminal(signal) {
  const verification = codexResetText(
    signal && signal.reset_verification_status,
  ).toLowerCase();
  return ["confirmed", "verified", "rejected", "failed", "expired", "completed", "landed"].includes(
    verification,
  );
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
  const activeEpisode =
    codexResetObject(receiver.activeEpisode) || codexResetObject(receiver.currentEvent);
  const legacyLanded =
    activeEpisode && activeEpisode.status === "personal-landed" ? codexResetText(activeEpisode.id) : "";
  const lastPersonalReset = codexResetObject(receiver.lastPersonalReset);
  const closedEventIDs = new Set(
    (Array.isArray(receiver.closedEventIds) ? receiver.closedEventIds : [])
      .map(codexResetText)
      .filter(Boolean),
  );
  if (legacyLanded) closedEventIDs.add(legacyLanded);
  if (lastPersonalReset && codexResetText(lastPersonalReset.eventId)) {
    closedEventIDs.add(codexResetText(lastPersonalReset.eventId));
  }
  const settlement = codexResetSignalSettlement(receiver);
  const publicResetAtMs = codexResetMillis(forecast.last_reset_at);
  if (settlement.eventId) closedEventIDs.add(settlement.eventId);
  const choices = [];
  const rank = { none: 0, hint: 1, commitment: 2, explicit: 3 };

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
    if (
      settlement.atMs !== null &&
      atMs <= settlement.atMs &&
      !codexResetSignalStartsAfterSettlement(signal, window, settlement.atMs)
    ) {
      return;
    }
    if (
      publicResetAtMs !== null &&
      atMs < publicResetAtMs &&
      !codexResetSignalStartsAfterSettlement(signal, window, publicResetAtMs)
    ) {
      return;
    }

    const level = codexResetSignalLevel(signal);
    if (
      level === "explicit" &&
      settings.source === "receiver" &&
      !codexResetTrustedReceiverExplicit(signal)
    ) {
      return;
    }
    const deadlineMs =
      codexResetMillis(window.end_at) ||
      codexResetMillis(signal.deadline_at) ||
      codexResetMillis(signal.end_at);
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
    choices.push({
      level,
      id,
      atMs,
      deadlineMs,
      summary: originalSummary || "Tibo 发布了新的重置信号",
      localizedSummary: codexResetText(signal.localized_summary),
      url: codexResetHTTPSURL(signal.url),
      windowLabel: codexResetLocalized(window, "label"),
      source: codexResetText(settings.source),
      commitmentFloor: codexResetFinite(signal.commitment_floor_percent),
    });
  }

  addChoice(forecast.official_signal, { source: "forecast" });
  addChoice(codexResetReconciledFeedSignal(feed), { requiresActive: true, source: "feed" });
  const events = Array.isArray(feed.events) ? feed.events : [];
  for (const event of events.slice(0, 16)) {
    addChoice(event, { latestEvent: true, source: "event" });
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
    summary: "暂无未兑现的 Tibo 重置预告",
    localizedSummary: "",
    url: "",
    windowLabel: "",
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
  const commitment = codexResetObject(probabilities.commitment);
  const baseDailyRate = codexResetFinite(model && model.base_daily_rate);
  const signal = codexResetPickSignal(forecast, feed, receiver, nowMs);
  const commitmentFloor =
    codexResetFinite(probabilities.commitment_floor_percent) ||
    codexResetFinite(commitment && commitment.floor_percent) ||
    signal.commitmentFloor;

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
  const p24 = codexResetClamp(codexResetFinite(input.p24) || 0, 0, 100);
  const p48 = codexResetClamp(codexResetFinite(input.p48) || p24, p24, 100);
  const commitmentFloor = codexResetClamp(
    codexResetFinite(input.commitmentFloor) || 0,
    0,
    100,
  );

  let mode = input.forecastUsable ? "forecast" : "baseline";
  let deadlineMs = Math.min(nowMs + dayMs, naturalResetAtMs);
  let probability = 0;
  let waitsForNaturalReset = false;
  let immediate = false;
  let trajectoryPolicyKind = input.forecastUsable ? "hazard" : "baseline";
  let trajectoryHazardPerHour =
    input.forecastUsable && p24 > 0
      ? -Math.log1p(-Math.min(p24, 99.999999) / 100) / 24
      : 0;
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
  } else if (commitment) {
    const signalDeadline =
      Number.isFinite(signal.deadlineMs) && signal.deadlineMs > nowMs
        ? signal.deadlineMs
        : nowMs + dayMs;
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
  const targetRemaining = Math.max(0, normalRemainingAtDeadline - predictionUse);
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
    if (probability < 100 - 1e-9) {
      hazardPerHour = -Math.log1p(-probability / 100) / horizonHours;
    }
  }
  const downsideHours = normalRate > 0 ? predictionUse / normalRate : 0;

  return {
    mode,
    deadlineMs,
    horizonHours,
    probability,
    remaining,
    normalUse,
    otherwiseWasted,
    predictionUse,
    additionalBaseline: normalUse,
    additionalPrediction: predictionUse,
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
        title: title.slice(0, 300),
        project: codexResetText(candidate.project).slice(0, 120),
        lastActiveAtMs,
        pinned: candidate.pinned === true,
        goalStatus: codexResetText(candidate.goalStatus),
        observedTokens: Math.max(0, codexResetFinite(candidate.observedTokens) || 0),
        reason: codexResetText(candidate.reason).slice(0, 120) || "本周期最近活跃",
      };
    })
    .filter(Boolean)
    .slice(0, 5);
  return {
    status: ["ready", "stale", "unavailable"].includes(codexResetText(source.status))
      ? codexResetText(source.status)
      : "unavailable",
    updatedAtMs: codexResetMillis(source.updatedAt),
    cycleStartAtMs: codexResetMillis(source.cycleStartAt),
    observationStartedAtMs: codexResetMillis(source.observationStartedAt),
    observationReady: source.observationReady === true,
    candidateCount: Math.max(candidates.length, codexResetFinite(source.candidateCount) || 0),
    candidates,
  };
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

function codexResetBankedPlan(account, allAccounts, receiver, behavior, nowMs) {
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

  const accountUsable = (candidate) =>
    candidate.usage.usedPercent < 99 &&
    (!candidate.usage.shortWindow || candidate.usage.shortWindow.usedPercent < 99);
  const usableAccounts = allAccounts.filter(accountUsable);
  const allAccountsBlocked = usableAccounts.length === 0;
  const candidates = [];
  for (const entry of creditEntries) {
    const candidateAccount = entry.account;
    const expiryMs = entry.credit.expiresAtMs || nowMs + 30 * 24 * 3_600_000;
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
    const capacity = codexResetObject(candidateAccount.capacityEstimate);
    const capacityUSD = codexResetFinite(capacity && capacity.estimateUSD);
    const valueAt = (atMs) => {
      const state = codexResetBankedStateAt(candidateAccount, atMs, rate);
      const netCapacityUSD = capacityUSD === null ? null : capacityUSD * state.quotaEdge / 100;
      return {
        account: candidateAccount,
        credit: entry.credit,
        atMs,
        state,
        netPercent: state.quotaEdge,
        netCapacityUSD,
        score: netCapacityUSD === null ? state.quotaEdge : netCapacityUSD,
        capacityUSD,
        measuredRate,
        expiryMs,
      };
    };
    candidates.push(valueAt(nowMs));
    for (let atMs = nowMs + 3_600_000; atMs < expiryMs; atMs += 3_600_000) {
      candidates.push(valueAt(atMs));
    }
    if (expiryMs > nowMs) candidates.push(valueAt(expiryMs - 1));
  }
  const best = candidates.reduce((winner, item) => (item.score > winner.score ? item : winner));
  const nowValue = candidates
    .filter((item) => item.atMs === nowMs)
    .reduce((winner, item) => (!winner || item.score > winner.score ? item : winner), null);
  const hoursToExpiry = Math.max(0, (best.expiryMs - nowMs) / 3_600_000);
  const hoursToBest = Math.max(0, (best.atMs - nowMs) / 3_600_000);
  const highValueNode = best.netPercent >= 35;
  const alternativeAccountAvailable = usableAccounts.some((item) => item.id !== account.id);
  let creditAction = "hold";
  let status = "ready";
  if (allAccountsBlocked) {
    creditAction = "redeem";
    status = "interruption-now";
  } else if (!alternativeAccountAvailable && highValueNode && hoursToBest <= 24) {
    creditAction = "prepare";
  } else if (!alternativeAccountAvailable && !highValueNode && hoursToExpiry <= 72) {
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
    grossRecovery: nowValue.state.usedPercent,
    scheduleCost: nowValue.state.agePercent,
    quotaEdge: nowValue.netPercent,
    netCapacityUSD: nowValue.netCapacityUSD,
    bestNetPercent: best.netPercent,
    bestNetCapacityUSD: best.netCapacityUSD,
    fullCapacityUSD: best.capacityUSD,
    optimalAtMs: best.atMs,
    optimalWindowStartMs: Math.max(nowMs, best.atMs - 3 * 3_600_000),
    optimalWindowEndMs: Math.min(best.expiryMs, best.atMs + 3 * 3_600_000),
    highValueNode,
    allAccountsBlocked,
    usableAccountCount: usableAccounts.length,
    alternativeAccountAvailable,
    activeLanes: best.account.usage.activeLanes || ["weekly"],
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
    const accountTrajectory = codexResetTargetTrajectory(
      accountReceiver || {},
      accountUsage,
      accountUsage.resetsAtMs,
      nowMs,
    );
    const accountDecision =
      accountUsage.exact && accountUsage.fresh && forecast
        ? codexResetComputeDecision({
            nowMs,
            usedPercent: accountUsage.usedPercent,
            resetsAtMs: accountUsage.resetsAtMs,
            windowMinutes: accountUsage.windowMinutes,
            p24: forecast.p24,
            p48: forecast.p48,
            commitmentFloor: forecast.commitmentFloor,
            signal: forecast.signal,
            forecastUsable: forecast.fresh,
            plannedRemainingNow: accountTrajectory && accountTrajectory.remainingPercent,
          })
        : null;
    const accountPace = codexResetPaceModel(accountReceiver || {});
    const capacityEstimate = codexResetObject(accountReceiver && accountReceiver.capacityEstimate);
    const fullCapacityUSD = codexResetFinite(capacityEstimate && capacityEstimate.estimateUSD);
    const observedRate =
      codexResetFinite(accountPace && accountPace.long && accountPace.long.ratePerHour) ??
      codexResetFinite(accountPace && accountPace.short && accountPace.short.ratePerHour);
    const requiredWorkHours =
      accountDecision && observedRate !== null && observedRate > 0.01
        ? accountDecision.additionalTotal / observedRate
        : null;
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
      decision: accountDecision,
      targetTrajectory: accountTrajectory,
      pace: accountPace,
      capacityEstimate,
      fullCapacityUSD,
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
      urgency:
        accountDecision && accountDecision.additionalTotal > 0
          ? (fullCapacityUSD === null
              ? accountDecision.additionalTotal
              : fullCapacityUSD * accountDecision.additionalTotal / 100) /
            Math.max(0.25, accountDecision.horizonHours)
          : 0,
    };
  });
  const rankedAccounts = accountPlans
    .filter((item) => item.decision && item.usable)
    .slice()
    .sort((left, right) => right.urgency - left.urgency);
  const recommendedAccount = rankedAccounts[0] || null;
  const activeAccount = accountPlans.find((item) => item.live) || null;
  const selectedAccount = accountPlans.find((item) => item.selected) || null;
  const devicePlan = {
    accountCount: accountPlans.length,
    readyCount: accountPlans.filter((item) => item.decision).length,
    pendingCount: accountPlans.filter(
      (item) => item.decision && item.decision.additionalTotal > 0.05,
    ).length,
    activeAccountId: activeAccount && activeAccount.id,
    selectedAccountId: selectedAccount && selectedAccount.id,
    recommendedAccountId: recommendedAccount && recommendedAccount.id,
    shouldSwitch: Boolean(
      accountPlans.length > 1 &&
      activeAccount &&
      recommendedAccount &&
      activeAccount.id !== recommendedAccount.id &&
      (!activeAccount.usable ||
        recommendedAccount.urgency > Math.max(0.05, activeAccount.urgency) * 1.2),
    ),
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
  const bankedPlan = codexResetBankedPlan(activeAccount, accountPlans, receiver, behavior, nowMs);
  const workAction = decision
    ? decision.immediate
      ? "fast"
      : behavior && behavior.prediction && codexResetBehaviorZone(decision, behavior.prediction) === "behind"
        ? "accelerate"
        : decision.targetReached
          ? "standard"
          : "continue"
    : "hold";
  const actions = {
    workAction,
    creditAction: bankedPlan ? bankedPlan.creditAction : "hold",
    accountAction:
      devicePlan.shouldSwitch && recommendedAccount
        ? `consider-switch:${recommendedAccount.id}`
        : "stay",
  };
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

    function signalSecondary(summary, metadata) {
      const suffix = ` · ${metadata}`;
      const summaryLimit = Math.max(24, 120 - suffix.length);
      return `${signalTeaser(summary, summaryLimit)}${suffix}`;
    }

    function percent(value, digits) {
      const places = typeof digits === "number" ? digits : 0;
      return `${Math.max(0, value).toFixed(places)}%`;
    }

    function twoDigits(value) {
      return String(Math.max(0, Math.min(23, Math.round(value)))).padStart(2, "0");
    }

    function utc8(valueMs) {
      if (!Number.isFinite(valueMs)) return "—";
      const shifted = new Date(valueMs + 8 * 60 * 60 * 1000);
      return `${shifted.toISOString().slice(5, 16).replace("T", " ")} UTC+8`;
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

    function sessionMainSummary(candidates, candidateCount) {
      const shown = candidates.slice(0, 2).map((candidate) => clip(candidate.title, 34));
      const hidden = Math.max(0, candidateCount - shown.length);
      return clip(`${shown.join("；")}${hidden ? `；另有 ${hidden} 个` : ""}`, 120);
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
    const bankedCampaign = codexResetObject(model.receiver && model.receiver.bankedCampaign);
    const accountDelivery = codexResetObject(receiverEvent && receiverEvent.account_delivery) || {};
    const deliveryValues = Object.values(accountDelivery);
    const deliveredAccounts = deliveryValues.filter((value) => value === "landed").length;
    const lastPersonalReset = codexResetObject(model.receiver && model.receiver.lastPersonalReset);
    const signalLabel =
      forecast.signal.level === "explicit"
        ? `明确重置公告${deliveryValues.length ? ` · ${deliveredAccounts}/${deliveryValues.length} 账号到账` : ""}`
        : forecast.signal.level === "commitment"
          ? "有期限承诺"
          : forecast.signal.level === "hint"
            ? "候选暗示"
            : "无强制重置预告";
    const commonHours =
      forecast.commonStartHour !== null && forecast.commonEndHour !== null
        ? `${twoDigits(forecast.commonStartHour)}:00–${twoDigits(forecast.commonEndHour)}:00 UTC+8`
        : "时段未知";
    const health = codexResetObject(model.receiver && model.receiver.health);
    const push = codexResetObject(model.receiver && model.receiver.push);
    const usingLastGoodUsage = model.usageSource === "last-good" && Boolean(model.usage);
    const actionRows = [];
    const sessionSuggestions = model.sessionSuggestions;
    const sessionCandidates = sessionSuggestions ? sessionSuggestions.candidates : [];
    const shortLoad = model.shortLoad;
    const shortLoadPrediction = shortLoad && shortLoad.prediction;
    const currentAccount = model.accounts.find((account) => account.live) || null;
    const selectedAccount = model.accounts.find((account) => account.selected) || null;
    let showSessionSuggestions = false;
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
              : `完整周容量约 $${currentAccount.fullCapacityUSD.toFixed(2)} API 等价 · ${currentAccount.capacityEstimate.confidence} 置信度`,
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
      showSessionSuggestions = !targetReached && (decision.immediate || behaviorZone === "behind");
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
      if (targetReached) {
        recommendationValue = "无需再为预测继续加速";
        recommendationSecondary =
          decision.targetExceededBy > 0.05
            ? `当前已超红线 ${percent(decision.targetExceededBy, 1)}；若正在使用 Fast，请切回 Standard`
            : "当前已到达红线；正常任务可以继续，若在 Fast 请切回 Standard";
      } else if (decision.immediate) {
        recommendationValue = sessionCandidates.length
          ? "续跑近期任务或新增有价值任务"
          : "新增有价值任务，需要时开启 Fast";
        recommendationSecondary = `Tibo 已明确公告且尚未到账；可优先使用剩余 ${percent(
          decision.remaining,
          1,
        )} 周额度`;
      } else if (prediction) {
        if (behaviorZone === "behind") {
          recommendationValue = sessionCandidates.length
            ? "续跑近期任务，仍不足时开启 Fast"
            : "新增有价值任务，仍不足时开启 Fast";
          recommendationSecondary = `红线目标 ${percent(
            decision.targetUsed,
            1,
          )} 在蓝区 ${percent(prediction.endpointLower, 1)}–${percent(
            prediction.endpointUpper,
            1,
          )} 右侧`;
        } else if (behaviorZone === "covered") {
          recommendationValue = "若正在使用 Fast，切回 Standard";
          recommendationSecondary = `红线目标 ${percent(
            decision.targetUsed,
            1,
          )} 在蓝区 ${percent(prediction.endpointLower, 1)}–${percent(
            prediction.endpointUpper,
            1,
          )} 左侧；若已是 Standard 则保持`;
        } else {
          recommendationValue = "保持当前节奏";
          recommendationSecondary = `红线目标 ${percent(
            decision.targetUsed,
            1,
          )} 位于蓝区 ${percent(prediction.endpointLower, 1)}–${percent(
            prediction.endpointUpper,
            1,
          )} 内`;
        }
      } else {
        recommendationValue = `计划再用 ${percent(decision.additionalTotal, 1)} 周额度`;
        recommendationSecondary = behavior
          ? `行为预测${behavior.status === "stale" ? "已过期" : "暂不可靠"}；不拿短时速度外推全天`
          : "长期行为预测准备中；当前只显示确定目标";
      }
      const recommended = model.devicePlan.shouldSwitch
        ? model.accounts.find((item) => item.id === model.devicePlan.recommendedAccountId)
        : null;
      if (recommended) {
        recommendationValue = `切到 ${recommended.label} · ${recommended.planLabel} 继续工作`;
        recommendationSecondary = `当前账号已阻塞或该账号更应先用；切号只需重新登录，不计为工作中断，也不会自动执行`;
      } else if (model.bankedPlan && model.bankedPlan.status === "interruption-now") {
        recommendationValue = `所有账号都已阻塞，使用 ${model.bankedPlan.accountLabel || "当前账号"} 的重置券`;
        recommendationSecondary = "免费账户容量与免费刷新均不可立即使用；此时兑换是恢复工作的下一环，只提示、不自动兑换";
      }
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

    if (showSessionSuggestions && sessionCandidates.length) {
      actionRows.push({
        label: "建议续跑",
        value: sessionMainSummary(sessionCandidates, sessionCandidates.length),
        secondaryValue: "按最近活动、本周期本机用量与明确 Goal 状态排序；是否已完成由你判断",
      });
    }
    if (model.subscriptionAdvice) {
      actionRows.push({
        label: "订阅",
        value: `在 ${utc8(model.subscriptionAdvice.renewalAtMs)} 前取消 ${model.subscriptionAdvice.accountLabel} 的自动续费`,
        secondaryValue: `该账号已用完，旧周冷却要到 ${utc8(model.subscriptionAdvice.oldCooldownEndsAtMs)}；续回同档也不会提前刷新。只提示，不自动取消或购买`,
      });
    }
    if (forecast.signal.level !== "none") {
      actionRows.push({
        label: "重置",
        value: signalLabel,
        secondaryValue: signalSecondary(
          forecast.signal.summary,
          forecast.signal.deadlineMs
            ? `截止 ${utc8(forecast.signal.deadlineMs)}`
            : `发布 ${utc8(forecast.signal.atMs)}`,
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
    const mainRowPriority = {
      建议: 0,
      建议暂不可用: 0,
      建议续跑: 1,
      订阅: 1,
      账户: 2,
      可用重置: 3,
      重置: 4,
    };
    actionRows.sort(
      (left, right) =>
        (mainRowPriority[left.label] === undefined ? 9 : mainRowPriority[left.label]) -
        (mainRowPriority[right.label] === undefined ? 9 : mainRowPriority[right.label]),
    );

    const submenuEventRows = [];
    const submenuCreditRows = [];
    const submenuAccountRows = [];
    const submenuForecastRows = [];
    const submenuDiagnosticRows = [];
    if (forecast.signal.level !== "none") {
      submenuEventRows.push({
        label: "当前状态",
        value: signalLabel,
        group: "current",
        secondaryValue:
          forecast.signal.level === "explicit"
            ? receiverEvent
              ? "全局事件仍在等待个人到账；本机额度跳变后关闭"
              : "确认公告按 100% 处理；个人到账由本机额度另行确认"
            : forecast.signal.level === "commitment"
              ? "承诺概率下限与历史模型取较高值，不当作已经到账"
              : "普通暗示只展示，不擅自给概率加权",
      });
    }
    if (forecast.signal.level !== "none") {
      submenuEventRows.push({
        label: "强制重置公告",
        value: clip(forecast.signal.summary, 1900),
        group: "official",
        secondaryValue: [
          `发布 ${utc8(forecast.signal.atMs)}`,
          forecast.signal.deadlineMs ? `窗口截止 ${utc8(forecast.signal.deadlineMs)}` : null,
          forecast.signal.windowLabel || null,
        ]
          .filter(Boolean)
          .join(" · "),
        link: forecast.signal.url ? { label: "打开 Tibo 原帖", url: forecast.signal.url } : null,
      });
      if (
        forecast.signal.localizedSummary &&
        forecast.signal.localizedSummary !== forecast.signal.summary
      ) {
        submenuEventRows.push({
          label: "中文摘要",
          value: clip(forecast.signal.localizedSummary, 1900),
          group: "official",
          secondaryValue: "来自 codex-reset.com 的翻译",
        });
      }
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
          value: clip(bankedCampaign.summary || bankedCampaign.localizedSummary, 1900),
          group: "official",
          secondaryValue: `最新公告 ${utc8(stateTime(bankedCampaign.latestEventAt || bankedCampaign.announcedAt))}`,
          link: bankedCampaign.url
            ? { label: "打开 Tibo 原帖", url: bankedCampaign.url }
            : null,
        },
      );
      if (
        bankedCampaign.localizedSummary &&
        bankedCampaign.localizedSummary !== bankedCampaign.summary
      ) {
        submenuEventRows.push({
          label: "中文摘要",
          value: clip(bankedCampaign.localizedSummary, 1900),
          group: "official",
          secondaryValue: "来自 codex-reset.com 的翻译",
        });
      }
    }
    const resetHistory = (
      currentAccount && Array.isArray(currentAccount.personalResets)
        ? currentAccount.personalResets
        : Array.isArray(model.receiver && model.receiver.personalResets)
          ? model.receiver.personalResets
          : lastPersonalReset
            ? [lastPersonalReset]
            : []
    )
      .slice()
      .sort((left, right) => stateTime(right.at) - stateTime(left.at))
      .slice(0, 5);
    for (const [index, reset] of resetHistory.entries()) {
      submenuEventRows.push({
        label: index === 0 ? "最近一次刷新" : `历史刷新 ${index + 1}`,
        value: `${resetCauseLabel(reset.cause)} · ${utc8(stateTime(reset.at))}`,
        group: "history",
        secondaryValue:
          reset.cause === "banked-redeem"
            ? "券库存减少、额度恢复与周刷新时间后移共同确认"
            : reset.cause === "automatic"
              ? "刷新发生在上一周期的自然到期窗口"
              : reset.cause === "upgrade"
                ? "账号付费档位上升后，额度与刷新窗口实际重建"
                : "未使用重置券、未到自然刷新时间且额度窗口已经重建",
      });
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
      submenuEventRows.push({
        label: "下次自然刷新",
        value: utc8(model.usage.resetsAtMs),
        relativeTimeAt: new Date(model.usage.resetsAtMs).toISOString(),
        relativeTimePrefix: "",
        group: "current",
        secondaryValue: "同档续费及到期后恢复原档不会改变这个冷却周期",
      });
    }

    if (
      model.bankedPlan &&
      ["ready", "interruption-now", "must-form-node"].includes(model.bankedPlan.status)
    ) {
      const banked = model.bankedPlan;
      const accountCreditRows = (banked.accountCredits || [])
        .filter((inventory) => inventory.availableCount > 0)
        .sort((left, right) =>
          left.accountId === currentAccount?.id
            ? -1
            : right.accountId === currentAccount?.id
              ? 1
              : left.accountLabel.localeCompare(right.accountLabel),
        )
        .map((inventory) => ({
          label: inventory.accountId === currentAccount?.id
            ? "重置券 · 当前账号"
            : `重置券 · ${inventory.accountLabel}`,
          value: `${inventory.availableCount} 次可用`,
          group: "assets",
          secondaryValue: inventory.expiresAtMs
            ? `最早到期 ${utc8(inventory.expiresAtMs)}`
            : "未提供到期时间",
        }));
      submenuCreditRows.push(
        ...accountCreditRows,
        {
          label: "重置策略",
          value:
            banked.creditAction === "redeem"
              ? `现在兑换 · ${banked.accountLabel}`
              : banked.creditAction === "prepare"
                ? banked.status === "must-form-node"
                  ? "需要提前安排工作，形成高价值兑换点"
                  : `准备在 ${banked.accountLabel} 形成兑换点`
                : "保留选择权，先用现有账号容量",
          group: "assets",
          secondaryValue: banked.accountId === currentAccount?.id
            ? "策略作用于当前账号"
            : `策略作用于 ${banked.accountLabel}`,
        },
        {
          label: "净容量价值",
          value: `恢复 ${percent(banked.grossRecovery, 1)} − 刷新日推迟成本 ${percent(
            banked.scheduleCost,
            1,
          )} = ${percent(banked.quotaEdge, 1)}${
            banked.netCapacityUSD === null
              ? ""
              : `（API 等价约 $${banked.netCapacityUSD.toFixed(2)}）`
          }`,
          group: "assets",
          secondaryValue: "净价值 = 账号完整容量 ×（已用比例 − 周期经过比例）；不是按券快到期的概率判断",
        },
        {
          label: "高价值节点",
          value: `${utc8(banked.optimalWindowStartMs)}–${utc8(banked.optimalWindowEndMs)} · ${banked.accountLabel}`,
          group: "assets",
          secondaryValue: banked.highValueNode
            ? `预计净得 ${percent(banked.bestNetPercent, 1)} 完整容量${
                banked.bestNetCapacityUSD === null
                  ? ""
                  : ` · API 等价约 $${banked.bestNetCapacityUSD.toFixed(2)}`
              }`
            : "当前安排还不能在到期前形成足够高价值节点；需要提前调整账号与任务顺序，不能把过期当作正常结果",
        },
      );
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
            ? `最晚 ${utc8(account.usage.resetsAtMs)} 自动刷新 · ${
                account.fullCapacityUSD === null
                  ? "API 等价容量学习中"
                  : `完整容量约 $${account.fullCapacityUSD.toFixed(2)}，剩余约 $${account.remainingCapacityUSD.toFixed(2)}`
              }`
            : "账号身份已隔离；等待精确且新鲜的额度数据",
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
      submenuForecastRows.push({
        label: "账号真实容量",
        value:
          currentAccount.fullCapacityUSD === null
            ? "正在收集 API 等价成本与额度变化的对应样本"
            : `完整周期约 $${currentAccount.fullCapacityUSD.toFixed(2)} · 剩余约 $${currentAccount.remainingCapacityUSD.toFixed(2)} API 等价`,
        secondaryValue:
          currentAccount.fullCapacityUSD === null
            ? "需要同一账号、同一周期内的本机成本增量与额度增量；不会使用界面上的 5x/20x 代替容量"
            : `完整容量 = API 等价用量 ÷ 额度已用比例 · ${currentAccount.capacityEstimate.sampleCount} 个有效样本 · ${currentAccount.capacityEstimate.confidence} 置信度`,
      });
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
        value: behavior ? `当前${behavior.status === "stale" ? "已过期" : "不可用"}` : "准备中",
        secondaryValue:
          behavior && behavior.reasons.length
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
          )} + 预测加速 ${percent(model.decision.predictionUse, 1)}`,
          secondaryValue: model.decision.targetReached
            ? `当前已用 ${percent(model.usage.usedPercent, 1)}，已超红线 ${percent(
                model.decision.targetExceededBy,
                1,
              )}；红线仍按时间和风险独立演进`
            : `当前还差 ${percent(
                model.decision.additionalTotal,
                1,
              )}；预测加速 = ${percent(
                model.decision.probability,
                1,
              )} 重置概率 × 届时否则会浪费的额度`,
        },
        {
          label: "若没刷新",
          value: downside(model.decision.downsideHours),
          secondaryValue: "只改变使用时点，不凭空损失额度",
        },
      );
    }

    const submenuSessionRows = [];
    if (showSessionSuggestions && sessionCandidates.length) {
      for (const [index, candidate] of sessionCandidates.entries()) {
        const metadata = [
          candidate.reason,
          candidate.project || null,
          `最后活动 ${utc8(candidate.lastActiveAtMs)}`,
          candidate.observedTokens > 0
            ? `本机观察期新增 ${Math.round(candidate.observedTokens)} token`
            : null,
        ]
          .filter(Boolean)
          .join(" · ");
        submenuSessionRows.push({
          label: `候选 ${index + 1}`,
          value: clip(candidate.title, 1900),
          secondaryValue: clip(metadata, 120),
        });
      }
      submenuSessionRows.push({
        label: "如何继续",
        value: "在 Codex 中打开对应任务；CLI 可使用 /resume 或 codex resume",
        secondaryValue: `${
          sessionSuggestions.status === "stale"
            ? "当前沿用最近可靠候选 · "
            : ""
        }系统只给建议，不会自动发消息或启动任务 · 候选 ${updatedFreshness(
          sessionSuggestions.updatedAtMs,
        )}`,
        link: {
          label: "查看 Codex 继续任务说明",
          url: "https://learn.chatgpt.com/docs/projects",
        },
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
    ];
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
    const whySummaryRows = decisionProgress
      ? [
          {
            label: "当前",
            value: `${decisionProgress.currentLabel} · ${decisionProgress.targetLabel}`,
            secondaryValue: "先比较真实用量与此刻目标，不把套餐名称当作容量",
            group: "summary",
          },
          {
            label: "预计",
            value: decisionProgress.projectedLabel,
            secondaryValue: shortLoadPrediction
              ? `未来 1 小时预计再用 ${percent(shortLoadPrediction.additionalLower, 1)}–${percent(
                  shortLoadPrediction.additionalUpper,
                  1,
                )}`
              : "等待足够的行为与任务负载样本",
            group: "summary",
          },
          {
            label: "因此",
            value: recommendationRow ? recommendationRow.value : "继续观察",
            secondaryValue: recommendationRow && recommendationRow.secondaryValue,
            group: "summary",
          },
        ]
      : recommendationRow
        ? [{ ...recommendationRow, label: "当前判断", group: "summary" }]
        : [];
    const calculationLabels = new Set([
      "近期使用速度",
      "近期使用速度 · 采样中",
      "未来 1 小时负载",
      "自然使用预测",
      "连续目标",
      "同截止点目标",
      "若没刷新",
      "续费与旧冷却",
    ]);
    const whyCalculationRows = submenuForecastRows.map((row) => ({
      ...row,
      group: calculationLabels.has(row.label) ? "calculation" : "data",
    }));
    const whySessionRows = submenuSessionRows.map((row) => ({ ...row, group: "work" }));
    const whyDataRows = [...submenuDiagnosticRows, ...submenuDataRows].map((row) => ({
      ...row,
      group: "data",
    }));
    const resetGroupOrder = { current: 0, assets: 1, history: 2, official: 3 };
    const resetRows = [...submenuEventRows, ...submenuCreditRows].sort(
      (left, right) =>
        (resetGroupOrder[left.group] === undefined ? 9 : resetGroupOrder[left.group]) -
        (resetGroupOrder[right.group] === undefined ? 9 : resetGroupOrder[right.group]),
    );

    return {
      updatedAt: model.usage ? model.usage.updatedAt : undefined,
      dataConfidence: "estimated",
      decisionProgress,
      details: [
        { title: "现在", rows: actionRows },
      ],
      submenuDetails: [
        ...(submenuAccountRows.length
          ? [{ title: "账户", rows: submenuAccountRows }]
          : []),
        ...(submenuForecastRows.length || submenuSessionRows.length
          ? [{
              title: "为什么这样建议",
              rows: [
                ...whySummaryRows,
                ...whyCalculationRows,
                ...whySessionRows,
                ...whyDataRows,
              ],
            }]
          : []),
        ...(submenuCreditRows.length || submenuEventRows.length
          ? [{ title: "重置", rows: resetRows }]
          : []),
      ],
    };
  },
});
