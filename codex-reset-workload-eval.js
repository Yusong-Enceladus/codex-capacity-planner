"use strict";

// Offline, chronological evaluation for the Codex Capacity Planner usage forecast.
// This file deliberately reads only local quota metadata and token/session
// counters. It never reads thread titles, prompts, rollout contents, or paths.

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { DatabaseSync } = require("node:sqlite");
const { forecastUsageBehavior } = require("./codex-reset-behavior.js");

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const weekMinutes = 7 * 24 * 60;

const userHome = os.homedir();
const defaultQuotaHistory = path.join(
  userHome,
  "Library/Application Support/com.steipete.codexbar/history/codex.json",
);
const defaultCostDatabase = path.join(
  userHome,
  "Library/Caches/CodexBar/cost-usage/cost-usage.sqlite",
);
const defaultStateDatabase = path.join(userHome, ".codex/state_5.sqlite");

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length
    ? usable.reduce((sum, value) => sum + value, 0) / usable.length
    : null;
}

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const at = clamp(probability, 0, 1) * (sorted.length - 1);
  const lower = Math.floor(at);
  const upper = Math.ceil(at);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (at - lower);
}

function weightedQuantile(entries, probability) {
  const sorted = entries
    .filter((entry) => Number.isFinite(entry.value) && entry.weight > 0)
    .sort((left, right) => left.value - right.value);
  if (!sorted.length) return null;
  const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
  const target = clamp(probability, 0, 1) * total;
  let cumulative = 0;
  for (const entry of sorted) {
    cumulative += entry.weight;
    if (cumulative >= target) return entry.value;
  }
  return sorted[sorted.length - 1].value;
}

function lowerBound(values, target) {
  let lower = 0;
  let upper = values.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (values[middle] < target) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function upperBound(values, target) {
  let lower = 0;
  let upper = values.length;
  while (lower < upper) {
    const middle = Math.floor((lower + upper) / 2);
    if (values[middle] <= target) lower = middle + 1;
    else upper = middle;
  }
  return lower;
}

function normalizeQuotaEntries(entriesValue) {
  const byTime = new Map();
  for (const entry of Array.isArray(entriesValue) ? entriesValue : []) {
    const atMs = Date.parse(entry && entry.capturedAt);
    const resetsAtMs = Date.parse(entry && entry.resetsAt);
    const usedPercent = Number(entry && entry.usedPercent);
    if (![atMs, resetsAtMs, usedPercent].every(Number.isFinite)) continue;
    byTime.set(atMs, {
      atMs,
      resetsAtMs,
      usedPercent: clamp(usedPercent, 0, 100),
    });
  }
  return [...byTime.values()].sort((left, right) => left.atMs - right.atMs);
}

function weeklyWindow(documentValue, accountKey, strictAccountScope) {
  const accounts = (documentValue && documentValue.accounts) || {};
  const accountWindows = typeof accountKey === "string" ? accounts[accountKey] : null;
  if (Array.isArray(accountWindows)) {
    const exact = accountWindows.find(
      (window) => window && window.name === "weekly" && Number(window.windowMinutes) === weekMinutes,
    );
    if (exact) return exact;
  }
  if (strictAccountScope) return null;
  for (const windows of Object.values(accounts)) {
    for (const window of Array.isArray(windows) ? windows : []) {
      if (window && window.name === "weekly" && Number(window.windowMinutes) === weekMinutes) {
        return window;
      }
    }
  }
  return null;
}

function loadQuotaHistory(pathValue, accountKey, strictAccountScope = false) {
  const document = JSON.parse(fs.readFileSync(pathValue, "utf8"));
  const window = weeklyWindow(document, accountKey, strictAccountScope);
  if (!window) throw new Error("CodexBar weekly quota history was not found");
  const samples = normalizeQuotaEntries(window.entries);
  if (samples.length < 50) throw new Error("Not enough weekly quota samples");
  return { document, samples };
}

function buildQuotaTimeline(samples) {
  const increments = [];
  const resets = [];
  const uncertain = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const gapMs = current.atMs - previous.atMs;
    const delta = current.usedPercent - previous.usedPercent;
    const resetMoved = current.resetsAtMs > previous.resetsAtMs + hour;
    if (gapMs > 6 * hour) uncertain.push({ startMs: previous.atMs, endMs: current.atMs });
    if (delta < -0.01 || resetMoved) {
      resets.push(current.atMs);
    } else if (delta > 0.01) {
      increments.push({ atMs: current.atMs, value: clamp(delta, 0, 100) });
    }
  }
  return { samples, increments, resets, uncertain };
}

