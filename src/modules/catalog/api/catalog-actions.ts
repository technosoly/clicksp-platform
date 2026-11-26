"use server";

import { redirect } from "@/lib/i18n/navigation";
import { localeOf, runAdminAction, text, type ActionState } from "@/modules/identity/api/admin-action";
import type { UploadedFile } from "@/modules/media/service/images";
import { createBrand, updateBrand } from "../service/brands";
import { setBrandLogo, setCategoryImage, type PictureResult } from "../service/catalog-pictures";
import { createCategory, updateCategory, type CatalogResult } from "../service/categories";
import {
  addProductImage,
  makePrimaryProductImage,
  removeProductImage,
  reorderProductImage,
  updateProductImage,
  type ImageResult,
} from "../service/product-images";
import { cancelOwnPriceRequest, decidePriceRequest, type ApprovalResult } from "../service/price-approvals";
import {
  addIdentifier,
  addVariant,
  changeCost,
  changePrice,
  createProduct,
  removeIdentifier,
  setProductStatus,
  updateProduct,
  updateVariant,
  type PriceResult,
  type ProductResult,
} from "../service/products";

/**
 * Server Actions for the catalog screens. They only read the form and call
 * the services, which authorize every call (hidden ids included).
 */

function catalogFailure(result: Exclude<CatalogResult, { status: "ok" }>): ActionState {
  if (result.status === "invalid") return { error: result.field };
  if (result.status === "taken") return { error: "slug_taken" };
  return { error: result.status };
}

function productFailure(result: Exclude<ProductResult, { status: "ok" }>): ActionState {
  switch (result.status) {
    case "invalid":
      return { error: result.field };
    case "taken":
      return { error: `${result.field}_taken` };
    case "not_publishable":
      return { error: result.problems[0] ?? "not_publishable" };
    default:
      return { error: result.status };
  }
}

function priceState(result: PriceResult): ActionState {
  switch (result.status) {
    case "applied":
      return { ok: true, message: "priceSaved" };
    case "proposed":
      return { ok: true, message: "priceProposed" };
    case "unchanged":
      return { ok: true, message: "unchanged" };
    case "invalid":
      return { error: result.field };
    default:
      return { error: result.status };
  }
}

const names = (form: FormData) => ({ faName: text(form, "faName"), faSlug: text(form, "faSlug"), enName: text(form, "enName"), enSlug: text(form, "enSlug") });

export async function createCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await createCategory(actor, {
      ...names(form),
      parentId: text(form, "parentId"),
      isVehicleSystem: form.get("isVehicleSystem") === "on",
      isActive: true,
      sortOrder: text(form, "sortOrder"),
    });
    return result.status === "ok" ? { ok: true, message: "categoryCreated" } : catalogFailure(result);
  });
}

export async function updateCategoryAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await updateCategory(actor, text(form, "categoryId"), {
      ...names(form),
      parentId: text(form, "parentId"),
      isVehicleSystem: form.get("isVehicleSystem") === "on",
      isActive: form.get("isActive") === "on",
      sortOrder: text(form, "sortOrder"),
    });
    return result.status === "ok" ? { ok: true, message: "saved" } : catalogFailure(result);
  });
}

export async function createBrandAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await createBrand(actor, { ...names(form), isGenuine: form.get("isGenuine") === "on", isActive: true, sortOrder: text(form, "sortOrder") });
    return result.status === "ok" ? { ok: true, message: "brandCreated" } : catalogFailure(result);
  });
}

export async function updateBrandAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await updateBrand(actor, text(form, "brandId"), {
      ...names(form),
      isGenuine: form.get("isGenuine") === "on",
      isActive: form.get("isActive") === "on",
      sortOrder: text(form, "sortOrder"),
    });
    return result.status === "ok" ? { ok: true, message: "saved" } : catalogFailure(result);
  });
}

const productDetails = (form: FormData) => ({
  faTitle: text(form, "faTitle"),
  faSlug: text(form, "faSlug"),
  faShort: text(form, "faShort"),
  enTitle: text(form, "enTitle"),
  enSlug: text(form, "enSlug"),
  enShort: text(form, "enShort"),
  brandId: text(form, "brandId"),
  primaryCategoryId: text(form, "primaryCategoryId"),
  categoryIds: form.getAll("categoryIds").filter((v): v is string => typeof v === "string" && v !== ""),
  warrantyMonths: text(form, "warrantyMonths"),
});

export async function createProductAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  let productId: string | null = null;
  let message = "productCreated";
  const state = await runAdminAction(form, async (actor) => {
    const result = await createProduct(actor, {
      ...productDetails(form),
      sku: text(form, "sku"),
      price: text(form, "price"),
      compareAtPrice: text(form, "compareAtPrice"),
    });
    if (result.status !== "ok") return productFailure(result);
    productId = result.id;
    if (result.priceStatus === "proposed") message = "productCreatedPriceProposed";
    return { ok: true, message };
  });
  if (productId) redirect({ href: `/admin/products/${productId}?created=${message}`, locale: localeOf(form) });
  return state;
}

