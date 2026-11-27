import "server-only";
import { onProductChanged } from "@/modules/search/service/product-search";
import type { OutboxHandler } from "../domain/outbox";

/**
 * Which module handles which outbox topic. Topics not listed here wait in the
 * outbox until a module handles them (order messages once an SMS provider is
 * connected, accounting postings once the ledger is built).
 */
export const OUTBOX_HANDLERS: ReadonlyMap<string, OutboxHandler> = new Map([["search.product_changed", onProductChanged]]);
