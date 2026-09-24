# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog; versions follow semver 0.x.

## [Unreleased]

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
