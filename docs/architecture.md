# Architecture

Codex Capacity Planner has one decision engine and two presentation surfaces. The macOS
app and CodexBar integration must render the same snapshot; they may differ in
density, never in conclusions.

```text
Codex/CodexBar local facts ─┐
Local usage history ───────┼─> local monitor ─> decision snapshot ─┬─> macOS app
Local task metadata ───────┤                                      └─> CodexBar
Public reset signals ──────┘
```

## Components

- `codex-reset.js`: pure normalization, attribution, capacity trajectory, and
  presentation snapshot logic used by the CodexBar provider.
- `codex-reset-monitor.js`: loopback service, durable state machine, local
  notification coordination, source polling, and `/api/snapshot` endpoint.
- `codex-reset-history.js`: local immutable observations and controlled
  public-input comparisons of the existing planner, with no separate policy.
- `codex-reset-behavior.js`: longer-horizon personal usage forecast.
- `codex-reset-short-load.js`: independent one-hour load forecast.
- `CodexResetApp/`: native macOS menu-bar presentation and monitor supervisor.
- `patches/codexbar/`: the reviewable integration commit applied to the pinned
  CodexBar upstream source by `scripts/bootstrap-codexbar.sh`.
- `CodexBar-upstream/`: generated local fork workspace required by the current
  CodexBar integration. It is ignored by the main repository and is not a
  second decision engine.

## Decision boundaries

The engine keeps facts, inferences, and actions distinct:

1. Facts: current account, quota windows, reset-credit inventory, plan, local
   task activity, and public source events.
2. Inferences: reset cause, future natural usage, capacity gaps, and confidence.
3. Actions: work action, credit action, and (only for multiple accounts)
   account action.

The home card always represents the currently active account. Other-account
capacity can influence a recommendation but is never added to the current
account's displayed reset-credit count or quota percentage.

## Reset attribution

Evidence is applied in this order:

1. A matching reset credit disappears while the full window rebuilds:
   banked-reset redemption.
2. The paid plan actually increases and the quota window rebuilds: plan
   upgrade refresh.
3. The prior quota window reaches its established boundary and rebuilds:
   natural refresh.
4. A full window rebuilds early without credit consumption or plan increase:
   forced refresh.

Same-tier restoration before the old cooldown ends is not a plan upgrade and
does not create a refresh. A monthly renewal date is not a weekly quota-reset
boundary.

Each account also owns a monotonic quota-cycle generation. A proven window
rebuild advances that generation, and global-manual advances observed in one
collection pass form a local reset episode. Public posts are reconciled with
those episodes by event order, reset cause, structured future windows, and
per-account generation—not by a fixed number of minutes between the post and
the observation. A delayed confirmation can therefore attach to the latest
unique unattributed episode even when the reset arrived before the post.

Signal strength, temporal direction, and personal delivery are independent.
Only an explicit future or in-progress event that is still pending for a given
account can create an immediate 100% policy for that account. A landed account
returns to its normal cycle even while another tracked account remains pending.
Local quota facts outrank inconsistent public lifecycle fields.

The hosted forecast owns public Watch interpretation; local logic does not
re-score its wording. Alert-v3 tier, score, alert identity, and target-kind
metadata are retained. Raw feed records cannot promote the same current Watch
into an immediate announcement. Notification identity is separate from quota
delivery identity. Global settlement timestamps never consume a different
future promise, including one published during staggered account delivery of
an earlier reset. Only exact event receipts/tombstones close it locally.

A source deadline stays a deadline point, not an inferred start/end range.
Its score is a planning weight kept separate from cadence probabilities. Dated
commitments also enter the credit planner's reset/no-reset boundary scenarios;
deferral is checked against each credit's own expiry. Undated commitments do
not fabricate a deadline or turn 83 into a 24h probability, and cannot impose
an unbounded automatic credit deferral without timing evidence.

## Reset-credit planning

The received-evidence → interpretation → per-account-plan → delivery chain is
inspectable through a bounded local decision history. Before/after public-input
comparisons fix time, account data, work forecasts, and pre-update trajectory
anchors. Historical results are not recomputed after upgrades. See
[`decision-history.md`](decision-history.md) for scope, schema, and retention.

A reset credit is a finite-lived capacity option, not an isolated countdown.
The decision simulates every account on one time-ordered capacity chain and
compares the real work served by redeeming with the work served by holding
through at least one post-redemption weekly cycle. Immediate redemption is
ineligible until every tracked account has fresh, exact usage and every
account's existing capacity is exhausted.

