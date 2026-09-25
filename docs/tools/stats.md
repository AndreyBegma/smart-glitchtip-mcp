# Toolset `stats`

Off by default (`GLITCHTIP_TOOLSETS` must name `stats` explicitly). Read-only: GlitchTip
exposes no mutation here, so this toolset has no write tools — `GLITCHTIP_READ_ONLY` makes
no difference to what it lists.

The tool accepts `format`: `text` (default, compact) or `json` (the same projected fields as
JSON — never fenced, see below). The result is bounded by `MCP_RESPONSE_BUDGET`. The tool
carries `openWorldHint: true`. Nothing here is untrusted data (numbers and timestamps only,
nothing an application submitted), so unlike every other toolset in this phase, the tool
description carries no untrusted-data sentence and its `json` output is not fenced.

Scope is `org:read`, `org:write` or `org:admin` (`@has_permission` in `apps/stats/api.py`) —
organization-level, not `event:*` like the performance and logs toolsets.

| Tool | GlitchTip endpoint | readOnly | destructive | idempotent |
|---|---|---|---|---|
| `get_organization_stats` | `GET /api/0/organizations/{org}/stats_v2/` | yes | no | yes |

## `get_organization_stats`

Number of error events or transactions an organization received over time, per hour or per
day.

| Input | Type | Default |
|---|---|---|
| `organization` | slug | the default organization |
| `category` | `"error"` \| `"transaction"` | required |
| `start` / `end` | ISO 8601 date-time with a timezone, or `now` / `now-<n>m\|h\|d` | required |
| `project_ids` | number[], 1–50, no duplicates, never `-1` | none |
| `bucket` | `"hour"` \| `"day"` | `hour` when the range is 48h or less, else `day` |
| `format` | `"text"` \| `"json"` | `text` |

`start`/`end` are resolved to an absolute ISO instant locally before any request, the same
as the performance and logs toolsets, even though `stats_v2` itself does not understand the
relative forms — so all three toolsets behave the same way for the same input. The range
must not exceed 41 days (checked locally; upstream allows 1000 hourly intervals, and this
tool always requests hourly ones — see below).

The tool **always sends `interval=1h` and `field=sum(quantity)`**, whatever `bucket` is, and
rolls the hourly series up to days locally when `bucket: "day"`. This is deliberate: upstream
joins each generated interval against hourly statistics with a fixed one-hour window, so
`interval=1d` would count only each day's first hour, and `interval=1m` would repeat every
hour's total across 60 minutes. `field` only names which column the series sums; it is not
exposed as an input.

Output: total, the peak bucket, and one line per bucket. A `null` sum (see below) renders as
`0`.

404 → "No projects matched in `<org>`: the organization does not exist for this token, has no
projects, or none of `project_ids` belongs to it." `project_ids` never contains `-1`
(Sentry's "all") — rejected locally, since here it matches nothing.

### The response shape (read from source, not the OpenAPI snapshot)

`stats_v2` has no schema in `docs/reference/glitchtip-openapi.json` — its own description
calls it a "reverse engineered endpoint". Read directly from GlitchTip's source
(`apps/stats/api.py`, `stats_v2`), the real shape is:

```json
{
  "intervals": ["2026-01-01T00:00:00+00:00", "2026-01-01T01:00:00+00:00", "…"],
  "groups": [
    { "series": { "sum(quantity)": [12, 0, "…", null] } }
  ]
}
```

One group and one series, since this tool always sends exactly one `field`. `intervals` is
rendered in **the server's local timezone** (Python's `astimezone()`), whatever that is
configured to; this tool renders every interval as received and does not convert it.

### The gap, and how this tool closes it

`intervals` is **not guaranteed to cover every hour of the requested range**. The endpoint's
SQL is, in essence:

```sql
SELECT gs.ts, sum(event_stat.count)
FROM generate_series(start, end, '1 hour') gs (ts)
LEFT JOIN <hourly-stats-table> event_stat
  ON event_stat.date >= gs.ts AND event_stat.date < gs.ts + interval '1 hour'
WHERE event_stat.project_id = ANY(project_ids) OR event_stat IS NULL
GROUP BY gs.ts ORDER BY gs.ts
```

For an hour where matching rows exist **only for other projects on the instance** (not
`project_ids`), every joined row for that hour is filtered out by the `WHERE` clause, the
`event_stat IS NULL` branch never applies (a match did exist, just not for the right
project), and the whole `GROUP BY` bucket for that hour disappears from the result — not as
a zero, but as a **missing entry in `intervals`**.

This tool reconstructs the full hourly grid locally from the request's own `start`/`end`
(mirroring the same `+1 hour` boundary adjustment the endpoint itself applies to `end`
before truncating to the hour) and fills any hour missing from the response with `0`, which
is the correct count for the requested `project_ids`. A synthesized hour's timestamp borrows
the UTC offset of a neighbouring returned interval (falling back to `Z` if the response
returned no intervals at all), since the server renders every interval in one fixed local
timezone for the whole response.

## Risks

- **The gap above** is upstream's, not this server's; the reconstruction is this server's
  fix for it, not a report of what GlitchTip itself returned.
- Whether the server's local timezone can change between requests (deployment
  reconfiguration) is not something this tool detects; a borrowed offset assumes it hasn't,
  within one request.
