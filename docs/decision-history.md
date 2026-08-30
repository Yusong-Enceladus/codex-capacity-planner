# Inspectable decisions

## Acceptance scope

P0: connect received public evidence, the adopted interpretation, per-account
plans, and observed delivery without changing the existing planning policy.
Record why an update changes or does not change a plan. Keep cadence
probabilities, signal weights, and usage targets separate. A receipt for event
A must never consume a different promise B.

P1: inspect the handling inline on the existing reset timeline; show causal
prose in Why This Plan; offer Results, Method, and Raw Data as in-page controls
inside Calculation & Data; add a selectable calendar and detailed rows inside
Reset History. Preserve mainline corrections, account bars, individual credit
expiries, bilingual time zones, and the existing first-level navigation.

WillCodexReset is a product-design reference, not an integrated data provider.
No scraper, undocumented endpoint, subscription, or placeholder provider is
added. A second provider requires a suitable authorized interface and separate
agreement. Two services repeating the same public post would still represent
one piece of evidence, not independent votes or probabilities to average.

## Data path

1. The monitor receives its existing forecast/feed/Atom update or a local quota
   observation. Public post identity is checked against its canonical URL.
2. The existing normalization, event reconciliation, trajectory, and capacity
   planner run. They remain the only source of executable advice.
3. `codex-reset-history.js` projects a small record from that result. It does
   not classify prose, fetch data, redeem credits, or change a target.
4. The record is persisted in the existing atomic local state file, then
   exposed in the same loopback snapshot used by the native app and provider.

Each record contains the evaluation time, source calculation time and health,
cadence model/version, adopted numeric inputs, canonical public evidence,
first receipt time, interpretation, timing semantics, per-account cycle and
delivery identities, target and deadline, calculation components, actions,
and an optional controlled public-input comparison. Task text, credentials,
raw credit identifiers, and complete provider payloads are not stored here.
Public source summaries are bounded excerpts; Official Updates retains its
separate source-reading path. A history failure is visible but does not stop
planning.

## What “the message changed the plan” means

After a public response arrives, capture the pre-update public inputs and
trajectory anchors. Both comparison branches use the same evaluation time,
current quota observations, account identity, and local work forecast. Replace
only the public evidence and its reconciliation state. Project trajectories on
copies, using the existing `updateTargetTrajectory` and `buildModel`; no
hypothetical branch is installed as the live plan.

The before/after results retain both deadlines. A target with a different
deadline is never presented as a same-horizon percentage comparison. The
record also stores the actual live decision separately. Quota-only updates and
clock samples carry no attributed message effect. A repeated unchanged public
response creates neither a new event nor another notification.

This is inspection of evidence the monitor received. It does not claim to
discover every message an upstream service failed to supply, nor to establish
which external forecast is better calibrated.

## History and charts

- Recording starts with the first actual observation after installation or
  upgrade. Existing local reset receipts may appear in the calendar; missing
  past predictions are never reconstructed.
- Save semantic evidence/plan changes and meaningful quota movement. With no
  such change, save at most one clock sample per hour. Poll timestamps alone
  do not create revisions.
- Retain the latest 1,024 decision observations, with a discarded-record count
  and the original recording start. Retain up to 96 reset receipts per account.
  Calendar absence is described as missing records, not proof of no reset.
- Charts use observation time on the horizontal axis. Cadence probabilities
  and account targets have separate plots. Model changes, unavailable values,
  gaps longer than the existing 90-minute forecast-freshness interval, and new
  account cycles break their respective lines. A missing value is not zero.
- A promise's weight is printed separately, never plotted as a probability.
- Results group both plots in one readable panel with a shared observation
  cursor and one time axis. Body text is 13 points, chart labels 11 points,
  and primary values 17–20 points. Formulas and source metadata belong to
  Method and Raw Data. Live supplemental rows are explicitly separate from
  historical selection; the full saved JSON remains inspectable in place.
- Interactive menus are measured from their initial content before opening.
  Short content does not reserve a fixed-height panel; long content is capped
  by available display space after native navigation rows. During tracking,
  expansion scrolls inside the stable viewport rather than resizing the
  menu window. This follows AppKit's
  [custom menu view constraints](https://developer.apple.com/library/archive/documentation/Cocoa/Conceptual/MenuList/Articles/ViewsInMenuItems.html).
- Public event IDs group related account receipts, but each account's actual
  receipt time remains visible. Grant and expiry remain individual to a credit.
- Chinese uses Asia/Shanghai (UTC+8); English uses America/Los_Angeles (PT),
  including daylight-saving transitions. Times are stored as UTC instants.

## Validation

The synthetic end-to-end chain in `codex-reset.test.js` covers immutable
observations, same-post deduplication, probability/weight separation, old
receipt/new promise overlap, controlled comparisons, natural-first behavior,
untimed promises, source failure, restart, and the actual provider snapshot.
Swift tests cover decoding, date boundaries, distinct account receipts, plot
semantics, and existing navigation. Final interaction checks use the compiled
native macOS menu with explicitly anonymous fixtures, not a Preview window.
