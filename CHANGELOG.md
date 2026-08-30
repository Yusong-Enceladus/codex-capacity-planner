# Codex Capacity Planner changelog

Notable user-visible changes are recorded here. The project follows semantic
versioning once the first public release is tagged.

## Unreleased

## 0.1.11 - 2026-08-30

- Correct historical usage using CodexBar's canonical reports. Copied fork
  prefixes no longer inflate token totals; API equivalents use its read-time
  price catalog, Fast/long-context rules and unknown-price safeguards, not a
  separate JavaScript price table. Optional Pi/OMP usage follows the same report.
- Replace v0.1.10 derived totals, not just new samples. Preserve accounts,
  mainline preferences and reset/decision history. The old derived ledger is
  retained for recovery but never shown as a fallback while correcting history.
- Continue bounded background indexing until complete, with visible progress,
  independent UTC+8/Pacific caches and a read-only online backup of an available
  CodexBar cache. The standalone app still needs no CodexBar installation.
- Use the same native segmented controls for Usage & Targets and Calculation
  & Data, including the account selector. Enlarge mainline text and actions to
  14/13/12-point typography while retaining one-line buttons, stable inline save
  feedback and consecutive actions without closing the menu.

## 0.1.10 - 2026-08-30

- Add daily history directly below each account's existing Usage & Targets
  progress bar. Shared 7/30/90-day controls default to 30 days, remember the
  choice, and support any 1–365-day range. Switch API-equivalent estimates and
  tokens without navigating away or closing the menu.
- Preserve period totals, peak days, hover/click selection, input/cache/output
  breakdowns, models, Fast mode, projects and tasks. Detailed lists start
  collapsed. Amounts are estimates, never quota percentages or actual charges.
- Reuse the bundled CodexBar local collector on a background worker; keep a
  private persistent ledger across resets and upstream cache eviction. Group
  actual event times by Chinese UTC+8 or English Pacific Time, including DST.
- Require explicit account evidence. Unattributed old records remain in a
  separate local-history chart; they are never copied under every account or
  assigned from the current login. Missing coverage and unpriced models remain
  visible rather than turning into invented zero usage or zero cost.
- Refresh the bilingual README gallery using the real native macOS menu and
  anonymous data, and ship the history collector with the standalone app.

## 0.1.9 - 2026-08-30

- Measure interactive menu content before opening, instead of reserving fixed
  420/470/540-point viewports. Short reset timelines and explanations no longer
  leave blank panels above navigation or below their last paragraph.
- Keep the measured outer frame stable during menu tracking; expanded details
  scroll inside it, and long content respects the display and native footer.
  Reserve scrollbar width during measurement so it cannot rewrap and clip text.
  Include the calendar's initially selected records before measuring its height.
- Reorganize Calculation & Data around a shared observation and account, two
  aligned plots, one time axis, readable 11-point chart labels and 13-point
  body text, and prominent values. Keep signal weight separate from probability.
- Put formulas, source details, full saved JSON and current-plan supplemental
  data in clearly labeled in-page sections. No information is removed and no
  new submenu depth is introduced. A changed deadline is never reduced to an
  ambiguous before/after percentage.

## 0.1.8 - 2026-08-30

- Record the local evidence → interpretation → account plan → delivery chain.
  Controlled comparisons fix time, account usage, work forecasts and trajectory
  anchors; elapsed time or quota growth is not blamed on a new message.
- Preserve historical observations across restarts without backfilling missing
  predictions. Repeated posts are deduplicated, source failures remain gaps,
  and cadence probabilities, promise weights and usage targets stay distinct.
- Inspect handling in place on the reset timeline. Add a calendar and complete
  per-account receipt rows to Reset History without counting a shared public
  event twice. Individual credit grants and expiries remain visible.
- Put Results, Method and Raw Data inside one Calculation & Data page. Add
  selectable probability/target history plots and the saved calculation inputs.
  Native controls stay open during inspection, using Chinese UTC+8 or English
  Pacific Time and retaining the existing mainline interactions.
- Keep WillCodexReset as a design reference only; no unauthorized data access,
  second-provider placeholder, notification subscription or policy replacement
  is introduced.

## 0.1.7 - 2026-08-30

- Keep a future public commitment active when it was published during staggered
  account delivery of an earlier reset. Settlement is event- and account-scoped;
  an older global timestamp cannot erase a different promise.
- Consume codex-reset.com Alert-v3 tiers, nested scores, alert IDs, and target
  semantics. Raw feed classifications no longer upgrade the same Watch to an
  immediate announcement. Keep public signal weights separate from cadence
  probabilities, and apply dated commitments to reset-credit risk scenarios.
