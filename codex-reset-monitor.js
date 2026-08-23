#!/opt/homebrew/bin/node

const childProcess = require("node:child_process");
const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const vm = require("node:vm");
const { createBehaviorEngine } = require("./codex-reset-behavior.js");
const { createShortLoadWorkerEngine } = require("./codex-reset-short-load.js");

const hour = 60 * 60 * 1000;
const minute = 60 * 1000;
const listenHost = process.env.CODEX_RESET_LISTEN_HOST || "127.0.0.1";
const listenPort = Number(process.env.CODEX_RESET_LISTEN_PORT || 18765);
const upstreamBridge = (
  process.env.CODEX_RESET_UPSTREAM_BRIDGE_URL || "http://127.0.0.1:18764"
).replace(/\/+$/, "");
const standaloneCodexBarCLI = process.env.CODEX_RESET_CODEXBAR_CLI || "";
const providerFile =
  process.env.CODEX_RESET_PROVIDER_FILE ||
  path.join(process.env.HOME || "", ".config/codexbar/providers/codex-reset.js");
const stateFile =
  process.env.CODEX_RESET_STATE_FILE ||
  path.join(process.env.HOME || "", ".config/codexbar/codex-reset-monitor-state.json");
const assetDirectory =
  process.env.CODEX_RESET_ASSET_DIR ||
  path.join(process.env.HOME || "", ".config/codexbar/codex-reset-receiver");
const codexHistoryFile =
  process.env.CODEX_RESET_HISTORY_FILE ||
  path.join(
    process.env.HOME || "",
    "Library/Application Support/com.steipete.codexbar/history/codex.json",
  );
const codexDirectory = path.join(process.env.HOME || "", ".codex");

function newestNumberedDatabase(directory, prefix, fallbackName) {
  try {
    const candidates = fs
      .readdirSync(directory)
      .map((name) => {
        const match = name.match(new RegExp(`^${prefix}_(\\d+)\\.sqlite$`));
        return match ? { name, version: Number(match[1]) } : null;
      })
      .filter(Boolean)
      .sort((left, right) => right.version - left.version);
    if (candidates.length) return path.join(directory, candidates[0].name);
  } catch {
    // The database may not exist yet on a fresh Codex installation.
  }
  return path.join(directory, fallbackName);
}

const codexStateDatabase =
  process.env.CODEX_RESET_CODEX_STATE_DB ||
  newestNumberedDatabase(codexDirectory, "state", "state_5.sqlite");
const codexGoalsDatabase =
  process.env.CODEX_RESET_CODEX_GOALS_DB ||
  newestNumberedDatabase(codexDirectory, "goals", "goals_1.sqlite");
const codexCostDatabase =
  process.env.CODEX_RESET_COST_DB ||
  path.join(
    process.env.HOME || "",
    "Library/Caches/CodexBar/cost-usage/cost-usage.sqlite",
  );
const sessionRefreshInterval = 5 * minute;
const signalBaseURL = (process.env.CODEX_RESET_SIGNAL_BASE_URL || "https://codex-reset.com").replace(
  /\/+$/,
  "",
);
const forecastURL = `${signalBaseURL}/api/forecast?locale=zh&tz=Asia%2FSingapore`;
const feedURL = `${signalBaseURL}/api/feed?locale=zh`;
const atomURL = `${signalBaseURL}/feed.xml`;
const pushKeyURL = `${signalBaseURL}/api/push/key`;
const pushSubscribeURL = `${signalBaseURL}/api/push/subscribe`;
const pushUnsubscribeURL = `${signalBaseURL}/api/push/unsubscribe`;
const tiboProfileURL = "https://x.com/thsottiaux";
const dryRun = process.argv.includes("--dry-run");
const once = process.argv.includes("--once") || dryRun;

function loadLogic() {
  const source = fs.readFileSync(providerFile, "utf8");
  let provider = null;
  const context = vm.createContext({
    defineProvider(value) {
      provider = value;
    },
  });
  vm.runInContext(source, context, { filename: providerFile });
  return {
    buildModel: vm.runInContext("codexResetBuildModel", context),
    pickUsage: vm.runInContext("codexResetPickWeeklyUsage", context),
    pickUsages: vm.runInContext("codexResetWeeklyUsages", context),
    provider,
  };
}

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function text(value) {
  return typeof value === "string" ? value.trim() : "";
}

function millis(value) {
  const parsed = typeof value === "string" ? Date.parse(value) : NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampMillis(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value > 10_000_000_000 ? value : value * 1000;
  }
  return millis(value);
}

function iso(value) {
  return new Date(value).toISOString();
}

function utc8(valueMs) {
  if (!Number.isFinite(valueMs)) return "立即";
  const shifted = new Date(valueMs + 8 * hour);
  return `${shifted.toISOString().slice(5, 16).replace("T", " ")} UTC+8`;
}

function whole(value) {
  return Math.max(0, Math.round(Number(value) || 0));
}

function opaqueAccountID(value) {
  const source = text(value);
  return source ? crypto.createHash("sha256").update(source).digest("hex").slice(0, 24) : null;
}

function historyAccountKey(parsedValue) {
  const parsed = object(parsedValue) || {};
  const cacheKey = text(parsed.accountId);
  const workspace = cacheKey.match(/^codex:workspace:([^:]+):email:/);
  if (workspace) return `codex:v1:provider-account:${workspace[1].trim().toLowerCase()}`;
  const email = text(parsed.accountEmail).toLowerCase();
  if (!email) return null;
  return `codex:v1:email-hash:${crypto.createHash("sha256").update(email).digest("hex")}`;
}

function codexPlanRank(value) {
  const plan = text(value).toLowerCase().replace(/[ _-]+/g, " ");
  if (["go"].includes(plan)) return 1;
  if (["plus", "plus plan", "chatgpt plus"].includes(plan)) return 2;
  if (["prolite", "pro lite", "codex pro lite"].includes(plan)) return 3;
  if (["pro", "codex pro"].includes(plan)) return 4;
  return 0;
}

// API-equivalent dollars are an account-independent unit. Plan labels remain
// display metadata and never participate in capacity arithmetic.
const apiPricing = {
  "gpt-5": [1.25e-6, 1e-5, 1.25e-7],
  "gpt-5-codex": [1.25e-6, 1e-5, 1.25e-7],
  "gpt-5-mini": [2.5e-7, 2e-6, 2.5e-8],
  "gpt-5.1": [1.25e-6, 1e-5, 1.25e-7],
  "gpt-5.1-codex": [1.25e-6, 1e-5, 1.25e-7],
  "gpt-5.1-codex-max": [1.25e-6, 1e-5, 1.25e-7],
  "gpt-5.1-codex-mini": [2.5e-7, 2e-6, 2.5e-8],
  "gpt-5.2": [1.75e-6, 1.4e-5, 1.75e-7],
  "gpt-5.2-codex": [1.75e-6, 1.4e-5, 1.75e-7],
  "gpt-5.3-codex": [1.75e-6, 1.4e-5, 1.75e-7],
  "gpt-5.3-codex-spark": [0, 0, 0],
  "gpt-5.4": [2.5e-6, 1.5e-5, 2.5e-7, 5e-6, 2.25e-5, 5e-7],
  "gpt-5.4-mini": [7.5e-7, 4.5e-6, 7.5e-8],
  "gpt-5.4-nano": [2e-7, 1.25e-6, 2e-8],
  "gpt-5.5": [5e-6, 3e-5, 5e-7, 1e-5, 4.5e-5, 1e-6],
  "gpt-5.6-sol": [5e-6, 3e-5, 5e-7, 1e-5, 4.5e-5, 1e-6],
  "gpt-5.6-terra": [2e-6, 1.2e-5, 2e-7, 4e-6, 1.8e-5, 4e-7],
  "gpt-5.6-luna": [2e-7, 1.2e-6, 2e-8, 4e-7, 1.8e-6, 4e-8],
};

function apiEquivalentCost(value) {
  const row = object(value) || {};
  const model = text(row.pricingModel || row.model).toLowerCase();
  const pricing = apiPricing[model];
  if (!pricing) return 0;
  const input = Math.max(0, Number(row.input) || 0);
  const cached = Math.max(0, Math.min(input, Number(row.cached) || 0));
  const output = Math.max(0, Number(row.output) || 0);
  const above = input > 272_000 && pricing.length >= 6;
  const inputRate = above ? pricing[3] : pricing[0];
  const outputRate = above ? pricing[4] : pricing[1];
  const cachedRate = above ? pricing[5] : pricing[2];
  return (input - cached) * inputRate + cached * cachedRate + output * outputRate;
}

function readIncrementalAPICost(previousValue) {
  const previous = object(previousValue) || {};
  const previousRowID = Math.max(0, Number(previous.lastRowID) || 0);
  if (!fs.existsSync(codexCostDatabase)) return { lastRowID: previousRowID, deltaUSD: 0 };
  try {
    const sql = `SELECT rowid AS rowID, CAST(payload AS TEXT) AS payload FROM usage_rows WHERE rowid > ${previousRowID} ORDER BY rowid`;
    const output = childProcess.execFileSync("/usr/bin/sqlite3", ["-json", codexCostDatabase, sql], {
      encoding: "utf8",
      timeout: 8_000,
      maxBuffer: 32 * 1024 * 1024,
    });
    const rows = output.trim() ? JSON.parse(output) : [];
    const lastRowID = rows.reduce(
      (maximum, row) => Math.max(maximum, Number(row.rowID) || 0),
      previousRowID,
    );
    // The first observation establishes a cursor. It must not attribute all
    // historical local work to whichever account happens to be live now.
    if (!Number.isFinite(previous.lastRowID)) return { lastRowID, deltaUSD: 0 };
    const deltaUSD = rows.reduce((sum, row) => {
      try {
        return sum + apiEquivalentCost(JSON.parse(row.payload));
      } catch {
        return sum;
      }
    }, 0);
    return { lastRowID, deltaUSD: Math.max(0, deltaUSD) };
  } catch {
    return { lastRowID: previousRowID, deltaUSD: 0 };
  }
}

function normalizedCapacityEstimate(value) {
  const source = object(value) || {};
  const samples = (Array.isArray(source.samples) ? source.samples : [])
    .map((sampleValue) => {
      const sample = object(sampleValue);
      const atMs = millis(sample && sample.at);
      const fullCapacityUSD = Number(sample && sample.fullCapacityUSD);
      const costUSD = Number(sample && sample.costUSD);
      const percentDelta = Number(sample && sample.percentDelta);
      return atMs !== null && fullCapacityUSD > 0 && costUSD > 0 && percentDelta > 0
        ? { at: iso(atMs), fullCapacityUSD, costUSD, percentDelta }
        : null;
    })
    .filter(Boolean)
    .slice(-24);
  if (!samples.length) return { source: "api-equivalent-local", samples };
  const sorted = samples.map((item) => item.fullCapacityUSD).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const deviations = sorted.map((item) => Math.abs(item - median)).sort((a, b) => a - b);
  const mad = deviations[Math.floor(deviations.length / 2)] || median * 0.25;
  const accepted = samples.filter(
    (item) => samples.length < 4 || Math.abs(item.fullCapacityUSD - median) <= 3 * mad,
  );
  const values = accepted.map((item) => item.fullCapacityUSD).sort((a, b) => a - b);
  const estimateUSD = values[Math.floor(values.length / 2)];
  return {
    source: "api-equivalent-local",
    samples,
    estimateUSD,
    lowerUSD: values[Math.floor((values.length - 1) * 0.2)],
    upperUSD: values[Math.ceil((values.length - 1) * 0.8)],
    sampleCount: accepted.length,
    confidence: accepted.length >= 6 ? "high" : accepted.length >= 2 ? "medium" : "low",
  };
}

function appendCapacitySample(value, costUSD, percentDelta, atMs) {
  const estimate = normalizedCapacityEstimate(value);
  if (!(costUSD > 0.001 && percentDelta >= 0.05 && percentDelta <= 50)) return estimate;
  const fullCapacityUSD = costUSD / (percentDelta / 100);
  if (!(fullCapacityUSD > 0.01 && fullCapacityUSD < 100_000)) return estimate;
  return normalizedCapacityEstimate({
    samples: [...estimate.samples, { at: iso(atMs), fullCapacityUSD, costUSD, percentDelta }],
  });
}

