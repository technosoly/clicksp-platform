# ADR 0003: Background jobs run inside the app process

- Status: accepted (Phase 6, jobs and search), pending the owner's review in its pull request
- Date: 2026-11-27

## Context
CLAUDE.md places the job runner in `worker/`, a separate process. The jobs so far are small and short: delivering outbox events (search index updates), releasing the stock of expired unpaid orders, and a nightly search rebuild. The store runs on one VPS, and the app image is the Next.js standalone build, which does not include TypeScript sources or path-alias resolution for a second entry point. A separate worker would need its own bundle, image target and Compose service.

## Decision
- The runner (pg-boss 12.40) starts from `instrumentation.ts` in every app process. pg-boss keeps its queue in the same PostgreSQL database, schema `pgboss`, and sends each scheduled job once however many processes run. The queues are `stately`, so a slow run never piles up copies.
- Outbox events are claimed with `FOR UPDATE SKIP LOCKED` under a lease, so several processes can deliver at once without handling an event twice.
- If the database isn't reachable at start-up, the runner retries in the background (1 minute, doubling to 10 minutes). `/api/health` reports its state (`jobs`). `JOBS_ENABLED=false` turns it off for a process.
- On shutdown the runner stops taking new jobs; Next.js handles the process exit. A job cut short is retried by pg-boss.

## Consequences
- The app's database role must be allowed to create the `pgboss` schema on first start (the Compose role owns the database, so it can). A deployment with a restricted role creates the schema beforehand with pg-boss's CLI or grants `CREATE` on the database.
- Jobs share CPU and memory with web requests. When a heavy job arrives (imports, large exports, accounting reports), it moves to a separate worker process running the same `src/modules/jobs` code. The jobs module already keeps the job list in one place (`runner.ts`) so that move is a packaging change.
- CLAUDE.md §3 is read with this ADR: `worker/` is where a separate runner will live when one is needed.
