/**
 * Kavenegar web push on storefront pages (the owner's request, Nov 2026).
 *
 * The owner's snippet is `<script src="https://cdn.kavenegar.com/sdk/page.js?appId=…" defer>`.
 * It is not rendered as a literal `defer` tag: a deferred script holds back
 * DOMContentLoaded until it has downloaded, and Next.js closes the page's
 * hydration data stream on DOMContentLoaded (next/dist/client/app-index.js).
 * When the CDN is filtered or hanging (a foreign host, see docs/DEPLOYMENT.md)
 * that would leave the page half hydrated until the connection times out.
 * Instead a few inline lines add the same `<script defer charset="utf-8">`
 * tag to <head> after the page's `load` event, so a slow or unreachable CDN
 * never delays rendering, hydration or the load event, and a failed download
 * only fails that one script.
 *
 * Only storefront pages with the static Content-Security-Policy load it;
 * admin, preview, sign-in, account, cart and checkout pages never do.
 * Switch: KAVENEGAR_WEBPUSH_APP_ID (set it empty to turn web push off).
 */

export const KAVENEGAR_CDN_ORIGIN = "https://cdn.kavenegar.com";
/** The owner's public Kavenegar web-push app id (not a secret: it is sent to every visitor). */
export const DEFAULT_KAVENEGAR_WEBPUSH_APP_ID = "06693099-4534-40ff-ae23-e73f63cdb0e9";

const APP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The app id to load, or null when web push is off. Unset uses the owner's
 * id; an empty value (or "off") turns it off; anything that is not a UUID is
 * refused rather than put into a script URL.
 */
export function kavenegarWebPushAppId(value: string | undefined): string | null {
  if (value === undefined) return DEFAULT_KAVENEGAR_WEBPUSH_APP_ID;
  const v = value.trim();
  if (v === "" || v.toLowerCase() === "off") return null;
  return APP_ID.test(v) ? v.toLowerCase() : null;
}

export function kavenegarPageScriptUrl(appId: string): string {
  return `${KAVENEGAR_CDN_ORIGIN}/sdk/page.js?appId=${encodeURIComponent(appId)}`;
}

/** Inline loader: after `load`, append the deferred SDK tag to <head> once. Any error stays inside. */
export function kavenegarLoaderScript(appId: string): string {
  const src = JSON.stringify(kavenegarPageScriptUrl(appId));
  return `(function(){function a(){try{if(document.getElementById("kvn-web-push"))return;var s=document.createElement("script");s.id="kvn-web-push";s.src=${src};s.defer=true;s.charset="utf-8";document.head.appendChild(s)}catch(e){}}if(document.readyState==="complete")a();else window.addEventListener("load",a,{once:true})})();`;
}
