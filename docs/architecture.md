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

## Reset-credit planning

A reset credit is a finite-lived capacity option, not an isolated countdown.
The decision simulates every account on one time-ordered capacity chain and
compares the real work served by redeeming with the work served by holding
through at least one post-redemption weekly cycle. A candidate is ineligible
until every account's existing capacity is exhausted, and it is invalid when a
non-credit refresh would arrive within the following 24 hours. Natural and
verified forced refreshes, probabilistic reset risk, expected real work,
expiry, and the new weekly boundary created by redemption are all processed by
the same simulator.

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
trend, and any real reset signal. Percentages, probabilities, token totals, and
formulas live in the usage/target, suggested-work, and calculation groups.
Each account row carries its own current usage, target, and optional natural
forecast range; account forecasts are never shared. An unresolved explicit
announcement, commitment, or candidate hint is the primary reset state ahead
of natural refresh. Its concise source summary appears with the state, while
the full source and resolved local outcome remain in official updates and
reset history respectively.

Temporal reset state is also exposed as structured timeline data. Position on
the axis carries time and order; an interval plus a dashed connector and hollow
node carries inference; familiar symbols, fill state, and visible text badges
carry lifecycle. Color is only a redundant semantic accent, never the sole
distinction, and red remains reserved for actual errors or urgent failures.
Natural refreshes, unresolved public signals, reset-credit events, and locally
confirmed refreshes share the same axis around an explicit “now” marker. Full
source text, links, evidence, and exact timestamps remain available through
progressive disclosure, so the visualization never replaces facts.

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
