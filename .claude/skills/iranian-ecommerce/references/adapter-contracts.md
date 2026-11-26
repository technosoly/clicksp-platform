# Adapter contracts

```ts
export interface PaymentGatewayAdapter {
  readonly code: string                         // 'zarinpal' | 'zibal' | ...
  initiate(input: {
    amountRial: bigint; ourReference: string; callbackUrl: string;
    description: string; mobile?: string
  }): Promise<{ providerToken: string; redirectUrl: string }>
  parseCallback(req: Request): Promise<{ ourReference: string; providerToken?: string; status: 'ok' | 'cancelled' | 'unknown'; raw: Record<string, string> }>
  verify(input: { amountRial: bigint; providerToken: string }): Promise<
    | { ok: true; providerReference: string; maskedCard?: string; paidAmountRial: bigint }
    | { ok: false; code: string; message: string }
  >
  refund?(input: { providerReference: string; amountRial: bigint; idempotencyKey: string }): Promise<{ ok: boolean; refundReference?: string; message?: string }>
}

export interface ShippingAdapter {
  readonly code: string
  createShipment?(input: ShipmentRequest): Promise<{ trackingCode: string; labelUrl?: string }>
  track(trackingCode: string): Promise<TrackingEvent[]>
}

export interface SmsAdapter {
  readonly code: string
  send(input: { toE164: string; template: string; params: Record<string, string> }): Promise<{ providerMessageId: string }>
}

export interface EInvoiceAdapter {
  readonly code: string
  submit(invoiceId: string): Promise<{ status: 'submitted' | 'rejected'; reference?: string; message?: string }>
}
```

Note: some gateways take amounts in Toman, others in Rial. The adapter converts at its boundary using `src/lib/money` and documents which unit the provider uses. Internal code always passes Rial.
