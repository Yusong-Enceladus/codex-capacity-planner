"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { DatabaseSync } = require("node:sqlite");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");
const { estimateCost, normalizeModel, tokenCount } = require("./codex-reset-usage-pricing.js");

const dayMs = 86400000;
const timeZones = ["Asia/Shanghai", "America/Los_Angeles"];
const formatters = new Map(timeZones.map((timeZone) => [timeZone,
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })]));
const opaque = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const parse = (value, fallback = null) => {
  try { return JSON.parse(Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : value); }
  catch { return fallback; }
};

function dayKey(at, timeZone) {
  const parts = formatters.get(timeZone).formatToParts(new Date(at));
  const part = (kind) => parts.find((item) => item.type === kind).value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function startOfDay(date, timeZone) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "") || !timeZone) return null;
  try {
    const formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
    const target = Date.parse(`${date}T00:00:00Z`);
    let instant = target;
    for (let index = 0; index < 3; index++) {
      const parts = Object.fromEntries(formatter.formatToParts(new Date(instant)).map((part) => [part.type, part.value]));
      const local = Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}Z`);
      instant += target - local;
    }
    return instant;
  } catch { return null; }
}

function historyRange(days, timeZone, nowMs = Date.now()) {
  if (!Number.isInteger(days) || days < 1 || days > 365 || !timeZones.includes(timeZone)) {
    throw new Error("invalid_history_range");
  }
  const end = dayKey(nowMs, timeZone);
  const anchor = Date.parse(`${end}T12:00:00Z`);
  const dates = Array.from({ length: days }, (_, index) => new Date(anchor - (days - index - 1) * dayMs).toISOString().slice(0, 10));
  return { days, timeZone, start: dates[0], end, dates };
}

// Only explicit provider identities enter this map. A live login, session
// recency, workspace activity or quota delta is never ownership evidence.
function identityRefs(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const key = value.trim().toLowerCase();
  const workspace = key.match(/^codex:workspace:([^:]+):email:/);
  const providerKey = key.startsWith("codex:v1:provider-account:") ? key.slice(26) : null;
  const emailHash = key.startsWith("codex:v1:email-hash:") ? key.slice(20) : null;
  if (workspace) return [opaque(`provider:${workspace[1]}`)];
  if (providerKey) return [opaque(`provider:${providerKey}`)];
  if (emailHash) return [opaque(`email-hash:${emailHash}`)];
  if (key.includes("@")) return [opaque(`email-hash:${opaque(key)}`)];
  return [opaque(`provider:${key}`), opaque(`opaque:${key}`)];
}

function explicitRefs(row) {
  if (!row || typeof row !== "object") return [];
  // Do not recursively inspect arbitrary transcript content or infer an
  // identity from a model's output, a prompt, or a cwd name.
  return [...new Set([row.account_id, row.accountId, row.chatgpt_account_id, row.accountEmail]
    .flatMap(identityRefs))].sort();
}

function ownerResolver(accounts) {
  const owners = new Map();
  for (const account of accounts) {
    if (!account.id) continue;
    for (const ref of [...identityRefs(account.id), ...identityRefs(account.historyAccountKey)]) {
      if (!owners.has(ref)) owners.set(ref, new Set());
      owners.get(ref).add(account.id);
    }
  }
  return (refs) => {
    const matches = new Set(refs.flatMap((ref) => [...(owners.get(ref) || [])]));
    return matches.size === 1 ? [...matches][0] : null;
  };
}

function sessionMetadata(file) {
  let fd;
  try {
    fd = fs.openSync(file, "r");
    // Only the first metadata line, never conversational content. Large
    // instruction/tool definitions are discarded and never persisted.
    const buffer = Buffer.alloc(1024 * 1024);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const newline = buffer.indexOf(10, 0);
    if (newline < 0 || newline >= length) return {};
    const record = parse(buffer.subarray(0, newline));
    if (record?.type !== "session_meta") return {};
    const payload = record.payload || {};
    return {
      sessionID: typeof payload.id === "string" ? payload.id : payload.session_id,
      project: typeof payload.cwd === "string" ? payload.cwd : "",
      refs: explicitRefs(payload),
    };
  } catch { return {}; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function blankTotals() {
  return { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0,
    totalTokens: 0, estimatedCostUSD: null, unpricedEvents: 0, eventCount: 0 };
}

function addTotals(target, row) {
  for (const key of ["inputTokens", "cachedTokens", "outputTokens", "reasoningTokens", "totalTokens", "unpricedEvents", "eventCount"]) {
    target[key] += row[key];
  }
  if (row.estimatedCostUSD !== null) target.estimatedCostUSD = (target.estimatedCostUSD || 0) + row.estimatedCostUSD;
}

function createUsageHistoryStore(options) {
  const file = options.historyDatabase;
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  if (file !== ":memory:") fs.chmodSync(file, 0o600);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;
    CREATE TABLE IF NOT EXISTS sources (
      session_key TEXT PRIMARY KEY, revision TEXT NOT NULL, project_id TEXT NOT NULL,
      project_label TEXT NOT NULL, session_label TEXT NOT NULL, skipped INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE IF NOT EXISTS events (
      session_key TEXT NOT NULL, event_key TEXT NOT NULL, at_ms INTEGER NOT NULL,
      day_zh TEXT NOT NULL, day_en TEXT NOT NULL, owner_refs TEXT NOT NULL,
      model TEXT NOT NULL, mode TEXT NOT NULL, input INTEGER NOT NULL, cached INTEGER NOT NULL,
      output INTEGER NOT NULL, reasoning INTEGER NOT NULL, cost REAL,
      PRIMARY KEY(session_key, event_key)
    );
    CREATE INDEX IF NOT EXISTS events_zh ON events(day_zh);
    CREATE INDEX IF NOT EXISTS events_en ON events(day_en);
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);`);
  const writeMeta = db.prepare("INSERT OR REPLACE INTO metadata VALUES (?, ?)");
  const readMeta = (key, fallback) => parse(db.prepare("SELECT value FROM metadata WHERE key=?").get(key)?.value, fallback);
  let collectorStatus = "idle";
  let revision = 0;
  const cache = new Map();

  function ingest(nowMs = Date.now()) {
    const costDatabase = fs.existsSync(options.costDatabase) ? options.costDatabase : options.seedDatabase;
    if (!costDatabase || !fs.existsSync(costDatabase)) return false;
    const source = new DatabaseSync(costDatabase, { readOnly: true });
    let threadDB;
    try {
      source.exec("PRAGMA query_only=ON; PRAGMA busy_timeout=2000; BEGIN");
      if (options.stateDatabase && fs.existsSync(options.stateDatabase)) {
        try { threadDB = new DatabaseSync(options.stateDatabase, { readOnly: true }); } catch { /* Optional labels only. */ }
      }
      const metadata = parse(source.prepare("SELECT payload FROM scan_metadata WHERE id=1").get()?.payload, {});
      const files = source.prepare("SELECT * FROM files ORDER BY COALESCE(parsed_bytes,0) DESC, updated_at_ms DESC").all();
      const readRows = source.prepare("SELECT row_index,payload FROM usage_rows WHERE file_id=? ORDER BY row_index");
      const readSource = db.prepare("SELECT revision FROM sources WHERE session_key=?");
      const saveSource = db.prepare("INSERT OR REPLACE INTO sources VALUES (?,?,?,?,?,?)");
      const deleteRows = db.prepare("DELETE FROM events WHERE session_key=? AND at_ms>=?");
      const saveRow = db.prepare("INSERT OR REPLACE INTO events VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)");
      const seen = new Set();
      db.exec("BEGIN IMMEDIATE");
      try {
        for (const item of files) {
          const fileRevision = `1:${item.updated_at_ms}:${item.parsed_bytes}:${item.size}:${opaque(item.path)}`;
          const indexedSessionKey = opaque(item.session_id || item.path);
          if (seen.has(indexedSessionKey)) continue;
          if (readSource.get(indexedSessionKey)?.revision === fileRevision) {
            seen.add(indexedSessionKey);
            continue;
          }
          const meta = sessionMetadata(item.path);
          const sessionID = item.session_id || meta.sessionID || item.path;
          const sessionKey = opaque(sessionID);
          // The same session can move between sessions/ and archived_sessions/.
          // Prefer its most-complete ledger entry, never count both copies.
          if (seen.has(sessionKey)) continue;
          seen.add(sessionKey);
          if (readSource.get(sessionKey)?.revision === fileRevision) continue;
          let project = meta.project || "";
          let title = "";
          if (threadDB && sessionID !== item.path) {
            try {
              const thread = threadDB.prepare("SELECT title,cwd FROM threads WHERE id=?").get(sessionID);
              title = thread?.title || "";
              project = project || thread?.cwd || "";
            } catch { /* Schema may differ; generic session label remains usable. */ }
          }
          const normalized = [];
          let skipped = 0;
          for (const itemRow of readRows.iterate(item.id)) {
            const row = parse(itemRow.payload);
            const at = row?.timestampUnixMs;
            // Old day-only aggregates cannot be shifted to UTC+8/PT honestly.
            if (!Number.isFinite(at) || at <= 0 || at > nowMs + 60000) { skipped++; continue; }
            if (at < nowMs - 367 * dayMs) continue;
            const rowRefs = explicitRefs(row);
            const refs = rowRefs.length ? rowRefs : (meta.refs || []);
            const input = tokenCount(row.input);
            const output = tokenCount(row.output);
            normalized.push([
              sessionKey, String(row.eventIndex ?? `${row.turnID || ""}:${itemRow.row_index}`), at,
              dayKey(at, timeZones[0]), dayKey(at, timeZones[1]), JSON.stringify(refs),
              normalizeModel(row.pricingModel || row.model).slice(0, 100), row.pricingMode === "priority" ? "fast" : "standard",
              input, Math.min(input, tokenCount(row.cached)), output,
              Math.min(output, tokenCount(row.reasoning)), estimateCost(row),
            ]);
          }
          // Replace the re-parsed slice, but keep older retained rows if the
          // upstream cache narrows its lookback window. No reset touches this DB.
          const first = normalized.reduce((min, row) => Math.min(min, row[2]), Infinity);
          const coverageStart = startOfDay(item.coverage_since_day || metadata.scanSinceDay, metadata.timeZoneIdentifier);
          const replacementStart = coverageStart ?? first;
          const completeFile = item.scan_complete === 1 || Number(item.parsed_bytes) >= Number(item.size);
          // A new isolated cache can catch up in chunks. Its partial prefix
          // must not erase a more complete, previously imported seed/tail.
          if (completeFile && Number.isFinite(replacementStart)) deleteRows.run(sessionKey, replacementStart);
          for (const row of normalized) saveRow.run(...row);
          saveSource.run(sessionKey, fileRevision, project ? opaque(project) : "unknown",
            project ? path.basename(project).slice(0, 100) : "",
            String(title || `Session ${sessionKey.slice(0, 8)}`).replace(/[\r\n\t]+/g, " ").slice(0, 160), skipped);
        }
        writeMeta.run("source", JSON.stringify({
          scannedAt: Number(metadata.lastScanUnixMs) || null,
          sinceDay: metadata.scanSinceDay || null, untilDay: metadata.scanUntilDay || null,
          timeZone: metadata.timeZoneIdentifier || null,
          complete: metadata.catchUpPending === false && Number(metadata.completedFiles) >= Number(metadata.totalFiles),
        }));
        writeMeta.run("importedAt", JSON.stringify(nowMs));
        db.prepare("DELETE FROM events WHERE at_ms<?").run(nowMs - 367 * dayMs);
        db.exec("COMMIT");
      } catch (error) { db.exec("ROLLBACK"); throw error; }
      revision++;
      cache.clear();
      return true;
    } finally { source.close(); threadDB?.close(); }
  }

  function query({ days = 30, timeZone = timeZones[0], accounts = [], nowMs = Date.now() } = {}) {
    const range = historyRange(days, timeZone, nowMs);
    const source = readMeta("source", {});
    const cacheKey = JSON.stringify([revision, days, timeZone, range.end, accounts]);
    const cached = cache.get(cacheKey);
    if (cached) return { ...cached, collectorStatus };
    const resolve = ownerResolver(accounts);
    const groups = new Map(accounts.map((account) => [account.id, {
      id: account.id, days: new Map(), projects: new Map(), sessions: new Map(), ...blankTotals(),
    }]));
    groups.set("unassigned", { id: "unassigned", days: new Map(), projects: new Map(), sessions: new Map(), ...blankTotals() });
    const column = timeZone === timeZones[0] ? "day_zh" : "day_en";
    const rows = db.prepare(`SELECT e.${column} AS date, e.owner_refs, e.model, e.mode, e.session_key,
        s.project_id, s.project_label, s.session_label,
        SUM(e.input) AS inputTokens, SUM(e.cached) AS cachedTokens, SUM(e.output) AS outputTokens,
        SUM(e.reasoning) AS reasoningTokens, SUM(e.input+e.output) AS totalTokens,
        SUM(e.cost) AS estimatedCostUSD, SUM(CASE WHEN e.cost IS NULL THEN 1 ELSE 0 END) AS unpricedEvents,
        COUNT(*) AS eventCount
      FROM events e JOIN sources s ON s.session_key=e.session_key
      WHERE e.${column}>=? AND e.${column}<=? AND e.at_ms<=?
      GROUP BY e.${column},e.owner_refs,e.model,e.mode,e.session_key`).all(range.start, range.end, nowMs);
    for (const row of rows) {
      const owner = resolve(parse(row.owner_refs, [])) || "unassigned";
      const group = groups.get(owner);
      addTotals(group, row);
      if (!group.days.has(row.date)) group.days.set(row.date, { date: row.date, known: true, models: new Map(), ...blankTotals() });
      const date = group.days.get(row.date);
      addTotals(date, row);
      const modelKey = `${row.model}:${row.mode}`;
      if (!date.models.has(modelKey)) date.models.set(modelKey, { id: modelKey, model: row.model, mode: row.mode, ...blankTotals() });
      addTotals(date.models.get(modelKey), row);
      for (const [collection, id, label] of [
        [group.projects, row.project_id, row.project_label], [group.sessions, row.session_key, row.session_label],
      ]) {
        if (!collection.has(id)) collection.set(id, { id, label, ...blankTotals() });
        addTotals(collection.get(id), row);
      }
    }
    const hasUnassigned = groups.get("unassigned").eventCount > 0;
    // Only fully scanned, interior days can establish a zero. The boundary
    // days stay partial when the upstream scanner used a different time zone.
    const zeroKnown = (date) => source.complete && source.sinceDay && source.untilDay
      && date > source.sinceDay && date < source.untilDay;
    const sorted = (collection) => [...collection.values()].sort((a, b) => b.totalTokens - a.totalTokens);
    const payloadGroups = [...groups.values()].map((group) => {
      const daily = range.dates.map((date) => {
        const value = group.days.get(date);
        const known = Boolean(value || (zeroKnown(date) && (group.id === "unassigned" || !hasUnassigned)));
        return value ? { ...value, models: sorted(value.models), partial: date === range.end }
          : { date, known, partial: date === range.end, models: [], ...blankTotals(), estimatedCostUSD: known ? 0 : null };
      });
      return {
        ...group, days: daily, projects: sorted(group.projects), sessions: sorted(group.sessions),
        coverage: !daily.some((date) => date.known) ? "unavailable" : daily.every((date) => date.known) ? "local" : "partial",
        recordedDays: daily.filter((date) => date.eventCount > 0).length,
      };
    });
    const result = {
      version: 1, days: range.days, timeZone, startDay: range.start, endDay: range.end,
      updatedAt: source.scannedAt ? new Date(source.scannedAt).toISOString() : null,
      collectorStatus, sourceComplete: source.complete === true,
      skippedEvents: db.prepare("SELECT COALESCE(SUM(skipped),0) AS n FROM sources").get().n,
      pricingSource: "codexbar-bundled", accounts: payloadGroups.filter((group) => group.id !== "unassigned"),
      unassigned: payloadGroups.find((group) => group.id === "unassigned"),
    };
    if (cache.size >= 12) cache.clear();
    cache.set(cacheKey, result);
    return result;
  }

  return { ingest, query, close: () => db.close(), setCollectorStatus: (value) => { collectorStatus = value; } };
}

