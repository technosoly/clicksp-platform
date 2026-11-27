import { describe, expect, it } from "vitest";
import { fakeGateway } from "../adapters/fake";
import { isAllowedRedirect } from "../domain/gateway";

describe("gateway redirects", () => {
  const own = "https://clicksp.example";
  it("allows only https on the adapter's hosts, or this site", () => {
    expect(isAllowedRedirect("https://pay.example/start/abc", ["pay.example"], own)).toBe(true);
    expect(isAllowedRedirect("http://pay.example/start/abc", ["pay.example"], own)).toBe(false);
    expect(isAllowedRedirect("https://evil.example/", ["pay.example"], own)).toBe(false);
    expect(isAllowedRedirect("https://user:pw@pay.example/", ["pay.example"], own)).toBe(false);
    expect(isAllowedRedirect("https://clicksp.example/api/webhooks/payments/fake?x=1", [], own)).toBe(true);
    expect(isAllowedRedirect("javascript:alert(1)", ["pay.example"], own)).toBe(false);
    expect(isAllowedRedirect("not a url", ["pay.example"], own)).toBe(false);
  });
});

describe("the fake gateway", () => {
  it("sends the customer straight back and verifies the exact amount", async () => {
    const gateway = fakeGateway({});
    const started = await gateway.initiate({ amountRial: 1_250_000n, ourReference: "pay_1_abcdef12", callbackUrl: "http://127.0.0.1:3100/api/webhooks/payments/fake", description: "x" });
    const callback = await gateway.parseCallback(new Request(started.redirectUrl));
    expect(callback).toMatchObject({ ourReference: "pay_1_abcdef12", providerToken: started.providerToken, status: "ok" });
    expect(await gateway.verify({ amountRial: 1_250_000n, providerToken: started.providerToken })).toMatchObject({ ok: true, paidAmountRial: 1_250_000n });
    expect(await gateway.verify({ amountRial: 1n, providerToken: "forged" })).toMatchObject({ ok: false });
  });

  it("can decline or underpay, for tests", async () => {
    const declined = fakeGateway({ behaviour: "decline" });
    const started = await declined.initiate({ amountRial: 100n, ourReference: "pay_1_abcdef12", callbackUrl: "http://x.test/cb", description: "x" });
    expect((await declined.parseCallback(new Request(started.redirectUrl))).status).toBe("cancelled");
    const under = fakeGateway({ behaviour: "underpay" });
    expect(await under.verify({ amountRial: 100n, providerToken: "fake_000000000000000000000000" })).toMatchObject({ ok: true, paidAmountRial: 90n });
  });
});
