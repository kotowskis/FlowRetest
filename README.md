# FlowRetest

Regression tests for n8n workflows. FlowRetest replays real executions of a workflow against the published version and a changed draft, inside a sealed sandbox on your machine, and shows the difference in the API calls each version would send. Nothing reaches the real services.

Status: `0.3.0-next.1`, not yet on npm. Usage, requirements and exit codes are in [packages/cli/README.md](packages/cli/README.md); the GitHub Action is in [action/](action/action.yml).

## Repository

| Path | What it holds |
|---|---|
| `packages/cli` | the `flowretest` command: sandbox, n8n API client, commands, regression catalogue |
| `packages/core` | pure functions: node roles, workflow rewriting, capture attribution, normalisation, diff, plan, redaction |
| `packages/proxy` | the intercepting proxy image the sandbox runs next to n8n |
| `packages/services` | role tables, sink templates and credential stubs for app nodes |
| `packages/schemas` | zod schemas of every file format, exported to JSON Schema in `docs/formaty` |
| `apps/web` | hosted report viewer (paid layer, not deployed): Next.js 16, Supabase and Stripe; organizations, workspaces, tokens, `POST /api/runs`, run history and comparison, acceptances, email and Slack notifications, GitHub checks, Free/Team/Agency plans with limits and retention, PDF record of a run, engine drift matrix, pricing page, home page, legal pages with the DPA, data export and deletion |
| `action/` | composite GitHub Action |
| `docs/` | decision memo, plan, spike and weekly logs, ADRs, formats, audit (in Polish) |

## Development

Node 24, npm 11 and Docker.

```bash
npm install
npm run verify
npm run build
docker build -t flowretest-proxy:dev packages/proxy
node packages/cli/dist/bin.js doctor --engine 2.40.5
npm run e2e -w packages/cli
```

More detail (in Polish) in [docs/rozwoj.md](docs/rozwoj.md).

## Licence

MIT. The runner contains no n8n code; it runs the official `n8nio/n8n` image you already use, on your machine.