function createUsageHistoryWorker(options) {
  let worker = null;
  const pending = new Map();
  let sequence = 0;
  let refreshPromise = null;
  let closed = false;
  function fail(instance) {
    if (instance !== worker) return;
    worker = null;
    for (const item of pending.values()) { clearTimeout(item.timer); item.reject(new Error("usage_history_unavailable")); }
    pending.clear();
  }
  function start() {
    if (worker) return worker;
    const instance = new Worker(__filename, { workerData: { usageHistory: options } });
    worker = instance;
    instance.on("error", () => fail(instance));
    instance.on("exit", () => fail(instance));
    instance.on("message", (message) => {
      const item = pending.get(message.id);
      if (!item) return;
      pending.delete(message.id);
      clearTimeout(item.timer);
      if (!pending.size) instance.unref();
      if (message.error) item.reject(new Error("usage_history_unavailable"));
      else item.resolve(message.result);
    });
    return instance;
  }
  function call(action, input) {
    if (closed) return Promise.reject(new Error("usage_history_unavailable"));
    return new Promise((resolve, reject) => {
      const id = ++sequence;
      const instance = start();
      instance.ref();
      const timer = setTimeout(() => {
        fail(instance);
        void instance.terminate();
      }, action === "refresh" ? 240000 : 20000);
      timer.unref();
      pending.set(id, { resolve, reject, timer });
      instance.postMessage({ id, action, input });
    });
  }
  return {
    query: (input) => call("query", input),
    refresh: () => {
      if (!refreshPromise) refreshPromise = call("refresh").finally(() => { refreshPromise = null; });
      return refreshPromise;
    },
    close: () => { closed = true; const instance = worker; if (instance) { fail(instance); void instance.terminate(); } },
  };
}