- Show a source deadline as “by/before” in Chinese UTC+8 and English Pacific
  Time, without inventing an earliest reset time or an exact-arrival countdown.
  Untimed promises do not manufacture deadlines or 24-hour probabilities.
- Keep Suggested Mainlines open while applying corrections. The same compact
  action row shows saving, success, or retry feedback; other rows remain
  usable without moving, and saved corrections can restore automatic judgment
  in place. Closing and reopening the menu applies the newly ranked list.
- Queue a fresh snapshot after an acknowledged correction even when a previous
  refresh is still running. A temporary snapshot failure never misreports a
  durable correction as a failed save.
- Show consecutive corrections in the bilingual README gallery, captured from
  the real native macOS menu with anonymous data and the desktop backdrop.

## 0.1.6 - 2026-08-29

- Put each mainline's valid correction actions into one compact horizontal
  button row inside its content item, removing the separate menu line formerly
  consumed by every action.
- Add a drag-to-Applications DMG with a bilingual first-launch guide while
  retaining the ZIP and checksums. The release remains an explicitly disclosed
  Apple Silicon, ad-hoc-signed community build until Developer ID credentials
  are available.
- Put all first-level planner destinations directly in the root macOS menu
  above Refresh, Settings, and Quit. The order is Suggested Mainlines, Usage &
  Targets, Resets, Why This Plan, and Calculation & Data; the title card no
  longer hides navigation behind a disclosure arrow.
- Promote Calculation & Data out of Why This Plan so Results, Method, and Raw
  Data require one less navigation level, while Why This Plan remains a concise
  causal explanation.
- Replace elapsed reset-credit lifetime progress with one shared remaining-time
  axis. Every credit starts at Now and ends at its own expiry, so a later expiry
  always has a longer visual line.
- Remove the internal loopback URL from Settings and from release preferences.
  The app and bundled monitor now share an application-owned endpoint; Settings
  retains only refresh cadence, launch at login, and local mainline corrections.
  A content fingerprint lets a newly installed app replace a stale bundled
  monitor automatically instead of continuing to serve an older planner.
- Capture the bilingual README gallery from the actually running macOS
  menu-bar app with anonymous data and a desktop backdrop rather than from
  standalone SwiftUI preview surfaces.
- Promote Suggested Mainlines to the first-level menu without changing its
  5/3/1 selection or reversible correction actions. Rename the account view to
  Usage & Targets and retain per-account API-equivalent capacity, expected
  reset loss, and sampling provenance beside each progress bar.
- Replace the mixed planning-details pile with one Calculation & Data entry
  divided into Results, Method, and Raw Data.
- Replace verbose reset-credit rows with a native visual summary that keeps
  every credit's account and individual expiry, shows remaining validity,
  strategy state, net-capacity and API-equivalent value, the high-value window,
  and deterministic free-reset/no-free-reset outcomes.
- Let all home-card plan text wrap to its measured height instead of truncating
  dynamic values after one or two lines. Possible-reset summaries now use a
  compact complete date range that keeps the UTC+8 label visible.
- Refresh the bilingual README gallery with anonymous current-state captures
  of the home plan, per-account progress bars, the reset timeline, and the
  reset-credit hold decision.
- Make the reset timeline flow monotonically from past through “Now” to the
  future. An active possible-reset interval now renders with explicit start and
  end boundaries and contains the “Now” marker instead of appearing as a point
  above an unrelated date.
- Make reset-credit advice fail closed on stale account usage and evaluate a
  possible reset as deterministic “lands” and “does not land” branches without
  inventing a probability. Credits that outlive the possible-reset interval are
  held until that interval ends, while free-reset conflicts are derived from
  capacity and observed demand instead of a fixed 24-hour cutoff.
- Recommend logical work mainlines—not sessions or raw workspaces—using
  explicit local labels, ongoing Goals, related-task repetition, cross-day
  continuity, and recency. Rolling token growth remains load evidence and does
  not choose intent; one-off high-token sessions are omitted.
- Treat five/three/one as maximum reliable-mainline counts as the natural-use
  interval moves from below target, through target, to beyond target. Weak
  candidates are not used to fill the list.
- Add local reversible corrections for marking a mainline, rejecting one,
  temporarily hiding it, or completing it. The native menu performs actions
  through an authenticated loopback endpoint and Settings can restore automatic
  judgment.
- Lead plan details with a plain-language causal explanation, render an
  independent current/target/forecast bar for every visible account, and keep
  the highest-priority unresolved official reset signal ahead of natural
  refresh with a concise source summary.
- Reconcile public reset confirmations with monotonic local quota-cycle
  generations, so a delayed celebratory post cannot open a second pending
  reset after the accounts have already refreshed.
