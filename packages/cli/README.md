# flowretest

Replay real n8n executions against a changed workflow in a sealed sandbox and see every API call it would send, compared with today's version. Zero real writes.

n8n shows you that a workflow ran green. FlowRetest shows you what it sent: the empty `customer_id`, the record posted twice, the order that silently stopped being sent. It runs your own n8n image inside an internal Docker network with every outbound HTTP call intercepted, so nothing leaves the sandbox.

## Requirements

- Docker (Desktop or Engine) on the machine that runs the tests
- Node 22.5 or newer
- An n8n instance on 2.20 or newer, with a public API key that can read workflows and executions
- Successful executions saved on that instance (the default)

## Quickstart

```bash
npx flowretest init --url https://n8n.example.com --api-key <key> --engine 2.40.5
npx flowretest pull --workflow <workflowId> --last 10
npx flowretest scan --workflow <workflowId> --new draft.json
npx flowretest run  --workflow <workflowId> --new draft.json --stabilize
npx flowretest accept --workflow <workflowId> --message "intended: new ERP field"
```

`init` writes `.flowretest/config.yml` and keeps the API key in `.flowretest/secrets.env` (ignored by git). `pull` stores the published workflow and one fixture per recorded execution. `run` executes the recorded version and your draft in the sandbox and prints the plan:

```
Plan: 3 calls (old version: 3). 3 changed, 0 added, 0 removed, 0 blocked.

~ [7] Push to ERP   POST erp.example.com/api/orders
      customer_id: "C-1" -> null
      ! empty value in an id field

Coverage: 3 of 3 write nodes captured (100%) · nodes replayed from recordings: 3 · 0 requests left the sandbox
Result: DIFF (exit code 1)
```

Exit codes: 0 PASS, 1 DIFF, 2 ERROR (the new version failed), 3 BLOCKED (a blocked call, or a case skipped for an unsupported node on its path), 4 usage or environment problem (Docker, API, config, files), 5 internal error. A run that crashes never exits with 1.

## How it works

- Read nodes (GET requests, lookups) are replayed from the recorded execution, so the run does not depend on live services.
- Write nodes (POST, PUT, app nodes such as HubSpot, Slack, Google Sheets, Airtable, Notion) run for real against a proxy that answers with plausible responses and records what was sent.
- Nodes that write to databases, mail or files never reach the network; the case is reported as SKIPPED and the run ends as BLOCKED (exit code 3), never as PASS.
- `--stabilize` runs both versions twice and masks fields that differ between the runs (random ids, nonces).

The runner contains no n8n code. It pulls the official `n8nio/n8n` image of your version, imports the rewritten workflow with `n8n import:workflow`, runs it with the n8n CLI and reads the result. Your instance is only read through the public API.

## Privacy

Nothing leaves your machine. The runner talks to two places: your n8n instance (read only, through the public API) and the image registries (to pull `n8nio/n8n` and the proxy image). There is no telemetry. Fixtures contain your customers' data and are excluded from git by `init`; `redact` writes copies safe to share, and `redact --report` turns a run report into shapes (type, length, hash) instead of values.

## Licensing

FlowRetest is MIT. It contains no n8n code: it pulls the official image you already run, imports the rewritten workflow with n8n's own CLI inside a container on your machine and reads the result. n8n's Sustainable Use License applies to that image and to your use of it, exactly as it does to your production instance.

## What it does not do

It does not judge new prompts or models (AI nodes are replayed from recordings), does not prove that the real service still behaves the same, and does not replace production monitoring.

## Commands

| Command | What it does |
|---|---|
| `init` | write config and API key, check Docker |
| `pull` | fetch the workflow and recent executions as fixtures |
| `scan` | support table, static findings, structural diff |
| `run` | replay old and new in the sandbox, print the plan |
| `diff` | re-render a saved run, optionally against baselines |
| `accept` | store the new version's calls as the baseline (needs a `--stabilize` run, or `--force`) |
| `upgrade-check` | replay the same workflow on two n8n images and report engine differences |
| `redact` | redacted fixture copies for bug reports and shared catalogues |
| `doctor` | check Docker, images and the sandbox seal |
| `sandbox prune` | remove leftover sandbox containers |

## CI

`run --format terminal,junit,md` writes `junit.xml` and `plan.md` into the run directory. The composite action in `action/` wraps init, pull and run, uploads the report and keeps one comment per workflow on the pull request up to date:

```yaml
- uses: skynappse/flowretest/action@main
  with:
    instance-url: ${{ secrets.N8N_URL }}
    api-key: ${{ secrets.N8N_API_KEY }}
    workflow-id: 0GV9oevzsHwzQssT
    new-file: workflows/lead-intake.json
    engine: 2.40.5
```

Before an n8n upgrade:

```bash
npx flowretest upgrade-check --workflow <workflowId> --engine-old 2.40.5 --engine-new 3.0.0
```

Licence: MIT.