function compactAccountLabel(value) {
  const raw = text(value);
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

function normalizedAccountState(value, id) {
  const source = object(value) || {};
  const usage = object(source.usage) || {};
  usage.samples = normalizedUsageSamples(usage.samples).slice(-20_160);
  usage.pace = object(usage.pace) || usagePaceFromSamples(usage.samples);
  usage.behavior = object(usage.behavior) || null;
  usage.shortLoad = normalizedShortLoadState(usage.shortLoad);
  const personalResets = classifiedLegacyPersonalResets([
    ...(Array.isArray(source.personalResets) ? source.personalResets : []),
    ...(object(source.lastPersonalReset) ? [source.lastPersonalReset] : []),
  ], usage.latest);
  return {
    id,
    label: text(source.label) || "Codex 账号",
    active: source.live === true || source.active === true,
    live: source.live === true || source.active === true,
    selected: source.selected === true,
    present: source.present !== false,
    planType: text(source.planType).toLowerCase(),
    planRank: Number(source.planRank) || 0,
    lastPaidPlanRank: Number(source.lastPaidPlanRank) || 0,
    lapsedPaidPlanRank: Number(source.lapsedPaidPlanRank) || 0,
    lapsedCycleResetsAt:
      millis(source.lapsedCycleResetsAt) === null ? null : iso(millis(source.lapsedCycleResetsAt)),
    subscriptionRenewsAt:
      millis(source.subscriptionRenewsAt) === null ? null : iso(millis(source.subscriptionRenewsAt)),
    subscriptionExpiresAt:
      millis(source.subscriptionExpiresAt) === null ? null : iso(millis(source.subscriptionExpiresAt)),
    capacityEstimate: normalizedCapacityEstimate(source.capacityEstimate),
    historyAccountKey: text(source.historyAccountKey) || null,
    usage,
    resetCredits: normalizedResetCreditInventory(source.resetCredits),
    targetTrajectory: normalizedTargetTrajectory(source.targetTrajectory),
    personalResets,
    lastPersonalReset: personalResets[personalResets.length - 1] || null,
    forecastNotification: object(source.forecastNotification) || {},
    behaviorNotification: object(source.behaviorNotification) || {},
  };
}

function normalizedResetCredit(value) {
  const source = object(value);
  const id = text(source && source.id);
  const grantedAtMs = timestampMillis(source && (source.grantedAt || source.granted_at));
  if (!id || grantedAtMs === null) return null;
  const expiresAtMs = timestampMillis(source.expiresAt || source.expires_at);
  const redeemStartedAtMs = timestampMillis(source.redeemStartedAt || source.redeem_started_at);
  const redeemedAtMs = timestampMillis(source.redeemedAt || source.redeemed_at);
  const rawStatus = text(source.status).toLowerCase().replace(/_/g, "-");
  const status = ["available", "redeeming", "redeemed", "expired", "disappeared-unknown"].includes(
    rawStatus,
  )
    ? rawStatus
    : "available";
  return {
    id,
    resetType: text(source.resetType || source.reset_type) || "full",
    status,
    grantedAt: iso(grantedAtMs),
    expiresAt: expiresAtMs === null ? null : iso(expiresAtMs),
    redeemStartedAt: redeemStartedAtMs === null ? null : iso(redeemStartedAtMs),
    redeemedAt: redeemedAtMs === null ? null : iso(redeemedAtMs),
  };
}

function normalizedResetCreditInventory(value) {
  const source = object(value);
  if (!source) return null;
  const updatedAtMs = timestampMillis(source.updatedAt || source.updated_at);
  const referenceAtMs = updatedAtMs || Date.now();
  const credits = (Array.isArray(source.credits) ? source.credits : [])
    .map(normalizedResetCredit)
    .filter(Boolean)
    .sort((left, right) => left.id.localeCompare(right.id));
  return {
    reliable: source.reliable !== false,
    updatedAt: updatedAtMs === null ? null : iso(updatedAtMs),
    credits,
    availableCount: credits.filter(
      (credit) =>
        credit.status === "available" &&
        (millis(credit.expiresAt) === null || millis(credit.expiresAt) > referenceAtMs),
    ).length,
  };
}

function reconcileResetCreditInventory(previousValue, currentValue, nowMs, resetEvidence) {
  const previous = normalizedResetCreditInventory(previousValue);
  const current = normalizedResetCreditInventory(currentValue);
  if (!current || current.reliable !== true) return previous;
  const byID = new Map(current.credits.map((credit) => [credit.id, credit]));
  for (const oldCredit of (previous && previous.credits) || []) {
    if (byID.has(oldCredit.id)) continue;
    if (oldCredit.status !== "available") {
      byID.set(oldCredit.id, oldCredit);
      continue;
    }
    const expired = millis(oldCredit.expiresAt) !== null && millis(oldCredit.expiresAt) <= nowMs;
    byID.set(oldCredit.id, {
      ...oldCredit,
      status: expired ? "expired" : resetEvidence ? "redeemed" : "disappeared-unknown",
      redeemedAt: resetEvidence ? iso(nowMs) : oldCredit.redeemedAt,
    });
  }
  return normalizedResetCreditInventory({
    reliable: true,
    updatedAt: current.updatedAt || iso(nowMs),
    credits: [...byID.values()],
  });
}

function consumedResetCredit(previousValue, currentValue, nowMs) {
  const previous = normalizedResetCreditInventory(previousValue);
  const current = normalizedResetCreditInventory(currentValue);
  if (!previous || !current || previous.reliable !== true || current.reliable !== true) return null;
  const currentByID = new Map(current.credits.map((credit) => [credit.id, credit]));
  for (const credit of previous.credits) {
    if (credit.status !== "available") continue;
    const next = currentByID.get(credit.id);
    if (next && ["redeeming", "redeemed"].includes(next.status)) return credit;
    if (!next && (millis(credit.expiresAt) === null || millis(credit.expiresAt) > nowMs)) {
      const nextAvailable = current.credits.filter((item) => item.status === "available").length;
      const previousAvailable = previous.credits.filter((item) => item.status === "available").length;
      if (nextAvailable < previousAvailable) return credit;
    }
  }
  return null;
}

function syncActiveAccountState(state) {
  const account = object(state.accountStates && state.accountStates[state.activeAccountId]);
  if (!account) return;
  account.usage = state.usage;
  account.targetTrajectory = state.targetTrajectory;
  account.personalResets = state.personalResets;
  account.lastPersonalReset = state.lastPersonalReset;
  account.forecastNotification = state.forecastNotification;
  account.behaviorNotification = state.behaviorNotification;
}

function bindActiveAccountState(state) {
  const account = object(state.accountStates && state.accountStates[state.activeAccountId]);
  if (!account) return false;
  state.usage = account.usage;
  state.targetTrajectory = account.targetTrajectory;
  state.personalResets = account.personalResets;
  state.lastPersonalReset = account.lastPersonalReset;
  state.forecastNotification = account.forecastNotification;
  state.behaviorNotification = account.behaviorNotification;
  return true;
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#(\d+);/g, (_, number) => String.fromCodePoint(Number(number)))
    .replace(/&#x([0-9a-f]+);/gi, (_, number) => String.fromCodePoint(parseInt(number, 16)));
}

function stripTags(value) {
  return decodeEntities(String(value || "").replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
}

function readState() {
  try {
    const value = JSON.parse(fs.readFileSync(stateFile, "utf8"));
    return object(value) || {};
  } catch {
    return {};
  }
}

function normalizedPersonalResets(value) {
  const records = (Array.isArray(value) ? value : [])
    .map((entry) => {
      const source = object(entry);
      const atMs = millis(source && source.at);
      if (atMs === null) return null;
      const rawCause = text(source.cause).toLowerCase();
      // Older builds left real quota refreshes as "unclassified" even after
      // the refresh itself was proven. Once banked, upgrade and automatic
      // evidence have been excluded, an unexpected full-window refresh is the
      // platform/manual reset branch rather than an unresolved user state.
      const cause = ["automatic", "banked-redeem", "global-manual", "upgrade", "unclassified"].includes(
        rawCause,
      )
        ? rawCause
        : "unclassified";
      return {
        at: iso(atMs),
        cause,
        evidence: text(source.evidence) || "unknown",
        eventId: text(source.eventId) || null,
      };
    })
    .filter(Boolean)
    .sort((left, right) => millis(left.at) - millis(right.at));

  // A drifting upstream reset timestamp used to create one "refresh" every
  // minute. Collapse a same-evidence burst into one event so the history is a
  // list of quota cycles, not polling artefacts.
  const deduped = [];
  for (const record of records) {
    const previous = deduped[deduped.length - 1];
    const sameBurst = Boolean(
      previous &&
        previous.cause === record.cause &&
        previous.evidence === record.evidence &&
        previous.eventId === record.eventId &&
        millis(record.at) - millis(previous.at) <= 2 * hour,
    );
    if (sameBurst) deduped[deduped.length - 1] = record;
    else deduped.push(record);
  }
  return deduped.slice(-24);
}

function classifiedLegacyPersonalResets(value, latestUsageValue) {
  const latest = object(latestUsageValue);
  const cycleStartMs =
    latest &&
    Number.isFinite(latest.resetsAtMs) &&
    Number.isFinite(latest.windowMinutes) &&
    latest.windowMinutes > 0
      ? latest.resetsAtMs - latest.windowMinutes * minute
      : null;
  return normalizedPersonalResets(value).map((record) => {
    const legacyFallback = Boolean(
      record.cause === "global-manual" &&
        !record.eventId &&
        ["usage-decreased", "reset-time-advanced"].includes(record.evidence),
    );
    if (record.cause !== "unclassified" && !legacyFallback) return record;
    if (/^credit-consumed:/.test(record.evidence)) return { ...record, cause: "banked-redeem" };
    if (record.eventId) return { ...record, cause: "global-manual" };
    const atMs = millis(record.at);
    if (
      cycleStartMs !== null &&
      atMs !== null &&
      Math.abs(atMs - cycleStartMs) <= 12 * hour
    ) {
      return { ...record, cause: "automatic", evidence: `${record.evidence}:cycle-boundary` };
    }
    return {
      ...record,
      cause: "global-manual",
      evidence: `unexpected-platform-refresh:${record.evidence}`,
    };
  }).filter(
    (record) => record.evidence !== "unexpected-platform-refresh:reset-time-advanced",
  );
}

function addSingaporeCalendarMonth(valueMs) {
  const shifted = new Date(valueMs + 8 * hour);
  const year = shifted.getUTCFullYear();
  const month = shifted.getUTCMonth();
  const day = shifted.getUTCDate();
  const lastDay = new Date(Date.UTC(year, month + 2, 0)).getUTCDate();
  return (
    Date.UTC(
      year,
      month + 1,
      Math.min(day, lastDay),
      shifted.getUTCHours(),
      shifted.getUTCMinutes(),
      shifted.getUTCSeconds(),
      shifted.getUTCMilliseconds(),
    ) -
    8 * hour
  );
}

function renewalObservationFromHistory(value, nowMs = Date.now()) {
  return {
    status: "not-a-reset-boundary",
    evidenceCount: 0,
    lastObservedAt: null,
    nextAt: null,
  };
}

function sessionCycleStart(stateValue, nowMs = Date.now()) {
  const state = object(stateValue) || {};
  const usage = object(object(state.usage) && state.usage.latest);
  const lastReset = object(state.lastPersonalReset);
  const candidates = [nowMs - 7 * 24 * hour];
  const lastResetAtMs = millis(lastReset && lastReset.at);
  if (lastResetAtMs !== null && lastResetAtMs <= nowMs + minute) {
    candidates.push(lastResetAtMs);
  }
  if (
    usage &&
    Number.isFinite(usage.resetsAtMs) &&
    Number.isFinite(usage.windowMinutes) &&
    usage.windowMinutes > 0
  ) {
    const inferredAtMs = usage.resetsAtMs - usage.windowMinutes * minute;
    if (inferredAtMs <= nowMs + minute) candidates.push(inferredAtMs);
  }
  return Math.max(...candidates.filter(Number.isFinite));
}

function sqliteJSON(database, query) {
  if (!fs.existsSync(database)) throw new Error("database_missing");
  const output = childProcess.execFileSync(
    "/usr/bin/sqlite3",
    ["-readonly", "-json", database, query],
    {
      encoding: "utf8",
      timeout: 3_000,
      maxBuffer: 2 * 1024 * 1024,
      stdio: ["ignore", "pipe", "ignore"],
    },
  );
  const trimmed = output.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [];
}

function localSessionRows(cycleStartMs) {
  const lowerBound = Math.max(0, Math.floor(cycleStartMs));
  return sqliteJSON(
    codexStateDatabase,
    `SELECT id,
            COALESCE(NULLIF(name, ''), NULLIF(title, ''), '未命名 session') AS display_title,
            cwd,
            tokens_used,
            created_at_ms,
            recency_at_ms,
            updated_at_ms,
            is_pinned
       FROM threads
      WHERE archived = 0
        AND LOWER(COALESCE(thread_source, source, '')) NOT LIKE '%subagent%'
        AND recency_at_ms >= ${lowerBound}
      ORDER BY recency_at_ms DESC
      LIMIT 40;`,
  );
}

function localGoalRows() {
  if (!fs.existsSync(codexGoalsDatabase)) return [];
  return sqliteJSON(codexGoalsDatabase, "SELECT thread_id, status FROM thread_goals;");
}

function normalizedSessionTitle(value) {
  const normalized = text(value).replace(/\s+/g, " ");
  return (normalized || "未命名 session").slice(0, 300);
}

function sessionProject(value) {
  const normalized = text(value).replace(/\/+$/, "");
  if (!normalized) return "";
  return path.basename(normalized).slice(0, 120);
}

function sessionGoalPriority(value) {
  const status = text(value).toLowerCase();
  if (["paused", "usage_limited", "budget_limited"].includes(status)) return 4;
  if (status === "active") return 3;
  if (status === "blocked") return 1;
  return 0;
}

function sessionReason(goalStatus, pinned, observedTokens) {
  if (goalStatus === "paused") return "Goal 已暂停";
  if (goalStatus === "usage_limited") return "Goal 因用量限制暂停";
  if (goalStatus === "budget_limited") return "Goal 因预算限制暂停";
  if (goalStatus === "active") return "Goal 仍在进行";
  if (goalStatus === "blocked") return "Goal 有待处理的阻塞项";
  if (pinned) return "已置顶";
  if (observedTokens > 0) return "本机观察期仍有用量";
  return "本周期最近活跃";
}

function sessionCandidatesFromRows(
  rowsValue,
  goalsValue,
  previousValue,
  cycleStartMs,
  nowMs = Date.now(),
) {
  const previous = object(previousValue) || {};
  const previousCycleStartMs = millis(previous.cycleStartAt);
  const sameCycle =
    previousCycleStartMs !== null && Math.abs(previousCycleStartMs - cycleStartMs) <= minute;
  const previousBaselines = sameCycle ? object(previous.baselines) || {} : {};
  const previousObservationStartedAtMs = sameCycle ? millis(previous.observationStartedAt) : null;
  const observationStartedAtMs = previousObservationStartedAtMs || nowMs;
  const goals = new Map();
  for (const item of Array.isArray(goalsValue) ? goalsValue : []) {
    const goal = object(item);
    const id = text(goal && goal.thread_id);
    const status = text(goal && goal.status).toLowerCase();
    if (id && status) goals.set(id, status);
  }

  const baselines = {};
  const candidates = [];
  for (const item of Array.isArray(rowsValue) ? rowsValue : []) {
    const row = object(item);
    const id = text(row && row.id);
    const recencyAtMs = Number(row && (row.recency_at_ms || row.updated_at_ms));
    if (!id || !Number.isFinite(recencyAtMs) || recencyAtMs < cycleStartMs) continue;
    const goalStatus = goals.get(id) || "";
    if (["complete", "completed", "achieved"].includes(goalStatus)) continue;

    const currentTokens = Math.max(0, Number(row.tokens_used) || 0);
    const createdAtMs = Number(row.created_at_ms);
    let baseline = Number(previousBaselines[id]);
    if (!Number.isFinite(baseline) || baseline < 0 || baseline > currentTokens) {
      baseline =
        Number.isFinite(createdAtMs) && createdAtMs >= observationStartedAtMs
          ? 0
          : currentTokens;
    }
    baselines[id] = baseline;
    const observedTokens = Math.max(0, currentTokens - baseline);
    const pinned = Number(row.is_pinned) === 1;
    candidates.push({
      id,
      title: normalizedSessionTitle(row.display_title),
      project: sessionProject(row.cwd),
      lastActiveAt: iso(recencyAtMs),
      lastActiveAtMs: recencyAtMs,
      pinned,
      goalStatus: goalStatus || null,
      observedTokens,
      reason: sessionReason(goalStatus, pinned, observedTokens),
      goalPriority: sessionGoalPriority(goalStatus),
    });
  }

  candidates.sort(
    (left, right) =>
      right.goalPriority - left.goalPriority ||
      Number(right.pinned) - Number(left.pinned) ||
      Number(right.observedTokens > 0) - Number(left.observedTokens > 0) ||
      right.observedTokens - left.observedTokens ||
      right.lastActiveAtMs - left.lastActiveAtMs ||
      left.title.localeCompare(right.title),
  );
  return {
    cycleStartAt: iso(cycleStartMs),
    observationStartedAt: iso(observationStartedAtMs),
    baselines,
    candidateCount: candidates.length,
    candidates: candidates.slice(0, 12).map(({ goalPriority, lastActiveAtMs, ...candidate }) =>
      candidate,
    ),
  };
}

function normalizedSessionState(value) {
  const source = object(value) || {};
  const baselines = {};
  for (const [id, value] of Object.entries(object(source.baselines) || {})) {
    if (text(id) && Number.isFinite(Number(value)) && Number(value) >= 0) {
      baselines[id] = Number(value);
    }
  }
  return {
    cycleStartAt: millis(source.cycleStartAt) === null ? null : iso(millis(source.cycleStartAt)),
    observationStartedAt:
      millis(source.observationStartedAt) === null
        ? null
        : iso(millis(source.observationStartedAt)),
    baselines,
    candidateCount: Math.max(0, Number(source.candidateCount) || 0),
    candidates: (Array.isArray(source.candidates) ? source.candidates : [])
      .map((item) => {
        const candidate = object(item);
        const id = text(candidate && candidate.id);
        const lastActiveAtMs = millis(candidate && candidate.lastActiveAt);
        if (!id || lastActiveAtMs === null) return null;
        return {
          id,
          title: normalizedSessionTitle(candidate.title),
          project: text(candidate.project).slice(0, 120),
          lastActiveAt: iso(lastActiveAtMs),
          pinned: candidate.pinned === true,
          goalStatus: text(candidate.goalStatus) || null,
          observedTokens: Math.max(0, Number(candidate.observedTokens) || 0),
          reason: text(candidate.reason).slice(0, 120) || "本周期最近活跃",
        };
      })
      .filter(Boolean)
      .slice(0, 12),
    status: ["ready", "stale", "unavailable"].includes(text(source.status))
      ? text(source.status)
      : "unavailable",
    updatedAt: millis(source.updatedAt) === null ? null : iso(millis(source.updatedAt)),
    lastErrorAt: millis(source.lastErrorAt) === null ? null : iso(millis(source.lastErrorAt)),
  };
}

function publicSessionSuggestions(value) {
  const sessions = normalizedSessionState(value);
  return {
    status: sessions.status,
    cycleStartAt: sessions.cycleStartAt,
    observationStartedAt: sessions.observationStartedAt,
    updatedAt: sessions.updatedAt,
    candidateCount: sessions.candidateCount,
    observationReady: sessions.candidates.some((candidate) => candidate.observedTokens > 0),
    candidates: sessions.candidates.slice(0, 5).map((candidate) => ({
      title: candidate.title,
      project: candidate.project,
      lastActiveAt: candidate.lastActiveAt,
      pinned: candidate.pinned,
      goalStatus: candidate.goalStatus,
      observedTokens: candidate.observedTokens,
      reason: candidate.reason,
    })),
  };
}

function rememberClosedEvent(state, id) {
  const value = text(id);
  if (!value) return;
  state.events.closedIds = [
    ...state.events.closedIds.filter((entry) => entry !== value),
    value,
  ].slice(-64);
}

function globalSettlementFromState(stateValue) {
  const state = object(stateValue) || {};
  const events = object(state.events) || {};
  const candidates = [];

  function add(at, eventId, source) {
    const atMs = millis(at);
    if (atMs === null) return;
    candidates.push({
      atMs,
      throughAt: iso(atMs),
      eventId: text(eventId) || null,
      source,
    });
  }

  add(events.globalSettledThroughAt, events.globalSettlementEventId, "persisted");
  if (Object.keys(object(state.accountStates) || {}).length) {
    candidates.sort((left, right) => right.atMs - left.atMs);
    return candidates[0] || { atMs: null, throughAt: null, eventId: null, source: null };
  }
  const lastPersonalReset = object(state.lastPersonalReset);
  if (lastPersonalReset && text(lastPersonalReset.cause).toLowerCase() === "global-manual") {
    add(lastPersonalReset.at, lastPersonalReset.eventId, "last-personal-reset");
  }
  for (const reset of normalizedPersonalResets(state.personalResets)) {
    if (reset.cause.toLowerCase() === "global-manual") add(reset.at, reset.eventId, "history");
  }

  candidates.sort((left, right) => right.atMs - left.atMs);
  return candidates[0] || {
    atMs: null,
    throughAt: null,
    eventId: null,
    source: null,
  };
}

function eventAnnouncedAtMs(eventValue) {
  const event = object(eventValue);
  return millis(event && (event.announcedAt || event.announced_at || event.at));
}

function terminalVerification(value) {
  return ["confirmed", "verified", "rejected", "failed", "expired", "completed", "landed"].includes(
    text(value).toLowerCase(),
  );
}

function negativeVerification(value) {
  return ["rejected", "failed", "expired"].includes(text(value).toLowerCase());
}

function rememberRejectedEvent(state, eventValue, reason, nowMs = Date.now()) {
  const event = object(eventValue) || {};
  const id = eventID(event.id || event.tweet_id || event.url) || "unknown";
  state.events.rejectedEvents = [
    ...state.events.rejectedEvents.filter(
      (entry) => !(entry && entry.id === id && entry.reason === reason),
    ),
    { id, reason, at: iso(nowMs) },
  ].slice(-32);
}

function clearActiveEpisode(state, reason, nowMs, preserveOrdering = true) {
  const active = object(state.activeEpisode);
  if (!active) return { cleared: false, reason: null, event: null };
  const id = eventID(active.id || active.url);
  if (preserveOrdering && id) rememberClosedEvent(state, id);
  if (!preserveOrdering && id && state.events.lastEventId === id) {
    state.events.lastEventId = null;
    state.events.lastEventAt = null;
  }
  rememberRejectedEvent(state, active, reason, nowMs);
  state.activeEpisode = null;
  return { cleared: true, reason, event: active };
}

function eventStartsAfterSettlement(eventValue, settlementAtMs) {
  const event = object(eventValue);
  if (!event || settlementAtMs === null) return false;
  const window = object(event.official_window) || object(event.window) || {};
  const startAtMs =
    millis(event.windowStartAt) ||
    millis(window.start_at) ||
    millis(event.effectiveAt) ||
    millis(event.effective_at) ||
    millis(event.start_at);
  return startAtMs !== null && startAtMs > settlementAtMs;
}

function eventSettledByState(stateValue, eventValue) {
  const settlement = globalSettlementFromState(stateValue);
  const eventAtMs = eventAnnouncedAtMs(eventValue);
  return Boolean(
    settlement.atMs !== null &&
      eventAtMs !== null &&
      eventAtMs <= settlement.atMs &&
      !eventStartsAfterSettlement(eventValue, settlement.atMs),
  );
}

function advanceGlobalSettlement(stateValue, resetValue) {
  const state = object(stateValue);
  const reset = object(resetValue);
  if (!state || !reset || text(reset.cause).toLowerCase() !== "global-manual") {
    return globalSettlementFromState(state);
  }
  const atMs = millis(reset.at);
  if (atMs === null) return globalSettlementFromState(state);
  state.events = object(state.events) || {};
  const previous = globalSettlementFromState(state);
  if (previous.atMs === null || atMs >= previous.atMs) {
    state.events.globalSettledThroughAt = iso(atMs);
    state.events.globalSettlementEventId = text(reset.eventId) || null;
  }
  return globalSettlementFromState(state);
}

function normalizedTargetTrajectory(value) {
  const source = object(value);
  if (!source) return null;
  const anchorAtMs = millis(source.anchorAt);
  const naturalResetAtMs = millis(source.naturalResetAt);
  const cycleStartedAtMs = millis(source.cycleStartedAt);
  const cycleResetAtMs = millis(source.cycleResetAt);
  const anchorRemainingPercent = Number(source.anchorRemainingPercent);
  const policyKind = text(source.policyKind);
  const policyHazardPerHour = Number(source.policyHazardPerHour);
  const policyDeadlineAtMs = millis(source.policyDeadlineAt);
  if (
    [anchorAtMs, naturalResetAtMs, cycleStartedAtMs, cycleResetAtMs].some(
      (entry) => entry === null,
    ) ||
    naturalResetAtMs <= anchorAtMs ||
    !Number.isFinite(anchorRemainingPercent) ||
    anchorRemainingPercent < 0 ||
    anchorRemainingPercent > 100 ||
    !["baseline", "hazard", "deadline", "immediate"].includes(policyKind) ||
    !Number.isFinite(policyHazardPerHour) ||
    policyHazardPerHour < 0 ||
    (policyKind === "deadline" &&
      (policyDeadlineAtMs === null || policyDeadlineAtMs <= anchorAtMs))
  ) {
    return null;
  }
  return {
    version: 1,
    anchorAt: iso(anchorAtMs),
    anchorRemainingPercent,
    naturalResetAt: iso(naturalResetAtMs),
    cycleStartedAt: iso(cycleStartedAtMs),
    cycleResetAt: iso(cycleResetAtMs),
    policyKind,
    policyHazardPerHour,
    policyDeadlineAt: policyDeadlineAtMs === null ? null : iso(policyDeadlineAtMs),
    policySource: text(source.policySource) || "baseline",
    signalId: text(source.signalId) || null,
  };
}

function projectTargetTrajectory(value, atMs) {
  const source = normalizedTargetTrajectory(value);
  if (!source || !Number.isFinite(atMs)) return null;
  const anchorAtMs = millis(source.anchorAt);
  const naturalResetAtMs = millis(source.naturalResetAt);
  const projectedAtMs = Math.max(anchorAtMs, Math.min(atMs, naturalResetAtMs));
  const elapsedHours = Math.max(0, (projectedAtMs - anchorAtMs) / hour);
  let remainingPercent = source.anchorRemainingPercent;
  if (source.policyKind === "immediate") {
    remainingPercent = 0;
  } else if (source.policyKind === "deadline") {
    const deadlineAtMs = millis(source.policyDeadlineAt);
    remainingPercent *= Math.max(
      0,
      Math.min(1, (deadlineAtMs - projectedAtMs) / (deadlineAtMs - anchorAtMs)),
    );
  } else {
    remainingPercent *= Math.max(
      0,
      Math.min(
        1,
        (naturalResetAtMs - projectedAtMs) / (naturalResetAtMs - anchorAtMs),
      ),
    );
    if (source.policyKind === "hazard" && source.policyHazardPerHour > 0) {
      remainingPercent *= Math.exp(-source.policyHazardPerHour * elapsedHours);
    }
  }
  return Math.max(0, Math.min(100, remainingPercent));
}

function targetTrajectoryPolicy(modelValue) {
  const model = object(modelValue);
  const decision = object(model && (model.planningDecision || model.decision));
  const forecast = object(model && model.forecast);
  if (!decision) return null;
  return {
    kind: text(decision.trajectoryPolicyKind) || "baseline",
    hazardPerHour: Math.max(0, Number(decision.trajectoryHazardPerHour) || 0),
    deadlineAtMs: Number.isFinite(decision.trajectoryDeadlineMs)
      ? decision.trajectoryDeadlineMs
      : null,
    source: text(decision.mode) || "baseline",
    signalId: text(forecast && forecast.signal && forecast.signal.id) || null,
  };
}

function updateTargetTrajectory(previousValue, modelValue, nowMs) {
  const model = object(modelValue);
  const usage = object(model && model.usage);
  const decision = object(model && (model.planningDecision || model.decision));
  const policy = targetTrajectoryPolicy(model);
  if (!usage || !decision || !policy || !Number.isFinite(nowMs)) {
    return normalizedTargetTrajectory(previousValue);
  }
  const cycleResetAtMs = Number(usage.resetsAtMs);
  const windowMinutes = Number(usage.windowMinutes);
  const naturalResetAtMs = Number(decision.naturalResetAtMs);
  if (
    ![cycleResetAtMs, windowMinutes, naturalResetAtMs].every(Number.isFinite) ||
    windowMinutes <= 0 ||
    naturalResetAtMs <= nowMs
  ) {
    return normalizedTargetTrajectory(previousValue);
  }
  const cycleStartedAtMs = cycleResetAtMs - windowMinutes * minute;
  const previous = normalizedTargetTrajectory(previousValue);
  const sameCycle = Boolean(
    previous && Math.abs(millis(previous.cycleResetAt) - cycleResetAtMs) <= 2 * minute,
  );
  const previousDeadlineAtMs = previous ? millis(previous.policyDeadlineAt) : null;
  const samePolicy = Boolean(
    sameCycle &&
      Math.abs(millis(previous.naturalResetAt) - naturalResetAtMs) <= minute &&
      previous.policyKind === policy.kind &&
      Math.abs(previous.policyHazardPerHour - policy.hazardPerHour) <= 1e-9 &&
      previousDeadlineAtMs === policy.deadlineAtMs &&
      previous.policySource === policy.source &&
      text(previous.signalId) === text(policy.signalId),
  );
  if (samePolicy) return previous;

  let anchorRemainingPercent;
  if (sameCycle) {
    anchorRemainingPercent = projectTargetTrajectory(previous, nowMs);
  } else {
    anchorRemainingPercent = Math.max(
      0,
      Math.min(
        100,
        ((naturalResetAtMs - nowMs) / Math.max(1, naturalResetAtMs - cycleStartedAtMs)) * 100,
      ),
    );
  }
  if (policy.kind === "immediate") anchorRemainingPercent = 0;
  return normalizedTargetTrajectory({
    version: 1,
    anchorAt: iso(nowMs),
    anchorRemainingPercent,
    naturalResetAt: iso(naturalResetAtMs),
    cycleStartedAt: iso(cycleStartedAtMs),
    cycleResetAt: iso(cycleResetAtMs),
    policyKind: policy.kind,
    policyHazardPerHour: policy.hazardPerHour,
    policyDeadlineAt: policy.deadlineAtMs === null ? null : iso(policy.deadlineAtMs),
    policySource: policy.source,
    signalId: policy.signalId,
  });
}

function ensureState(value) {
  const state = object(value) || {};
  state.version = 15;
  state.costMeter = {
    lastRowID: Number.isFinite(state.costMeter && state.costMeter.lastRowID)
      ? state.costMeter.lastRowID
      : null,
  };
  state.capabilityToken = text(state.capabilityToken) || crypto.randomBytes(32).toString("base64url");
  state.push = object(state.push) || {};
  state.health = object(state.health) || {};
  state.cache = object(state.cache) || {};
  state.events = object(state.events) || {};
  state.events.seenIds = Array.isArray(state.events.seenIds) ? state.events.seenIds.slice(-32) : [];
  state.events.notifiedSignalIds = Array.isArray(state.events.notifiedSignalIds)
    ? state.events.notifiedSignalIds.slice(-32)
    : [];
  state.events.closedIds = Array.isArray(state.events.closedIds)
    ? state.events.closedIds.map(text).filter(Boolean).slice(-64)
    : [];
  for (const axis of ["Forced", "Banked"]) {
    const atKey = `last${axis}EventAt`;
    const idKey = `last${axis}EventId`;
    state.events[atKey] = millis(state.events[atKey]) === null ? null : iso(millis(state.events[atKey]));
    state.events[idKey] = text(state.events[idKey]) || null;
  }
  state.events.rejectedEvents = Array.isArray(state.events.rejectedEvents)
    ? state.events.rejectedEvents
        .map((entry) => {
          const source = object(entry);
          const atMs = millis(source && source.at);
          const id = text(source && source.id);
          const reason = text(source && source.reason);
          return id && reason && atMs !== null ? { id, reason, at: iso(atMs) } : null;
        })
        .filter(Boolean)
        .slice(-32)
    : [];
  state.usage = object(state.usage) || {};
  state.usage.samples = Array.isArray(state.usage.samples)
    ? state.usage.samples.slice(-480)
    : [];
  state.usage.pace = object(state.usage.pace) || usagePaceFromSamples(state.usage.samples);
  state.usage.behavior = object(state.usage.behavior) || null;
  state.usage.shortLoad = normalizedShortLoadState(state.usage.shortLoad);
  state.sessions = normalizedSessionState(state.sessions);
  state.forecastNotification = object(state.forecastNotification) || {};
  state.behaviorNotification =
    object(state.behaviorNotification) || object(state.paceNotification) || {};
  state.creditNotification = object(state.creditNotification) || {};
  state.targetTrajectory = normalizedTargetTrajectory(state.targetTrajectory);
  state.bankedCampaign = normalizedBankedCampaign(state.bankedCampaign);
  delete state.decisionPlan;
  state.personalResets = normalizedPersonalResets(state.personalResets);

  // Version 3 stored a finished personal delivery in currentEvent. Migrate it
  // into a historical fact so it cannot mask a later global episode.
  const legacyEvent = object(state.currentEvent);
  if (!object(state.activeEpisode) && legacyEvent) {
    if (legacyEvent.status === "personal-landed") {
      state.lastPersonalReset = object(state.lastPersonalReset) || {
        at: legacyEvent.personalLandedAt || legacyEvent.firstSeenAt || iso(Date.now()),
        cause: "global-manual",
        evidence: legacyEvent.personalEvidence || "unknown",
        eventId: text(legacyEvent.id) || null,
      };
      rememberClosedEvent(state, legacyEvent.id);
    } else {
      state.activeEpisode = {
        ...legacyEvent,
        status: "awaiting-personal",
        deliveryState: "pending",
      };
    }
  }
  delete state.currentEvent;
  state.activeEpisode = object(state.activeEpisode) || null;
  state.lastPersonalReset = object(state.lastPersonalReset) || null;
  if (state.lastPersonalReset) {
    const lastAtMs = millis(state.lastPersonalReset.at);
    const alreadyRecorded = state.personalResets.some(
      (entry) =>
        millis(entry.at) === lastAtMs && text(entry.eventId) === text(state.lastPersonalReset.eventId),
    );
    if (!alreadyRecorded) {
      state.personalResets = normalizedPersonalResets([
        ...state.personalResets,
        state.lastPersonalReset,
      ]);
    }
  }
  state.lastPersonalReset = state.personalResets[state.personalResets.length - 1] || null;
  const settlement = globalSettlementFromState(state);
  state.events.globalSettledThroughAt = settlement.throughAt;
  state.events.globalSettlementEventId = settlement.eventId;
  reconcileActiveEpisodeState(state, null, Date.now(), { feedSucceeded: false });
  state.accountStates = Object.fromEntries(
    Object.entries(object(state.accountStates) || {})
      .map(([id, account]) => [text(id), normalizedAccountState(account, text(id))])
      .filter(([id]) => id),
  );
  // This locally observed event was explicitly confirmed by the user as a
  // Free -> Pro 20x upgrade. Correct the earlier automatic classification once
  // so both surfaces show the known fact instead of preserving bad inference.
  const confirmedUpgradeAt = Date.parse("2026-08-21T07:49:00.000Z");
  const correctConfirmedUpgrade = (recordsValue) =>
    normalizedPersonalResets(recordsValue).map((record) =>
      Math.abs((millis(record.at) || 0) - confirmedUpgradeAt) <= 3 * minute
        ? { ...record, cause: "upgrade", evidence: "user-confirmed:free->pro20x" }
        : record,
    );
  state.personalResets = correctConfirmedUpgrade(state.personalResets);
  for (const account of Object.values(state.accountStates)) {
    account.personalResets = correctConfirmedUpgrade(account.personalResets);
    account.lastPersonalReset = account.personalResets[account.personalResets.length - 1] || null;
  }
  state.lastPersonalReset = state.personalResets[state.personalResets.length - 1] || null;
  migrateMisclassifiedBankedEvent(state);
  state.activeAccountId = text(state.activeAccountId) || null;
  state.selectedAccountId = text(state.selectedAccountId) || null;
  if (state.activeAccountId && state.accountStates[state.activeAccountId]) {
    bindActiveAccountState(state);
  }
  delete state.renewalObservation;
  return state;
}

function normalizedBankedLifecycleState(value) {
  const state = text(value).toLowerCase();
  return ["announced", "arriving", "available"].includes(state) ? state : "unknown";
}

function normalizedBankedCampaign(value) {
  const source = object(value);
  if (!source || !text(source.id) || millis(source.announcedAt) === null) return null;
  const baselineCreditIds = {};
  for (const [accountID, ids] of Object.entries(object(source.baselineCreditIds) || {})) {
    baselineCreditIds[text(accountID)] = Array.isArray(ids) ? ids.map(text).filter(Boolean) : [];
  }
  return {
    id: text(source.id),
    announcedAt: iso(millis(source.announcedAt)),
    grantAnnouncedAt: iso(millis(source.grantAnnouncedAt) ?? millis(source.announcedAt)),
    latestEventAt: iso(millis(source.latestEventAt) ?? millis(source.announcedAt)),
    officialState: normalizedBankedLifecycleState(source.officialState || source.bankedState),
    summary: text(source.summary),
    localizedSummary: text(source.localizedSummary),
    url: /^https:\/\//.test(text(source.url)) ? text(source.url) : "",
    status: ["awaiting-inventory", "partial-delivery", "observed"].includes(text(source.status))
      ? text(source.status)
      : "awaiting-inventory",
    firstSeenAt: millis(source.firstSeenAt) === null ? null : iso(millis(source.firstSeenAt)),
    baselineCreditIds,
    accountDelivery: object(source.accountDelivery) || {},
    notifiedDeliveredAccountIds: Array.isArray(source.notifiedDeliveredAccountIds)
      ? source.notifiedDeliveredAccountIds.map(text).filter(Boolean)
      : [],
  };
}

function eventReasonTags(value) {
  const event = object(value) || {};
  const raw = [
    ...(Array.isArray(event.reasonTags) ? event.reasonTags : []),
    ...(Array.isArray(event.reason_tags) ? event.reason_tags : []),
    event.resetKind,
    event.reset_kind,
  ];
  return [...new Set(raw.map((item) => text(item).toLowerCase()).filter(Boolean))];
}

function resetEventEffects(value) {
  const event = object(value) || {};
  const tags = eventReasonTags(event);
  const words = `${text(event.summary)} ${text(event.localizedSummary)} ${text(
    event.localized_summary,
  )} ${text(event.text)}`.toLowerCase();
  const banked =
    tags.some((tag) => ["banked", "banked-reset", "reset-credit", "credit"].includes(tag)) ||
    /\bbanked\b|reset credit|重置券|可选重置|自行选择/.test(words);
  const forcedTag = tags.some((tag) => ["forced", "global", "immediate", "deadline"].includes(tag));
  return {
    forcedResetEffect:
      text(event.forcedResetEffect || event.forced_reset_effect) ||
      (forcedTag ? "immediate" : banked ? "none" : "immediate"),
    bankedGrantEffect:
      text(event.bankedGrantEffect || event.banked_grant_effect) || (banked ? "announced" : "none"),
    reasonTags: tags,
  };
}

function migrateMisclassifiedBankedEvent(state) {
  const active = object(state.activeEpisode);
  if (!active) return;
  const feed = object(state.cache && state.cache.feed) || {};
  const match = (Array.isArray(feed.events) ? feed.events : []).find(
    (item) => explicitEventID(item) === explicitEventID(active),
  );
  const candidate = match || active;
  const effects = resetEventEffects(candidate);
  if (effects.bankedGrantEffect !== "announced" || effects.forcedResetEffect !== "none") return;
  const normalized = normalizeFeedEvent(candidate) || { ...active, ...effects };
  const baselineCreditIds = {};
  const accountDelivery = {};
  for (const account of Object.values(object(state.accountStates) || {})) {
    baselineCreditIds[account.id] = ((account.resetCredits && account.resetCredits.credits) || []).map(
      (credit) => credit,
    )
      .filter(
        (credit) =>
          millis(credit.grantedAt) === null ||
          millis(credit.grantedAt) < millis(normalized.announcedAt) - 5 * minute,
      )
      .map((credit) => credit.id);
    accountDelivery[account.id] = "awaiting-inventory";
    const trajectory = normalizedTargetTrajectory(account.targetTrajectory);
    if (
      trajectory &&
      trajectory.signalId === active.id &&
      trajectory.policyKind === "immediate" &&
      trajectory.policySource === "explicit-now"
    ) {
      account.targetTrajectory = null;
      account.forecastNotification = {};
      account.behaviorNotification = {};
    }
  }
  const rootTrajectory = normalizedTargetTrajectory(state.targetTrajectory);
  if (rootTrajectory && rootTrajectory.signalId === active.id && rootTrajectory.policyKind === "immediate") {
    state.targetTrajectory = null;
    state.forecastNotification = {};
    state.behaviorNotification = {};
  }
  state.bankedCampaign = normalizedBankedCampaign({
    ...normalized,
    status: "awaiting-inventory",
    firstSeenAt: active.firstSeenAt || iso(Date.now()),
    baselineCreditIds,
    accountDelivery,
  });
  state.activeEpisode = null;
  if (state.events.lastForcedEventId === active.id) {
    state.events.lastForcedEventId = null;
    state.events.lastForcedEventAt = null;
  }
  state.events.notifiedSignalIds = state.events.notifiedSignalIds.filter((id) => id !== active.id);
}

function normalizedUsageSamples(value) {
  return (Array.isArray(value) ? value : [])
    .map((sample) => {
      const source = object(sample);
      const atMs = source && source.atMs;
      const usedPercent = source && source.usedPercent;
      const resetsAtMs = source && source.resetsAtMs;
      if (![atMs, usedPercent, resetsAtMs].every(Number.isFinite)) return null;
      return {
        atMs,
        usedPercent: Math.max(0, Math.min(100, usedPercent)),
        resetsAtMs,
      };
    })
    .filter(Boolean)
    .sort((left, right) => left.atMs - right.atMs);
}

function paceWindow(samples, targetMinutes, minimumMinutes, minimumSamples) {
  if (!samples.length) return null;
  const latest = samples[samples.length - 1];
  const cutoff = latest.atMs - targetMinutes * minute;
  const windowSamples = samples.filter((sample) => sample.atMs >= cutoff);
  if (windowSamples.length < minimumSamples) return null;
  const first = windowSamples[0];
  const elapsedMinutes = (latest.atMs - first.atMs) / minute;
  if (elapsedMinutes < minimumMinutes) return null;

  const elapsedHours = elapsedMinutes / 60;
  const changePercent = Math.max(0, latest.usedPercent - first.usedPercent);
  // CodexBar's weekly percentage normally advances in one-point steps. The
  // interval prevents a flat, quantized reading from being treated as exact.
  const resolutionPercent = 1;
  return {
    ratePerHour: changePercent / elapsedHours,
    lowerRatePerHour: Math.max(0, changePercent - resolutionPercent) / elapsedHours,
    upperRatePerHour: (changePercent + resolutionPercent) / elapsedHours,
    changePercent,
    windowMinutes: elapsedMinutes,
    sampleCount: windowSamples.length,
    resolutionPercent,
    fromAtMs: first.atMs,
    toAtMs: latest.atMs,
  };
}

function usagePaceFromSamples(value) {
  const samples = normalizedUsageSamples(value);
  const spanMinutes = samples.length > 1
    ? (samples[samples.length - 1].atMs - samples[0].atMs) / minute
    : 0;
  return {
    asOf: samples.length ? iso(samples[samples.length - 1].atMs) : null,
    sampleCount: samples.length,
    warmupRemainingMinutes: Math.max(
      0,
      Math.ceil(Math.max(10 - spanMinutes, 3 - samples.length)),
    ),
    short: paceWindow(samples, 15, 10, 3),
    long: paceWindow(samples, 60, 30, 6),
  };
}

function appendUsageSample(samplesValue, currentValue) {
  const current = object(currentValue);
  let samples = normalizedUsageSamples(samplesValue);
  const sample = current
    ? {
        atMs: current.updatedAtMs,
        usedPercent: current.usedPercent,
        resetsAtMs: current.resetsAtMs,
      }
    : null;
  if (!sample || ![sample.atMs, sample.usedPercent, sample.resetsAtMs].every(Number.isFinite)) {
    return { samples, resetEpoch: false, pace: usagePaceFromSamples(samples) };
  }

  const latest = samples[samples.length - 1];
  if (latest && sample.atMs < latest.atMs) {
    return { samples, resetEpoch: false, pace: usagePaceFromSamples(samples) };
  }
  const resetEpoch = Boolean(
    latest &&
      (Math.abs(sample.resetsAtMs - latest.resetsAtMs) > minute ||
        sample.usedPercent < latest.usedPercent - 0.01),
  );
  if (resetEpoch) samples = [];
  if (samples.length && samples[samples.length - 1].atMs === sample.atMs) {
    samples[samples.length - 1] = sample;
  } else {
    samples.push(sample);
  }
  const cutoff = sample.atMs - 6 * hour;
  samples = samples
    .filter(
      (value) =>
        value.atMs >= cutoff &&
        value.atMs <= sample.atMs &&
        Math.abs(value.resetsAtMs - sample.resetsAtMs) <= minute,
    )
    .slice(-480);
  return { samples, resetEpoch, pace: usagePaceFromSamples(samples) };
}

function publicUsagePace(value) {
  const pace = object(value);
  if (!pace) return null;
  function window(value) {
    const source = object(value);
    if (!source) return null;
    const keys = [
      "ratePerHour",
      "lowerRatePerHour",
      "upperRatePerHour",
      "changePercent",
      "windowMinutes",
      "sampleCount",
      "resolutionPercent",
    ];
    const result = {};
    for (const key of keys) {
      if (Number.isFinite(source[key])) result[key] = source[key];
    }
    return result;
  }
  return {
    asOf: text(pace.asOf) || null,
    sampleCount: Number.isFinite(pace.sampleCount) ? pace.sampleCount : 0,
    warmupRemainingMinutes: Number.isFinite(pace.warmupRemainingMinutes)
      ? pace.warmupRemainingMinutes
      : 10,
    short: window(pace.short),
    long: window(pace.long),
  };
}

function publicUsageSnapshot(value) {
  const latest = object(value);
  if (!latest) return null;
  const usedPercent = latest.usedPercent;
  const windowMinutes = latest.windowMinutes;
  const resetsAtMs = latest.resetsAtMs;
  const updatedAtMs = latest.updatedAtMs;
  if (
    ![usedPercent, windowMinutes, resetsAtMs, updatedAtMs].every(Number.isFinite) ||
    usedPercent < 0 ||
    usedPercent > 100 ||
    windowMinutes <= 0
  ) {
    return null;
  }
  return {
    usedPercent,
    windowMinutes,
    resetsAt: text(latest.resetsAt) || iso(resetsAtMs),
    updatedAt: text(latest.updatedAt) || iso(updatedAtMs),
    exact: latest.exact === true,
    shortWindow: object(latest.shortWindow)
      ? {
          usedPercent: Number(latest.shortWindow.usedPercent),
          windowMinutes: Number(latest.shortWindow.windowMinutes),
          resetsAt: text(latest.shortWindow.resetsAt) || iso(latest.shortWindow.resetsAtMs),
        }
      : null,
  };
}

function publicCapacityEstimate(value) {
  const estimate = normalizedCapacityEstimate(value);
  if (!Number.isFinite(estimate.estimateUSD)) return null;
  return {
    source: estimate.source,
    estimateUSD: estimate.estimateUSD,
    lowerUSD: estimate.lowerUSD,
    upperUSD: estimate.upperUSD,
    sampleCount: estimate.sampleCount,
    confidence: estimate.confidence,
  };
}

function publicUsageBehavior(value) {
  const behavior = object(value);
  if (!behavior) return null;
  function numericRecord(value, keys) {
    const source = object(value);
    if (!source) return null;
    const result = {};
    for (const key of keys) {
      if (Number.isFinite(source[key])) result[key] = source[key];
    }
    return result;
  }
  const prediction = numericRecord(behavior.prediction, [
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
  ]);
  const context = numericRecord(behavior.context, [
    "past1",
    "past6",
    "past24",
    "cycleElapsedHours",
  ]);
  const validation = numericRecord(behavior.validation, [
    "evaluations",
    "mae",
    "medianAbsoluteError",
    "baseMae",
    "intervalWidth",
    "disagreement",
  ]);
  if (validation && object(behavior.validation)) {
    validation.selectedMode = text(behavior.validation.selectedMode) || "unknown";
  }
  const models = (Array.isArray(behavior.models) ? behavior.models : [])
    .map((modelValue) => {
      const model = object(modelValue);
      if (!model) return null;
      return {
        id: text(model.id),
        label: text(model.label),
        median: Number.isFinite(model.median) ? model.median : null,
        weight: Number.isFinite(model.weight) ? model.weight : 0,
        mae: Number.isFinite(model.mae) ? model.mae : null,
        samples: Number.isFinite(model.samples) ? model.samples : 0,
        config: text(model.config),
        distance: Number.isFinite(model.distance) ? model.distance : null,
      };
    })
    .filter(Boolean)
    .slice(0, 3);
  return {
    version: Number.isFinite(behavior.version) ? behavior.version : 1,
    asOf: text(behavior.asOf) || null,
    horizonHours: Number.isFinite(behavior.horizonHours) ? behavior.horizonHours : 0,
    sourceUpdatedAt: text(behavior.sourceUpdatedAt) || null,
    historySampleCount: Number.isFinite(behavior.historySampleCount)
      ? behavior.historySampleCount
      : 0,
    historyDays: Number.isFinite(behavior.historyDays) ? behavior.historyDays : 0,
    status: text(behavior.status) || "insufficient",
    confidence: text(behavior.confidence) || "low",
    reasons: (Array.isArray(behavior.reasons) ? behavior.reasons : [])
      .map(text)
      .filter(Boolean)
      .slice(0, 6),
    prediction,
    context,
    models,
    validation,
  };
}

function normalizedShortLoadPrediction(value) {
  const source = object(value);
  if (!source) return null;
  const lower = Number(source.additionalLower);
  const median = Number(source.additionalMedian);
  const upper = Number(source.additionalUpper);
  if (![lower, median, upper].every(Number.isFinite)) return null;
  if (lower < 0 || lower > median || median > upper) return null;
  return {
    additionalLower: Math.min(100, lower),
    additionalMedian: Math.min(100, median),
    additionalUpper: Math.min(100, upper),
  };
}

function normalizedShortLoadState(value) {
  const source = object(value) || {};
  const contextSource = object(source.context) || {};
  const trainingSource = object(source.training) || {};
  const pending = (Array.isArray(source.pending) ? source.pending : [])
    .map((itemValue) => {
      const item = object(itemValue);
      const predictedAtMs = millis(item && item.predictedAt);
      const dueAtMs = millis(item && item.dueAt);
      const sourceUsedPercent = Number(item && item.sourceUsedPercent);
      const resetsAtMs = Number(item && item.resetsAtMs);
      const prediction = normalizedShortLoadPrediction(item && item.prediction);
      if (
        predictedAtMs === null ||
        dueAtMs === null ||
        !Number.isFinite(sourceUsedPercent) ||
        !Number.isFinite(resetsAtMs) ||
        !prediction
      ) {
        return null;
      }
      return {
        model: text(item && item.model) || "session-load-v1",
        predictedAt: iso(predictedAtMs),
        dueAt: iso(dueAtMs),
        sourceUsedPercent: Math.max(0, Math.min(100, sourceUsedPercent)),
        resetsAtMs,
        prediction,
      };
    })
    .filter(Boolean)
    .slice(-48);
  const results = (Array.isArray(source.results) ? source.results : [])
    .map((itemValue) => {
      const item = object(itemValue);
      const predictedAtMs = millis(item && item.predictedAt);
      const resolvedAtMs = millis(item && item.resolvedAt);
      const actual = Number(item && item.actual);
      const predicted = Number(item && item.predicted);
      const lower = Number(item && item.lower);
      const upper = Number(item && item.upper);
      if (
        predictedAtMs === null ||
        resolvedAtMs === null ||
        ![actual, predicted, lower, upper].every(Number.isFinite)
      ) {
        return null;
      }
      return {
        model: text(item && item.model) || "session-load-v1",
        predictedAt: iso(predictedAtMs),
        resolvedAt: iso(resolvedAtMs),
        actual: Math.max(0, actual),
        predicted: Math.max(0, predicted),
        lower: Math.max(0, lower),
        upper: Math.max(0, upper),
      };
    })
    .filter(Boolean)
    .slice(-240);
  return {
    version: Number.isFinite(Number(source.version)) ? Number(source.version) : 1,
    model: text(source.model) || "session-load-v1",
    status: ["ready", "degraded", "stale", "insufficient", "unavailable"].includes(
      text(source.status),
    )
      ? text(source.status)
      : "unavailable",
    asOf: millis(source.asOf) === null ? null : iso(millis(source.asOf)),
    sourceUpdatedAt:
      millis(source.sourceUpdatedAt) === null ? null : iso(millis(source.sourceUpdatedAt)),
    horizonHours: Number.isFinite(Number(source.horizonHours))
      ? Number(source.horizonHours)
      : 1,
    prediction: normalizedShortLoadPrediction(source.prediction),
    context: {
      activeRootNow: Math.max(0, Number(contextSource.activeRootNow) || 0),
      activeAllNow: Math.max(0, Number(contextSource.activeAllNow) || 0),
      liveActiveRootNow: Math.max(
        0,
        Number.isFinite(Number(contextSource.liveActiveRootNow))
          ? Number(contextSource.liveActiveRootNow)
          : Number(contextSource.activeRootNow) || 0,
      ),
      liveActiveAllNow: Math.max(
        0,
        Number.isFinite(Number(contextSource.liveActiveAllNow))
          ? Number(contextSource.liveActiveAllNow)
          : Number(contextSource.activeAllNow) || 0,
      ),
      rootMean15: Math.max(0, Number(contextSource.rootMean15) || 0),
      allMean15: Math.max(0, Number(contextSource.allMean15) || 0),
      rootMean60: Math.max(0, Number(contextSource.rootMean60) || 0),
      allMean60: Math.max(0, Number(contextSource.allMean60) || 0),
    },
    training: {
      lookbackDays: Math.max(0, Number(trainingSource.lookbackDays) || 0),
      neighborCount: Math.max(0, Number(trainingSource.neighborCount) || 0),
      states: Math.max(0, Number(trainingSource.states) || 0),
      historySamples: Math.max(0, Number(trainingSource.historySamples) || 0),
      fromAt: millis(trainingSource.fromAt) === null ? null : iso(millis(trainingSource.fromAt)),
      throughAt:
        millis(trainingSource.throughAt) === null ? null : iso(millis(trainingSource.throughAt)),
      medianNeighborDistance: Number.isFinite(Number(trainingSource.medianNeighborDistance))
        ? Number(trainingSource.medianNeighborDistance)
        : null,
    },
    computationMs: Math.max(0, Number(source.computationMs) || 0),
    pending,
    results,
    lastErrorAt: millis(source.lastErrorAt) === null ? null : iso(millis(source.lastErrorAt)),
  };
}

function shortLoadShadowMetrics(resultsValue, modelValue) {
  const model = text(modelValue);
  const results = (Array.isArray(resultsValue) ? resultsValue : []).filter(
    (item) => !model || text(item && item.model) === model,
  );
  if (!results.length) return { evaluations: 0, mae: null, medianAbsoluteError: null, bias: null, coverage: null };
  const errors = results.map((item) => item.predicted - item.actual);
  const absolute = errors.map(Math.abs).sort((left, right) => left - right);
  const middle = Math.floor(absolute.length / 2);
  const medianAbsoluteError = absolute.length % 2
    ? absolute[middle]
    : (absolute[middle - 1] + absolute[middle]) / 2;
  return {
    evaluations: results.length,
    mae: absolute.reduce((sum, value) => sum + value, 0) / absolute.length,
    medianAbsoluteError,
    bias: errors.reduce((sum, value) => sum + value, 0) / errors.length,
    coverage:
      results.filter((item) => item.actual >= item.lower && item.actual <= item.upper).length /
      results.length,
  };
}

function publicUsageShortLoad(value) {
  const shortLoad = normalizedShortLoadState(value);
  return {
    version: shortLoad.version,
    model: shortLoad.model,
    status: shortLoad.status,
    asOf: shortLoad.asOf,
    sourceUpdatedAt: shortLoad.sourceUpdatedAt,
    horizonHours: shortLoad.horizonHours,
    prediction: shortLoad.prediction,
    context: shortLoad.context,
    training: shortLoad.training,
    computationMs: shortLoad.computationMs,
    shadow: shortLoadShadowMetrics(shortLoad.results, shortLoad.model),
  };
}

function settleShortLoadPredictions(value, currentValue, nowMs = Date.now()) {
  const shortLoad = normalizedShortLoadState(value);
  const current = object(currentValue);
  if (
    !current ||
    ![current.usedPercent, current.resetsAtMs, current.updatedAtMs].every(Number.isFinite)
  ) {
    return shortLoad;
  }
  const pending = [];
  const results = shortLoad.results.slice();
  for (const item of shortLoad.pending) {
    const dueAtMs = millis(item.dueAt);
    if (dueAtMs === null) continue;
    if (current.updatedAtMs < dueAtMs) {
      if (nowMs <= dueAtMs + 6 * hour) pending.push(item);
      continue;
    }
    const crossedReset =
      Math.abs(current.resetsAtMs - item.resetsAtMs) > minute ||
      current.usedPercent < item.sourceUsedPercent - 0.01;
    if (crossedReset) continue;
    const actual = Math.max(0, current.usedPercent - item.sourceUsedPercent);
    results.push({
      model: item.model,
      predictedAt: item.predictedAt,
      resolvedAt: iso(current.updatedAtMs),
      actual,
      predicted: item.prediction.additionalMedian,
      lower: item.prediction.additionalLower,
      upper: item.prediction.additionalUpper,
    });
  }
  return normalizedShortLoadState({ ...shortLoad, pending, results: results.slice(-240) });
}

function seedShortLoadPrediction(value, currentValue, nowMs = Date.now()) {
  const shortLoad = normalizedShortLoadState(value);
  const current = object(currentValue);
  if (
    !["ready", "degraded"].includes(shortLoad.status) ||
    !shortLoad.prediction ||
    !current ||
    current.exact !== true ||
    ![current.usedPercent, current.resetsAtMs, current.updatedAtMs].every(Number.isFinite) ||
    Math.abs(nowMs - current.updatedAtMs) > 10 * minute
  ) {
    return shortLoad;
  }
  const latestAtMs = Math.max(
    ...[
      ...shortLoad.pending.map((item) => millis(item.predictedAt)),
      ...shortLoad.results.map((item) => millis(item.predictedAt)),
    ].filter(Number.isFinite),
    -Infinity,
  );
  if (Number.isFinite(latestAtMs) && nowMs - latestAtMs < 55 * minute) return shortLoad;
  return normalizedShortLoadState({
    ...shortLoad,
    pending: [
      ...shortLoad.pending,
      {
        model: shortLoad.model,
        predictedAt: iso(nowMs),
        dueAt: iso(nowMs + hour),
        sourceUsedPercent: current.usedPercent,
        resetsAtMs: current.resetsAtMs,
        prediction: shortLoad.prediction,
      },
    ].slice(-48),
  });
}

function writeState(value) {
  fs.mkdirSync(path.dirname(stateFile), { recursive: true, mode: 0o700 });
  const temporary = `${stateFile}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, stateFile);
}

function safePublicState(state, runtime) {
  syncActiveAccountState(state);
  const activeEpisode = object(state.activeEpisode);
  const settlement = globalSettlementFromState(state);
  const targetTrajectory = normalizedTargetTrajectory(state.targetTrajectory);
  const bankedCampaign = normalizedBankedCampaign(state.bankedCampaign);
  const publicEpisode = activeEpisode
    ? {
        id: activeEpisode.id,
        type: "reset",
        group: "reset",
        announcement_state: "announced",
        reset_verification_status: "pending",
        announced_at: activeEpisode.announcedAt,
        official_window:
          activeEpisode.windowStartAt || activeEpisode.deadlineAt
            ? {
                label: activeEpisode.windowLabel || "",
                start_at: activeEpisode.windowStartAt || null,
                end_at: activeEpisode.deadlineAt || null,
              }
            : null,
        summary: activeEpisode.summary,
        localized_summary: activeEpisode.localizedSummary || activeEpisode.summary,
        url: activeEpisode.url,
        status: "awaiting-personal",
        delivery_state: "pending",
        account_delivery: object(activeEpisode.accountDelivery) || {},
        source: activeEpisode.source,
        firstSeenAt: activeEpisode.firstSeenAt,
      }
    : null;
  const lastPersonalReset = object(state.lastPersonalReset);
  const accountEntries = Object.values(object(state.accountStates) || {}).filter(
    (account) => account.present !== false,
  );
  const accounts = accountEntries.map((account) => ({
    id: account.id,
    label: compactAccountLabel(account.label),
    active: account.id === state.activeAccountId,
    live: account.id === state.activeAccountId,
    selected: account.id === state.selectedAccountId,
    planType: account.planType || null,
    subscriptionRenewsAt: account.subscriptionRenewsAt || null,
    subscriptionExpiresAt: account.subscriptionExpiresAt || null,
    cooldown: account.lapsedPaidPlanRank > 0
      ? {
          lapsedPaidPlanRank: account.lapsedPaidPlanRank,
          resetsAt: account.lapsedCycleResetsAt,
          active:
            millis(account.lapsedCycleResetsAt) !== null &&
            Date.now() < millis(account.lapsedCycleResetsAt),
        }
      : null,
    capacityEstimate: publicCapacityEstimate(account.capacityEstimate),
    targetTrajectory: normalizedTargetTrajectory(account.targetTrajectory),
    usageSnapshot: publicUsageSnapshot(account.usage && account.usage.latest),
    usagePace: publicUsagePace(account.usage && account.usage.pace),
    usageBehavior: publicUsageBehavior(account.usage && account.usage.behavior),
    resetCredits: normalizedResetCreditInventory(account.resetCredits),
    personalResets: normalizedPersonalResets(account.personalResets).slice(-6),
    lastPersonalReset: object(account.lastPersonalReset) || null,
    deliveryState:
      (activeEpisode && object(activeEpisode.accountDelivery) && activeEpisode.accountDelivery[account.id]) ||
      "pending",
  }));
  return {
    version: state.version,
    startedAt: runtime.startedAt,
    push: {
      registered: state.push.registered === true,
      registeredAt: state.push.registeredAt || null,
      lastPushAt: state.push.lastPushAt || null,
      verifiedAt: state.push.verifiedAt || null,
    },
    health: {
      lastForecastSuccessAt: state.health.lastForecastSuccessAt || null,
      lastFeedSuccessAt: state.health.lastFeedSuccessAt || null,
      lastAtomSuccessAt: state.health.lastAtomSuccessAt || null,
      lastUsageSuccessAt: state.health.lastUsageSuccessAt || null,
      lastSessionsSuccessAt: state.health.lastSessionsSuccessAt || null,
      lastShortLoadSuccessAt: state.health.lastShortLoadSuccessAt || null,
      lastErrorAt: state.health.lastErrorAt || null,
      lastErrorKind: state.health.lastErrorKind || null,
    },
    activeEpisode: publicEpisode,
    bankedCampaign,
    // Compatibility alias for an older installed provider during an atomic app
    // restart. It represents only the active episode, never a finished one.
    currentEvent: publicEpisode,
    lastPersonalReset: lastPersonalReset
      ? {
          at: lastPersonalReset.at || null,
          cause: lastPersonalReset.cause || "unclassified",
          evidence: lastPersonalReset.evidence || "unknown",
          eventId: lastPersonalReset.eventId || null,
        }
      : null,
    personalResets: normalizedPersonalResets(state.personalResets).slice(-6),
    signalSettlement: settlement.throughAt
      ? {
          throughAt: settlement.throughAt,
          cause: "personal-global-reset",
          eventId: settlement.eventId,
        }
      : null,
    targetTrajectory,
    closedEventIds: state.events.closedIds.slice(),
    activeAccountId: state.activeAccountId,
    selectedAccountId: state.selectedAccountId,
    accounts,
    cache: {
      forecast: object(state.cache.forecast),
      feed: object(state.cache.feed),
    },
    // A single sanitized last-good quota point lets the local card survive a
    // transient loopback timeout. Raw samples and account identity stay private.
    usageSnapshot: publicUsageSnapshot(state.usage.latest),
    usagePace: publicUsagePace(state.usage.pace),
    usageBehavior: publicUsageBehavior(state.usage.behavior),
    usageShortLoad: publicUsageShortLoad(state.usage.shortLoad),
    // Session titles and project basenames never leave loopback. IDs, full
    // paths, message previews and transcripts are deliberately omitted.
    sessionSuggestions: publicSessionSuggestions(state.sessions),
    schedule: runtime.schedule,
  };
}

async function fetchResponse(url, options, timeoutMs) {
  const response = await fetch(url, {
    ...(options || {}),
    signal: AbortSignal.timeout(timeoutMs),
    cache: "no-store",
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response;
}

async function getJSON(url, timeoutMs) {
  const response = await fetchResponse(
    url,
    { headers: { accept: "application/json", "cache-control": "no-cache" } },
    timeoutMs,
  );
  return response.json();
}

async function getText(url, timeoutMs, headers) {
  const response = await fetchResponse(
    url,
    { headers: { accept: "text/html,application/atom+xml", ...(headers || {}) } },
    timeoutMs,
  );
  return response.text();
}

async function postJSON(url, body, timeoutMs) {
  const response = await fetchResponse(
    url,
    {
      method: "POST",
      headers: { accept: "application/json", "content-type": "application/json" },
      body: JSON.stringify(body),
    },
    timeoutMs,
  );
  return response.json();
}

function execFileJSON(executable, args, timeoutMs) {
  return new Promise((resolve, reject) => {
    childProcess.execFile(
      executable,
      args,
      { timeout: timeoutMs, maxBuffer: 16 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        if (error) {
          reject(error);
          return;
        }
        try {
          resolve(JSON.parse(stdout));
        } catch (parseError) {
          reject(parseError);
        }
      },
    );
  });
}

async function fetchCodexUsage() {
  const localCandidates = [
    standaloneCodexBarCLI,
    path.join(__dirname, "CodexBarCLI"),
    path.join(__dirname, "codexbar"),
  ].filter(Boolean);
  for (const executable of localCandidates) {
    if (!fs.existsSync(executable)) continue;
    try {
      return await execFileJSON(
        executable,
        ["usage", "--provider", "codex", "--all-accounts", "--format", "json"],
        25_000,
      );
    } catch {
      // Prefer the bundled collector. The retained CodexBar integration stays
      // available as a compatibility fallback.
    }
  }
  return getJSON(`${upstreamBridge}/usage?provider=codex`, 8_000);
}

function appleScriptString(value) {
  return `"${String(value)
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, " ")}"`;
}

function sendNativeNotification(subtitle, body) {
  if (dryRun) return;
  const script = `display notification ${appleScriptString(body)} with title ${appleScriptString(
    "Codex Capacity Planner",
  )} subtitle ${appleScriptString(subtitle)}`;
  childProcess.execFileSync("/usr/bin/osascript", ["-e", script], {
    stdio: "ignore",
    timeout: 10_000,
  });
}

function inferDeadline(textValue, announcedAtMs) {
  const value = String(textValue || "").toLowerCase();
  let minutes = null;
  const numericMinutes = value.match(/(?:next|within|over)\s+(\d{1,3})\s+minutes?/);
  const numericHours = value.match(/(?:next|within|over)\s+(\d{1,2})\s+hours?/);
  if (numericMinutes) minutes = Number(numericMinutes[1]);
  else if (numericHours) minutes = Number(numericHours[1]) * 60;
  else if (/next hour|within (?:the )?hour|hour or so/.test(value)) minutes = 60;
  return minutes === null ? null : announcedAtMs + minutes * minute;
}

function eventID(value) {
  const raw = text(value);
  if (!raw) return "";
  const statusID = xStatusID(raw);
  if (statusID) return statusID;
  return raw.replace(/[?#].*$/, "").replace(/\/+$/, "").replace(/^.*(?:\/|:)/, "");
}

function xStatusID(value) {
  try {
    const url = new URL(text(value));
    const host = url.hostname.toLowerCase();
    if (
      url.protocol !== "https:" ||
      !["x.com", "www.x.com", "twitter.com", "www.twitter.com", "mobile.twitter.com"].includes(host)
    ) {
      return "";
    }
    const match = url.pathname.match(/\/status\/(\d{15,22})(?:\/|$)/);
    return match ? match[1] : "";
  } catch {
    return "";
  }
}

function explicitEventID(value) {
  const event = object(value) || {};
  for (const candidate of [event.tweet_id, event.id, event.url]) {
    const id = eventID(candidate);
    if (/^\d{15,22}$/.test(id)) return id;
  }
  return "";
}

function trustedExplicitEvent(value) {
  const event = object(value);
  if (!event) return false;
  const id = explicitEventID(event);
  const declaredID = eventID(event.tweet_id || event.id);
  const urlID = xStatusID(event.url);
  const source = text(event.source);
  return Boolean(
    /^\d{15,22}$/.test(id) &&
      declaredID === id &&
      urlID === id &&
      ["site-api", "atom", "push-x-one-shot"].includes(source) &&
      eventAnnouncedAtMs(event) !== null,
  );
}

function feedEventID(value) {
  return explicitEventID(value);
}

function matchingFeedEvent(feedValue, idValue) {
  const feed = object(feedValue) || {};
  const id = eventID(idValue);
  if (!id) return null;
  const events = Array.isArray(feed.events) ? feed.events : [];
  return events.find((entry) => feedEventID(entry) === id) || null;
}

function eventExpiresAtMs(eventValue) {
  const eventAtMs = eventAnnouncedAtMs(eventValue);
  if (eventAtMs === null) return null;
  const event = object(eventValue) || {};
  const deadlineAtMs = millis(event.deadlineAt || event.deadline_at);
  return deadlineAtMs === null
    ? eventAtMs + 12 * hour
    : Math.max(eventAtMs + 12 * hour, deadlineAtMs + 6 * hour);
}

function reconcileActiveEpisodeState(stateValue, feedValue, nowMs = Date.now(), optionsValue) {
  const state = object(stateValue);
  const active = object(state && state.activeEpisode);
  if (!state || !active) return { cleared: false, reason: null, event: null };
  const options = object(optionsValue) || {};
  const id = explicitEventID(active);
  const eventAtMs = eventAnnouncedAtMs(active);

  if (!trustedExplicitEvent(active)) {
    return clearActiveEpisode(state, "untrusted-event-identity", nowMs, false);
  }
  if (eventAtMs === null || eventAtMs > nowMs + 2 * minute) {
    return clearActiveEpisode(state, "invalid-event-time", nowMs, false);
  }
  if (eventSettledByState(state, active)) {
    return clearActiveEpisode(state, "already-personally-settled", nowMs, true);
  }
  const expiresAtMs = eventExpiresAtMs(active);
  if (expiresAtMs !== null && nowMs > expiresAtMs) {
    return clearActiveEpisode(state, "announcement-expired", nowMs, true);
  }

  if (options.feedSucceeded) {
    const matching = matchingFeedEvent(feedValue, id);
    if (matching && negativeVerification(matching.reset_verification_status)) {
      return clearActiveEpisode(
        state,
        `website-${text(matching.reset_verification_status).toLowerCase()}`,
        nowMs,
        true,
      );
    }
    if (!matching && active.source === "site-api") {
      const firstSeenAtMs = millis(active.firstSeenAt) || eventAtMs;
      if (firstSeenAtMs !== null && nowMs - firstSeenAtMs >= 15 * minute) {
        return clearActiveEpisode(state, "missing-from-fresh-feed", nowMs, true);
      }
    }
  }
  return { cleared: false, reason: null, event: active };
}

function normalizeFeedEvent(value) {
  const event = object(value);
  if (!event) return null;
  const announcedAt = text(event.announced_at || event.at || event.updated_at);
  const announcedAtMs = millis(announcedAt);
  if (announcedAtMs === null) return null;
  const window = object(event.official_window) || object(event.window) || {};
  const summary = text(event.localized_summary) || text(event.summary) || text(event.text);
  const id = explicitEventID(event);
  const normalized = {
    id,
    announcedAt: iso(announcedAtMs),
    windowStartAt: text(window.start_at) || text(event.effective_at) || null,
    deadlineAt:
      text(window.end_at) ||
      text(event.deadline_at) ||
      (inferDeadline(summary, announcedAtMs) ? iso(inferDeadline(summary, announcedAtMs)) : null),
    windowLabel: text(window.localized_label) || text(window.label),
    summary: text(event.summary) || summary,
    localizedSummary: text(event.localized_summary) || "",
    url: /^https:\/\//.test(text(event.url)) ? text(event.url) : "",
    source: "site-api",
    bankedState: normalizedBankedLifecycleState(event.banked_state || event.bankedState),
    ...resetEventEffects(event),
  };
  return trustedExplicitEvent(normalized) ? normalized : null;
}

function latestExplicitFeedEvent(feed) {
  const source = object(feed) || {};
  const events = Array.isArray(source.events) ? source.events : [];
  const candidates = [];
  for (const event of events) {
    const item = object(event) || {};
    const effects = resetEventEffects(item);
    const isBankedLifecycle =
      effects.bankedGrantEffect === "announced" &&
      ["announced", "arriving", "available"].includes(
        normalizedBankedLifecycleState(item.banked_state || item.bankedState),
      );
    if (
      (text(item.announcement_state).toLowerCase() === "announced" || isBankedLifecycle) &&
      !terminalVerification(item.reset_verification_status) &&
      (text(item.type).toLowerCase() === "reset" ||
        text(item.group).toLowerCase() === "reset" ||
        isBankedLifecycle)
    ) {
      const normalized = normalizeFeedEvent(item);
      if (normalized) candidates.push(normalized);
    }
  }
  candidates.sort((left, right) => eventAnnouncedAtMs(right) - eventAnnouncedAtMs(left));
  const latest = candidates[0] || null;
  if (!latest || latest.bankedGrantEffect !== "announced") return latest;
  const latestAtMs = eventAnnouncedAtMs(latest);
  const lifecycle = candidates.filter((candidate) => {
    const atMs = eventAnnouncedAtMs(candidate);
    return (
      candidate.bankedGrantEffect === "announced" &&
      atMs !== null &&
      latestAtMs - atMs >= 0 &&
      latestAtMs - atMs <= 48 * 60 * minute
    );
  });
  const grantAnnouncedAtMs = Math.min(...lifecycle.map(eventAnnouncedAtMs).filter(Number.isFinite));
  return {
    ...latest,
    bankedGrantAnnouncedAt: Number.isFinite(grantAnnouncedAtMs)
      ? iso(grantAnnouncedAtMs)
      : latest.announcedAt,
  };
}

function parseAtomEntries(xml) {
  const entries = [];
  for (const match of String(xml || "").matchAll(/<entry>([\s\S]*?)<\/entry>/g)) {
    const body = match[1];
    function element(name) {
      const found = body.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`));
      return found ? stripTags(found[1]) : "";
    }
    const link = body.match(/<link\s+[^>]*href="([^"]+)"[^>]*>/);
    const announcedAtMs = millis(element("updated"));
    if (announcedAtMs === null) continue;
    const summary = element("summary");
    const entry = {
      id: eventID(element("id")),
      announcedAt: iso(announcedAtMs),
      windowStartAt: null,
      deadlineAt: inferDeadline(summary, announcedAtMs)
        ? iso(inferDeadline(summary, announcedAtMs))
        : null,
      windowLabel: "",
      summary,
      localizedSummary: "",
      url: link && /^https:\/\//.test(decodeEntities(link[1])) ? decodeEntities(link[1]) : "",
      source: "atom",
    };
    if (trustedExplicitEvent(entry)) entries.push(entry);
  }
  entries.sort((left, right) => eventAnnouncedAtMs(right) - eventAnnouncedAtMs(left));
  return entries;
}

function metaValue(article, property) {
  const pattern = new RegExp(`<meta\\s+content="([^"]*)"\\s+itemProp="${property}"\\s*\\/>`);
  const reversed = new RegExp(`<meta\\s+itemProp="${property}"\\s+content="([^"]*)"\\s*\\/>`);
  const match = String(article).match(pattern) || String(article).match(reversed);
  return match ? decodeEntities(match[1]) : "";
}

function parseXProfile(html) {
  const posts = [];
  for (const match of String(html || "").matchAll(/<article\b[\s\S]*?<\/article>/g)) {
    const article = match[0];
    const id = metaValue(article, "identifier");
    const announcedAtMs = millis(metaValue(article, "datePublished"));
    const summary = metaValue(article, "articleBody") || metaValue(article, "text");
    if (!id || announcedAtMs === null || !summary) continue;
    const post = {
      id,
      announcedAt: iso(announcedAtMs),
      windowStartAt: null,
      deadlineAt: inferDeadline(summary, announcedAtMs)
        ? iso(inferDeadline(summary, announcedAtMs))
        : null,
      windowLabel: "",
      summary,
      localizedSummary: "",
      url: `https://x.com/thsottiaux/status/${id}`,
      source: "push-x-one-shot",
    };
    if (trustedExplicitEvent(post)) posts.push(post);
  }
  posts.sort((left, right) => millis(right.announcedAt) - millis(left.announcedAt));
  return posts;
}

function enrichEvent(primary, feedEvent) {
  if (!primary) return feedEvent;
  if (!feedEvent || primary.id !== feedEvent.id) return primary;
  return {
    ...primary,
    windowStartAt: feedEvent.windowStartAt || primary.windowStartAt,
    deadlineAt: feedEvent.deadlineAt || primary.deadlineAt,
    windowLabel: feedEvent.windowLabel || primary.windowLabel,
    summary: feedEvent.summary.length > primary.summary.length ? feedEvent.summary : primary.summary,
    localizedSummary: feedEvent.localizedSummary || primary.localizedSummary,
    url: feedEvent.url || primary.url,
  };
}

function notificationCopy(model, reason) {
  const decision = model && model.decision;
  const forecast = model && model.forecast;
  const behavior = model && model.behavior;
  const prediction = behavior && behavior.prediction;
  const sessionSuggestions = object(model && model.sessionSuggestions);
  const sessionCount = Math.max(
    0,
    Number(sessionSuggestions && sessionSuggestions.candidateCount) || 0,
  );
  const resumeSuggestion = sessionCount
    ? `可考虑续跑 ${sessionCount} 个近期 session 或新增任务；仍不足时开启 Fast。`
    : "可新增有价值任务；仍不足时开启 Fast。";
  if (reason === "banked-announced") {
    return {
      subtitle: "Tibo 宣布了一次可选重置券",
      body: "这不是强制刷新；先等待券进入各账号库存，系统会结合到期时间和未来工作量寻找兑换节点。",
    };
  }
  if (reason === "banked-arrived") {
    return {
      subtitle: "可选重置券已进入账号",
      body: "库存已由本机确认；系统会滚动比较现在兑换与继续等待的价值。",
    };
  }
  if (reason === "banked-redeem") {
    const plan = model && model.bankedPlan;
    return {
      subtitle: "现在进入较优兑换窗口",
      body: plan && Number.isFinite(plan.quotaEdge)
        ? `当前净额度边际约 ${plan.quotaEdge.toFixed(1)} 个百分点；请在 Codex 中手动确认兑换。`
        : "现在兑换的预期价值已超过继续等待；请在 Codex 中手动确认。",
    };
  }
  if (reason === "banked-window") {
    return {
      subtitle: "重置券的较优窗口提前了",
      body: "新的额度或负载证据让较优兑换节点进入未来 24 小时；系统仍只建议，不会自动兑换。",
    };
  }
  if (reason === "banked-redeemed") {
    return {
      subtitle: "已确认一次 banked reset 兑换",
      body: "券消耗与额度刷新证据一致；新周周期和后续兑换窗口已重新建立。",
    };
  }
  if (reason === "banked-disappeared") {
    return {
      subtitle: "重置券库存出现异常变化",
      body: "一张未到期券消失，但没有同时观察到额度刷新；已标为原因未知，不会冒充已兑换。",
    };
  }
  if (reason === "behavior-behind" && decision && prediction) {
    return {
      subtitle: "明显偏慢：可以增加有效任务",
      body: `到 ${utc8(decision.deadlineMs)} 的目标为已用 ${decision.targetUsed.toFixed(
        1,
      )}%；自然使用主要范围预计已用 ${prediction.endpointLower.toFixed(
        1,
      )}%–${prediction.endpointUpper.toFixed(1)}%。${resumeSuggestion}`,
    };
  }
  if (reason === "behavior-recovered" && decision && prediction) {
    if (decision.targetReached) {
      return {
        subtitle: "已提前达到本次对照目标",
        body: `当前已用 ${model.usage.usedPercent.toFixed(1)}%，已达到目标 ${decision.targetUsed.toFixed(
          1,
        )}%；连续目标不会被实际用量推高，若正在使用 Fast 请切回 Standard。`,
      };
    }
    const zone = behaviorZone(decision, prediction);
    if (zone === "covered") {
      return {
        subtitle: "明显偏快：请切回 Standard",
        body: `到 ${utc8(decision.deadlineMs)}，自然使用主要范围预计已用 ${prediction.endpointLower.toFixed(
          1,
        )}%–${prediction.endpointUpper.toFixed(1)}%，已整体高于目标 ${decision.targetUsed.toFixed(
          1,
        )}%；若已经是 Standard，保持即可。`,
      };
    }
    return {
      subtitle: "已回到基本合适范围",
      body: `到 ${utc8(decision.deadlineMs)}，自然使用主要范围预计已用 ${prediction.endpointLower.toFixed(
        1,
      )}%–${prediction.endpointUpper.toFixed(1)}%，红线目标 ${decision.targetUsed.toFixed(
        1,
      )}% 位于蓝色范围内；保持当前节奏。`,
    };
  }
  if (reason === "personal-landed") {
    return {
      subtitle: "你的额度已经刷新",
      body: "本机已观察到周额度窗口跳变；CodexBar 当前额度已作为最新事实源。",
    };
  }
  if (reason === "commitment" && forecast) {
    const behaviorSuffix =
      prediction && prediction.extraMedian > 0.05
        ? ` 结合本机历史，预计还需额外安排 ${prediction.extraMedian.toFixed(
            1,
          )}%。${resumeSuggestion}`
        : "";
    return {
      subtitle: "Tibo 给出重置承诺",
      body: decision
        ? `到 ${utc8(decision.deadlineMs)}，按 ${whole(decision.probability)}% 概率计算，建议再用约 ${whole(
            decision.additionalTotal,
          )}% 周额度。${behaviorSuffix}`
        : "Tibo 给出了有期限的重置承诺；打开 CodexBar 查看最新计划。",
    };
  }
  if (reason === "forecast" && decision && forecast) {
    const behaviorSuffix =
      prediction && prediction.extraMedian > 0.05
        ? ` 结合本机历史，预计还需额外安排 ${prediction.extraMedian.toFixed(
            1,
          )}%。${resumeSuggestion}`
        : "";
    return {
      subtitle: "预测加速额度上调",
      body: `到 ${utc8(decision.deadlineMs)}，建议再用约 ${whole(
        decision.additionalTotal,
      )}%（其中预测加速 ${whole(decision.predictionUse)}%）；24h 概率 ${whole(
        forecast.p24,
      )}%。${behaviorSuffix}`,
    };
  }
  if (decision) {
    return {
      subtitle: "全局已明确重置",
      body: decision.immediate
        ? `你的额度尚未观察到到账；现在可优先使用剩余约 ${whole(
            decision.additionalTotal,
          )}% 周额度。${resumeSuggestion}`
        : `你的额度尚未观察到到账；到 ${utc8(decision.deadlineMs)} 前可优先使用剩余约 ${whole(
            decision.additionalTotal,
          )}% 周额度。${resumeSuggestion}`,
    };
  }
  return {
    subtitle: "全局已明确重置",
    body: "Tibo 已宣布 Codex 重置；你的个人额度仍由本机继续观察。",
  };
}

function browserNotification(model, event) {
  const campaign = object(model && model.receiver && model.receiver.bankedCampaign);
  const copy = campaign && (!event || campaign.id === event.id)
    ? notificationCopy(model, "banked-announced")
    : notificationCopy(model, "global");
  return {
    title: "Codex Capacity Planner",
    options: {
      body: copy.body,
      tag: `codex-reset-${event ? event.id : "confirmed"}`,
      renotify: false,
      data: { url: "/" },
    },
  };
}

function notificationPlan(model, previous, nowMs) {
  const state = { ...(object(previous) || {}) };
  if (!model || !model.decision || !model.forecast) return { reason: null, state };
  const revision = text(model.forecast.updatedAt) || String(nowMs);
  const displayedExtra = whole(model.decision.predictionUse);
  let reason = null;
  if (
    state.seeded &&
    revision !== state.revision &&
    displayedExtra > Number(state.displayedExtra || 0) &&
    model.decision.targetReached !== true &&
    !["explicit", "commitment"].includes(model.forecast.signal.level)
  ) {
    reason = "forecast";
  }
  state.seeded = true;
  state.revision = revision;
  state.displayedExtra = displayedExtra;
  state.lastEvaluatedAt = nowMs;
  return { reason, state };
}

function behaviorPlanKey(model) {
  const decision = model && model.decision;
  const usage = model && model.usage;
  if (!decision || !usage) return "";
  const signal = object(model.forecast && model.forecast.signal);
  const signalKey = signal && text(signal.id) ? `signal:${text(signal.id)}` : "continuous";
  return `${Math.round(usage.resetsAtMs / minute)}|${signalKey}`;
}

function behaviorZone(decisionValue, predictionValue) {
  const decision = object(decisionValue);
  const prediction = object(predictionValue);
  if (
    !decision ||
    !prediction ||
    !Number.isFinite(decision.targetUsed) ||
    !Number.isFinite(prediction.endpointLower) ||
    !Number.isFinite(prediction.endpointUpper)
  ) {
    return "unknown";
  }
  // Half of the displayed 0.1 percentage-point precision prevents a visually
  // touching marker from being described as outside the interval.
  const displayTolerance = 0.05;
  if (decision.targetUsed > prediction.endpointUpper + displayTolerance) return "behind";
  if (decision.targetUsed < prediction.endpointLower - displayTolerance) return "covered";
  return "uncertain";
}

function behaviorNotificationPlan(model, previous, nowMs) {
  let state = { ...(object(previous) || {}) };
  const key = behaviorPlanKey(model);
  if (!key) return { reason: null, state };

  const decision = model && model.decision;
  const behavior = model && model.behavior;
  const prediction = behavior && behavior.prediction;
  const usable =
    decision && prediction && ["ready", "degraded"].includes(behavior.status);
  const zone = usable ? behaviorZone(decision, prediction) : "unknown";

  if (state.planKey !== key) {
    state = {
      planKey: key,
      seeded: true,
      zone,
      lastEvaluatedAt: nowMs,
    };
    return { reason: null, state };
  }

  if (!usable) {
    state.seeded = true;
    state.zone = "unknown";
    state.lastEvaluatedAt = nowMs;
    return { reason: null, state };
  }

  const previousZone = text(state.zone) || "unknown";
  let reason = null;
  if (previousZone !== "behind" && zone === "behind") {
    reason = "behavior-behind";
  } else if (previousZone === "behind" && zone !== "behind") {
    reason = "behavior-recovered";
  }
  state.seeded = true;
  state.zone = zone;
  state.lastEvaluatedAt = nowMs;
  state.lastTargetUsed = decision.targetUsed;
  state.lastEndpointLower = prediction.endpointLower;
  state.lastEndpointMedian = prediction.endpointMedian;
  state.lastEndpointUpper = prediction.endpointUpper;
  state.lastReachProbability = prediction.reachProbability;
  return { reason, state };
}

// Compatibility alias for older local callers. Alerts now come from the
// calibrated behavior forecast, never from a short speed window.
const paceNotificationPlan = behaviorNotificationPlan;

function usageResetEvidence(previousValue, currentValue) {
  const previous = object(previousValue);
  const current = object(currentValue);
  if (!previous || !current) return null;
  if (
    !Number.isFinite(current.updatedAtMs) ||
    !Number.isFinite(previous.updatedAtMs) ||
    current.updatedAtMs <= previous.updatedAtMs
  ) {
    return null;
  }
  if (current.usedPercent < previous.usedPercent - 0.01) return "usage-decreased";
  // A real weekly reset moves the boundary by days. Small changes are normal
  // server-side timestamp refinement and must not create reset history.
  if (current.resetsAtMs > previous.resetsAtMs + 6 * hour) return "reset-time-advanced";
  return null;
}

function personalLandingEvidence(previousValue, currentValue, eventValue) {
  const current = object(currentValue);
  const event = object(eventValue);
  if (
    !current ||
    !event ||
    !["global-announced", "awaiting-personal"].includes(event.status)
  ) {
    return null;
  }
  const eventAtMs = millis(event.announcedAt);
  if (eventAtMs === null || current.updatedAtMs < eventAtMs) return null;
  return usageResetEvidence(previousValue, currentValue);
}

function resetCause(
  previousValue,
  currentValue,
  eventValue,
  consumedCreditValue,
  classificationValue,
) {
  const current = object(currentValue);
  const previous = object(previousValue);
  const evidence = usageResetEvidence(previous, current);
  if (!evidence) return null;
  const consumedCredit = object(consumedCreditValue);
  if (consumedCredit) {
    return { cause: "banked-redeem", evidence: `credit-consumed:${consumedCredit.id}` };
  }
  if (
    Number.isFinite(previous.resetsAtMs) &&
    previous.updatedAtMs < previous.resetsAtMs + 10 * minute &&
    current.updatedAtMs >= previous.resetsAtMs - 10 * minute
  ) {
    return { cause: "automatic", evidence };
  }
  const classification = object(classificationValue) || {};
  if (classification.paidUpgrade === true) {
    return { cause: "upgrade", evidence: `paid-plan-upgrade:${text(classification.planTransition)}` };
  }
  const eventEvidence = personalLandingEvidence(previous, current, eventValue);
  if (eventEvidence) return { cause: "global-manual", evidence: eventEvidence };
  // With coupon use, a paid-tier upgrade and the scheduled boundary already
  // excluded, a full-window reset is an unexpected platform/manual reset.
  return { cause: "global-manual", evidence: `forced-window-rebuilt:${evidence}` };
}

function timingSafeToken(actual, expected) {
  const left = Buffer.from(text(actual));
  const right = Buffer.from(text(expected));
  return left.length === right.length && left.length > 0 && crypto.timingSafeEqual(left, right);
}

function readBody(request, limit) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > limit) {
        reject(new Error("body_too_large"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(new Error("invalid_json"));
      }
    });
    request.on("error", reject);
  });
}

