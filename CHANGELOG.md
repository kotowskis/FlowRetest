# Changelog

All notable changes to this project are documented here. The format follows Keep a Changelog; versions follow semver 0.x.

## [Unreleased]

### Added

- Hosted layer: notices of sub-processor changes at least 30 days ahead, shown on `/legal/subprocessors` and on the Data page and emailed once to each owner of an organization that accepted the DPA (`apps/web/scripts/subprocessor-notice.ts`).
- Hosted layer, data and privacy: public pages with the terms, privacy notice, Data Processing Agreement, sub-processors and data retention; owners accept the DPA for their organization and download a PDF copy, set a run history shorter than the plan's, export every row of the organization as JSON Lines and delete runs, workspaces or the organization; every person can delete their account. Invitations expire after 30 days. A public home page for visitors who are not signed in.
- `upload`: sends the redacted report of a run (`report.redacted.json`) to the hosted report viewer with a workspace token (`FLOWRETEST_TOKEN`, from the environment or `.flowretest/secrets.env`) and prints the run URL. `run --upload` and `upgrade-check --upload` do it after the plan; a failed upload turns a PASS into exit code 4 and leaves DIFF and ERROR codes alone. The URL comes from `--url`, `FLOWRETEST_URL` or `cloud.url` in `config.yml`.
- `sync` writes baselines for acceptances made in the hosted report viewer: the viewer stores the decision (cases, message, who), the runner writes the baseline from the full local report of the accepted run and marks it applied. `pull` runs it at the end when `cloud.url` and `FLOWRETEST_TOKEN` are set (`--no-sync` to skip); an acceptance whose run is on another machine stays pending. Baselines written this way carry the accepting person's email and message.
- `upload` adds the tested commit (`git`: repository, SHA, pull request number) from GitHub Actions, or from `FLOWRETEST_GIT_REPOSITORY` and `FLOWRETEST_GIT_SHA`; on a pull request it is the head commit, not the merge commit. The hosted layer posts a GitHub check on it (PASS success, DIFF action required, ERROR and BLOCKED failure) when a GitHub App installation of the repository owner is linked to the workspace.
- GitHub Action: `upload-url` and `upload-token` upload the redacted report after the run; output `run-url`.
- Hosted layer, Agency plan: a PDF record of each run (every call the new version would send per case, with field shapes, the old value of changed fields and who accepted which cases) at `/runs/<id>/pdf`, and an engine drift matrix built from uploaded `upgrade-check` runs, per workspace (workflows by target n8n version) and per organization (workspaces by target version). A public pricing page reads the plans from the same table the limits come from.
- Hosted layer plans: Free (1 workspace, 2 seats, 14 days of run history, 50 uploads per 24 hours, no GitHub checks or Slack), Team (79 EUR a month, 10 workspaces, 3 seats, 90 days) and Agency (199 EUR a month, unlimited workspaces, 10 seats, 365 days), 20% less when paid yearly, through Stripe Checkout with invoices and the Stripe customer portal. `upload` gets 402 when the workspace is beyond the plan's workspace limit (after a downgrade the oldest workspaces keep uploading) and 429 when the organization used its uploads for the last 24 hours. Runs older than the plan's history period are deleted every night, with 30 days of grace after a paid plan ends.
- The redacted report carries `stability` (per case, from `run --stabilize`), so the viewer offers only stable PASS and DIFF cases for acceptance.
- `docs/formaty/redacted-report.schema.json` (`RedactedReportSchema`): the only file that leaves the machine. The redacted report now carries `run` (the local run directory) and `upgrade` for `upgrade-check` runs.
- `apps/web` (not deployed): hosted report viewer on Next.js 16 and Supabase with passwordless sign-in, organizations and invitations, workspaces, workspace tokens, `POST /api/runs` and a run page that shows the same plan as the terminal; acceptance of cases with history per workflow, `GET /api/acceptances` and `POST /api/acceptances/<id>/applied` for the runner, email notifications about runs with chosen statuses (members' own addresses only), GitHub App linking with an ownership check and a check per uploaded run, and Slack incoming webhooks.
- Stubs: `run --stub "<node>=<file>"` (repeatable) and `.flowretest/<workflow>/stubs.yml` answer a node with the items in a JSON or YAML file instead of running or replaying it: a database write, a read the recording never took, a recording over 1 MB. The case runs instead of being skipped, gets a `stub:` warning, and `coverage.stubbed` lists the nodes. `upgrade-check` takes `--stub` too; `scan` and the skip message point at it.
- `expectations.yml` (ADR 0005): hand-written checks on the new version's calls (call counts per node, `notEmpty`, `absent`, `present`, `equals`, `matches`, `oneOf` on field paths with `[*]`). A failed check makes the case DIFF and shows as an `x` line; `diff --against baseline` checks them again.
- `upgrade-check`: the plan, Markdown and JUnit open with "Engine differences": nodes that ran on one engine only, run and item counts, output keys and new errors per node, next to the call diff.
- `report.json` has `static`: the scanner findings for the new version and the structural diff; the plan shows one line with their counts.
- `diff --format terminal,json,junit,md` re-renders a saved run into files (`junit.baseline.xml`, `plan.baseline.md` against baselines).
- `sandbox export --compose <dir>`: a docker-compose file for a sandbox kept with `--keep`, with the n8n editor on 127.0.0.1:5678 through a socat container while n8n stays on the internal network.
- Global options `--json` (result on stdout, progress on stderr), `--verbose`, `--no-color` and `--cwd`; the terminal plan is coloured by line (picocolors).
- CI: eslint (`npm run lint`, part of `verify`; `core` and `services` may not import IO modules), an 80% line and function coverage threshold for `core`, `npm audit --audit-level=high`.
- Every `run` checks the seal of its sandbox before executing anything (internal network, proxy on that network only, no direct connection out) and stops with exit code 4 if a check fails. The checks are in `report.json` under `sandbox`; the plan footer says "sandbox sealed (checked before the run)" only when they passed.

### Fixed

- `upload` with a wrong or revoked token and a large report: the server answers 401 before reading the body, and the connection sometimes closed before the answer arrived, so the CLI printed a network error. After a failed request with a body the CLI now asks the hosted layer about the token and reports the refusal (exit code 4).
- `sync` matches accepted cases by exact file name (case 1 was found in `11.json`), leaves an acceptance pending when no baseline could be written or when the local run tested another workflow version, takes a 409 as applied elsewhere and refuses a run name from the server that is not a directory name.
- `upload` and `sync` refuse a hosted-layer URL over plain http (except localhost) or with a user name or password in it, and treat a 200 answer without JSON (a login page in front of the server) as an error instead of printing `uploaded run undefined`.
- `report.json` records the n8n `versionId` of both workflows (`versions`), baselines written by `accept` carry the new one, and the redacted report sends it as `workflowVersionId`, so the hosted layer records which version an acceptance approved.
- The redacted report no longer carries numbers from a million up (a PESEL or phone number sent as a JSON number becomes `<digits N>`), emails or long digit runs in object and query keys, path segments that hold a value (`/customers/Anna%20Kowalska` becomes a shape), and emails or long numbers in the workflow name, labels, node names, warnings, scanner messages and field paths. Error texts also lose phone numbers written in groups (`+48 600 100 200`). `upload` and the hosted layer refuse a report that still has any of these.
- `redact --report` salts the body hash and multipart hashes with the report key: an unsalted SHA-256 of a small body (one phone number sent to a known endpoint) could be reversed by guessing. A version label that is a file path keeps only the file name, and `generatedAt` is the run's time instead of the redaction time.
- `init --api-key` keeps other lines of `.flowretest/secrets.env`.
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