function hasPointBetween(points, startMs, endMs) {
  const index = upperBound(points, startMs);
  return index < points.length && points[index] <= endMs;
}

function overlapsInterval(intervals, startMs, endMs) {
  return intervals.some((interval) => interval.startMs < endMs && interval.endMs > startMs);
}

function sumIncrements(increments, startMs, endMs) {
  let total = 0;
  for (let index = upperBound(increments.times, startMs); index < increments.times.length; index += 1) {
    if (increments.times[index] > endMs) break;
    total += increments.values[index];
  }
  return total;
}

function codexModel(meta) {
  const model = String(meta.model || "").toLowerCase();
  return String(meta.modelProvider || "").toLowerCase() === "openai" &&
    (/^gpt-/.test(model) || /^codex-/.test(model));
}

function subagent(meta) {
  return String(meta.threadSource || "").toLowerCase() === "subagent" ||
    Boolean(String(meta.agentRole || "").trim());
}

function flagshipModel(meta) {
  return /^(gpt-5\.5|gpt-5\.6-sol)/i.test(String(meta.model || ""));
}

function highestEffort(meta) {
  return /^(xhigh|max|ultra)$/i.test(String(meta.reasoningEffort || ""));
}

function loadWorkload(costPath, statePath, startMs, endMs) {
  const cost = new DatabaseSync(costPath, { readOnly: true });
  const state = new DatabaseSync(statePath, { readOnly: true });
  const threadMeta = new Map();
  for (const row of state
    .prepare(
      `SELECT id, model_provider, model, reasoning_effort, thread_source, agent_role
       FROM threads`,
    )
    .iterate()) {
    threadMeta.set(String(row.id), {
      modelProvider: row.model_provider,
      model: row.model,
      reasoningEffort: row.reasoning_effort,
      threadSource: row.thread_source,
      agentRole: row.agent_role,
    });
  }

  const fileMeta = new Map();
  for (const row of cost.prepare(`SELECT id, session_id FROM files`).iterate()) {
    const meta = threadMeta.get(String(row.session_id)) || {};
    fileMeta.set(Number(row.id), {
      ...meta,
      eligible: codexModel(meta),
      isSubagent: subagent(meta),
      isFlagship: flagshipModel(meta),
      isHighestEffort: highestEffort(meta),
    });
  }

  // The longest workload feature is six hours. Seven hours of padding keeps
  // boundary samples complete without rescanning an unrelated full day.
  const workloadPaddingMs = 7 * hour;
  const firstMinute = Math.floor((startMs - workloadPaddingMs) / minute);
  const lastMinute = Math.ceil(endMs / minute) + 1;
  const length = lastMinute - firstMinute + 1;
  const fields = [
    "allTokens",
    "rootTokens",
    "inputTokens",
    "cachedTokens",
    "outputTokens",
    "reasoningTokens",
    "events",
    "allActiveMinutes",
    "rootActiveMinutes",
    "allAnyMinutes",
    "rootAnyMinutes",
    "flagshipTokens",
    "highestEffortTokens",
  ];
  const raw = Object.fromEntries(fields.map((key) => [key, new Float64Array(length)]));
  const minuteSessions = new Map();
  const sessionEvents = new Map();
  let eligibleEvents = 0;
  let eligibleFiles = 0;
  let firstEligibleEventMs = null;
  let lastEligibleEventMs = null;
  const seenFiles = new Set();

  const statement = cost.prepare(
    `SELECT file_id, timestamp_ms, last_input, last_cached, last_output, last_reasoning
     FROM token_snapshots
     WHERE timestamp_ms >= ? AND timestamp_ms <= ?
     ORDER BY timestamp_ms`,
  );
  for (const row of statement.iterate(startMs - workloadPaddingMs, endMs)) {
    const fileId = Number(row.file_id);
    const meta = fileMeta.get(fileId);
    if (!meta || !meta.eligible) continue;
    const timestampMs = Number(row.timestamp_ms);
    if (!Number.isFinite(timestampMs)) continue;
    const index = Math.floor(timestampMs / minute) - firstMinute;
    if (index < 0 || index >= length) continue;
    const input = Math.max(0, Number(row.last_input) || 0);
    const cached = Math.max(0, Number(row.last_cached) || 0);
    const output = Math.max(0, Number(row.last_output) || 0);
    const reasoning = Math.max(0, Number(row.last_reasoning) || 0);
    const tokens = input + output;
    raw.allTokens[index] += tokens;
    raw.inputTokens[index] += input;
    raw.cachedTokens[index] += cached;
    raw.outputTokens[index] += output;
    raw.reasoningTokens[index] += reasoning;
    raw.events[index] += 1;
    if (!meta.isSubagent) raw.rootTokens[index] += tokens;
    if (meta.isFlagship) raw.flagshipTokens[index] += tokens;
    if (meta.isHighestEffort) raw.highestEffortTokens[index] += tokens;
    let sets = minuteSessions.get(index);
    if (!sets) {
      sets = { all: new Set(), root: new Set() };
      minuteSessions.set(index, sets);
    }
    sets.all.add(fileId);
    if (!meta.isSubagent) sets.root.add(fileId);
    let timestamps = sessionEvents.get(fileId);
    if (!timestamps) {
      timestamps = [];
      sessionEvents.set(fileId, timestamps);
    }
    timestamps.push(timestampMs);
    seenFiles.add(fileId);
    eligibleEvents += 1;
    firstEligibleEventMs = firstEligibleEventMs === null
      ? timestampMs
      : Math.min(firstEligibleEventMs, timestampMs);
    lastEligibleEventMs = lastEligibleEventMs === null
      ? timestampMs
      : Math.max(lastEligibleEventMs, timestampMs);
  }
  eligibleFiles = seenFiles.size;

  for (const [index, sets] of minuteSessions) {
    raw.allActiveMinutes[index] = sets.all.size;
    raw.rootActiveMinutes[index] = sets.root.size;
    raw.allAnyMinutes[index] = sets.all.size > 0 ? 1 : 0;
    raw.rootAnyMinutes[index] = sets.root.size > 0 ? 1 : 0;
  }

  const prefix = {};
  for (const key of fields) {
    const source = raw[key];
    const values = new Float64Array(length + 1);
    for (let index = 0; index < length; index += 1) {
      values[index + 1] = values[index] + source[index];
    }
    prefix[key] = values;
  }

  const rootSessions = [];
  const allSessions = [];
  for (const [fileId, timestamps] of sessionEvents) {
    const row = { timestamps, root: !fileMeta.get(fileId).isSubagent };
    allSessions.push(row);
    if (row.root) rootSessions.push(row);
  }

  function range(key, startAtMs, endAtMs) {
    // Exclude the partially complete minute containing endAtMs so an offline
    // prediction can never see an event that happened a few seconds later.
    const left = clamp(Math.floor(startAtMs / minute) - firstMinute, 0, length);
    const right = clamp(Math.floor(endAtMs / minute) - firstMinute, 0, length);
    return prefix[key][right] - prefix[key][left];
  }

  function activeNow(sessions, atMs) {
    let count = 0;
    const cutoff = atMs - 2 * minute;
    for (const session of sessions) {
      const index = upperBound(session.timestamps, atMs) - 1;
      if (index >= 0 && session.timestamps[index] > cutoff) count += 1;
    }
    return count;
  }

  function featuresAt(atMs) {
    function windowFeatures(windowMinutes, suffix) {
      const start = atMs - windowMinutes * minute;
      const allTokens = range("allTokens", start, atMs);
      const rootTokens = range("rootTokens", start, atMs);
      const inputTokens = range("inputTokens", start, atMs);
      const cachedTokens = range("cachedTokens", start, atMs);
      const outputTokens = range("outputTokens", start, atMs);
      const reasoningTokens = range("reasoningTokens", start, atMs);
      return {
        [`rootMean${suffix}`]: range("rootActiveMinutes", start, atMs) / windowMinutes,
        [`allMean${suffix}`]: range("allActiveMinutes", start, atMs) / windowMinutes,
        [`rootActiveFraction${suffix}`]: range("rootAnyMinutes", start, atMs) / windowMinutes,
        [`allActiveFraction${suffix}`]: range("allAnyMinutes", start, atMs) / windowMinutes,
        [`logAllTokens${suffix}`]: Math.log1p(allTokens / 1_000_000),
        [`logRootTokens${suffix}`]: Math.log1p(rootTokens / 1_000_000),
        [`logEvents${suffix}`]: Math.log1p(range("events", start, atMs)),
        [`cacheShare${suffix}`]: inputTokens > 0 ? clamp(cachedTokens / inputTokens, 0, 1) : 0,
        [`reasoningShare${suffix}`]: outputTokens > 0
          ? clamp(reasoningTokens / outputTokens, 0, 1)
          : 0,
        [`flagshipShare${suffix}`]: allTokens > 0
          ? clamp(range("flagshipTokens", start, atMs) / allTokens, 0, 1)
          : 0,
        [`highestEffortShare${suffix}`]: allTokens > 0
          ? clamp(range("highestEffortTokens", start, atMs) / allTokens, 0, 1)
          : 0,
      };
    }
    return {
      rootNow2: activeNow(rootSessions, atMs),
      allNow2: activeNow(allSessions, atMs),
      ...windowFeatures(15, "15"),
      ...windowFeatures(60, "60"),
      ...windowFeatures(360, "360"),
    };
  }

  cost.close();
  state.close();
  return {
    featuresAt,
    diagnostics: {
      eligibleEvents,
      eligibleFiles,
      rootFiles: rootSessions.length,
      subagentFiles: allSessions.length - rootSessions.length,
      firstEventAt: firstEligibleEventMs === null ? null : new Date(firstEligibleEventMs).toISOString(),
      lastEventAt: lastEligibleEventMs === null ? null : new Date(lastEligibleEventMs).toISOString(),
    },
  };
}

