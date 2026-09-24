# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog; versions follow semver 0.x.

## [Unreleased]

### Added

- Stubs: `run --stub "<node>=<file>"` (repeatable) and `.flowretest/<workflow>/stubs.yml` answer a node with the items in a JSON or YAML file instead of running or replaying it: a database write, a read the recording never took, a recording over 1 MB. The case runs instead of being skipped, gets a `stub:` warning, and `coverage.stubbed` lists the nodes. `upgrade-check` takes `--stub` too; `scan` and the skip message point at it.
- Every `run` checks the seal of its sandbox before executing anything (internal network, proxy on that network only, no direct connection out) and stops with exit code 4 if a check fails. The checks are in `report.json` under `sandbox`; the plan footer says "sandbox sealed (checked before the run)" only when they passed.

### Fixed

- Errors that escape a command exit with 4 (usage or environment) or 5 (internal) instead of 1, which means DIFF; the GitHub Action no longer reports a crashed run as DIFF with a green job.
- A case skipped for an unsupported node on its path makes the run BLOCKED (exit code 3) instead of PASS.
- The npm package is publishable: the workspace packages are bundled into `dist/bin.js` with esbuild, `private` is gone, `bin` is `dist/bin.js`, `proxy.lock.json` ships with the package, `engines` is `>=22.12` (commander 15).
- `doctor` defaults to the proxy image from `proxy.lock.json` instead of `flowretest-proxy:dev`.
- The diff compares the concrete URL path (`@path`): a call to another record id is a change. Generated segments (uuids, timestamps) are still placeholders.
- Bodies over the proxy's storage limit are compared by size and hash instead of passing as equal; a body in an encoding the proxy cannot decode keeps its raw bytes.
- A changed media type (`@contentType`), repeated query or form keys (`?tag[1]`) and integers beyond 2^53 are no longer invisible.
- Placeholders no longer swallow real values: a bare date stays a value, and a 10 or 13 digit number is `<epoch>` only under a time-like key or near the request time (Telegram `chat_id` and numeric CRM ids are compared).
- Volatile fields found by `--stabilize` are scoped to one call key (`<key> :: <path>`), cover query parameters and the path, and handle keys containing dots. Baselines are re-hashed on load.
- HTTP Request v1 and v2 keep the verb in `requestMethod`; a POST there is a write, not a replayed read.
- A left-out resource or operation of an app node means the n8n default of that node version (Postgres and MySQL insert, Google Sheets read, Airtable get, HubSpot v1 deal) instead of the first table entry. Role tables cover the operations of n8n 2.40.5 (Slack `user.info`, `lookupByEmail`, Notion v3 markdown and data sources, HubSpot forms, Airtable v1).
- Vector store nodes in insert or update mode are unsupported (case skipped) instead of silently replayed.
- `diff --against baseline` reports a case without a baseline as ERROR.
- `{{seq}}` in proxy rules counts calls per endpoint (method, host, path) and per version instead of one counter shared by both versions, so the n-th call to an endpoint gets the same id in the old and the new version; one response renders one value.
- The `X-FlowRetest-Node` header percent-encodes the node name; names with Polish letters no longer fail the request. A line break in a node name can no longer inject code into the replay node.
- Schemas: `pathValue`, multi-value query parameters and `multipart[].contentType` in reports and baselines.
- `run`: a case whose workflow cannot be prepared (the recorded trigger was renamed) is ERROR on its own instead of aborting the whole run.
- `run` removes the sandbox temp dirs (rewritten workflows with fixture data, captured requests) on Ctrl+C and on SIGTERM from a cancelled CI job, before exiting.
- Linux hosts: the proxy container runs as the host user and the directories n8n writes to are opened up inside the private temp dir, so GitHub runners (uid 1001) can write the CA, captures and snapshots; confirmed on `ubuntu-latest`.
- `init` updates an existing `config.yml` (instance, engine tag, timezone when given, a managed proxy image) and keeps `normalize`, `run`, `engine.env` and a custom proxy image; `--force` replaces it. The Action runs `init` on every job and no longer wipes the committed settings.
- GitHub Action: inputs reach the shell only through environment variables; the pull request comment and the uploaded report are the redacted plan unless `values: 'true'`.
- `redact --report` also writes `plan.redacted.md`; shapes use an HMAC with a random key per report, only the normaliser's placeholders pass unchanged, and error texts have emails, quoted strings and digit runs replaced.
- `redact` (fixtures) catches phones, PESEL and card numbers written as bare digits, birth dates, letters outside ASCII, numbers under personal field names and tokens in URLs; emails keep their length; binary data is dropped.
- A disabled trigger that did not start the recording is removed like any other trigger; n8n's CLI would otherwise start from a disabled Execute Workflow Trigger.
- An AI sub-node shared with a root that still runs (no recording) stays in the workflow; only its link to the replayed root is dropped.
- `accept` notes that baselines hold request bodies; the README explains where to commit them.
- `sandbox prune` keeps the volume and network of a sandbox whose proxy is still running; n8n commands run in named containers that are removed when the docker client times out.
- The Edit Fields replay variant escapes braces inside string values and separates any run of structural braces, so `}}}` no longer ends the expression.
- `replay-input-mismatch` warning when a replayed read node gets a different number of input items than recorded; recorded input counts follow the previous node's output and run.
- A node named with the reserved `frt:` prefix makes the case ERROR with a clear message instead of colliding with the replay nodes.
- Scanner: S013 catches expression URLs (`=http://localhost`), any 127.x address and `[::1]`; S008 catches `$env` in any expression.
- JUnit output drops characters XML 1.0 does not allow.
- Arguments: `--max-size 5mb`, positive `--last`, trimmed `--cases`, `--against` and `--format` checked against their choices; `accept` exits with 3 when it wrote no baseline; `spike` commands are hidden from `--help`.
- Proxy image: base image pinned by digest, dependencies installed with `npm ci` from `packages/proxy/package-lock.json`, mockttp pinned exactly; `release-check` refuses a stale proxy lock.
- `config.schema.json` is exported as an input schema, so fields with a default are optional in editors.
- `run` serves the Google Sheets and Airtable sinks the header row the recordings show (the sheet's real columns) instead of a fixed `email, customer_id`, so a renamed field lands in the wrong column or none, as in production.
- n8n 2.41 (`v3-nightly`): the sandbox turns off encryption key rotation (`N8N_ENV_FEAT_ENCRYPTION_KEY_ROTATION=false`), because only the server process seeds the data key and `import:credentials` on a fresh sandbox database failed with "No active encryption key found".
- The end-to-end catalogue test runs every case through `flowretest run` in its own project (report files, exit codes) and case 01 through `accept` and `diff --against baseline`; before, it went through the spike path only.
- `release.yml` refuses a tag that differs from the package versions, picks the npm dist-tag from the version (a prerelease never goes to `latest`), writes the proxy digest into `proxy.lock.json` before publishing and stops when the package is private or the digest is missing.

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
