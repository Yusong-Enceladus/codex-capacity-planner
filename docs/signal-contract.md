# Public reset-signal contract

The hosted signal service is optional context, not the authority for personal
account state. The client remains useful with local quota and natural reset
data when the service is unavailable.

## Forecast

`GET /api/forecast?locale=<locale>&tz=<iana-time-zone>` returns:

```json
{
  "probabilities": {
    "rounded_24h": 30,
    "rounded_48h": 50,
    "commitment_floor_percent": null
  },
  "model": { "version": "rate-v3", "base_daily_rate": 0.301 },
  "confidence": "medium",
  "mode": "model",
  "updated_at": "2026-08-12T08:58:00Z",
  "last_reset_at": "2026-08-11T00:27:44Z",
  "time_window": { "start_hour": 7, "end_hour": 10, "timezone": "Asia/Singapore" },
  "official_signal": null
}
```

Probabilities are cumulative. A client must not invent confidence, extend the
48-hour curve, or turn a text hint into a numeric probability.

A structured candidate may still change the work plan without changing that
probability. The reference client reserves 10% of the quota that would remain
after the ordinary forecast adjustment and schedules that bounded amount
earlier. It exposes this as a separate candidate reserve, never as forecast
probability, and a candidate alone cannot drive a non-terminal target to 100%.

## Feed

`GET /api/feed?locale=<locale>` returns an event list and an optional active
signal. A verified explicit event includes a stable event ID, original public
URL, announcement time, source, summary, localized summary, lifecycle state,
and an optional official window.

```json
{
  "events": [
    {
      "id": "2000000000000000001",
      "type": "reset",
      "summary": "Synthetic reset announcement",
      "localized_summary": "合成的重置公告",
      "url": "https://example.invalid/status/2000000000000000001",
      "announced_at": "2026-08-13T01:01:37Z",
      "official_window": {
        "label": "within an hour",
        "start_at": "2026-08-13T01:01:37Z",
        "end_at": "2026-08-13T02:01:37Z"
      },
      "announcement_state": "announced",
      "reset_verification_status": "pending",
      "source": "atom"
    }
  ],
  "signal": null
}
```

Production clients accept explicit announcements only when the event ID and
original URL agree and the source is one of the trusted feed, API, or verified
push paths. If the service returns a verified Tibo event whose type/group and
text explicitly promise a reset but its lifecycle field is delayed or
inconsistent, clients may promote that event locally; a mere hint may never be
promoted this way. Authoritative replies count as announcements, and a later
reply may refine the deadline of the same public promise. A public announcement
and personal delivery are separate states.

Clients reconcile all representations of one public ID before planning. Signal
strength (`candidate`, commitment, explicit), temporal phase (future,
in-progress, completed, terminal), and per-account delivery are separate axes.
A completed confirmation may be paired with the latest unique unattributed
local forced-reset episode by monotonic cycle generation and event ordering;
this association must not depend on a fixed look-back duration. A structured
future window prevents that backward association. Rejected or failed evidence
is terminal, while local quota reconstruction remains authoritative when a
public feed exposes conflicting pending/completed fields.

An immediate 100% policy requires an explicit future/in-progress event and a
pending delivery state for that account. Accounts already marked landed use
their ordinary natural/forecast trajectory even if peers are still pending.
Once every tracked account is landed, the public event becomes immutable
history and the same ID cannot re-enter through another feed representation.

If the public text contains an approximate time with an explicit timezone, the
client preserves the original phrase and converts its stated center to one
canonical display instant. That same instant drives the target trajectory,
countdown, capacity-at-risk calculation, capacity chain, and notification; the
original range remains internal risk context rather than a second conflicting
deadline. “Within” windows retain their stated end as the deadline. If no time
is stated, the client omits the time row and does not manufacture a deadline.
Each rendered public message keeps its own source link immediately adjacent;
links from multiple posts are never pooled into an unlabeled footer.

Signal strength and lifecycle are independent. Unknown objects do not default
to hints: a hint requires `kind: candidate|hint`, `signal_type` for a supported
candidate, or `announcement_state: hinted`. As a bounded compatibility path
for delayed signal materialization, a retained Tibo corpus post may qualify
only when it is a top-level post (`conversation_id == id`), the classifier lane
is `reset_related`, and `explicit_reset_claim` is false. Replies never qualify
through this fallback because their meaning depends on the parent post.
Completed, rejected, expired, landed, unchanged, and otherwise terminal facts
remain history and cannot become an active hint.

## Privacy

Requests contain no personal quota, email, account ID, reset-credit inventory,
refresh time, task metadata, or model output. Service implementations must not
require those fields.

## Self-hosting and replacement

The base URL should remain replaceable by configuration. A compatible service
may return only forecast/feed data; personal attribution and all decisions stay
inside the local monitor. Tests must use synthetic responses and no live
network.