if (!isMainThread && workerData?.usageHistory) {
  const options = workerData.usageHistory;
  const store = createUsageHistoryStore(options);
  let refreshing = null;
  async function refresh() {
    store.setCollectorStatus("updating");
    try { store.ingest(options.nowMs); } catch { /* Keep previously imported data. */ }
    if (options.cli && options.cacheRoot) {
      try {
        fs.mkdirSync(options.cacheRoot, { recursive: true, mode: 0o700 });
        fs.chmodSync(options.cacheRoot, 0o700);
        // Codex-only cost scans are local. No usage command, browser cookies,
        // Keychain, auth-file reads or additional provider probes are needed.
        await new Promise((resolve, reject) => execFile(options.cli,
          ["cost", "--provider", "codex", "--days", "365", "--format", "json", "--cache-root", options.cacheRoot],
          { timeout: 180000, maxBuffer: 32 * 1024 * 1024, env: process.env },
          (error) => error ? reject(error) : resolve()));
        store.ingest(options.nowMs);
        store.setCollectorStatus("ready");
      } catch { store.setCollectorStatus("stale"); }
    } else store.setCollectorStatus("cache-only");
    return true;
  }
  parentPort.on("message", async ({ id, action, input }) => {
    try {
      let result;
      if (action === "refresh") {
        if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
        result = await refreshing;
      } else result = store.query(input);
      parentPort.postMessage({ id, result });
    } catch { parentPort.postMessage({ id, error: true }); }
  });
}

module.exports = { createUsageHistoryStore, createUsageHistoryWorker, historyRange, dayKey, identityRefs, ownerResolver };
