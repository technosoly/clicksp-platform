import type { RequestMeta } from "@/lib/http/request-meta";
import type { EffectivePermissions } from "./authorize";

/**
 * Who performs an action. Built on the server from the session only; never
 * from anything the client sends. Every service method receives one.
 */
export interface Actor {
  kind: "admin" | "customer" | "system";
  userId: string | null;
  sessionId: string | null;
  /** Lowest active admin role level (1 Super Admin .. 3 Store Staff); null for customers. */
  level: number | null;
  permissions: EffectivePermissions;
  /** When this session last passed a TOTP check (step-up MFA). */
  mfaVerifiedAt: Date | null;
  meta: RequestMeta;
}
