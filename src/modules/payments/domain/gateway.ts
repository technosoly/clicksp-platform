/**
 * The contract every online payment gateway adapter implements
 * (.claude/skills/iranian-ecommerce/references/adapter-contracts.md).
 * Business code only sees this interface; amounts are always integer Rial
 * here, and an adapter converts at its own boundary when its provider counts
 * in Toman. No adapter talks to a real provider until it is written from the
 * provider's official documentation and tested with the store's own sandbox
 * credentials.
 */

export interface GatewayInitiateInput {
  amountRial: bigint;
  /** Our own reference for this attempt; the callback carries it back. */
  ourReference: string;
  callbackUrl: string;
  description: string;
  /** The customer's mobile number (E.164), when the provider can use it. */
  mobile?: string;
}

export interface GatewayCallback {
  ourReference: string;
  providerToken?: string;
  /** What the callback claims; only verify() decides that money moved. */
  status: "ok" | "cancelled" | "unknown";
  /** The callback's parameters as received, for the callback log (no card data). */
  raw: Record<string, string>;
}

export type GatewayVerifyResult =
  | { ok: true; providerReference: string; maskedCard?: string; paidAmountRial: bigint }
  | { ok: false; code: string; message: string };

export interface PaymentGatewayAdapter {
  /** The adapter key stored on the provider row (e.g. "zarinpal"). */
  readonly code: string;
  /** Hosts the customer may be sent to (https only); anything else is refused. */
  readonly redirectHosts: readonly string[];
  initiate(input: GatewayInitiateInput): Promise<{ providerToken: string; redirectUrl: string }>;
  parseCallback(request: Request): Promise<GatewayCallback>;
  verify(input: { amountRial: bigint; providerToken: string }): Promise<GatewayVerifyResult>;
}

/** Online attempts one order may start (failed and cancelled ones count). */
export const MAX_PAYMENT_ATTEMPTS = 10;

/** Our reference: letters, digits and underscores, sent to and returned by the gateway. */
export const OUR_REFERENCE = /^[a-z0-9_]{8,64}$/;

/** True when the URL is https on one of the adapter's hosts (http only for this site itself in development). */
export function isAllowedRedirect(url: string, hosts: readonly string[], ownOrigin: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.username || parsed.password) return false;
  if (parsed.origin === new URL(ownOrigin).origin) return true;
  return parsed.protocol === "https:" && hosts.includes(parsed.hostname);
}
