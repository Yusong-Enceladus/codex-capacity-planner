"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const { createUsageHistoryStore, createUsageHistoryWorker, historyRange, dayKey, ownerResolver, identityRefs } = require("./codex-reset-usage-history.js");
const { estimateCost, normalizeModel } = require("./codex-reset-usage-pricing.js");
const { createServer } = require("./codex-reset-monitor.js");

const nowMs = Date.parse("2026-08-30T18:00:00Z");
const accounts = [
  { id: "account-a", historyAccountKey: "codex:v1:provider-account:tenant-a" },
  { id: "account-b", historyAccountKey: "codex:v1:provider-account:tenant-b" },
];
const event = (index, at, account, extra = {}) => ({
  eventIndex: index, timestampUnixMs: Date.parse(at), model: "gpt-5.6-sol", pricingMode: "standard",
  input: 100, cached: 40, output: 10, reasoning: 5, ...(account ? { account_id: account } : {}), ...extra,
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-history-test-"));
  const costDatabase = path.join(directory, "source.sqlite");
  const historyDatabase = path.join(directory, "history.sqlite");
  const source = new DatabaseSync(costDatabase);
  source.exec(`CREATE TABLE files (id INTEGER PRIMARY KEY, path TEXT, session_id TEXT,
    updated_at_ms INTEGER, parsed_bytes INTEGER, size INTEGER, coverage_since_day TEXT);
    CREATE TABLE usage_rows(file_id INTEGER, row_index INTEGER, payload BLOB);
    CREATE TABLE scan_metadata(id INTEGER PRIMARY KEY,payload BLOB);`);
  const metadata = (extra = {}) => source.prepare("INSERT OR REPLACE INTO scan_metadata VALUES (1,?)").run(JSON.stringify({
    timeZoneIdentifier: "UTC", catchUpPending: false, scanSinceDay: "2026-01-01", scanUntilDay: "2026-08-30",
    lastScanUnixMs: nowMs, completedFiles: 20, totalFiles: 20, ...extra,
  }));
  metadata();
  const file = (id, rows, meta = {}, session = `session-${id}`) => {
    const filePath = path.join(directory, `rollout-${id}.jsonl`);
    fs.writeFileSync(filePath, JSON.stringify({ type: "session_meta", payload: {
      id: session, cwd: path.join(directory, "ExampleProject"), base_instructions: "INSTRUCTION_NOT_EXPORTED", ...meta,
    } }) + "\n");
    source.prepare("INSERT OR REPLACE INTO files VALUES (?,?,?,?,?,?,?)")
      .run(id, filePath, session, nowMs + id, 100 + rows.length, 100 + rows.length, "2026-01-01");
    replaceRows(id, rows);
  };
  function replaceRows(id, rows) {
    source.prepare("DELETE FROM usage_rows WHERE file_id=?").run(id);
    rows.forEach((row, index) => source.prepare("INSERT INTO usage_rows VALUES (?,?,?)").run(id, index, Buffer.from(JSON.stringify(row))));
    source.prepare("UPDATE files SET updated_at_ms=updated_at_ms+1 WHERE id=?").run(id);
  }
  const store = createUsageHistoryStore({ costDatabase, historyDatabase });
  t.after(() => { store.close(); source.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, source, store, file, replaceRows, metadata, costDatabase, historyDatabase,
    read: (extra = {}) => store.query({ days: 7, timeZone: "Asia/Shanghai", accounts, nowMs, ...extra }) };
}

test("calendar ranges include today, cross years, and use real UTC+8/PT day boundaries", () => {
  assert.equal(historyRange(1, "Asia/Shanghai", nowMs).start, "2026-08-31");
  const full = historyRange(365, "America/Los_Angeles", nowMs);
  assert.equal(full.dates.length, 365);
  assert.equal(new Set(full.dates).size, 365);
  assert.equal(full.end, "2026-08-30");
  assert.equal(dayKey(Date.parse("2026-08-30T06:59:00Z"), "Asia/Shanghai"), "2026-08-30");
  assert.equal(dayKey(Date.parse("2026-08-30T06:59:00Z"), "America/Los_Angeles"), "2026-08-29");
  assert.equal(dayKey(Date.parse("2026-11-01T08:30:00Z"), "America/Los_Angeles"), "2026-11-01");
  assert.equal(dayKey(Date.parse("2026-11-01T09:30:00Z"), "America/Los_Angeles"), "2026-11-01");
  assert.equal(dayKey(Date.parse("2026-01-01T07:59:00Z"), "America/Los_Angeles"), "2025-12-31");
  for (const days of [0, -1, 366, 7.5, NaN]) assert.throws(() => historyRange(days, "Asia/Shanghai"));
  assert.throws(() => historyRange(30, "Etc/Unknown"));
});

test("pinned CodexBar pricing preserves cached subsets, Fast, long context, free preview and unknown prices", () => {
  const base = { model: "gpt-5.6-sol", input: 100, cached: 40, output: 10 };
  assert.ok(Math.abs(estimateCost(base) - 0.00062) < 1e-12);
  assert.equal(estimateCost({ ...base, pricingMode: "priority" }), estimateCost(base) * 2);
  const long = { ...base, input: 300000, output: 0, cached: 0 };
  assert.equal(estimateCost(long), 3);
  assert.equal(estimateCost({ ...long, pricingMode: "priority" }), 3);
  assert.equal(estimateCost({ ...base, input: 10, cached: 999, output: 0 }), 0.000005);
  assert.equal(estimateCost({ ...base, model: "not-priced" }), null);
  assert.equal(estimateCost({ ...base, model: "gpt-5.3-codex-spark" }), 0);
  assert.equal(estimateCost({ ...base, knownCostNanos: 1230000000 }), 1.23);
  assert.equal(normalizeModel("openai/gpt-5.6"), "gpt-5.6-sol");
  assert.equal(normalizeModel("gpt-5.5-2026-08-01"), "gpt-5.5");
});

test("explicit ownership is unique and never inferred from current account or mismatched identities", () => {
  const resolve = ownerResolver(accounts);
  assert.equal(resolve(identityRefs("tenant-a")), "account-a");
  assert.equal(resolve(identityRefs("codex:workspace:tenant-b:email:demo@example.invalid")), "account-b");
  assert.equal(resolve([]), null);
  assert.equal(resolve([...identityRefs("tenant-a"), ...identityRefs("tenant-b")]), null);
  assert.equal(ownerResolver([...accounts, { id: "duplicate", historyAccountKey: accounts[0].historyAccountKey }])(identityRefs("tenant-a")), null);
});

test("end-to-end ledger import isolates two accounts and unassigned rows, with correct localized totals", (t) => {
  const f = fixture(t);
  f.file(1, [event(1, "2026-08-30T06:59:00Z", "tenant-a"), event(2, "2026-08-30T07:01:00Z", "tenant-b")]);
  f.file(2, [event(1, "2026-08-29T09:00:00Z", null, { model: "unpriced-model" })]);
  f.store.ingest(nowMs);
  const zh = f.read();
  const en = f.read({ timeZone: "America/Los_Angeles" });
  assert.deepEqual(zh.accounts.map((account) => account.totalTokens), [110, 110]);
  assert.equal(zh.unassigned.totalTokens, 110);
  assert.equal(zh.unassigned.estimatedCostUSD, null);
  assert.equal(zh.unassigned.unpricedEvents, 1);
  assert.equal(zh.accounts[0].days.find((day) => day.date === "2026-08-30").totalTokens, 110);
  assert.equal(en.accounts[0].days.find((day) => day.date === "2026-08-29").totalTokens, 110);
  assert.equal(en.accounts[1].days.find((day) => day.date === "2026-08-30").totalTokens, 110);
  assert.equal(zh.accounts[0].days.find((day) => day.date === "2026-08-28").known, false);
  assert.equal(zh.unassigned.days.find((day) => day.date === "2026-08-28").known, true);
  const serialized = JSON.stringify(zh);
  for (const forbidden of [f.directory, "INSTRUCTION_NOT_EXPORTED", "tenant-a", "session-1", "owner_refs", "base_instructions"]) {
    assert.equal(serialized.includes(forbidden), false, forbidden);
  }
  assert.equal(zh.accounts[0].projects[0].label, "ExampleProject");
  assert.equal(zh.accounts[0].sessions.length, 1);
  assert.equal(zh.accounts[0].days.find((day) => day.eventCount).models[0].cachedTokens, 40);
});

test("session metadata can establish explicit ownership but instructions and current-login guesses cannot", (t) => {
  const f = fixture(t);
  f.file(1, [event(1, "2026-08-29T09:00:00Z")], { account_id: "tenant-a" });
  f.file(2, [event(1, "2026-08-29T10:00:00Z")], { base_instructions: "account_id: tenant-b" });
  f.store.ingest(nowMs);
  const first = f.read();
  assert.equal(first.accounts[0].totalTokens, 110);
  assert.equal(first.accounts[1].totalTokens, 0);
  assert.equal(first.unassigned.totalTokens, 110);
  const changedLogin = f.read({ accounts: accounts.map((account) => ({ ...account, active: account.id === "account-b", usedPercent: 0 })) });
  assert.deepEqual(changedLogin.accounts.map((account) => account.totalTokens), [110, 0]);
  assert.equal(changedLogin.unassigned.totalTokens, 110);
  const newAlias = f.read({ accounts: [{ id: "new-ui-id", historyAccountKey: accounts[0].historyAccountKey }] });
  assert.equal(newAlias.accounts[0].totalTokens, 110);
  assert.equal(newAlias.unassigned.totalTokens, 110);
});

test("idempotent imports, rewritten slices and moved session copies do not duplicate consumption", (t) => {
  const f = fixture(t);
  const rows = [event(1, "2026-08-29T00:00:00Z", "tenant-a"), event(2, "2026-08-29T12:00:00Z", "tenant-a")];
  f.file(1, rows);
  f.store.ingest(nowMs);
  f.store.ingest(nowMs);
  assert.equal(f.read().accounts[0].totalTokens, 220);
  f.replaceRows(1, [rows[1]]);
  f.store.ingest(nowMs);
  assert.equal(f.read().accounts[0].totalTokens, 110);
  f.file(2, [rows[1]], {}, "session-1");
  f.store.ingest(nowMs);
  assert.equal(f.read().accounts[0].totalTokens, 110);
});

test("retention survives a narrower upstream window, source eviction, reopen and quota reset", (t) => {
  const f = fixture(t);
  const old = event(1, "2026-07-15T12:00:00Z", "tenant-a");
  const recent = event(2, "2026-08-29T12:00:00Z", "tenant-a");
  f.file(1, [old, recent]);
  f.store.ingest(nowMs);
  f.replaceRows(1, [recent]);
  f.source.prepare("UPDATE files SET coverage_since_day='2026-08-29'").run();
  f.metadata({ scanSinceDay: "2026-08-29" });
  f.store.ingest(nowMs);
  assert.equal(f.read({ days: 90 }).accounts[0].totalTokens, 220);
  f.source.exec("DELETE FROM usage_rows; DELETE FROM files");
  f.store.ingest(nowMs);
  const reopened = createUsageHistoryStore({ costDatabase: f.costDatabase, historyDatabase: f.historyDatabase });
  try {
    const value = reopened.query({ days: 90, timeZone: "Asia/Shanghai", nowMs,
      accounts: accounts.map((account) => ({ ...account, usedPercent: 0, resetGeneration: 2 })) });
    assert.equal(value.accounts[0].totalTokens, 220);
  } finally { reopened.close(); }
});

test("known zero, unknown coverage, unpriced records and missing timestamps remain distinct", (t) => {
  const f = fixture(t);
  f.file(1, [event(1, "2026-08-29T12:00:00Z", "tenant-a", { input: 0, cached: 0, output: 0 })]);
  f.store.ingest(nowMs);
  let result = f.read();
  const zero = result.accounts[0].days.find((day) => day.date === "2026-08-28");
  assert.equal(zero.known, true);
  assert.equal(zero.estimatedCostUSD, 0);
  f.metadata({ catchUpPending: true, completedFiles: 1 });
  f.replaceRows(1, [{ day: "2026-08-29", input: 100, output: 10 }]);
  f.store.ingest(nowMs);
  result = f.read();
  assert.equal(result.accounts[0].days.find((day) => day.date === "2026-08-28").known, false);
  assert.equal(result.accounts[0].coverage, "unavailable");
  assert.equal(result.skippedEvents, 1);
  assert.equal(result.sourceComplete, false);
});

test("unknown model cost is a visible subtotal, not zero, and reasoning/cache tokens are not double counted", (t) => {
  const f = fixture(t);
  f.file(1, [event(1, "2026-08-29T12:00:00Z", "tenant-a"),
    event(2, "2026-08-29T13:00:00Z", "tenant-a", { model: "unknown-model", cached: 400, reasoning: 1000 })]);
  f.store.ingest(nowMs);
  const account = f.read().accounts[0];
  assert.equal(account.totalTokens, 220);
  assert.equal(account.cachedTokens, 140);
  assert.equal(account.reasoningTokens, 15);
  assert.equal(account.unpricedEvents, 1);
  assert.equal(account.estimatedCostUSD, estimateCost(event(1, "2026-08-29T12:00:00Z", "tenant-a")));
});

test("read-only seed and isolated partial backfill preserve history without altering the live cost stream", (t) => {
  const f = fixture(t);
  f.file(1, [event(1, "2026-08-29T09:00:00Z", "tenant-a"), event(2, "2026-08-29T12:00:00Z", "tenant-a")]);
  const primary = path.join(f.directory, "isolated-source.sqlite");
  const store = createUsageHistoryStore({ costDatabase: primary, seedDatabase: f.costDatabase,
    historyDatabase: path.join(f.directory, "isolated-history.sqlite") });
  try {
    store.ingest(nowMs);
    assert.equal(store.query({ days: 7, timeZone: "Asia/Shanghai", accounts, nowMs }).accounts[0].totalTokens, 220);
    f.source.prepare("VACUUM INTO ?").run(primary);
    const partial = new DatabaseSync(primary);
    try {
      partial.exec("DELETE FROM usage_rows WHERE row_index=1; UPDATE files SET parsed_bytes=50,updated_at_ms=updated_at_ms+1");
      store.ingest(nowMs);
      assert.equal(store.query({ days: 7, timeZone: "Asia/Shanghai", accounts, nowMs }).accounts[0].totalTokens, 220);
      assert.equal(f.source.prepare("SELECT COUNT(*) AS n FROM usage_rows").get().n, 2);
      partial.exec("UPDATE files SET size=50,updated_at_ms=updated_at_ms+1");
      store.ingest(nowMs);
      assert.equal(store.query({ days: 7, timeZone: "Asia/Shanghai", accounts, nowMs }).accounts[0].totalTokens, 110);
      assert.equal(f.source.prepare("SELECT COUNT(*) AS n FROM usage_rows").get().n, 2);
    } finally { partial.close(); }
  } finally { store.close(); }
});

test("background worker and read-only API serve history, validate ranges, and keep errors generic", async (t) => {
  const f = fixture(t);
  f.file(1, [event(1, "2026-08-29T12:00:00Z", "tenant-a")]);
  const worker = createUsageHistoryWorker({ costDatabase: f.costDatabase, historyDatabase: f.historyDatabase, nowMs });
  t.after(() => worker.close());
  await worker.refresh();
  const service = { usageHistory: (days, timeZone) => worker.query({ days, timeZone, accounts, nowMs }) };
  const server = createServer(service);
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const request = (url) => new Promise((resolve, reject) => {
    http.get({ hostname: "127.0.0.1", port: server.address().port, path: url,
      headers: { host: "127.0.0.1:18765" } }, (response) => {
      let body = "";
      response.on("data", (data) => { body += data; });
      response.on("end", () => resolve({ status: response.statusCode, body: JSON.parse(body) }));
    }).on("error", reject);
  });
  const valid = await request("/api/usage-history?days=30&tz=America%2FLos_Angeles");
  assert.equal(valid.status, 200);
  assert.equal(valid.body.timeZone, "America/Los_Angeles");
  assert.equal(valid.body.accounts[0].totalTokens, 110);
  assert.equal((await request("/api/usage-history?days=999")).status, 400);
  assert.equal((await request("/api/usage-history?tz=arbitrary")).status, 400);
  worker.close();
  const unavailable = await request("/api/usage-history?days=7");
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body, { error: "usage_history_unavailable" });
});
