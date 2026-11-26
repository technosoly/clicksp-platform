/**
 * Escalation guards for managing admins and roles (rbac-security skill).
 * These rules are independent of permission data: even a role edited to hold
 * user.manage_admins cannot let a level 2 actor touch a Super Admin. The
 * database adds its own guards (permission level ceilings, protected system
 * roles, last Super Admin). Pure, no I/O.
 */
import { holds, type EffectivePermissions } from "./authorize";

export interface ManagingActor {
  userId: string;
  /** The actor's own admin level (1 Super Admin .. 3 Store Staff). */
  level: number;
  permissions: EffectivePermissions;
}

/**
 * The permission an actor needs to manage admin users of `targetLevel`, or
 * null when no permission could ever allow it:
 * - Store Staff accounts (level 3): user.manage_staff (or user.manage_admins);
 * - Business Admins and Super Admins (levels 1-2): user.manage_admins, and only
 *   a level 1 actor (user.manage_admins can only be held at level 1 anyway).
 * The actor must also outrank the target, except Super Admins managing Super
 * Admins (the database keeps the last one).
 */
export function userManagementPermission(actor: ManagingActor, targetLevel: number): string | null {
  if (!Number.isInteger(targetLevel) || targetLevel < 1 || targetLevel > 3) return null;
  if (targetLevel === 3) {
    if (actor.level >= 3) return null;
    if (holds(actor.permissions, "user.manage_staff")) return "user.manage_staff";
    if (holds(actor.permissions, "user.manage_admins")) return "user.manage_admins";
    return null;
  }
  if (actor.level !== 1) return null;
  return holds(actor.permissions, "user.manage_admins") ? "user.manage_admins" : null;
}

/** Levels of admin accounts the actor may see and manage (for lists and role pickers). */
export function manageableLevels(actor: ManagingActor): number[] {
  return [1, 2, 3].filter((level) => userManagementPermission(actor, level) !== null);
}

/**
 * A role's permissions may be edited only by an actor of a strictly higher
 * rank (lower level number), and never the Super Admin level itself: nobody
 * can change their own level's bundle through the UI.
 */
export function canEditRoleLevel(actorLevel: number, roleLevel: number): boolean {
  return roleLevel >= 2 && roleLevel <= 3 && actorLevel >= 1 && roleLevel > actorLevel;
}

/**
 * An actor may grant only permissions they hold themselves. A `.propose`
 * permission (a weaker, approval-gated form) counts as held when the actor
 * holds the permission it proposes, e.g. price.update covers price.update.propose.
 */
export function canGrantPermission(perms: EffectivePermissions, key: string): boolean {
  if (holds(perms, key)) return true;
  if (key.endsWith(".propose")) return holds(perms, key.slice(0, -".propose".length));
  return false;
}

/**
 * Keys of a role's grants the actor could not give themselves, so may not
 * assign the role to anyone (empty = assignable). An unscoped grant needs the
 * actor to hold that permission unscoped; a scoped grant starts with no scope
 * rows (deny) and needs the permission held in any form.
 */
export function ungrantableKeys(perms: EffectivePermissions, grants: readonly GrantChange[]): string[] {
  return grants
    .filter((g) => {
      if (!canGrantPermission(perms, g.key)) return true;
      if (g.isScoped) return false;
      const own = perms.get(g.key) ?? (g.key.endsWith(".propose") ? perms.get(g.key.slice(0, -".propose".length)) : undefined);
      return !own?.unscoped;
    })
    .map((g) => g.key);
}

export interface GrantChange {
  key: string;
  isScoped: boolean;
}

export interface GrantDiff {
  added: GrantChange[];
  removed: string[];
  rescoped: GrantChange[];
}

/** What changes between a role's current grants and the requested ones. */
export function diffGrants(current: readonly GrantChange[], next: readonly GrantChange[]): GrantDiff {
  const before = new Map(current.map((g) => [g.key, g.isScoped]));
  const after = new Map(next.map((g) => [g.key, g.isScoped]));
  const added: GrantChange[] = [];
  const rescoped: GrantChange[] = [];
  for (const [key, isScoped] of after) {
    if (!before.has(key)) added.push({ key, isScoped });
    else if (before.get(key) !== isScoped) rescoped.push({ key, isScoped });
  }
  const removed = [...before.keys()].filter((key) => !after.has(key));
  return { added, removed, rescoped };
}
