import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { setMyName } from "@/modules/identity/service/current-customer";
import { makeMyDefaultAddress, myAddresses, removeMyAddress } from "@/modules/sales/service/addresses";
import { q } from "./admin-actors";

afterAll(async () => {
  await prisma().$disconnect();
});

async function customer() {
  const phone = `+98912${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
  const [u] = await q<{ id: string }>("INSERT INTO users (phone_number) VALUES ($1) RETURNING id", [phone]);
  return { userId: u!.id, phone, name: null };
}

async function address(userId: string, isDefault: boolean, line: string) {
  const [a] = await q<{ id: string }>(
    `INSERT INTO delivery_addresses (user_id, recipient_name, phone, province_code, province, city, address_line, postal_code, is_default)
     VALUES ($1, 'TEST گیرنده', '+989121234567', 'IR-10', 'اصفهان', 'اصفهان', $2, '8134567890', $3) RETURNING id`,
    [userId, line, isDefault],
  );
  return a!.id;
}

describe("the customer's account", () => {
  it("lists, defaults and removes only the customer's own addresses", async () => {
    const me = await customer();
    const other = await customer();
    const first = await address(me.userId, true, "TEST نشانی ۱");
    const second = await address(me.userId, false, "TEST نشانی ۲");
    const theirs = await address(other.userId, true, "TEST نشانی دیگری");

    const listed = await myAddresses(me);
    expect(listed.map((a) => a.id).sort()).toEqual([first, second].sort());
    expect(listed[0]!.id).toBe(first);

    expect(await makeMyDefaultAddress(me, second)).toBe(true);
    const after = await myAddresses(me);
    expect(after.find((a) => a.isDefault)!.id).toBe(second);
    expect(after.filter((a) => a.isDefault)).toHaveLength(1);

    // Someone else's address: no effect, no hint it exists.
    expect(await makeMyDefaultAddress(me, theirs)).toBe(false);
    expect(await removeMyAddress(me, theirs)).toBe(false);
    expect((await myAddresses(other)).map((a) => a.id)).toEqual([theirs]);
    expect(await removeMyAddress(me, "not-a-uuid")).toBe(false);

    expect(await removeMyAddress(me, second)).toBe(true);
    expect(await removeMyAddress(me, second)).toBe(false);
    expect((await myAddresses(me)).map((a) => a.id)).toEqual([first]);
    // A removed address can't be made the default again.
    expect(await makeMyDefaultAddress(me, second)).toBe(false);
  });

  it("sets the customer's own name, normalized and limited in length", async () => {
    const me = await customer();
    expect(await setMyName(me, "  TEST علي  ")).toEqual({ status: "ok" });
    const [row] = await q<{ name: string }>("SELECT name FROM users WHERE id = $1", [me.userId]);
    expect(row!.name).toBe("TEST علی");
    expect(await setMyName(me, "ب".repeat(121))).toEqual({ status: "invalid" });
  });
});
