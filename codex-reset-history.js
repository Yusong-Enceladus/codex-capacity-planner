// Local, append-only observations of the existing planner. This module never
// fetches a source, classifies prose, changes a plan, or stores task content.
const HISTORY_LIMIT = 1024;
const hour = 3_600_000;
const obj = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const str = (value) => typeof value === "string" ? value : "";
const list = (value) => Array.isArray(value) ? value : [];
const finite = (value) => typeof value === "number" && Number.isFinite(value) ? value : null;
const iso = (value) => {
  const ms = typeof value === "number" ? value : Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
};
const rounded = (value) => finite(value) === null ? null : Math.round(value * 1000) / 1000;

function normalizeDecisionHistory(value) {
  const source = obj(value);
  const records = Array.isArray(source.records)
    ? source.records.filter((row) => row && iso(row.at) && Array.isArray(row.accounts) && Array.isArray(row.evidence))
    : [];
  return {
    version: 1,
    startedAt: iso(source.startedAt),
    sequence: Math.max(0, Number(source.sequence) || 0),
    discardedCount: Math.max(0, Number(source.discardedCount) || 0) + Math.max(0, records.length - HISTORY_LIMIT),
    lastCheckedAt: iso(source.lastCheckedAt),
    lastError: str(source.lastError) || null,
    records: records.slice(-HISTORY_LIMIT),
  };
}

function accountReason(account, receiver) {
  const signal = obj(obj(account.forecast).signal);
  const decision = obj(account.decision);
  if (!account.decision) return "account-unavailable";
  if (str(decision.mode).endsWith("-after-natural") ||
      (["automatic", "renewal"].includes(decision.mode) && signal.level !== "none")) return "natural-first";
  if (signal.level === "explicit") return "explicit-pending";
  if (signal.level === "commitment") return finite(signal.deadlineMs) === null ? "promise-untimed" : "promise-dated";
  if (signal.level === "hint") return "hint-reserve";
  const local = (receiver.accounts || []).find((item) => item.id === account.id) || {};
  if (obj(local.lastPersonalReset).eventId) return "ordinary-after-delivery";
  return obj(account.forecast).fresh && obj(account.forecast).mode !== "local-only"
    ? "cadence-and-local" : "local-only";
}

function planAccounts(modelValue) {
  const model = obj(modelValue);
  const receiver = obj(model.receiver);
  return list(model.accounts).map((account) => {
    const usage = obj(account.usage);
    const decision = obj(account.decision);
    const signal = obj(obj(account.forecast).signal);
    const local = (receiver.accounts || []).find((item) => item.id === account.id) || {};
    const prediction = obj(obj(account.behavior).prediction);
    const reason = accountReason(account, receiver);
    return {
      id: str(account.id), label: str(account.label), active: account.live === true,
      cycleGeneration: Math.max(0, Number(local.cycleGeneration) || 0),
      usedPercent: rounded(usage.usedPercent), targetPercent: rounded(decision.targetUsed),
      targetAt: iso(decision.deadlineMs), naturalResetAt: iso(usage.resetsAtMs),
      usageAt: iso(usage.updatedAtMs), fresh: usage.fresh === true && usage.exact === true,
      projectedLower: rounded(prediction.endpointLower), projectedUpper: rounded(prediction.endpointUpper),
      signalId: str(signal.id) || null, signalLevel: str(signal.level) || "none",
      signalWeight: rounded(signal.commitmentFloor ?? signal.signalScore),
      mode: str(decision.mode) || "unavailable", reason,
      cyclePhase: str(account.cyclePhase) || "unknown", trend: str(account.trend) || "unknown",
      reasonChinese: reasonText(reason), reasonEnglish: reasonText(reason, true),
      deliveredEventId: str(obj(local.lastPersonalReset).eventId) || null,
      deliveredAt: iso(obj(local.lastPersonalReset).at),
      calculation: Object.fromEntries(Object.entries({
        windowMinutes: usage.windowMinutes, horizonHours: decision.horizonHours,
        plannedRemainingNow: decision.plannedRemainingNow, targetNowUsed: decision.targetNowUsed,
        normalUse: decision.normalUse, otherwiseWasted: decision.otherwiseWasted,
        planningCoefficient: decision.probability, predictionUse: decision.predictionUse,
        candidateReservePercent: decision.candidateReservePercent, candidateUse: decision.candidateUse,
        targetRemaining: decision.targetRemaining, targetUsed: decision.targetUsed,
        trajectoryHazardPerHour: decision.trajectoryHazardPerHour,
      }).filter(([, value]) => finite(value) !== null)),
    };
  });
}

function planActions(modelValue) {
  const model = obj(modelValue);
  const plan = obj(model.capacityPlan);
  const credit = obj(model.bankedPlan);
  return {
    work: str(plan.workAction) || "hold", credit: str(plan.creditAction) || "hold",
    availableCredits: Math.max(0, Number(credit.availableCount) || 0),
    account: str(plan.accountAction) || "stay", creditReason: str(credit.status) || "unavailable",
    creditWindowStartAt: iso(credit.optimalWindowStartMs),
    creditWindowEndAt: iso(credit.optimalWindowEndMs),
    possibleResetEndAt: iso(credit.possibleResetWindowEndMs),
  };
}