A possible-reset signal is not assigned a made-up probability. The planner
evaluates deterministic branches in which a free reset lands at the inferred
window boundaries and a branch in which it does not land. If the credit safely
outlives that window, every redemption node inside the window is deferred. A
future free reset blocks a redemption when the observed work rate cannot use
the minimum high-value portion of the restored capacity before that reset;
this decision boundary is derived from capacity and demand rather than a fixed
number of hours. Natural and verified forced refreshes, probabilistic reset
risk, expected real work, expiry, and the new weekly boundary created by
redemption are all processed by the same simulator.

The planner must form a high-value redemption node before expiry by arranging
existing valuable work. It must not wait until the final moment, manufacture
busywork, or treat expiry as successful planning.

`workAction`, `accountAction`, and `creditAction` are projections of one
`capacityPlan`. Presentation and notifications may explain that plan but may
not recompute an action with a separate formula.

## Logical mainline suggestions

The recommendation unit is a logical work mainline, not a session and not a
filesystem workspace. The monitor looks back across root Codex tasks, clusters
related work only within the same local workspace, and admits an inferred
mainline conservatively: it must have an ongoing Goal or repeated related
tasks with cross-day continuity and recent activity. A one-off task is omitted
even when it consumed many tokens. Archived, completed, and subagent tasks are
excluded.

Intent order and load evidence are deliberately separate. Explicit local
labels rank first, then an ongoing Goal, cross-day continuity, repeated related
tasks, and recency. Rolling 24-hour input-plus-output growth is retained only as
load/confidence evidence and never directly changes that order. The exact cost
ledger is preferred; bounded local counter samples preserve the same window
when the ledger is delayed. Session titles may appear in details only as
recovery and correction context, never as an automatic recommendation.

The user can locally mark a session as a mainline, mark a session or inferred
line as not a mainline, temporarily hide a line, mark it complete, or restore
automatic judgment. These corrections are durable, take precedence over
inference, and never leave the loopback service. The system abstains when
evidence is weak instead of filling the menu with low-confidence guesses.

The natural-use interval controls only a maximum visible count: five when its
upper bound is below target, three when it covers target, and one when its lower
bound or actual use has passed target. Fewer reliable mainlines are valid; the
remaining capacity is described as room for new valuable work.

## Presentation contract

The plan explanation begins with causal prose about cycle state, natural-use
trend, and any real reset signal. The root macOS menu keeps Suggested
Mainlines, Usage & Targets, Resets, Why This Plan, and Calculation & Data in
that order immediately above Refresh, Settings, and Quit; the title card is a
summary rather than a navigation gateway. Suggested Mainlines stays on this
primary interaction path so its reversible corrections remain low-cost. Every
mainline keeps its valid corrections in one horizontal button strip inside the
same content item; actions do not become separate vertical menu entries.
Corrections keep native menu tracking active. Saving, saved, and retry feedback
replace that strip at a fixed height while neighbouring rows stay usable and
stationary. Restoring automatic judgment uses the same local correction path.
Structural reranking waits until the next menu opening; an acknowledged edit
queues a fresh snapshot even if an older read is already in flight. Each
Usage & Targets account row carries its own current usage,
target, optional natural forecast range, API-equivalent capacity, expected
reset loss, and sampling provenance. Account forecasts are never shared.
Daily local history sits directly below each account's progress, not in a new
submenu. Shared range and unit controls drive a read-only, worker-backed
`/api/usage-history` query. Seven, 30 and 90 days are presets; the retained
preference supports 1–365 days. Totals, peak and selected-day details remain
visible, while model/project/task lists expand in place. Menus retain their
measured outer frame during interaction and scroll only when necessary.

The bundled CodexBar CLI normalizes local Codex cost events on a five-minute
background cadence, in an isolated collector cache. The old machine-wide
cache is read only as a seed: historical backfill must not enter the existing
row-ID stream used for live capacity calibration. A private SQLite import retains events independently of
quota resets and source-cache eviction, without copying the raw conversation.
Re-parsed source slices replace rather than append; moved/archived copies of
one session are deduplicated. Original event timestamps determine UTC+8 or
Pacific calendar days, including daylight-saving boundaries. Known price
subtotals and unknown-priced tokens remain distinguishable.