function latestSampleAtOrBefore(samples, atMs) {
  const index = upperBound(samples.map((sample) => sample.atMs), atMs) - 1;
  return index >= 0 ? samples[index] : null;
}

function buildStates(timeline, workload, horizonHours) {
  const horizonMs = horizonHours * hour;
  const increments = {
    times: timeline.increments.map((entry) => entry.atMs),
    values: timeline.increments.map((entry) => entry.value),
  };
  const resetTimes = timeline.resets.slice().sort((left, right) => left - right);
  const stepMs = clamp(horizonMs / 8, hour, 6 * hour);
  const lastAtMs = timeline.samples[timeline.samples.length - 1].atMs;
  const states = [];
  let nextAnchorMs = timeline.samples[0].atMs + day;
  for (const sample of timeline.samples) {
    if (sample.atMs < nextAnchorMs) continue;
    nextAnchorMs = sample.atMs + stepMs;
    const endAtMs = sample.atMs + horizonMs;
    if (endAtMs > lastAtMs) continue;
    if (hasPointBetween(resetTimes, sample.atMs, endAtMs)) continue;
    if (overlapsInterval(timeline.uncertain, sample.atMs, endAtMs)) continue;
    const cycleStartMs = sample.resetsAtMs - weekMinutes * minute;
    const outcome = clamp(
      sumIncrements(increments, sample.atMs, endAtMs),
      0,
      Math.max(0, 100 - sample.usedPercent),
    );
    states.push({
      atMs: sample.atMs,
      endAtMs,
      actual: outcome,
      usedPercent: sample.usedPercent,
      resetsAtMs: sample.resetsAtMs,
      cycleElapsedHours: Math.max(0, (sample.atMs - cycleStartMs) / hour),
      past1: sumIncrements(increments, sample.atMs - hour, sample.atMs),
      past6: sumIncrements(increments, sample.atMs - 6 * hour, sample.atMs),
      past24: sumIncrements(increments, sample.atMs - day, sample.atMs),
      ...workload.featuresAt(sample.atMs),
    });
  }
  return states;
}

