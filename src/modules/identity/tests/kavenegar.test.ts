import { describe, expect, it, vi } from "vitest";
import { createKavenegarSmsSender, toKavenegarReceptor } from "../sms/kavenegar";
import { createSmsSender, type SmsMessage } from "../sms/sms-adapter";

const API_KEY = "TEST-ONLY-NOT-A-REAL-KEY-6A4B";
const message: SmsMessage = { to: "+989121234567", text: "code 123456", purpose: "otp", code: "123456" };

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function sender(fetchImpl: typeof fetch) {
  return createKavenegarSmsSender({ apiKey: API_KEY, otpTemplate: "clicksp-login", fetchImpl });
}

describe("Kavenegar SMS adapter", () => {
  it("converts E.164 numbers to the 09... receptor form", () => {
    expect(toKavenegarReceptor("+989121234567")).toBe("09121234567");
    expect(toKavenegarReceptor("+441234567890")).toBeNull();
    expect(toKavenegarReceptor("09121234567")).toBeNull();
  });

  it("posts receptor, token and template to verify/lookup", async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({ return: { status: 200, message: "تایید شد" }, entries: [{ messageid: 8792343, status: 5 }] }),
    );
    const result = await sender(fetchImpl as unknown as typeof fetch).send(message);
    expect(result).toEqual({ ok: true, providerMessageId: "8792343" });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://api.kavenegar.com/v1/${API_KEY}/verify/lookup.json`);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["Content-Type"]).toContain("application/x-www-form-urlencoded");
    const body = new URLSearchParams(String(init.body));
    expect(Object.fromEntries(body)).toEqual({ receptor: "09121234567", token: "123456", template: "clicksp-login" });
    // The free text is not sent: the approved template holds the wording.
    expect(String(init.body)).not.toContain("code");
  });

  it("accepts entries as a single object (as in the SDK's example)", async () => {
    const fetchImpl = async () => jsonResponse({ return: { status: 200 }, entries: { messageid: 42 } });
    expect(await sender(fetchImpl as typeof fetch).send(message)).toEqual({ ok: true, providerMessageId: "42" });
  });

  it("reports Kavenegar error codes without the key", async () => {
    const fetchImpl = async () => jsonResponse({ return: { status: 424, message: "..." }, entries: null }, 424);
    const result = await sender(fetchImpl as typeof fetch).send(message);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("424");
    expect(result.error).not.toContain(API_KEY);
  });

  it("treats a 200 HTTP answer with a non-200 status as a failure", async () => {
    const fetchImpl = async () => jsonResponse({ return: { status: 418 } });
    expect((await sender(fetchImpl as typeof fetch).send(message)).ok).toBe(false);
  });

  it("handles non-JSON answers", async () => {
    const fetchImpl = async () => new Response("<html>bad gateway</html>", { status: 502 });
    const result = await sender(fetchImpl as typeof fetch).send(message);
    expect(result).toEqual({ ok: false, error: "kavenegar: refused (http 502, status none)" });
  });

  it("never puts the key in network error messages", async () => {
    const fetchImpl = async () => {
      throw new TypeError(`fetch failed for https://api.kavenegar.com/v1/${API_KEY}/verify/lookup.json`);
    };
    const result = await sender(fetchImpl as typeof fetch).send(message);
    expect(result).toEqual({ ok: false, error: "kavenegar: request failed (TypeError)" });
  });

  it("gives up after the timeout", async () => {
    const fetchImpl = (_url: string | URL | Request, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal!.reason));
      });
    const slow = createKavenegarSmsSender({ apiKey: API_KEY, otpTemplate: "t", fetchImpl: fetchImpl as typeof fetch, timeoutMs: 20 });
    const result = await slow.send(message);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("TimeoutError");
  });

  it("refuses numbers and codes it should not send, without calling the API", async () => {
    const fetchImpl = vi.fn();
    const s = sender(fetchImpl as unknown as typeof fetch);
    expect((await s.send({ ...message, to: "+441234567890" })).ok).toBe(false);
    expect((await s.send({ ...message, code: "12 34" })).ok).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("refuses to start without a key or a valid template, naming the variable but not the value", () => {
    expect(() => createKavenegarSmsSender({ apiKey: "", otpTemplate: "t" })).toThrow(/KAVENEGAR_API_KEY/);
    expect(() => createKavenegarSmsSender({ apiKey: API_KEY, otpTemplate: "" })).toThrow(/KAVENEGAR_OTP_TEMPLATE/);
    expect(() => createKavenegarSmsSender({ apiKey: API_KEY, otpTemplate: "bad name&x=1" })).toThrow(/KAVENEGAR_OTP_TEMPLATE/);
    try {
      createKavenegarSmsSender({ apiKey: API_KEY, otpTemplate: "" });
    } catch (error) {
      expect(String(error)).not.toContain(API_KEY);
    }
  });

  it("is selected by SMS_PROVIDER=kavenegar, also in production", () => {
    const s = createSmsSender({
      provider: "kavenegar",
      nodeEnv: "production",
      appEnv: "production",
      kavenegar: { apiKey: API_KEY, otpTemplate: "clicksp-login" },
    });
    expect(s.name).toBe("kavenegar");
    expect(s.enabled).toBe(true);
    expect(() => createSmsSender({ provider: "kavenegar", nodeEnv: "production", appEnv: "production" })).toThrow(
      /KAVENEGAR_API_KEY/,
    );
  });
});