- Keep signal strength, temporal direction, and per-account delivery separate;
  only an explicit future/in-progress event that has not landed on that account
  may produce an immediate 100% target.
- Merge same-ID feed, signal, tweet, and forecast lifecycle evidence; retain a
  completed public confirmation in reset history while preventing terminal
  representations from re-entering the plan.
- Preserve partial delivery per account: landed accounts return to their normal
  cycle while pending accounts retain the explicit reset plan.
- Reject incomplete reset objects instead of silently downgrading them to
  candidate hints; admit only explicit candidate lifecycle fields or a
  top-level, reset-related corpus fallback, so retrospective replies cannot
  become future signals.
- Give a real possible-reset signal a separate bounded 10% capacity reserve without
  rewriting the hosted 24-hour probability or allowing a hint alone to target
  100% usage.
- Rebase a zeroed immediate/deadline trajectory when the signal is corrected
  to a continuous policy, automatically repairing previously poisoned plans.
- Keep possible-reset post IDs out of durable trajectory and behavior-notification
  identities while retaining their risk effect through the continuous hazard.
- Label possible-reset, commitment, and explicit source text separately and expose
  the possible-reset reserve in the target equation.

## 0.1.5 - 2026-08-23

- Replace the isolated reset-credit cycle-age heuristic with one capacity-chain
  simulation covering every account, real work demand, natural and verified
  forced refreshes, probabilistic reset risk, credit expiry, and the weekly
  boundary created by redemption.
- Make every coupon node wait until other-account capacity is exhausted and
  invalidate redemption when a non-credit refresh will arrive within 24 hours.
- Use the stated center of an approximate official time as the one canonical
  instant across the progress target, countdown, account loss, coupon planning,
  and notifications.
- Derive work, account, and credit actions from one capacity plan; replace the
  obsolete cycle-age value copy with incremental real-work value.
- Record only the status, time, and reason of the latest native-notification
  attempt so delivery can be inspected without retaining message content.
- Recover an unresolved explicit announcement once when an older Monitor saw
  it but never delivered a notification, with a private per-event dedupe set.
- Keep the target-dependent workspace set on the home card whenever work is
  still required, an account switch is recommended, or a credit node must be
  formed, without elevating a recent session into the recommendation.
- Advance the capacity simulation only at real state transitions so month-long
  credit horizons remain responsive without changing the decision result.

## 0.1.4 - 2026-08-23

- Seed 5x and 20x accounts with dated, cited community API-equivalent capacity
  ranges, blend early local observations, and switch to robust personal
  estimates after six accepted samples.
- Compare effective capacity with personal history, local same-plan peers, and
  the community range; distinguish account-specific anomalies from broader
  metering changes without claiming provider intent.
- Recommend an account switch only when a blocked account needs a fallback or
  a named account has material real capacity at risk at an earlier free reset;
  show the deadline and API-equivalent loss proof.
- Show up to five suggested tasks directly on the home card with their project
  and selection reason.
- Preserve approximate official reset phrases, use one converted deadline
  throughout planning, and place each source action beside its own post.
- Expand reset details with official timing, per-account delivery, planning
  impact, history, credits, and evidence.

## 0.1.3 - 2026-08-23

- Deliver one notification for a previously unseen explicit reset announcement
  discovered at Monitor startup when its deadline is still actionable.
- Publish future releases with the official GitHub CLI instead of a deprecated
  third-party release Action runtime.

## 0.1.2 - 2026-08-23

- Recognize an authenticated, explicit reset promise even when the hosted
  lifecycle field lags behind, and parse calendar deadlines from Tibo replies.
- Keep the current account unless it is blocked or learned API-equivalent
  capacity proves another account has materially more capacity at risk.
- Attribute a quota rebuild caused by a paid upgrade before considering the old
  natural-refresh boundary.
- Replace raw reset-credit identifiers with one-way local aliases and omit all
  identifiers from the loopback rendering API.
- Bundle Node.js in the Apple Silicon app and surface a clear startup error if
  the runtime or Monitor resources are missing.
- Include project, CodexBar, and Node.js license notices in binary releases.
- Harden source scanning, pin GitHub Actions, add CodeQL, and align repository
  security settings with the published security policy.
- Clarify that codex-reset.com is an independently operated third-party service.

## 0.1.1 - 2026-08-22

- Build the Swift package and release app on the macOS 26 runner required by
  the selected Swift toolchain.

## 0.1.0 - 2026-08-22

- Prepare the source tree for public development under the MIT License.
- Document the shared decision engine, reset attribution, privacy boundary,
  and public signal-service contract.
- Add a local-only planning fallback when the optional signal service is
  unavailable.
- Remove machine-specific paths, migration metadata, build artifacts, and
  internal explanatory UI copy from the public source boundary.
