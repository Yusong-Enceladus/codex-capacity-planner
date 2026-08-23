"use strict";

const fs = require("node:fs");

const hour = 60 * 60 * 1000;
const day = 24 * hour;
const weekMinutes = 7 * 24 * 60;
const minimumHistoryStates = 20;

function object(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function finite(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function millis(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function iso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * clamp(probability, 0, 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

function weightedQuantile(entries, probability) {
  const sorted = entries
    .filter((entry) => Number.isFinite(entry.value) && Number.isFinite(entry.weight) && entry.weight > 0)
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

function mean(values) {
  const usable = values.filter(Number.isFinite);
  return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null;
}

function medianAbsoluteError(rows, key) {
  return quantile(
    rows.map((row) => Math.abs(row.actual - row[key])).filter(Number.isFinite),
    0.5,
  );
}

function meanAbsoluteError(rows, key) {
  return mean(rows.map((row) => Math.abs(row.actual - row[key])).filter(Number.isFinite));
}

function normalizeHistoryEntries(entriesValue) {
  const byTime = new Map();
  for (const entryValue of Array.isArray(entriesValue) ? entriesValue : []) {
    const entry = object(entryValue);
    const atMs = millis(entry && (entry.atMs || entry.capturedAt || entry.at || entry.updatedAt));
    const usedPercent = finite(entry && entry.usedPercent);
    const resetsAtMs = millis(entry && (entry.resetsAtMs || entry.resetsAt));
    if (atMs === null || usedPercent === null || resetsAtMs === null) continue;
    byTime.set(atMs, {
      atMs,
      usedPercent: clamp(usedPercent, 0, 100),
      resetsAtMs,
    });
  }
  return [...byTime.values()].sort((left, right) => left.atMs - right.atMs);
}

function weeklyWindows(documentValue) {
  const document = object(documentValue) || {};
  const accounts = object(document.accounts) || {};
  const windows = [];
  for (const accountValue of Object.values(accounts)) {
    for (const windowValue of Array.isArray(accountValue) ? accountValue : []) {
      const window = object(windowValue);
      if (!window || window.name !== "weekly" || Number(window.windowMinutes) !== weekMinutes) continue;
      const samples = normalizeHistoryEntries(window.entries);
      if (samples.length) windows.push(samples);
    }
  }
  return windows;
}

function selectWeeklyHistory(documentValue, currentValue, accountKey, strictAccountScope) {
  const document = object(documentValue) || {};
  const accounts = object(document.accounts) || {};
  if (typeof accountKey === "string" && Array.isArray(accounts[accountKey])) {
    const exact = accounts[accountKey]
      .filter((window) => window && window.name === "weekly" && Number(window.windowMinutes) === weekMinutes)
      .flatMap((window) => normalizeHistoryEntries(window.entries));
    return exact.sort((left, right) => left.atMs - right.atMs);
  }
  if (strictAccountScope) return [];
  const windows = weeklyWindows(documentValue);
  if (!windows.length) return [];
  const current = object(currentValue) || {};
  const currentResetAtMs = finite(current.resetsAtMs);
  const currentUsed = finite(current.usedPercent);
  windows.sort((left, right) => {
    const leftLatest = left[left.length - 1];
    const rightLatest = right[right.length - 1];
    function score(sample) {
      let value = -sample.atMs / day;
      if (currentResetAtMs !== null) value += Math.abs(sample.resetsAtMs - currentResetAtMs) / hour;
      if (currentUsed !== null) value += Math.abs(sample.usedPercent - currentUsed) / 5;
      return value;
    }
    return score(leftLatest) - score(rightLatest);
  });
  return windows[0];
}

function mergeSamples(historyValue, recentValue, currentValue) {
  const merged = [
    ...normalizeHistoryEntries(historyValue),
    ...normalizeHistoryEntries(
      (Array.isArray(recentValue) ? recentValue : []).map((sample) => ({
        capturedAt: finite(sample && sample.atMs),
        usedPercent: finite(sample && sample.usedPercent),
        resetsAt: finite(sample && sample.resetsAtMs),
      })),
    ),
  ];
  const current = object(currentValue);
  if (
    current &&
    finite(current.updatedAtMs) !== null &&
    finite(current.usedPercent) !== null &&
    finite(current.resetsAtMs) !== null
  ) {
    merged.push({
      atMs: current.updatedAtMs,
      usedPercent: clamp(current.usedPercent, 0, 100),
      resetsAtMs: current.resetsAtMs,
    });
  }
  const byTime = new Map();
  for (const sample of merged) {
    if (![sample.atMs, sample.usedPercent, sample.resetsAtMs].every(Number.isFinite)) continue;
    byTime.set(sample.atMs, sample);
  }
  return [...byTime.values()].sort((left, right) => left.atMs - right.atMs);
}

function buildTimeline(samplesValue) {
  const samples = normalizeHistoryEntries(
    (Array.isArray(samplesValue) ? samplesValue : []).map((sample) => ({
      capturedAt: sample.atMs,
      usedPercent: sample.usedPercent,
      resetsAt: sample.resetsAtMs,
    })),
  );
  const increments = [];
  const resets = [];
  const uncertain = [];
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    const gapMs = current.atMs - previous.atMs;
    const usedDelta = current.usedPercent - previous.usedPercent;
    const resetMoved = current.resetsAtMs > previous.resetsAtMs + hour;
    const resetObserved = usedDelta < -0.01 || resetMoved;
    if (gapMs > 6 * hour) uncertain.push({ startMs: previous.atMs, endMs: current.atMs });
    if (resetObserved) {
      resets.push(current.atMs);
      continue;
    }
    if (usedDelta > 0.01) {
      increments.push({
        atMs: current.atMs,
        value: clamp(usedDelta, 0, 100),
      });
    }
  }
  return { samples, increments, resets, uncertain };
}

function hasPointBetween(points, startMs, endMs) {
  return points.some((value) => value > startMs && value <= endMs);
}

function overlapsUncertain(intervals, startMs, endMs) {
  return intervals.some((interval) => interval.startMs < endMs && interval.endMs > startMs);
}

function usageBetween(timeline, startMs, endMs) {
  let total = 0;
  for (const increment of timeline.increments) {
    if (increment.atMs > startMs && increment.atMs <= endMs) total += increment.value;
  }
  return total;
}

function latestSampleAtOrBefore(samples, atMs) {
  let lower = 0;
  let upper = samples.length - 1;
  if (!samples.length || samples[0].atMs > atMs) return null;
  while (lower < upper) {
    const middle = Math.ceil((lower + upper) / 2);
    if (samples[middle].atMs <= atMs) lower = middle;
    else upper = middle - 1;
  }
  return samples[lower];
}

function contextAt(timeline, atMs, windowMinutes) {
  const sample = latestSampleAtOrBefore(timeline.samples, atMs);
  if (!sample) return null;
  const windowMs = Math.max(1, windowMinutes) * 60_000;
  const cycleStartMs = sample.resetsAtMs - windowMs;
  const cycleElapsedHours = Math.max(0, (atMs - cycleStartMs) / hour);
  return {
    atMs,
    usedPercent: sample.usedPercent,
    resetsAtMs: sample.resetsAtMs,
    cycleElapsedHours,
    past1: usageBetween(timeline, atMs - hour, atMs),
    past6: usageBetween(timeline, atMs - 6 * hour, atMs),
    past24: usageBetween(timeline, atMs - day, atMs),
  };
}

function cycleProjection(context, horizonHours) {
  if (!context || context.cycleElapsedHours < 1 || horizonHours <= 0) return null;
  const remaining = Math.max(0, 100 - context.usedPercent);
  return clamp((context.usedPercent / context.cycleElapsedHours) * horizonHours, 0, remaining);
}

function buildHistoricalStates(timeline, horizonHours, windowMinutes) {
  if (!timeline.samples.length || horizonHours <= 0) return [];
  const horizonMs = horizonHours * hour;
  const firstMs = timeline.samples[0].atMs;
  const lastMs = timeline.samples[timeline.samples.length - 1].atMs;
  const stepMs = clamp(horizonMs / 8, hour, 6 * hour);
  const states = [];
  let nextAnchorMs = firstMs + day;
  for (const sample of timeline.samples) {
    if (sample.atMs < nextAnchorMs) continue;
    const atMs = sample.atMs;
    nextAnchorMs = atMs + stepMs;
    if (atMs + horizonMs > lastMs) continue;
    if (hasPointBetween(timeline.resets, atMs, atMs + horizonMs)) continue;
    if (overlapsUncertain(timeline.uncertain, atMs, atMs + horizonMs)) continue;
    const context = contextAt(timeline, atMs, windowMinutes);
    if (!context) continue;
    const outcome = clamp(
      usageBetween(timeline, atMs, atMs + horizonMs),
      0,
      Math.max(0, 100 - context.usedPercent),
    );
    states.push({
      ...context,
      outcome,
      cyclePrediction: cycleProjection(context, horizonHours),
    });
  }
  return states;
}

function evaluationStates(states, horizonHours, maximum) {
  const selected = [];
  const minimumSpacing = Math.max(hour, horizonHours * hour);
  let latestSelected = Infinity;
  for (let index = states.length - 1; index >= 0; index -= 1) {
    const state = states[index];
    if (latestSelected - state.atMs < minimumSpacing) continue;
    selected.push(state);
    latestSelected = state.atMs;
    if (selected.length >= maximum) break;
  }
  return selected.reverse();
}

function trainBefore(states, atMs, horizonHours, lookbackDays) {
  const knownBeforeMs = atMs - horizonHours * hour;
  const cutoffMs = atMs - lookbackDays * day;
  return states.filter((state) => state.atMs <= knownBeforeMs && state.atMs >= cutoffMs);
}

function featureScales(states) {
  const keys = ["past1", "past6", "past24", "usedPercent", "cycleElapsedHours"];
  const scales = {};
  for (const key of keys) {
    const values = states.map((state) => state[key]).filter(Number.isFinite);
    const lower = quantile(values, 0.25);
    const upper = quantile(values, 0.75);
    scales[key] = Math.max(1, (upper || 0) - (lower || 0));
  }
  return scales;
}

function analogDistribution(states, context, count) {
  if (!states.length || !context) return { entries: [], medianDistance: null };
  const scales = featureScales(states);
  const ranked = states
    .map((state) => {
      const distance =
        Math.abs(state.past1 - context.past1) / scales.past1 +
        Math.abs(state.past6 - context.past6) / scales.past6 +
        Math.abs(state.past24 - context.past24) / scales.past24 +
        Math.abs(state.usedPercent - context.usedPercent) / scales.usedPercent +
        Math.abs(state.cycleElapsedHours - context.cycleElapsedHours) / scales.cycleElapsedHours;
      return { state, distance };
    })
    .sort((left, right) => left.distance - right.distance)
    .slice(0, Math.max(1, Math.min(count, states.length)));
  return {
    entries: ranked.map((item) => ({
      value: item.state.outcome,
      weight: 1 / Math.pow(1 + item.distance, 2),
    })),
    medianDistance: quantile(
      ranked.map((item) => item.distance),
      0.5,
    ),
  };
}

function cycleDistribution(states, context, horizonHours) {
  const projected = cycleProjection(context, horizonHours);
  if (projected === null) return { entries: [], center: null };
  const residuals = states
    .filter((state) => Number.isFinite(state.cyclePrediction))
    .map((state) => state.outcome - state.cyclePrediction);
  return {
    center: projected + (quantile(residuals, 0.5) || 0),
    entries: residuals.map((residual) => ({ value: projected + residual, weight: 1 })),
  };
}

function chooseBaseConfiguration(states, evaluations, horizonHours) {
  const candidates = [14, 30, 60, 90];
  const scored = [];
  for (const lookbackDays of candidates) {
    const rows = [];
    for (const evaluation of evaluations) {
      const training = trainBefore(states, evaluation.atMs, horizonHours, lookbackDays);
      if (training.length < 10) continue;
      const prediction = quantile(
        training.map((state) => state.outcome),
        0.5,
      );
      rows.push({ actual: evaluation.outcome, prediction });
    }
    const mae = meanAbsoluteError(rows, "prediction");
    if (mae !== null) scored.push({ lookbackDays, mae, rows: rows.length });
  }
  scored.sort((left, right) => left.mae - right.mae || right.rows - left.rows);
  return scored[0] || null;
}

function chooseAnalogConfiguration(states, evaluations, horizonHours) {
  const scored = [];
  for (const lookbackDays of [30, 60, 90]) {
    for (const count of [20, 40, 80]) {
      const rows = [];
      for (const evaluation of evaluations) {
        const training = trainBefore(states, evaluation.atMs, horizonHours, lookbackDays);
        if (training.length < 10) continue;
        const distribution = analogDistribution(training, evaluation, count);
        const prediction = weightedQuantile(distribution.entries, 0.5);
        if (prediction !== null) rows.push({ actual: evaluation.outcome, prediction });
      }
      const mae = meanAbsoluteError(rows, "prediction");
      if (mae !== null) scored.push({ lookbackDays, count, mae, rows: rows.length });
    }
  }
  scored.sort((left, right) => left.mae - right.mae || right.rows - left.rows);
  return scored[0] || null;
}

function componentBacktest(states, evaluations, horizonHours, baseConfig, analogConfig) {
  const rows = [];
  for (const evaluation of evaluations) {
    const baseTraining = baseConfig
      ? trainBefore(states, evaluation.atMs, horizonHours, baseConfig.lookbackDays)
      : [];
    const analogTraining = analogConfig
      ? trainBefore(states, evaluation.atMs, horizonHours, analogConfig.lookbackDays)
      : [];
    const cycleTraining = trainBefore(states, evaluation.atMs, horizonHours, 90);
    const base = baseTraining.length >= 10
      ? quantile(baseTraining.map((state) => state.outcome), 0.5)
      : null;
    const analog = analogTraining.length >= 10
      ? weightedQuantile(
          analogDistribution(analogTraining, evaluation, analogConfig.count).entries,
          0.5,
        )
      : null;
    const cycle = cycleTraining.length >= 10
      ? cycleDistribution(cycleTraining, evaluation, horizonHours).center
      : null;
    if (base !== null) rows.push({ actual: evaluation.outcome, base, analog, cycle });
  }
  return rows;
}

function performanceWeights(rows) {
  const scores = {};
  for (const key of ["base", "analog", "cycle"]) {
    scores[key] = meanAbsoluteError(
      rows.filter((row) => Number.isFinite(row[key])),
      key,
    );
  }
  const raw = {};
  for (const key of Object.keys(scores)) {
    raw[key] = scores[key] === null ? 0 : 1 / Math.pow(Math.max(1, scores[key]), 2);
  }
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0);
  const weights = {};
  for (const key of Object.keys(raw)) weights[key] = total > 0 ? raw[key] / total : 0;

  const ensembleRows = rows
    .map((row) => {
      let weighted = 0;
      let available = 0;
      for (const key of Object.keys(weights)) {
        if (!Number.isFinite(row[key]) || weights[key] <= 0) continue;
        weighted += row[key] * weights[key];
        available += weights[key];
      }
      return available > 0
        ? { actual: row.actual, ensemble: weighted / available, base: row.base }
        : null;
    })
    .filter(Boolean);
  const ensembleScore = meanAbsoluteError(ensembleRows, "ensemble");
  const baseScore = scores.base;
  const useEnsemble =
    ensembleScore !== null && baseScore !== null && ensembleScore <= baseScore + 1e-9;
  if (!useEnsemble) {
    weights.base = 1;
    weights.analog = 0;
    weights.cycle = 0;
  }
  return {
    scores,
    weights,
    ensembleScore: useEnsemble ? ensembleScore : baseScore,
    selectedMode: useEnsemble ? "ensemble" : "base",
    rows,
  };
}

function componentEntry(value, weight, model) {
  return { value, weight, model };
}

function forecastUsageBehavior(inputValue) {
  const input = object(inputValue) || {};
  const nowMs = finite(input.nowMs);
  const currentUsed = finite(input.currentUsedPercent);
  const currentResetAtMs = finite(input.resetsAtMs);
  const windowMinutes = finite(input.windowMinutes) || weekMinutes;
  const horizonHours = clamp(finite(input.horizonHours) || 0, 0, 48);
  const targetUsed = finite(input.targetUsed);
  const history = selectWeeklyHistory(
    input.historyDocument,
    { usedPercent: currentUsed, resetsAtMs: currentResetAtMs },
    input.historyAccountKey,
    input.strictAccountScope === true,
  );
  const current = {
    updatedAtMs: finite(input.updatedAtMs) || nowMs,
    usedPercent: currentUsed,
    resetsAtMs: currentResetAtMs,
  };
  const merged = mergeSamples(history, input.recentSamples, current);
  const timeline = buildTimeline(merged);
  const baseResult = {
    version: 1,
    asOf: iso(nowMs),
    horizonHours,
    sourceUpdatedAt: timeline.samples.length ? iso(timeline.samples[timeline.samples.length - 1].atMs) : null,
    historySampleCount: history.length,
    historyDays:
      history.length > 1 ? (history[history.length - 1].atMs - history[0].atMs) / day : 0,
    status: "insufficient",
    confidence: "low",
    reasons: [],
    prediction: null,
    context: null,
    models: [],
    validation: null,
  };
  if (
    nowMs === null ||
    currentUsed === null ||
    currentResetAtMs === null ||
    horizonHours < 1 ||
    targetUsed === null ||
    timeline.samples.length < 2
  ) {
    baseResult.reasons.push("输入或预测期限不足");
    return baseResult;
  }

  const context = contextAt(timeline, nowMs, windowMinutes);
  const states = buildHistoricalStates(buildTimeline(history), horizonHours, windowMinutes);
  baseResult.context = context
    ? {
        past1: context.past1,
        past6: context.past6,
        past24: context.past24,
        cycleElapsedHours: context.cycleElapsedHours,
      }
    : null;
  if (!context || states.length < minimumHistoryStates) {
    baseResult.reasons.push(`可用历史窗口仅 ${states.length} 个`);
    return baseResult;
  }

  const evaluations = evaluationStates(states, horizonHours, 60);
  if (evaluations.length < 18) {
    baseResult.reasons.push(`可用于训练和留后验证的窗口仅 ${evaluations.length} 个`);
    return baseResult;
  }
  const validationCount = Math.max(6, Math.min(20, Math.floor(evaluations.length / 3)));
  const tuningEvaluations = evaluations.slice(0, -validationCount);
  const holdoutEvaluations = evaluations.slice(-validationCount);
  const baseConfig = chooseBaseConfiguration(states, tuningEvaluations, horizonHours);
  const analogConfig = chooseAnalogConfiguration(states, tuningEvaluations, horizonHours);
  if (!baseConfig) {
    baseResult.reasons.push("历史不足以完成时间顺序回测");
    return baseResult;
  }
  const tuningRows = componentBacktest(
    states,
    tuningEvaluations,
    horizonHours,
    baseConfig,
    analogConfig,
  );
  const performance = performanceWeights(tuningRows);
  const holdoutRows = componentBacktest(
    states,
    holdoutEvaluations,
    horizonHours,
    baseConfig,
    analogConfig,
  );
  if (holdoutRows.length < 6) {
    baseResult.reasons.push(`独立留后验证窗口仅 ${holdoutRows.length} 个`);
    return baseResult;
  }
  const holdoutScores = {};
  for (const key of ["base", "analog", "cycle"]) {
    holdoutScores[key] = meanAbsoluteError(
      holdoutRows.filter((row) => Number.isFinite(row[key])),
      key,
    );
  }

  const baseStates = trainBefore(states, nowMs, horizonHours, baseConfig.lookbackDays);
  const analogStates = analogConfig
    ? trainBefore(states, nowMs, horizonHours, analogConfig.lookbackDays)
    : [];
  const cycleStates = trainBefore(states, nowMs, horizonHours, 90);
  const baseEntries = baseStates.map((state) => ({ value: state.outcome, weight: 1 }));
  const analog = analogConfig
    ? analogDistribution(analogStates, context, analogConfig.count)
    : { entries: [], medianDistance: null };
  const cycle = cycleDistribution(cycleStates, context, horizonHours);
  const componentCenters = {
    base: weightedQuantile(baseEntries, 0.5),
    analog: weightedQuantile(analog.entries, 0.5),
    cycle: cycle.center,
  };

  const adjustedWeights = { ...performance.weights };
  if (analog.medianDistance !== null) {
    adjustedWeights.analog *= 1 / (1 + analog.medianDistance);
  } else {
    adjustedWeights.analog = 0;
  }
  if (!cycle.entries.length || cycle.center === null) adjustedWeights.cycle = 0;
  if (!baseEntries.length) adjustedWeights.base = 0;
  const adjustedTotal = Object.values(adjustedWeights).reduce((sum, value) => sum + value, 0);
  if (adjustedTotal <= 0) {
    baseResult.reasons.push("所有行为模型均不可用");
    return baseResult;
  }
  for (const key of Object.keys(adjustedWeights)) adjustedWeights[key] /= adjustedTotal;

  function validationForWeights(rows, weights) {
    return rows
      .map((row) => {
        let prediction = 0;
        let availableWeight = 0;
        for (const key of ["base", "analog", "cycle"]) {
          if (!Number.isFinite(row[key]) || weights[key] <= 0) continue;
          prediction += row[key] * weights[key];
          availableWeight += weights[key];
        }
        return availableWeight > 0
          ? { actual: row.actual, prediction: prediction / availableWeight }
          : null;
      })
      .filter(Boolean);
  }

  // Current-context reliability adjustments (for example, a distant analog)
  // change the live weights. Evaluate those exact weights on a later holdout;
  // if they do not beat the simple recent-history baseline, fall back.
  let selectedMode = performance.selectedMode;
  let validationRows = validationForWeights(holdoutRows, adjustedWeights);
  const adjustedMAE = meanAbsoluteError(validationRows, "prediction");
  if (
    selectedMode === "ensemble" &&
    (adjustedMAE === null ||
      holdoutScores.base === null ||
      adjustedMAE > holdoutScores.base + 1e-9)
  ) {
    adjustedWeights.base = 1;
    adjustedWeights.analog = 0;
    adjustedWeights.cycle = 0;
    selectedMode = "base";
    validationRows = validationForWeights(holdoutRows, adjustedWeights);
  }

  const mixture = [];
  function addDistribution(entries, key) {
    const modelWeight = adjustedWeights[key] || 0;
    const entryTotal = entries.reduce((sum, entry) => sum + entry.weight, 0);
    if (modelWeight <= 0 || entryTotal <= 0) return;
    for (const entry of entries) {
      mixture.push(componentEntry(entry.value, (modelWeight * entry.weight) / entryTotal, key));
    }
  }
  addDistribution(baseEntries, "base");
  addDistribution(analog.entries, "analog");
  addDistribution(cycle.entries, "cycle");

  let center = 0;
  let centerWeight = 0;
  for (const [key, value] of Object.entries(componentCenters)) {
    if (!Number.isFinite(value) || adjustedWeights[key] <= 0) continue;
    center += value * adjustedWeights[key];
    centerWeight += adjustedWeights[key];
  }
  center = centerWeight > 0 ? center / centerWeight : weightedQuantile(mixture, 0.5);

  const residuals = [];
  for (const row of holdoutRows) {
    let prediction = 0;
    let availableWeight = 0;
    for (const key of ["base", "analog", "cycle"]) {
      if (!Number.isFinite(row[key]) || adjustedWeights[key] <= 0) continue;
      prediction += row[key] * adjustedWeights[key];
      availableWeight += adjustedWeights[key];
    }
    if (availableWeight > 0) residuals.push(row.actual - prediction / availableWeight);
  }
  const remaining = Math.max(0, 100 - currentUsed);
  let outcomeEntries;
  if (residuals.length >= 12) {
    outcomeEntries = residuals.map((residual) => ({
      value: clamp(center + residual, 0, remaining),
      weight: 1,
    }));
  } else {
    outcomeEntries = mixture.map((entry) => ({
      value: clamp(entry.value, 0, remaining),
      weight: entry.weight,
    }));
  }
  const lower = weightedQuantile(outcomeEntries, 0.25);
  const median = weightedQuantile(outcomeEntries, 0.5);
  const upper = weightedQuantile(outcomeEntries, 0.75);
  if ([lower, median, upper].some((value) => value === null)) {
    baseResult.reasons.push("预测分布不可用");
    return baseResult;
  }

  const targetGap = Math.max(0, targetUsed - currentUsed);
  const totalWeight = outcomeEntries.reduce((sum, entry) => sum + entry.weight, 0);
  const reachingWeight = outcomeEntries.reduce(
    (sum, entry) => sum + (entry.value + 1e-9 >= targetGap ? entry.weight : 0),
    0,
  );
  const reachProbability = totalWeight > 0 ? (reachingWeight / totalWeight) * 100 : null;
  const endpointLower = clamp(currentUsed + lower, 0, 100);
  const endpointMedian = clamp(currentUsed + median, 0, 100);
  const endpointUpper = clamp(currentUsed + upper, 0, 100);
  const intervalWidth = upper - lower;
  const centers = Object.values(componentCenters).filter(Number.isFinite);
  const disagreement = centers.length > 1 ? Math.max(...centers) - Math.min(...centers) : 0;
  const selectedLookback = baseConfig.lookbackDays;
  const reasons = [];
  if (selectedMode === "base") reasons.push("组合模型未胜过基准，已回退到基准");
  if (selectedLookback <= 14) reasons.push("近期行为变化较快，回测选择了短历史");
  if (analog.medianDistance !== null && analog.medianDistance > 4) {
    reasons.push("当前状态缺少足够接近的历史样本");
  }
  if (disagreement > Math.max(10, intervalWidth)) reasons.push("各模型分歧较大");
  if (intervalWidth > 25) reasons.push("个人使用波动较大");
  if (validationRows.length < 12) reasons.push("独立留后验证周期较少");
  const status = reasons.some((reason) => /缺少|分歧|较少/.test(reason))
    ? "degraded"
    : "ready";
  const confidence = status === "degraded" || intervalWidth > 25
    ? "low"
    : intervalWidth > 12
      ? "medium"
      : "high";

  return {
    ...baseResult,
    status,
    confidence,
    reasons,
    prediction: {
      additionalLower: lower,
      additionalMedian: median,
      additionalUpper: upper,
      endpointLower,
      endpointMedian,
      endpointUpper,
      targetGap,
      reachProbability,
      extraLower: Math.max(0, targetGap - upper),
      extraMedian: Math.max(0, targetGap - median),
      extraUpper: Math.max(0, targetGap - lower),
    },
    models: [
      {
        id: "base",
        label: "近期基准",
        median: componentCenters.base,
        weight: adjustedWeights.base,
        mae: holdoutScores.base,
        samples: baseEntries.length,
        config: `${baseConfig.lookbackDays}d`,
      },
      {
        id: "cycle",
        label: "当前周期",
        median: componentCenters.cycle,
        weight: adjustedWeights.cycle,
        mae: holdoutScores.cycle,
        samples: cycle.entries.length,
        config: "calendar",
      },
      {
        id: "analog",
        label: "相似状态",
        median: componentCenters.analog,
        weight: adjustedWeights.analog,
        mae: holdoutScores.analog,
        samples: analog.entries.length,
        config: analogConfig ? `${analogConfig.lookbackDays}d/k${analogConfig.count}` : "unavailable",
        distance: analog.medianDistance,
      },
    ],
    validation: {
      evaluations: validationRows.length,
      mae: meanAbsoluteError(validationRows, "prediction"),
      medianAbsoluteError: medianAbsoluteError(validationRows, "prediction"),
      selectedMode,
      baseMae: holdoutScores.base,
      intervalWidth,
      disagreement,
    },
  };
}

function createBehaviorEngine(optionsValue) {
  const options = object(optionsValue) || {};
  const historyFile = String(options.historyFile || "");
  let cachedMtimeMs = null;
  let cachedDocument = null;
  let cachedForecastKey = null;
  let cachedForecast = null;

  function loadDocument() {
    if (object(options.historyDocument)) return options.historyDocument;
    if (!historyFile) return null;
    try {
      const stat = fs.statSync(historyFile);
      if (cachedDocument && cachedMtimeMs === stat.mtimeMs) return cachedDocument;
      cachedDocument = JSON.parse(fs.readFileSync(historyFile, "utf8"));
      cachedMtimeMs = stat.mtimeMs;
      return cachedDocument;
    } catch {
      return null;
    }
  }

  return {
    forecast(inputValue) {
      const input = object(inputValue) || {};
      const document = loadDocument();
      const recent = Array.isArray(input.recentSamples) ? input.recentSamples : [];
      const latestRecent = recent[recent.length - 1] || {};
      const key = JSON.stringify([
        cachedMtimeMs,
        Math.round((finite(input.updatedAtMs) || finite(input.nowMs) || 0) / 60_000),
        finite(input.currentUsedPercent),
        finite(input.resetsAtMs),
        Math.round((finite(input.horizonHours) || 0) * 20) / 20,
        Math.round((finite(input.targetUsed) || 0) * 10) / 10,
        finite(latestRecent.atMs),
        finite(latestRecent.usedPercent),
      ]);
      if (cachedForecast && cachedForecastKey === key) return cachedForecast;
      cachedForecast = forecastUsageBehavior({
        ...input,
        historyDocument: document,
      });
      cachedForecastKey = key;
      return cachedForecast;
    },
    historyFile,
  };
}

module.exports = {
  buildHistoricalStates,
  buildTimeline,
  createBehaviorEngine,
  forecastUsageBehavior,
  mergeSamples,
  normalizeHistoryEntries,
  selectWeeklyHistory,
  weightedQuantile,
};