History ownership requires explicit account metadata matched against an
unambiguous provider account key. A current login, quota delta, workspace, or
session timestamp is not evidence for past ownership. The existing ambient
CodexBar cache is machine-wide, not per-account. Records without such evidence
stay under Unassigned local usage; fully missing account history has no fake
chart. Only a complete local scan can establish zero-use interior days, and
unknown ownership prevents inventing zero-use days for an individual account.
The history read path never changes reset probabilities or target policy.

Percentages, probabilities, model outputs, formulas, and diagnostics that do
not belong to an account row live under the independent first-level
Calculation & Data entry, divided into in-page Results, Method, and Raw Data
controls rather than deeper submenus. Why This
Plan therefore contains causal prose only. An unresolved explicit
announcement, commitment, or candidate hint is the primary reset state ahead
of natural refresh. Its concise source summary appears with the state, while
the full source and resolved local outcome remain in official updates and
reset history respectively.

The reset timeline can disclose a related handling record in place. Reset
History adds a selectable calendar above the detailed account records. A
public event is grouped once while its separate account receipts remain
visible. Probability and target history have separate plots in Calculation &
Data; source weights never share the probability axis. These views use stable
scroll viewports so inspection does not dismiss the native menu.

Temporal reset state is also exposed as structured timeline data. Position on
the axis carries time and order; an interval plus a dashed connector and hollow
node carries inference; familiar symbols, fill state, and visible text badges
carry lifecycle. Color is only a redundant semantic accent, never the sole
distinction, and red remains reserved for actual errors or urgent failures.
The reset submenu opens directly on this axis rather than hiding it behind a
second timeline submenu. Its compact root contains at most the active public
signal (or pending credit delivery), the next natural reset, and the latest
locally confirmed reset. Earlier events remain as text rows in Reset History;
status, interpretation, and full public posts remain in Official Updates.
Source actions live beside those full posts and use event-specific labels, not
as duplicated buttons beneath the timeline. Candidate intervals never produce
a countdown or an invented deadline. Chinese presentation uses Asia/Shanghai
(UTC+8), while English presentation uses America/Los_Angeles (PT). Timeline
kind/state fields, rather than server-composed Chinese labels, drive localized
titles, badges, symbols, and time formatting.

Available reset credits remain a second-level reset view, but are exposed as
structured presentation data rather than repeated prose rows. Every credit is
kept as an individual item with an owning account, grant time, and its own
expiry; account-level totals may not replace later expiries with the earliest
one. The native view combines a shared-axis remaining-validity timeline, a
strategy state, net capacity and API-equivalent value, a high-value window, and explicit
free-reset/no-free-reset outcomes. Internal credit identifiers are never part
of the presentation payload. The shared axis starts at the current time and
ends at the latest visible expiry; each credit ends at its own expiry position,
so more remaining time can never produce a shorter visual mark. Grant time is
retained as data but is not misrepresented as task completion progress.

The native app owns its loopback host and port as one internal endpoint shared
by the monitor supervisor and snapshot client. Release settings never expose or
persist that endpoint. The supervisor fingerprints the bundled monitor and
planner sources, reuses an identical runtime, and gracefully replaces only a
stale process whose command path identifies it as this app's bundled monitor;
an unrelated listener is never terminated. Settings contain only user choices—automatic refresh,
launch at login, and reversible mainline corrections. Semantic data colors are
kept consistent and adapt to system appearance; arbitrary per-color editing is
not a user preference.

## Real capacity and account scheduling

Plan labels and raw percentages are not comparable capacity units. Each known
5x/20x account starts with a dated, low-confidence community API-equivalent
prior. Valid local cost/quota segments progressively calibrate that prior; six
accepted samples switch the account to a robust personal estimate. See
[`capacity-baselines.md`](capacity-baselines.md) for the values and evidence.

The monitor also compares the current estimate with the account's earlier
same-plan samples, locally observed same-plan peers, and the community range.
It distinguishes an account-specific low effective capacity from a cohort-wide
metering shift, but never infers provider intent.

For multiple accounts, the scheduling quantity is:

```text
capacity at risk = adopted full API-equivalent capacity
                 × projected remaining percent at the next free reset
```

The next free reset is the earlier of the account's natural boundary and a
verified explicit forced-reset deadline. A usable current account is changed
only when another named account has a materially earlier, material capacity
loss. The recommendation carries the deadline, both loss values, capacity
source, and confidence. A blocked current account may still fall back directly
to any usable account.
