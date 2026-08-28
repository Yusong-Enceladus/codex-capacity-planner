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

It does not read response text, source code, tool output, full project paths,
authentication tokens, or browser cookies. It does not scan rollout
transcripts.

## External requests

The optional signal service receives ordinary HTTP metadata plus locale and
time zone. It must not receive account identifiers, quota values, reset times,
session metadata, project data, or recommendations.

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

## Retention and deletion

Runtime state is stored under the user's local configuration directory with
restrictive permissions. Removing that directory deletes Codex Capacity Planner's own
history and predictions; it does not delete source Codex records.

## Issue reports

Use synthetic fixtures. Never attach `auth.json`, cookies, local databases,
raw provider JSON, or screenshots showing real email addresses, reset-credit
IDs, quota history, or private task names.
