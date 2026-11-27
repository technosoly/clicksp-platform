import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { setProductStatus } from "@/modules/catalog/service/products";
import { MAX_OUTBOX_ATTEMPTS, type OutboxEvent } from "@/modules/jobs/domain/outbox";
import { dispatchOutbox } from "@/modules/jobs/service/outbox";
import { OUTBOX_HANDLERS } from "@/modules/jobs/service/handlers";
import { meili, meiliConfig } from "@/modules/search/adapters/meilisearch";
import { PRODUCT_INDEX } from "@/modules/search/domain/product-document";
import { rebuildProductIndex, searchStore } from "@/modules/search/service/product-search";
import { q } from "./admin-actors";
import { uid } from "./helpers";
import { ok, part, setup } from "./order-fixtures";

afterAll(async () => {
  await prisma().$disconnect();
});

const pendingSearchEvents = async (productId: string) =>
  q<{ id: string; status: string }>("SELECT id, status FROM outbox_events WHERE topic = 'search.product_changed' AND aggregate_id = $1 AND status = 'pending'", [productId]);

/** An event of a topic only these tests use, so other suites' events are never touched. */
async function testEvent(topic: string): Promise<string> {
  const [row] = await q<{ id: string }>("INSERT INTO outbox_events (topic, aggregate_type, aggregate_id, payload) VALUES ($1, 'test', gen_random_uuid(), '{}') RETURNING id", [topic]);
  return row!.id;
}
const eventRow = async (id: string) => (await q<{ status: string; attempts: number; last_error: string | null; available_at: Date }>("SELECT status, attempts, last_error, available_at FROM outbox_events WHERE id = $1", [id]))[0]!;

describe("outbox delivery", () => {
  it("marks handled events done and leaves topics without a handler alone", async () => {
    const topic = `test.ok.${uid()}`;
    const id = await testEvent(topic);
    const other = await testEvent(`test.unhandled.${uid()}`);
    const seen: OutboxEvent[] = [];
    const counts = await dispatchOutbox(new Map([[topic, async (e: OutboxEvent) => void seen.push(e)]]));
    expect(counts.done).toBe(1);
    expect(seen.map((e) => e.id)).toEqual([id]);
    expect(await eventRow(id)).toMatchObject({ status: "done", attempts: 1, last_error: null });
    expect(await eventRow(other)).toMatchObject({ status: "pending", attempts: 0 });
  });

  it("retries a failing handler later and parks the event after the last attempt", async () => {
    const topic = `test.fail.${uid()}`;
    const id = await testEvent(topic);
    const failing = new Map([[topic, async () => Promise.reject(new Error("provider down"))]]);
    const t0 = new Date();
    expect((await dispatchOutbox(failing, { now: () => t0 })).retried).toBe(1);
    const retry = await eventRow(id);
    expect(retry).toMatchObject({ status: "pending", attempts: 1, last_error: "provider down" });
    expect(retry.available_at.getTime()).toBe(t0.getTime() + 30_000);
    // Not due yet: nothing happens.
    expect(await dispatchOutbox(failing, { now: () => t0 })).toEqual({ done: 0, retried: 0, failed: 0 });

    await q("UPDATE outbox_events SET attempts = $2, available_at = now() - interval '1 second' WHERE id = $1", [id, MAX_OUTBOX_ATTEMPTS - 1]);
    expect((await dispatchOutbox(failing)).failed).toBe(1);
    expect(await eventRow(id)).toMatchObject({ status: "failed", attempts: MAX_OUTBOX_ATTEMPTS });
  });

  it("hands an event to one runner only when two run at once, and takes over an expired lease", async () => {
    const topic = `test.once.${uid()}`;
    const id = await testEvent(topic);
    let calls = 0;
    const slow = new Map([[topic, async () => {
      calls++;
      await new Promise((r) => setTimeout(r, 200));
    }]]);
    await Promise.all([dispatchOutbox(slow), dispatchOutbox(slow), dispatchOutbox(slow)]);
    expect(calls).toBe(1);
    expect((await eventRow(id)).status).toBe("done");

    // A runner that died mid-event: the lease runs out and the event is delivered again.
    const stuck = await testEvent(topic);
    await q("UPDATE outbox_events SET status = 'processing', attempts = 1, available_at = now() - interval '1 second' WHERE id = $1", [stuck]);
    await dispatchOutbox(slow);
    expect(await eventRow(stuck)).toMatchObject({ status: "done", attempts: 2 });
  });
});

describe("search index upkeep", () => {
  it("writes one waiting event per product however many of its rows change", async () => {
    const { productId } = await part(0);
    const waiting = await pendingSearchEvents(productId);
    expect(waiting).toHaveLength(1);
    await q("UPDATE product_translations SET title = title || ' 2' WHERE product_id = $1", [productId]);
    await q("UPDATE product_variants SET weight_grams = 700 WHERE product_id = $1", [productId]);
    expect(await pendingSearchEvents(productId)).toEqual(waiting);
  });
});

describe.runIf(Boolean(process.env.MEILISEARCH_HOST))("search engine", () => {
  beforeAll(async () => {
    await rebuildProductIndex();
  });

  const settle = async () => {
    // Indexing in Meilisearch is asynchronous: wait for the queued tasks.
    const config = meiliConfig()!;
    const res = await fetch(`${config.host}/tasks?statuses=enqueued,processing&limit=1`, { headers: { Authorization: `Bearer ${config.key}` } });
    const { results } = (await res.json()) as { results: { uid: number }[] };
    if (results[0]) await meili.waitForTask(config, { taskUid: results[0].uid });
  };

  it("finds a product by title and part number after its change is delivered, and drops it once unpublished", async () => {
    const { ba } = await setup();
    const { productId } = await part(0);
    const [{ title, sku }] = (await q<{ title: string; sku: string }>(
      "SELECT t.title, v.sku FROM product_translations t JOIN product_variants v ON v.product_id = t.product_id WHERE t.product_id = $1 AND t.locale = 'fa'",
      [productId],
    )) as [{ title: string; sku: string }];
    await dispatchOutbox(OUTBOX_HANDLERS);
    await settle();
    expect((await searchStore("fa", title, 1)).products.map((p) => p.id)).toContain(productId);
    expect((await searchStore("en", sku.toLowerCase(), 1)).products.map((p) => p.id)).toContain(productId);
    expect((await searchStore("en", sku.replace(/-/g, ""), 1)).products.map((p) => p.id)).toContain(productId);

    ok(await setProductStatus(ba, productId, "archived"));
    await dispatchOutbox(OUTBOX_HANDLERS);
    await settle();
    const config = meiliConfig()!;
    const hits = await meili.search(config, PRODUCT_INDEX, { q: sku, offset: 0, limit: 5 }, 5000);
    expect(hits.hits.map((h) => h.id)).not.toContain(productId);
  });
});
