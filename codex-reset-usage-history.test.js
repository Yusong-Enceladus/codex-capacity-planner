"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { DatabaseSync } = require("node:sqlite");
const { createUsageHistoryStore, createUsageHistoryWorker, prepareCollectorRoot,
  historyRange, dayKey, ownerResolver, identityRefs, historyRefreshZones } = require("./codex-reset-usage-history.js");
const { createServer } = require("./codex-reset-monitor.js");

const nowMs = Date.parse("2026-08-30T18:00:00Z");
const zones = ["Asia/Shanghai", "America/Los_Angeles"];
const accounts = [
  { id: "account-a", historyAccountKey: "codex:v1:provider-account:tenant-a" },
  { id: "account-b", historyAccountKey: "codex:v1:provider-account:tenant-b" },
];
const row = (extra = {}) => ({ date: "2026-08-29", model: "gpt-5.6-sol", mode: "standard",
  inputTokens: 100, cachedTokens: 40, outputTokens: 10, totalTokens: 110,
  estimatedCostUSD: 0.000456, eventCount: 1, ...extra });
const source = (id, rows, account = "tenant-a", extra = {}) => ({
  id, sessionID: id, complete: true, rows, account_id: account, ...extra,
});
const snapshot = (sources, extra = {}) => ({
  version: 2, timeZone: zones[0], startDay: "2026-01-01", endDay: "2026-08-31",
  scannedAt: new Date(nowMs).toISOString(), complete: true, completedFiles: 20, totalFiles: 20,
  processedBytes: 1000, totalBytes: 1000, sources, ...extra,
});

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "codex-usage-history-test-"));
  const historyDatabase = path.join(directory, "history.sqlite");
  const store = createUsageHistoryStore({ historyDatabase });
  t.after(() => { store.close(); fs.rmSync(directory, { recursive: true, force: true }); });
  return { directory, historyDatabase, store,
    ingest: (sources, extra) => store.ingest(snapshot(sources, extra), nowMs),
    read: (extra = {}) => store.query({ days: 7, timeZone: zones[0], accounts, nowMs, ...extra }) };
}

test("calendar ranges include today and use real UTC+8 and Pacific DST boundaries", () => {
  assert.equal(historyRange(1, zones[0], nowMs).start, "2026-08-31");
  const full = historyRange(365, zones[1], nowMs);
  assert.equal(full.dates.length, 365);
  assert.equal(new Set(full.dates).size, 365);
  assert.equal(full.end, "2026-08-30");
  assert.equal(dayKey(Date.parse("2026-08-30T06:59:00Z"), zones[0]), "2026-08-30");
  assert.equal(dayKey(Date.parse("2026-08-30T06:59:00Z"), zones[1]), "2026-08-29");
  for (const at of ["2026-11-01T08:30:00Z", "2026-11-01T09:30:00Z"]) {
    assert.equal(dayKey(Date.parse(at), zones[1]), "2026-11-01");
  }
  assert.equal(dayKey(Date.parse("2026-01-01T07:59:00Z"), zones[1]), "2025-12-31");
  for (const days of [0, -1, 366, 7.5, NaN]) assert.throws(() => historyRange(days, zones[0]));
  assert.throws(() => historyRange(30, "Etc/Unknown"));
});

test("ownership is unique and never inferred from the current account or email-only guesses", () => {
  const resolve = ownerResolver(accounts);
  assert.equal(resolve(identityRefs("tenant-a")), "account-a");
  assert.equal(resolve(identityRefs("tenant-unknown")), null);
  assert.equal(resolve([...identityRefs("tenant-a"), ...identityRefs("tenant-b")]), null);
  assert.equal(resolve(identityRefs("codex:workspace:tenant-a:email:other@example.test")), "account-a");
  const ambiguous = ownerResolver([accounts[0], { ...accounts[0], id: "another-ui-id" }]);
  assert.equal(ambiguous(identityRefs("tenant-a")), null);
});