function independentStates(states, horizonHours) {
  const selected = [];
  let nextAtMs = -Infinity;
  for (const state of states) {
    if (state.atMs < nextAtMs) continue;
    selected.push(state);
    nextAtMs = state.atMs + Math.max(hour, horizonHours * hour);
  }
  return selected;
}

function evenlyCap(values, maximum) {
  if (values.length <= maximum) return values;
  const selected = [];
  for (let index = 0; index < maximum; index += 1) {
    selected.push(values[Math.round((index * (values.length - 1)) / (maximum - 1))]);
  }
  return selected;
}

function trainBefore(states, evaluation, lookbackDays) {
  const cutoff = evaluation.atMs - lookbackDays * day;
  return states.filter(
    (state) => state.endAtMs <= evaluation.atMs && state.atMs >= cutoff,
  );
}

function robustScales(states, keys) {
  return Object.fromEntries(
    keys.map((key) => {
      const values = states.map((state) => state[key]).filter(Number.isFinite);
      const lower = quantile(values, 0.25) || 0;
      const upper = quantile(values, 0.75) || 0;
      const median = quantile(values, 0.5) || 0;
      return [key, Math.max(1e-6, upper - lower, Math.abs(median) * 0.05)];
    }),
  );
}

function neighborPrediction(training, evaluation, keys, count) {
  if (training.length < Math.max(8, Math.min(count, 12))) return null;
  const scales = robustScales(training, keys);
  const neighbors = training
    .map((state) => {
      let distance = 0;
      let used = 0;
      for (const key of keys) {
        if (!Number.isFinite(state[key]) || !Number.isFinite(evaluation[key])) continue;
        distance += Math.abs(state[key] - evaluation[key]) / scales[key];
        used += 1;
      }
      return {
        value: state.actual,
        distance: used ? distance / used : Infinity,
      };
    })
    .filter((entry) => Number.isFinite(entry.distance))
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.min(count, training.length));
  const weighted = neighbors.map((entry) => ({
    value: entry.value,
    weight: 1 / Math.pow(1 + entry.distance, 2),
  }));
  if (!weighted.length) return null;
  return {
    prediction: weightedQuantile(weighted, 0.5),
    lower: weightedQuantile(weighted, 0.25),
    upper: weightedQuantile(weighted, 0.75),
    distance: quantile(neighbors.map((entry) => entry.distance), 0.5),
  };
}

