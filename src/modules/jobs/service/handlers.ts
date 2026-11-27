import "server-only";
import { postOrderPaid, postRefund } from "@/modules/accounting/service/accounting";
import { onProductChanged } from "@/modules/search/service/product-search";
import type { OutboxHandler } from "../domain/outbox";

/**
 * Which module handles which outbox topic. Topics not listed here wait in the
 * outbox until a module handles them (order messages once an SMS provider is
 * connected, for example).
 */
export const OUTBOX_HANDLERS: ReadonlyMap<string, OutboxHandler> = new Map([
  ["search.product_changed", onProductChanged],
  // Paid orders and refunds post to the books; they wait (and retry) until the posting accounts and a period are set up.
  ["order.paid", postOrderPaid],
  ["refund.completed", postRefund],
]);
