# ADR 0001: Money is integer Rial held as bigint

- Status: accepted (Phase 2)
- Date: 2026-11-26

## Context
Iranian prices are large (a single order can exceed 2^31 Rial and totals over time exceed 2^53). Shops usually display Toman (1 Toman = 10 Rial), while banks and gateways use Rial. Mixing the two, or using floating point, causes silent money errors.

## Decision
- Every amount is an integer number of Rial: `BIGINT` in PostgreSQL, `bigint` in TypeScript.
- `src/lib/money` is the only code that converts, rounds or formats money. Toman exists only as a display unit there.
- Derived amounts (percent discounts, tax, splits) use an explicit `RoundingMode`; splits use the largest-remainder method so parts always add up to the total.
- A Rial amount that is not a whole number of Toman is displayed with one decimal (e.g. `۱٬۲۳۴٫۵ تومان`); nothing is dropped.
- JSON payloads carry money as decimal strings (`rialToJSON`).

## Consequences
- Components cannot do arithmetic on money directly; they call the money module.
- Prisma returns `bigint` for `BigInt` columns, which matches this module without conversion.
