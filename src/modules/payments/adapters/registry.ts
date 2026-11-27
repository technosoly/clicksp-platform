import "server-only";
import { enabledPaymentAdapters, env } from "@/lib/env";
import type { PaymentGatewayAdapter } from "../domain/gateway";
import { fakeGateway } from "./fake";

/**
 * The gateway adapters this code base has. A real provider (Zarinpal, Zibal,
 * ...) is added here once its adapter is written from the official docs and
 * tested with the store's sandbox credentials. An adapter is usable only when
 * PAYMENT_PROVIDERS lists it; "fake" never in production.
 */
/**
 * The fake gateway "pays" without money, so it only runs in development on a
 * local address (tests, the developer's machine). A real deployment has a
 * real domain, so a forgotten APP_ENV or a stray PAYMENT_PROVIDERS=fake still
 * can't switch it on.
 */
function fakeAllowed(): boolean {
  const { APP_ENV, APP_URL } = env();
  return APP_ENV === "development" && ["localhost", "127.0.0.1", "[::1]"].includes(new URL(APP_URL).hostname);
}

const ADAPTERS: Record<string, { create: (config: unknown, credentialsPrefix: string | null) => PaymentGatewayAdapter | null }> = {
  fake: { create: (config) => (fakeAllowed() ? fakeGateway(config) : null) },
};

/** Adapter keys this server may use right now. */
export function availableAdapterKeys(): string[] {
  return enabledPaymentAdapters().filter((key) => key in ADAPTERS && (key !== "fake" || fakeAllowed()));
}

/** The adapter for a provider row, or null when this server can't use it. */
export function loadAdapter(provider: { adapterKey: string; config: unknown; credentialsEnvPrefix: string | null }): PaymentGatewayAdapter | null {
  if (!availableAdapterKeys().includes(provider.adapterKey)) return null;
  return ADAPTERS[provider.adapterKey]!.create(provider.config, provider.credentialsEnvPrefix);
}
