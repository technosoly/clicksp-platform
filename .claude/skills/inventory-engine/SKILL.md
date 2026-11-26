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
- `inventory_balances(product_variant_id, warehouse_location_id, on_hand, reserved, version)` — one row per variant per location. `available = on_hand - reserved` (computed, never stored).
- `inventory_movements` — append-only: `type` (`receipt | issue | sale | return | transfer_out | transfer_in | adjustment_plus | adjustment_minus | count_correction`), `quantity` (> 0), `balance_id`, `reference_type/reference_id` (order, adjustment, count, transfer, purchase), `reason`, `actor_id`, `occurred_at`.
- `stock_reservations(order_id | cart_id, balance_id, quantity, status: active | consumed | released | expired, expires_at)`.
- `stock_adjustments` (header with reason, approval) → movements.
- `inventory_counts` (session per warehouse/location) → count lines → `count_correction` movements on completion.
- `stock_alerts(variant, warehouse, threshold, status)`.

## Workflow: every stock change
All stock changes go through **one function** in `inventory/service`:
```ts
applyMovement(tx, { balanceId, type, quantity, reference, reason, actor })
```
1. `SELECT ... FROM inventory_balances WHERE id = $1 FOR UPDATE` (lock the row).
2. Compute the new `on_hand` / `reserved`; DB CHECK constraints (`on_hand >= 0`, `reserved <= on_hand`) are the final guard.
3. Insert the `inventory_movements` row.
4. Update the balance.
5. Enqueue outbox `inventory.changed` (search availability, stock alerts).
Lock multiple balances in a **stable order** (by id) to avoid deadlocks.

## Reservation flow (checkout)
1. At "start payment": in one transaction, lock balances, verify `available >= qty`, insert `stock_reservations(active, expires_at = now + 20 min)`, increment `reserved`.
2. Payment verified: reservation → `consumed`, `sale` movement (`on_hand -= qty`, `reserved -= qty`).
3. Payment failed / expired: job releases reservation (`reserved -= qty`), status `released`/`expired`.
4. Warehouse selection for multi-warehouse: configurable strategy (default: single warehouse with full availability, priority order). Strategy is a pure function in `domain/`.

## Technical requirements
- Never `UPDATE inventory_balances` outside `applyMovement`/reservation functions (enforced by code review + an architecture test grep).
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
