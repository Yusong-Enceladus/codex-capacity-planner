"use strict";

const fs = require("node:fs");
const { DatabaseSync } = require("node:sqlite");
const {
  Worker,
  isMainThread,
  parentPort,
  workerData,
} = require("node:worker_threads");
const {
  buildQuotaTimeline,
  buildStates,
  featureSets,
  loadQuotaHistory,
  loadWorkload,
  neighborPrediction,
} = require("./codex-reset-workload-eval.js");

const minute = 60_000;
const hour = 60 * minute;
const day = 24 * hour;
const horizonHours = 1;
const lookbackDays = 14;
const neighborCount = 80;
const trainingRefreshInterval = 30 * minute;
const currentRefreshInterval = 5 * minute;
const workerTimeoutMs = 30_000;

function iso(value) {
  return Number.isFinite(value) ? new Date(value).toISOString() : null;
}

function fileMtime(pathValue) {
  try {
    return fs.statSync(pathValue).mtimeMs;
  } catch {
    return null;
  }
}

function finitePrediction(value) {
  if (!value || typeof value !== "object") return null;
  const lower = Number(value.lower);
  const median = Number(value.prediction);
  const upper = Number(value.upper);
  if (![lower, median, upper].every(Number.isFinite)) return null;
  if (lower > median || median > upper) return null;
  return {
    additionalLower: Math.max(0, lower),
    additionalMedian: Math.max(0, median),
    additionalUpper: Math.max(0, upper),
  };
}

function liveActiveCounts(stateDatabase, nowMs) {
  const database = new DatabaseSync(stateDatabase, { readOnly: true });
  try {
    const cutoffMs = Math.floor(nowMs - 2 * minute);
    const ceilingMs = Math.floor(nowMs + minute);
    const row = database
      .prepare(
        `SELECT
           SUM(CASE
                 WHEN LOWER(COALESCE(thread_source, source, '')) NOT LIKE '%subagent%'
                  AND COALESCE(agent_role, '') = ''
                 THEN 1 ELSE 0
               END) AS root_count,
           COUNT(*) AS all_count
         FROM threads
         WHERE recency_at_ms > ?
           AND recency_at_ms <= ?
           AND model_provider = 'openai'
           AND (model LIKE 'gpt-%' OR model LIKE 'codex-%')`,
      )
      .get(cutoffMs, ceilingMs);
    return {
      root: Math.max(0, Number(row && row.root_count) || 0),
      all: Math.max(0, Number(row && row.all_count) || 0),
    };
  } finally {
    database.close();
  }
}

function createShortLoadEngine(optionsValue) {
  const options = optionsValue && typeof optionsValue === "object" ? optionsValue : {};
  const historyFile = String(options.historyFile || "");
  const costDatabase = String(options.costDatabase || "");
  const stateDatabase = String(options.stateDatabase || "");
  let trainingCache = null;
  let currentCache = null;

  function rebuildTraining(nowMs, historyAccountKey) {
    if (
      trainingCache &&
      trainingCache.historyAccountKey === historyAccountKey &&
      nowMs >= trainingCache.builtAtMs &&
      nowMs - trainingCache.builtAtMs < trainingRefreshInterval
    ) {
      return trainingCache;
    }
    const quota = loadQuotaHistory(historyFile, historyAccountKey, true);
    const cutoffMs = nowMs - (lookbackDays + 2) * day;
    const samples = quota.samples.filter(
      (sample) => sample.atMs >= cutoffMs && sample.atMs <= nowMs,
    );
    if (samples.length < 80) throw new Error("short_load_quota_history_insufficient");
    const timeline = buildQuotaTimeline(samples);
    const workload = loadWorkload(
      costDatabase,
      stateDatabase,
      samples[0].atMs,
      nowMs,
    );
    const states = buildStates(timeline, workload, horizonHours).filter(
      (state) => state.endAtMs <= nowMs && state.atMs >= nowMs - lookbackDays * day,
    );
    if (states.length < neighborCount) {
      throw new Error("short_load_training_states_insufficient");
    }
    trainingCache = {
      builtAtMs: nowMs,
      historyAccountKey,
      states,
      historySamples: samples.length,
      fromAtMs: states[0].atMs,
      throughAtMs: states[states.length - 1].endAtMs,
    };
    return trainingCache;
  }

  function currentFeatures(nowMs) {
    if (
      currentCache &&
      nowMs >= currentCache.atMs &&
      nowMs - currentCache.atMs < currentRefreshInterval
    ) {
      return currentCache;
    }
    const workload = loadWorkload(
      costDatabase,
      stateDatabase,
      nowMs - 7 * hour,
      nowMs,
    );
    currentCache = {
      atMs: nowMs,
      features: workload.featuresAt(nowMs),
      diagnostics: workload.diagnostics,
    };
    return currentCache;
  }

  function forecast(inputValue) {
    const input = inputValue && typeof inputValue === "object" ? inputValue : {};
    const nowMs = Number(input.nowMs);
    if (!Number.isFinite(nowMs)) throw new Error("short_load_now_missing");
    const startedAtMs = Date.now();
    const historyAccountKey = String(input.historyAccountKey || "");
    if (!historyAccountKey) throw new Error("short_load_account_scope_missing");
    const training = rebuildTraining(nowMs, historyAccountKey);
    const current = currentFeatures(nowMs);
    const liveActive = liveActiveCounts(stateDatabase, nowMs);
    const evaluationFeatures = {
      ...current.features,
      // The cost index is the reproducible source used for historical
      // validation, but it can lag a currently running task. Codex's local
      // thread index is the same activity concept with a fresher current edge.
      rootNow2: liveActive.root,
      allNow2: liveActive.all,
    };
    const rawPrediction = neighborPrediction(
      training.states,
      { atMs: nowMs, endAtMs: nowMs + hour, ...evaluationFeatures },
      featureSets.sessionsFull,
      neighborCount,
    );
    const prediction = finitePrediction(rawPrediction);
    if (!prediction) throw new Error("short_load_prediction_unavailable");
    const databaseUpdatedAtMs = Math.max(
      ...[fileMtime(costDatabase), fileMtime(stateDatabase), fileMtime(historyFile)].filter(
        Number.isFinite,
      ),
    );
    return {
      version: 1,
      model: "session-load-v2-live",
      status: "ready",
      asOf: iso(nowMs),
      horizonHours,
      sourceUpdatedAt: iso(databaseUpdatedAtMs),
      prediction,
      context: {
        activeRootNow: current.features.rootNow2,
        activeAllNow: current.features.allNow2,
        liveActiveRootNow: liveActive.root,
        liveActiveAllNow: liveActive.all,
        rootMean15: current.features.rootMean15,
        allMean15: current.features.allMean15,
        rootMean60: current.features.rootMean60,
        allMean60: current.features.allMean60,
      },
      training: {
        lookbackDays,
        neighborCount,
        states: training.states.length,
        historySamples: training.historySamples,
        fromAt: iso(training.fromAtMs),
        throughAt: iso(training.throughAtMs),
        medianNeighborDistance: Number.isFinite(rawPrediction.distance)
          ? rawPrediction.distance
          : null,
      },
      computationMs: Math.max(0, Date.now() - startedAtMs),
    };
  }

  return {
    forecast,
    config: {
      horizonHours,
      lookbackDays,
      neighborCount,
      featureSet: "sessionsFull",
    },
  };
}

