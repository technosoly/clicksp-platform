---
name: inventory-engine
description: Multi-warehouse inventory for Clicksp — balances, movements, reservations, adjustments, transfers, stock counts and alerts with transactional, oversell-proof updates. Use when touching stock quantities, warehouses or locations, checkout reservations, receiving/issuing goods, stock counts or low-stock alerts.
---

# Inventory engine

## Activation conditions
- Code in `src/modules/inventory` or any code that changes stock.
- Checkout, order cancellation, returns (restock), stock counts, transfers.

## Purpose
Every unit of stock is accounted for, every change is an auditable movement, and concurrent checkouts can never sell more than is available.

## Model
- `warehouses` → `warehouse_locations` (bin/shelf codes).
- `inventory_balances(variant_id, location_id, warehouse_id, on_hand, reserved, version)` — one row per variant per location, `UNIQUE(variant_id, location_id)`. `available = on_hand - reserved` (computed, never stored). Written **only** by database triggers (see Workflow).
- `inventory_movements` — append-only: `type` (`receipt | issue | sale | return | transfer_out | transfer_in | adjustment_plus | adjustment_minus | count_gain | count_loss`), `quantity` (> 0, direction from type), `variant_id + location_id + warehouse_id` (FK to the balance), `on_hand_after` (set by trigger), `reference_type/reference_id/reference_code` (purchase, order, order_return, adjustment, count, transfer, manual), `transfer_id`, `reason`, `actor_user_id`, `occurred_at`.
- `stock_reservations(order_id | cart_id, balance_id, quantity, status: active | consumed | released | expired, expires_at)`.
- `stock_adjustments` (header with reason, approval) → movements.
- `inventory_counts` (session per warehouse/location) → count lines → `count_gain` / `count_loss` movements on completion.
- `stock_alerts(variant, warehouse, threshold, status)`.

## Workflow: every stock change
All stock changes go through **one function** in `inventory/service`:
```ts
applyMovement(tx, { variantId, locationId, warehouseId, type, quantity, reference, reason, actor })
```
1. `SELECT set_config('app.actor_id', actorId, true)` once per transaction.
2. Insert the `inventory_movements` row. The `inventory_movements_apply` trigger (Phase 3 migration) creates the balance row if missing, applies the change with an `UPDATE` (which takes the row lock), and stores `on_hand_after`. CHECKs (`on_hand >= 0`, `reserved <= on_hand`) reject overselling; the insert then fails and nothing is written.
3. Enqueue outbox `inventory.changed` (search availability, stock alerts).
Any direct write to `on_hand`/`reserved` is rejected by `inventory_balances_guard`. When one transaction touches several balances, insert movements in a **stable order** (by variant id, then location id) to avoid deadlocks.

## Reservation flow (checkout)
1. At "start payment": in one transaction, lock balances, verify `available >= qty`, insert `stock_reservations(active, expires_at = now + 20 min)`, increment `reserved`.
2. Payment verified: reservation → `consumed`, `sale` movement (`on_hand -= qty`, `reserved -= qty`).
3. Payment failed / expired: job releases reservation (`reserved -= qty`), status `released`/`expired`.
4. Warehouse selection for multi-warehouse: configurable strategy (default: single warehouse with full availability, priority order). Strategy is a pure function in `domain/`.

## Technical requirements
- Never `UPDATE inventory_balances` from code: the database rejects it. Reservations change `reserved` through the `stock_reservations` triggers: insert `active`; then exactly one transition to `consumed | released | expired`. For a sale, consume the reservation **before** inserting the `sale` movement.
- Adjustments above a configured quantity/value threshold require approval (`admin_approvals`) when actor has only `inventory.adjust.propose`.
- Counts: freeze nothing; record expected vs counted at count time, correction = counted − expected at completion, reason required.
- Low-stock alerts computed by worker on `inventory.changed`, not in the request.

## Security requirements
- Staff limited to scoped warehouses.
- Movements and counts record actor; no movement may be deleted or edited (trigger).
- Value/cost data (purchase cost) is visible only with `accounting.view` or `report.financial`.

## Expected outputs
- Inventory services, admin screens (receive, issue, transfer, count, history), docs in `docs/DATABASE.md` "Inventory".

## Documentation references
- PostgreSQL explicit locking: https://www.postgresql.org/docs/current/explicit-locking.html
- Prisma interactive transactions: https://www.prisma.io/docs/orm/prisma-client/queries/transactions#interactive-transactions

## Testing requirements
- **Concurrency test**: N parallel reservations for a balance with stock < N → exactly `stock` succeed, rest fail, `on_hand` never negative.
- Reservation expiry releases stock; double release is a no-op.
- Every movement type updates balance correctly and writes exactly one movement row.
- UPDATE/DELETE on `inventory_movements` fails.
- Transfer = two movements in one transaction; failure rolls back both.
- Staff out-of-scope warehouse → 403.
