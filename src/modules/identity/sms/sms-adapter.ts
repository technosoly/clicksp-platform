/**
 * SMS sending is pluggable (iranian-ecommerce skill, adapter-contracts.md).
 * No real provider is implemented yet: one will be added from the provider's
 * official documentation once the owner has an account and sandbox
 * credentials. Until then:
 * - "none" (default): sending is refused, so phone sign-in shows a clear
 *   "not available yet" message;
 * - "console": development only, writes the message to the server log;
 *   refused when NODE_ENV or APP_ENV is production.
 */
import { logger } from "@/lib/logger";
import { maskPhone } from "../domain/phone";

export interface SmsMessage {
  /** E.164 phone number. */
  to: string;
  text: string;
  /** Kind of message, for logs and provider templates. */
  purpose: "otp";
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
  provider: "none" | "console";
  nodeEnv: string | undefined;
  appEnv: string;
}): SmsSender {
  switch (config.provider) {
    case "console":
      return createConsoleSmsSender({ nodeEnv: config.nodeEnv, appEnv: config.appEnv });
    case "none":
      return disabledSmsSender;
  }
}