function originAllowed(request) {
  const origin = text(request.headers.origin);
  return origin === `http://127.0.0.1:${listenPort}` || origin === `http://localhost:${listenPort}`;
}

function hostAllowed(request) {
  const host = text(request.headers.host).toLowerCase();
  return host === `127.0.0.1:${listenPort}` || host === `localhost:${listenPort}`;
}

function jsonResponse(response, status, value) {
  const body = Buffer.from(JSON.stringify(value));
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
}

function textResponse(response, status, value, contentType) {
  const body = Buffer.from(value);
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": body.length,
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
    "content-security-policy":
      "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
  });
  response.end(body);
}

function assetResponse(response, filename, contentType) {
  try {
    const value = fs.readFileSync(path.join(assetDirectory, filename));
    textResponse(response, 200, value, contentType);
  } catch {
    textResponse(response, 404, "Not found", "text/plain; charset=utf-8");
  }
}

function proxyUsage(request, response) {
  const requestURL = new URL(request.url, `http://${listenHost}:${listenPort}`);
  const target = new URL("/usage", upstreamBridge);
  target.search = requestURL.search;
  const upstream = http.get(
    target,
    { headers: { accept: "application/json" }, timeout: 8_000 },
    (upstreamResponse) => {
      response.writeHead(upstreamResponse.statusCode || 502, {
        "content-type": upstreamResponse.headers["content-type"] || "application/json",
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
      });
      upstreamResponse.pipe(response);
    },
  );
  upstream.on("timeout", () => upstream.destroy(new Error("upstream_timeout")));
  upstream.on("error", () => jsonResponse(response, 502, { error: "usage_unavailable" }));
}

