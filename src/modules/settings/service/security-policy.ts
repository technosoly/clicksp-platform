import "server-only";
import { z } from "zod";
import { db } from "@/lib/db";
import { DEFAULT_SECURITY_POLICY, type SecurityPolicy } from "@/modules/identity/domain/policy";
import { readSystemSettings } from "../repo/settings-repo";

const int = (min: number, max: number) => z.number().int().min(min).max(max);

/** Each setting is validated; an invalid or missing value falls back to the safe default. */
const FIELDS = {
  "security.admin_session_idle_minutes": ["adminIdleMinutes", int(5, 240)],
  "security.admin_session_absolute_hours": ["adminAbsoluteHours", int(1, 72)],
  "security.mfa_required_levels": ["mfaRequiredLevels", z.array(int(1, 3)).max(3)],
  "security.step_up_mfa_seconds": ["stepUpMfaSeconds", int(60, 3600)],
  "security.login_max_attempts_per_account": ["loginMaxPerAccount", int(3, 50)],
  "security.login_max_attempts_per_ip": ["loginMaxPerIp", int(5, 500)],
  "security.login_window_minutes": ["loginWindowMinutes", int(1, 1440)],
} as const satisfies Record<string, readonly [keyof SecurityPolicy, z.ZodType]>;

/**
 * Security policy from system_settings. Read by the authentication services
 * themselves (a system read, not a user action), so there is no actor.
 * Levels 1 and 2 always need MFA, whatever the setting says.
 */
export async function getSecurityPolicy(): Promise<SecurityPolicy> {
  const values = await readSystemSettings(db(), Object.keys(FIELDS));
  const policy: SecurityPolicy = { ...DEFAULT_SECURITY_POLICY };
  for (const [key, [field, schema]] of Object.entries(FIELDS)) {
    const parsed = schema.safeParse(values.get(key));
    if (parsed.success) (policy as unknown as Record<string, unknown>)[field] = parsed.data;
  }
  policy.mfaRequiredLevels = [...new Set([1, 2, ...policy.mfaRequiredLevels])];
  return policy;
}
