import "server-only";
import { db, transaction } from "@/lib/db";
import {
  MoneyError,
  parseMoneyInput,
  type DisplayUnit,
  type Rial,
} from "@/lib/money";
import { recordAudit } from "@/modules/audit/service/audit";
import type { Actor } from "@/modules/rbac/domain/actor";
import { authorize, AuthzError } from "@/modules/rbac/service/authorize";
import { getDisplayUnit } from "@/modules/settings/service/catalog-settings";
import {
  methodInputSchema,
  rateInputSchema,
  zoneInputSchema,
  type MethodInput,
  type RateInput,
  type ZoneInput,
} from "../domain/shipping-input";
import {
  deleteRate,
  getMethod,
  getRate,
  getZone,
  insertMethod,
  insertRate,
  insertZone,
  isUniqueViolation,
  listMethods,
  listZones,
  updateMethodRow,
  updateZoneRow,
  type Tx,
} from "../repo/shipping-repo";

/**
 * Shipping settings (shipping.configure: Super and Business Admin): zones of
 * provinces, the store's own delivery methods, and each method's price per
 * zone. Every change is audited.
 */

export type ShippingResult =
  | { status: "ok"; id: string }
  | { status: "not_found" }
  | { status: "invalid"; field: string }
  | { status: "taken" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Audit rows are JSON: amounts are written as strings of Rial. */
const plain = (value: unknown): unknown =>
  value === undefined
    ? undefined
    : JSON.parse(
        JSON.stringify(value, (_k, v: unknown) =>
          typeof v === "bigint" ? v.toString() : v,
        ),
      );
const first = (issues: { message: string }[]) =>
  issues[0]?.message ?? "invalid";

async function allow(actor: Actor): Promise<string> {
  if (actor.kind !== "admin" || !actor.userId)
    throw new AuthzError("shipping.configure", "not_admin");
  await authorize(actor, "shipping.configure");
  return actor.userId;
}

async function write(
  actor: Actor,
  userId: string,
  action: string,
  entityType: string,
  fn: (tx: Tx) => Promise<{ id: string; before?: unknown }>,
  after: unknown,
): Promise<ShippingResult> {
  try {
    const id = await transaction(async (tx) => {
      const { id, before } = await fn(tx);
      await recordAudit(tx, actor.meta, {
        actorUserId: userId,
        action,
        entityType,
        entityId: id,
        before: plain(before),
        after: plain(after),
      });
      return id;
    });
    return { status: "ok", id };
  } catch (error) {
    if (isUniqueViolation(error)) return { status: "taken" };
    throw error;
  }
}

export async function shippingOverview(actor: Actor) {
  await allow(actor);
  const [zones, methods] = await Promise.all([
    listZones(db()),
    listMethods(db()),
  ]);
  return { zones, methods };
}

export async function zoneForAdmin(actor: Actor, id: string) {
  await allow(actor);
  return UUID.test(id) ? getZone(db(), id) : null;
}

export async function methodForAdmin(actor: Actor, id: string) {
  await allow(actor);
  if (!UUID.test(id)) return null;
  const [method, zones, unit] = await Promise.all([
    getMethod(db(), id),
    listZones(db()),
    getDisplayUnit(),
  ]);
  return method ? { method, zones, unit } : null;
}

export async function createZone(
  actor: Actor,
  input: ZoneInput,
): Promise<ShippingResult> {
  const userId = await allow(actor);
  const parsed = zoneInputSchema.safeParse(input);
  if (!parsed.success)
    return { status: "invalid", field: first(parsed.error.issues) };
  return write(
    actor,
    userId,
    "shipping.zone_created",
    "shipping_zone",
    async (tx) => ({ id: await insertZone(tx, parsed.data) }),
    parsed.data,
  );
}

export async function updateZone(
  actor: Actor,
  id: string,
  input: ZoneInput,
): Promise<ShippingResult> {
  const userId = await allow(actor);
  if (!UUID.test(id)) return { status: "not_found" };
  const parsed = zoneInputSchema.safeParse(input);
  if (!parsed.success)
    return { status: "invalid", field: first(parsed.error.issues) };
  const before = await getZone(db(), id);
  if (!before) return { status: "not_found" };
  return write(
    actor,
    userId,
    "shipping.zone_updated",
    "shipping_zone",
    async (tx) => (await updateZoneRow(tx, id, parsed.data), { id, before }),
    parsed.data,
  );
}

export async function createMethod(
  actor: Actor,
  input: MethodInput,
): Promise<ShippingResult> {
  const userId = await allow(actor);
  const parsed = methodInputSchema.safeParse(input);
  if (!parsed.success)
    return { status: "invalid", field: first(parsed.error.issues) };
  return write(
    actor,
    userId,
    "shipping.method_created",
    "shipping_method",
    async (tx) => ({ id: await insertMethod(tx, parsed.data) }),
    parsed.data,
  );
}

export async function updateMethod(
  actor: Actor,
  id: string,
  input: MethodInput,
): Promise<ShippingResult> {
  const userId = await allow(actor);
  if (!UUID.test(id)) return { status: "not_found" };
  const parsed = methodInputSchema.safeParse(input);
  if (!parsed.success)
    return { status: "invalid", field: first(parsed.error.issues) };
  const before = await getMethod(db(), id);
  if (!before) return { status: "not_found" };
  return write(
    actor,
    userId,
    "shipping.method_updated",
    "shipping_method",
    async (tx) => (
      await updateMethodRow(tx, id, parsed.data),
      { id, before: { ...before, rates: undefined } }
    ),
    parsed.data,
  );
}

function amount(
  value: string,
  unit: DisplayUnit,
  allowEmpty: boolean,
): Rial | null | "invalid" {
  if (value.trim() === "") return allowEmpty ? null : "invalid";
  try {
    const parsed = parseMoneyInput(value, unit);
    return parsed < 0n ? "invalid" : parsed;
  } catch (error) {
    if (error instanceof MoneyError) return "invalid";
    throw error;
  }
}

export async function addRate(
  actor: Actor,
  methodId: string,
  input: RateInput,
): Promise<ShippingResult> {
  const userId = await allow(actor);
  if (!UUID.test(methodId)) return { status: "not_found" };
  const parsed = rateInputSchema.safeParse(input);
  if (!parsed.success)
    return { status: "invalid", field: first(parsed.error.issues) };
  const unit = await getDisplayUnit();
  const base = amount(parsed.data.baseAmount, unit, false);
  const perKg = amount(parsed.data.perKgAmount, unit, true);
  const free = amount(parsed.data.freeAbove, unit, true);
  if (
    base === "invalid" ||
    base === null ||
    perKg === "invalid" ||
    free === "invalid" ||
    free === 0n
  )
    return { status: "invalid", field: "invalid_amount" };
  const [method, zone] = await Promise.all([
    getMethod(db(), methodId),
    getZone(db(), parsed.data.zoneId),
  ]);
  if (!method) return { status: "not_found" };
  if (!zone) return { status: "invalid", field: "zone_required" };
  const rate = {
    zoneId: zone.id,
    baseAmount: base,
    perKgAmount: perKg ?? 0n,
    freeAboveSubtotal: free,
    minWeightGrams: parsed.data.minWeightGrams ?? 0,
    maxWeightGrams: parsed.data.maxWeightGrams,
  };
  return write(
    actor,
    userId,
    "shipping.rate_created",
    "shipping_rate",
    async (tx) => ({ id: await insertRate(tx, methodId, rate) }),
    { methodId, ...rate },
  );
}

export async function removeRate(
  actor: Actor,
  methodId: string,
  rateId: string,
): Promise<ShippingResult> {
  const userId = await allow(actor);
  if (!UUID.test(rateId) || !UUID.test(methodId))
    return { status: "not_found" };
  const before = await getRate(db(), rateId);
  if (!before || before.methodId !== methodId) return { status: "not_found" };
  return write(
    actor,
    userId,
    "shipping.rate_deleted",
    "shipping_rate",
    async (tx) => (await deleteRate(tx, rateId), { id: rateId, before }),
    null,
  );
}