function publicEvidence(modelValue, inputs, previous, nowMs) {
  const model = obj(modelValue);
  const forecast = obj(inputs.forecast);
  const feed = obj(inputs.feed);
  const receiver = obj(model.receiver);
  const signals = [obj(obj(model.forecast).signal), ...list(model.accounts).map((account) => obj(obj(account.forecast).signal))]
    .filter((signal) => signal.id && signal.level !== "none");
  const records = [forecast.official_signal, forecast.teased_window, feed.signal,
    ...signals.map((signal) => ({ id: signal.id, url: signal.url, summary: signal.summary,
      localized_summary: signal.localizedSummary, at: iso(signal.atMs) })),
    ...list(feed.events), ...list(feed.tweets), receiver.activeEpisode].filter(Boolean);
  const grouped = new Map();
  const previouslySeen = new Map();
  for (const row of previous.records) for (const item of row.evidence) {
    if (!previouslySeen.has(item.id)) previouslySeen.set(item.id, item);
  }
  for (const record of records) {
    const id = str(record.tweet_id || record.id || record.event_id);
    const url = str(record.url || record.source_url);
    // Raw rows are context, not trusted announcements. Only keep canonical
    // public post identities; adoption is read from the planner's result.
    const match = url.match(/^https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^/]+\/status\/(\d+)(?:[/?#]|$)/i);
    if (!id || !match || match[1] !== id) continue;
    const window = obj(record.official_window || record.window);
    const prior = grouped.get(id);
    const chosen = signals.find((signal) => signal.id === id) || {};
    const isChosen = chosen.id === id && chosen.level !== "none";
    const sourceState = str(record.reset_verification_status || record.announcement_state || record.status);
    const old = previouslySeen.get(id);
    let disposition = "not-selected";
    if (isChosen) disposition = "adopted";
    else if ((receiver.closedEventIds || []).includes(id)) disposition = "closed";
    else if (["rejected", "failed", "expired", "completed", "landed"].includes(sourceState)) disposition = sourceState;
    else if (iso(window.target_at || window.end_at) && Date.parse(window.target_at || window.end_at) < nowMs) disposition = "expired";
    const item = {
      id, url: url.split(/[?#]/)[0], source: str(inputs.sourceHost) || "configured-source",
      publishedAt: iso(record.announced_at || record.announcedAt || record.created_at || record.at),
      firstReceivedAt: old ? old.firstReceivedAt : iso(nowMs),
      summary: str(record.summary || record.text).slice(0, 800),
      summaryChinese: str(record.localized_summary || record.localizedSummary).slice(0, 800),
      level: isChosen ? chosen.level : str(record.signal_type || record.type || record.kind) || "context",
      disposition, sourceState: sourceState || null,
      timingKind: isChosen ? str(chosen.timingKind) || null : str(window.target_kind) || null,
      targetAt: isChosen ? iso(chosen.deadlineMs) : iso(window.target_at || window.end_at),
      windowStartAt: isChosen ? iso(chosen.windowStartMs) : iso(window.start_at),
      weight: isChosen ? rounded(chosen.commitmentFloor ?? chosen.signalScore) : null,
      signalTier: str(record.signal_tier) || null,
      alertEventId: str(record.alert_event_id) || null,
      sourceWindowStartAt: iso(window.start_at),
    };
    // The structured current interpretation wins over raw same-post history.
    if (!prior || (isChosen && record === forecast.official_signal)) grouped.set(id, item);
  }
  return [...grouped.values()].sort((a, b) =>
    Number(b.disposition === "adopted") - Number(a.disposition === "adopted") ||
    (Date.parse(b.publishedAt) || 0) - (Date.parse(a.publishedAt) || 0)).slice(0, 16);
}

function comparePlans(beforeValue, afterValue, nowMs) {
  if (!beforeValue || !afterValue) return null;
  const before = planAccounts(beforeValue);
  const after = planAccounts(afterValue);
  const beforeActions = planActions(beforeValue);
  const afterActions = planActions(afterValue);
  const changed = after.some((account) => {
    const prior = before.find((row) => row.id === account.id);
    return !prior || prior.targetAt !== account.targetAt ||
      (prior.targetPercent === null) !== (account.targetPercent === null) ||
      Math.abs((prior.targetPercent || 0) - (account.targetPercent || 0)) >= 0.05;
  }) || JSON.stringify(beforeActions) !== JSON.stringify(afterActions);
  return { method: "same-time-public-inputs", at: iso(nowMs), changed, before, after, beforeActions, afterActions };
}

function semanticKey(record) {
  return JSON.stringify({
    source: record.source,
    evidence: record.evidence.map(({ firstReceivedAt, ...rest }) => rest),
    accounts: record.accounts.map((row) => ({
      id: row.id, cycle: row.cycleGeneration, fresh: row.fresh, mode: row.mode,
      usedBucket: row.usedPercent === null ? null : Math.floor(row.usedPercent / 2),
      signalId: row.signalId, signalLevel: row.signalLevel, deliveredEventId: row.deliveredEventId,
      // Ordinary rolling horizons change with the clock, not with a message.
      targetAt: ["explicit", "commitment"].includes(row.mode) ? row.targetAt : null,
    })),
    actions: { work: record.actions.work, credit: record.actions.credit, account: record.actions.account,
      creditReason: record.actions.creditReason, availableCredits: record.actions.availableCredits },
  });
}

function recordDecisionHistory(historyValue, modelValue, options = {}) {
  const history = normalizeDecisionHistory(historyValue);
  const nowMs = options.nowMs ?? Date.now();
  const model = obj(modelValue);
  const forecast = obj(model.forecast);
  const inputs = obj(options.inputs);
  const sourceStatus = options.sourceStatus || (forecast.mode === "local-only" ? "unavailable" : forecast.fresh ? "fresh" : "stale");
  const sourceUsable = sourceStatus === "fresh" && forecast.mode !== "local-only";
  const record = {
    id: `decision-${history.sequence + 1}`, at: iso(nowMs), trigger: options.trigger || "clock",
    sourceUpdatedAt: iso(forecast.updatedAtMs),
    source: {
      host: str(inputs.sourceHost) || "configured-source", status: sourceStatus,
      modelVersion: str(forecast.modelVersion) || null,
      baseDailyRate: finite(forecast.baseDailyRate),
      p24: sourceUsable ? rounded(forecast.p24) : null,
      p48: sourceUsable ? rounded(forecast.p48) : null,
      cachedP24: forecast.mode === "local-only" ? null : rounded(forecast.p24),
      cachedP48: forecast.mode === "local-only" ? null : rounded(forecast.p48),
    },
    evidence: publicEvidence(model, inputs, history, nowMs),
    accounts: planAccounts(model), actions: planActions(model),
    impact: comparePlans(options.beforeModel, options.afterModel, nowMs),
  };
  const latest = history.records.at(-1);
  record.relatedEventIds = [...new Set([
    ...record.evidence.filter((item) => JSON.stringify(item) !== JSON.stringify(latest?.evidence.find((prior) => prior.id === item.id))).map((item) => item.id),
    ...record.accounts.filter((account) => account.deliveredEventId && account.deliveredAt !== latest?.accounts.find((prior) => prior.id === account.id)?.deliveredAt).map((account) => account.deliveredEventId),
    ...(record.impact ? record.accounts.map((account) => account.signalId).filter(Boolean) : []),
  ])];
  const changed = !latest || semanticKey(latest) !== semanticKey(record);
  const clockSample = latest && nowMs - Date.parse(latest.at) >= hour;
  history.lastCheckedAt = iso(nowMs);
  history.lastError = null;
  if (!changed && !clockSample) return history;
  if (!latest) record.trigger = "initial-observation";
  else if (!changed) { record.trigger = "clock"; record.impact = null; record.relatedEventIds = []; }
  history.startedAt ||= record.at;
  history.sequence += 1;
  history.records.push(record);
  return normalizeDecisionHistory(history);
}

function reasonText(code, english = false) {
  const copy = {
    "account-unavailable": ["本账户用量尚不可靠，暂不据此要求加速或用券。", "This account lacks reliable usage data; do not accelerate or redeem on that basis."],
    "natural-first": ["本账户自然刷新更早，这条消息没有进一步提前计划。", "This account's natural reset comes first, so the message does not bring its plan forward."],
    "explicit-pending": ["明确刷新尚未在本账户到账，按公告时间优先安排现有工作。", "The announced reset has not landed for this account; prioritize existing work before its stated time."],
    "promise-dated": ["新的重置承诺仍有效，提前安排工作，但不把承诺当作已经到账。", "A timed reset promise remains active: bring work forward without treating it as delivered."],
    "promise-untimed": ["承诺还会重置，但时间未知；只提前安排少量工作，不制造截止时间。", "Another reset is promised, but timing is unknown; bring a limited amount of work forward without inventing a deadline."],
    "hint-reserve": ["消息只是可能重置的暗示；有限提前安排，不当成确定刷新。", "The message is only a possible-reset hint; make a bounded adjustment, not a certain-reset plan."],
    "ordinary-after-delivery": ["已到账的旧事件不再催促使用；现在按本周期和其他有效依据安排。", "A delivered event no longer urges spending; plan from the current cycle and other valid evidence."],
    "cadence-and-local": ["当前没有未兑现的有效重置消息，按自然刷新、公开基础预测和本机工作趋势安排。", "No active reset message is pending; use natural renewal, the public cadence forecast, and local work trends."],
    "local-only": ["公共预测暂不可用，保留本机事实，不把缺失数据解释成没有重置风险。", "The public forecast is unavailable; keep local facts without treating missing data as zero reset risk."],
  };
  return (copy[code] || copy["local-only"])[english ? 1 : 0];
}

module.exports = { normalizeDecisionHistory, recordDecisionHistory, comparePlans, planAccounts, planActions, reasonText };