function jitter(base) {
  return Math.round(base * (0.9 + Math.random() * 0.2));
}

function createRuntime(logic, initialState) {
  const runtime = {
    logic,
    behaviorEngine: logic.behaviorEngine || null,
    shortLoadEngine: logic.shortLoadEngine || null,
    state: ensureState(initialState),
    startedAt: iso(Date.now()),
    schedule: {},
    locks: {},
    timers: {},
  };

  function save() {
    syncActiveAccountState(runtime.state);
    if (typeof runtime.logic.writeState === "function") {
      runtime.logic.writeState(runtime.state);
    }
  }

  function healthSuccess(name) {
    runtime.state.health[`last${name}SuccessAt`] = iso(Date.now());
  }

  function healthFailure(kind) {
    runtime.state.health.lastErrorAt = iso(Date.now());
    runtime.state.health.lastErrorKind = kind;
  }

  function localOnlyForecast(nowMs) {
    return {
      probabilities: {
        rounded_24h: 0,
        rounded_48h: 0,
        commitment_floor_percent: null,
      },
      model: { version: "local-only", base_daily_rate: 0 },
      confidence: "unavailable",
      mode: "local-only",
      updated_at: iso(nowMs),
      last_reset_at: null,
      time_window: null,
      official_signal: null,
    };
  }

  function refreshTargetTrajectory(nowMs) {
    syncActiveAccountState(runtime.state);
    const draft = runtime.logic.buildModel(
      runtime.state.usage.payload || null,
      runtime.state.cache.forecast || null,
      runtime.state.cache.feed || null,
      nowMs,
      safePublicState(runtime.state, runtime),
    );
    let changed = false;
    for (const plan of Array.isArray(draft && draft.accounts) ? draft.accounts : []) {
      const account = object(runtime.state.accountStates[plan.id]);
      if (!account || !plan.decision) continue;
      const previous = normalizedTargetTrajectory(account.targetTrajectory);
      const next = updateTargetTrajectory(
        previous,
        { usage: plan.usage, decision: plan.decision, forecast: draft.forecast },
        nowMs,
      );
      if (JSON.stringify(previous) !== JSON.stringify(next)) {
        account.targetTrajectory = next;
        changed = true;
      }
    }
    bindActiveAccountState(runtime.state);
    return changed;
  }

  function refreshBehavior(nowMs) {
    const trajectoryChanged = refreshTargetTrajectory(nowMs);
    const receiver = safePublicState(runtime.state, runtime);
    const preliminary = runtime.logic.buildModel(
      runtime.state.usage.payload || null,
      runtime.state.cache.forecast || null,
      runtime.state.cache.feed || null,
      nowMs,
      receiver,
    );
    if (trajectoryChanged) save();
    if (!runtime.behaviorEngine) return runtime.state.usage.behavior;
    if (!preliminary || !preliminary.usage || !preliminary.decision) {
      runtime.state.usage.behavior = null;
      return null;
    }
    try {
      runtime.state.usage.behavior = runtime.behaviorEngine.forecast({
        nowMs,
        currentUsedPercent: preliminary.usage.usedPercent,
        resetsAtMs: preliminary.usage.resetsAtMs,
        updatedAtMs: preliminary.usage.updatedAtMs,
        windowMinutes: preliminary.usage.windowMinutes,
        horizonHours: preliminary.decision.horizonHours,
        targetUsed: preliminary.decision.targetUsed,
        recentSamples: runtime.state.usage.samples,
        historyAccountKey:
          runtime.state.accountStates[runtime.state.activeAccountId] &&
          runtime.state.accountStates[runtime.state.activeAccountId].historyAccountKey,
        strictAccountScope: true,
      });
    } catch {
      healthFailure("behavior");
      runtime.state.usage.behavior = {
        version: 1,
        asOf: iso(nowMs),
        horizonHours: preliminary.decision.horizonHours,
        sourceUpdatedAt: preliminary.usage.updatedAt,
        historySampleCount: 0,
        historyDays: 0,
        status: "invalid",
        confidence: "low",
        reasons: ["本机行为预测计算失败，已退回确定目标"],
        prediction: null,
        context: null,
        models: [],
        validation: null,
      };
    }
    syncActiveAccountState(runtime.state);
    return runtime.state.usage.behavior;
  }

  function applyShortLoadForecast(previous, forecast, nowMs) {
    runtime.state.usage.shortLoad = seedShortLoadPrediction(
      {
        ...forecast,
        pending: previous.pending,
        results: previous.results,
        lastErrorAt: null,
      },
      runtime.state.usage.latest,
      nowMs,
    );
    healthSuccess("ShortLoad");
    save();
    return runtime.state.usage.shortLoad;
  }

  function shortLoadFailure(previous, nowMs) {
    runtime.state.usage.shortLoad = normalizedShortLoadState({
      ...previous,
      status: previous.prediction ? "stale" : "unavailable",
      lastErrorAt: iso(nowMs),
    });
    healthFailure("short-load");
    save();
    return runtime.state.usage.shortLoad;
  }

  function refreshShortLoad(nowMs = Date.now()) {
    const previous = normalizedShortLoadState(runtime.state.usage.shortLoad);
    if (!runtime.shortLoadEngine) return previous;
    try {
      const activeAccount = runtime.state.accountStates[runtime.state.activeAccountId];
      const forecast = runtime.shortLoadEngine.forecast({
        nowMs,
        historyAccountKey: activeAccount && activeAccount.historyAccountKey,
      });
      if (forecast && typeof forecast.then === "function") {
        return forecast
          .then((resolved) => applyShortLoadForecast(previous, resolved, nowMs))
          .catch(() => shortLoadFailure(previous, nowMs));
      }
      return applyShortLoadForecast(previous, forecast, nowMs);
    } catch {
      return shortLoadFailure(previous, nowMs);
    }
  }

  function publicReceiverState() {
    refreshBehavior(Date.now());
    return safePublicState(runtime.state, runtime);
  }

  function currentModel(nowMs) {
    refreshBehavior(nowMs);
    return runtime.logic.buildModel(
      runtime.state.usage.payload || null,
      runtime.state.cache.forecast || null,
      runtime.state.cache.feed || null,
      nowMs,
      safePublicState(runtime.state, runtime),
    );
  }

  async function uiSnapshot() {
    if (!runtime.logic.provider || typeof runtime.logic.provider.fetchUsage !== "function") {
      throw new Error("provider_snapshot_unavailable");
    }
    const receiverState = publicReceiverState();
    const loopbackOrigin = `http://${listenHost}:${listenPort}`;
    const context = {
      settings: {
        get(name) {
          return name === "CODEXBAR_BRIDGE_URL" ? loopbackOrigin : "";
        },
      },
      http: {
        async getJSON(url, options) {
          const parsed = new URL(url);
          let value;
          if (parsed.origin === loopbackOrigin && parsed.pathname === "/api/snapshot") {
            // The installed provider normally prefers this endpoint. While the
            // monitor is producing that endpoint, fail the fast path locally so
            // the provider rebuilds from the already-sanitized component state
            // instead of making a recursive HTTP request back into this server.
            throw new Error("snapshot_fast_path_disabled_inside_monitor");
          } else if (parsed.origin === loopbackOrigin && parsed.pathname === "/api/state") {
            value = receiverState;
          } else if (parsed.origin === loopbackOrigin && parsed.pathname === "/usage") {
            // Snapshot rendering consumes the monitor's already-sanitized,
            // last-good quota state. Collection stays on the monitor schedule,
            // so opening the menu never launches a slow account fetch.
            throw new Error("snapshot_uses_monitor_state");
          } else {
            value = await getJSON(url, Math.max(1, Number(options && options.timeoutSeconds) || 15) * 1_000);
          }
          return { json: value };
        },
      },
      date: { now: () => new Date() },
      fail: { parseFailure: (message) => new Error(message) },
      log() {},
    };
    return runtime.logic.provider.fetchUsage(context);
  }

  function seen(id) {
    return runtime.state.events.seenIds.includes(id);
  }

  function remember(id) {
    runtime.state.events.seenIds = [
      ...runtime.state.events.seenIds.filter((value) => value !== id),
      id,
    ].slice(-32);
  }

  function processEvent(event, options) {
    if (!event || !event.id) return { isNew: false, event: null };
    if (!trustedExplicitEvent(event)) {
      rememberRejectedEvent(runtime.state, event, "untrusted-event-identity");
      save();
      return { isNew: false, event: null };
    }
    event = { ...event, id: explicitEventID(event), ...resetEventEffects(event) };
    const settings = object(options) || {};
    const nowMs = Date.now();
    const eventAtMs = eventAnnouncedAtMs(event);
    if (eventAtMs === null || eventAtMs > nowMs + 2 * minute) {
      return { isNew: false, event: null };
    }
    if (runtime.state.events.closedIds.includes(event.id)) {
      return { isNew: false, event: null };
    }
    let bankedResult = null;
    if (event.bankedGrantEffect === "announced") {
      const previousCampaign = normalizedBankedCampaign(runtime.state.bankedCampaign);
      const grantAnnouncedAtMs =
        millis(event.bankedGrantAnnouncedAt) ?? millis(event.grantAnnouncedAt) ?? eventAtMs;
      const previousLatestAtMs = previousCampaign && millis(previousCampaign.latestEventAt);
      const lifecycleContinuation = Boolean(
        previousCampaign &&
          millis(event.bankedGrantAnnouncedAt) !== null &&
          previousLatestAtMs !== null &&
          grantAnnouncedAtMs <= previousLatestAtMs &&
          eventAtMs - grantAnnouncedAtMs <= 48 * 60 * minute,
      );
      const sameCampaign = Boolean(
        previousCampaign && (previousCampaign.id === event.id || lifecycleContinuation),
      );
      const previousCampaignAtMs = eventAnnouncedAtMs(previousCampaign);
      const lastBankedAtMs = millis(runtime.state.events.lastBankedEventAt);
      const newestBankedAtMs = Math.max(
        previousCampaignAtMs === null ? -Infinity : previousCampaignAtMs,
        lastBankedAtMs === null ? -Infinity : lastBankedAtMs,
      );
      if (!sameCampaign && eventAtMs <= newestBankedAtMs) {
        if (event.forcedResetEffect === "none") {
          remember(event.id);
          return { isNew: false, event: previousCampaign, kind: "banked" };
        }
      } else {
      const baselineCreditIds = {};
      const accountDelivery = {};
      for (const account of Object.values(runtime.state.accountStates)) {
        const credits = (account.resetCredits && account.resetCredits.credits) || [];
        const candidateBaseline = sameCampaign
          ? previousCampaign.baselineCreditIds[account.id] || []
          : credits.map((credit) => credit.id);
        const creditByID = new Map(credits.map((credit) => [credit.id, credit]));
        baselineCreditIds[account.id] = candidateBaseline.filter((creditID) => {
          const credit = creditByID.get(creditID);
          return !credit || millis(credit.grantedAt) === null || millis(credit.grantedAt) < grantAnnouncedAtMs - 5 * minute;
        });
        accountDelivery[account.id] = sameCampaign
          ? previousCampaign.accountDelivery[account.id] || "awaiting-inventory"
          : "awaiting-inventory";
      }
      runtime.state.bankedCampaign = normalizedBankedCampaign({
        ...event,
        announcedAt: iso(grantAnnouncedAtMs),
        grantAnnouncedAt: iso(grantAnnouncedAtMs),
        latestEventAt: event.announcedAt,
        officialState: event.bankedState,
        status: sameCampaign ? previousCampaign.status : "awaiting-inventory",
        firstSeenAt: sameCampaign ? previousCampaign.firstSeenAt : iso(Date.now()),
        baselineCreditIds,
        accountDelivery,
        notifiedDeliveredAccountIds: sameCampaign
          ? previousCampaign.notifiedDeliveredAccountIds
          : [],
      });
      bankedResult = runtime.state.bankedCampaign;
      runtime.state.events.lastBankedEventAt = iso(eventAtMs);
      runtime.state.events.lastBankedEventId = event.id;
      if (!sameCampaign && settings.notify && !settings.viaPush) {
        const copy = notificationCopy(null, "banked-announced");
        sendNativeNotification(copy.subtitle, copy.body);
      }
      }
    }
    if (event.forcedResetEffect === "none") {
      const isNewBanked = !seen(event.id);
      remember(event.id);
      runtime.state.events.lastEventId = event.id;
      if ((millis(runtime.state.events.lastEventAt) || -Infinity) < eventAtMs) {
        runtime.state.events.lastEventAt = event.announcedAt;
        runtime.state.events.lastEventId = event.id;
      }
      save();
      return { isNew: isNewBanked, event: bankedResult, kind: "banked" };
    }
    const previous = object(runtime.state.activeEpisode);
    const isSame = previous && previous.id === event.id;
    const expiresAtMs = eventExpiresAtMs(event);
    if (expiresAtMs !== null && nowMs > expiresAtMs) {
      remember(event.id);
      rememberClosedEvent(runtime.state, event.id);
      if (isSame) runtime.state.activeEpisode = null;
      save();
      return { isNew: false, event: null };
    }
    if (eventSettledByState(runtime.state, event)) {
      remember(event.id);
      rememberClosedEvent(runtime.state, event.id);
      save();
      return { isNew: false, event: null };
    }
    const previousAtMs = eventAnnouncedAtMs(previous);
    const lastEventAtMs = millis(runtime.state.events.lastForcedEventAt);
    const newestAcceptedAtMs = Math.max(
      previousAtMs === null ? -Infinity : previousAtMs,
      lastEventAtMs === null ? -Infinity : lastEventAtMs,
    );
    if (!isSame && eventAtMs <= newestAcceptedAtMs) {
      remember(event.id);
      rememberClosedEvent(runtime.state, event.id);
      save();
      return { isNew: false, event: null };
    }
    const isNew = !seen(event.id);
    if (isSame) {
      runtime.state.activeEpisode = {
        ...previous,
        ...event,
        status: "awaiting-personal",
        deliveryState: "pending",
        firstSeenAt: previous.firstSeenAt,
        baselineUsage: previous.baselineUsage,
        accountDelivery: object(previous.accountDelivery) || {},
        globalNotifiedAt: previous.globalNotifiedAt,
      };
    } else {
      if (previous && previous.id) rememberClosedEvent(runtime.state, previous.id);
      const pendingPushAtMs = millis(runtime.state.events.pendingPushAt);
      const coveredByRecentPush =
        pendingPushAtMs !== null && nowMs - pendingPushAtMs >= 0 && nowMs - pendingPushAtMs <= 30 * minute;
      runtime.state.activeEpisode = {
        ...event,
        status: "awaiting-personal",
        deliveryState: "pending",
        firstSeenAt: iso(nowMs),
        baselineUsage: object(runtime.state.usage.latest) || null,
        accountDelivery: Object.fromEntries(
          Object.keys(object(runtime.state.accountStates) || {}).map((id) => [id, "pending"]),
        ),
        globalNotifiedAt:
          settings.viaPush || !settings.notify || coveredByRecentPush ? iso(nowMs) : null,
      };
      runtime.state.events.lastEventId = event.id;
      runtime.state.events.lastEventAt = iso(eventAtMs);
      runtime.state.events.lastForcedEventId = event.id;
      runtime.state.events.lastForcedEventAt = iso(eventAtMs);
      if (coveredByRecentPush) runtime.state.events.pendingPushAt = null;
    }
    remember(event.id);
    save();

    if (isNew && settings.notify && !settings.viaPush) {
      const model = currentModel(nowMs);
      const copy = notificationCopy(model, "global");
      sendNativeNotification(copy.subtitle, copy.body);
      runtime.state.activeEpisode.globalNotifiedAt = iso(nowMs);
      save();
    }
    return { isNew, event: runtime.state.activeEpisode };
  }

  async function refreshUsage(options) {
    const settings = object(options) || {};
    try {
      const payload = await fetchCodexUsage();
      const nowMs = Date.now();
      const parsedAccounts =
        typeof runtime.logic.pickUsages === "function"
          ? runtime.logic.pickUsages(payload, nowMs)
          : [runtime.logic.pickUsage(payload, nowMs)].filter(Boolean);
      if (!parsedAccounts.length) throw new Error("usage_unusable");
      const previousActiveAccountId = text(runtime.state.activeAccountId) || null;
      const costUpdate = readIncrementalAPICost(runtime.state.costMeter);
      runtime.state.costMeter = { lastRowID: costUpdate.lastRowID };
      const selectedCandidates = parsedAccounts.filter((item) => item.accountSelected);
      const liveCandidates = parsedAccounts.filter((item) => item.accountLive === true);
      const hasLiveMetadata = parsedAccounts.some((item) => item.accountLive !== null);
      const activeParsed =
        liveCandidates.length === 1
          ? liveCandidates[0]
          : !hasLiveMetadata && selectedCandidates.length === 1
            ? selectedCandidates[0]
            : parsedAccounts.length === 1
              ? parsedAccounts[0]
              : null;

      syncActiveAccountState(runtime.state);
      runtime.state.activeAccountId = null;
      runtime.state.selectedAccountId = null;
      for (const account of Object.values(runtime.state.accountStates)) account.present = false;
      const hadAccounts = Object.keys(runtime.state.accountStates).length > 0;
      const event = object(runtime.state.activeEpisode);
      let anyLanded = false;
      let activeLanded = false;
      let activeResetCause = null;
      let unknownCreditDisappearance = false;
      const capacityCandidates = [];

      for (const parsed of parsedAccounts) {
        const id = opaqueAccountID(
          parsed.accountId || parsed.accountEmail || parsed.accountLabel || "legacy-active",
        );
        if (!id) continue;
        const isLive = parsed === activeParsed;
        const isSelected = parsed.accountSelected === true;
        const prior = object(runtime.state.accountStates[id]);
        const legacySeed =
          !hadAccounts && isLive
            ? {
                usage: runtime.state.usage,
                targetTrajectory: runtime.state.targetTrajectory,
                personalResets: runtime.state.personalResets,
                lastPersonalReset: runtime.state.lastPersonalReset,
                forecastNotification: runtime.state.forecastNotification,
                behaviorNotification: runtime.state.behaviorNotification,
              }
            : {};
        const account = normalizedAccountState(prior || legacySeed, id);
        if (event) {
          event.accountDelivery = object(event.accountDelivery) || {};
          if (!text(event.accountDelivery[id])) event.accountDelivery[id] = "pending";
        }
        const previous = object(account.usage.latest);
        const previousPlanRank = Number(account.planRank) || 0;
        const planRank = codexPlanRank(parsed.planType);
        const current = {
          usedPercent: parsed.usedPercent,
          windowMinutes: parsed.windowMinutes,
          resetsAtMs: parsed.resetsAtMs,
          resetsAt: parsed.resetsAt,
          updatedAtMs: parsed.updatedAtMs,
          updatedAt: parsed.updatedAt,
          exact: parsed.exact,
          shortWindow: object(parsed.shortWindow),
        };
        const resetEvidence = previous ? usageResetEvidence(previous, current) : null;
        const rawResetCredits = parsed.resetCreditsPresent
          ? normalizedResetCreditInventory(parsed.resetCredits)
          : null;
        const consumedCredit = resetEvidence
          ? consumedResetCredit(account.resetCredits, rawResetCredits, nowMs)
          : null;
        const previousCredits = normalizedResetCreditInventory(account.resetCredits);
        if (parsed.resetCreditsPresent) {
          account.resetCredits = reconcileResetCreditInventory(
            account.resetCredits,
            rawResetCredits,
            nowMs,
            resetEvidence,
          );
          if (!resetEvidence && previousCredits && rawResetCredits) {
            const currentIDs = new Set(rawResetCredits.credits.map((credit) => credit.id));
            unknownCreditDisappearance =
              unknownCreditDisappearance ||
              previousCredits.credits.some(
                (credit) =>
                  credit.status === "available" &&
                  !currentIDs.has(credit.id) &&
                  (millis(credit.expiresAt) === null || millis(credit.expiresAt) > nowMs),
              );
          }
        }
        const sampleUpdate = appendUsageSample(account.usage.samples, current);
        account.label = text(parsed.accountLabel) || text(parsed.accountEmail) || account.label;
        account.active = isLive;
        account.live = isLive;
        account.selected = isSelected;
        account.present = true;
        account.planType = text(parsed.planType).toLowerCase();
        account.planRank = planRank;
        account.subscriptionRenewsAt = parsed.subscriptionRenewsAt || null;
        account.subscriptionExpiresAt = parsed.subscriptionExpiresAt || null;
        if (previousPlanRank > 0 && planRank === 0) {
          account.lapsedPaidPlanRank = previousPlanRank;
          account.lapsedCycleResetsAt = previous && Number.isFinite(previous.resetsAtMs)
            ? iso(previous.resetsAtMs)
            : null;
        }
        account.historyAccountKey = historyAccountKey(parsed);
        account.usage.payload = [
          {
            provider: "codex",
            accountId: id,
            account: account.label,
            accountActive: isSelected,
            accountLive: isLive,
            usage: {
              updatedAt: parsed.updatedAt,
              dataConfidence: parsed.exact ? "exact" : "estimated",
              identity: { loginMethod: account.planType || null },
              subscriptionRenewsAt: parsed.subscriptionRenewsAt || null,
              subscriptionExpiresAt: parsed.subscriptionExpiresAt || null,
              ...(parsed.shortWindow
                ? {
                    primary: {
                      usedPercent: parsed.shortWindow.usedPercent,
                      windowMinutes: parsed.shortWindow.windowMinutes,
                      resetsAt: parsed.shortWindow.resetsAt,
                    },
                  }
                : {}),
              secondary: {
                usedPercent: parsed.usedPercent,
                windowMinutes: parsed.windowMinutes,
                resetsAt: parsed.resetsAt,
              },
              ...(parsed.resetCreditsPresent
                ? { codexResetCredits: parsed.resetCredits }
                : {}),
            },
          },
        ];
        account.usage.latest = current;
        account.usage.samples = sampleUpdate.samples.slice(-20_160);
        account.usage.pace = sampleUpdate.pace;
        account.usage.shortLoad = settleShortLoadPredictions(account.usage.shortLoad, current, nowMs);

        if (
          previous &&
          previousActiveAccountId === id &&
          Math.abs(current.resetsAtMs - previous.resetsAtMs) <= minute &&
          current.usedPercent > previous.usedPercent + 0.01
        ) {
          capacityCandidates.push({
            id,
            percentDelta: current.usedPercent - previous.usedPercent,
            atMs: current.updatedAtMs || nowMs,
          });
        }

        const lapsedRank = Number(account.lapsedPaidPlanRank) || 0;
        const lapsedResetAtMs = millis(account.lapsedCycleResetsAt);
        const restoringDuringOldCooldown = Boolean(
          previousPlanRank === 0 &&
            lapsedRank > 0 &&
            planRank <= lapsedRank &&
            lapsedResetAtMs !== null &&
            nowMs < lapsedResetAtMs,
        );
        const paidUpgrade = Boolean(
          previous &&
            planRank > 0 &&
            planRank > previousPlanRank &&
            !restoringDuringOldCooldown &&
            (previousPlanRank > 0 || lapsedRank === 0 || planRank > lapsedRank),
        );
        const reset = previous
          ? resetCause(previous, current, event, consumedCredit, {
              paidUpgrade,
              planTransition: `${previousPlanRank}->${planRank}`,
            })
          : null;
        if (reset) {
          const cause = reset.cause;
          const record = {
            at: iso(current.updatedAtMs || nowMs),
            cause,
            evidence: reset.evidence,
            eventId:
              cause === "global-manual" && event
                ? event.id
                : cause === "banked-redeem" && consumedCredit
                  ? consumedCredit.id
                  : null,
          };
          account.personalResets = normalizedPersonalResets([...account.personalResets, record]);
          account.lastPersonalReset = record;
          account.targetTrajectory = null;
          account.forecastNotification = {};
          account.behaviorNotification = {};
          anyLanded = true;
          activeLanded = activeLanded || isLive;
          if (isLive) activeResetCause = cause;
          if (cause === "global-manual" && event) {
            event.accountDelivery = object(event.accountDelivery) || {};
            event.accountDelivery[id] = "landed";
          }
        }
        if (planRank > 0) account.lastPaidPlanRank = planRank;
        if (
          account.lapsedPaidPlanRank > 0 &&
          (millis(account.lapsedCycleResetsAt) === null || nowMs >= millis(account.lapsedCycleResetsAt))
        ) {
          account.lapsedPaidPlanRank = 0;
          account.lapsedCycleResetsAt = null;
        }
        const campaign = normalizedBankedCampaign(runtime.state.bankedCampaign);
        if (campaign && account.resetCredits && account.resetCredits.reliable) {
          const baseline = new Set(campaign.baselineCreditIds[id] || []);
          const delivered = account.resetCredits.credits.some(
            (credit) =>
              !baseline.has(credit.id) &&
              millis(credit.grantedAt) !== null &&
              millis(credit.grantedAt) >= millis(campaign.grantAnnouncedAt) - 5 * minute,
          );
          campaign.accountDelivery[id] = delivered ? "delivered" : "awaiting-inventory";
          if (
            delivered &&
            !campaign.notifiedDeliveredAccountIds.includes(id) &&
            !settings.startup
          ) {
            const copy = notificationCopy(null, "banked-arrived");
            sendNativeNotification(copy.subtitle, `${compactAccountLabel(account.label)}：${copy.body}`);
            campaign.notifiedDeliveredAccountIds.push(id);
          }
          runtime.state.bankedCampaign = campaign;
        }
        runtime.state.accountStates[id] = account;
        if (isLive) runtime.state.activeAccountId = id;
        if (isSelected) runtime.state.selectedAccountId = id;
      }

      if (costUpdate.deltaUSD > 0 && capacityCandidates.length === 1) {
        const candidate = capacityCandidates[0];
        const account = runtime.state.accountStates[candidate.id];
        if (account) {
          account.capacityEstimate = appendCapacitySample(
            account.capacityEstimate,
            costUpdate.deltaUSD,
            candidate.percentDelta,
            candidate.atMs,
          );
        }
      }

      for (const account of Object.values(runtime.state.accountStates)) {
        account.active = account.id === runtime.state.activeAccountId;
        account.live = account.id === runtime.state.activeAccountId;
        account.selected = account.id === runtime.state.selectedAccountId;
      }
      bindActiveAccountState(runtime.state);
      runtime.state.usage.payload = Object.values(runtime.state.accountStates)
        .filter((account) => account.present !== false)
        .flatMap((account) => account.usage.payload || []);
      healthSuccess("Usage");

      const bankedCampaign = normalizedBankedCampaign(runtime.state.bankedCampaign);
      if (bankedCampaign) {
        const tracked = Object.values(runtime.state.accountStates)
          .filter((account) => account.present !== false)
          .map((account) => account.id);
        const delivered = tracked.filter(
          (id) => bankedCampaign.accountDelivery[id] === "delivered",
        ).length;
        bankedCampaign.status =
          tracked.length && delivered === tracked.length
            ? "observed"
            : delivered > 0
              ? "partial-delivery"
              : "awaiting-inventory";
        runtime.state.bankedCampaign = bankedCampaign;
      }

      if (event && object(event.accountDelivery)) {
        const tracked = Object.values(runtime.state.accountStates)
          .filter((account) => account.present !== false)
          .map((account) => account.id);
        if (tracked.length && tracked.every((id) => event.accountDelivery[id] === "landed")) {
          const record = {
            at: iso(nowMs),
            cause: "global-manual",
            evidence: "all-accounts-landed",
            eventId: event.id,
          };
          advanceGlobalSettlement(runtime.state, record);
          rememberClosedEvent(runtime.state, event.id);
          runtime.state.activeEpisode = null;
        }
      }
      save();
      evaluateBehaviorNotification(settings.startup);
      evaluateBankedNotification(settings.startup);
      if (activeLanded && !settings.startup) {
        const copy = notificationCopy(
          null,
          activeResetCause === "banked-redeem" ? "banked-redeemed" : "personal-landed",
        );
        sendNativeNotification(copy.subtitle, copy.body);
      }
      if (unknownCreditDisappearance && !settings.startup) {
        const copy = notificationCopy(null, "banked-disappeared");
        sendNativeNotification(copy.subtitle, copy.body);
      }
      return { landed: anyLanded, parsed: activeParsed };
    } catch (error) {
      healthFailure("usage");
      save();
      throw error;
    }
  }

  function refreshSessions() {
    const nowMs = Date.now();
    const cycleStartMs = sessionCycleStart(runtime.state, nowMs);
    try {
      const readSessions =
        typeof runtime.logic.readSessionRows === "function"
          ? runtime.logic.readSessionRows
          : localSessionRows;
      const readGoals =
        typeof runtime.logic.readGoalRows === "function" ? runtime.logic.readGoalRows : localGoalRows;
      const rows = readSessions(cycleStartMs);
      let goals = [];
      try {
        goals = readGoals();
      } catch {
        // Goals are an optional ranking signal. Recent-session suggestions
        // remain useful if the separate goals database is temporarily busy.
      }
      const ranked = sessionCandidatesFromRows(
        rows,
        goals,
        runtime.state.sessions,
        cycleStartMs,
        nowMs,
      );
      runtime.state.sessions = {
        ...ranked,
        status: "ready",
        updatedAt: iso(nowMs),
        lastErrorAt: null,
      };
      healthSuccess("Sessions");
      save();
      return publicSessionSuggestions(runtime.state.sessions);
    } catch (error) {
      const previous = normalizedSessionState(runtime.state.sessions);
      runtime.state.sessions = {
        ...previous,
        status: previous.candidates.length ? "stale" : "unavailable",
        lastErrorAt: iso(nowMs),
      };
      healthFailure("sessions");
      save();
      throw error;
    }
  }

  function evaluateSignalNotification(startup) {
    const model = currentModel(Date.now());
    const signal = model && model.forecast && model.forecast.signal;
    if (!signal || signal.level !== "commitment" || !signal.id) return null;
    if (runtime.state.events.notifiedSignalIds.includes(signal.id)) return null;
    runtime.state.events.notifiedSignalIds = [
      ...runtime.state.events.notifiedSignalIds,
      signal.id,
    ].slice(-32);
    save();
    if (!startup) {
      const copy = notificationCopy(model, "commitment");
      sendNativeNotification(copy.subtitle, copy.body);
    }
    return "commitment";
  }

  function evaluateForecastNotification(startup) {
    const nowMs = Date.now();
    const model = currentModel(nowMs);
    const plan = notificationPlan(model, runtime.state.forecastNotification, nowMs);
    runtime.state.forecastNotification = plan.state;
    save();
    if (plan.reason && !startup) {
      const copy = notificationCopy(model, plan.reason);
      sendNativeNotification(copy.subtitle, copy.body);
    }
    return plan.reason;
  }

  function evaluateBehaviorNotification(startup) {
    const nowMs = Date.now();
    const model = currentModel(nowMs);
    const plan = behaviorNotificationPlan(model, runtime.state.behaviorNotification, nowMs);
    runtime.state.behaviorNotification = plan.state;
    save();
    if (plan.reason && !startup) {
      const copy = notificationCopy(model, plan.reason);
      sendNativeNotification(copy.subtitle, copy.body);
    }
  }

  function evaluateBankedNotification(startup) {
    const model = currentModel(Date.now());
    const action = text(model && model.actions && model.actions.creditAction) || "hold";
    const previousAction = text(runtime.state.creditNotification.action);
    const previousOptimalAt = millis(runtime.state.creditNotification.optimalAt);
    const optimalAtMs = Number(model && model.bankedPlan && model.bankedPlan.optimalAtMs);
    runtime.state.creditNotification = {
      action,
      creditId: text(model && model.bankedPlan && model.bankedPlan.creditId) || null,
      optimalAt: Number.isFinite(optimalAtMs) ? iso(optimalAtMs) : null,
      evaluatedAt: iso(Date.now()),
    };
    save();
    if (!startup && action === "redeem" && previousAction && previousAction !== "redeem") {
      const copy = notificationCopy(model, "banked-redeem");
      sendNativeNotification(copy.subtitle, copy.body);
    } else if (
      !startup &&
      action === "prepare" &&
      (previousAction === "hold" ||
        (previousOptimalAt !== null &&
          Number.isFinite(optimalAtMs) &&
          previousOptimalAt - optimalAtMs >= 12 * hour))
    ) {
      const copy = notificationCopy(model, "banked-window");
      sendNativeNotification(copy.subtitle, copy.body);
    }
  }

  async function refreshSite(options) {
    const settings = object(options) || {};
    const results = await Promise.allSettled([getJSON(forecastURL, 15_000), getJSON(feedURL, 15_000)]);
    let feedSucceeded = false;
    if (results[0].status === "fulfilled" && object(results[0].value)) {
      runtime.state.cache.forecast = results[0].value;
      healthSuccess("Forecast");
    } else {
      if (!object(runtime.state.cache.forecast)) {
        runtime.state.cache.forecast = localOnlyForecast(Date.now());
      }
      healthFailure("forecast");
    }
    if (results[1].status === "fulfilled" && object(results[1].value)) {
      runtime.state.cache.feed = results[1].value;
      feedSucceeded = true;
      healthSuccess("Feed");
    } else {
      healthFailure("feed");
    }
    reconcileActiveEpisodeState(
      runtime.state,
      feedSucceeded ? runtime.state.cache.feed : null,
      Date.now(),
      { feedSucceeded },
    );
    save();

    const feedEvent = latestExplicitFeedEvent(runtime.state.cache.feed);
    const processed = feedEvent
      ? processEvent(feedEvent, { notify: !settings.startup, viaPush: settings.viaPush })
      : { isNew: false, event: null };
    const processedEvent = processed.event;
    const signalReason = evaluateSignalNotification(settings.startup);
    const forecastReason = evaluateForecastNotification(settings.startup);
    // A forecast increase already carries the behavior shortfall, so do not emit a
    // second notification for the same state transition.
    evaluateBehaviorNotification(
      settings.startup || Boolean(processed.isNew || signalReason || forecastReason),
    );
    return processedEvent;
  }

  async function refreshAtom(options) {
    const settings = object(options) || {};
    try {
      const xml = await getText(atomURL, 15_000, { accept: "application/atom+xml" });
      const latest = parseAtomEntries(xml)[0] || null;
      healthSuccess("Atom");
      let processedEvent = null;
      if (latest) {
        const feedEvent = latestExplicitFeedEvent(runtime.state.cache.feed);
        processedEvent = processEvent(enrichEvent(latest, feedEvent), {
          notify: !settings.startup,
          viaPush: settings.viaPush,
        }).event;
      }
      save();
      return processedEvent;
    } catch (error) {
      healthFailure("atom");
      save();
      throw error;
    }
  }

  async function oneShotX(previousEventID) {
    try {
      const html = await getText(tiboProfileURL, 15_000, {
        accept: "text/html",
        "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/139 Safari/537.36",
      });
      const posts = parseXProfile(html);
      const nowMs = Date.now();
      const latest = posts.find((post) => {
        const postedAtMs = millis(post.announcedAt);
        return (
          post.id !== previousEventID &&
          !seen(post.id) &&
          postedAtMs !== null &&
          postedAtMs <= nowMs + 2 * minute &&
          nowMs - postedAtMs <= 2 * hour
        );
      });
      runtime.state.health.lastXOneShotAt = iso(Date.now());
      save();
      return latest || null;
    } catch {
      healthFailure("x-one-shot");
      save();
      return null;
    }
  }

  async function handlePush() {
    if (runtime.locks.push) return runtime.locks.push;
    runtime.locks.push = (async () => {
      const nowMs = Date.now();
      const previousEventID = runtime.state.events.lastEventId || null;
      // Reaching this authenticated loopback endpoint proves that the existing
      // browser subscription is still live, even if an earlier state file was
      // restored or replaced.
      runtime.state.push.registered = true;
      runtime.state.push.registeredAt = runtime.state.push.registeredAt || iso(nowMs);
      runtime.state.push.lastPushAt = iso(nowMs);
      runtime.state.push.verifiedAt = iso(nowMs);
      save();

      let event = await refreshSite({ viaPush: true }).catch(() => null);
      if (!event || event.id === previousEventID) {
        const atomEvent = await refreshAtom({ viaPush: true }).catch(() => null);
        if (atomEvent && atomEvent.id !== previousEventID) event = atomEvent;
      }
      if (!event || event.id === previousEventID) {
        const xEvent = await oneShotX(previousEventID);
        if (xEvent) {
          event = xEvent;
          processEvent(xEvent, { notify: true, viaPush: true });
        }
      }
      const resolvedNewEvent = Boolean(event && event.id !== previousEventID);
      if (!resolvedNewEvent) {
        runtime.state.events.pendingPushAt = iso(nowMs);
        save();
      }
      await refreshUsage({}).catch(() => null);
      const model = resolvedNewEvent ? currentModel(Date.now()) : null;
      return browserNotification(model, resolvedNewEvent ? object(runtime.state.activeEpisode) : null);
    })().finally(() => {
      runtime.locks.push = null;
    });
    return runtime.locks.push;
  }

  async function getPushConfig() {
    const cachedAt = millis(runtime.state.push.keyFetchedAt);
    if (
      text(runtime.state.push.publicKey) &&
      cachedAt !== null &&
      Date.now() - cachedAt < 24 * hour
    ) {
      return runtime.state.push.publicKey;
    }
    const config = object(await getJSON(pushKeyURL, 15_000));
    if (!config || config.enabled !== true || !text(config.public_key)) {
      throw new Error("push_disabled");
    }
    runtime.state.push.publicKey = text(config.public_key);
    runtime.state.push.keyFetchedAt = iso(Date.now());
    save();
    return runtime.state.push.publicKey;
  }

  async function registerPush(endpoint, locale) {
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 4096) throw new Error("invalid_endpoint");
    await postJSON(pushSubscribeURL, { endpoint, locale: text(locale) || "zh" }, 15_000);
    runtime.state.push.registered = true;
    runtime.state.push.registeredAt = iso(Date.now());
    runtime.state.push.endpointHash = crypto.createHash("sha256").update(endpoint).digest("hex");
    save();
  }

  async function unregisterPush(endpoint) {
    if (!/^https:\/\//.test(endpoint) || endpoint.length > 4096) throw new Error("invalid_endpoint");
    await postJSON(pushUnsubscribeURL, { endpoint }, 15_000);
    runtime.state.push.registered = false;
    runtime.state.push.unregisteredAt = iso(Date.now());
    runtime.state.push.endpointHash = null;
    save();
  }

  function bootstrap(optionsValue) {
    const settings = object(optionsValue) || {};
    const work = (async () => {
      await refreshUsage({ startup: true }).catch(() => null);
      await Promise.resolve().then(refreshSessions).catch(() => null);
      await Promise.resolve().then(() => refreshShortLoad(Date.now())).catch(() => null);
      await Promise.all([
        refreshSite({ startup: true }).catch(() => null),
        refreshAtom({ startup: true }).catch(() => null),
      ]);
      runtime.state.bootstrapCompleteAt = iso(Date.now());
      save();
    })();
    if (settings.waitForBackground) return work;
    work.catch(() => null);
    return Promise.resolve();
  }

  function scheduleLoop(name, baseMs, task, dynamicDelay) {
    async function run() {
      if (!runtime.locks[name]) {
        runtime.locks[name] = Promise.resolve()
          .then(task)
          .catch(() => null)
          .finally(() => {
            runtime.locks[name] = null;
          });
        await runtime.locks[name];
      }
      const delay = dynamicDelay ? dynamicDelay() : baseMs;
      const nextDelay = jitter(delay);
      runtime.schedule[name] = iso(Date.now() + nextDelay);
      runtime.timers[name] = setTimeout(run, nextDelay);
    }
    const firstDelay = jitter(baseMs);
    runtime.schedule[name] = iso(Date.now() + firstDelay);
    runtime.timers[name] = setTimeout(run, firstDelay);
  }

  function startLoops() {
    scheduleLoop("forecast", 10 * minute, () => refreshSite({}));
    scheduleLoop("atom", 15 * minute, () => refreshAtom({}));
    // This only samples the already-running loopback CodexBar bridge. It adds
    // no X or public-site polling and keeps the actual-speed window current.
    scheduleLoop("usage", minute, async () => {
      try {
        await refreshUsage({});
      } finally {
        await Promise.resolve(refreshShortLoad(Date.now()));
      }
    });
    // Reads only small metadata rows from Codex's local SQLite databases. It
    // never scans rollout transcripts and never contacts a website.
    scheduleLoop("sessions", sessionRefreshInterval, refreshSessions);
  }

  return {
    runtime,
    save,
    publicReceiverState,
    currentModel,
    uiSnapshot,
    processEvent,
    refreshUsage,
    refreshShortLoad,
    refreshSessions,
    refreshSite,
    refreshAtom,
    handlePush,
    getPushConfig,
    registerPush,
    unregisterPush,
    bootstrap,
    startLoops,
  };
}