function createShortLoadWorkerEngine(optionsValue) {
  const options = optionsValue && typeof optionsValue === "object" ? optionsValue : {};
  let worker = null;
  let nextID = 1;
  let closed = false;
  const pending = new Map();

  function rejectPending(error) {
    for (const request of pending.values()) {
      clearTimeout(request.timeout);
      request.reject(error);
    }
    pending.clear();
  }

  function stopWorker(error) {
    const current = worker;
    worker = null;
    rejectPending(error);
    if (current) current.terminate().catch(() => null);
  }

  function ensureWorker() {
    if (closed) throw new Error("short_load_worker_closed");
    if (worker) return worker;
    const current = new Worker(__filename, {
      workerData: {
        mode: "codex-reset-short-load",
        options,
      },
    });
    worker = current;
    current.unref();
    current.on("message", (messageValue) => {
      const message = messageValue && typeof messageValue === "object" ? messageValue : {};
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timeout);
      if (message.error) request.reject(new Error(String(message.error)));
      else request.resolve(message.result);
    });
    current.on("error", (error) => {
      if (worker === current) stopWorker(error);
    });
    current.on("exit", (code) => {
      if (worker !== current) return;
      worker = null;
      rejectPending(new Error(`short_load_worker_exit_${code}`));
    });
    return current;
  }

  function forecast(inputValue) {
    return new Promise((resolve, reject) => {
      let current;
      try {
        current = ensureWorker();
      } catch (error) {
        reject(error);
        return;
      }
      const id = nextID;
      nextID += 1;
      const timeout = setTimeout(() => {
        if (!pending.has(id)) return;
        stopWorker(new Error("short_load_worker_timeout"));
      }, workerTimeoutMs);
      pending.set(id, { resolve, reject, timeout });
      try {
        current.postMessage({ id, input: inputValue });
      } catch (error) {
        stopWorker(error);
      }
    });
  }

  function close() {
    closed = true;
    stopWorker(new Error("short_load_worker_closed"));
  }

  return {
    forecast,
    close,
    config: {
      horizonHours,
      lookbackDays,
      neighborCount,
      featureSet: "sessionsFull",
      workerTimeoutMs,
    },
  };
}

if (!isMainThread && workerData && workerData.mode === "codex-reset-short-load") {
  const engine = createShortLoadEngine(workerData.options);
  parentPort.on("message", (messageValue) => {
    const message = messageValue && typeof messageValue === "object" ? messageValue : {};
    try {
      parentPort.postMessage({
        id: message.id,
        result: engine.forecast(message.input),
      });
    } catch (error) {
      parentPort.postMessage({
        id: message.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  });
}

module.exports = {
  createShortLoadEngine,
  createShortLoadWorkerEngine,
};
