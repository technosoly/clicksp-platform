import { afterAll, describe, expect, it } from "vitest";
import { db as prisma } from "@/lib/db";
import { searchStore } from "@/modules/search/service/product-search";
import { q } from "./admin-actors";
import { part } from "./order-fixtures";

// A search engine that doesn't answer (nothing listens on port 9). Set before
// the environment is first read in this file's own process.
process.env.MEILISEARCH_HOST = "http://127.0.0.1:9";
process.env.MEILISEARCH_API_KEY = "unused";

afterAll(async () => {
  await prisma().$disconnect();
});

describe("search without a working search engine", () => {
  it("answers from the database", async () => {
    const { productId } = await part(0);
    const [row] = await q<{ title: string }>("SELECT title FROM product_translations WHERE product_id = $1 AND locale = 'fa'", [productId]);
    const result = await searchStore("fa", row!.title, 1);
    expect(result.products.map((p) => p.id)).toContain(productId);
  });
});
