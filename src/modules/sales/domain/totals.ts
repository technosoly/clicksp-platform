/**
 * Pure order total calculation (no I/O). All amounts are integer Rial.
 * The sales service (Phase 6) will call this with server-side prices only;
 * prices and totals from the client are never trusted.
 */
import {
  add,
  allocate,
  applyPercent,
  discountByAmount,
  max,
  MoneyError,
  multiply,
  subtract,
  type Rial,
  type RoundingMode,
} from "@/lib/money";

export interface OrderLineInput {
  unitPrice: Rial;
  quantity: number;
  /** Discount on the whole line (not per unit), already resolved server-side. */
  lineDiscount?: Rial;
}

export interface OrderTotalsInput {
  lines: readonly OrderLineInput[];
  /** Order-level discount (coupon) as a fixed amount. */
  orderDiscount?: Rial;
  /** Shipping cost resolved from the shipping rate tables. */
  shipping: Rial;
  /** Goods subtotal (after discounts) at or above which shipping is free. */
  freeShippingThreshold?: Rial;
  /** Tax on discounted goods in basis points (e.g. 1000 = 10%). 0 when not configured. */
  taxBasisPoints?: number;
  rounding: RoundingMode;
}

export interface OrderLineTotals {
  gross: Rial;
  lineDiscount: Rial;
  allocatedOrderDiscount: Rial;
  net: Rial;
}

export interface OrderTotals {
  lines: OrderLineTotals[];
  subtotal: Rial;
  discountTotal: Rial;
  goodsTotal: Rial;
  shipping: Rial;
  tax: Rial;
  total: Rial;
}

export function computeOrderTotals(input: OrderTotalsInput): OrderTotals {
  if (input.lines.length === 0) throw new MoneyError("An order needs at least one line");
  if (input.shipping < 0n) throw new MoneyError("Shipping must not be negative");

  const afterLineDiscount = input.lines.map((line) => {
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) {
      throw new MoneyError(`Quantity must be a positive integer, got ${line.quantity}`);
    }
    if (line.unitPrice < 0n) throw new MoneyError("Unit price must not be negative");
    const gross = multiply(line.unitPrice, line.quantity);
    const lineDiscount = line.lineDiscount ?? 0n;
    if (lineDiscount < 0n || lineDiscount > gross) {
      throw new MoneyError("Line discount must be between zero and the line amount");
    }
    return { gross, lineDiscount, net: subtract(gross, lineDiscount) };
  });

  const subtotal = add(...afterLineDiscount.map((l) => l.gross));
  const netBeforeOrderDiscount = add(...afterLineDiscount.map((l) => l.net));

  const requestedOrderDiscount = input.orderDiscount ?? 0n;
  if (requestedOrderDiscount < 0n) throw new MoneyError("Order discount must not be negative");
  const orderDiscount = requestedOrderDiscount > netBeforeOrderDiscount ? netBeforeOrderDiscount : requestedOrderDiscount;

  // Spread the order discount over lines by their net amount, so refunds of a
  // single line return exactly what the customer paid for it.
  const allocations =
    netBeforeOrderDiscount > 0n
      ? allocate(
          orderDiscount,
          afterLineDiscount.map((l) => l.net),
        )
      : afterLineDiscount.map(() => 0n);

  const lines: OrderLineTotals[] = afterLineDiscount.map((l, i) => {
    const allocatedOrderDiscount = allocations[i] ?? 0n;
    return {
      gross: l.gross,
      lineDiscount: l.lineDiscount,
      allocatedOrderDiscount,
      net: discountByAmount(l.net, allocatedOrderDiscount),
    };
  });

  const goodsTotal = add(...lines.map((l) => l.net));
  const discountTotal = subtract(subtotal, goodsTotal);
  const freeShipping =
    input.freeShippingThreshold !== undefined && goodsTotal >= input.freeShippingThreshold;
  const shipping = freeShipping ? 0n : input.shipping;
  const tax = applyPercent(goodsTotal, input.taxBasisPoints ?? 0, input.rounding);

  return {
    lines,
    subtotal,
    discountTotal,
    goodsTotal,
    shipping,
    tax,
    total: add(goodsTotal, shipping, tax),
  };
}

/**
 * How much can still be refunded on a payment. A refund request above this
 * amount must be rejected by the refund service.
 */
export function refundableAmount(paid: Rial, alreadyRefunded: Rial): Rial {
  if (paid < 0n || alreadyRefunded < 0n) throw new MoneyError("Amounts must not be negative");
  return max(subtract(paid, alreadyRefunded), 0n);
}

export function assertRefundAllowed(requested: Rial, paid: Rial, alreadyRefunded: Rial): void {
  if (requested <= 0n) throw new MoneyError("Refund amount must be positive");
  if (requested > refundableAmount(paid, alreadyRefunded)) {
    throw new MoneyError("Refund exceeds the refundable amount");
  }
}