export async function updateProductAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await updateProduct(actor, text(form, "productId"), productDetails(form));
    return result.status === "ok" ? { ok: true, message: "saved" } : productFailure(result);
  });
}

export async function setProductStatusAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await setProductStatus(actor, text(form, "productId"), text(form, "status"));
    return result.status === "ok" ? { ok: true, message: "statusChanged" } : productFailure(result);
  });
}

const variantDetails = (form: FormData) => ({
  sku: text(form, "sku"),
  weightGrams: text(form, "weightGrams"),
  lengthMm: text(form, "lengthMm"),
  widthMm: text(form, "widthMm"),
  heightMm: text(form, "heightMm"),
  minOrderQty: text(form, "minOrderQty"),
  maxOrderQty: text(form, "maxOrderQty"),
  isActive: form.get("isActive") === "on",
});

export async function addVariantAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await addVariant(actor, text(form, "productId"), { ...variantDetails(form), isActive: false });
    return result.status === "ok" ? { ok: true, message: "variantAdded" } : productFailure(result);
  });
}

export async function updateVariantAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await updateVariant(actor, text(form, "variantId"), variantDetails(form));
    return result.status === "ok" ? { ok: true, message: "saved" } : productFailure(result);
  });
}

export async function changePriceAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    priceState(await changePrice(actor, text(form, "variantId"), { price: text(form, "price"), compareAtPrice: text(form, "compareAtPrice") })),
  );
}

export async function changeCostAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => priceState(await changeCost(actor, text(form, "variantId"), { costPrice: text(form, "costPrice") })));
}

export async function addIdentifierAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await addIdentifier(actor, text(form, "productId"), { type: text(form, "type") as "oem", value: text(form, "value"), brandId: text(form, "brandId") });
    return result.status === "ok" ? { ok: true, message: "identifierAdded" } : productFailure(result);
  });
}

export async function removeIdentifierAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const result = await removeIdentifier(actor, text(form, "productId"), text(form, "identifierId"));
    return result.status === "ok" ? { ok: true, message: "identifierRemoved" } : productFailure(result);
  });
}

function approvalState(result: ApprovalResult): ActionState {
  if (result.status === "ok") return { ok: true, message: `request_${result.outcome}` };
  if (result.status === "invalid") return { error: result.field };
  return { error: `request_${result.status}` };
}

export async function decidePriceRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const decision = text(form, "decision") === "approve" ? "approve" : "reject";
    return approvalState(await decidePriceRequest(actor, text(form, "approvalId"), decision, text(form, "note")));
  });
}

export async function cancelPriceRequestAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => approvalState(await cancelOwnPriceRequest(actor, text(form, "approvalId"))));
}

// Product photos ------------------------------------------------------------

function imageState(result: ImageResult, message: string): ActionState {
  if (result.status === "ok") return { ok: true, message };
  return { error: result.status === "invalid" ? result.field : result.status };
}

export async function addProductImageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const file = form.get("image");
    if (!(file instanceof File) || file.size === 0) return { error: "image_missing" };
    const result = await addProductImage(
      actor,
      text(form, "productId"),
      { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) },
      { fa: text(form, "altFa"), en: text(form, "altEn") },
    );
    return imageState(result, "imageAdded");
  });
}

export async function updateProductImageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) =>
    imageState(await updateProductImage(actor, text(form, "productId"), text(form, "imageId"), { fa: text(form, "altFa"), en: text(form, "altEn") }), "saved"),
  );
}

export async function productImageCommandAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const productId = text(form, "productId");
    const imageId = text(form, "imageId");
    switch (text(form, "command")) {
      case "primary":
        return imageState(await makePrimaryProductImage(actor, productId, imageId), "imagePrimary");
      case "up":
      case "down":
        return imageState(await reorderProductImage(actor, productId, imageId, text(form, "command")), "imageMoved");
      case "remove":
        return imageState(await removeProductImage(actor, productId, imageId), "imageRemoved");
      default:
        return { error: "invalid" };
    }
  });
}

// Brand logos and category pictures -----------------------------------------

async function pictureFile(form: FormData): Promise<UploadedFile | "missing" | null> {
  if (text(form, "command") === "remove") return null;
  const file = form.get("image");
  if (!(file instanceof File) || file.size === 0) return "missing";
  return { name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) };
}

function pictureState(result: PictureResult, removed: boolean): ActionState {
  if (result.status === "ok") return { ok: true, message: removed ? "imageRemoved" : "imageAdded" };
  return { error: result.status === "invalid" ? result.field : result.status };
}

export async function brandLogoAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const file = await pictureFile(form);
    if (file === "missing") return { error: "image_missing" };
    return pictureState(await setBrandLogo(actor, text(form, "brandId"), file), file === null);
  });
}

export async function categoryImageAction(_prev: ActionState, form: FormData): Promise<ActionState> {
  return runAdminAction(form, async (actor) => {
    const file = await pictureFile(form);
    if (file === "missing") return { error: "image_missing" };
    return pictureState(await setCategoryImage(actor, text(form, "categoryId"), file), file === null);
  });
}