test("canonical totals and native prices pass through without raw-prefix sums or repricing", (t) => {
  const f = fixture(t);
  f.ingest([source("parent", [row()]), source("child", [row({ mode: "fast", estimatedCostUSD: 0.000912 })]),
    source("unowned", [row({ model: "unknown-model", mode: "unknown", estimatedCostUSD: null })], null)]);
  const value = f.read();
  assert.equal(value.version, 2);
  assert.equal(value.pricingSource, "codexbar-report");
  assert.equal(value.accounts[0].totalTokens, 220);
  assert.equal(value.accounts[0].cachedTokens, 80);
  assert.ok(Math.abs(value.accounts[0].estimatedCostUSD - 0.001368) < 1e-12);
  assert.equal(value.unassigned.totalTokens, 110);
  assert.equal(value.unassigned.estimatedCostUSD, null);
  assert.equal(value.unassigned.unpricedEvents, 1);
  const changedLogin = f.read({ accounts: accounts.map((account) => ({ ...account, active: account.id === "account-b" })) });
  assert.deepEqual(changedLogin.accounts.map((account) => account.totalTokens), [220, 0]);
  assert.equal(f.read({ accounts: [{ ...accounts[0], id: "new-ui-id" }] }).accounts[0].totalTokens, 220);
});

test("each time-zone report owns its day boundaries instead of rebucketing aggregate dates", (t) => {
  const f = fixture(t);
  f.ingest([source("cross-midnight", [row({ date: "2026-08-30" })])]);
  f.ingest([source("cross-midnight", [row()])], { timeZone: zones[1], endDay: "2026-08-30" });
  for (const [timeZone, date] of [[zones[0], "2026-08-30"], [zones[1], "2026-08-29"]]) {
    const value = f.read({ timeZone });
    assert.equal(value.accounts[0].totalTokens, 110);
    assert.deepEqual(value.accounts[0].days.filter((day) => day.eventCount).map((day) => day.date), [date]);
  }
});

test("only bounded session metadata supplies ownership; private content stays out of the API", (t) => {
  const f = fixture(t);
  const file = path.join(f.directory, "session.jsonl");
  fs.writeFileSync(file, JSON.stringify({ type: "session_meta", payload: {
    account_id: "tenant-b", cwd: "/private/example/project", base_instructions: "INSTRUCTIONS_NOT_EXPORTED",
  } }) + '\n{"message":"TRANSCRIPT_NOT_EXPORTED"}\n');
  f.ingest([source("metadata-session", [row()], null, { path: file })]);
  const value = f.read();
  assert.equal(value.accounts[1].totalTokens, 110);
  assert.equal(value.accounts[1].projects[0].label, "project");
  for (const secret of ["tenant-b", file, "/private/example", "INSTRUCTIONS_NOT_EXPORTED", "TRANSCRIPT_NOT_EXPORTED"]) {
    assert.equal(JSON.stringify(value).includes(secret), false);
  }
});

test("imports replace corrected slices, deduplicate moved sessions and keep unknown modes", (t) => {
  const f = fixture(t);
  const original = source("session", [row(), row({ mode: "fast" })]);
  f.ingest([original]);
  f.ingest([original]);
  assert.equal(f.read().accounts[0].totalTokens, 220);
  f.ingest([source("session", [row({ mode: "unknown", estimatedCostUSD: null })]), { ...original, complete: false }]);
  const value = f.read().accounts[0];
  assert.equal(value.totalTokens, 110);
  assert.equal(value.days.find((day) => day.date === "2026-08-29").models[0].mode, "unknown");
  assert.equal(value.estimatedCostUSD, null);
});

test("a partial re-index cannot replace a complete retained tail", (t) => {
  const f = fixture(t);
  f.ingest([source("session", [row(), row({ date: "2026-08-28" })])]);
  f.ingest([source("session", [row()], "tenant-a", { complete: false })], { complete: false, completedFiles: 1 });
  assert.equal(f.read().accounts[0].totalTokens, 220);
  assert.equal(f.read().sourceComplete, false);
  assert.equal(f.read().completedFiles, 1);
  f.ingest([source("session", [row()])]);
  assert.equal(f.read().accounts[0].totalTokens, 110);
});

