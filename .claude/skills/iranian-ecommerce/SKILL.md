---
name: iranian-ecommerce
description: Iranian market commerce integrations for Clicksp — payment gateways (Zarinpal, Zibal and others) via adapters, shipping carriers (Iran Post, Tipax and others), SMS providers, checkout, order lifecycle, invoices, VAT and e-invoicing considerations. Use when working on checkout, payments, callbacks, refunds, shipping methods/rates/tracking, SMS/OTP sending, or tax and invoice features.
---

# Iranian e-commerce

## Activation conditions
- Code in `src/modules/payments`, `shipping`, `sales` (checkout, orders), SMS adapters, tax/invoice.
- Adding a provider, configuring callbacks, refunds, reconciliation.

## Purpose
Provider-independent payment, shipping and SMS layers that are secure, idempotent and honest: no invented endpoints, credentials or prices.

## Technical requirements: golden rules
1. **Adapters only.** Each provider implements an interface in `references/adapter-contracts.md`. Business code never imports a provider SDK.
2. **No fake integrations.** A real adapter is written only from the provider's current official documentation, with sandbox credentials supplied by the owner. Until then the provider is listed as "not configured" and checkout hides it. In dev/test, a clearly named `FakeGatewayAdapter` exists **only** under `NODE_ENV !== 'production'` (startup fails if configured in production).
3. **Never trust the frontend** for payment status, amount or order totals.
4. **Never store card data** (PAN, CVV, expiry). Store only provider reference IDs, masked card if the provider returns it, and status.
5. Hosting, payment providers, shipping providers and SMS provider are **runtime configuration** (`payment_providers`, `shipping_providers`, settings). The site builds and runs without any of them.

## Workflow: payment flow
1. Checkout service computes totals server-side (money module), creates order `pending_payment`, reserves stock, creates `payment_transactions(status: initiated, amount, idempotency_key, our_reference)`.
2. `adapter.initiate()` → redirect URL. Store provider authority/token.
3. Callback route `app/api/webhooks/payments/[provider]/route.ts`:
   - Look up transaction by **our** reference (from callback params); unknown → 404 + `security_events`.
   - If already final → return the existing result (idempotent).
   - `adapter.verify()` server-to-server; compare **amount** and merchant; mismatch → mark `failed_verification`, alert.
   - In one DB transaction: transaction `succeeded`, order `paid`, reservation `consumed`, outbox `order.paid` (accounting posting, SMS, email).
4. Unverified/failed → order stays `pending_payment` until reservation expiry, then `cancelled`.
5. Reconciliation job compares provider reports (when the provider offers them) with `payment_transactions` and flags differences; it never silently changes records.
6. Refunds: `order_refunds` record → provider refund API if supported, else manual refund recorded with reference; accounting reversal via `accounting-engine`.

## Shipping
- `shipping_zones` (province/city sets) × `shipping_methods` → `shipping_rates` (weight brackets, base + per-kg, free-over threshold). All amounts integer Rial.
- Rates calculated by a pure function from cart weight/dimensions; result snapshotted on the order.
- Carrier adapters (`ShippingAdapter`) for label creation/tracking only when official APIs + credentials exist; otherwise manual tracking codes entered by staff create `shipment_tracking_events`.
- Province/city list: load from an official/maintained source file under `data/geo/` with its origin documented; do not hand-invent.

## SMS
- `SmsAdapter.send({ to, template, params })`. Templates are configured per provider (many Iranian providers require pre-approved templates for OTP).
- Phone numbers normalized to E.164 `+98...`; accept `09xx`, Persian digits.
- `notifications` table logs every send (status, provider message id), never the OTP code itself.

## Invoices and tax
- `tax_rules` configurable (rate, applies-to, inclusive/exclusive). Defaults are **not** assumed; owner/accountant sets them.
- `invoices` generated from order snapshots, sequential numbering per financial year.
- Moadian e-invoicing (سامانه مودیان) may apply: design an `EInvoiceAdapter` seam, but do not implement or claim compliance without verification by an Iranian accounting professional.
- Enamad (اینماد) trust seal is configured as a footer setting (HTML snippet from Enamad is the one allowed vendor embed; store it as a validated, sanitized setting reviewed by Super Admin).

## Security requirements
- Callback endpoints: rate limited, no session required, but strictly validated; log raw callback (redacted) for forensics.
- Gateway credentials only in server env / encrypted settings, never in client bundles or logs.
- Idempotency keys on initiate and refund endpoints (`idempotency_keys` table).
- Amount tampering: client-sent amounts ignored entirely.

## Expected outputs
- Adapter interfaces, checkout service, callback handlers, shipping calculator, SMS service, docs in `docs/API.md` and `docs/SECURITY.md`.

## Documentation references (verify current versions before coding)
- Zarinpal developer docs: https://docs.zarinpal.com/
- Zibal (find the developer docs from the official site): https://zibal.ir/
- Iran Post: https://post.ir/
- Tipax: https://tipaxco.com/
- Enamad: https://enamad.ir/
- Iranian National Tax Administration (Moadian system): https://www.tax.gov.ir/

## Testing requirements
- Callback replay: same callback twice → one success, no double accounting/stock change.
- Amount mismatch on verify → transaction not marked paid.
- Forged callback with unknown reference → rejected and logged.
- Fake adapter refuses to load in production mode.
- Shipping rate calculation per weight bracket, free-shipping threshold, zone mismatch.
- Order totals: items + shipping − discounts + tax in integer Rial, matches snapshot.
- Refund creates reversal entries and restocks only when the return is received.