function baselinePrediction(training) {
  if (training.length < 8) return null;
  const outcomes = training.map((state) => state.actual);
  return {
    prediction: quantile(outcomes, 0.5),
    lower: quantile(outcomes, 0.25),
    upper: quantile(outcomes, 0.75),
  };
}

function scoreRows(rows) {
  if (!rows.length) return null;
  const errors = rows.map((row) => row.prediction - row.actual);
  const absolute = errors.map(Math.abs);
  const covered = rows.filter(
    (row) => Number.isFinite(row.lower) && Number.isFinite(row.upper) &&
      row.actual >= row.lower - 1e-9 && row.actual <= row.upper + 1e-9,
  );
  const widths = rows
    .map((row) => row.upper - row.lower)
    .filter(Number.isFinite);
  return {
    rows: rows.length,
    mae: mean(absolute),
    medianAbsoluteError: quantile(absolute, 0.5),
    rmse: Math.sqrt(mean(errors.map((error) => error * error))),
    bias: mean(errors),
    coverage50: covered.length / rows.length,
    intervalWidth: mean(widths),
  };
}

function evaluateConfiguration(states, evaluations, config, featureKeys) {
  const rows = [];
  for (const evaluation of evaluations) {
    const training = trainBefore(states, evaluation, config.lookbackDays);
    const prediction = featureKeys
      ? neighborPrediction(training, evaluation, featureKeys, config.count)
      : baselinePrediction(training);
    if (!prediction || !Number.isFinite(prediction.prediction)) continue;
    rows.push({ actual: evaluation.actual, atMs: evaluation.atMs, ...prediction });
  }
  return { rows, score: scoreRows(rows) };
}

function tuneModel(states, validation, featureKeys) {
  const candidates = [];
  for (const lookbackDays of [14, 30, 60, 90]) {
    const counts = featureKeys ? [10, 20, 40, 80] : [null];
    for (const count of counts) {
      const config = { lookbackDays, count };
      const result = evaluateConfiguration(states, validation, config, featureKeys);
      if (!result.score || result.score.rows < Math.max(6, Math.floor(validation.length * 0.6))) {
        continue;
      }
      candidates.push({ config, score: result.score });
    }
  }
  candidates.sort(
    (left, right) =>
      left.score.mae - right.score.mae ||
      left.score.medianAbsoluteError - right.score.medianAbsoluteError ||
      Math.abs(left.score.bias) - Math.abs(right.score.bias),
  );
  return candidates[0] || null;
}

function historyDocumentAt(documentValue, atMs) {
  const accounts = {};
  for (const [accountKey, windows] of Object.entries(documentValue.accounts || {})) {
    accounts[accountKey] = (Array.isArray(windows) ? windows : []).map((window) => ({
      ...window,
      entries: Array.isArray(window.entries)
        ? window.entries.filter((entry) => Date.parse(entry.capturedAt) <= atMs)
        : [],
    }));
  }
  return { ...documentValue, accounts };
}