test("session shards stay distinct while moved and atomically replaced logs retain one history", (t) => {
  const f = fixture(t);
  const firstPath = path.join(f.directory, "first.jsonl");
  const movedPath = path.join(f.directory, "archive", "first.jsonl");
  const first = source("file-inode-1", [row({ date: "2026-07-15" }), row()], "tenant-a", { path: firstPath, sessionID: "shared" });
  const second = source("file-inode-2", [row()], "tenant-a", { sessionID: "shared" });
  f.ingest([first, second]);
  assert.equal(f.read({ days: 90 }).accounts[0].totalTokens, 330);
  f.ingest([{ ...first, path: movedPath }, second]);
  assert.equal(f.read({ days: 90 }).accounts[0].totalTokens, 330);
  f.ingest([{ ...first, id: "file-inode-3", path: movedPath, rows: [row()] }, second], { startDay: "2026-08-29" });
  assert.equal(f.read({ days: 90 }).accounts[0].totalTokens, 330);
});

test("invalid snapshots roll back atomically without losing confirmed data", (t) => {
  const f = fixture(t);
  f.ingest([source("session", [row()])]);
  for (const invalid of [row({ totalTokens: -1 }), row({ date: "2027-01-01" }), row({ mode: "invented" })]) {
    assert.throws(() => f.ingest([source("session", [invalid])]), /invalid_history_row/);
    assert.equal(f.read().accounts[0].totalTokens, 110);
  }
  assert.throws(() => f.ingest([source("session", [row()], "tenant-a", { complete: "yes" })]));
  assert.throws(() => f.store.ingest(snapshot([], { version: 1 })), /invalid_history_snapshot/);
});

test("v1 raw-ledger overcounts are never a fallback and remain recoverable during correction", (t) => {
  const f = fixture(t);
  const old = new DatabaseSync(f.historyDatabase);
  old.exec("CREATE TABLE events (total INTEGER); INSERT INTO events VALUES (2753332990)");
  old.close();
  assert.equal(f.read().collectorStatus, "correcting");
  assert.equal(f.read().accounts[0].coverage, "unavailable");
  assert.equal(f.read().accounts[0].totalTokens, 0);
  f.ingest([source("corrected-history", [row({ inputTokens: 904944683, cachedTokens: 0, totalTokens: 904944693 })])]);
  assert.equal(f.read().accounts[0].totalTokens, 904944693);
  const preserved = new DatabaseSync(f.historyDatabase, { readOnly: true });
  assert.equal(preserved.prepare("SELECT total FROM events").get().total, 2753332990);
  preserved.close();
});

test("retention survives narrower reports, source eviction, reopening and quota reset", (t) => {
  const f = fixture(t);
  f.ingest([source("session", [row({ date: "2026-07-15" }), row()])]);
  f.ingest([source("session", [row()])], { startDay: "2026-08-29" });
  assert.equal(f.read({ days: 90 }).accounts[0].totalTokens, 220);
  f.ingest([]);
  const reopened = createUsageHistoryStore({ historyDatabase: f.historyDatabase });
  try {
    const value = reopened.query({ days: 90, timeZone: zones[0], nowMs,
      accounts: accounts.map((account) => ({ ...account, usedPercent: 0, resetGeneration: 2 })) });
    assert.equal(value.accounts[0].totalTokens, 220);
  } finally { reopened.close(); }
});

