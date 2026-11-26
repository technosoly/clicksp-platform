/**
 * Required settings and their initial values. The system seed inserts a
 * setting only when its key is missing, so values changed by an admin are
 * never overwritten. Every value is a technical or safety default, not
 * business data: thresholds default to the strictest behaviour (0 = always
 * require approval / MFA), optional features default to off.
 *
 * Pure data. Erasable TypeScript only (runs under Node type stripping).
 * Phase 4/6 adds a Zod schema per key in the settings service.
 */

export type SettingValueType = "string" | "integer" | "boolean" | "json" | "money_rial";

export interface SettingDefinition {
  key: string;
  valueType: SettingValueType;
  /** JSON value stored in the `value` column. Rial amounts are decimal strings (bigint-safe). */
  value: unknown;
  description: string;
}

/** Managed by Business Admin (settings.store). */
export const STORE_SETTINGS: readonly SettingDefinition[] = [
  {
    key: "store.default_locale",
    valueType: "string",
    value: "fa",
    description: "Default storefront language.",
  },
  {
    key: "store.display_currency_unit",
    valueType: "string",
    value: "toman",
    description: "Unit used to display prices on the storefront: 'toman' or 'rial'. Storage is always Rial.",
  },
  {
    key: "catalog.show_unverified_fitment",
    valueType: "boolean",
    value: false,
    description: "Show unverified compatibility rows on the storefront (clearly labelled). Off: only verified fitment is shown.",
  },
  {
    key: "checkout.guest_checkout_enabled",
    valueType: "boolean",
    value: false,
    description: "Allow checkout without signing in.",
  },
  {
    key: "checkout.reservation_ttl_minutes",
    valueType: "integer",
    value: 20,
    description: "How long stock stays reserved while a customer pays.",
  },
  {
    key: "tax.enabled",
    valueType: "boolean",
    value: false,
    description: "Apply tax rules at checkout. Rates must be confirmed by an accountant before enabling.",
  },
  {
    key: "inventory.adjustment_approval_threshold_qty",
    valueType: "integer",
    value: 0,
    description: "Adjustments by users with only inventory.adjust.propose above this quantity need approval. 0 = every adjustment needs approval.",
  },
  {
    key: "refund.mfa_threshold_rial",
    valueType: "money_rial",
    value: "0",
    description: "Refunds above this amount (Rial) need a recent MFA check. 0 = every refund.",
  },
];

/** Managed by Super Admin (settings.system / settings.security). */
export const SYSTEM_SETTINGS: readonly SettingDefinition[] = [
  {
    key: "security.admin_session_idle_minutes",
    valueType: "integer",
    value: 30,
    description: "Admin session idle timeout.",
  },
  {
    key: "security.admin_session_absolute_hours",
    valueType: "integer",
    value: 12,
    description: "Admin session absolute lifetime.",
  },
  {
    key: "security.mfa_required_levels",
    valueType: "json",
    value: [1, 2],
    description: "Admin role levels that must enrol TOTP (1 Super Admin, 2 Business Admin).",
  },
  {
    key: "security.step_up_mfa_seconds",
    valueType: "integer",
    value: 300,
    description: "How recent an MFA check must be for sensitive actions.",
  },
  {
    key: "security.login_max_attempts_per_account",
    valueType: "integer",
    value: 5,
    description: "Failed logins per account within the window before rate limiting.",
  },
  {
    key: "security.login_max_attempts_per_ip",
    valueType: "integer",
    value: 20,
    description: "Failed logins per IP address within the window before rate limiting.",
  },
  {
    key: "security.login_window_minutes",
    valueType: "integer",
    value: 15,
    description: "Rate-limit window for login attempts.",
  },
  {
    key: "security.password_reset_ttl_minutes",
    valueType: "integer",
    value: 30,
    description: "Password reset token lifetime.",
  },
  {
    key: "security.approval_ttl_hours",
    valueType: "integer",
    value: 72,
    description: "Pending approvals expire after this many hours.",
  },
];
