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

## Reset-credit planning

A reset credit is a finite-lived capacity option, not an isolated countdown.
The decision compares redeeming and holding across candidate nodes through at
least one post-redemption weekly cycle. It includes other-account capacity,
natural or forced refreshes, expected real work, expiry, and the seven-day
schedule displacement caused by redemption.

The planner must form a high-value redemption node before expiry by arranging
existing valuable work. It must not wait until the final moment, manufacture
busywork, or treat expiry as successful planning.

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