test("a lagging calendar backfills June and July into a ninety-day view and reports byte progress", (t) => {
  const f = fixture(t);
  for (const timeZone of zones) {
    f.ingest([source("recent", [row()])], {timeZone, complete:false, processedBytes:20, totalBytes:100});
    const partial = f.read({days:90,timeZone});
    assert.equal(partial.processedBytes,20);
    assert.equal(partial.totalBytes,100);
    assert.equal(partial.accounts[0].days.find(day=>day.date==="2026-07-15").known,false);
    f.ingest([source("june", [row({date:"2026-06-15"})]), source("july", [row({date:"2026-07-15"})])],
      {timeZone, complete:true, processedBytes:100, totalBytes:100});
    const complete = f.read({days:90,timeZone});
    assert.equal(complete.accounts[0].totalTokens,330);
    assert.deepEqual(complete.accounts[0].days.filter(day=>day.eventCount).map(day=>day.date),
      ["2026-06-15","2026-07-15","2026-08-29"]);
    assert.equal(complete.sourceComplete,true);
  }
});

test("catch-up prioritizes the lagging calendar and skips completed calendars until a regular refresh", () => {
  const states = {[zones[0]]:{complete:false,processedBytes:20,totalBytes:100},
    [zones[1]]:{complete:true,processedBytes:100,totalBytes:100}};
  assert.deepEqual(historyRefreshZones(states,true),[zones[0]]);
  assert.deepEqual(historyRefreshZones(states,false),zones);
  states[zones[1]].complete=false;
  assert.deepEqual(historyRefreshZones(states,true),zones);
  states[zones[0]].complete=true;
  states[zones[1]].complete=true;
  assert.deepEqual(historyRefreshZones(states,true),[]);
  assert.equal(historyRefreshZones(states,false).length,2);
});

test("automatic catch-up actually resumes old dates without rescanning a completed calendar", async (t) => {
  const f = fixture(t);
  const cli = path.join(f.directory,"collector");
  fs.writeFileSync(cli, `#!/usr/bin/env node\nconst fs=require('node:fs');
const args=process.argv.slice(2), zone=args[args.indexOf('--history-time-zone')+1], out=args[args.indexOf('--history-output')+1];
const countFile=out+'.calls';let count=fs.existsSync(countFile)?Number(fs.readFileSync(countFile)):0;count++;fs.writeFileSync(countFile,String(count));
const complete=zone==='America/Los_Angeles'||count>1;
fs.writeFileSync(out,JSON.stringify({...${JSON.stringify(snapshot([]))},timeZone:zone,complete,
processedBytes:complete?100:20,totalBytes:100,sources:[${JSON.stringify(source("june",[row({date:"2026-06-15"})]))}]}));\n`, {mode:0o700});
  const worker = createUsageHistoryWorker({historyDatabase:f.historyDatabase,cacheRoot:path.join(f.directory,"cache"),cli,nowMs});
  t.after(()=>worker.close());
  await worker.refresh();
  const deadline=Date.now()+12000;
  let value;
  do {
    value=await worker.query({days:90,timeZone:zones[0],accounts,nowMs});
    if(value.sourceComplete)break;
    await new Promise(resolve=>setTimeout(resolve,100));
  } while(Date.now()<deadline);
  assert.equal(value.sourceComplete,true);
  assert.equal(value.accounts[0].days.find(day=>day.date==='2026-06-15').totalTokens,110);
  const calls = path.join(f.directory,"cache","reports-v2","pacific","planner-history.json.calls");
  assert.equal(Number(fs.readFileSync(calls)),1);
});

test("known zero, incomplete coverage, unassigned usage and unknown prices remain different", (t) => {
  const f = fixture(t);
  f.ingest([]);
  assert.equal(f.read().accounts[0].days.find((day) => day.date === "2026-08-28").estimatedCostUSD, 0);
  f.ingest([], { complete: false });
  assert.equal(f.read().accounts[0].coverage, "unavailable");
  f.ingest([source("unowned", [row({ estimatedCostUSD: null })], null)]);
  const missing = f.read().accounts[0].days.find((day) => day.date === "2026-08-28");
  assert.equal(missing.known, false);
  assert.equal(missing.estimatedCostUSD, null);
  f.ingest([source("owned", [row(), row({ model: "unpriced", estimatedCostUSD: null })])]);
  assert.equal(f.read().accounts[0].totalTokens, 220);
  assert.equal(f.read().accounts[0].estimatedCostUSD, row().estimatedCostUSD);
  assert.equal(f.read().accounts[0].unpricedEvents, 1);
});

