# Codex Capacity Planner changelog

Notable user-visible changes are recorded here. The project follows semantic
versioning once the first public release is tagged.

## Unreleased

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
