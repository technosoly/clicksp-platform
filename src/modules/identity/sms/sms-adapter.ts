/**
 * SMS sending is pluggable (iranian-ecommerce skill, adapter-contracts.md):
 * - "none" (default): sending is refused, so phone sign-in shows a clear
 *   "not available yet" message;
 * - "console": development only, writes the message to the server log;
 *   refused when NODE_ENV or APP_ENV is production;
 * - "kavenegar": Kavenegar Verify Lookup with an approved template
 *   (KAVENEGAR_API_KEY, KAVENEGAR_OTP_TEMPLATE; see kavenegar.ts).
 */
import { logger } from "@/lib/logger";
import { maskPhone } from "../domain/phone";
import { createKavenegarSmsSender } from "./kavenegar";

export interface SmsMessage {
  /** E.164 phone number. */
  to: string;
  /** Full text, for providers that send free text (and the console provider). */
  text: string;
  /** Kind of message, for logs and provider templates. */
  purpose: "otp";
  /** The one-time code, for template providers that fill it in themselves. */
  code: string;
}

export interface SmsSendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface SmsSender {
  readonly name: string;
  /** False when no provider is configured: callers show "not available". */
  readonly enabled: boolean;
  send(message: SmsMessage): Promise<SmsSendResult>;
}

export class SmsNotConfiguredError extends Error {
  constructor() {
    super("No SMS provider is configured (SMS_PROVIDER=none)");
    this.name = "SmsNotConfiguredError";
  }
}

export const disabledSmsSender: SmsSender = {
  name: "none",
  enabled: false,
  async send() {
    throw new SmsNotConfiguredError();
  },
};

export function createConsoleSmsSender(environment: { nodeEnv: string | undefined; appEnv: string }): SmsSender {
  if (environment.nodeEnv === "production" || environment.appEnv === "production") {
    throw new Error("The console SMS provider must not be used in production");
  }
  return {
    name: "console",
    enabled: true,
    async send(message) {
      // Development only: the code is printed so a developer can sign in
      // without an SMS account. The phone number is masked.
      logger.warn("DEV SMS (console provider, not sent)", {
        to: maskPhone(message.to),
        purpose: message.purpose,
        text: message.text,
      });
      return { ok: true, providerMessageId: `console-${Date.now()}` };
    },
  };
}

export function createSmsSender(config: {
  provider: "none" | "console" | "kavenegar";
  nodeEnv: string | undefined;
  appEnv: string;
  kavenegar?: { apiKey: string | undefined; otpTemplate: string | undefined };
}): SmsSender {
  switch (config.provider) {
    case "console":
      return createConsoleSmsSender({ nodeEnv: config.nodeEnv, appEnv: config.appEnv });
    case "kavenegar":
      // Throws (names the variable, never its value) when either is missing.
      return createKavenegarSmsSender({
        apiKey: config.kavenegar?.apiKey ?? "",
        otpTemplate: config.kavenegar?.otpTemplate ?? "",
      });
    case "none":
      return disabledSmsSender;
  }
}