function evaluateExisting(documentValue, evaluations, horizonHours) {
  const rows = [];
  const unavailable = [];
  for (const evaluation of evaluations) {
    const result = forecastUsageBehavior({
      historyDocument: historyDocumentAt(documentValue, evaluation.atMs),
      nowMs: evaluation.atMs,
      updatedAtMs: evaluation.atMs,
      currentUsedPercent: evaluation.usedPercent,
      resetsAtMs: evaluation.resetsAtMs,
      windowMinutes: weekMinutes,
      horizonHours,
      targetUsed: 100,
    });
    if (!result.prediction) {
      unavailable.push(result.status);
      continue;
    }
    rows.push({
      actual: evaluation.actual,
      atMs: evaluation.atMs,
      prediction: result.prediction.additionalMedian,
      lower: result.prediction.additionalLower,
      upper: result.prediction.additionalUpper,
    });
  }
  return { rows, score: scoreRows(rows), unavailable: unavailable.length };
}

function recentRateRows(evaluations, horizonHours) {
  const rows = evaluations.map((evaluation) => {
    const prediction = clamp(
      evaluation.past1 * horizonHours,
      0,
      Math.max(0, 100 - evaluation.usedPercent),
    );
    return {
      actual: evaluation.actual,
      atMs: evaluation.atMs,
      prediction,
      lower: prediction,
      upper: prediction,
    };
  });
  return { rows, score: scoreRows(rows) };
}

function pairedBootstrap(leftRows, rightRows, iterations = 4000) {
  const rightByTime = new Map(rightRows.map((row) => [row.atMs, row]));
  const pairs = leftRows
    .filter((row) => rightByTime.has(row.atMs))
    .map((row) => ({
      day: Math.floor(row.atMs / day),
      difference:
        Math.abs(row.prediction - row.actual) -
        Math.abs(rightByTime.get(row.atMs).prediction - rightByTime.get(row.atMs).actual),
    }));
  const blocks = new Map();
  for (const pair of pairs) {
    if (!blocks.has(pair.day)) blocks.set(pair.day, []);
    blocks.get(pair.day).push(pair.difference);
  }
  const blockValues = [...blocks.values()].map((values) => mean(values));
  if (blockValues.length < 4) return null;
  let seed = 0x5eed1234;
  function random() {
    seed = (1664525 * seed + 1013904223) >>> 0;
    return seed / 0x100000000;
  }
  const draws = [];
  for (let iteration = 0; iteration < iterations; iteration += 1) {
    let sum = 0;
    for (let index = 0; index < blockValues.length; index += 1) {
      sum += blockValues[Math.floor(random() * blockValues.length)];
    }
    draws.push(sum / blockValues.length);
  }
  return {
    pairedRows: pairs.length,
    blocks: blockValues.length,
    meanMaeDifference: mean(pairs.map((pair) => pair.difference)),
    ci95: [quantile(draws, 0.025), quantile(draws, 0.975)],
  };
}

const featureSets = {
  quota: ["past1", "past6", "past24", "usedPercent", "cycleElapsedHours"],
  activeNow: ["rootNow2", "allNow2"],
  sessionsSimple: [
    "rootNow2",
    "allNow2",
    "rootMean15",
    "allMean15",
    "rootMean60",
    "allMean60",
  ],
  sessionsFull: [
    "rootNow2",
    "allNow2",
    "rootMean15",
    "allMean15",
    "rootMean60",
    "allMean60",
    "rootMean360",
    "allMean360",
    "rootActiveFraction60",
    "allActiveFraction60",
  ],
  tokensSimple: ["logAllTokens15", "logAllTokens60"],
  tokensFull: [
    "logAllTokens15",
    "logAllTokens60",
    "logAllTokens360",
    "logRootTokens60",
    "logEvents60",
    "cacheShare60",
    "reasoningShare60",
  ],
};
featureSets.workload = [...featureSets.sessionsSimple, ...featureSets.tokensSimple];
featureSets.hybrid = [...featureSets.quota, ...featureSets.workload];
featureSets.hybridWithConfig = [
  ...featureSets.hybrid,
  "flagshipShare60",
  "highestEffortShare60",
];

function roundMetric(value) {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : null;
}

function compactScore(score) {
  if (!score) return null;
  return Object.fromEntries(
    Object.entries(score).map(([key, value]) => [key, roundMetric(value)]),
  );
}