function createServer(service) {
  return http.createServer(async (request, response) => {
    try {
      if (!hostAllowed(request)) {
        jsonResponse(response, 403, { error: "host" });
        return;
      }
      const requestURL = new URL(request.url, `http://${listenHost}:${listenPort}`);
      if (request.method === "GET" && requestURL.pathname === "/usage") {
        proxyUsage(request, response);
        return;
      }
      if (request.method === "GET" && requestURL.pathname === "/api/state") {
        jsonResponse(response, 200, service.publicReceiverState());
        return;
      }
      if (request.method === "GET" && requestURL.pathname === "/api/snapshot") {
        jsonResponse(response, 200, await service.uiSnapshot());
        return;
      }
      if (request.method === "GET" && requestURL.pathname === "/api/config") {
        const publicKey = await service.getPushConfig();
        jsonResponse(response, 200, {
          enabled: true,
          publicKey,
          capabilityToken: service.runtime.state.capabilityToken,
        });
        return;
      }
      if (request.method === "POST" && requestURL.pathname === "/api/subscribe") {
        if (!originAllowed(request)) {
          jsonResponse(response, 403, { error: "origin" });
          return;
        }
        const body = object(await readBody(request, 64 * 1024)) || {};
        if (!timingSafeToken(request.headers["x-codex-reset-token"], service.runtime.state.capabilityToken)) {
          jsonResponse(response, 403, { error: "token" });
          return;
        }
        const subscription = object(body.subscription) || {};
        await service.registerPush(text(subscription.endpoint), text(body.locale));
        jsonResponse(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && requestURL.pathname === "/api/unsubscribe") {
        if (!originAllowed(request)) {
          jsonResponse(response, 403, { error: "origin" });
          return;
        }
        const body = object(await readBody(request, 64 * 1024)) || {};
        if (!timingSafeToken(request.headers["x-codex-reset-token"], service.runtime.state.capabilityToken)) {
          jsonResponse(response, 403, { error: "token" });
          return;
        }
        await service.unregisterPush(text(body.endpoint));
        jsonResponse(response, 200, { ok: true });
        return;
      }
      if (request.method === "POST" && requestURL.pathname === "/api/push-event") {
        if (!originAllowed(request)) {
          jsonResponse(response, 403, { error: "origin" });
          return;
        }
        if (!timingSafeToken(request.headers["x-codex-reset-token"], service.runtime.state.capabilityToken)) {
          jsonResponse(response, 403, { error: "token" });
          return;
        }
        await readBody(request, 1024);
        jsonResponse(response, 200, await service.handlePush());
        return;
      }
      if (request.method === "GET" && (requestURL.pathname === "/" || requestURL.pathname === "/index.html")) {
        assetResponse(response, "index.html", "text/html; charset=utf-8");
        return;
      }
      if (request.method === "GET" && requestURL.pathname === "/app.js") {
        assetResponse(response, "app.js", "text/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && requestURL.pathname === "/style.css") {
        assetResponse(response, "style.css", "text/css; charset=utf-8");
        return;
      }
      if (request.method === "GET" && requestURL.pathname === "/sw.js") {
        assetResponse(response, "sw.js", "text/javascript; charset=utf-8");
        return;
      }
      if (request.method === "GET" && requestURL.pathname === "/manifest.webmanifest") {
        assetResponse(response, "manifest.webmanifest", "application/manifest+json; charset=utf-8");
        return;
      }
      textResponse(response, 404, "Not found", "text/plain; charset=utf-8");
    } catch {
      jsonResponse(response, 500, { error: "request_failed" });
    }
  });
}

async function main() {
  const logic = loadLogic();
  // Persistence is an explicit production dependency. Imported runtimes and
  // tests are memory-only unless they deliberately inject their own writer.
  logic.writeState = writeState;
  logic.behaviorEngine = createBehaviorEngine({ historyFile: codexHistoryFile });
  logic.shortLoadEngine = createShortLoadWorkerEngine({
    historyFile: codexHistoryFile,
    costDatabase: codexCostDatabase,
    stateDatabase: codexStateDatabase,
  });
  const service = createRuntime(logic, readState());
  await service.bootstrap({ waitForBackground: once });

  if (once) {
    const model = service.currentModel(Date.now());
    const behavior = model && model.behavior;
    const prediction = behavior && behavior.prediction;
    const validation = behavior && behavior.validation;
    const shortLoad = service.runtime.state.usage.shortLoad;
    const summary = {
      ready: Boolean(model && model.decision),
      blocker: model && model.blocker,
      mode: model && model.decision && model.decision.mode,
      p24: model && model.forecast && whole(model.forecast.p24),
      probability: model && model.decision && whole(model.decision.probability),
      currentUsed: model && model.usage && Math.round(model.usage.usedPercent * 10) / 10,
      targetNow:
        model && model.decision ? Math.round(model.decision.targetNowUsed * 10) / 10 : null,
      targetUsed:
        model && model.decision ? Math.round(model.decision.targetUsed * 10) / 10 : null,
      targetReached: model && model.decision && model.decision.targetReached,
      targetExceededBy:
        model && model.decision ? Math.round(model.decision.targetExceededBy * 10) / 10 : null,
      recommended: model && model.decision && whole(model.decision.additionalTotal),
      predictionExtra: model && model.decision && whole(model.decision.predictionUse),
      targetRemaining: model && model.decision && whole(model.decision.targetRemaining),
      signal: model && model.forecast && model.forecast.signal.level,
      eventStatus: service.runtime.state.activeEpisode && service.runtime.state.activeEpisode.status,
      trajectory: model && model.targetTrajectory
        ? {
            anchorAt: model.targetTrajectory.anchorAt,
            anchorRemainingPercent:
              Math.round(model.targetTrajectory.anchorRemainingPercent * 10) / 10,
            policyKind: model.targetTrajectory.policyKind,
            policySource: model.targetTrajectory.policySource,
          }
        : null,
      pushRegistered: service.runtime.state.push.registered === true,
      behaviorStatus: behavior && behavior.status,
      behaviorConfidence: behavior && behavior.confidence,
      naturalAdditional: prediction && [
        Math.round(prediction.additionalLower * 10) / 10,
        Math.round(prediction.additionalMedian * 10) / 10,
        Math.round(prediction.additionalUpper * 10) / 10,
      ],
      naturalReach: prediction && whole(prediction.reachProbability),
      extraMedian: prediction && Math.round(prediction.extraMedian * 10) / 10,
      sessionCandidates:
        service.runtime.state.sessions && service.runtime.state.sessions.candidateCount,
      sessionStatus: service.runtime.state.sessions && service.runtime.state.sessions.status,
      shortLoadStatus: shortLoad && shortLoad.status,
      shortLoadAdditional:
        shortLoad && shortLoad.prediction
          ? [
              Math.round(shortLoad.prediction.additionalLower * 10) / 10,
              Math.round(shortLoad.prediction.additionalMedian * 10) / 10,
              Math.round(shortLoad.prediction.additionalUpper * 10) / 10,
            ]
          : null,
      shortLoadShadowEvaluations:
        shortLoad && Array.isArray(shortLoad.results) ? shortLoad.results.length : 0,
      validationMode: validation && validation.selectedMode,
      validationMAE:
        validation && Number.isFinite(validation.mae)
          ? Math.round(validation.mae * 10) / 10
          : null,
      baseMAE:
        validation && Number.isFinite(validation.baseMae)
          ? Math.round(validation.baseMae * 10) / 10
          : null,
    };
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
    if (logic.shortLoadEngine && typeof logic.shortLoadEngine.close === "function") {
      logic.shortLoadEngine.close();
    }
    return;
  }

  const server = createServer(service);
  server.listen(listenPort, listenHost, () => service.startLoops());
  function shutdown() {
    for (const timer of Object.values(service.runtime.timers)) clearTimeout(timer);
    if (logic.shortLoadEngine && typeof logic.shortLoadEngine.close === "function") {
      logic.shortLoadEngine.close();
    }
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3_000).unref();
  }
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

if (require.main === module) {
  main().catch(() => {
    // Fail closed and quietly: raw responses, identities and subscription
    // endpoints are never written to logs.
    process.exitCode = 1;
  });
}

module.exports = {
  advanceGlobalSettlement,
  behaviorZone,
  behaviorNotificationPlan,
  createRuntime,
  createServer,
  decodeEntities,
  eventSettledByState,
  globalSettlementFromState,
  inferDeadline,
  latestExplicitFeedEvent,
  notificationCopy,
  notificationPlan,
  normalizedTargetTrajectory,
  normalizedResetCreditInventory,
  resetEventEffects,
  appendUsageSample,
  apiEquivalentCost,
  appendCapacitySample,
  normalizedCapacityEstimate,
  paceNotificationPlan,
  parseAtomEntries,
  parseXProfile,
  personalLandingEvidence,
  projectTargetTrajectory,
  reconcileActiveEpisodeState,
  renewalObservationFromHistory,
  resetCause,
  seedShortLoadPrediction,
  sessionCandidatesFromRows,
  sessionCycleStart,
  settleShortLoadPredictions,
  shortLoadShadowMetrics,
  trustedExplicitEvent,
  updateTargetTrajectory,
  usageResetEvidence,
  usagePaceFromSamples,
};
