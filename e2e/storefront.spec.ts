import "dotenv/config";
import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import pg from "pg";

/**
 * Phase 6b part 1 end to end: a visitor finds a published part from the
 * header search, opens it (price, availability, verified fitment), and finds
 * it again from its motorcycle. A draft product never shows. All data is
 * synthetic (E2E ... / e2e-*), inserted directly.
 */

async function sql<T extends pg.QueryResultRow>(text: string, params: unknown[] = []): Promise<T[]> {
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    return (await client.query<T>(text, params)).rows;
  } finally {
    await client.end();
  }
}

async function fixture(id: string) {
  const [category] = await sql<{ id: string }>("INSERT INTO categories DEFAULT VALUES RETURNING id");
  await sql("INSERT INTO category_translations (category_id, locale, name, slug, search_name) VALUES ($1, 'en', $2::text, $3, lower($2::text)), ($1, 'fa', $4::text, $5, $4::text)", [
    category!.id,
    `E2E Brakes ${id}`,
    `e2e-brakes-${id}`,
    `e2e ترمز ${id}`,
    `e2e-tormoz-${id}`,
  ]);
  const product = async (title: string, status: string) => {
    const [p] = await sql<{ id: string }>("INSERT INTO products (primary_category_id, status, published_at) VALUES ($1, $2::product_status, CASE WHEN $2 = 'active' THEN now() END) RETURNING id", [category!.id, status]);
    await sql("INSERT INTO product_categories (product_id, category_id) VALUES ($1, $2)", [p!.id, category!.id]);
    await sql("INSERT INTO product_translations (product_id, locale, title, slug, search_title) VALUES ($1, 'en', $2::text, $3, lower($2::text))", [p!.id, title, `e2e-${title.toLowerCase().replace(/\s+/g, "-")}`]);
    const sku = randomUUID().slice(0, 8);
    await sql("INSERT INTO product_variants (product_id, sku, sku_normalized, is_default, price) VALUES ($1, $2, $3, true, 1250000)", [p!.id, `E2ES-${sku}`, `E2ES${sku.toUpperCase()}`]);
    return p!.id;
  };
  const published = await product(`E2E Pads ${id}`, "active");
  await product(`E2E Hidden ${id}`, "draft");

  const [maker] = await sql<{ id: string }>("INSERT INTO motorcycle_manufacturers DEFAULT VALUES RETURNING id");
  await sql("INSERT INTO motorcycle_manufacturer_translations (manufacturer_id, locale, name, slug, search_name) VALUES ($1, 'en', $2::text, $3, lower($2::text))", [maker!.id, `E2E Maker ${id}`, `e2e-maker-${id}`]);
  const [brand] = await sql<{ id: string }>("INSERT INTO motorcycle_brands (manufacturer_id) VALUES ($1) RETURNING id", [maker!.id]);
  await sql("INSERT INTO motorcycle_brand_translations (brand_id, locale, name, slug, search_name) VALUES ($1, 'en', $2::text, $3, lower($2::text))", [brand!.id, `E2EBrand${id}`, `e2e-brand-${id}`]);
  const [model] = await sql<{ id: string }>("INSERT INTO motorcycle_models (brand_id) VALUES ($1) RETURNING id", [brand!.id]);
  await sql("INSERT INTO motorcycle_model_translations (model_id, locale, name, slug, search_name) VALUES ($1, 'en', $2::text, $3, lower($2::text))", [model!.id, `Rider ${id}`, `e2e-rider-${id}`]);
  const [generation] = await sql<{ id: string }>("INSERT INTO motorcycle_generations (model_id, year_from, year_to) VALUES ($1, 2010, 2016) RETURNING id", [model!.id]);
  const [source] = await sql<{ id: string }>("INSERT INTO compatibility_sources (type, title) VALUES ('oem_catalog', 'E2E catalogue') RETURNING id");
  const [verifier] = await sql<{ id: string }>("INSERT INTO users (username, name) VALUES ($1, 'E2E Verifier') RETURNING id", [`test-e2e-v-${id}`]);
  await sql(
    "INSERT INTO product_compatibilities (product_id, motorcycle_generation_id, source_id, verification_status, verified_by, verified_at) VALUES ($1, $2, $3, 'verified', $4, now())",
    [published, generation!.id, source!.id, verifier!.id],
  );
  return { modelSlug: `e2e-rider-${id}` };
}

test("a visitor searches, opens a part with its fitment, and finds it by motorcycle", async ({ page }) => {
  const id = randomUUID().slice(0, 8);
  const { modelSlug } = await fixture(id);

  await page.goto("/en");
  await page.getByTestId("header-search").getByRole("searchbox").fill(`E2E Pads ${id}`);
  await page.getByTestId("header-search").getByRole("searchbox").press("Enter");
  await expect(page).toHaveURL(/\/en\/search\?q=/);
  await expect(page.getByTestId("product-card")).toHaveCount(1);
  await page.getByTestId("product-card").click();

  await expect(page.getByTestId("product-title")).toHaveText(`E2E Pads ${id}`);
  // 1,250,000 Rial = 125,000 Toman.
  await expect(page.getByTestId("product-price")).toHaveText("125,000 Toman");
  await expect(page.getByTestId("product-availability")).toHaveText("Out of stock");
  await expect(page.getByTestId("product-photo-placeholder")).toBeVisible();
  await expect(page.getByTestId("product-fitment-row")).toContainText(`E2EBrand${id} Rider ${id}`);
  await expect(page.getByTestId("product-fitment-row")).toContainText("2010–2016");

  // The draft product is never found.
  await page.goto(`/en/search?q=${encodeURIComponent(`E2E Hidden ${id}`)}`);
  await expect(page.getByTestId("product-grid-empty")).toBeVisible();

  await page.goto(`/en/motorcycles/${modelSlug}`);
  await expect(page.getByTestId("motorcycle-heading")).toHaveText(`Parts for E2EBrand${id} Rider ${id}`);
  await expect(page.getByTestId("product-card")).toHaveCount(1);
  await page.getByLabel("Model year").fill("2020");
  await page.getByRole("button", { name: "Show" }).click();
  await expect(page.getByTestId("product-grid-empty")).toBeVisible();

  await page.goto(`/en/c/e2e-brakes-${id}`);
  await expect(page.getByTestId("category-heading")).toHaveText(`E2E Brakes ${id}`);
  await expect(page.getByTestId("product-card")).toHaveCount(1);
  // The Persian page of the same category uses its Persian name.
  await page.goto(`/fa/c/e2e-brakes-${id}`);
  await expect(page.getByTestId("category-heading")).toHaveText(`e2e ترمز ${id}`);
});
