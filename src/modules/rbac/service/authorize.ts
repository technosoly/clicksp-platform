import "server-only";
import { db } from "@/lib/db";
import { recordSecurityEvent } from "@/modules/audit/service/audit";
import { isMfaFresh, type SecurityPolicy } from "@/modules/identity/domain/policy";
import { getSecurityPolicy } from "@/modules/settings/service/security-policy";
import type { Actor } from "../domain/actor";
import { buildEffectivePermissions, decide, type EffectivePermissions, type ResourceScope } from "../domain/authorize";
import { loadGrantRows } from "../repo/rbac-repo";

export class AuthzError extends Error {
  readonly status = 403;
  constructor(
    readonly permission: string,
    readonly reason: string,
  ) {
    super(`Forbidden: ${permission}`);
    this.name = "AuthzError";
  }
}

/** The permission needs a recent TOTP check; the UI sends the admin to re-verify. */
export class MfaRequiredError extends Error {
  readonly status = 403;
  constructor(readonly permission: string) {
    super(`Recent MFA required: ${permission}`);
    this.name = "MfaRequiredError";
  }
}

/** Effective permissions of a user right now (active roles, unexpired assignments). */
export async function loadEffectivePermissions(userId: string, now = new Date()): Promise<EffectivePermissions> {
  return buildEffectivePermissions(await loadGrantRows(db(), userId, now));
}

/**
 * The authorization gate every service method calls first. Deny by default:
 * a denial writes a security_events row and throws AuthzError. Permissions
 * marked requiresMfa also need a TOTP check within the step-up window.
 */
export async function authorize(
  actor: Actor,
  permission: string,
  resource?: ResourceScope & { type?: string; id?: string },
  options: { now?: Date; policy?: SecurityPolicy } = {},
): Promise<void> {
  const decision = actor.kind === "system" ? { allowed: true as const, requiresMfa: false } : decide(actor.permissions, permission, resource);
  if (!decision.allowed) {
    await recordSecurityEvent(actor.meta, {
      type: "authz.denied",
      severity: "warning",
      userId: actor.userId,
      details: { permission, reason: decision.reason, resourceType: resource?.type, resourceId: resource?.id },
    });
    throw new AuthzError(permission, decision.reason);
  }
  if (decision.requiresMfa) {
    const policy = options.policy ?? (await getSecurityPolicy());
    if (!isMfaFresh(actor.mfaVerifiedAt, options.now ?? new Date(), policy)) {
      await recordSecurityEvent(actor.meta, {
        type: "authz.mfa_step_up_required",
        severity: "info",
        userId: actor.userId,
        details: { permission },
      });
      throw new MfaRequiredError(permission);
    }
  }
}
