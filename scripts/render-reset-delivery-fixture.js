// Render the synthetic regression through the production decision engine.
// The resulting JSON is for --readme-demo with CODEX_RESET_DEMO_SNAPSHOT;
// this never reads account state, starts a collector or contacts a source.
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { createRuntime } = require("../codex-reset-monitor.js");
const { resetDeliveryFixture } = require("./fixtures/reset-delivery.js");

async function main() {
  const output = process.argv[2];
  if (!output) throw new Error("Usage: node scripts/render-reset-delivery-fixture.js /absolute/path/snapshot.json");
  if (!path.isAbsolute(output)) throw new Error("Snapshot output must be an absolute path");
  let provider;
  const context = vm.createContext({ defineProvider(value) { provider = value; } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, "../codex-reset.js"), "utf8"), context);
  const fixture = resetDeliveryFixture();
  const clock = Date.now;
  try {
    Date.now = () => fixture.now;
    const runtime = createRuntime({
      provider,
      buildModel: vm.runInContext("codexResetBuildModel", context),
      pickUsage: vm.runInContext("codexResetPickWeeklyUsage", context),
      pickUsages: vm.runInContext("codexResetWeeklyUsages", context),
    }, fixture.state);
    runtime.recordHistory("usage");
    fs.writeFileSync(output, JSON.stringify(await runtime.uiSnapshot(), null, 2), { mode: 0o600 });
    process.stdout.write("Anonymous production snapshot written.\n");
  } finally { Date.now = clock; }
}

main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = 1; });