function runHorizon(documentValue, timeline, workload, horizonHours) {
  const states = buildStates(timeline, workload, horizonHours);
  const independent = independentStates(states, horizonHours);
  const validationStart = Math.floor(independent.length * 0.6);
  const testStart = Math.floor(independent.length * 0.8);
  const validation = independent.slice(validationStart, testStart);
  const test = evenlyCap(independent.slice(testStart), 120);
  const models = {};
  const rowSets = {};

  const baselineTuning = tuneModel(states, validation, null);
  if (baselineTuning) {
    const result = evaluateConfiguration(states, test, baselineTuning.config, null);
    models.baseline = {
      config: baselineTuning.config,
      validation: compactScore(baselineTuning.score),
      test: compactScore(result.score),
    };
    rowSets.baseline = result.rows;
  }

  for (const [name, keys] of Object.entries(featureSets)) {
    const tuning = tuneModel(states, validation, keys);
    if (!tuning) continue;
    const result = evaluateConfiguration(states, test, tuning.config, keys);
    models[name] = {
      config: tuning.config,
      validation: compactScore(tuning.score),
      test: compactScore(result.score),
    };
    rowSets[name] = result.rows;
  }

  const existing = evaluateExisting(documentValue, test, horizonHours);
  models.existing = {
    config: { productionVersion: 1 },
    test: compactScore(existing.score),
    unavailable: existing.unavailable,
  };
  rowSets.existing = existing.rows;
  const recentRate = recentRateRows(test, horizonHours);
  models.recentRateExtrapolation = { test: compactScore(recentRate.score) };
  rowSets.recentRateExtrapolation = recentRate.rows;

  const reference = rowSets.existing && rowSets.existing.length
    ? "existing"
    : "baseline";
  const comparisons = {};
  for (const [name, rows] of Object.entries(rowSets)) {
    if (name === reference) continue;
    comparisons[`${name}-vs-${reference}`] = pairedBootstrap(rows, rowSets[reference]);
  }

  return {
    horizonHours,
    stateCount: states.length,
    independentCount: independent.length,
    validationCount: validation.length,
    testCount: test.length,
    split: {
      validationFrom: validation.length ? new Date(validation[0].atMs).toISOString() : null,
      testFrom: test.length ? new Date(test[0].atMs).toISOString() : null,
      testTo: test.length ? new Date(test[test.length - 1].atMs).toISOString() : null,
    },
    models,
    comparisons,
  };
}

function parseArguments(argv) {
  const result = {
    quotaHistory: defaultQuotaHistory,
    costDatabase: defaultCostDatabase,
    stateDatabase: defaultStateDatabase,
    horizons: [1, 6, 24],
  };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--quota-history") result.quotaHistory = argv[++index];
    else if (value === "--cost-db") result.costDatabase = argv[++index];
    else if (value === "--state-db") result.stateDatabase = argv[++index];
    else if (value === "--horizons") {
      result.horizons = argv[++index]
        .split(",")
        .map(Number)
        .filter((entry) => Number.isFinite(entry) && entry >= 1 && entry <= 48);
    }
  }
  return result;
}

function main() {
  const options = parseArguments(process.argv);
  const quota = loadQuotaHistory(options.quotaHistory);
  const timeline = buildQuotaTimeline(quota.samples);
  const startMs = quota.samples[0].atMs;
  const endMs = quota.samples[quota.samples.length - 1].atMs;
  const workload = loadWorkload(options.costDatabase, options.stateDatabase, startMs, endMs);
  const report = {
    version: 1,
    generatedAt: new Date().toISOString(),
    protocol: {
      training: "expanding window; target must finish before prediction time",
      tuning: "middle 20% of chronological independent anchors",
      test: "final 20%, untouched by configuration selection",
      interval: "weighted historical 25th–75th percentiles",
      privacy: "local metadata/counters only; no titles, prompts, rollout text, or paths",
    },
    data: {
      quotaSamples: quota.samples.length,
      quotaFrom: new Date(startMs).toISOString(),
      quotaTo: new Date(endMs).toISOString(),
      resetsDetected: timeline.resets.length,
      uncertainGaps: timeline.uncertain.length,
      ...workload.diagnostics,
    },
    horizons: options.horizons.map((horizon) =>
      runHorizon(quota.document, timeline, workload, horizon),
    ),
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = {
  buildQuotaTimeline,
  buildStates,
  featureSets,
  independentStates,
  loadQuotaHistory,
  loadWorkload,
  neighborPrediction,
  scoreRows,
};
