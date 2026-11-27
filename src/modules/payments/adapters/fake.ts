import { randomBytes } from "node:crypto";
import type { GatewayCallback, GatewayVerifyResult, PaymentGatewayAdapter } from "../domain/gateway";

/**
 * A stand-in gateway for development and tests only: "paying" sends the
 * customer straight back to our callback, as if the bank page had been
 * completed. The registry refuses it in production. Its behaviour comes from
 * the provider row's config: { "behaviour": "pay" | "decline" | "underpay" }.
 */
export function fakeGateway(config: unknown): PaymentGatewayAdapter {
  const behaviour = (config as { behaviour?: string } | null)?.behaviour ?? "pay";
  return {
    code: "fake",
    redirectHosts: [],
    async initiate(input) {
      const providerToken = `fake_${randomBytes(12).toString("hex")}`;
      const url = new URL(input.callbackUrl);
      url.searchParams.set("ref", input.ourReference);
      url.searchParams.set("token", providerToken);
      url.searchParams.set("status", behaviour === "decline" ? "NOK" : "OK");
      return { providerToken, redirectUrl: url.toString() };
    },
    async parseCallback(request): Promise<GatewayCallback> {
      const params = new URL(request.url).searchParams;
      const raw = Object.fromEntries(["ref", "token", "status"].map((k) => [k, params.get(k) ?? ""]));
      return { ourReference: raw.ref!, providerToken: raw.token || undefined, status: raw.status === "OK" ? "ok" : raw.status === "NOK" ? "cancelled" : "unknown", raw };
    },
    async verify(input): Promise<GatewayVerifyResult> {
      if (!/^fake_[0-9a-f]{24}$/.test(input.providerToken)) return { ok: false, code: "unknown_token", message: "Unknown token" };
      if (behaviour === "decline") return { ok: false, code: "declined", message: "Declined by the fake gateway" };
      const amount = behaviour === "underpay" ? input.amountRial - 10n : input.amountRial;
      return { ok: true, providerReference: `FAKE${input.providerToken.slice(5, 17).toUpperCase()}`, maskedCard: "603799******0006", paidAmountRial: amount };
    },
  };
}
