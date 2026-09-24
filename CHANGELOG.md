# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog; versions follow semver 0.x.

## [Unreleased]

## [0.3.0-next.1] - 2026-09-24

### Added

- Regression catalogue cases 07 to 12: IF branches swapped, Limit before the write node, date format changed, HTTP method changed, body field renamed, query parameter dropped.
- HTTP Request write nodes get an `X-FlowRetest-Node` header in the sandbox; the proxy records it and attribution prefers it over timing.
- Scanner rule S007: IF or Filter nodes with identical conditions.

- AI nodes (LLM chains, agents, extractors) are replayed from their recordings; their models, memory, tools and parsers are dropped in the sandbox. A changed prompt, model or sub-node yields a `stale-ai-replay` warning on the case; a new AI node without a recording is executed against the sink.
- Postgres and MySQL: `select` is replayed from the recording; writes are unsupported (the case is skipped with a clear note) instead of failing after a DNS timeout.
- `redact --report [run]` writes `report.redacted.json` with values replaced by type, length and hash; paths, counts and flags stay.
- Regression catalogue cases 13 to 15: replayed LLM chain with a changed prompt, Postgres select plus a new insert, HubSpot property empty after a field rename.
- Zod schemas for every file format (`@flowretest/schemas`), JSON Schema export to `docs/formaty`, config validation on load.
- README sections on privacy and licensing; integration notes for n8n-as-code and n8n-mcp.

### Fixed

- Query parameters now take part in the diff (`?name` paths); a dropped parameter shows as a changed call with `missing-field`.

## [0.2.0-next.1] - 2026-09-24

### Added

- `run --stabilize` runs both versions twice; `accept` requires a stable new version (or `--force`).
- `run --format terminal,json,junit,md` writes `junit.xml` and `plan.md` (pull request comment, 60 kB cap) next to `report.json`.
- `upgrade-check --engine-old --engine-new`: the same workflow on two n8n images in two sandboxes.
- `redact`: fixture copies with names, emails and phones replaced; identifiers, dates and numbers kept.
- GitHub Action (`action/action.yml`): init, pull, run, report artifact, in-place pull request comment.

### Fixed

- Sandbox bind mounts moved to a short path in the OS temp directory; Docker Desktop on Windows fails with EIO on host paths of about 180 characters or more.

## [0.1.0-next.1] - 2026-09-24

First internal preview after the ten-day feasibility spike (see `docs/spike/wyniki.md`).

### Added

- `init`: config and API key for a project, Docker check, `.gitignore` rules.
- `pull`: published workflow and recent executions as fixtures through the n8n public API.
- `scan`: support table, static findings (dangling references, `.item` behind Merge or Code, Proxy option, `process.env`, `localhost` URLs, toggles, credential and version changes) and a structural diff of two versions.
- `run`: sealed sandbox (internal Docker network, intercepting proxy with its own CA), replay of the recorded and the new version through `executeBatch --snapshot`, attribution of captured requests to node runs, normalisation, diff with flags, plan output, `report.json` and `plan.txt` per run, exit codes.
- `diff`: re-render a run, optionally against accepted baselines.
- `accept`: store the new version's calls as the baseline per case.
- `doctor`: Docker, images, sandbox seal test.
- Sink templates and credential stubs for HTTP Request, Slack, HubSpot, Google Sheets, Airtable, Notion, OpenAI; token rule for OAuth2 and service accounts.
- Regression catalogue with six cases, also used as the end-to-end test.

### Changes in n8n that shaped this version

- n8n 2.x requires and preserves the `id` of an imported workflow; `executeBatch --ids` keeps only ids containing a digit.
- CLI commands print through the logger; `--rawOutput` is read from JSON console logging.
- Errors raised before a workflow starts are only visible in the sandbox database.
