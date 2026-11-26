/** Role display name: translated for the system roles, the stored name for custom roles. */
const SYSTEM_LABELS: Record<string, string> = { super_admin: "superAdmin", business_admin: "businessAdmin", store_staff: "storeStaff" };

export function roleLabel(t: (key: string) => string, role: { key: string; name: string; isSystem: boolean }): string {
  const label = role.isSystem ? SYSTEM_LABELS[role.key] : undefined;
  return label ? t(`levels.${label}`) : role.name;
}

export const LEVEL_KEYS: Record<number, string> = { 1: "superAdmin", 2: "businessAdmin", 3: "storeStaff" };
