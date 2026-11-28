/**
 * Kavenegar SMS adapter: sends sign-in codes with the Verify Lookup API
 * (a template approved in the Kavenegar panel, the code passed as `token`).
 *
 * Written from Kavenegar's official Node SDK and its README
 * (https://github.com/KaveNegar/kavenegar-node, which points to the REST
 * documentation at https://kavenegar.com/rest.html):
 *   POST https://api.kavenegar.com/v1/{API-KEY}/verify/lookup.json
 *   Content-Type: application/x-www-form-urlencoded; charset=UTF-8
 *   receptor=09xxxxxxxxx&token=<code>&template=<template name>
 * The answer is JSON: { return: { status, message }, entries }, where
 * return.status 200 means accepted and any other value is an error code.
 *
 * The API key is part of the URL path, so the URL is never logged and no
 * error message built here contains it.
 */
import type { SmsMessage, SmsSendResult, SmsSender } from "./sms-adapter";

export const KAVENEGAR_API_BASE = "https://api.kavenegar.com/v1";
const TIMEOUT_MS = 8_000;

export interface KavenegarConfig {
  apiKey: string;
  /** Name of the Verify template in the Kavenegar panel; its text holds %token. */
  otpTemplate: string;
  /** For tests. Defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/** Template names as the Kavenegar panel accepts them (letters, digits, - and _). */
export const KAVENEGAR_TEMPLATE_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;

/** +989121234567 → 09121234567 (the receptor format in Kavenegar's examples). */
export function toKavenegarReceptor(e164: string): string | null {
  return /^\+989\d{9}$/.test(e164) ? `0${e164.slice(3)}` : null;
}

interface KavenegarEntry {
  messageid?: number | string;
}

interface KavenegarResponse {
  return?: { status?: number; message?: string };
  entries?: KavenegarEntry | KavenegarEntry[];
}

function firstMessageId(entries: KavenegarResponse["entries"]): string | undefined {
  const entry = Array.isArray(entries) ? entries[0] : entries;
  return entry?.messageid !== undefined ? String(entry.messageid) : undefined;
}

export function createKavenegarSmsSender(config: KavenegarConfig): SmsSender {
  const apiKey = config.apiKey.trim();
  const template = config.otpTemplate.trim();
  if (!apiKey || /\s/.test(apiKey)) throw new Error("KAVENEGAR_API_KEY is missing or malformed");
  if (!KAVENEGAR_TEMPLATE_PATTERN.test(template)) {
    throw new Error("KAVENEGAR_OTP_TEMPLATE is missing or malformed");
  }
  const doFetch = config.fetchImpl ?? fetch;
  const url = `${KAVENEGAR_API_BASE}/${encodeURIComponent(apiKey)}/verify/lookup.json`;

  return {
    name: "kavenegar",
    enabled: true,
    async send(message: SmsMessage): Promise<SmsSendResult> {
      const receptor = toKavenegarReceptor(message.to);
      if (!receptor) return { ok: false, error: "kavenegar: not an Iranian mobile number" };
      // Verify tokens may not contain spaces; sign-in codes are digits only.
      if (!/^\d{4,10}$/.test(message.code)) return { ok: false, error: "kavenegar: invalid code" };

      const body = new URLSearchParams({ receptor, token: message.code, template });
      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json" },
          body: body.toString(),
          signal: AbortSignal.timeout(config.timeoutMs ?? TIMEOUT_MS),
          cache: "no-store",
          // The endpoint never redirects; refuse to follow one anywhere else.
          redirect: "error",
        });
      } catch (error) {
        // Only the error's name (TimeoutError, TypeError, ...): a network
        // error's message or cause could repeat the URL with the key in it.
        const name = error instanceof Error ? error.name : "Error";
        return { ok: false, error: `kavenegar: request failed (${name})` };
      }

      let json: KavenegarResponse | undefined;
      try {
        json = (await response.json()) as KavenegarResponse;
      } catch {
        json = undefined;
      }
      const status = typeof json?.return?.status === "number" ? json.return.status : undefined;
      if (response.ok && status === 200) {
        return { ok: true, providerMessageId: firstMessageId(json?.entries) };
      }
      // Kavenegar's error codes (e.g. 418 low credit, 424 template not found)
      // are listed in its REST docs; the code is enough to look it up.
      return { ok: false, error: `kavenegar: refused (http ${response.status}, status ${status ?? "none"})` };
    },
  };
}
