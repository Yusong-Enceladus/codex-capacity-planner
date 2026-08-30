# Privacy and data flow

Codex Capacity Planner is local-first. Personal account and work data is used to produce a
decision on the user's Mac; it is not an analytics payload.

## Local inputs

Depending on the installed connector, the monitor may read:

- quota percentages, quota-window duration, and reset time;
- plan and a stable, minimized account identity;
- reset-credit count and lifecycle metadata;
- local aggregate token and model counters, including a rolling 24-hour token
  delta used only as mainline load evidence;
- bounded task metadata used for local mainline inference and correction:
  title, project basename, timestamps, pin state, Goal state, and a bounded
  first-message/preview excerpt. Excerpts are normalized in memory into topic
  terms and are neither retained in planner state nor returned by the local API;
- local mainline corrections, stored as opaque target IDs plus their display
  label and status.
- normalized local usage events (time, model, mode, input/cache/output counts)
  for daily history. The history importer reads only whitelisted fields from
  a bounded first session-metadata line and the local task index. Full paths
  become opaque project keys plus basenames; instruction bodies are discarded.

The planner does not retain response text, source code, tool output, full
project paths, authentication tokens, or browser cookies. The bundled
CodexBar cost collector scans local rollout usage events to normalize token
counters; it does not send transcripts anywhere. History collection never
reads credentials, invokes a quota probe, or infers past ownership from a
current login.

## External requests

The optional signal service receives ordinary HTTP metadata plus locale and
time zone. It must not receive account identifiers, quota values, reset times,
session metadata, project data, or recommendations.

The bundled cost collector may refresh a public model-price catalog when it
encounters unknown pricing. That request contains no local usage records or
account identifiers. The history chart labels its own bundled-price estimates
explicitly; it does not treat them as billed charges.

Push subscription setup sends the browser-created push endpoint and language
to the signal service. The local monitor retains only a one-way digest of the
endpoint. The local capability token never leaves loopback.

## Local API

The monitor binds to `127.0.0.1` by default. Public state omits credentials,
raw samples, reset-credit IDs, thread IDs, full paths, prompts, responses, and
conversation content. Workspace keys, raw topic excerpts, action-target maps,
and per-event token ledgers also remain private; loopback receives only
basenames, bounded summaries, opaque action IDs, and corrections required to
render or reverse the local controls. Mutating mainline actions require the
loopback origin and a process-local capability token; the native app refuses to
send that token to a non-loopback URL.
Native-notification observability contains only the last
attempt/success/failure times, a coarse trigger reason, status, and error kind;
notification titles and bodies are not retained. Loopback callers receive only
fields needed to render the UI.

`GET /api/usage-history?days=30&tz=Asia/Shanghai` returns bounded-day aggregates,
model totals, project basenames and bounded task labels. Supported time zones
are Asia/Shanghai and America/Los_Angeles; ranges are integers from 1 to 365.
Per-event records and hashed identity evidence remain in the private SQLite
ledger, never in this response or any request to a public service.

## Retention and deletion

The monitor retains up to 1,024 local decision observations and 96 reset
receipts per account. Decision observations contain minimized public evidence,
masked account labels and local aliases, quota/target numbers, calculation
components, and before/after public-input comparisons. They contain no task
transcripts, credentials, or raw reset-credit identifiers and never leave
loopback. An upgrade starts observing rather than inventing past predictions.
See [Inspectable decisions](decision-history.md) for sampling and display rules.

Runtime state is stored under the user's local configuration directory with
restrictive permissions. Removing that directory deletes Codex Capacity Planner's own
history and predictions; it does not delete source Codex records.

The standalone app stores canonical daily-history aggregates in `usage-history.sqlite`
inside its CodexReset Application Support directory, with private permissions.
Retention includes at most 367 days (365 display days plus time-zone boundary
slack). Neither a quota reset nor source-cache pruning deletes retained usage.
The bundled collector uses its own `usage-collector` cache in the same support
directory. An existing CodexBar cache is a read-only seed, never overwritten.
Version 2 imports native reconciled reports rather than summing raw event rows.
Its private intermediate export contains only local source identifiers, labels,
token counts, prices and progress, never transcript bodies. The earlier derived
tables remain recoverable but are not displayed. Public price-catalog requests
contain no account information or usage records. UTC+8 and Pacific caches are
isolated so switching display language cannot invalidate the other calendar.
Deleting this database and its SQLite sidecars clears the planner's imported
usage history; original Codex logs and the collector's cache remain separate.

## Issue reports

Use synthetic fixtures. Never attach `auth.json`, cookies, local databases,
raw provider JSON, decision-history records, or screenshots showing real email addresses, reset-credit
IDs, quota history, or private task names.