test("source backup includes WAL data, isolates calendars and never modifies CodexBar", async (t) => {
  const f = fixture(t);
  const referenceRoot = path.join(f.directory, "codexbar");
  fs.mkdirSync(path.join(referenceRoot, "cost-usage"), { recursive: true });
  fs.mkdirSync(path.join(referenceRoot, "model-pricing"));
  fs.writeFileSync(path.join(referenceRoot, "model-pricing", "models-dev-v1.json"), '{"publicPricing":true}');
  const seedDatabase = path.join(referenceRoot, "cost-usage", "cost-usage.sqlite");
  const seed = new DatabaseSync(seedDatabase);
  seed.exec("PRAGMA journal_mode=WAL; CREATE TABLE scan_metadata(id INTEGER PRIMARY KEY,payload TEXT); CREATE TABLE marker(value INTEGER)");
  seed.prepare("INSERT INTO scan_metadata VALUES (1,?)").run(JSON.stringify({ timeZoneIdentifier: zones[1] }));
  seed.exec("INSERT INTO marker VALUES (42)");
  const options = { cacheRoot: path.join(f.directory, "collector"), seedDatabase };
  try {
    const pt = await prepareCollectorRoot(options, zones[1]);
    const copy = new DatabaseSync(path.join(pt, "cost-usage", "cost-usage.sqlite"));
    assert.equal(copy.prepare("SELECT value FROM marker").get().value, 42);
    copy.exec("UPDATE marker SET value=7");
    copy.close();
    assert.equal(seed.prepare("SELECT value FROM marker").get().value, 42);
    assert.equal(fs.existsSync(path.join(pt, "model-pricing", "models-dev-v1.json")), true);
    const cn = await prepareCollectorRoot(options, zones[0]);
    assert.notEqual(cn, pt);
    assert.equal(fs.existsSync(path.join(cn, "cost-usage", "cost-usage.sqlite")), false);
    assert.equal((fs.statSync(pt).mode & 0o777), 0o700);
  } finally { seed.close(); }
});

test("an incompatible optional seed does not block a standalone collector", async (t) => {
  const f = fixture(t);
  const seedDatabase = path.join(f.directory, "incompatible.sqlite");
  fs.writeFileSync(seedDatabase, "not a database");
  const root = await prepareCollectorRoot({ cacheRoot: path.join(f.directory, "collector"), seedDatabase }, zones[0]);
  assert.equal(fs.existsSync(path.join(root, "cost-usage", "cost-usage.sqlite")), false);
});

test("background worker and read-only API serve canonical history with bounded ranges and generic errors", async (t) => {
  const f = fixture(t);
  const reportFiles = Object.fromEntries(zones.map((timeZone, index) => {
    const file = path.join(f.directory, `report-${index}.json`);
    fs.writeFileSync(file, JSON.stringify(snapshot([source("session", [row()])], { timeZone })));
    return [timeZone, file];
  }));
  const worker = createUsageHistoryWorker({ historyDatabase: f.historyDatabase, reportFiles, nowMs });
  t.after(() => worker.close());
  await worker.refresh();
  const server = createServer({ usageHistory: (days, timeZone) => worker.query({ days, timeZone, accounts, nowMs }) });
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
  assert.equal(valid.body.timeZone, zones[1]);
  assert.equal(valid.body.accounts[0].totalTokens, 110);
  assert.equal((await request("/api/usage-history?days=999")).status, 400);
  assert.equal((await request("/api/usage-history?tz=arbitrary")).status, 400);
  worker.close();
  const unavailable = await request("/api/usage-history?days=7");
  assert.equal(unavailable.status, 503);
  assert.deepEqual(unavailable.body, { error: "usage_history_unavailable" });
});
