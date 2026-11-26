---
name: project-architecture
description: Clicksp modular-monolith structure and module boundaries. Use when creating a new module, adding a cross-module call or side effect, adding a dependency, choosing where code belongs, or writing an Architecture Decision Record (ADR).
---

# Project architecture

## Activation conditions
- Creating or renaming a module under `src/modules/`.
- One module needs data or behaviour from another.
- A change triggers side effects (search reindex, SMS, accounting post, cache revalidation).
- Adding an npm dependency or an infrastructure component.
- Any decision that changes a rule in `.claude/CLAUDE.md`.

## Purpose
Keep Clicksp a **modular monolith**: one Next.js deployable, one PostgreSQL database, strict internal boundaries so modules stay independently testable and could later be extracted.

## Workflow
1. **Locate the owning module.** Every table belongs to exactly one module (see `docs/DATABASE.md`). The owning module is the only one that writes it.
2. **Layer the code** inside the module:
   - `domain/`: pure functions and types (state machines, calculations). No I/O, no Prisma, no `Date.now()` without injection.
   - `repo/`: Prisma queries only. Returns domain types, not Prisma models, across module boundaries.
   - `service/`: use cases. Signature `fn(actor: Actor, input: ValidatedInput, ctx?: { tx })`. Calls `authorize()` first, opens transactions, writes outbox events.
   - `api/`: Zod input/output schemas and thin route handlers / Server Actions that call services.
3. **Cross-module reads**: call the other module's exported service function (e.g. `catalog.service.getVariantSnapshot`). Never import another module's `repo/`.
4. **Cross-module writes / side effects**: inside your transaction call `outbox.enqueue(tx, { type: 'order.paid', payload })`. A worker handler in the consuming module processes it idempotently (keyed by event id).
5. **Transactions spanning modules** (e.g. checkout: inventory reservation + order creation) are orchestrated by one service that passes the same `tx` into the other modules' service functions that accept `ctx.tx`.
6. **New dependency**: write in the PR why it is needed, its maintenance status, bundle impact (client or server only), and whether it works offline from Iranian hosting.
7. **ADR**: for decisions that change a rule, add `docs/adr/NNNN-title.md` (Context, Decision, Consequences, Alternatives).

## Technical requirements
- Module public API = `src/modules/<m>/index.ts`. ESLint `no-restricted-imports` forbids deep imports into other modules and Prisma imports outside `repo/`.
- Route handlers under `app/api/v1/<resource>/route.ts`; every handler validates input with Zod and maps service errors to HTTP via `src/lib/http/errors.ts` (`AuthzError` → 403, `NotFoundError` → 404, `ConflictError` → 409, `ValidationError` → 422).
- OpenAPI document generated from the Zod schemas; served at `/api/v1/openapi.json` (admin-only in production).
- Background work runs in `worker/` with pg-boss; no long tasks inside request handlers.
- Configuration through `src/lib/env.ts` (Zod-validated at boot; app refuses to start on invalid env).

## Security requirements
- Services are the security boundary: UI hiding is never sufficient.
- `Actor` is built server-side from the session only.
- Outbox handlers re-check preconditions; they never trust payload fields for authorization.

## Expected outputs
- Code placed in the correct module/layer.
- Updated `docs/ARCHITECTURE.md` when a module, process or boundary changes.
- ADR for rule changes.

## Documentation references
- Next.js App Router: https://nextjs.org/docs/app
- Route Handlers: https://nextjs.org/docs/app/building-your-application/routing/route-handlers
- pg-boss: https://github.com/timgit/pg-boss
- Transactional outbox pattern: https://microservices.io/patterns/data/transactional-outbox.html

## Testing requirements
- Domain functions: Vitest unit tests, no DB.
- Services: integration tests against real PostgreSQL (test container / compose service), each test in a rolled-back transaction or truncated schema.
- An architecture test (e.g. `dependency-cruiser` or ESLint rule run in CI) fails if a boundary rule is broken.
- Outbox handlers: test that processing the same event twice has no extra effect.
