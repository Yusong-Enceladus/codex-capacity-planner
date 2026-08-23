# Capacity baselines

Codex Capacity Planner normalizes work into API-equivalent USD. This is a
comparison unit, not an OpenAI account balance or a promise of fixed included
usage.

## Dated community priors

| Plan label | Center | Range | As of | Confidence |
| --- | ---: | ---: | --- | --- |
| 5x (`Plus` / `Pro Lite`) | $637.50/week | $500–$800 | 2026-07-23 | low |
| 20x (`Pro`) | $3,000/week | $2,400–$3,600 | 2026-07-23 | low |

Evidence:

- The 5x center comes from a community measurement using more than twenty
  paired quota/API-equivalent observations and regression. The author measured
  about $675 and later $600 per weekly window:
  <https://www.reddit.com/r/codex/comments/1v4ds6g/>
- The 20x center is supported only by lower-quality community reports around
  $3,000 per week and $12,000–$14,000 per month, so its interval is wider:
  <https://www.reddit.com/r/codex/comments/1tblcrx/>

The pricing basis follows the public OpenAI rate card and the same input,
cached-input and output formula documented by ccusage:

- <https://chatgpt.com/codex/pricing/>
- <https://help.openai.com/en/articles/20001415-chatgpt-rate-card>
- <https://github.com/ccusage/ccusage/blob/main/docs/guide/codex/index.md>

## Local takeover

For a valid local segment:

```text
full capacity = API-equivalent cost / quota-percent decrease
```

The first five accepted local samples blend with the community prior. At six
accepted samples the robust local median takes over. Samples crossing a reset,
plan change, stale observation, ambiguous account assignment or an excessively
small/large quota change are rejected.

## Change detection

The monitor compares a current account with its earlier same-plan samples, the
dated community range, and other locally observed same-plan accounts. The UI
reports effective-capacity differences only. It never claims that a provider
intentionally targeted or penalized an account.

No personal sample is uploaded. Updating the bundled community priors requires
a reviewable source change in this repository.
