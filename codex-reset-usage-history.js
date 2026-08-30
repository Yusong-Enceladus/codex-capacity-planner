"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");
const { execFile } = require("node:child_process");
const { DatabaseSync, backup } = require("node:sqlite");
const { Worker, isMainThread, parentPort, workerData } = require("node:worker_threads");

const dayMs = 86400000;
const timeZones = ["Asia/Shanghai", "America/Los_Angeles"];
const formatters = new Map(timeZones.map((timeZone) => [timeZone,
  new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" })]));
const opaque = (value) => crypto.createHash("sha256").update(String(value)).digest("hex");
const parse = (value, fallback = null) => {
  try { return JSON.parse(Buffer.isBuffer(value) || value instanceof Uint8Array ? Buffer.from(value).toString("utf8") : value); }
  catch { return fallback; }
};
const label = (value, maximum = 160) => String(value || "").replace(/[\r\n\t]+/g, " ").slice(0, maximum);
const integer = (value) => Number.isSafeInteger(value) && value >= 0;
const dateKey = (value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);

function dayKey(at, timeZone) {
  const parts = formatters.get(timeZone).formatToParts(new Date(at));
  const part = (kind) => parts.find((item) => item.type === kind).value;
  return part("year") + "-" + part("month") + "-" + part("day");
}

function historyRange(days, timeZone, nowMs = Date.now()) {
  if (!Number.isInteger(days) || days < 1 || days > 365 || !timeZones.includes(timeZone)) {
    throw new Error("invalid_history_range");
  }
  const end = dayKey(nowMs, timeZone);
  const anchor = Date.parse(end + "T12:00:00Z");
  const dates = Array.from({ length: days }, (_, index) =>
    new Date(anchor - (days - index - 1) * dayMs).toISOString().slice(0, 10));
  return { days, timeZone, start: dates[0], end, dates };
}

// Ownership is separate from usage calculation. Neither current login nor
// workspace activity proves which account paid for a historical record.
function identityRefs(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  const key = value.trim().toLowerCase();
  const workspace = key.match(/^codex:workspace:([^:]+):email:/);
  const providerKey = key.startsWith("codex:v1:provider-account:") ? key.slice(26) : null;
  const emailHash = key.startsWith("codex:v1:email-hash:") ? key.slice(20) : null;
  if (workspace) return [opaque("provider:" + workspace[1])];
  if (providerKey) return [opaque("provider:" + providerKey)];
  if (emailHash) return [opaque("email-hash:" + emailHash)];
  if (key.includes("@")) return [opaque("email-hash:" + opaque(key))];
  return [opaque("provider:" + key), opaque("opaque:" + key)];
}

function explicitRefs(row) {
  if (!row || typeof row !== "object") return [];
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
    if (!file) return {};
    fd = fs.openSync(file, "r");
    const buffer = Buffer.alloc(1024 * 1024);
    const length = fs.readSync(fd, buffer, 0, buffer.length, 0);
    const newline = buffer.indexOf(10, 0);
    if (newline < 0 || newline >= length) return {};
    const record = parse(buffer.subarray(0, newline));
    if (record?.type !== "session_meta") return {};
    const payload = record.payload || {};
    return { project: typeof payload.cwd === "string" ? payload.cwd : "", refs: explicitRefs(payload) };
  } catch { return {}; }
  finally { if (fd !== undefined) fs.closeSync(fd); }
}

function blankTotals() {
  return { inputTokens: 0, cachedTokens: 0, outputTokens: 0, reasoningTokens: 0,
    totalTokens: 0, estimatedCostUSD: null, unpricedEvents: 0, eventCount: 0 };
}

function addTotals(target, row) {
  for (const key of ["inputTokens", "cachedTokens", "outputTokens", "reasoningTokens", "totalTokens", "unpricedEvents", "eventCount"]) {
    target[key] += row[key] || 0;
  }
  if (row.estimatedCostUSD !== null) target.estimatedCostUSD = (target.estimatedCostUSD || 0) + row.estimatedCostUSD;
}

function createUsageHistoryStore(options) {
  const file = options.historyDatabase;
  if (file !== ":memory:") fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(file);
  if (file !== ":memory:") fs.chmodSync(file, 0o600);
  db.exec([
    "PRAGMA journal_mode=WAL; PRAGMA busy_timeout=2000;",
    "CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);",
    "CREATE TABLE IF NOT EXISTS report_sources (zone TEXT NOT NULL, source_key TEXT NOT NULL,",
    "project_id TEXT NOT NULL, project_label TEXT NOT NULL, session_label TEXT NOT NULL,",
    "complete INTEGER NOT NULL, PRIMARY KEY(zone, source_key));",
    "CREATE TABLE IF NOT EXISTS report_rows (zone TEXT NOT NULL, source_key TEXT NOT NULL,",
    "date TEXT NOT NULL, model TEXT NOT NULL, mode TEXT NOT NULL, owner_refs TEXT NOT NULL,",
    "input INTEGER NOT NULL, cached INTEGER NOT NULL, output INTEGER NOT NULL, total INTEGER NOT NULL,",
    "cost REAL, event_count INTEGER NOT NULL, PRIMARY KEY(zone, source_key, date, model, mode));",
    "CREATE INDEX IF NOT EXISTS report_dates ON report_rows(zone,date);",
  ].join("\n"));
  if (!db.prepare("PRAGMA table_info(report_sources)").all().some((column) => column.name === "source_path")) {
    db.exec("ALTER TABLE report_sources ADD COLUMN source_path TEXT");
  }
  // v1's raw events remain recoverable, but are NEVER used as a fallback.
  // They must be replaced by canonical CodexBar reports before being shown.
  const readMeta = (zone) => parse(db.prepare("SELECT value FROM metadata WHERE key=?")
    .get("report-v2:" + zone)?.value, {});
  const statuses = new Map();
  const queryCache = new Map();
  let revision = 0;

  function ingest(snapshot, nowMs = Date.now()) {
    if (snapshot?.version !== 2 || !timeZones.includes(snapshot.timeZone)
      || !dateKey(snapshot.startDay) || !dateKey(snapshot.endDay) || snapshot.startDay > snapshot.endDay
      || typeof snapshot.complete !== "boolean"
      || !Array.isArray(snapshot.sources)) throw new Error("invalid_history_snapshot");
    const zone = snapshot.timeZone;
    let threadDB;
    if (options.stateDatabase && fs.existsSync(options.stateDatabase)) {
      try { threadDB = new DatabaseSync(options.stateDatabase, { readOnly: true }); } catch { /* Optional labels. */ }
    }
    const readSource = db.prepare("SELECT complete FROM report_sources WHERE zone=? AND source_key=?");
    const saveSource = db.prepare("INSERT OR REPLACE INTO report_sources VALUES (?,?,?,?,?,?,?)");
    const previousPath = db.prepare("SELECT source_key FROM report_sources WHERE zone=? AND source_path=? AND source_key<>? LIMIT 1");
    const deleteSlice = db.prepare("DELETE FROM report_rows WHERE zone=? AND source_key=? AND date>=? AND date<=?");
    const saveRow = db.prepare("INSERT OR REPLACE INTO report_rows VALUES (?,?,?,?,?,?,?,?,?,?,?,?)");
    const seen = new Set();
    db.exec("BEGIN IMMEDIATE");
    try {
      // Identity is a canonical file, not a session: one session can have
      // multiple legitimate shards. Prefer a complete copy of the same file.
      const sources = [...snapshot.sources].sort((a, b) => Number(b.complete) - Number(a.complete)
        || (b.rows?.length || 0) - (a.rows?.length || 0));
      for (const item of sources) {
        if (typeof item.id !== "string" || !item.id || typeof item.complete !== "boolean"
          || !Array.isArray(item.rows)) throw new Error("invalid_history_source");
        const key = opaque(item.id);
        if (seen.has(key)) continue;
        seen.add(key);
        const sourcePath = item.path ? opaque(item.path) : null;
        const replaced = sourcePath && !readSource.get(zone, key) ? previousPath.get(zone, sourcePath, key) : null;
        if (replaced) {
          // Atomic log replacement changes its inode, not its history. Retain
          // the previous outside-window tail under the newly observed identity.
          db.prepare("UPDATE report_rows SET source_key=? WHERE zone=? AND source_key=?")
            .run(key, zone, replaced.source_key);
          db.prepare("UPDATE report_sources SET source_key=? WHERE zone=? AND source_key=?")
            .run(key, zone, replaced.source_key);
        }
        // Bounded re-indexing must not replace a complete retained tail by a
        // shorter prefix. Publish the replacement when that file is complete.
        if (item.complete !== true && readSource.get(zone, key)?.complete === 1) continue;
        const meta = sessionMetadata(item.path);
        const ownRefs = explicitRefs(item);
        const refs = ownRefs.length ? ownRefs : (meta.refs || []);
        let project = item.project || meta.project || "";
        let title = item.title || "";
        if (threadDB && item.sessionID) {
          try {
            const thread = threadDB.prepare("SELECT title,cwd FROM threads WHERE id=?").get(item.sessionID);
            title = thread?.title || title;
            project = project || thread?.cwd || "";
          } catch { /* Schema can vary without affecting usage. */ }
        }
        deleteSlice.run(zone, key, snapshot.startDay, snapshot.endDay);
        for (const row of item.rows) {
          if (!dateKey(row.date) || row.date < snapshot.startDay || row.date > snapshot.endDay
            || typeof row.model !== "string"
            || !["standard", "fast", "unknown"].includes(row.mode)
            || ![row.inputTokens, row.cachedTokens, row.outputTokens, row.totalTokens, row.eventCount].every(integer)
            || (row.estimatedCostUSD != null && (!Number.isFinite(row.estimatedCostUSD) || row.estimatedCostUSD < 0))) {
            throw new Error("invalid_history_row");
          }
          if (row.totalTokens === 0 && !(row.estimatedCostUSD > 0)) continue;
          saveRow.run(zone, key, row.date, label(row.model, 100), row.mode, JSON.stringify(refs),
            row.inputTokens, row.cachedTokens, row.outputTokens, row.totalTokens,
            row.estimatedCostUSD ?? null, Math.max(1, row.eventCount));
        }
        saveSource.run(zone, key, project ? opaque(project) : "unknown",
          project ? label(path.basename(project), 100) : "",
          label(title || ("Session " + key.slice(0, 8))), item.complete === true ? 1 : 0, sourcePath);
      }
      const source = {
        scannedAt: Number.isFinite(Date.parse(snapshot.scannedAt)) ? snapshot.scannedAt : null,
        sinceDay: snapshot.startDay, untilDay: snapshot.endDay, complete: snapshot.complete === true,
        completedFiles: snapshot.completedFiles || 0, totalFiles: snapshot.totalFiles || 0,
        processedBytes: snapshot.processedBytes || 0, totalBytes: snapshot.totalBytes || 0,
      };
      db.prepare("INSERT OR REPLACE INTO metadata VALUES (?,?)").run("report-v2:" + zone, JSON.stringify(source));
      db.prepare("DELETE FROM report_rows WHERE zone=? AND date<?").run(zone, dayKey(nowMs - 367 * dayMs, zone));
      db.exec("COMMIT");
      revision++;
      queryCache.clear();
      return source;
    } catch (error) { db.exec("ROLLBACK"); throw error; }
    finally { threadDB?.close(); }
  }

  function query({ days = 30, timeZone = timeZones[0], accounts = [], nowMs = Date.now() } = {}) {
    const range = historyRange(days, timeZone, nowMs);
    const source = readMeta(timeZone);
    const status = statuses.get(timeZone) || (source.scannedAt ? "cache-only" : "correcting");
    const key = JSON.stringify([revision, days, timeZone, range.end, accounts]);
    if (queryCache.has(key)) return { ...queryCache.get(key), collectorStatus: status };
    const resolve = ownerResolver(accounts);
    const groups = new Map(accounts.map((account) => [account.id, {
      id: account.id, days: new Map(), projects: new Map(), sessions: new Map(), ...blankTotals(),
    }]));
    groups.set("unassigned", { id: "unassigned", days: new Map(), projects: new Map(), sessions: new Map(), ...blankTotals() });
    const rows = db.prepare([
      "SELECT r.date,r.owner_refs,r.model,r.mode,r.source_key,s.project_id,s.project_label,s.session_label,",
      "SUM(r.input) AS inputTokens,SUM(r.cached) AS cachedTokens,SUM(r.output) AS outputTokens,",
      "SUM(r.total) AS totalTokens,SUM(r.cost) AS estimatedCostUSD,",
      "SUM(CASE WHEN r.cost IS NULL THEN r.event_count ELSE 0 END) AS unpricedEvents,SUM(r.event_count) AS eventCount",
      "FROM report_rows r JOIN report_sources s ON s.zone=r.zone AND s.source_key=r.source_key",
      "WHERE r.zone=? AND r.date>=? AND r.date<=?",
      "GROUP BY r.date,r.owner_refs,r.model,r.mode,r.source_key",
    ].join(" ")).all(timeZone, range.start, range.end);
    for (const row of rows) {
      const group = groups.get(resolve(parse(row.owner_refs, [])) || "unassigned");
      addTotals(group, row);
      if (!group.days.has(row.date)) group.days.set(row.date, { date: row.date, known: true, models: new Map(), ...blankTotals() });
      const date = group.days.get(row.date);
      addTotals(date, row);
      const modelKey = row.model + ":" + row.mode;
      if (!date.models.has(modelKey)) date.models.set(modelKey, { id: modelKey, model: row.model, mode: row.mode, ...blankTotals() });
      addTotals(date.models.get(modelKey), row);
      for (const [collection, id, text] of [
        [group.projects, row.project_id, row.project_label], [group.sessions, row.source_key, row.session_label],
      ]) {
        if (!collection.has(id)) collection.set(id, { id, label: text, ...blankTotals() });
        addTotals(collection.get(id), row);
      }
    }
    const hasUnassigned = groups.get("unassigned").eventCount > 0;
    const zeroKnown = (date) => source.complete && date > source.sinceDay && date < source.untilDay;
    const sorted = (collection) => [...collection.values()].sort((a, b) => b.totalTokens - a.totalTokens);
    const payloadGroups = [...groups.values()].map((group) => {
      const daily = range.dates.map((date) => {
        const value = group.days.get(date);
        const known = Boolean(value || (zeroKnown(date) && (group.id === "unassigned" || !hasUnassigned)));
        return value ? { ...value, models: sorted(value.models), partial: date === range.end }
          : { date, known, partial: date === range.end, models: [], ...blankTotals(), estimatedCostUSD: known ? 0 : null };
      });
      return { ...group, days: daily, projects: sorted(group.projects), sessions: sorted(group.sessions),
        coverage: !daily.some((date) => date.known) ? "unavailable" : daily.every((date) => date.known) ? "local" : "partial",
        recordedDays: daily.filter((date) => date.eventCount > 0).length };
    });
    const result = {
      version: 2, days: range.days, timeZone, startDay: range.start, endDay: range.end,
      updatedAt: source.scannedAt || null, collectorStatus: status, sourceComplete: source.complete === true,
      skippedEvents: 0, pricingSource: "codexbar-report",
      completedFiles: source.completedFiles || 0, totalFiles: source.totalFiles || 0,
      accounts: payloadGroups.filter((group) => group.id !== "unassigned"),
      unassigned: payloadGroups.find((group) => group.id === "unassigned"),
    };
    if (queryCache.size >= 12) queryCache.clear();
    queryCache.set(key, result);
    return result;
  }
  return { ingest, query, source: readMeta, close: () => db.close(),
    setCollectorStatus: (status, zone) => {
      for (const timeZone of zone ? [zone] : timeZones) statuses.set(timeZone, status);
    } };
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
      const timer = setTimeout(() => { fail(instance); void instance.terminate(); }, action === "refresh" ? 240000 : 20000);
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
    close: () => {
      closed = true;
      const instance = worker;
      if (instance) {
        fail(instance);
        instance.postMessage({ action: "close" });
        const timer = setTimeout(() => { void instance.terminate(); }, 2000);
        timer.unref();
      }
    },
  };
}

async function prepareCollectorRoot(options, zone) {
  if (!timeZones.includes(zone)) throw new Error("invalid_history_range");
  const root = path.join(options.cacheRoot, "reports-v2", zone === timeZones[0] ? "utc8" : "pacific");
  const costDirectory = path.join(root, "cost-usage");
  fs.mkdirSync(costDirectory, { recursive: true, mode: 0o700 });
  fs.chmodSync(root, 0o700);
  const destination = path.join(costDirectory, "cost-usage.sqlite");
  if (!fs.existsSync(destination)) {
    for (const seed of [options.seedDatabase, options.costDatabase]) {
      if (!seed || !fs.existsSync(seed)) continue;
      let source;
      let temporary;
      try {
        source = new DatabaseSync(seed, { readOnly: true });
        const metadata = parse(source.prepare("SELECT payload FROM scan_metadata WHERE id=1").get()?.payload, {});
        if (metadata.timeZoneIdentifier !== zone) continue;
        // SQLite's online backup includes WAL state. Never copy a live .sqlite
        // file alone, and never let a planner scan modify CodexBar's cache.
        temporary = fs.mkdtempSync(path.join(costDirectory, "seed-"));
        const snapshot = path.join(temporary, "cost-usage.sqlite");
        await backup(source, snapshot);
        fs.chmodSync(snapshot, 0o600);
        fs.renameSync(snapshot, destination);
        break;
      } catch { /* An optional missing, locked or incompatible seed cannot block standalone scanning. */ }
      finally {
        source?.close();
        if (temporary) fs.rmSync(temporary, { recursive: true, force: true });
      }
    }
  }
  const referenceRoot = options.seedDatabase ? path.dirname(path.dirname(options.seedDatabase)) : null;
  if (referenceRoot) {
    const pricing = path.join(referenceRoot, "model-pricing");
    if (fs.existsSync(pricing)) {
      const target = path.join(root, "model-pricing");
      fs.mkdirSync(target, { recursive: true, mode: 0o700 });
      for (const name of fs.readdirSync(pricing).filter((name) => /^models-dev-v\d+\.json$/.test(name))) {
        const source = path.join(pricing, name);
        const to = path.join(target, name);
        if (!fs.existsSync(to) || fs.statSync(source).mtimeMs > fs.statSync(to).mtimeMs) {
          fs.copyFileSync(source, to);
          fs.chmodSync(to, 0o600);
        }
      }
    }
  }
  return root;
}

if (!isMainThread && workerData?.usageHistory) {
  const options = workerData.usageHistory;
  const store = createUsageHistoryStore(options);
  let refreshing = null;
  let timer = null;
  let child = null;
  let stopping = false;
  let previousProgress = null;
  let stalledPasses = 0;

  async function refresh() {
    clearTimeout(timer);
    const states = [];
    for (const zone of [timeZones[1], timeZones[0]]) {
      if (stopping) break;
      if (!options.cli || !options.cacheRoot) {
        const file = options.reportFiles?.[zone];
        if (file && fs.existsSync(file)) store.ingest(parse(fs.readFileSync(file)), options.nowMs);
        store.setCollectorStatus("cache-only", zone);
        continue;
      }
      store.setCollectorStatus(store.source(zone).scannedAt ? "updating" : "correcting", zone);
      try {
        const root = await prepareCollectorRoot(options, zone);
        const output = path.join(root, "planner-history.json");
        await new Promise((resolve, reject) => {
          child = execFile(options.cli, ["cost", "--provider", "codex", "--days", "365",
            "--format", "json", "--cache-root", root, "--history-output", output, "--history-time-zone", zone],
          { timeout: 100000, maxBuffer: 1024 * 1024, env: process.env },
          (error) => { child = null; error ? reject(error) : resolve(); });
        });
        if (stopping) break;
        const state = store.ingest(parse(fs.readFileSync(output)), options.nowMs);
        states.push(state);
        store.setCollectorStatus(state.complete ? "ready" : "indexing", zone);
      } catch {
        states.push({ complete: false });
        store.setCollectorStatus("stale", zone);
      }
    }
    if (!stopping && states.some((state) => !state.complete)) {
      const progress = JSON.stringify(states.map((state) =>
        [state.completedFiles, state.totalFiles, state.processedBytes, state.totalBytes]));
      stalledPasses = progress === previousProgress ? stalledPasses + 1 : 0;
      previousProgress = progress;
      timer = setTimeout(() => { void refreshOnce(); }, stalledPasses >= 2 ? 60000 : 2000);
      timer.unref();
    }
    return true;
  }
  function refreshOnce() {
    if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
    return refreshing;
  }
  parentPort.on("message", async ({ id, action, input }) => {
    if (action === "close") {
      stopping = true;
      clearTimeout(timer);
      child?.kill();
      try { await refreshing; } catch { /* Preserve last committed report. */ }
      store.close();
      parentPort.close();
      return;
    }
    try {
      const result = action === "refresh" ? await refreshOnce() : store.query(input);
      parentPort.postMessage({ id, result });
    } catch { parentPort.postMessage({ id, error: true }); }
  });
}

module.exports = { createUsageHistoryStore, createUsageHistoryWorker, historyRange, dayKey, identityRefs, ownerResolver,
  prepareCollectorRoot };
